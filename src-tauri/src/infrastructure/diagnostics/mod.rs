mod redact;

use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::UNIX_EPOCH,
};
use tauri::{Manager, Runtime, State};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use tauri_plugin_opener::OpenerExt;

const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024;
type Logger = Arc<Mutex<Option<Box<dyn log::Log>>>>;

#[derive(Clone)]
pub struct Diagnostics {
    directory: PathBuf,
    logger: Logger,
}
struct ManagedLogger(Logger);

impl log::Log for ManagedLogger {
    /// 根据当前日志实例判断日志级别
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        self.0
            .lock()
            .ok()
            .and_then(|logger| logger.as_ref().map(|logger| logger.enabled(metadata)))
            .unwrap_or(false)
    }
    /// 将写入与日志清理串行，轮转和落盘由官方插件处理
    fn log(&self, record: &log::Record<'_>) {
        if let Ok(logger) = self.0.lock() {
            if let Some(logger) = logger.as_ref() {
                logger.log(record);
            }
        }
    }
    /// 刷出日志缓冲区
    fn flush(&self) {
        if let Ok(logger) = self.0.lock() {
            if let Some(logger) = logger.as_ref() {
                logger.flush();
            }
        }
    }
}

/// 记录底层错误链并返回稳定的用户提示，日志继续经过统一脱敏
#[track_caller]
pub(crate) fn command_error(context: &str, error: &(impl std::error::Error + ?Sized)) -> String {
    let mut detail = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        detail.push_str(": ");
        detail.push_str(&cause.to_string());
        source = cause.source();
    }
    log::error!("{context} [{}]: {detail}", std::panic::Location::caller());
    context.to_owned()
}

/// 配置日志轮转和统一脱敏，保留当前文件及一个历史文件
fn builder(directory: &Path) -> tauri_plugin_log::Builder {
    tauri_plugin_log::Builder::new()
        .level(log::LevelFilter::Info)
        .level_for("sqlx", log::LevelFilter::Warn)
        .level_for("reqwest", log::LevelFilter::Warn)
        .level_for("hyper", log::LevelFilter::Warn)
        .max_file_size(u128::from(MAX_FILE_SIZE))
        .rotation_strategy(RotationStrategy::KeepSome(1))
        .targets([
            Target::new(TargetKind::Stderr),
            Target::new(TargetKind::Folder {
                path: directory.into(),
                file_name: Some("main".into()),
            }),
        ])
        .format(|out, message, record| {
            let timestamp = tauri_plugin_log::TimezoneStrategy::UseLocal.get_now();
            out.finish(format_args!(
                "[{timestamp}][{}][{}] {}",
                record.level(),
                redact::text(record.target()),
                redact::text(&message.to_string())
            ));
        })
}

/// 安装官方日志命令和可安全重开的文件日志实例
pub fn initialize(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let directory = app.path().app_local_data_dir()?.join("logs");
    let (plugin, level, logger) = builder(&directory).split(app)?;
    let logger = Arc::new(Mutex::new(Some(logger)));
    tauri_plugin_log::attach_logger(level, Box::new(ManagedLogger(logger.clone())))?;
    app.plugin(plugin)?;
    app.manage(Diagnostics { directory, logger });
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!(target:"panic", "{info}");
        log::logger().flush();
        previous(info);
    }));
    log::info!("应用启动，版本 {}", app.package_info().version);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogInfo {
    directory_path: String,
    file_path: String,
    file_size_bytes: u64,
    total_size_bytes: u64,
    max_file_size_bytes: u64,
    max_total_size_bytes: u64,
    updated_at: Option<u64>,
}

/// 仅识别本应用日志，不触碰目录里的其他文件
fn is_log_file(name: &str) -> bool {
    static ARCHIVE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(
            r"^main_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}\.log(?:\.bak)?$",
        )
        .unwrap()
    });
    name == "main.log" || ARCHIVE.is_match(name)
}

/// 读取日志占用信息，忽略轮转期间已不存在的文件
fn info(directory: &Path) -> Result<LogInfo, String> {
    let mut total = 0;
    let mut size = 0;
    let mut updated = None;
    for entry in fs::read_dir(directory).map_err(|_| "无法读取日志目录")? {
        let entry = entry.map_err(|_| "读取日志目录项失败")?;
        if !is_log_file(&entry.file_name().to_string_lossy()) {
            continue;
        }
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) if metadata.is_file() => metadata,
            Ok(_) => continue,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err("读取日志文件信息失败".into()),
        };
        total += metadata.len();
        if entry.file_name() == "main.log" {
            size = metadata.len();
        }
        if let Ok(time) = metadata.modified().and_then(|time| {
            time.duration_since(UNIX_EPOCH)
                .map_err(std::io::Error::other)
        }) {
            updated = Some(updated.unwrap_or(0).max(time.as_millis() as u64));
        }
    }
    Ok(LogInfo {
        directory_path: directory.to_string_lossy().into_owned(),
        file_path: directory.join("main.log").to_string_lossy().into_owned(),
        file_size_bytes: size,
        total_size_bytes: total,
        max_file_size_bytes: MAX_FILE_SIZE,
        max_total_size_bytes: MAX_FILE_SIZE * 2,
        updated_at: updated,
    })
}

