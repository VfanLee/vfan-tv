use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    SqlitePool,
};
use std::{path::Path, time::Duration};

mod validation;
pub(crate) use validation::{
    canonical_checksum, canonical_schema, IncompatibleDatabase, SchemaObject,
};

/// 应用数据库及默认导出文件名
pub const FILE_NAME: &str = "data.db";
pub(crate) const APPLICATION_ID: i64 = 1447441494;
static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// 创建独立数据目录并初始化新版本数据库
pub async fn open(app_data_dir: &Path) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    let data_dir = app_data_dir.join("data");
    let path = data_dir.join(FILE_NAME);
    // 已有文件必须先只读验证，不能把外部数据库当成新库执行初始化。
    if tokio::fs::try_exists(&path).await? {
        validation::validate_file(&path).await?;
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
    let prepared = async {
        align_migration_checksums(&pool).await?;
        MIGRATOR.run(&pool).await
    }
    .await;
    if let Err(error) = prepared {
        pool.close().await;
        return Err(error.into());
    }
    Ok(pool)
}

/// 把仅换行风格不同的迁移校验和改写为当前构建的标准值，使 sqlx 继续按内容校验
async fn align_migration_checksums(pool: &SqlitePool) -> Result<(), sqlx::migrate::MigrateError> {
    let has_history: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='_sqlx_migrations')",
    )
    .fetch_one(pool)
    .await?;
    if !has_history {
        return Ok(());
    }
    let applied: Vec<(i64, Vec<u8>)> =
        sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations")
            .fetch_all(pool)
            .await?;
    for (version, checksum) in applied {
        let Some(canonical) = canonical_checksum(version, &checksum) else {
            continue;
        };
        if canonical == checksum {
            continue;
        }
        sqlx::query("UPDATE _sqlx_migrations SET checksum=? WHERE version=?")
            .bind(canonical)
            .bind(version)
            .execute(pool)
            .await?;
        log::info!("迁移 {version} 的校验和仅换行风格不同，已对齐为当前版本");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 最后一个连接正常关闭后，已提交数据写回主库并清除 WAL 辅助文件。
    #[tokio::test]
    async fn closing_database_preserves_data_and_removes_sidecars() {
        let directory =
            std::env::temp_dir().join(format!("vfan-shutdown-{}", uuid::Uuid::new_v4()));
        let data_dir = directory.join("data");
        let db = open(&directory).await.unwrap();
        sqlx::query("INSERT INTO search_history VALUES('saved-before-exit',1)")
            .execute(&db)
            .await
            .unwrap();
        assert!(data_dir.join("data.db-wal").exists());
        assert!(data_dir.join("data.db-shm").exists());

        db.close().await;
        assert!(data_dir.join(FILE_NAME).exists());
        assert!(!data_dir.join("data.db-wal").exists());
        assert!(!data_dir.join("data.db-shm").exists());
        let reopened = open(&directory).await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT keyword FROM search_history")
                .fetch_one(&reopened)
                .await
                .unwrap(),
            "saved-before-exit"
        );
        reopened.close().await;
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }

    /// 校验失败必须拒绝启动，同时保留原数据及迁移记录。
    #[tokio::test]
    async fn incompatible_database_is_preserved() {
        let directory = std::env::temp_dir().join(format!("vfan-startup-{}", uuid::Uuid::new_v4()));
        let db = open(&directory).await.unwrap();
        sqlx::query("INSERT INTO search_history VALUES('retained',1)")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query("UPDATE _sqlx_migrations SET checksum=X'00' WHERE version=1")
            .execute(&db)
            .await
            .unwrap();
        db.close().await;

        let error = open(&directory).await.unwrap_err();
        assert!(matches!(
            error.downcast_ref::<sqlx::migrate::MigrateError>(),
            Some(sqlx::migrate::MigrateError::VersionMismatch(1))
        ));
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(directory.join("data").join(FILE_NAME))
                    .read_only(true),
            )
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT keyword FROM search_history")
                .fetch_one(&db)
                .await
                .unwrap(),
            "retained"
        );
        assert_eq!(
            sqlx::query_scalar::<_, Vec<u8>>(
                "SELECT checksum FROM _sqlx_migrations WHERE version=1"
            )
            .fetch_one(&db)
            .await
            .unwrap(),
            vec![0]
        );
        db.close().await;
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }

    /// 其他平台构建写入的换行风格差异不阻断启动，校验和会被对齐且数据保持不变。
    #[tokio::test]
    async fn newline_only_checksum_is_aligned_on_startup() {
        use sha2::{Digest, Sha384};

        let directory = std::env::temp_dir().join(format!("vfan-newline-{}", uuid::Uuid::new_v4()));
        let db = open(&directory).await.unwrap();
        sqlx::query("INSERT INTO search_history VALUES('kept',1)")
            .execute(&db)
            .await
            .unwrap();
        let migration = MIGRATOR.iter().next().unwrap();
        let crlf = migration.sql.replace("\r\n", "\n").replace('\n', "\r\n");
        sqlx::query("UPDATE _sqlx_migrations SET checksum=? WHERE version=?")
            .bind(Sha384::digest(crlf.as_bytes()).to_vec())
            .bind(migration.version)
            .execute(&db)
            .await
            .unwrap();
        db.close().await;

        let reopened = open(&directory).await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT keyword FROM search_history")
                .fetch_one(&reopened)
                .await
                .unwrap(),
            "kept"
        );
        assert_eq!(
            sqlx::query_scalar::<_, Vec<u8>>(
                "SELECT checksum FROM _sqlx_migrations WHERE version=?"
            )
            .bind(migration.version)
            .fetch_one(&reopened)
            .await
            .unwrap(),
            migration.checksum.to_vec()
        );
        reopened.close().await;
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }

    /// 从空库执行唯一初始迁移，构造独立测试数据库
    async fn initial_database() -> SqlitePool {
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        db
    }

    /// 首次初始化直接得到最终表结构，重复初始化不会重置已保存配置
    #[tokio::test]
    async fn initialization_creates_final_schema_once() {
        let db = initial_database().await;
        assert_eq!(
            sqlx::query_scalar::<_, i64>("PRAGMA application_id")
                .fetch_one(&db)
                .await
                .unwrap(),
            1447441494
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM pragma_table_list WHERE strict=1")
                .fetch_one(&db)
                .await
                .unwrap(),
            8
        );
        let route: (String, Option<String>) =
            sqlx::query_as("SELECT mode,active_profile_id FROM network_routes WHERE route='iptv'")
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(route, ("direct".into(), None));
        sqlx::query("UPDATE network_routes SET mode='system' WHERE route='iptv'")
            .execute(&db)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT mode FROM network_routes WHERE route='iptv'")
                .fetch_one(&db)
                .await
                .unwrap(),
            "system"
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM _sqlx_migrations WHERE success=1")
                .fetch_one(&db)
                .await
                .unwrap(),
            1
        );
        assert!(sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&db)
            .await
            .unwrap()
            .is_empty());
        db.close().await;
    }

    /// 不经过 Rust 写入校验时，数据库仍拒绝空主键、错误类型和损坏 JSON
    #[tokio::test]
    async fn strict_constraints_reject_invalid_rows() {
        let db = initial_database().await;
        sqlx::query("INSERT INTO sources(id,kind,name,url,sort,created_at,updated_at) VALUES('s','vod','S','https://s.test/',0,1,1)")
            .execute(&db).await.unwrap();
        sqlx::query("INSERT INTO favorites(source_id,vod_id,source_name,title,created_at,updated_at) VALUES('s','v','S','T',1,1)")
            .execute(&db).await.unwrap();
        for statement in [
            "INSERT INTO subscriptions VALUES(NULL,'https://sub.test/',0,1,NULL)",
            "INSERT INTO subscriptions VALUES('s','https://sub.test/',0,'invalid',NULL)",
            "INSERT INTO search_history VALUES(NULL,1)",
            "INSERT INTO search_history VALUES('keyword',-1)",
            "UPDATE sources SET headers='[]'",
            "UPDATE sources SET backups='{}'",
            "UPDATE sources SET sort=-1",
            "UPDATE sources SET disabled=2",
            "UPDATE favorites SET raw_json='not-json'",
        ] {
            let error = sqlx::query(statement).execute(&db).await.unwrap_err();
            let code: i32 = error
                .as_database_error()
                .unwrap()
                .code()
                .unwrap()
                .parse()
                .unwrap();
            assert_eq!(
                code & 0xff,
                19,
                "expected constraint failure: {statement}: {error}"
            );
        }
        sqlx::query("UPDATE favorites SET raw_json='{}'")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query("UPDATE favorites SET raw_json=NULL")
            .execute(&db)
            .await
            .unwrap();
        db.close().await;
    }

    /// 直接删除与订阅级联都原子清理选择，事务回滚恢复偏好，用户资料不受影响
    #[tokio::test]
    async fn source_deletion_cleans_only_its_preferences() {
        let db = initial_database().await;
        sqlx::raw_sql(r#"
            INSERT INTO subscriptions VALUES('sub','https://sub.test/',0,1,NULL);
            INSERT INTO sources(id,kind,name,url,subscription_id,sort,created_at,updated_at)
                VALUES('vod','vod','V','https://v.test/','sub',0,1,1),
                      ('iptv','iptv','I','https://i.test/','sub',0,1,1),
                      ('keep','iptv','K','https://k.test/',NULL,1,1,1);
            INSERT INTO ui_preferences VALUES
                ('catalog','selectedSource','"vod"'),('iptv','selectedSource','"iptv"'),
                ('iptv-selection','iptv','{}'),('iptv-selection','keep','{}'),
                ('appearance','theme','"dark"');
            INSERT INTO favorites(source_id,vod_id,source_name,title,created_at,updated_at)
                VALUES('vod','v','V','Film',1,1);
            INSERT INTO recent_plays(source_id,source_name,vod_id,title,line_name,episode_name,episode_url,position_seconds,duration,played_at)
                VALUES('vod','V','v','Film','l','e','u',10,100,1);
        "#).execute(&db).await.unwrap();
        let mut tx = db.begin().await.unwrap();
        sqlx::query("DELETE FROM sources WHERE id='iptv'")
            .execute(&mut *tx)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM ui_preferences")
                .fetch_one(&mut *tx)
                .await
                .unwrap(),
            3
        );
        tx.rollback().await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM ui_preferences")
                .fetch_one(&db)
                .await
                .unwrap(),
            5
        );
        sqlx::query("DELETE FROM subscriptions WHERE id='sub'")
            .execute(&db)
            .await
            .unwrap();
        let preferences: Vec<(String, String)> =
            sqlx::query_as("SELECT scope,key FROM ui_preferences ORDER BY scope,key")
                .fetch_all(&db)
                .await
                .unwrap();
        assert_eq!(
            preferences,
            vec![
                ("appearance".into(), "theme".into()),
                ("iptv-selection".into(), "keep".into())
            ]
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM favorites")
                .fetch_one(&db)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM recent_plays")
                .fetch_one(&db)
                .await
                .unwrap(),
            1
        );
        db.close().await;
    }
}
