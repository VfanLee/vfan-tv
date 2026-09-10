use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

/// 打开设置窗口，已存在时通过路由通知切换分区
#[tauri::command]
pub async fn open_settings_window(
    app: tauri::AppHandle,
    section: Option<String>,
) -> Result<(), String> {
    let section = section.unwrap_or_else(|| "appearance".to_owned());
    if !matches!(
        section.as_str(),
        "appearance" | "subscriptions" | "vod-sources" | "iptv" | "data-management" | "about"
    ) {
        return Err("未知设置分区".to_owned());
    }
    if let Some(window) = app.get_webview_window("settings") {
        window
            .emit("settings-section-changed", &section)
            .map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        window.unminimize().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        WebviewWindowBuilder::new(
            &app,
            "settings",
            WebviewUrl::App(format!("index.html#/settings?section={section}").into()),
        )
        .title("设置 - Vfan TV")
        .inner_size(1080.0, 760.0)
        .min_inner_size(860.0, 600.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 读取调用窗口的最大化状态
#[tauri::command]
pub fn is_window_maximized(window: WebviewWindow) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

/// 切换调用窗口的最大化状态
#[tauri::command]
pub fn toggle_window_maximize(window: WebviewWindow) -> Result<bool, String> {
    let maximized = window.is_maximized().map_err(|e| e.to_string())?;
    if maximized {
        window.unmaximize()
    } else {
        window.maximize()
    }
    .map_err(|e| e.to_string())?;
    Ok(!maximized)
}

/// 关闭连接后退出应用
#[tauri::command]
pub async fn quit_app(
    app: tauri::AppHandle,
    db: tauri::State<'_, sqlx::SqlitePool>,
) -> Result<(), String> {
    app.state::<crate::infrastructure::media::proxy::MediaProxy>()
        .stop()
        .await;
    db.close().await;
    log::logger().flush();
    app.exit(0);
    Ok(())
}

/// 关闭连接后重启应用
#[tauri::command]
pub async fn restart_app(
    app: tauri::AppHandle,
    db: tauri::State<'_, sqlx::SqlitePool>,
) -> Result<(), String> {
    app.state::<crate::infrastructure::media::proxy::MediaProxy>()
        .stop()
        .await;
    db.close().await;
    log::logger().flush();
    app.restart();
}

/// 响应用户操作，在默认浏览器打开 HTTP/HTTPS 链接
#[tauri::command]
pub async fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let url = crate::infrastructure::network::parse_http_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        app.opener()
            .open_url(url.as_str(), None::<&str>)
            .map_err(|error| {
                crate::infrastructure::diagnostics::command_error("无法打开浏览器", &error)
            })
    })
    .await
    .map_err(|_| "打开浏览器任务失败")?
}
