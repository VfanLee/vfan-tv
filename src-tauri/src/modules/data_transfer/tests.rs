use super::clear::{clear_selected, ClearSelection};
use super::snapshot::{restore, snapshot};
use sqlx::{Connection, SqliteConnection};
use uuid::Uuid;

/// 清理所选数据后广播通知，并保留未选中的外观偏好
#[tokio::test]
async fn clearing_data_notifies_windows_after_commit() {
    use tauri::Listener;
    let directory = std::env::temp_dir().join(format!("vfan-clear-test-{}", Uuid::new_v4()));
    let db = crate::infrastructure::database::open(&directory)
        .await
        .unwrap();
    sqlx::query("INSERT INTO search_history VALUES('test',1)")
        .execute(&db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO ui_preferences VALUES('appearance','theme','\"dark\"'),('iptv','selectedSource','\"source\"')").execute(&db).await.unwrap();
    let app = tauri::test::mock_builder()
        .manage(crate::modules::iptv::Catalog::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    for name in [
        "app-data-changed",
        "search-history-changed",
        "ui-preferences-changed",
    ] {
        let events = events.clone();
        app.listen(name, move |_| events.lock().unwrap().push(name));
    }
    clear_selected(
        app.handle(),
        &db,
        ClearSelection {
            sources: true,
            search_history: true,
            favorites: false,
            recent: false,
            cache: false,
        },
    )
    .await
    .unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM search_history")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(count, 0);
    let preferences: Vec<(String, String)> =
        sqlx::query_as("SELECT scope,value FROM ui_preferences")
            .fetch_all(&db)
            .await
            .unwrap();
    assert_eq!(preferences, vec![("appearance".into(), "\"dark\"".into())]);
    assert_eq!(
        *events.lock().unwrap(),
        vec![
            "app-data-changed",
            "search-history-changed",
            "ui-preferences-changed"
        ]
    );
    db.close().await;
    tokio::fs::remove_dir_all(directory).await.unwrap();
}
/// WAL 中的最新数据进入独立快照，恢复前备份保留旧数据，错误结构不改变现库
#[tokio::test]
async fn snapshot_restore_and_rejection_preserve_data() {
    let directory = std::env::temp_dir().join(format!("vfan-transfer-test-{}", Uuid::new_v4()));
    let db = crate::infrastructure::database::open(&directory)
        .await
        .unwrap();
    sqlx::query("INSERT INTO subscriptions VALUES('first','https://first.test/',0,1,NULL)")
        .execute(&db)
        .await
        .unwrap();
    let exported = directory.join("export.db");
    {
        let mut connection = db.acquire().await.unwrap();
        snapshot(&mut connection, &exported).await.unwrap();
    }
    sqlx::query("UPDATE subscriptions SET url='https://changed.test/'")
        .execute(&db)
        .await
        .unwrap();
    let staged = directory.join("staged.db");
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&exported)
        .read_only(true)
        .pragma("trusted_schema", "OFF");
    let mut source = SqliteConnection::connect_with(&options).await.unwrap();
    snapshot(&mut source, &staged).await.unwrap();
    source.close().await.unwrap();
    let safety = directory.join("safety.db");
    restore(&db, &staged, &safety).await.unwrap();
    let restored: String = sqlx::query_scalar("SELECT url FROM subscriptions")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(restored, "https://first.test/");
    let mut saved = SqliteConnection::connect_with(
        &sqlx::sqlite::SqliteConnectOptions::new().filename(&safety),
    )
    .await
    .unwrap();
    let previous: String = sqlx::query_scalar("SELECT url FROM subscriptions")
        .fetch_one(&mut saved)
        .await
        .unwrap();
    assert_eq!(previous, "https://changed.test/");
    sqlx::query("CREATE TABLE unknown(value TEXT)")
        .execute(&mut saved)
        .await
        .unwrap();
    saved.close().await.unwrap();
    assert!(
        restore(&db, &safety, &directory.join("should-not-exist.db"))
            .await
            .is_err()
    );
    assert!(!directory.join("should-not-exist.db").exists());
    let retained: String = sqlx::query_scalar("SELECT url FROM subscriptions")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(retained, restored);
    db.close().await;
    tokio::fs::remove_dir_all(&directory).await.unwrap();
}

/// 使用临时目录创建当前版本测试库，预置用于检查回滚的记录。
async fn transfer_database() -> (std::path::PathBuf, sqlx::SqlitePool) {
    let directory = std::env::temp_dir().join(format!("vfan-portable-{}", Uuid::new_v4()));
    let db = crate::infrastructure::database::open(&directory)
        .await
        .unwrap();
    sqlx::query("INSERT INTO search_history VALUES('当前数据',7)")
        .execute(&db)
        .await
        .unwrap();
    (directory, db)
}

/// 导出供测试使用的独立快照。
async fn export_fixture(db: &sqlx::SqlitePool, directory: &std::path::Path) -> std::path::PathBuf {
    let path = directory.join(format!("export-{}.db", Uuid::new_v4()));
    snapshot(&mut db.acquire().await.unwrap(), &path)
        .await
        .unwrap();
    path
}

/// 创建追加迁移的未来应用，正式迁移文件保持不变。
fn future_migrator(sql: &str) -> sqlx::migrate::Migrator {
    use sqlx::migrate::{Migration, MigrationType, Migrator};
    let mut migrations: Vec<_> = crate::infrastructure::database::MIGRATOR
        .iter()
        .cloned()
        .collect();
    let version = migrations.last().unwrap().version + 1;
    migrations.push(Migration::new(
        version,
        "future test".into(),
        MigrationType::Simple,
        sql.to_owned().into(),
        false,
    ));
    Migrator {
        migrations: migrations.into(),
        ..Migrator::DEFAULT
    }
}

/// 检查失败后当前业务数据和迁移记录均未改变。
async fn assert_current_data(db: &sqlx::SqlitePool) {
    let rows: Vec<(String, i64)> = sqlx::query_as("SELECT keyword,searched_at FROM search_history")
        .fetch_all(db)
        .await
        .unwrap();
    assert_eq!(rows, vec![("当前数据".into(), 7)]);
}

/// 恢复结束必须移除本次创建的临时目录和 SQLite 辅助文件。
async fn assert_no_staging(directory: &std::path::Path) {
    let mut entries = tokio::fs::read_dir(directory).await.unwrap();
    while let Some(entry) = entries.next_entry().await.unwrap() {
        assert!(!entry.file_name().to_string_lossy().starts_with(".restore-"));
    }
}

/// 真正使用 CRLF SQL 创建另一平台的库，启动和导入都允许，且不改原备份。
#[tokio::test]
async fn crlf_database_opens_and_imports_without_changing_source() {
    use sqlx::migrate::{Migrate, Migration};
    let (directory, db) = transfer_database().await;
    let source_dir = directory.join("windows");
    tokio::fs::create_dir_all(source_dir.join("data"))
        .await
        .unwrap();
    let source_path = source_dir.join("data/data.db");
    let mut source = SqliteConnection::connect_with(
        &sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&source_path)
            .create_if_missing(true),
    )
    .await
    .unwrap();
    source.ensure_migrations_table().await.unwrap();
    for original in crate::infrastructure::database::MIGRATOR.iter() {
        let migration = Migration::new(
            original.version,
            original.description.clone(),
            original.migration_type,
            original.sql.replace('\n', "\r\n").into(),
            original.no_tx,
        );
        source.apply(&migration).await.unwrap();
    }
    sqlx::query("INSERT INTO search_history VALUES('跨平台收藏 🎬',42)")
        .execute(&mut source)
        .await
        .unwrap();
    source.close().await.unwrap();
    let before = tokio::fs::read(&source_path).await.unwrap();
    restore(&db, &source_path, &directory.join("safety.db"))
        .await
        .unwrap();
    assert_eq!(tokio::fs::read(&source_path).await.unwrap(), before);
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT keyword FROM search_history")
            .fetch_one(&db)
            .await
            .unwrap(),
        "跨平台收藏 🎬"
    );
    let reopened = crate::infrastructure::database::open(&source_dir)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT keyword FROM search_history")
            .fetch_one(&reopened)
            .await
            .unwrap(),
        "跨平台收藏 🎬"
    );
    reopened.close().await;
    // 启动修复前的快照仍保留原来的 CRLF 迁移记录。
    let mut backups = tokio::fs::read_dir(source_dir.join("data")).await.unwrap();
    let mut count = 0;
    while let Some(entry) = backups.next_entry().await.unwrap() {
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with("before-upgrade-")
        {
            count += 1;
            let mut backup = SqliteConnection::connect_with(
                &sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(entry.path())
                    .read_only(true),
            )
            .await
            .unwrap();
            let checksum: Vec<u8> =
                sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version=1")
                    .fetch_one(&mut backup)
                    .await
                    .unwrap();
            assert_ne!(
                checksum,
                crate::infrastructure::database::MIGRATOR
                    .iter()
                    .next()
                    .unwrap()
                    .checksum
                    .as_ref()
            );
            backup.close().await.unwrap();
        }
    }
    assert_eq!(count, 1);
    assert_no_staging(&directory).await;
    db.close().await;
    tokio::fs::remove_dir_all(directory).await.unwrap();
}

