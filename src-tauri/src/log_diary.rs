use crate::error::{AppError, AppResult};
use crate::models::{
    LogDiaryEntry, LogDiaryStatus, LogDiaryStore, NewLogDiaryEntry, UpdateLogDiaryByRunSession,
};
use crate::store::data_dir;
use std::collections::HashSet;
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
        run_session_id: input
            .run_session_id
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

/// 按运行会话回写日志终态（成功 / 失败 / 已结束）。
pub fn update_by_run_session(input: UpdateLogDiaryByRunSession) -> AppResult<Option<LogDiaryEntry>> {
    let session_id = input.run_session_id.trim();
    if session_id.is_empty() {
        return Err(AppError::msg("runSessionId 不能为空"));
    }
    if matches!(input.status, LogDiaryStatus::Running) {
        return Err(AppError::msg("不能把日志回写成进行中"));
    }

    let mut store = load()?;
    let Some(entry) = store
        .entries
        .iter_mut()
        .find(|e| e.run_session_id.as_deref() == Some(session_id))
    else {
        return Ok(None);
    };

    // 已是终态则不覆盖，避免重复事件把结果打乱
    if !matches!(entry.status, LogDiaryStatus::Running) {
        return Ok(Some(entry.clone()));
    }

    entry.status = input.status;
    if let Some(detail) = input.detail.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        if entry.detail.trim().is_empty() {
            entry.detail = detail;
        } else {
            entry.detail = format!("{}\n\n{}", entry.detail.trim_end(), detail);
        }
    }
    entry.error = input
        .error
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| entry.error.clone());

    let updated = entry.clone();
    save(&store)?;
    Ok(Some(updated))
}

/// 将「进行中」但对账不到活跃会话的日志标为「已结束」。
/// `active_session_ids`：仍在 running / starting / stopping 的会话。
pub fn reconcile_stale_running(active_session_ids: &[String]) -> AppResult<Vec<LogDiaryEntry>> {
    let active: HashSet<&str> = active_session_ids.iter().map(|s| s.as_str()).collect();
    let mut store = load()?;
    let mut changed = false;

    for entry in &mut store.entries {
        if entry.status != LogDiaryStatus::Running {
            continue;
        }
        let still_active = entry
            .run_session_id
            .as_deref()
            .is_some_and(|id| active.contains(id));
        if still_active {
            continue;
        }
        entry.status = LogDiaryStatus::Ended;
        let note = "最终状态未知（进程已结束，或应用曾重启，未能回写结果）";
        entry.error = Some(match entry.error.as_deref() {
            Some(prev) if !prev.trim().is_empty() => format!("{prev}\n{note}"),
            _ => note.into(),
        });
        changed = true;
    }

    if changed {
        save(&store)?;
    }
    Ok(store.entries)
}

pub fn clear_logs() -> AppResult<()> {
    save(&LogDiaryStore::default())
}
