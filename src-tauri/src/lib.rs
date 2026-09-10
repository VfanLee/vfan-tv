mod desktop;
mod infrastructure;
mod modules;

use desktop::{mini_window, updates, windows};
use infrastructure::{database, diagnostics, media};
use modules::{
    data_transfer, home, iptv, library, network_settings, preferences, radio, search_history,
    settings, sources, vod,
};

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    version: String,
    database_path: String,
}

/// 返回当前运行时版本与数据库位置
#[tauri::command]
fn get_runtime_info(app: tauri::AppHandle) -> Result<RuntimeInfo, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "无法定位应用数据目录".to_owned())?;
    Ok(RuntimeInfo {
        version: app.package_info().version.to_string(),
        database_path: path
            .join("data")
            .join(database::FILE_NAME)
            .to_string_lossy()
            .into_owned(),
    })
}

/// 初始化 Rust 服务并启动 Tauri 窗口
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                mini_window::reopen(&app).await;
            });
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .setup(|app| {
            diagnostics::initialize(app.handle())?;
            let path = app.path().app_local_data_dir()?;
            let db = tauri::async_runtime::block_on(database::open(&path))?;
            app.manage(db);
            app.manage(updates::Updates::default());
            app.manage(home::Recommendations::default());
            app.manage(mini_window::MiniWindow::default());
            app.manage(iptv::Catalog::default());
            app.manage(vod::Searches::default());
            app.manage(data_transfer::DataTransfer::default());
            let proxy = tauri::async_runtime::block_on(media::proxy::MediaProxy::start())?;
            app.manage(proxy);
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let app = window.app_handle().clone();
                let label = window.label().to_owned();
                tauri::async_runtime::spawn(async move {
                    app.state::<vod::Searches>().cancel_window(&label).await;
                    mini_window::window_destroyed(&app, &label).await;
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_runtime_info,
            updates::get_update_snapshot,
            updates::check_for_updates,
            updates::download_update,
            updates::install_update,
            diagnostics::get_log_info,
            diagnostics::clear_logs,
            diagnostics::reveal_log_file,
            diagnostics::report_media_playback_event,
            windows::open_external_url,
            mini_window::enter_mini_window_mode,
            mini_window::get_mini_window_playback,
            mini_window::ready_mini_window,
            mini_window::update_mini_window_playback,
            mini_window::exit_mini_window_mode,
            mini_window::move_mini_window,
            mini_window::resize_mini_window,
            mini_window::hide_mini_window,
            mini_window::get_mini_window_always_on_top,
            mini_window::set_mini_window_always_on_top,
            home::get_home_data,
            home::get_hot_recommendations,
            radio::radio_request,
            radio::get_radio_playback_target,
            iptv::get_iptv_catalog,
            iptv::get_iptv_playback_target,
            media::images::get_source_image_url,
            vod::get_vod_catalog_page,
            vod::probe_media_source,
            vod::get_vod_detail,
            vod::search_vod,
            vod::cancel_vod_search,
            search_history::list_search_history,
            search_history::change_search_history,
            data_transfer::export_database,
            data_transfer::clear_app_data,
            data_transfer::restore_factory_settings,
            data_transfer::import_database,
            library::list_recent_plays,
            library::get_recent_play,
            library::upsert_recent_play,
            library::remove_recent_play,
            library::list_favorites,
            library::is_favorite,
            library::add_favorite,
            library::remove_favorite,
            settings::get_settings,
            settings::update_settings,
            network_settings::get_network_status,
            network_settings::get_network_settings,
            network_settings::save_network_settings,
            network_settings::test_network_settings,
            sources::list_sources,
            sources::sync_source_subscription,
            sources::delete_source_subscription,
            sources::import_sources_from_file,
            sources::export_sources_to_file,
            sources::preview_source_import,
            sources::confirm_source_import,
            sources::test_source_speed,
            sources::create_source,
            sources::update_source,
            sources::delete_sources,
            sources::reorder_sources,
            sources::switch_source_backup,
            preferences::list_ui_preferences,
            preferences::get_ui_preferences_snapshot,
            preferences::set_ui_preference,
            windows::open_settings_window,
            windows::is_window_maximized,
            windows::toggle_window_maximize,
            windows::quit_app,
            windows::restart_app,
            media::get_media_playback_target,
            media::get_media_session_info,
            media::retain_media_session,
            media::release_media_session,
            media::get_associated_audio_url
        ])
        .build(tauri::generate_context!())
        .expect("无法启动 Vfan TV")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if matches!(_event, tauri::RunEvent::Reopen { .. }) {
                let app = _app.clone();
                tauri::async_runtime::spawn(async move {
                    mini_window::reopen(&app).await;
                });
            }
        });
}
