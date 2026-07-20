use crate::error::{AppError, AppResult};
use crate::models::{AppSettings, AppStore, ProjectRecord, RunTarget};
use std::fs;
use std::path::PathBuf;

pub fn config_dir() -> AppResult<PathBuf> {
    let base = dirs::config_dir().ok_or_else(|| AppError::msg("无法定位配置目录"))?;
    let dir = base.join("gittracker");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn data_dir() -> AppResult<PathBuf> {
    let base = dirs::data_dir().ok_or_else(|| AppError::msg("无法定位数据目录"))?;
    let dir = base.join("gittracker");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn store_path() -> AppResult<PathBuf> {
    Ok(config_dir()?.join("projects.json"))
}

pub fn load_store() -> AppResult<AppStore> {
    let path = store_path()?;
    if !path.exists() {
        return Ok(AppStore::default());
    }
    let raw = fs::read_to_string(&path)?;
    if raw.trim().is_empty() {
        return Ok(AppStore::default());
    }
    Ok(serde_json::from_str(&raw)?)
}

pub fn save_store(store: &AppStore) -> AppResult<()> {
    let path = store_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_string_pretty(store)?;
    fs::write(path, raw)?;
    Ok(())
}

pub fn list_projects() -> AppResult<Vec<ProjectRecord>> {
    let mut projects = load_store()?.projects;
    projects.sort_by_key(|p| p.order);
    Ok(projects)
}

pub fn add_project(path: String, name: Option<String>) -> AppResult<ProjectRecord> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.is_dir() {
        return Err(AppError::msg("路径不是有效目录"));
    }

    let mut store = load_store()?;
    if store.projects.iter().any(|p| p.path == path) {
        return Err(AppError::msg("该项目已在列表中"));
    }

    let display_name = name.unwrap_or_else(|| {
        path_buf
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled")
            .to_string()
    });

    let order = store
        .projects
        .iter()
        .map(|p| p.order)
        .max()
        .unwrap_or(-1)
        + 1;

    let record = ProjectRecord {
        id: uuid::Uuid::new_v4().to_string(),
        name: display_name,
        path,
        order,
        run_targets: Vec::new(),
    };
    store.projects.push(record.clone());
    save_store(&store)?;
    Ok(record)
}

pub fn set_run_targets(id: &str, targets: Vec<RunTarget>) -> AppResult<Vec<RunTarget>> {
    let mut store = load_store()?;
    let project = store
        .projects
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| AppError::msg("未找到该项目"))?;

    let mut normalized = Vec::new();
    for mut t in targets {
        let name = t.name.trim().to_string();
        let cwd = t.cwd.trim().to_string();
        let command = t.command.trim().to_string();
        if name.is_empty() || command.is_empty() {
            return Err(AppError::msg("启动目标的名称和命令不能为空"));
        }
        if cwd.is_empty() {
            t.cwd = ".".into();
        } else {
            t.cwd = cwd;
        }
        t.name = name;
        t.command = command;
        t.description = t
            .description
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        if t.id.trim().is_empty() {
            t.id = uuid::Uuid::new_v4().to_string();
        }
        normalized.push(t);
    }

    if !normalized.is_empty() && !normalized.iter().any(|t| t.is_default) {
        normalized[0].is_default = true;
    }

    project.run_targets = normalized.clone();
    save_store(&store)?;
    Ok(normalized)
}

pub fn remove_project(id: &str) -> AppResult<()> {
    let mut store = load_store()?;
    let before = store.projects.len();
    store.projects.retain(|p| p.id != id);
    if store.projects.len() == before {
        return Err(AppError::msg("未找到该项目"));
    }
    save_store(&store)?;
    Ok(())
}

pub fn find_project(id: &str) -> AppResult<ProjectRecord> {
    list_projects()?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| AppError::msg("未找到该项目"))
}

pub fn recovery_dir(project_id: &str) -> AppResult<PathBuf> {
    let dir = data_dir()?.join("recovery").join(project_id);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn get_settings() -> AppResult<AppSettings> {
    Ok(load_store()?.settings)
}

pub fn update_settings(settings: AppSettings) -> AppResult<AppSettings> {
    let mut store = load_store()?;
    store.settings = settings.clone();
    save_store(&store)?;
    Ok(settings)
}
