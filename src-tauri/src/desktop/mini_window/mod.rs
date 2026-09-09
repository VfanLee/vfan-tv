mod types;
use types::{initial_exit, resize_bounds, validate_exit, Move, Resize};

use crate::infrastructure::media::{self, proxy::MediaProxy};
use serde_json::Value;
use std::collections::HashSet;
use tauri::{
    Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct MiniWindow(Mutex<Option<Active>>);
struct Active {
    label: String,
    context: Value,
    exit: Value,
    ready: bool,
    media: HashSet<String>,
}

/// 检查调用窗口与当前小窗标识，隔离过期窗口事件
fn current<'a>(
    active: &'a mut Option<Active>,
    window: &WebviewWindow,
    id: &str,
) -> Result<&'a mut Active, String> {
    active
        .as_mut()
        .filter(|a| a.label == window.label() && a.context["sessionId"] == id)
        .ok_or("小窗播放已结束".into())
}

/// 回收小窗拥有的会话并恢复主窗口，重复关闭不会重复释放
pub async fn finish(app: &tauri::AppHandle, label: &str, pending_only: bool) {
    let state = app.state::<MiniWindow>();
    let mut guard = state.0.lock().await;
    if !guard
        .as_ref()
        .is_some_and(|a| a.label == label && (!pending_only || !a.ready))
    {
        return;
    }
    let active = guard.take().expect("checked active window");
    // 关闭阶段保持锁，防止新小窗与旧窗口的恢复动作交错
    if let Some(window) = app.get_webview_window(label) {
        if let Err(error) = window.destroy() {
            log::warn!("关闭小窗失败：{error}");
        }
    }
    for id in active.media {
        let _ = media::release_media_session(app.state::<MediaProxy>(), id).await;
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
        let _ = main.emit("mini-window-mode-exit", active.exit);
    }
}

/// 创建隐藏的小窗，由页面初始化完成后显示；失败时主窗口仍可使用
#[tauri::command]
pub async fn enter_mini_window_mode(
    app: tauri::AppHandle,
    window: WebviewWindow,
    context: Value,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("仅主窗口可以进入小窗播放".into());
    }
    if context.to_string().len() > 32768 {
        return Err("小窗上下文过大".into());
    }
    let exit = initial_exit(&context)?;
    let state = app.state::<MiniWindow>();
    let mut guard = state.0.lock().await;
    if guard.is_some() {
        return Err("已有小窗正在播放".into());
    }
    let mut media = HashSet::new();
    if let Some(id) = context["mediaSessionId"]
        .as_str()
        .filter(|_| context["variant"] != "radio")
    {
        let proxy = app.state::<MediaProxy>();
        let sessions = proxy.sessions.read().await;
        let session = sessions.get(id).ok_or("播放会话已失效")?;
        let prefix = format!("{}/media/{id}/", proxy.base_url);
        let resource = context["src"]
            .as_str()
            .and_then(|src| src.strip_prefix(&prefix));
        if !resource.is_some_and(|token| session.resources.contains_key(token)) {
            return Err("小窗播放地址与会话不匹配".into());
        }
        drop(sessions);
        media::retain_media_session(proxy, id.into()).await?;
        media.insert(id.to_owned());
    }
    let label = format!("mini-{}", uuid::Uuid::new_v4());
    let radio = context["variant"] == "radio";
    let (width, height) = if radio { (184.0, 44.0) } else { (360.0, 240.0) };
    let mut builder = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App("index.html#/mini-window".into()),
    )
    .title("Vfan TV 小窗")
    .inner_size(width, height)
    .visible(false)
    .decorations(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(!cfg!(target_os = "macos"))
    .transparent(radio);
    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let x = f64::from(area.position.x) / scale;
        let y = f64::from(area.position.y) / scale;
        builder = builder.position(
            x + (f64::from(area.size.width) / scale - width - 16.0).max(0.0),
            y + (f64::from(area.size.height) / scale - height - 16.0).max(0.0),
        );
    }
    match builder.build() {
        Ok(_) => {
            *guard = Some(Active {
                label: label.clone(),
                context,
                exit,
                ready: false,
                media,
            });
            drop(guard);
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(20)).await;
                let state = app.state::<MiniWindow>();
                let timed_out = state
                    .0
                    .lock()
                    .await
                    .as_ref()
                    .is_some_and(|a| a.label == label && !a.ready);
                if timed_out {
                    finish(&app, &label, true).await;
                }
            });
            Ok(())
        }
        Err(error) => {
            for id in media {
                let _ = media::release_media_session(app.state::<MediaProxy>(), id).await;
            }
            Err(format!("创建小窗失败：{error}"))
        }
    }
}

/// 仅向当前小窗提供其播放上下文
#[tauri::command]
pub async fn get_mini_window_playback(
    state: State<'_, MiniWindow>,
    window: WebviewWindow,
) -> Result<Value, String> {
    let active = state.0.lock().await;
    active
        .as_ref()
        .filter(|a| a.label == window.label())
        .map(|a| a.context.clone())
        .ok_or("小窗播放已结束".into())
}

