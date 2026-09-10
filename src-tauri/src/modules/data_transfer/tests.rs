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