/// 相同字段按名称传输，建表格式、列顺序和源库索引不影响恢复结果。
#[tokio::test]
async fn reordered_columns_and_different_ddl_are_imported_by_name() {
    let (directory, db) = transfer_database().await;
    let source_path = export_fixture(&db, &directory).await;
    let mut source = SqliteConnection::connect_with(
        &sqlx::sqlite::SqliteConnectOptions::new().filename(&source_path),
    )
    .await
    .unwrap();
    sqlx::raw_sql("DROP TABLE search_history; CREATE TABLE search_history ( searched_at INTEGER NOT NULL, keyword TEXT PRIMARY KEY NOT NULL ) STRICT; INSERT INTO search_history VALUES(123,'另一台电脑');")
        .execute(&mut source).await.unwrap();
    source.close().await.unwrap();
    restore(&db, &source_path, &directory.join("safety.db"))
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_as::<_, (String, i64)>("SELECT keyword,searched_at FROM search_history")
            .fetch_one(&db)
            .await
            .unwrap(),
        ("另一台电脑".into(), 123)
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM sqlite_schema WHERE name='search_history_searched_at'"
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        1
    );
    db.close().await;
    tokio::fs::remove_dir_all(directory).await.unwrap();
}

/// 旧备份在副本中升级，恢复新增字段和新表的数据，原文件和当前迁移记录保持正确。
#[tokio::test]
async fn older_backup_is_upgraded_on_a_copy_before_restore() {
    let (directory, db) = transfer_database().await;
    let source_path = export_fixture(&db, &directory).await;
    let before = tokio::fs::read(&source_path).await.unwrap();
    let migrator = future_migrator("ALTER TABLE search_history ADD COLUMN origin TEXT NOT NULL DEFAULT '旧备份'; CREATE TABLE import_notes(id INTEGER PRIMARY KEY, note TEXT NOT NULL) STRICT; INSERT INTO import_notes VALUES(1,'已升级');");
    migrator.run(&db).await.unwrap();
    sqlx::query("UPDATE search_history SET keyword='新版本当前数据',origin='本机'")
        .execute(&db)
        .await
        .unwrap();
    super::snapshot::restore_with_migrator(
        &db,
        &source_path,
        &directory.join("safety.db"),
        &migrator,
    )
    .await
    .unwrap();
    assert_eq!(tokio::fs::read(&source_path).await.unwrap(), before);
    assert_eq!(
        sqlx::query_as::<_, (String, String)>("SELECT keyword,origin FROM search_history")
            .fetch_one(&db)
            .await
            .unwrap(),
        ("当前数据".into(), "旧备份".into())
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT note FROM import_notes")
            .fetch_one(&db)
            .await
            .unwrap(),
        "已升级"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM _sqlx_migrations")
            .fetch_one(&db)
            .await
            .unwrap(),
        migrator.iter().count() as i64
    );
    let mut safety = SqliteConnection::connect_with(
        &sqlx::sqlite::SqliteConnectOptions::new()
            .filename(directory.join("safety.db"))
            .read_only(true),
    )
    .await
    .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT keyword FROM search_history")
            .fetch_one(&mut safety)
            .await
            .unwrap(),
        "新版本当前数据"
    );
    safety.close().await.unwrap();
    assert_no_staging(&directory).await;
    db.close().await;
    tokio::fs::remove_dir_all(directory).await.unwrap();
}

