mod ai;
mod commands;
mod docs;
mod error;
mod git;
mod log_diary;
mod models;
mod path_env;
mod run;
mod store;
mod upgrade;
mod watch;

use models::{LanguagePreference, ResolvedLanguage};
use run::RunManager;
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
        .manage(git::GitOperationState::default())
        .manage(RunManager::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::add_project,
            commands::remove_project,
            commands::get_all_statuses,
            commands::get_project_status,
            commands::refresh_all,
            commands::list_changed_files,
            commands::get_file_diff,
            commands::generate_commit_message,
            commands::commit_project,
            commands::push_project,
            commands::commit_and_push,
            commands::one_click_commit,
            commands::preview_discard,
            commands::discard_changes,
            commands::sync_file_watchers,
            commands::get_settings,
            commands::get_default_prompt_templates,
            commands::update_settings,
            commands::set_language_preference,
            commands::sync_native_language,
            commands::test_ai_connection,
            commands::list_docs,
            commands::ensure_docs,
            commands::list_document_library,
            commands::set_document_library,
            commands::read_document_library_file,
            commands::write_document_library_file,
            commands::delete_document_library_target,
            commands::run_document_library_target,
            commands::read_doc_file,
            commands::write_doc_file,
            commands::open_doc_external,
            commands::open_document_library_html,
            commands::generate_tasks_from_goal,
            commands::run_docs_task,
            commands::set_run_targets,
            commands::suggest_run_targets,
            commands::run_project_target,
            commands::upgrade_self,
            commands::list_run_sessions,
            commands::stop_run_session,
            commands::list_log_diary,
            commands::append_log_diary,
            commands::update_log_diary_by_run_session,
            commands::reconcile_log_diary,
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
    let initial = match store::get_settings().map(|settings| settings.language) {
        Ok(LanguagePreference::ZhCn) => ResolvedLanguage::ZhCn,
        _ => ResolvedLanguage::En,
    };
    let (show, quit) = tray_labels(initial);
    let show_i = MenuItem::with_id(app, "show", show, true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", quit, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

    let _tray = TrayIconBuilder::with_id("main-tray")
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
                app.state::<RunManager>().stop_all();
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

fn tray_labels(locale: ResolvedLanguage) -> (&'static str, &'static str) {
    if locale.is_zh() {
        ("显示窗口", "退出")
    } else {
        ("Show window", "Quit")
    }
}

pub fn update_tray_language(
    app: &tauri::AppHandle,
    locale: ResolvedLanguage,
) -> Result<(), Box<dyn std::error::Error>> {
    let (show, quit) = tray_labels(locale);
    let show_i = MenuItem::with_id(app, "show", show, true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", quit, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}
