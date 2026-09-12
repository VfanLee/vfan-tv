use crate::infrastructure::database::{self, DatabaseError, IncompatibleDatabase};
use crate::infrastructure::diagnostics::command_error;
use sqlx::{
    migrate::Migrator, sqlite::SqliteConnectOptions, Connection, SqliteConnection, SqlitePool,
};
use std::path::Path;

/// 用 SQLite 一致性快照生成不依赖 WAL 文件的独立数据库。
pub(super) async fn snapshot(connection: &mut SqliteConnection, path: &Path) -> Result<(), String> {
    database::create_snapshot(connection, path)
        .await
        .map_err(|error| command_error("创建数据库快照失败", error.as_ref()))
}

/// 将迁移错误转换为可采取行动的提示，底层原因写入日志。
fn migration_error(error: DatabaseError) -> String {
    let message = command_error("备份验证或升级失败，原备份和当前数据已保留", error.as_ref());
    if let Some(error) = error.downcast_ref::<IncompatibleDatabase>() {
        return error.to_string();
    }
    match error.downcast_ref::<sqlx::migrate::MigrateError>() {
        Some(sqlx::migrate::MigrateError::VersionMismatch(_)) => {
            "备份迁移记录与已发布版本不一致，无法安全导入".into()
        }
        Some(sqlx::migrate::MigrateError::Dirty(_)) => {
            "备份包含未完成的数据库迁移，无法安全导入".into()
        }
        _ => message,
    }
}

/// 检查当前连接主库的数据完整性和关联约束。
async fn check_integrity(connection: &mut SqliteConnection) -> Result<(), String> {
    let integrity: Vec<String> = sqlx::query_scalar("PRAGMA main.integrity_check")
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| command_error("数据库完整性检查失败", &error))?;
    if integrity != ["ok"] {
        return Err("数据库内容损坏或违反数据约束，无法安全导入".into());
    }
    if !sqlx::query("PRAGMA main.foreign_key_check")
        .fetch_all(connection)
        .await
        .map_err(|error| command_error("检查数据库关联失败", &error))?
        .is_empty()
    {
        return Err("数据库存在无效的关联数据，无法安全导入".into());
    }
    Ok(())
}

/// 只读原文件并生成独立副本；所有迁移和历史校验和修复只写入副本。
async fn prepare_backup(
    source_path: &Path,
    staged: &Path,
    migrator: &Migrator,
) -> Result<(), String> {
    let mut source = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(source_path)
            .read_only(true)
            .pragma("trusted_schema", "OFF"),
    )
    .await
    .map_err(|error| command_error("无法读取所选数据库", &error))?;
    let result = async {
        database::validate_history(&mut source, migrator)
            .await
            .map_err(migration_error)?;
        check_integrity(&mut source).await?;
        snapshot(&mut source, staged).await
    }
    .await;
    let closed = source.close().await;
    result?;
    closed.map_err(|error| command_error("关闭源数据库失败", &error))?;

    let mut connection = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(staged)
            .foreign_keys(true)
            .pragma("trusted_schema", "OFF"),
    )
    .await
    .map_err(|error| command_error("无法打开临时备份", &error))?;
    let result = async {
        // 再验证冻结后的副本，避免原文件在快照前发生变化。
        let state = database::validate_history(&mut connection, migrator)
            .await
            .map_err(migration_error)?;
        check_integrity(&mut connection).await?;
        state
            .align(&mut connection)
            .await
            .map_err(|error| command_error("修复历史换行记录失败", &error))?;
        migrator
            .run_direct(&mut connection)
            .await
            .map_err(|error| migration_error(error.into()))?;
        check_integrity(&mut connection).await
    }
    .await;
    let closed = connection.close().await;
    result?;
    closed.map_err(|error| command_error("关闭临时备份失败", &error))
}

/// 已验证可复制的表和显式列名，不依赖两个数据库的列顺序。
struct TransferTable {
    name: String,
    columns: String,
}

