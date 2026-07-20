use crate::ai;
use crate::error::{AppError, AppResult};
use crate::git;
use crate::models::{
    AppSettings, DiscardPreview, DiscardResult, OneClickResult, ProjectRecord, ProjectStatus,
};
use crate::store;
use crate::watch::{self, WatchState};
use std::path::Path;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn list_projects() -> AppResult<Vec<ProjectRecord>> {
    store::list_projects()
}

#[tauri::command]
pub fn add_project(app: AppHandle, path: String, name: Option<String>) -> AppResult<ProjectRecord> {
    let path_buf = Path::new(&path);
    if !git::is_git_repo(path_buf) {
        return Err(AppError::msg("所选目录不是 Git 仓库"));
    }
    let record = store::add_project(path, name)?;
    let _ = watch::sync_watches(&app);
    Ok(record)
}

#[tauri::command]
pub fn remove_project(app: AppHandle, id: String) -> AppResult<()> {
    store::remove_project(&id)?;
    let _ = watch::sync_watches(&app);
    Ok(())
}

#[tauri::command]
pub fn get_all_statuses() -> AppResult<Vec<ProjectStatus>> {
    let projects = store::list_projects()?;
    Ok(projects.iter().map(git::fetch_project_status).collect())
}

#[tauri::command]
pub fn get_project_status(id: String) -> AppResult<ProjectStatus> {
    let project = store::find_project(&id)?;
    Ok(git::fetch_project_status(&project))
}

#[tauri::command]
pub fn refresh_all(app: AppHandle) -> AppResult<Vec<ProjectStatus>> {
    watch::refresh_all_and_emit(&app).map_err(AppError::msg)?;
    get_all_statuses()
}

#[tauri::command]
pub fn list_changed_files(id: String) -> AppResult<Vec<crate::models::FileChange>> {
    let project = store::find_project(&id)?;
    git::list_changed_files(Path::new(&project.path))
}

#[tauri::command]
pub fn get_file_diff(id: String, path: String, staged: bool) -> AppResult<String> {
    let project = store::find_project(&id)?;
    git::file_diff(Path::new(&project.path), &path, staged)
}

#[tauri::command]
pub fn get_staged_diff(id: String) -> AppResult<String> {
    let project = store::find_project(&id)?;
    git::staged_diff(Path::new(&project.path))
}

#[tauri::command]
pub fn generate_commit_message(id: String) -> AppResult<String> {
    let project = store::find_project(&id)?;
    let diff = git::staged_diff(Path::new(&project.path))?;
    ai::generate_commit_message(&diff)
}

#[tauri::command]
pub fn commit_project(id: String, message: String) -> AppResult<()> {
    let project = store::find_project(&id)?;
    git::commit(Path::new(&project.path), &message)
}

#[tauri::command]
pub fn push_project(id: String) -> AppResult<()> {
    let project = store::find_project(&id)?;
    git::push(Path::new(&project.path))
}

#[tauri::command]
pub fn commit_and_push(id: String, message: String) -> AppResult<()> {
    let project = store::find_project(&id)?;
    let repo = Path::new(&project.path);
    git::commit(repo, &message)?;
    git::push(repo)?;
    Ok(())
}

#[tauri::command]
pub fn one_click_commit(id: String) -> AppResult<OneClickResult> {
    let project = store::find_project(&id)?;
    let repo = Path::new(&project.path);

    let diff = git::staged_diff(repo)?;
    let message = ai::generate_commit_message(&diff)?;
    git::commit(repo, &message)?;
    git::push(repo)?;

    Ok(OneClickResult {
        message,
        pushed: true,
    })
}

#[tauri::command]
pub fn preview_discard(id: String) -> AppResult<DiscardPreview> {
    let project = store::find_project(&id)?;
    let files = git::list_changed_files(Path::new(&project.path))?;
    let recovery_dir = store::recovery_dir(&id)?
        .to_string_lossy()
        .to_string();
    Ok(DiscardPreview {
        files,
        recovery_dir,
    })
}

#[tauri::command]
pub fn discard_changes(
    id: String,
    paths: Vec<String>,
    include_untracked: bool,
) -> AppResult<DiscardResult> {
    let project = store::find_project(&id)?;
    git::discard_changes(Path::new(&project.path), &id, &paths, include_untracked)
}

#[tauri::command]
pub fn sync_file_watchers(app: AppHandle, _state: State<'_, WatchState>) -> AppResult<()> {
    watch::sync_watches(&app).map_err(AppError::msg)
}

#[tauri::command]
pub fn get_settings() -> AppResult<AppSettings> {
    store::get_settings()
}

#[tauri::command]
pub fn update_settings(settings: AppSettings) -> AppResult<AppSettings> {
    store::update_settings(settings)
}
