mod ai;
mod commands;
mod docs;
mod error;
mod git;
mod log_diary;
mod models;
mod run;
mod store;
mod watch;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use watch::WatchState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(WatchState::new())
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::add_project,
            commands::remove_project,
            commands::get_all_statuses,
            commands::get_project_status,
            commands::refresh_all,
            commands::list_changed_files,
            commands::get_file_diff,
            commands::get_staged_diff,
            commands::stage_all_changes,
            commands::generate_commit_message,
            commands::commit_project,
            commands::push_project,
            commands::commit_and_push,
            commands::one_click_commit,
            commands::preview_discard,
            commands::discard_changes,
            commands::sync_file_watchers,
            commands::get_settings,
            commands::update_settings,
            commands::test_ai_connection,
            commands::list_docs,
            commands::ensure_docs,
            commands::list_document_library,
            commands::set_document_library,
            commands::read_document_library_file,
            commands::write_document_library_file,
            commands::read_doc_file,
            commands::write_doc_file,
            commands::open_doc_external,
            commands::generate_tasks_from_goal,
            commands::run_docs_task,
            commands::set_run_targets,
            commands::suggest_run_targets,
            commands::run_project_target,
            commands::list_log_diary,
            commands::append_log_diary,
            commands::clear_log_diary,
            commands::generate_daily_completion,
        ])
        .setup(|app| {
            setup_tray(app)?;
            WatchState::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hide to tray instead of quitting
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running GitTracker");
}

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_i = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("GitTracker")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}
