use serde::Serialize;
use sqlx::{Connection, SqliteConnection, SqlitePool};
use std::path::Path;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

/// 串行执行数据库文件操作，避免多个窗口同时恢复
#[derive(Default)]
pub struct DataTransfer(pub tokio::sync::Mutex<()>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferResult {
    cancelled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    safety_backup_path: Option<String>,
}

/// 生成取消结果，不改变当前数据
fn cancelled() -> TransferResult {
    TransferResult {
        cancelled: true,
        file_path: None,
        safety_backup_path: None,
    }
}

/// 用 SQLite 一致性快照生成不依赖 WAL 文件的独立数据库
async fn snapshot(connection: &mut SqliteConnection, path: &Path) -> Result<(), String> {
    let path = path.to_str().ok_or("文件路径编码无效")?;
    sqlx::query("VACUUM main INTO ?")
        .bind(path)
        .execute(connection)
        .await
        .map_err(|_| "创建数据库快照失败")?;
    let file = tokio::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .await
        .map_err(|_| "无法打开备份文件")?;
    file.sync_all().await.map_err(|_| "备份写入磁盘失败")?;
    Ok(())
}

/// 校验应用标识、全部结构、迁移记录与数据完整性
async fn validate_attached(connection: &mut SqliteConnection) -> Result<(), String> {
    let application_id: i64 = sqlx::query_scalar("PRAGMA incoming.application_id")
        .fetch_one(&mut *connection)
        .await
        .map_err(|_| "无法读取数据库标识")?;
    if application_id != 1447441494 {
        return Err("此文件不是 Vfan TV 数据库".into());
    }
    let integrity: Vec<String> = sqlx::query_scalar("PRAGMA incoming.integrity_check")
        .fetch_all(&mut *connection)
        .await
        .map_err(|_| "数据库完整性检查失败")?;
    if integrity != ["ok"] {
        return Err("备份数据库已损坏".into());
    }
    let current: Vec<(String,String,Option<String>)> = sqlx::query_as("SELECT type,name,sql FROM main.sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetch_all(&mut *connection).await.map_err(|_| "读取当前数据库结构失败")?;
    let incoming: Vec<(String,String,Option<String>)> = sqlx::query_as("SELECT type,name,sql FROM incoming.sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetch_all(&mut *connection).await.map_err(|_| "读取备份结构失败")?;
    if current != incoming {
        return Err("备份数据库结构与当前版本不匹配".into());
    }
    let current: Vec<(i64, bool, Vec<u8>)> = sqlx::query_as(
        "SELECT version,success,checksum FROM main._sqlx_migrations ORDER BY version",
    )
    .fetch_all(&mut *connection)
    .await
    .map_err(|_| "读取当前结构版本失败")?;
    let incoming: Vec<(i64, bool, Vec<u8>)> = sqlx::query_as(
        "SELECT version,success,checksum FROM incoming._sqlx_migrations ORDER BY version",
    )
    .fetch_all(&mut *connection)
    .await
    .map_err(|_| "读取备份结构版本失败")?;
    if current != incoming || incoming.iter().any(|(_, success, _)| !success) {
        return Err("备份迁移版本与当前应用不匹配".into());
    }
    if !sqlx::query("PRAGMA incoming.foreign_key_check")
        .fetch_all(&mut *connection)
        .await
        .map_err(|_| "检查备份关联数据失败")?
        .is_empty()
    {
        return Err("备份数据库存在无效的关联数据".into());
    }
    Ok(())
}

/// 在单一事务内恢复所有业务表，任一步失败都回滚，保留当前数据库连接
async fn restore(db: &SqlitePool, incoming: &Path, safety: &Path) -> Result<(), String> {
    let mut connection = db.acquire().await.map_err(|_| "数据库当前不可用")?;
    let result = async {
        sqlx::query("ATTACH DATABASE ? AS incoming").bind(incoming.to_str().ok_or("备份路径编码无效")?).execute(&mut *connection).await.map_err(|_| "无法打开备份数据库")?;
        validate_attached(&mut connection).await?;
        snapshot(&mut connection,safety).await?;
        let mut tx = connection.begin().await.map_err(|_| "无法开始数据库恢复")?;
        sqlx::query("PRAGMA defer_foreign_keys=ON").execute(&mut *tx).await.map_err(|_| "无法准备数据库恢复")?;
        let tables: Vec<String> = sqlx::query_scalar("SELECT name FROM main.sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_sqlx_migrations' ORDER BY name").fetch_all(&mut *tx).await.map_err(|_| "读取恢复表失败")?;
        // 表名来自已验证一致的应用结构，双引号转义避免动态标识符影响 SQL
        for table in &tables {
            let table = table.replace('"',"\"\"");
            sqlx::query(&format!("DELETE FROM main.\"{table}\"")).execute(&mut *tx).await.map_err(|_| "清理恢复目标失败")?;
        }
        for table in &tables {
            let table = table.replace('"',"\"\"");
            sqlx::query(&format!("INSERT INTO main.\"{table}\" SELECT * FROM incoming.\"{table}\"")).execute(&mut *tx).await.map_err(|_| "写入恢复数据失败")?;
        }
        tx.commit().await.map_err(|_| "恢复提交失败，原数据已保留")?;
        Ok(())
    }.await;
    // 专用连接关闭时自动释放附加库，失败路径也不会污染连接池
    connection.close().await.map_err(|_| "关闭恢复连接失败")?;
    result
}

/// 选择目标文件并导出完整数据库，不覆盖正在使用的数据库
#[tauri::command]
pub async fn export_database(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    transfer: State<'_, DataTransfer>,
) -> Result<TransferResult, String> {
    let _guard = transfer.0.try_lock().map_err(|_| "已有数据操作正在进行")?;
    let dialog_app = app.clone();
    let file = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .add_filter("SQLite", &["db"])
            .set_file_name(crate::infrastructure::database::FILE_NAME)
            .blocking_save_file()
    })
    .await
    .map_err(|_| "打开保存对话框失败")?;
    let Some(file) = file else {
        return Ok(cancelled());
    };
    let path = file.into_path().map_err(|_| "请选择本地文件")?;
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "无法定位数据目录")?
        .join("data");
    let parent = path.parent().ok_or("备份路径无效")?;
    if tokio::fs::canonicalize(parent)
        .await
        .map_err(|_| "备份目录不存在")?
        == tokio::fs::canonicalize(&data_dir)
            .await
            .map_err(|_| "数据目录不存在")?
    {
        return Err("请选择应用数据目录以外的位置".into());
    }
    let temporary = parent.join(format!(".vfan-export-{}.db", Uuid::new_v4()));
    let result = async {
        let mut connection = db.acquire().await.map_err(|_| "数据库不可用")?;
        snapshot(&mut connection, &temporary).await?;
        tokio::fs::rename(&temporary, &path)
            .await
            .map_err(|_| "保存备份文件失败")?;
        Ok(TransferResult {
            cancelled: false,
            file_path: Some(path.to_string_lossy().into()),
            safety_backup_path: None,
        })
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
    }
    result
}

