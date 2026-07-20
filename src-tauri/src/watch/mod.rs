use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::git;
use crate::models::ProjectRecord;
use crate::store;

pub struct WatchState {
    inner: Mutex<WatchInner>,
}

struct WatchInner {
    path_index: HashMap<PathBuf, String>,
    debouncer: Option<notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>>,
}

impl WatchState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(WatchInner {
                path_index: HashMap::new(),
                debouncer: None,
            }),
        }
    }

    pub fn start(app: AppHandle) {
        let _ = sync_watches(&app);

        let app_tick = app.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(60));
            let _ = refresh_all_and_emit(&app_tick);
        });
    }
}

fn should_ignore(path: &Path) -> bool {
    let s = path.to_string_lossy();
    const SKIP: &[&str] = &[
        "/node_modules/",
        "/target/",
        "/.git/objects/",
        "/.git/lfs/",
        "/dist/",
        "/build/",
        "/.next/",
        "/vendor/",
        "/.cache/",
    ];
    SKIP.iter().any(|p| s.contains(p))
}

fn resolve_project(inner: &WatchInner, path: &Path) -> Option<String> {
    for (root, id) in &inner.path_index {
        if path.starts_with(root) {
            return Some(id.clone());
        }
    }
    None
}

pub fn sync_watches(app: &AppHandle) -> Result<(), String> {
    let projects = store::list_projects().map_err(|e| e.to_string())?;
    let state = app.state::<WatchState>();

    let app_clone = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(400),
        move |res: DebounceEventResult| {
            if let Ok(events) = res {
                let mut dirty: HashSet<String> = HashSet::new();
                {
                    let state = app_clone.state::<WatchState>();
                    let g = state.inner.lock();
                    for ev in events {
                        if should_ignore(&ev.path) {
                            continue;
                        }
                        if let Some(id) = resolve_project(&g, &ev.path) {
                            dirty.insert(id);
                        }
                    }
                }
                for id in dirty {
                    let _ = refresh_and_emit(&app_clone, &id);
                }
            }
        },
    )
    .map_err(|e| e.to_string())?;

    let mut path_index = HashMap::new();
    for p in &projects {
        let root = PathBuf::from(&p.path);
        if !root.exists() {
            continue;
        }
        let _ = debouncer.watcher().watch(&root, RecursiveMode::Recursive);
        path_index.insert(root, p.id.clone());
    }

    let mut guard = state.inner.lock();
    guard.path_index = path_index;
    guard.debouncer = Some(debouncer);
    Ok(())
}

pub fn refresh_and_emit(app: &AppHandle, project_id: &str) -> Result<(), String> {
    let project = store::find_project(project_id).map_err(|e| e.to_string())?;
    let status = git::fetch_project_status(&project);
    app.emit("project-status", &status)
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn refresh_all_and_emit(app: &AppHandle) -> Result<(), String> {
    let projects = store::list_projects().map_err(|e| e.to_string())?;
    let statuses: Vec<_> = projects.iter().map(git::fetch_project_status).collect();
    app.emit("projects-status", &statuses)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[allow(dead_code)]
pub fn statuses_for(projects: &[ProjectRecord]) -> Vec<crate::models::ProjectStatus> {
    projects.iter().map(git::fetch_project_status).collect()
}
