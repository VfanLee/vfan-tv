use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct Updates {
    pending: Mutex<Pending>,
    snapshot: std::sync::Mutex<Option<Value>>,
}
#[derive(Default)]
struct Pending {
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
    result: Option<Value>,
}

/// 将平台架构转换为现有界面使用的名称
fn platform() -> (&'static str, &'static str) {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    };
    (os, arch)
}

/// 读取构建配置中的公钥，缺少签名配置时禁止自动安装
fn configured(app: &tauri::AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|v| v["pubkey"].as_str())
        .is_some_and(|v| !v.trim().is_empty())
}

/// 生成更新界面的状态数据，仅使用 Tauri 更新包
fn result(current: &str, update: Option<&Update>, signed: bool) -> Value {
    let (platform, arch) = platform();
    let version = update.map_or(current, |u| u.version.as_str());
    let mut value = json!({"arch":arch,"platform":platform,"currentVersion":current,"latestVersion":version,"canAutoUpdate":signed && update.is_some(),"updateAvailable":update.is_some(),"status":if update.is_some(){"available"}else{"not-available"},"releaseName":format!("Vfan TV {version}"),"releaseNotes":update.and_then(|u|u.body.as_deref()).unwrap_or("此版本暂无更新说明。"),"releaseUrl":format!("https://github.com/vfanlee/vfan-tv/releases/tag/v{version}")});
    if !signed {
        value["autoUpdateError"] = "当前构建未配置更新签名公钥，请从发布页面手动安装。".into();
    }
    value
}

/// 广播更新状态给主窗口与设置窗口
fn emit(app: &tauri::AppHandle, mut value: Value) {
    if let Some(state) = app.try_state::<Updates>() {
        if let Ok(mut snapshot) = state.snapshot.lock() {
            let revision = snapshot
                .as_ref()
                .and_then(|s| s["revision"].as_u64())
                .unwrap_or(0)
                + 1;
            value["revision"] = revision.into();
            *snapshot = Some(value.clone());
            if let Err(error) = app.emit("app-update", value) {
                log::warn!("更新状态通知失败：{error}");
            }
        }
    }
}

/// 为新打开的设置窗口提供当前更新状态
#[tauri::command]
pub fn get_update_snapshot(state: State<'_, Updates>) -> Result<Option<Value>, String> {
    state
        .snapshot
        .lock()
        .map(|value| value.clone())
        .map_err(|_| "读取更新状态失败".into())
}

/// 将失败通知到所有订阅者，同时保留日志用于排错
fn failure(app: &tauri::AppHandle, message: String) -> String {
    log::warn!("应用更新失败：{message}");
    emit(app, json!({"status":"error","message":message}));
    message
}

/// 检查专用 Tauri 更新清单；未发布清单时返回明确错误
#[tauri::command]
pub async fn check_for_updates(
    app: tauri::AppHandle,
    state: State<'_, Updates>,
) -> Result<Value, String> {
    let mut pending = state.pending.try_lock().map_err(|_| "更新任务正在进行")?;
    // 已下载的包保留到用户安装，避免其他窗口检查时清掉它
    if pending.bytes.is_some() {
        let value = pending.result.clone().ok_or("更新状态无效")?;
        emit(&app, json!({"status":"downloaded","result":value}));
        return Ok(value);
    }
    emit(&app, json!({"status":"checking"}));
    let checked = async {
        app.updater_builder()
            .timeout(Duration::from_secs(15))
            .on_before_exit(|| log::logger().flush())
            .build()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())
    }
    .await;
    match checked {
        Ok(update) => {
            let value = result(
                &app.package_info().version.to_string(),
                update.as_ref(),
                configured(&app),
            );
            pending.update = update;
            pending.result = Some(value.clone());
            emit(&app, json!({"status":value["status"],"result":value}));
            Ok(value)
        }
        Err(error) => {
            pending.update = None;
            pending.result = None;
            Err(failure(&app, format!("无法检查 Tauri 更新：{error}")))
        }
    }
}