/// 关闭插件句柄后清理日志，并在成功或失败时重新建立写入器
fn reset<R: Runtime>(app: &tauri::AppHandle<R>, state: &Diagnostics) -> Result<LogInfo, String> {
    let mut guard = state.logger.lock().map_err(|_| "日志写入器不可用")?;
    if let Some(logger) = guard.take() {
        logger.flush();
        drop(logger);
    }
    let cleared = (|| -> Result<(), String> {
        for entry in fs::read_dir(&state.directory).map_err(|_| "无法读取日志目录")? {
            let entry = entry.map_err(|_| "读取日志目录项失败")?;
            if is_log_file(&entry.file_name().to_string_lossy())
                && entry
                    .file_type()
                    .map_err(|_| "读取日志文件类型失败")?
                    .is_file()
            {
                fs::remove_file(entry.path()).map_err(|_| "清空日志文件失败")?;
            }
        }
        Ok(())
    })();
    let (_, _, logger) = builder(&state.directory)
        .split(app)
        .map_err(|_| "重新打开日志失败，请检查目录权限")?;
    *guard = Some(logger);
    cleared?;
    info(&state.directory)
}

/// 返回当前日志信息，等待正在进行的清理操作
#[tauri::command]
pub async fn get_log_info(state: State<'_, Diagnostics>) -> Result<LogInfo, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let guard = state.logger.lock().map_err(|_| "日志写入器不可用")?;
        if let Some(logger) = guard.as_ref() {
            logger.flush();
        }
        info(&state.directory)
    })
    .await
    .map_err(|_| "读取日志任务失败")?
}

/// 响应用户清空日志操作，保留后续写入能力
#[tauri::command]
pub async fn clear_logs(
    app: tauri::AppHandle,
    state: State<'_, Diagnostics>,
) -> Result<LogInfo, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || reset(&app, &state))
        .await
        .map_err(|_| "清空日志任务失败")?
}

/// 响应用户点击，在系统文件管理器中显示日志目录
#[tauri::command]
pub async fn reveal_log_file(
    app: tauri::AppHandle,
    state: State<'_, Diagnostics>,
) -> Result<(), String> {
    let directory = state.directory.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = directory.to_str().ok_or("日志目录不是有效的 UTF-8 路径")?;
        app.opener()
            .open_path(path, None::<&str>)
            .map_err(|error| command_error("无法打开日志目录", &error))
    })
    .await
    .map_err(|_| "打开日志目录任务失败")?
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlaybackEventKind {
    FirstFrame,
    PlayerError,
    ManualRouteSwitch,
    AutoRouteSwitch,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackEvent {
    media_session_id: String,
    #[serde(rename = "type")]
    kind: PlaybackEventKind,
    elapsed_ms: Option<f64>,
    message: Option<String>,
    success: Option<bool>,
}

/// 记录首帧、错误及换线诊断，拒绝无效会话和耗时
#[tauri::command]
pub async fn report_media_playback_event(
    proxy: State<'_, crate::infrastructure::media::proxy::MediaProxy>,
    event: PlaybackEvent,
) -> Result<(), String> {
    if event
        .elapsed_ms
        .is_some_and(|value| !value.is_finite() || value < 0.0)
    {
        return Err("播放耗时无效".into());
    }
    let sessions = proxy.sessions.read().await;
    let Some(session) = sessions.get(&event.media_session_id) else {
        return Ok(());
    };
    let kind = match event.kind {
        PlaybackEventKind::FirstFrame => "首帧",
        PlaybackEventKind::PlayerError => "播放错误",
        PlaybackEventKind::ManualRouteSwitch => "手动换线",
        PlaybackEventKind::AutoRouteSwitch => "自动换线",
    };
    let level = if matches!(event.kind, PlaybackEventKind::PlayerError) {
        log::Level::Warn
    } else {
        log::Level::Info
    };
    log::log!(target:"playback", level, "{} | 会话={} | 网络={} | 耗时={}ms | 成功={:?} | {}", kind, event.media_session_id, session.info.network, event.elapsed_ms.unwrap_or(0.0), event.success, event.message.unwrap_or_default());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    /// 清理后插件仍能写入，不删除旁边的非日志文件
    #[test]
    fn clears_and_reopens_plugin_logger() {
        let directory =
            std::env::temp_dir().join(format!("vfan-log-test-{}", uuid::Uuid::new_v4()));
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let (_, _, logger) = builder(&directory)
            .max_file_size(256)
            .split(app.handle())
            .unwrap();
        let state = Diagnostics {
            directory: directory.clone(),
            logger: Arc::new(Mutex::new(Some(logger))),
        };
        let managed = ManagedLogger(state.logger.clone());
        use log::Log;
        managed.log(
            &log::Record::builder()
                .args(format_args!("before token=secret"))
                .level(log::Level::Info)
                .target("test")
                .build(),
        );
        managed.flush();
        assert!(info(&directory).unwrap().total_size_bytes > 0);
        for _ in 0..4 {
            managed.log(
                &log::Record::builder()
                    .args(format_args!("rotation test {}", "x".repeat(100)))
                    .level(log::Level::Info)
                    .target("test")
                    .build(),
            );
        }
        managed.flush();
        let files = fs::read_dir(&directory).unwrap().count();
        assert_eq!(files, 2);
        assert!(info(&directory).unwrap().total_size_bytes <= 512);
        fs::write(directory.join("notes.txt"), "keep").unwrap();
        assert_eq!(reset(app.handle(), &state).unwrap().total_size_bytes, 0);
        managed.log(
            &log::Record::builder()
                .args(format_args!("after clear"))
                .level(log::Level::Info)
                .target("test")
                .build(),
        );
        managed.flush();
        let contents = fs::read_to_string(directory.join("main.log")).unwrap();
        assert!(contents.contains("after clear"));
        assert!(!contents.contains("before"));
        assert_eq!(
            fs::read_to_string(directory.join("notes.txt")).unwrap(),
            "keep"
        );
        state.logger.lock().unwrap().take();
        fs::remove_dir_all(directory).unwrap();
    }
}
