use super::DataTransfer;
use crate::infrastructure::diagnostics::command_error;
use sqlx::SqlitePool;
use tauri::{Emitter, Manager, State};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClearSelection {
    pub(super) sources: bool,
    pub(super) favorites: bool,
    pub(super) recent: bool,
    pub(super) search_history: bool,
    pub(super) cache: bool,
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
pub(super) async fn clear_selected<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    db: &SqlitePool,
    selection: ClearSelection,
) -> Result<(), String> {
    let mut tx = db
        .begin()
        .await
        .map_err(|error| command_error("无法开始清理", &error))?;
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
                .map_err(|error| command_error("清理数据失败", &error))?;
        }
    }
    if selection.sources {
        sqlx::query(
            "DELETE FROM ui_preferences WHERE scope IN ('iptv','catalog','iptv-selection','subscription')",
        )
        .execute(&mut *tx)
        .await.map_err(|error| command_error("清理源偏好失败", &error))?;
    }
    // cache 是内存清理请求，不向数据库写入缓存状态
    let _ = selection.cache;
    tx.commit()
        .await
        .map_err(|error| command_error("提交数据清理失败", &error))?;
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
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    transfer: State<'_, DataTransfer>,
) -> Result<(), String> {
    let _guard = transfer.0.try_lock().map_err(|_| "已有数据操作正在进行")?;
    let mut tx = db
        .begin()
        .await
        .map_err(|error| command_error("无法开始重置", &error))?;
    sqlx::query("PRAGMA defer_foreign_keys=ON")
        .execute(&mut *tx)
        .await
        .map_err(|error| command_error("无法准备重置", &error))?;
    let tables:Vec<String>=sqlx::query_scalar("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_sqlx_migrations'").fetch_all(&mut *tx).await.map_err(|error| command_error("读取数据表失败", &error))?;
    for table in tables {
        let table = table.replace('"', "\"\"");
        sqlx::query(&format!("DELETE FROM \"{table}\""))
            .execute(&mut *tx)
            .await
            .map_err(|error| command_error("重置数据失败", &error))?;
    }
    sqlx::query("INSERT INTO network_routes(route,mode) VALUES('iptv','direct')")
        .execute(&mut *tx)
        .await
        .map_err(|error| command_error("初始化路由失败", &error))?;
    tx.commit()
        .await
        .map_err(|error| command_error("重置失败，原数据已保留", &error))?;
    // 数据已清空，内存中的直播目录必须失效，否则窗口仍能读到旧频道
    app.state::<crate::modules::iptv::Catalog>().clear().await;
    for name in [
        "app-data-changed",
        "search-history-changed",
        "ui-preferences-changed",
    ] {
        if let Err(error) = app.emit(name, "app-data") {
            log::warn!("重置通知失败：{error}");
        }
    }
    Ok(())
}