/// 下载并验签，只有完整通过验证的字节才能保存为待安装状态
#[tauri::command]
pub async fn download_update(
    app: tauri::AppHandle,
    state: State<'_, Updates>,
) -> Result<(), String> {
    let mut pending = state.pending.try_lock().map_err(|_| "更新任务正在进行")?;
    if !configured(&app) {
        return Err(failure(&app, "当前构建未配置更新签名公钥".into()));
    }
    if pending.bytes.is_some() {
        emit(&app, json!({"status":"downloaded","result":pending.result}));
        return Ok(());
    }
    let mut update = pending.update.clone().ok_or("请先检查可用更新")?;
    update.timeout = Some(Duration::from_secs(600));
    emit(
        &app,
        json!({"status":"download-progress","progress":{"transferred":0,"total":0,"percent":0,"bytesPerSecond":0}}),
    );
    let started = Instant::now();
    let mut last = Instant::now() - Duration::from_secs(1);
    let mut transferred = 0u64;
    let downloaded = update.download(|size,total| {
        transferred = transferred.saturating_add(size as u64);
        if last.elapsed() < Duration::from_millis(200) { return; }
        last = Instant::now();
        emit(&app,json!({"status":"download-progress","progress":{"transferred":transferred,"total":total.unwrap_or(0),"percent":total.filter(|v|*v>0).map_or(0.0,|v|(transferred as f64/v as f64*100.0).min(100.0)),"bytesPerSecond":transferred as f64/started.elapsed().as_secs_f64().max(0.001)}}));
    },||{}).await;
    match downloaded {
        Ok(bytes) => {
            pending.bytes = Some(bytes);
            emit(&app, json!({"status":"downloaded","result":pending.result}));
            Ok(())
        }
        Err(error) => Err(failure(&app, format!("下载或验证更新失败：{error}"))),
    }
}

/// 安装已验证的更新；安装失败保留包供重试，成功后重启
#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    state: State<'_, Updates>,
) -> Result<(), String> {
    let mut pending = state.pending.try_lock().map_err(|_| "更新任务正在进行")?;
    let update = pending.update.clone().ok_or("请先检查更新")?;
    let bytes = pending.bytes.take().ok_or("请先下载并验证更新")?;
    let installed = tauri::async_runtime::spawn_blocking(move || {
        let result = update.install(&bytes).map_err(|e| e.to_string());
        (bytes, result)
    })
    .await
    .map_err(|_| failure(&app, "安装更新任务失败".into()))?;
    let (bytes, result) = installed;
    if let Err(error) = result {
        pending.bytes = Some(bytes);
        return Err(failure(&app, format!("安装更新失败：{error}")));
    }
    drop(pending);
    crate::desktop::windows::restart_app(app.clone(), app.state::<sqlx::SqlitePool>()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    /// 无新版本时不显示安装按钮，也不生成旧版安装包地址
    #[test]
    fn describes_current_release_without_installer() {
        let value = result("0.11.1", None, false);
        assert_eq!(value["updateAvailable"], false);
        assert_eq!(value["canAutoUpdate"], false);
        assert_eq!(value["latestVersion"], "0.11.1");
        assert!(value["manualDownloadUrl"].is_null());
        assert!(value["autoUpdateError"].is_string());
    }
    /// 模拟更新清单与下载，确认官方插件拒绝未通过签名验证的包
    #[tokio::test]
    async fn rejects_untrusted_update_package() {
        use axum::{routing::get, Json, Router};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let url = format!("http://{address}/package");
        let router=Router::new()
            .route("/manifest",get(move || {let url=url.clone();async move {Json(json!({"version":"99.0.0","url":url,"signature":"invalid","notes":"测试更新"}))}}))
            .route("/package",get(||async {"not a signed installer"}));
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert("updater".into(),json!({"pubkey":"invalid","dangerousInsecureTransportProtocol":true,"endpoints":[format!("http://{address}/manifest")]}));
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        let update = app
            .updater_builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap()
            .check()
            .await
            .unwrap()
            .unwrap();
        assert_eq!(update.version, "99.0.0");
        assert_eq!(
            result("0.11.1", Some(&update), false)["canAutoUpdate"],
            false
        );
        assert!(update.download(|_, _| {}, || {}).await.is_err());
        server.abort();
        let _ = server.await;
    }
}
