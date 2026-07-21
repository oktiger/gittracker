use crate::ai;
use crate::docs;
use crate::error::{AppError, AppResult};
use crate::git;
use crate::log_diary;
use crate::models::{
    AiConnectionTestResult, AiProvider, AppSettings, DiscardPreview, DiscardResult, DocsOverview,
    DocumentLibrary, GenerateTasksResult, LogDiaryEntry, NewLogDiaryEntry, OneClickResult,
    ProjectRecord, ProjectStatus, RunSession, RunTarget, RunTaskResult, SuggestRunTargetsResult,
};
use crate::run;
use crate::store;
use crate::watch::{self, WatchState};
use std::path::Path;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

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
pub async fn generate_commit_message(
    app: AppHandle,
    id: String,
    session_id: String,
) -> AppResult<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress = ai::make_progress_sink(app.clone(), session_id);
        progress("status", "正在读取项目信息…");
        let project = store::find_project(&id)?;
        let repo = Path::new(&project.path);
        let operations = app.state::<git::GitOperationState>();
        let _operation = operations.try_acquire(repo)?;
        progress("status", "正在汇总全部 Changes…");
        let diff = git::working_tree_diff(repo)?;
        ai::generate_commit_message(&diff, Some(&progress))
    })
    .await
    .map_err(|e| AppError::msg(format!("任务中断：{e}")))?
}

#[tauri::command]
pub fn commit_project(
    id: String,
    message: String,
    operations: State<'_, git::GitOperationState>,
) -> AppResult<()> {
    let project = store::find_project(&id)?;
    let _operation = operations.try_acquire(Path::new(&project.path))?;
    git::commit(Path::new(&project.path), &message)
}

#[tauri::command]
pub fn push_project(id: String, operations: State<'_, git::GitOperationState>) -> AppResult<()> {
    let project = store::find_project(&id)?;
    let _operation = operations.try_acquire(Path::new(&project.path))?;
    git::push(Path::new(&project.path))
}

#[tauri::command]
pub fn commit_and_push(
    id: String,
    message: String,
    operations: State<'_, git::GitOperationState>,
) -> AppResult<()> {
    let project = store::find_project(&id)?;
    let repo = Path::new(&project.path);
    let _operation = operations.try_acquire(repo)?;
    git::commit(repo, &message)?;
    git::push(repo)?;
    Ok(())
}

#[tauri::command]
pub async fn one_click_commit(
    app: AppHandle,
    id: String,
    session_id: String,
) -> AppResult<OneClickResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress = ai::make_progress_sink(app.clone(), session_id);
        progress("status", "正在读取项目信息…");
        let project = store::find_project(&id)?;
        let repo = Path::new(&project.path);
        let operations = app.state::<git::GitOperationState>();
        let _operation = operations.try_acquire(repo)?;

        progress("status", "正在汇总全部 Changes…");
        let diff = git::working_tree_diff(repo)?;

        progress("status", "AI 正在生成 Commit message…");
        let message = ai::generate_commit_message(&diff, Some(&progress))?;

        progress("status", "正在创建 Commit 快照…");
        git::stage_all(repo)?;
        git::commit_staged(repo, &message)?;

        progress("status", "正在推送到远程…");
        git::push(repo)?;

        progress("status", "一键提交完成");
        Ok(OneClickResult {
            message,
            pushed: true,
        })
    })
    .await
    .map_err(|e| AppError::msg(format!("任务中断：{e}")))?
}

#[tauri::command]
pub fn preview_discard(id: String) -> AppResult<DiscardPreview> {
    let project = store::find_project(&id)?;
    let files = git::list_changed_files(Path::new(&project.path))?;
    let recovery_dir = store::recovery_dir(&id)?.to_string_lossy().to_string();
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

#[tauri::command]
pub async fn test_ai_connection(
    app: AppHandle,
    provider: AiProvider,
    session_id: String,
) -> AppResult<AiConnectionTestResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress = ai::make_progress_sink(app, session_id);
        ai::test_connection(provider, Some(&progress))
    })
    .await
    .map_err(|e| AppError::msg(format!("任务中断：{e}")))?
}

#[tauri::command]
pub fn list_docs(id: String) -> AppResult<DocsOverview> {
    let project = store::find_project(&id)?;
    docs::list_docs(Path::new(&project.path))
}

