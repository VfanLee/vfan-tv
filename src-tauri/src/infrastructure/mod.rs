pub(crate) mod database;
pub(crate) mod diagnostics;
pub(crate) mod media;
pub(crate) mod network;

/// 统一解析当前构建的数据根目录，开发构建与正式构建使用独立数据和日志。
pub(crate) fn app_data_directory<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<std::path::PathBuf> {
    use tauri::Manager;
    let directory = app.path().app_local_data_dir()?;
    Ok(if cfg!(debug_assertions) {
        directory.join("development")
    } else {
        directory
    })
}