/// 引用来自数据库元数据的标识符，保留名称中的双引号。
fn quote_identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// 获取数据表及列类型、空值、主键和生成列信息，不比较建表 SQL 原文。
async fn transfer_tables(connection: &mut SqliteConnection) -> Result<Vec<TransferTable>, String> {
    let current: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM main.sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name<>'_sqlx_migrations' ORDER BY name",
    ).fetch_all(&mut *connection).await.map_err(|error| command_error("读取当前数据表失败", &error))?;
    let incoming: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM incoming.sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name<>'_sqlx_migrations' ORDER BY name",
    ).fetch_all(&mut *connection).await.map_err(|error| command_error("读取备份数据表失败", &error))?;
    if current != incoming {
        return Err("备份升级后的数据表与当前版本不匹配，无法安全导入".into());
    }
    let mut tables = Vec::with_capacity(current.len());
    for table in current {
        // 默认值和约束表达式由目标库执行；文本格式不参与兼容性判断。
        let query = "SELECT name,upper(type),\"notnull\",pk,hidden FROM pragma_table_xinfo(?,?) ORDER BY name";
        let columns: Vec<(String, String, i64, i64, i64)> = sqlx::query_as(query)
            .bind(&table)
            .bind("main")
            .fetch_all(&mut *connection)
            .await
            .map_err(|error| command_error("读取当前字段失败", &error))?;
        let incoming_columns: Vec<(String, String, i64, i64, i64)> = sqlx::query_as(query)
            .bind(&table)
            .bind("incoming")
            .fetch_all(&mut *connection)
            .await
            .map_err(|error| command_error("读取备份字段失败", &error))?;
        if columns != incoming_columns || columns.is_empty() {
            return Err(format!(
                "备份中的 {table} 字段与当前版本不匹配，无法安全导入"
            ));
        }
        let columns = columns
            .iter()
            .filter(|column| column.4 == 0)
            .map(|column| quote_identifier(&column.0))
            .collect::<Vec<_>>()
            .join(",");
        tables.push(TransferTable {
            name: quote_identifier(&table),
            columns,
        });
    }
    Ok(tables)
}

/// 验证已升级副本，先备份现库，再在单一事务内恢复数据并检查约束。
async fn restore_staged(
    db: &SqlitePool,
    staged: &Path,
    safety: &Path,
    migrator: &Migrator,
) -> Result<(), String> {
    let mut connection = db
        .acquire()
        .await
        .map_err(|error| command_error("数据库当前不可用", &error))?;
    let result = async {
        let state = database::validate_history(&mut connection, migrator)
            .await
            .map_err(migration_error)?;
        if state.needs_update(migrator) {
            return Err("当前数据库尚未完成升级，请重启应用后再导入".into());
        }
        sqlx::query("PRAGMA trusted_schema=OFF")
            .execute(&mut *connection)
            .await
            .map_err(|error| command_error("无法准备备份验证", &error))?;
        sqlx::query("ATTACH DATABASE ? AS incoming")
            .bind(staged.to_str().ok_or("备份路径编码无效")?)
            .execute(&mut *connection)
            .await
            .map_err(|error| command_error("无法打开临时备份", &error))?;
        let tables = transfer_tables(&mut connection).await?;
        snapshot(&mut connection, safety).await?;
        let mut tx = connection
            .begin()
            .await
            .map_err(|error| command_error("无法开始数据库恢复", &error))?;
        let restored = async {
            sqlx::query("PRAGMA defer_foreign_keys=ON")
                .execute(&mut *tx)
                .await
                .map_err(|error| command_error("无法准备数据库恢复", &error))?;
            for table in &tables {
                sqlx::query(&format!("DELETE FROM main.{}", table.name))
                    .execute(&mut *tx)
                    .await
                    .map_err(|error| command_error("清理恢复目标失败", &error))?;
            }
            for table in &tables {
                sqlx::query(&format!(
                    "INSERT INTO main.{0} ({1}) SELECT {1} FROM incoming.{0}",
                    table.name, table.columns
                ))
                .execute(&mut *tx)
                .await
                .map_err(|error| command_error("写入恢复数据失败，原数据已保留", &error))?;
            }
            check_integrity(&mut tx).await
        }
        .await;
        if let Err(error) = restored {
            tx.rollback()
                .await
                .map_err(|error| command_error("恢复失败且回滚失败，请保留安全备份", &error))?;
            return Err(error);
        }
        tx.commit()
            .await
            .map_err(|error| command_error("恢复提交失败，原数据已保留", &error))
    }
    .await;
    // 关闭专用连接释放附加库；提交成功后的关闭故障不能被报告成导入失败。
    if let Err(error) = connection.close().await {
        log::warn!("关闭恢复连接失败：{error}");
    }
    result
}

/// 完整导入入口；临时目录在成功和失败后清理，原文件始终只读。
pub(super) async fn restore(db: &SqlitePool, incoming: &Path, safety: &Path) -> Result<(), String> {
    restore_with_migrator(db, incoming, safety, &database::MIGRATOR).await
}

/// 使用指定迁移集执行真实导入流程，允许测试模拟下一版应用而不改动正式迁移。
pub(super) async fn restore_with_migrator(
    db: &SqlitePool,
    incoming: &Path,
    safety: &Path,
    migrator: &Migrator,
) -> Result<(), String> {
    let parent = safety.parent().ok_or("安全备份目录无效")?;
    let temporary = parent.join(format!(".restore-{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir(&temporary)
        .await
        .map_err(|error| command_error("无法创建恢复临时目录", &error))?;
    let staged = temporary.join("data.db");
    let result = async {
        prepare_backup(incoming, &staged, migrator).await?;
        restore_staged(db, &staged, safety, migrator).await
    }
    .await;
    if let Err(error) = tokio::fs::remove_dir_all(&temporary).await {
        log::warn!("清理恢复临时目录失败：{error}");
    }
    result
}