#[tauri::command]
pub fn ensure_docs(id: String) -> AppResult<DocsOverview> {
    let project = store::find_project(&id)?;
    docs::ensure_docs(Path::new(&project.path))
}

#[tauri::command]
pub fn list_document_library(id: String) -> AppResult<DocumentLibrary> {
    let project = store::find_project(&id)?;
    let detected_root =
        if project.docs_root.is_none() && Path::new(&project.path).join("DOCS").is_dir() {
            store::set_docs_root(&id, "DOCS".into())?;
            Some("DOCS".to_string())
        } else {
            project.docs_root
        };
    docs::list_document_library(Path::new(&project.path), detected_root.as_deref())
}

#[tauri::command]
pub fn set_document_library(id: String, root: String) -> AppResult<DocumentLibrary> {
    let project = store::find_project(&id)?;
    let root = root.trim().trim_matches('/').to_string();
    let library = docs::ensure_document_library(Path::new(&project.path), &root)?;
    store::set_docs_root(&id, root)?;
    Ok(library)
}

#[tauri::command]
pub fn read_document_library_file(id: String, relative_path: String) -> AppResult<String> {
    let project = store::find_project(&id)?;
    let root = project
        .docs_root
        .ok_or_else(|| AppError::msg("尚未设置文档库"))?;
    let path = docs::resolve_library_path(Path::new(&project.path), &root, &relative_path)?;
    if !path.is_file() {
        return Err(AppError::msg("只能打开文件"));
    }
    Ok(std::fs::read_to_string(path)?)
}

#[tauri::command]
pub fn write_document_library_file(
    id: String,
    relative_path: String,
    content: String,
) -> AppResult<()> {
    let project = store::find_project(&id)?;
    let root = project
        .docs_root
        .ok_or_else(|| AppError::msg("尚未设置文档库"))?;
    let path = docs::resolve_library_path(Path::new(&project.path), &root, &relative_path)?;
    if !path.is_file() {
        return Err(AppError::msg("只能保存文件"));
    }
    std::fs::write(path, content)?;
    Ok(())
}

#[tauri::command]
pub fn read_doc_file(id: String, relative_path: String) -> AppResult<String> {
    let project = store::find_project(&id)?;
    docs::read_doc_file(Path::new(&project.path), &relative_path)
}

#[tauri::command]
pub fn write_doc_file(id: String, relative_path: String, content: String) -> AppResult<()> {
    let project = store::find_project(&id)?;
    docs::write_doc_file(Path::new(&project.path), &relative_path, &content)
}

#[tauri::command]
pub fn open_doc_external(app: AppHandle, id: String, relative_path: String) -> AppResult<()> {
    let project = store::find_project(&id)?;
    let path = docs::resolve_docs_path(Path::new(&project.path), &relative_path)?;
    open_html_in_browser(&app, &path)
}

#[tauri::command]
pub fn open_document_library_html(
    app: AppHandle,
    id: String,
    relative_path: String,
) -> AppResult<()> {
    let project = store::find_project(&id)?;
    let root = project
        .docs_root
        .ok_or_else(|| AppError::msg("尚未设置文档库"))?;
    let path = docs::resolve_library_path(Path::new(&project.path), &root, &relative_path)?;
    open_html_in_browser(&app, &path)
}