/// 更高版本备份明确要求升级应用，失败不会产生安全备份或改变当前数据。
#[tokio::test]
async fn newer_backup_requires_app_upgrade() {
    let (directory, db) = transfer_database().await;
    let source_path = export_fixture(&db, &directory).await;
    let mut source = SqliteConnection::connect_with(
        &sqlx::sqlite::SqliteConnectOptions::new().filename(&source_path),
    )
    .await
    .unwrap();
    future_migrator("ALTER TABLE search_history ADD COLUMN extra TEXT;")
        .run_direct(&mut source)
        .await
        .unwrap();
    source.close().await.unwrap();
    let before = tokio::fs::read(&source_path).await.unwrap();
    let error = restore(&db, &source_path, &directory.join("safety.db"))
        .await
        .unwrap_err();
    assert!(error.contains("请先升级应用"), "{error}");
    assert!(!directory.join("safety.db").exists());
    assert_eq!(tokio::fs::read(&source_path).await.unwrap(), before);
    assert_current_data(&db).await;
    assert_no_staging(&directory).await;
    db.close().await;
    tokio::fs::remove_dir_all(directory).await.unwrap();
}

/// 数据不满足新迁移时只丢弃副本，当前库和原备份保持不变。
#[tokio::test]
async fn failed_upgrade_preserves_original_and_current_databases() {
    let (directory, db) = transfer_database().await;
    let source_path = export_fixture(&db, &directory).await;
    let mut source = SqliteConnection::connect_with(
        &sqlx::sqlite::SqliteConnectOptions::new().filename(&source_path),
    )
    .await
    .unwrap();
    sqlx::query("INSERT INTO search_history VALUES('第二条',8)")
        .execute(&mut source)
        .await
        .unwrap();
    source.close().await.unwrap();
    let before = tokio::fs::read(&source_path).await.unwrap();
    let migrator = future_migrator("ALTER TABLE search_history ADD COLUMN origin TEXT; CREATE UNIQUE INDEX one_history ON search_history((1));");
    migrator.run(&db).await.unwrap();
    assert!(super::snapshot::restore_with_migrator(
        &db,
        &source_path,
        &directory.join("safety.db"),
        &migrator
    )
    .await
    .is_err());
    assert_eq!(tokio::fs::read(&source_path).await.unwrap(), before);
    assert!(!directory.join("safety.db").exists());
    assert_current_data(&db).await;
    assert_no_staging(&directory).await;
    db.close().await;
    tokio::fs::remove_dir_all(directory).await.unwrap();
}

