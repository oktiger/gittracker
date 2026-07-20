use crate::error::{AppError, AppResult};
use crate::models::{LogDiaryEntry, LogDiaryStore, NewLogDiaryEntry};
use crate::store::data_dir;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_ENTRIES: usize = 200;

fn log_path() -> AppResult<PathBuf> {
    Ok(data_dir()?.join("log-diary.json"))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn load() -> AppResult<LogDiaryStore> {
    let path = log_path()?;
    if !path.exists() {
        return Ok(LogDiaryStore::default());
    }
    let raw = fs::read_to_string(&path)?;
    if raw.trim().is_empty() {
        return Ok(LogDiaryStore::default());
    }
    Ok(serde_json::from_str(&raw)?)
}

fn save(store: &LogDiaryStore) -> AppResult<()> {
    let path = log_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_string_pretty(store)?;
    fs::write(path, raw)?;
    Ok(())
}

pub fn list_logs() -> AppResult<Vec<LogDiaryEntry>> {
    Ok(load()?.entries)
}

pub fn append_log(input: NewLogDiaryEntry) -> AppResult<LogDiaryEntry> {
    let kind = input.kind.trim().to_string();
    let title = input.title.trim().to_string();
    if kind.is_empty() || title.is_empty() {
        return Err(AppError::msg("日志 kind 与 title 不能为空"));
    }

    let entry = LogDiaryEntry {
        id: uuid::Uuid::new_v4().to_string(),
        created_at: now_ms(),
        kind,
        status: input.status,
        project_id: input.project_id.filter(|s| !s.trim().is_empty()),
        project_name: input.project_name.filter(|s| !s.trim().is_empty()),
        title,
        detail: input.detail.unwrap_or_default(),
        error: input
            .error
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
    };

    let mut store = load()?;
    store.entries.insert(0, entry.clone());
    if store.entries.len() > MAX_ENTRIES {
        store.entries.truncate(MAX_ENTRIES);
    }
    save(&store)?;
    Ok(entry)
}

pub fn clear_logs() -> AppResult<()> {
    save(&LogDiaryStore::default())
}