fn open_html_in_browser(app: &AppHandle, path: &Path) -> AppResult<()> {
    if !path.is_file() {
        return Err(AppError::msg("文件不存在"));
    }
    let is_html = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("html") || extension.eq_ignore_ascii_case("htm")
        });
    if !is_html {
        return Err(AppError::msg("只能用浏览器打开 HTML 文档"));
    }
    let url =
        tauri::Url::from_file_path(path).map_err(|_| AppError::msg("无法生成 HTML 文件地址"))?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| AppError::msg(format!("无法用浏览器打开 HTML：{e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn generate_tasks_from_goal(
    app: AppHandle,
    id: String,
    session_id: String,
) -> AppResult<GenerateTasksResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress = ai::make_progress_sink(app, session_id);
        progress("status", "正在读取项目与 goal.md…");
        let project = store::find_project(&id)?;
        let repo = Path::new(&project.path);
        let settings = store::get_settings()?;

        let goal_rel = "Goal/goal.md";
        let goal_md = docs::read_doc_file(repo, goal_rel)?;
        if goal_md.trim().is_empty() {
            return Err(AppError::msg("goal.md 为空，请先填写项目目标"));
        }

        let status = git::fetch_project_status(&project);
        let context = format!(
            "项目路径：{}\n项目名称：{}\n当前分支：{}\n工作区：{}",
            project.path,
            project.name,
            if status.branch.is_empty() {
                "—"
            } else {
                &status.branch
            },
            if status.clean {
                "干净"
            } else {
                "有未提交改动"
            }
        );

        progress("status", "AI 正在根据目标拆分任务…");
        let ai_out = ai::run_goal(
            repo,
            &settings.goal_prompt_template,
            &goal_md,
            &context,
            Some(&progress),
        )?;
        progress("status", "正在写入任务文件…");
        let created = docs::write_tasks_from_ai_output(repo, &ai_out)?;
        let overview = docs::list_docs(repo)?;
        progress("status", &format!("已生成 {created} 个任务"));
        Ok(GenerateTasksResult { created, overview })
    })
    .await
    .map_err(|e| AppError::msg(format!("任务中断：{e}")))?
}

#[tauri::command]
pub async fn run_docs_task(
    app: AppHandle,
    id: String,
    relative_path: String,
    session_id: String,
) -> AppResult<RunTaskResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress = ai::make_progress_sink(app, session_id);
        progress("status", "正在读取任务文档…");
        let project = store::find_project(&id)?;
        let repo = Path::new(&project.path);
        let settings = store::get_settings()?;

        let task_md = docs::read_doc_file(repo, &relative_path)?;
        if task_md.trim().is_empty() {
            return Err(AppError::msg("任务文档为空"));
        }

        progress("status", "AI 正在实现任务…");
        let summary = ai::run_task(
            repo,
            &settings.task_prompt_template,
            &task_md,
            &relative_path,
            Some(&progress),
        )?;
        progress("status", "正在写入任务结果…");
        docs::append_task_result(repo, &relative_path, &summary)?;
        let overview = docs::list_docs(repo)?;
        progress("status", "任务执行完成");
        Ok(RunTaskResult { summary, overview })
    })
    .await
    .map_err(|e| AppError::msg(format!("任务中断：{e}")))?
}

#[tauri::command]
pub fn set_run_targets(id: String, targets: Vec<RunTarget>) -> AppResult<Vec<RunTarget>> {
    store::set_run_targets(&id, targets)
}

#[tauri::command]
pub async fn suggest_run_targets(
    app: AppHandle,
    id: String,
    session_id: String,
) -> AppResult<SuggestRunTargetsResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress = ai::make_progress_sink(app, session_id);
        let emit = |kind: &str, text: &str| progress(kind, text);

        emit("status", "正在读取项目信息…");
        let project = store::find_project(&id)?;
        let project_name = project.name.clone();
        let repo_path = project.path.clone();

        emit(
            "status",
            &format!("正在扫描「{project_name}」的仓库结构与脚本…"),
        );
        let context = run::gather_context(Path::new(&repo_path))?;
        emit(
            "log",
            &format!(
                "已收集约 {} 字上下文，准备交给 AI…",
                context.chars().count()
            ),
        );

        match ai::suggest_run_targets(Path::new(&repo_path), &context, Some(&progress)) {
            Ok(raw) => {
                emit("status", "正在解析 AI 返回的启动目标…");
                match run::parse_suggested_targets(&raw) {
                    Ok(targets) => {
                        emit(
                            "status",
                            &format!("识别完成，共建议 {} 条启动目标", targets.len()),
                        );
                        Ok(SuggestRunTargetsResult {
                            targets,
                            source: "ai".into(),
                            warning: None,
                        })
                    }
                    Err(parse_err) => {
                        emit(
                            "log",
                            &format!("AI 返回无法解析（{parse_err}），改用本地扫描…"),
                        );
                        let targets = run::suggest_from_fs(Path::new(&repo_path))?;
                        emit(
                            "status",
                            &format!("已用本地扫描得到 {} 条建议", targets.len()),
                        );
                        Ok(SuggestRunTargetsResult {
                            targets,
                            source: "heuristic".into(),
                            warning: Some(format!(
                                "AI 返回无法解析（{parse_err}），已改用本地 package.json 扫描结果"
                            )),
                        })
                    }
                }
            }
            Err(ai_err) => {
                emit("error", &format!("AI 不可用：{ai_err}"));
                emit("status", "正在回退到本地 package.json 扫描…");
                let targets = run::suggest_from_fs(Path::new(&repo_path)).map_err(|scan_err| {
                    AppError::msg(format!(
                        "{ai_err}\n\n本地扫描也失败：{scan_err}\n\n可在设置中切换 AI 通道，或运行 agent login / codex login 后重试；也可点「手动添加一条」。"
                    ))
                })?;
                emit(
                    "status",
                    &format!("已用本地扫描得到 {} 条建议", targets.len()),
                );
                Ok(SuggestRunTargetsResult {
                    targets,
                    source: "heuristic".into(),
                    warning: Some(format!(
                        "AI 不可用（{ai_err}）。已改用本地 package.json 扫描；可在「设置」登录对应 CLI 或切换通道后再识别。"
                    )),
                })
            }
        }
    })
    .await
    .map_err(|e| AppError::msg(format!("识别任务中断：{e}")))?
}

