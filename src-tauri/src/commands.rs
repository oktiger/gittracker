use crate::ai;
use crate::docs;
use crate::error::{AppError, AppResult};
use crate::git;
use crate::log_diary;
use crate::models::{
    AiConnectionTestResult, AiProvider, AppSettings, DiscardPreview, DiscardResult, DocsOverview,
    GenerateTasksResult, LogDiaryEntry, NewLogDiaryEntry, OneClickResult, ProjectRecord,
    ProjectStatus, RunTarget, RunTaskResult, SuggestRunTargetsResult,
};
use crate::run;
use crate::store;
use crate::watch::{self, WatchState};
use std::path::Path;
use tauri::{AppHandle, State};
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
pub fn get_staged_diff(id: String) -> AppResult<String> {
    let project = store::find_project(&id)?;
    git::staged_diff(Path::new(&project.path))
}

#[tauri::command]
pub fn stage_all_changes(id: String) -> AppResult<()> {
    let project = store::find_project(&id)?;
    git::stage_all(Path::new(&project.path))
}

#[tauri::command]
pub fn generate_commit_message(id: String) -> AppResult<String> {
    let project = store::find_project(&id)?;
    let repo = Path::new(&project.path);
    git::stage_all(repo)?;
    let diff = git::staged_diff(repo)?;
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

    // 自动暂存全部改动后再生成 message / commit / push
    git::stage_all(repo)?;
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

#[tauri::command]
pub fn test_ai_connection(provider: AiProvider) -> AppResult<AiConnectionTestResult> {
    ai::test_connection(provider)
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
    if !path.is_file() {
        return Err(AppError::msg("文件不存在"));
    }
    app.opener()
        .open_path(path.to_string_lossy().as_ref(), None::<&str>)
        .map_err(|e| AppError::msg(format!("无法打开文件：{e}")))?;
    Ok(())
}

#[tauri::command]
pub fn generate_tasks_from_goal(id: String) -> AppResult<GenerateTasksResult> {
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

    let ai_out = ai::run_goal(repo, &settings.goal_prompt_template, &goal_md, &context)?;
    let created = docs::write_tasks_from_ai_output(repo, &ai_out)?;
    let overview = docs::list_docs(repo)?;
    Ok(GenerateTasksResult { created, overview })
}

#[tauri::command]
pub fn run_docs_task(id: String, relative_path: String) -> AppResult<RunTaskResult> {
    let project = store::find_project(&id)?;
    let repo = Path::new(&project.path);
    let settings = store::get_settings()?;

    let task_md = docs::read_doc_file(repo, &relative_path)?;
    if task_md.trim().is_empty() {
        return Err(AppError::msg("任务文档为空"));
    }

    let summary = ai::run_task(
        repo,
        &settings.task_prompt_template,
        &task_md,
        &relative_path,
    )?;
    docs::append_task_result(repo, &relative_path, &summary)?;
    let overview = docs::list_docs(repo)?;
    Ok(RunTaskResult { summary, overview })
}

#[tauri::command]
pub fn set_run_targets(id: String, targets: Vec<RunTarget>) -> AppResult<Vec<RunTarget>> {
    store::set_run_targets(&id, targets)
}

#[tauri::command]
pub fn suggest_run_targets(
    app: AppHandle,
    id: String,
    session_id: String,
) -> AppResult<SuggestRunTargetsResult> {
    let progress = ai::make_progress_sink(app, session_id);
    let emit = |kind: &str, text: &str| progress(kind, text);

    emit("status", "正在读取项目信息…");
    let project = store::find_project(&id)?;
    let repo = Path::new(&project.path);

    emit(
        "status",
        &format!("正在扫描「{}」的仓库结构与脚本…", project.name),
    );
    let context = run::gather_context(repo)?;
    emit(
        "log",
        &format!(
            "已收集约 {} 字上下文，准备交给 AI…",
            context.chars().count()
        ),
    );

    match ai::suggest_run_targets(repo, &context, Some(&progress)) {
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
                    let targets = run::suggest_from_fs(repo)?;
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
            let targets = run::suggest_from_fs(repo).map_err(|scan_err| {
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
}

#[tauri::command]
pub fn run_project_target(id: String, target_id: String) -> AppResult<()> {
    let project = store::find_project(&id)?;
    let target = project
        .run_targets
        .iter()
        .find(|t| t.id == target_id)
        .cloned()
        .ok_or_else(|| AppError::msg("未找到该启动目标"))?;
    run::run_in_terminal(Path::new(&project.path), &target)
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