/// 页面已收到上下文后显示小窗，再隐藏主窗口
#[tauri::command]
pub async fn ready_mini_window(
    app: tauri::AppHandle,
    state: State<'_, MiniWindow>,
    window: WebviewWindow,
    session_id: String,
) -> Result<(), String> {
    let mut guard = state.0.lock().await;
    let active = current(&mut guard, &window, &session_id)?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    if let Some(main) = app.get_webview_window("main") {
        main.hide().map_err(|e| e.to_string())?;
    }
    active.ready = true;
    Ok(())
}

/// 保存小窗进度供退出或意外关闭时恢复
#[tauri::command]
pub async fn update_mini_window_playback(
    state: State<'_, MiniWindow>,
    window: WebviewWindow,
    input: Value,
) -> Result<(), String> {
    let mut guard = state.0.lock().await;
    let active = current(
        &mut guard,
        &window,
        input["sessionId"].as_str().ok_or("小窗标识无效")?,
    )?;
    validate_exit(&active.context, &input)?;
    active.exit = input;
    Ok(())
}

/// 保存最终进度并关闭小窗
#[tauri::command]
pub async fn exit_mini_window_mode(
    app: tauri::AppHandle,
    state: State<'_, MiniWindow>,
    window: WebviewWindow,
    input: Value,
) -> Result<(), String> {
    update_mini_window_playback(state, window.clone(), input).await?;
    finish(&app, window.label(), false).await;
    Ok(())
}

/// 按逻辑像素移动当前小窗，适配高分辨率屏幕
#[tauri::command]
pub async fn move_mini_window(
    state: State<'_, MiniWindow>,
    window: WebviewWindow,
    input: Move,
) -> Result<(), String> {
    let mut guard = state.0.lock().await;
    current(&mut guard, &window, &input.session_id)?;
    if ![input.position.x, input.position.y]
        .into_iter()
        .all(|v| v.is_finite() && v.abs() < 1e7)
    {
        return Err("小窗位置无效".into());
    }
    window
        .set_position(LogicalPosition::new(
            input.position.x.round(),
            input.position.y.round(),
        ))
        .map_err(|e| e.to_string())
}

/// 按比例调整当前小窗的位置和尺寸
#[tauri::command]
pub async fn resize_mini_window(
    state: State<'_, MiniWindow>,
    window: WebviewWindow,
    input: Resize,
) -> Result<(), String> {
    let mut guard = state.0.lock().await;
    let active = current(&mut guard, &window, &input.session_id)?;
    let b = resize_bounds(&input, active.context["variant"] == "radio")?;
    window
        .set_size(LogicalSize::new(b.width, b.height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(LogicalPosition::new(b.x, b.y))
        .map_err(|e| e.to_string())
}

/// 隐藏小窗并保留播放，可从系统应用入口重新显示
#[tauri::command]
pub async fn hide_mini_window(
    state: State<'_, MiniWindow>,
    window: WebviewWindow,
    session_id: String,
) -> Result<(), String> {
    let mut guard = state.0.lock().await;
    current(&mut guard, &window, &session_id)?;
    #[cfg(target_os = "macos")]
    let result = window.hide();
    #[cfg(not(target_os = "macos"))]
    let result = window.minimize();
    result.map_err(|e| e.to_string())
}

/// 读取小窗置顶状态
#[tauri::command]
pub async fn get_mini_window_always_on_top(
    state: State<'_, MiniWindow>,
    window: WebviewWindow,
    session_id: String,
) -> Result<bool, String> {
    let mut guard = state.0.lock().await;
    current(&mut guard, &window, &session_id)?;
    window.is_always_on_top().map_err(|e| e.to_string())
}

/// 更新小窗置顶状态
#[tauri::command]
pub async fn set_mini_window_always_on_top(
    state: State<'_, MiniWindow>,
    window: WebviewWindow,
    session_id: String,
    enabled: bool,
) -> Result<bool, String> {
    let mut guard = state.0.lock().await;
    current(&mut guard, &window, &session_id)?;
    window
        .set_always_on_top(enabled)
        .map_err(|e| e.to_string())?;
    window.is_always_on_top().map_err(|e| e.to_string())
}

/// 记录小窗电台拥有的会话，在页面异常关闭时兜底释放
pub async fn track_radio(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
    id: &str,
) -> Result<(), String> {
    let state = app.state::<MiniWindow>();
    let mut guard = state.0.lock().await;
    if let Some(active) = guard.as_mut().filter(|a| a.label == window.label()) {
        let proxy = app.state::<MediaProxy>();
        let sessions = proxy.sessions.read().await;
        active.media.retain(|id| sessions.contains_key(id));
        active.media.insert(id.into());
    } else if window.label().starts_with("mini-") {
        media::release_media_session(app.state::<MediaProxy>(), id.into()).await?;
        return Err("小窗播放已结束".into());
    }
    Ok(())
}

/// 系统应用入口重新激活时优先恢复当前小窗
pub async fn reopen(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<MiniWindow>() else {
        return;
    };
    let guard = state.0.lock().await;
    let label = guard
        .as_ref()
        .filter(|a| a.ready)
        .map_or("main", |a| a.label.as_str());
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 主窗口销毁时关闭其小窗，否则回收指定小窗
pub async fn window_destroyed(app: &tauri::AppHandle, label: &str) {
    let target = if label == "main" {
        app.state::<MiniWindow>()
            .0
            .lock()
            .await
            .as_ref()
            .map(|a| a.label.clone())
    } else {
        Some(label.into())
    };
    if let Some(target) = target {
        finish(app, &target, false).await;
    }
}
