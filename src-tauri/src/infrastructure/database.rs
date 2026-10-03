use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    SqliteConnection, SqlitePool,
};
use std::{path::Path, time::Duration};

mod validation;
pub(crate) use validation::{validate_history, IncompatibleDatabase};
pub(crate) type DatabaseError = Box<dyn std::error::Error + Send + Sync>;

/// 应用数据库及默认导出文件名
pub const FILE_NAME: &str = "data.db";
pub(crate) const APPLICATION_ID: i64 = 1447441494;
pub(crate) static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// 创建独立数据目录并初始化新版本数据库
pub async fn open(app_data_dir: &Path) -> Result<SqlitePool, DatabaseError> {
    let data_dir = app_data_dir.join("data");
    let path = data_dir.join(FILE_NAME);
    // 已有文件必须先只读验证，不能把外部数据库当成新库执行初始化。
    let exists = tokio::fs::try_exists(&path).await?;
    if exists {
        validation::validate_file(&path, &MIGRATOR).await?;
    }
    tokio::fs::create_dir_all(&data_dir).await?;
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;
    let prepared: Result<(), DatabaseError> = async {
        let mut connection = pool.acquire().await?;
        if exists {
            let state = validate_history(&mut connection, &MIGRATOR).await?;
            if state.needs_update(&MIGRATOR) {
                let backup = data_dir.join(format!("before-upgrade-{}.db", uuid::Uuid::new_v4()));
                create_snapshot(&mut connection, &backup).await?;
                log::info!("升级前数据库备份：{}", backup.display());
                state.align(&mut connection).await?;
            }
        }
        MIGRATOR.run_direct(&mut *connection).await?;
        Ok(())
    }
    .await;
    if let Err(error) = prepared {
        pool.close().await;
        return Err(error);
    }
    Ok(pool)
}

/// 创建包含 WAL 最新提交的独立快照并写入磁盘，不覆盖已有文件。
pub(crate) async fn create_snapshot(
    connection: &mut SqliteConnection,
    path: &Path,
) -> Result<(), DatabaseError> {
    let path = path.to_str().ok_or("文件路径编码无效")?;
    sqlx::query("VACUUM main INTO ?")
        .bind(path)
        .execute(connection)
        .await?;
    let file = tokio::fs::OpenOptions::new().write(true).open(path).await?;
    file.sync_all().await?;
    Ok(())
}