/// 将用户选中的库冻结为快照，验证并恢复，返回恢复前的安全备份位置
#[tauri::command]
pub async fn import_database(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    transfer: State<'_, DataTransfer>,
) -> Result<TransferResult, String> {
    let _guard = transfer.0.try_lock().map_err(|_| "已有数据操作正在进行")?;
    let file = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("SQLite", &["db"])
            .blocking_pick_file()
    })
    .await
    .map_err(|_| "打开文件对话框失败")?;
    let Some(file) = file else {
        return Ok(cancelled());
    };
    let path = file.into_path().map_err(|_| "请选择本地文件")?;
    let data_path: String = sqlx::query_as::<_, (i64, String, String)>("PRAGMA database_list")
        .fetch_all(db.inner())
        .await
        .map_err(|_| "无法定位数据库")?
        .into_iter()
        .find(|(_, name, _)| name == "main")
        .ok_or("找不到应用数据库")?
        .2;
    let directory = Path::new(&data_path).parent().ok_or("数据目录无效")?;
    let staged = directory.join(format!(".restore-{}.db", Uuid::new_v4()));
    let safety = directory.join(format!("before-restore-{}.db", Uuid::new_v4()));
    let result = async {
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .read_only(true)
            .pragma("trusted_schema", "OFF");
        let mut source = SqliteConnection::connect_with(&options)
            .await
            .map_err(|_| "无法读取所选数据库")?;
        let id: i64 = sqlx::query_scalar("PRAGMA application_id")
            .fetch_one(&mut source)
            .await
            .map_err(|_| "无效数据库文件")?;
        if id != 1447441494 {
            return Err("此文件不是 Vfan TV 数据库".to_owned());
        }
        snapshot(&mut source, &staged).await?;
        source.close().await.map_err(|_| "关闭源数据库失败")?;
        restore(&db, &staged, &safety).await?;
        Ok(TransferResult {
            cancelled: false,
            file_path: Some(path.to_string_lossy().into()),
            safety_backup_path: Some(safety.to_string_lossy().into()),
        })
    }
    .await;
    let _ = tokio::fs::remove_file(&staged).await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

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
        sqlx::query("INSERT INTO ui_preferences VALUES('appearance','theme','\"dark\"',1),('iptv','selectedSource','\"source\"',1)").execute(&db).await.unwrap();
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
        sqlx::query("INSERT INTO subscriptions VALUES('first','https://first.test/',0)")
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
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClearSelection {
    sources: bool,
    favorites: bool,
    recent: bool,
    search_history: bool,
    cache: bool,
}

