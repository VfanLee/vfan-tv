use super::{APPLICATION_ID, MIGRATOR};
use sqlx::{migrate::Migrate, sqlite::SqliteConnectOptions, Connection, SqliteConnection};
use std::{error::Error, fmt, path::Path};

/// 已有文件不属于本应用或与其声明的迁移结构不一致。
#[derive(Debug)]
pub(crate) struct IncompatibleDatabase(pub(crate) &'static str);

impl fmt::Display for IncompatibleDatabase {
    /// 提供可展示在启动提示框中的具体原因。
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.0)
    }
}

impl Error for IncompatibleDatabase {}

/// 在只读事务内验证已有文件，成功与失败路径都显式关闭连接。
pub(super) async fn validate_file(path: &Path) -> Result<(), Box<dyn Error>> {
    let mut connection =
        SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(path).read_only(true))
            .await?;
    let result = async {
        let mut transaction = connection.begin().await?;
        let result = validate(&mut transaction).await;
        transaction.rollback().await?;
        result
    }
    .await;
    let closed = connection.close().await;
    result?;
    closed?;
    Ok(())
}

/// 校验身份和迁移历史，并以相同迁移构造内存参考库核对表、索引与触发器。
async fn validate(connection: &mut SqliteConnection) -> Result<(), Box<dyn Error>> {
    let application_id: i64 = sqlx::query_scalar("PRAGMA application_id")
        .fetch_one(&mut *connection)
        .await?;
    if application_id != APPLICATION_ID {
        return Err(IncompatibleDatabase("此文件不是 Vfan TV 数据库").into());
    }
    let has_history: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='_sqlx_migrations')",
    )
    .fetch_one(&mut *connection)
    .await?;
    if !has_history {
        return Err(IncompatibleDatabase("数据库缺少迁移记录，无法确认结构版本").into());
    }
    if let Some(version) = connection.dirty_version().await? {
        return Err(sqlx::migrate::MigrateError::Dirty(version).into());
    }
    let applied = connection.list_applied_migrations().await?;
    if applied.is_empty() {
        return Err(IncompatibleDatabase("数据库迁移记录为空").into());
    }
    let mut expected = MIGRATOR
        .iter()
        .filter(|migration| !migration.migration_type.is_down_migration());
    let mut migrations = Vec::with_capacity(applied.len());
    for applied in &applied {
        let Some(migration) = expected
            .next()
            .filter(|migration| migration.version == applied.version)
        else {
            return Err(IncompatibleDatabase("数据库迁移版本未知或记录不连续").into());
        };
        if migration.checksum != applied.checksum {
            return Err(sqlx::migrate::MigrateError::VersionMismatch(applied.version).into());
        }
        migrations.push(migration);
    }

    let mut reference = SqliteConnection::connect("sqlite::memory:").await?;
    let result = async {
        reference.ensure_migrations_table().await?;
        // 只重建已执行的迁移；未来新增的正式迁移仍由正常启动流程执行。
        for migration in migrations {
            reference.apply(migration).await?;
        }
        if schema(connection).await? != schema(&mut reference).await? {
            return Err::<(), Box<dyn Error>>(
                IncompatibleDatabase(
                    "数据库实际结构与迁移记录不一致，可能混入其他应用的表或被手动修改",
                )
                .into(),
            );
        }
        Ok(())
    }
    .await;
    let closed = reference.close().await;
    result?;
    closed?;
    Ok(())
}

/// 读取用户定义的结构，忽略 SQLite 自身维护的内部对象。
async fn schema(
    connection: &mut SqliteConnection,
) -> Result<Vec<(String, String, Option<String>)>, sqlx::Error> {
    sqlx::query_as(
        "SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name",
    )
    .fetch_all(connection)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::{open, FILE_NAME};
    use std::path::PathBuf;

    /// 为每个拒绝场景创建独立目录，避免接触实际应用数据。
    async fn test_directory() -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("vfan-validation-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(directory.join("data"))
            .await
            .unwrap();
        directory
    }

    /// 拒绝已有文件时，主数据库内容必须逐字节保持不变。
    async fn assert_rejected_unchanged(directory: &Path) {
        let path = directory.join("data").join(FILE_NAME);
        let before = tokio::fs::read(&path).await.unwrap();
        let error = open(directory).await.unwrap_err();
        assert!(
            error.is::<IncompatibleDatabase>(),
            "unexpected error: {error}"
        );
        assert_eq!(tokio::fs::read(&path).await.unwrap(), before);
    }

    /// 外部数据库即使表名不冲突，也不能被添加应用表或改写应用标识。
    #[tokio::test]
    async fn foreign_database_is_rejected_before_initialization() {
        let directory = test_directory().await;
        let mut db = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(directory.join("data").join(FILE_NAME))
                .create_if_missing(true),
        )
        .await
        .unwrap();
        sqlx::raw_sql("CREATE TABLE unrelated(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO unrelated VALUES(1,'keep');")
            .execute(&mut db).await.unwrap();
        db.close().await.unwrap();
        assert_rejected_unchanged(&directory).await;
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }

    /// 标识正确也不能放行缺失或空白的迁移记录。
    #[tokio::test]
    async fn missing_migration_history_is_rejected() {
        for statement in [
            "DROP TABLE _sqlx_migrations",
            "DELETE FROM _sqlx_migrations",
        ] {
            let directory = test_directory().await;
            let db = open(&directory).await.unwrap();
            sqlx::query(statement).execute(&db).await.unwrap();
            db.close().await;
            assert_rejected_unchanged(&directory).await;
            tokio::fs::remove_dir_all(directory).await.unwrap();
        }
    }

    /// 迁移记录正常时，额外表、字段修改和索引或触发器缺失仍必须拒绝。
    #[tokio::test]
    async fn modified_schema_is_rejected_even_with_valid_migrations() {
        for statement in [
            "CREATE TABLE unrelated(id INTEGER PRIMARY KEY)",
            "ALTER TABLE search_history ADD COLUMN unexpected TEXT",
            "DROP INDEX favorites_updated_at",
            "DROP TRIGGER sources_cleanup_preferences",
        ] {
            let directory = test_directory().await;
            let db = open(&directory).await.unwrap();
            sqlx::query(statement).execute(&db).await.unwrap();
            db.close().await;
            assert_rejected_unchanged(&directory).await;
            tokio::fs::remove_dir_all(directory).await.unwrap();
        }
    }

    /// 已存在的空文件不能冒充首次运行的新数据库。
    #[tokio::test]
    async fn empty_existing_file_is_rejected() {
        let directory = test_directory().await;
        tokio::fs::write(directory.join("data").join(FILE_NAME), [])
            .await
            .unwrap();
        assert_rejected_unchanged(&directory).await;
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }

    /// 应用导出的独立快照仍可作为启动数据库使用。
    #[tokio::test]
    async fn exported_snapshot_is_accepted() {
        let source = test_directory().await;
        let destination = test_directory().await;
        let db = open(&source).await.unwrap();
        sqlx::query("INSERT INTO search_history VALUES('snapshot',1)")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query("VACUUM INTO ?")
            .bind(destination.join("data").join(FILE_NAME).to_str().unwrap())
            .execute(&db)
            .await
            .unwrap();
        db.close().await;
        let restored = open(&destination).await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT keyword FROM search_history")
                .fetch_one(&restored)
                .await
                .unwrap(),
            "snapshot"
        );
        restored.close().await;
        tokio::fs::remove_dir_all(source).await.unwrap();
        tokio::fs::remove_dir_all(destination).await.unwrap();
    }
}
