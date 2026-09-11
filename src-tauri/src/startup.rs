use crate::{
    desktop::{mini_window, updates},
    infrastructure::{database, diagnostics, media::proxy::MediaProxy},
    modules::{data_transfer, home, iptv, vod},
};
use std::{error::Error, path::Path};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/// 完成可失败的服务初始化后，再注册业务状态。
pub(crate) fn initialize(app: &tauri::AppHandle) -> Result<(), Box<dyn Error>> {
    diagnostics::initialize(app)?;
    let directory = app.path().app_local_data_dir()?;
    log::info!(
        "数据库路径：{}",
        directory.join("data").join(database::FILE_NAME).display()
    );
    let db = tauri::async_runtime::block_on(database::open(&directory))?;
    let proxy = tauri::async_runtime::block_on(MediaProxy::start())?;
    app.manage(db);
    app.manage(proxy);
    app.manage(updates::Updates::default());
    app.manage(home::Recommendations::default());
    app.manage(mini_window::MiniWindow::default());
    app.manage(iptv::Catalog::default());
    app.manage(vod::Searches::default());
    app.manage(data_transfer::DataTransfer::default());
    Ok(())
}

/// 数据库身份、结构或迁移不兼容时提供手动重置说明，其他故障保留排查提示。
fn failure_message(error: &(dyn Error + 'static), directory: Option<&Path>) -> String {
    let incompatible = error.is::<database::IncompatibleDatabase>()
        || matches!(
            error.downcast_ref::<sqlx::migrate::MigrateError>(),
            Some(
                sqlx::migrate::MigrateError::VersionMismatch(_)
                    | sqlx::migrate::MigrateError::VersionMissing(_)
                    | sqlx::migrate::MigrateError::Dirty(_)
            )
        );
    let mut message = if incompatible {
        "现有数据库与当前应用版本不兼容，应用无法启动。\n\n应用没有删除或重置数据。若不再需要现有数据，请先关闭此提示并退出应用，再手动删除下方 data 文件夹（包含数据库及其辅助文件），然后重新启动。收藏、播放记录、源和设置等数据将被清空，应用会创建全新数据库。".to_owned()
    } else {
        "应用初始化失败，数据未自动重置。请根据错误原因和日志排查后重试。".to_owned()
    };
    if let Some(directory) = directory {
        message.push_str(&format!(
            "\n\n数据库文件：{}\n数据文件夹：{}\n日志文件：{}",
            directory.join("data").join(database::FILE_NAME).display(),
            directory.join("data").display(),
            directory.join("logs/main.log").display(),
        ));
    }
    message.push_str(&format!("\n\n错误原因：{error}\n\n关闭提示后应用将退出。"));
    message
}

/// 使用非阻塞原生提示显示启动故障，确认后退出，避免 setup 错误触发 panic。
pub(crate) fn report_failure(app: &tauri::AppHandle, error: &(dyn Error + 'static)) {
    diagnostics::command_error("应用初始化失败", error);
    eprintln!("应用初始化失败：{error}");
    log::logger().flush();
    for window in app.webview_windows().values() {
        if let Err(error) = window.hide() {
            log::warn!("隐藏未就绪窗口失败：{error}");
        }
    }
    let directory = app.path().app_local_data_dir().ok();
    let handle = app.clone();
    app.dialog()
        .message(failure_message(error, directory.as_deref()))
        .title("Vfan TV 无法启动")
        .kind(MessageDialogKind::Error)
        .show(move |_| handle.exit(1));
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 两种迁移版本冲突都展示完整路径和手动删除的后果。
    #[test]
    fn incompatible_database_has_manual_reset_instructions() {
        for error in [
            sqlx::migrate::MigrateError::VersionMismatch(1),
            sqlx::migrate::MigrateError::VersionMissing(2),
        ] {
            let directory = Path::new("app-data");
            let message = failure_message(&error, Some(directory));
            assert!(message.contains("手动删除"));
            assert!(message.contains("先关闭此提示并退出应用"));
            assert!(message.contains("数据将被清空"));
            assert!(message.contains(&directory.join("data/data.db").display().to_string()));
            assert!(message.contains(&directory.join("logs/main.log").display().to_string()));
        }
    }

    /// 权限与其他初始化故障不能误导用户删库，路径解析失败仍显示原因。
    #[test]
    fn other_failures_do_not_suggest_deleting_data() {
        let error = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "permission denied");
        let message = failure_message(&error, None);
        assert!(!message.contains("手动删除"));
        assert!(message.contains("permission denied"));
        assert!(message.contains("数据未自动重置"));
    }

    /// 外部数据库和结构冲突走同一提示流程，而非被静默初始化。
    #[test]
    fn incompatible_identity_or_schema_has_manual_reset_instructions() {
        let error = database::IncompatibleDatabase("此文件不是 Vfan TV 数据库");
        let message = failure_message(&error, Some(Path::new("app-data")));
        assert!(message.contains("此文件不是 Vfan TV 数据库"));
        assert!(message.contains("手动删除"));
        assert!(message.contains("应用没有删除或重置数据"));
    }
}