#[tauri::command]
pub fn run_project_target(
    app: AppHandle,
    manager: State<run::RunManager>,
    id: String,
    target_id: String,
) -> AppResult<RunSession> {
    let project = store::find_project(&id)?;
    let target = project
        .run_targets
        .iter()
        .find(|t| t.id == target_id)
        .cloned()
        .ok_or_else(|| AppError::msg("未找到该启动目标"))?;
    // 对本仓库的「升级 APP」走专用自升级（先退出再替换），避免覆盖正在运行的自身。
    if target.kind.as_deref() == Some("upgrade") && crate::upgrade::is_self_repo(Path::new(&project.path))
    {
        return crate::upgrade::start_self_upgrade(app, &manager);
    }
    manager.start(
        app,
        project.id,
        project.name,
        Path::new(&project.path),
        target,
    )
}

/// 升级当前 GitTracker：打包 → 退出 → 替换 .app → 自动重开。
#[tauri::command]
pub fn upgrade_self(app: AppHandle, manager: State<run::RunManager>) -> AppResult<RunSession> {
    crate::upgrade::start_self_upgrade(app, &manager)
}

#[tauri::command]
pub fn list_run_sessions(manager: State<run::RunManager>) -> Vec<RunSession> {
    manager.list()
}

#[tauri::command]
pub fn stop_run_session(
    app: AppHandle,
    manager: State<run::RunManager>,
    session_id: String,
) -> AppResult<()> {
    manager.stop(&app, &session_id)
}

#[tauri::command]
pub fn list_log_diary() -> AppResult<Vec<LogDiaryEntry>> {
    log_diary::list_logs()
}

#[tauri::command]
pub fn append_log_diary(entry: NewLogDiaryEntry) -> AppResult<LogDiaryEntry> {
    log_diary::append_log(entry)
}

#[tauri::command]
pub fn clear_log_diary() -> AppResult<()> {
    log_diary::clear_logs()
}

#[tauri::command]
pub async fn generate_daily_completion(
    app: AppHandle,
    period: String,
    session_id: String,
) -> AppResult<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress = ai::make_progress_sink(app, session_id);
        let (period_label, since) = match period.as_str() {
            "today" => ("今天", "midnight"),
            "week" => ("本周", "monday"),
            "sevenDays" => ("过去 7 天", "7 days ago"),
            _ => return Err(AppError::msg("不支持的总结时间范围")),
        };
        progress("status", "正在收集各项目的 commit message…");
        let mut lines = Vec::new();
        for project in store::list_projects()? {
            match git::commit_subjects_since(Path::new(&project.path), since) {
                Ok(subjects) => lines.extend(
                    subjects
                        .into_iter()
                        .map(|subject| format!("[{}] {subject}", project.name)),
                ),
                Err(err) => progress("log", &format!("跳过 {}：{err}", project.name)),
            }
        }
        ai::summarize_daily_completion(period_label, &lines.join("\n"), Some(&progress))
    })
    .await
    .map_err(|e| AppError::msg(format!("总结任务中断：{e}")))?
}
