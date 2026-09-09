use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    SqlitePool,
};
use std::{path::Path, time::Duration};

/// 应用数据库及默认导出文件名
pub const FILE_NAME: &str = "data.db";

/// 创建独立数据目录并初始化新版本数据库
pub async fn open(app_data_dir: &Path) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    let data_dir = app_data_dir.join("data");
    tokio::fs::create_dir_all(&data_dir).await?;
    let options = SqliteConnectOptions::new()
        .filename(data_dir.join(FILE_NAME))
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}