/// 按用户选择原子清理数据，运行时缓存由前端刷新释放
#[tauri::command]
pub async fn clear_app_data(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    transfer: State<'_, DataTransfer>,
    selection: ClearSelection,
) -> Result<(), String> {
    let _guard = transfer.0.try_lock().map_err(|_| "已有数据操作正在进行")?;
    clear_selected(&app, &db, selection).await
}

/// 提交数据清理后通知所有窗口刷新数据、搜索历史和偏好
async fn clear_selected<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    db: &SqlitePool,
    selection: ClearSelection,
) -> Result<(), String> {
    let mut tx = db.begin().await.map_err(|_| "无法开始清理")?;
    for (selected, table) in [
        (selection.sources, "sources"),
        (selection.sources, "subscriptions"),
        (selection.favorites, "favorites"),
        (selection.recent, "recent_plays"),
        (selection.search_history, "search_history"),
    ] {
        if selected {
            sqlx::query(&format!("DELETE FROM {table}"))
                .execute(&mut *tx)
                .await
                .map_err(|_| "清理数据失败")?;
        }
    }
    if selection.sources {
        sqlx::query(
            "DELETE FROM ui_preferences WHERE scope IN ('iptv','catalog','iptv-selection')",
        )
        .execute(&mut *tx)
        .await
        .map_err(|_| "清理源偏好失败")?;
        sqlx::query("DELETE FROM app_settings WHERE key='activeSubscriptionId'")
            .execute(&mut *tx)
            .await
            .map_err(|_| "清理订阅设置失败")?;
    }
    // cache 是内存清理请求，不向数据库写入缓存状态
    let _ = selection.cache;
    tx.commit().await.map_err(|_| "提交数据清理失败")?;
    if selection.cache || selection.sources {
        app.state::<crate::modules::iptv::Catalog>().clear().await;
    }
    if let Err(error) = app.emit("app-data-changed", "app-data") {
        log::warn!("数据清理通知失败：{error}");
    }
    if selection.search_history {
        if let Err(error) = app.emit("search-history-changed", ()) {
            log::warn!("搜索历史清理通知失败：{error}");
        }
    }
    if selection.sources {
        if let Err(error) = app.emit("ui-preferences-changed", ()) {
            log::warn!("源偏好清理通知失败：{error}");
        }
    }
    Ok(())
}

/// 在事务中恢复初始数据库内容，保留迁移记录和数据结构
#[tauri::command]
pub async fn restore_factory_settings(
    db: State<'_, SqlitePool>,
    transfer: State<'_, DataTransfer>,
) -> Result<(), String> {
    let _guard = transfer.0.try_lock().map_err(|_| "已有数据操作正在进行")?;
    let mut tx = db.begin().await.map_err(|_| "无法开始重置")?;
    sqlx::query("PRAGMA defer_foreign_keys=ON")
        .execute(&mut *tx)
        .await
        .map_err(|_| "无法准备重置")?;
    let tables:Vec<String>=sqlx::query_scalar("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_sqlx_migrations'").fetch_all(&mut *tx).await.map_err(|_| "读取数据表失败")?;
    for table in tables {
        let table = table.replace('"', "\"\"");
        sqlx::query(&format!("DELETE FROM \"{table}\""))
            .execute(&mut *tx)
            .await
            .map_err(|_| "重置数据失败")?;
    }
    sqlx::query("INSERT INTO network_routes(route,mode) VALUES('iptv','direct')")
        .execute(&mut *tx)
        .await
        .map_err(|_| "初始化路由失败")?;
    tx.commit().await.map_err(|_| "重置失败，原数据已保留")?;
    Ok(())
}
