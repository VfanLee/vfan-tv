use super::{DatabaseError, APPLICATION_ID};
use sha2::{Digest, Sha384};
use sqlx::{
    migrate::{Migrate, Migration, Migrator},
    sqlite::SqliteConnectOptions,
    Connection, SqliteConnection,
};
use std::{error::Error, fmt, path::Path};

/// 已有文件不属于本应用，或迁移历史与当前应用不兼容。
#[derive(Debug)]
pub(crate) struct IncompatibleDatabase(pub(crate) &'static str);

impl fmt::Display for IncompatibleDatabase {
    /// 提供可展示在启动提示框中的具体原因。
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.0)
    }
}

impl Error for IncompatibleDatabase {}

/// 接受标准校验和，以及首个已发布迁移因 Windows 换行产生的已知变体。
fn checksum_matches(migration: &Migration, checksum: &[u8]) -> bool {
    if migration.checksum.as_ref() == checksum {
        return true;
    }
    migration.version == 1
        && Sha384::digest(migration.sql.replace('\n', "\r\n").as_bytes()).as_slice() == checksum
}

/// 已应用迁移数量及需要修复的历史换行校验和。
pub(crate) struct MigrationState {
    applied: usize,
    corrections: Vec<(i64, Vec<u8>)>,
}

impl MigrationState {
    /// 判断是否需要在修改数据库前创建安全快照。
    pub(crate) fn needs_update(&self, migrator: &Migrator) -> bool {
        !self.corrections.is_empty()
            || self.applied
                < migrator
                    .iter()
                    .filter(|m| !m.migration_type.is_down_migration())
                    .count()
    }

    /// 原子修复已确认的历史换行校验和，其他值不会进入修复列表。
    pub(crate) async fn align(&self, connection: &mut SqliteConnection) -> Result<(), sqlx::Error> {
        if self.corrections.is_empty() {
            return Ok(());
        }
        let mut transaction = connection.begin().await?;
        for (version, checksum) in &self.corrections {
            sqlx::query("UPDATE _sqlx_migrations SET checksum=? WHERE version=?")
                .bind(checksum)
                .bind(version)
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await
    }
}

/// 在只读事务内验证已有文件，成功与失败路径都显式关闭连接。
pub(super) async fn validate_file(path: &Path, migrator: &Migrator) -> Result<(), DatabaseError> {
    let mut connection =
        SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(path).read_only(true))
            .await?;
    let result = async {
        let mut transaction = connection.begin().await?;
        let result = validate_history(&mut transaction, migrator).await;
        transaction.rollback().await?;
        result
    }
    .await;
    let closed = connection.close().await;
    result?;
    closed?;
    Ok(())
}

/// 只读检查身份和迁移历史，允许已知旧版本继续升级，不比较建表 SQL 文本。
pub(crate) async fn validate_history(
    connection: &mut SqliteConnection,
    migrator: &Migrator,
) -> Result<MigrationState, DatabaseError> {
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
    let mut expected = migrator
        .iter()
        .filter(|migration| !migration.migration_type.is_down_migration());
    let latest = migrator
        .iter()
        .filter(|m| !m.migration_type.is_down_migration())
        .map(|m| m.version)
        .max()
        .unwrap_or(0);
    if applied.iter().any(|m| m.version > latest) {
        return Err(IncompatibleDatabase("数据库来自更新版本，请先升级应用后再打开或导入").into());
    }
    let mut corrections = Vec::new();
    for applied in &applied {
        let Some(migration) = expected
            .next()
            .filter(|migration| migration.version == applied.version)
        else {
            return Err(IncompatibleDatabase("数据库迁移版本未知或记录不连续").into());
        };
        if !checksum_matches(migration, &applied.checksum) {
            return Err(sqlx::migrate::MigrateError::VersionMismatch(applied.version).into());
        }
        if migration.checksum.as_ref() != applied.checksum.as_ref() {
            corrections.push((migration.version, migration.checksum.to_vec()));
        }
    }

    Ok(MigrationState {
        applied: applied.len(),
        corrections,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::{open, FILE_NAME};
    use std::path::PathBuf;

    /// 首个已发布迁移的字节必须固定，结构变更通过追加迁移实现。
    #[test]
    fn published_initial_migration_is_immutable() {
        let initial = super::super::MIGRATOR
            .iter()
            .find(|m| m.version == 1)
            .unwrap();
        assert_eq!(format!("{:x}", Sha384::digest(initial.sql.as_bytes())), "2df33be7430e79ab2d80ec77f4b533c6d7970bae89be3d0ea74b43e99e567819dd2535a6264c7e61abdaf34d87a3071a");
    }

    /// 换行例外只覆盖首个已发布迁移，不能放宽未来迁移的内容校验。
    #[test]
    fn newline_exception_does_not_apply_to_future_migrations() {
        let migration = Migration::new(
            2,
            "test".into(),
            sqlx::migrate::MigrationType::Simple,
            "SELECT 1;\n".into(),
            false,
        );
        let checksum = Sha384::digest(b"SELECT 1;\r\n");
        assert!(!checksum_matches(&migration, checksum.as_slice()));
    }

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

    /// 普通启动不重建参考库，也不因额外的用户表拒绝合法迁移历史。
    #[tokio::test]
    async fn additional_table_does_not_block_startup() {
        let directory = test_directory().await;
        let db = open(&directory).await.unwrap();
        sqlx::query("CREATE TABLE notes(value TEXT)")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO notes VALUES('keep')")
            .execute(&db)
            .await
            .unwrap();
        db.close().await;
        let reopened = open(&directory).await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT value FROM notes")
                .fetch_one(&reopened)
                .await
                .unwrap(),
            "keep"
        );
        reopened.close().await;
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }

    /// 更高版本或失败的迁移记录在写入前被拒绝，原库字节不变。
    #[tokio::test]
    async fn future_or_dirty_database_is_preserved() {
        for statement in [
            "UPDATE _sqlx_migrations SET version=999999",
            "UPDATE _sqlx_migrations SET success=0",
        ] {
            let directory = test_directory().await;
            let db = open(&directory).await.unwrap();
            sqlx::query(statement).execute(&db).await.unwrap();
            db.close().await;
            let path = directory.join("data").join(FILE_NAME);
            let before = tokio::fs::read(&path).await.unwrap();
            assert!(open(&directory).await.is_err());
            assert_eq!(tokio::fs::read(&path).await.unwrap(), before);
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
