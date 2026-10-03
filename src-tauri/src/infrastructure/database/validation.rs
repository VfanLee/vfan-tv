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
