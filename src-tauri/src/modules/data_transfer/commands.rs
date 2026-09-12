use super::snapshot::{restore, snapshot};
use super::{cancelled, DataTransfer, TransferResult};
use crate::infrastructure::diagnostics::command_error;
use sqlx::SqlitePool;
use std::path::Path;
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

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
    .map_err(|error| command_error("打开保存对话框失败", &error))?;
    let Some(file) = file else {
        return Ok(cancelled());
    };
    let path = file.into_path().map_err(|_| "请选择本地文件")?;
    let data_dir = crate::infrastructure::app_data_directory(&app)
        .map_err(|error| command_error("无法定位数据目录", &error))?
        .join("data");
    let parent = path.parent().ok_or("备份路径无效")?;
    if tokio::fs::canonicalize(parent)
        .await
        .map_err(|error| command_error("备份目录不存在", &error))?
        == tokio::fs::canonicalize(&data_dir)
            .await
            .map_err(|error| command_error("数据目录不存在", &error))?
    {
        return Err("请选择应用数据目录以外的位置".into());
    }
    let temporary = parent.join(format!(".vfan-export-{}.db", Uuid::new_v4()));
    let result = async {
        let mut connection = db
            .acquire()
            .await
            .map_err(|error| command_error("数据库不可用", &error))?;
        snapshot(&mut connection, &temporary).await?;
        tokio::fs::rename(&temporary, &path)
            .await
            .map_err(|error| command_error("保存备份文件失败", &error))?;
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
    .map_err(|error| command_error("打开文件对话框失败", &error))?;
    let Some(file) = file else {
        return Ok(cancelled());
    };
    let path = file.into_path().map_err(|_| "请选择本地文件")?;
    let data_path: String = sqlx::query_as::<_, (i64, String, String)>("PRAGMA database_list")
        .fetch_all(db.inner())
        .await
        .map_err(|error| command_error("无法定位数据库", &error))?
        .into_iter()
        .find(|(_, name, _)| name == "main")
        .ok_or("找不到应用数据库")?
        .2;
    let directory = Path::new(&data_path).parent().ok_or("数据目录无效")?;
    let safety = directory.join(format!("before-restore-{}.db", Uuid::new_v4()));
    restore(&db, &path, &safety).await?;
    Ok(TransferResult {
        cancelled: false,
        file_path: Some(path.to_string_lossy().into()),
        safety_backup_path: Some(safety.to_string_lossy().into()),
    })
}
