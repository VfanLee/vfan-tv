use crate::infrastructure::diagnostics::command_error;
use sqlx::{Connection, SqliteConnection, SqlitePool};
use std::path::Path;

/// 用 SQLite 一致性快照生成不依赖 WAL 文件的独立数据库
pub(super) async fn snapshot(connection: &mut SqliteConnection, path: &Path) -> Result<(), String> {
    let path = path.to_str().ok_or("文件路径编码无效")?;
    sqlx::query("VACUUM main INTO ?")
        .bind(path)
        .execute(connection)
        .await
        .map_err(|error| command_error("创建数据库快照失败", &error))?;
    let file = tokio::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .await
        .map_err(|error| command_error("无法打开备份文件", &error))?;
    file.sync_all()
        .await
        .map_err(|error| command_error("备份写入磁盘失败", &error))?;
    Ok(())
}

/// 校验应用标识、全部结构、迁移记录与数据完整性
async fn validate_attached(connection: &mut SqliteConnection) -> Result<(), String> {
    let application_id: i64 = sqlx::query_scalar("PRAGMA incoming.application_id")
        .fetch_one(&mut *connection)
        .await
        .map_err(|error| command_error("无法读取数据库标识", &error))?;
    if application_id != 1447441494 {
        return Err("此文件不是 Vfan TV 数据库".into());
    }
    let integrity: Vec<String> = sqlx::query_scalar("PRAGMA incoming.integrity_check")
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| command_error("数据库完整性检查失败", &error))?;
    if integrity != ["ok"] {
        return Err("备份数据库已损坏".into());
    }
    let current: Vec<(String,String,Option<String>)> = sqlx::query_as("SELECT type,name,sql FROM main.sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetch_all(&mut *connection).await.map_err(|error| command_error("读取当前数据库结构失败", &error))?;
    let incoming: Vec<(String,String,Option<String>)> = sqlx::query_as("SELECT type,name,sql FROM incoming.sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetch_all(&mut *connection).await.map_err(|error| command_error("读取备份结构失败", &error))?;
    if current != incoming {
        return Err("备份数据库结构与当前版本不匹配".into());
    }
    let current: Vec<(i64, bool, Vec<u8>)> = sqlx::query_as(
        "SELECT version,success,checksum FROM main._sqlx_migrations ORDER BY version",
    )
    .fetch_all(&mut *connection)
    .await
    .map_err(|error| command_error("读取当前结构版本失败", &error))?;
    let incoming: Vec<(i64, bool, Vec<u8>)> = sqlx::query_as(
        "SELECT version,success,checksum FROM incoming._sqlx_migrations ORDER BY version",
    )
    .fetch_all(&mut *connection)
    .await
    .map_err(|error| command_error("读取备份结构版本失败", &error))?;
    if current != incoming || incoming.iter().any(|(_, success, _)| !success) {
        return Err("备份迁移版本与当前应用不匹配".into());
    }
    if !sqlx::query("PRAGMA incoming.foreign_key_check")
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| command_error("检查备份关联数据失败", &error))?
        .is_empty()
    {
        return Err("备份数据库存在无效的关联数据".into());
    }
    Ok(())
}

/// 在单一事务内恢复所有业务表，任一步失败都回滚，保留当前数据库连接
pub(super) async fn restore(db: &SqlitePool, incoming: &Path, safety: &Path) -> Result<(), String> {
    let mut connection = db
        .acquire()
        .await
        .map_err(|error| command_error("数据库当前不可用", &error))?;
    let result = async {
        sqlx::query("ATTACH DATABASE ? AS incoming").bind(incoming.to_str().ok_or("备份路径编码无效")?).execute(&mut *connection).await.map_err(|error| command_error("无法打开备份数据库", &error))?;
        validate_attached(&mut connection).await?;
        snapshot(&mut connection,safety).await?;
        let mut tx = connection.begin().await.map_err(|error| command_error("无法开始数据库恢复", &error))?;
        sqlx::query("PRAGMA defer_foreign_keys=ON").execute(&mut *tx).await.map_err(|error| command_error("无法准备数据库恢复", &error))?;
        let tables: Vec<String> = sqlx::query_scalar("SELECT name FROM main.sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_sqlx_migrations' ORDER BY name").fetch_all(&mut *tx).await.map_err(|error| command_error("读取恢复表失败", &error))?;
        // 表名来自已验证一致的应用结构，双引号转义避免动态标识符影响 SQL
        for table in &tables {
            let table = table.replace('"',"\"\"");
            sqlx::query(&format!("DELETE FROM main.\"{table}\"")).execute(&mut *tx).await.map_err(|error| command_error("清理恢复目标失败", &error))?;
        }
        for table in &tables {
            let table = table.replace('"',"\"\"");
            sqlx::query(&format!("INSERT INTO main.\"{table}\" SELECT * FROM incoming.\"{table}\"")).execute(&mut *tx).await.map_err(|error| command_error("写入恢复数据失败", &error))?;
        }
        tx.commit().await.map_err(|error| command_error("恢复提交失败，原数据已保留", &error))?;
        Ok(())
    }.await;
    // 专用连接关闭时自动释放附加库，失败路径也不会污染连接池
    connection
        .close()
        .await
        .map_err(|error| command_error("关闭恢复连接失败", &error))?;
    result
}
