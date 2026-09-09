use sqlx::SqlitePool;
use tauri::{Emitter, State};

/// 读取搜索历史，最新搜索排在前面
#[tauri::command]
pub async fn list_search_history(db: State<'_, SqlitePool>) -> Result<Vec<String>, String> {
    sqlx::query_scalar("SELECT keyword FROM search_history ORDER BY searched_at DESC,keyword")
        .fetch_all(db.inner())
        .await
        .map_err(|_| "读取搜索历史失败".into())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HistoryAction {
    Add,
    Remove,
    Clear,
}

/// 按条目更新搜索历史，避免跨窗口覆盖整个列表
#[tauri::command]
pub async fn change_search_history(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    action: HistoryAction,
    keyword: Option<String>,
) -> Result<(), String> {
    match action {
        HistoryAction::Clear => {
            sqlx::query("DELETE FROM search_history")
                .execute(db.inner())
                .await
                .map_err(|_| "清理历史失败")?;
        }
        action => {
            let keyword = keyword.ok_or("缺少搜索词")?.trim().to_owned();
            if keyword.is_empty() || keyword.chars().count() > 1000 {
                return Err("搜索词长度无效".into());
            }
            let query=match action {HistoryAction::Add => "INSERT INTO search_history(keyword,searched_at) VALUES(?,CAST(unixepoch('subsec')*1000 AS INTEGER)) ON CONFLICT(keyword) DO UPDATE SET searched_at=excluded.searched_at", _ => "DELETE FROM search_history WHERE keyword=?"};
            sqlx::query(query)
                .bind(keyword)
                .execute(db.inner())
                .await
                .map_err(|_| "保存搜索历史失败")?;
        }
    }
    if let Err(error) = app.emit("search-history-changed", ()) {
        log::warn!("历史通知失败: {error}");
    }
    Ok(())
}