/// 源库去掉 CHECK 后写入的非法数据仍被目标约束拒绝，已删除或写入的数据完整回滚。
#[tokio::test]
async fn target_constraints_roll_back_failed_restore() {
    let (directory, db) = transfer_database().await;
    sqlx::query("INSERT INTO favorites(source_id,vod_id,source_name,title,created_at,updated_at) VALUES('s','v','源','收藏',1,1)").execute(&db).await.unwrap();
    let source_path = export_fixture(&db, &directory).await;
    let mut source = SqliteConnection::connect_with(
        &sqlx::sqlite::SqliteConnectOptions::new().filename(&source_path),
    )
    .await
    .unwrap();
    sqlx::raw_sql("DELETE FROM favorites; DROP TABLE search_history; CREATE TABLE search_history(keyword TEXT PRIMARY KEY NOT NULL, searched_at INTEGER NOT NULL) STRICT; INSERT INTO search_history VALUES('非法时间',-1);").execute(&mut source).await.unwrap();
    source.close().await.unwrap();
    let before = tokio::fs::read(&source_path).await.unwrap();
    assert!(restore(&db, &source_path, &directory.join("safety.db"))
        .await
        .is_err());
    assert_eq!(tokio::fs::read(&source_path).await.unwrap(), before);
    assert_current_data(&db).await;
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT title FROM favorites")
            .fetch_one(&db)
            .await
            .unwrap(),
        "收藏"
    );
    assert!(directory.join("safety.db").exists());
    assert_no_staging(&directory).await;
    db.close().await;
    tokio::fs::remove_dir_all(directory).await.unwrap();
}

/// 不兼容身份、迁移记录、字段或损坏文件都不允许触碰当前数据。
#[tokio::test]
async fn invalid_backups_leave_current_data_untouched() {
    let (directory, db) = transfer_database().await;
    for statement in [
        "PRAGMA application_id=123",
        "DELETE FROM _sqlx_migrations",
        "UPDATE _sqlx_migrations SET checksum=X'00'",
        "UPDATE _sqlx_migrations SET success=0",
        "DROP INDEX search_history_searched_at; ALTER TABLE search_history DROP COLUMN searched_at",
        "PRAGMA foreign_keys=OFF; INSERT INTO sources(id,kind,name,url,sort,subscription_id,created_at,updated_at) VALUES('s','vod','源','https://source.test',0,'missing',1,1)",
    ] {
        let source_path = export_fixture(&db, &directory).await;
        let mut source = SqliteConnection::connect_with(&sqlx::sqlite::SqliteConnectOptions::new().filename(&source_path)).await.unwrap();
        sqlx::raw_sql(statement).execute(&mut source).await.unwrap();
        source.close().await.unwrap();
        let before = tokio::fs::read(&source_path).await.unwrap();
        assert!(restore(&db, &source_path, &directory.join("safety.db")).await.is_err(), "{statement}");
        assert_eq!(tokio::fs::read(&source_path).await.unwrap(), before);
        assert!(!directory.join("safety.db").exists());
        assert_current_data(&db).await;
        assert_no_staging(&directory).await;
    }
    let corrupt = directory.join("corrupt.db");
    tokio::fs::write(&corrupt, b"not a database").await.unwrap();
    assert!(restore(&db, &corrupt, &directory.join("safety.db"))
        .await
        .is_err());
    assert_current_data(&db).await;
    assert_no_staging(&directory).await;
    db.close().await;
    tokio::fs::remove_dir_all(directory).await.unwrap();
}
