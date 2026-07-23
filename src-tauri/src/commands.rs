use crate::ai;
use crate::docs;
use crate::error::{AppError, AppResult};
use crate::git;
use crate::log_diary;
use crate::models::{
    AiConnectionTestResult, AiProvider, AppSettings, DailyCompletionResult, DiscardPreview,
    DiscardResult, DocsOverview, DocumentLibrary, GenerateTasksResult, LanguagePreference,
    LogDiaryEntry, MergePullRequestsResult, NewLogDiaryEntry, OneClickResult, ProjectRecord,
    ProjectStatus, PromptTemplateSet, ResolvedLanguage, RunSession, RunTarget, RunTaskResult, SuggestRunTargetsResult,
    UpdateLogDiaryByRunSession,
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
        return Err(AppError::coded("notGitRepository", None));
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
pub fn list_branches(id: String) -> AppResult<crate::models::BranchList> {
    let project = store::find_project(&id)?;
    git::list_branches(Path::new(&project.path))
}

#[tauri::command]
pub fn list_commit_history(id: String) -> AppResult<Vec<crate::models::CommitInfo>> {
    let project = store::find_project(&id)?;
    git::list_commit_history(Path::new(&project.path))
}

#[tauri::command]
pub fn list_open_pull_requests(id: String) -> AppResult<Vec<crate::models::PullRequestInfo>> {
    let project = store::find_project(&id)?;
    git::list_open_pull_requests(Path::new(&project.path))
}

#[tauri::command]
pub async fn merge_open_pull_requests(
    app: AppHandle,
    id: String,
    session_id: String,
    locale: ResolvedLanguage,
) -> AppResult<MergePullRequestsResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress = ai::make_progress_sink(app.clone(), session_id);
        let project = store::find_project(&id)?;
        let repo = Path::new(&project.path);
        let operations = app.state::<git::GitOperationState>();
        let _operation = operations.try_acquire(repo)?;

        progress("status", "正在检查 main 与工作区状态…");
        let default_branch = git::default_branch(repo)?;
        git::ensure_clean_default_branch(repo, &default_branch)?;
        git::run_git(repo, &["fetch", "origin", "--prune"])?;

        progress("status", "正在读取待合并 PR…");
        let prs = git::list_open_pull_requests(repo)?;
        if prs.is_empty() {
            return Err(AppError::msg("没有可合并到默认分支的开放 PR"));
        }

        let merge_id = uuid::Uuid::new_v4().simple().to_string();
        let integration_branch = format!("codex/ai-merge-{}", &merge_id[..8]);
        let worktree = std::env::temp_dir().join(format!("gittracker-ai-merge-{merge_id}"));
        let worktree_str = worktree.to_string_lossy();
        let base_ref = format!("origin/{default_branch}");

        progress("status", "正在创建隔离集成分支…");
        git::run_git(repo, &["worktree", "add", "--detach", worktree_str.as_ref(), &base_ref])?;
        let setup = (|| -> AppResult<Vec<(u64, String, String)>> {
            git::run_git(&worktree, &["switch", "-c", &integration_branch])?;
            let mut refs = Vec::new();
            for pr in &prs {
                let reference = git::fetch_pr_head(&worktree, pr.number)?;
                refs.push((pr.number, pr.title.clone(), reference));
            }
            Ok(refs)
        })();
        let refs = match setup {
            Ok(refs) => refs,
            Err(error) => {
                let _ = git::run_git(repo, &["worktree", "remove", "--force", worktree_str.as_ref()]);
                return Err(error);
            }
        };

        progress("status", "AI 正在分析合并顺序、处理冲突并验证…");
        let summary = match ai::merge_pull_requests(&worktree, &default_branch, &refs, locale, Some(&progress)) {
            Ok(summary) => summary,
            Err(error) => {
                return Err(AppError::msg(format!(
                    "AI 合并未完成。已保留集成分支 {integration_branch} 以便后续排查：{error}"
                )));
            }
        };
        if summary.lines().next().map(str::trim) != Some("MERGE_READY") {
            return Err(AppError::msg(format!(
                "AI 未确认验证通过，main 未被修改。已保留集成分支 {integration_branch}。\n{summary}"
            )));
        }

        let status = git::run_git(&worktree, &["status", "--porcelain=v1"])?;
        if !status.trim().is_empty() {
            return Err(AppError::msg(format!(
                "集成分支仍有未提交改动，main 未被修改。已保留 {integration_branch}。"
            )));
        }
        for (_, _, reference) in &refs {
            let (code, _, _) = git::run_git_allow_fail(&worktree, &["merge-base", "--is-ancestor", reference, "HEAD"])?;
            if code != 0 {
                return Err(AppError::msg(format!(
                    "集成结果不包含 {reference}，main 未被修改。已保留 {integration_branch}。"
                )));
            }
        }

        progress("status", "验证通过，正在安全合入 main…");
        git::run_git(repo, &["merge", "--ff-only", &integration_branch])?;
        git::push(repo)?;
        let _ = git::run_git(repo, &["worktree", "remove", "--force", worktree_str.as_ref()]);
        let _ = git::run_git(repo, &["branch", "-D", &integration_branch]);
        progress("status", "已合入 main 并同步远程。");

        Ok(MergePullRequestsResult {
            merged_count: prs.len(),
            summary: summary
                .lines()
                .skip_while(|line| line.trim() == "MERGE_READY")
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string(),
        })
    })
    .await
    .map_err(|error| AppError::msg(format!("任务中断：{error}")))?
}

#[tauri::command]
pub fn get_file_diff(id: String, path: String, staged: bool) -> AppResult<String> {
    let project = store::find_project(&id)?;
    git::file_diff(Path::new(&project.path), &path, staged)
}

#[tauri::command]
pub fn read_project_file(id: String, relative_path: String) -> AppResult<String> {
    let project = store::find_project(&id)?;
    crate::fs_safe::read_project_file(Path::new(&project.path), &relative_path)
}

#[tauri::command]
pub fn write_project_file(id: String, relative_path: String, content: String) -> AppResult<()> {
    let project = store::find_project(&id)?;
    crate::fs_safe::write_project_file(Path::new(&project.path), &relative_path, &content)
}

#[tauri::command]
pub async fn generate_commit_message(
    app: AppHandle,
    id: String,
    session_id: String,
    locale: ResolvedLanguage,
) -> AppResult<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress = ai::make_progress_sink(app.clone(), session_id);
        progress("status", "i18n:activity:backend.readingProject");
        let project = store::find_project(&id)?;
        let repo = Path::new(&project.path);
        let operations = app.state::<git::GitOperationState>();
        let _operation = operations.try_acquire(repo)?;
        progress("status", "i18n:activity:backend.collectingChanges");
        let diff = git::working_tree_diff(repo)?;
        ai::generate_commit_message(repo, &diff, locale, Some(&progress))
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
    locale: ResolvedLanguage,
) -> AppResult<OneClickResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress = ai::make_progress_sink(app.clone(), session_id);
        progress("status", "i18n:activity:backend.readingProject");
        let project = store::find_project(&id)?;
        let repo = Path::new(&project.path);
        let operations = app.state::<git::GitOperationState>();
        let _operation = operations.try_acquire(repo)?;

        progress("status", "i18n:activity:backend.collectingChanges");
        let diff = git::working_tree_diff(repo)?;

        progress("status", "i18n:activity:backend.generatingCommit");
        let message = ai::generate_commit_message(repo, &diff, locale, Some(&progress))?;

        progress("status", "i18n:activity:backend.creatingSnapshot");
        git::stage_all(repo)?;
        git::commit_staged(repo, &message)?;

        progress("status", "i18n:activity:backend.pushing");
        git::push(repo)?;

        progress("status", "i18n:activity:backend.oneClickDone");
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
pub fn get_default_prompt_templates(locale: ResolvedLanguage) -> PromptTemplateSet {
    crate::models::PromptTemplates::default()
        .for_language(locale)
        .clone()
}

#[tauri::command]
pub fn update_settings(settings: AppSettings) -> AppResult<AppSettings> {
    store::update_settings(settings)
}

#[tauri::command]
pub fn set_language_preference(
    app: AppHandle,
    preference: LanguagePreference,
    resolved_language: ResolvedLanguage,
) -> AppResult<AppSettings> {
    let previous = store::get_settings()?.language;
    let settings = store::set_language(preference)?;
    if let Err(error) = crate::update_tray_language(&app, resolved_language) {
        let _ = store::set_language(previous);
        return Err(AppError::msg(error.to_string()));
    }
    Ok(settings)
}

#[tauri::command]
pub fn sync_native_language(app: AppHandle, resolved_language: ResolvedLanguage) -> AppResult<()> {
    crate::update_tray_language(&app, resolved_language)
        .map_err(|error| AppError::msg(error.to_string()))
}

#[tauri::command]
pub async fn test_ai_connection(
    app: AppHandle,
    provider: AiProvider,
    session_id: String,
    locale: ResolvedLanguage,
) -> AppResult<AiConnectionTestResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress = ai::make_progress_sink(app, session_id);
        ai::test_connection(provider, locale, Some(&progress))
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
pub fn ensure_docs(id: String, locale: ResolvedLanguage) -> AppResult<DocsOverview> {
    let project = store::find_project(&id)?;
    docs::ensure_docs(Path::new(&project.path), locale)
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
pub fn delete_document_library_target(id: String, relative_path: String) -> AppResult<()> {
    let project = store::find_project(&id)?;
    let root = project
        .docs_root
        .ok_or_else(|| AppError::msg("尚未设置文档库"))?;
    docs::delete_library_target(Path::new(&project.path), &root, &relative_path)
}

#[tauri::command]
pub async fn run_document_library_target(
    app: AppHandle,
    id: String,
    relative_path: String,
    session_id: String,
    locale: ResolvedLanguage,
) -> AppResult<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress = ai::make_progress_sink(app, session_id);
        progress("status", "正在读取文档…");
        let project = store::find_project(&id)?;
        let root = project
            .docs_root
            .ok_or_else(|| AppError::msg("尚未设置文档库"))?;
        let repo = Path::new(&project.path);
        let content = docs::read_library_target(repo, &root, &relative_path)?;
        if content.trim().is_empty() {
            return Err(AppError::msg("文档内容为空"));
        }
        let settings = store::get_settings()?;
        progress("status", "正在执行文档…");
        ai::run_task(
            repo,
            &settings
                .prompt_templates
                .for_language(locale)
                .document_execute,
            &content,
            &relative_path,
            locale,
            Some(&progress),
        )
    })
    .await
    .map_err(|e| AppError::msg(format!("任务中断：{e}")))?
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
    locale: ResolvedLanguage,
) -> AppResult<GenerateTasksResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress = ai::make_progress_sink(app, session_id);
        progress("status", "i18n:activity:backend.readingGoal");
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

        progress("status", "i18n:activity:backend.planningTasks");
        let template = &settings.prompt_templates.for_language(locale).goal;
        let ai_out = ai::run_goal(repo, template, &goal_md, &context, locale, Some(&progress))?;
        progress("status", "i18n:activity:backend.writingTasks");
        let created = docs::write_tasks_from_ai_output(repo, &ai_out)?;
        let overview = docs::list_docs(repo)?;
        progress(
            "status",
            &if locale.is_zh() {
                format!("已生成 {created} 个任务")
            } else {
                format!("Generated {created} tasks")
            },
        );
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
    locale: ResolvedLanguage,
) -> AppResult<RunTaskResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress = ai::make_progress_sink(app, session_id);
        progress("status", "i18n:activity:backend.readingTask");
        let project = store::find_project(&id)?;
        let repo = Path::new(&project.path);
        let settings = store::get_settings()?;

        let task_md = docs::read_doc_file(repo, &relative_path)?;
        if task_md.trim().is_empty() {
            return Err(AppError::msg("任务文档为空"));
        }

        progress("status", "i18n:activity:backend.implementingTask");
        let template = &settings.prompt_templates.for_language(locale).task;
        let summary = ai::run_task(
            repo,
            template,
            &task_md,
            &relative_path,
            locale,
            Some(&progress),
        )?;
        progress("status", "i18n:activity:backend.writingResult");
        docs::append_task_result(repo, &relative_path, &summary)?;
        let overview = docs::list_docs(repo)?;
        progress("status", "i18n:activity:backend.taskDone");
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
    locale: ResolvedLanguage,
) -> AppResult<SuggestRunTargetsResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress = ai::make_progress_sink(app, session_id);
        let emit = |kind: &str, text: &str| progress(kind, text);

        emit("status", "i18n:activity:backend.readingProject");
        let project = store::find_project(&id)?;
        let project_name = project.name.clone();
        let repo_path = project.path.clone();

        emit("status", &if locale.is_zh() { format!("正在扫描「{project_name}」的仓库结构与脚本…") } else { format!("Scanning repository structure and scripts for “{project_name}”…") });
        let context = run::gather_context(Path::new(&repo_path))?;
        emit("log", &if locale.is_zh() { format!("已收集约 {} 字上下文，准备交给 AI…", context.chars().count()) } else { format!("Collected about {} characters of context for AI analysis…", context.chars().count()) });

        match ai::suggest_run_targets(Path::new(&repo_path), &context, locale, Some(&progress)) {
            Ok(raw) => {
                emit("status", "i18n:activity:backend.parsingTargets");
                match run::parse_suggested_targets(&raw) {
                    Ok(targets) => {
                        emit("status", &if locale.is_zh() { format!("识别完成，共建议 {} 条启动目标", targets.len()) } else { format!("Identification complete with {} run-target suggestions", targets.len()) });
                        Ok(SuggestRunTargetsResult {
                            targets,
                            source: "ai".into(),
                            warning: None,
                        })
                    }
                    Err(parse_err) => {
                        emit("log", &if locale.is_zh() { format!("AI 返回无法解析（{parse_err}），改用本地扫描…") } else { format!("Could not parse the AI response ({parse_err}); using local scanning…") });
                        let targets = run::suggest_from_fs(Path::new(&repo_path), locale)?;
                        emit("status", &if locale.is_zh() { format!("已用本地扫描得到 {} 条建议", targets.len()) } else { format!("Local scanning produced {} suggestions", targets.len()) });
                        Ok(SuggestRunTargetsResult {
                            targets,
                            source: "heuristic".into(),
                            warning: Some(if locale.is_zh() { format!("AI 返回无法解析（{parse_err}），已改用本地 package.json 扫描结果") } else { format!("Could not parse the AI response ({parse_err}); using local package.json results") }),
                        })
                    }
                }
            }
            Err(ai_err) => {
                emit("error", &if locale.is_zh() { format!("AI 不可用：{ai_err}") } else { format!("AI is unavailable: {ai_err}") });
                emit("status", "i18n:activity:backend.fallbackScan");
                let targets = run::suggest_from_fs(Path::new(&repo_path), locale).map_err(|scan_err| {
                    AppError::msg(format!(
                        "{ai_err}\n\n本地扫描也失败：{scan_err}\n\n可在设置中切换 AI 通道，或运行 agent login / codex login 后重试；也可点「手动添加一条」。"
                    ))
                })?;
                emit("status", &if locale.is_zh() { format!("已用本地扫描得到 {} 条建议", targets.len()) } else { format!("Local scanning produced {} suggestions", targets.len()) });
                Ok(SuggestRunTargetsResult {
                    targets,
                    source: "heuristic".into(),
                    warning: Some(if locale.is_zh() { format!("AI 不可用（{ai_err}）。已改用本地 package.json 扫描；可在「设置」登录对应 CLI 或切换通道后再识别。") } else { format!("AI is unavailable ({ai_err}). Local package.json scanning was used; sign in to the CLI or switch providers in Settings to retry.") }),
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
        .ok_or_else(|| {
            AppError::coded_with_params(
                "runTargetNotFound",
                [("id".into(), serde_json::json!(target_id))]
                    .into_iter()
                    .collect(),
                None,
            )
        })?;
    // 对本仓库的「升级 APP」走专用自升级（先退出再替换），避免覆盖正在运行的自身。
    if target.kind.as_deref() == Some("upgrade")
        && crate::upgrade::is_self_repo(Path::new(&project.path))
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
pub fn update_log_diary_by_run_session(
    entry: UpdateLogDiaryByRunSession,
) -> AppResult<Option<LogDiaryEntry>> {
    log_diary::update_by_run_session(entry)
}

/// 加载日志前对账：仍「进行中」但对不到活跃运行会话的条目标为「已结束」。
#[tauri::command]
pub fn reconcile_log_diary(manager: State<run::RunManager>) -> AppResult<Vec<LogDiaryEntry>> {
    let active_ids: Vec<String> = manager
        .list()
        .into_iter()
        .filter(|s| matches!(s.status.as_str(), "running" | "starting" | "stopping"))
        .map(|s| s.id)
        .collect();
    log_diary::reconcile_stale_running(&active_ids)
}

#[tauri::command]
pub fn clear_log_diary() -> AppResult<()> {
    log_diary::clear_logs()
}

#[tauri::command]
pub fn delete_log_diary(id: String) -> AppResult<bool> {
    log_diary::delete_log(&id)
}

/// 解析 `HH:MM`；非法时回退到 00:00。
fn parse_daily_completion_hm(raw: &str) -> (u32, u32) {
    let mut parts = raw.trim().split(':');
    let hour = parts
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| *value <= 23)
        .unwrap_or(0);
    let minute = parts
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| *value <= 59)
        .unwrap_or(0);
    (hour, minute)
}

/// 以设定的每日总结时间为极点，取最近一个已结束日界对应的过去 24 小时。
/// 例如设定 01:00：在 01:00 及之后，窗口为「昨日 01:00 → 今日 01:00」。
fn daily_completion_window(
    now: chrono::DateTime<chrono::Local>,
    daily_time: &str,
) -> (String, String, String) {
    use chrono::{Duration, NaiveTime};

    let (hour, minute) = parse_daily_completion_hm(daily_time);
    let pole_time =
        NaiveTime::from_hms_opt(hour, minute, 0).unwrap_or_else(|| NaiveTime::from_hms_opt(0, 0, 0).unwrap());
    let today = now.date_naive();
    let pole_today = today.and_time(pole_time);
    let now_naive = now.naive_local();
    let until = if now_naive >= pole_today {
        pole_today
    } else {
        pole_today - Duration::days(1)
    };
    let since = until - Duration::hours(24);
    let git_fmt = "%Y-%m-%d %H:%M:%S";
    (
        since.format(git_fmt).to_string(),
        until.format(git_fmt).to_string(),
        until.format("%Y/%m/%d").to_string(),
    )
}

#[tauri::command]
pub async fn generate_daily_completion(
    app: AppHandle,
    period: String,
    session_id: String,
    locale: ResolvedLanguage,
) -> AppResult<DailyCompletionResult> {
    tauri::async_runtime::spawn_blocking(move || {
        use chrono::{Datelike, Duration, Local};

        let progress = ai::make_progress_sink(app, session_id);
        let now = Local::now();
        let today = now.date_naive();

        // 自动与手动「本日」同一流程：以设定时间为极点，取过去 24 小时；标题为极点日 YYYY/MM/DD。
        let (period_label, since, until, title) = match period.as_str() {
            "today" => {
                let settings = store::get_settings()?;
                let (since, until, title) =
                    daily_completion_window(now, &settings.daily_completion_time);
                (
                    if locale.is_zh() { "今天" } else { "today" },
                    since,
                    Some(until),
                    title,
                )
            }
            "week" => {
                let weekday = today.weekday().num_days_from_monday() as i64;
                let week_start = today - Duration::days(weekday);
                (
                    if locale.is_zh() { "本周" } else { "this week" },
                    "monday".to_string(),
                    None,
                    format!("{} – {}", week_start.format("%Y/%m/%d"), today.format("%Y/%m/%d")),
                )
            }
            "sevenDays" => {
                let start = today - Duration::days(7);
                (
                    if locale.is_zh() {
                        "过去 7 天"
                    } else {
                        "the past 7 days"
                    },
                    "7 days ago".to_string(),
                    None,
                    format!("{} – {}", start.format("%Y/%m/%d"), today.format("%Y/%m/%d")),
                )
            }
            _ => return Err(AppError::msg("不支持的总结时间范围")),
        };

        progress("status", "i18n:activity:backend.collectingCommits");
        let mut blocks = Vec::new();
        for project in store::list_projects()? {
            match git::commit_subjects_since(Path::new(&project.path), &since, until.as_deref()) {
                Ok(subjects) if !subjects.is_empty() => {
                    let mut block = Vec::with_capacity(subjects.len() + 1);
                    if locale.is_zh() {
                        block.push(format!("项目：{}", project.name));
                    } else {
                        block.push(format!("Project: {}", project.name));
                    }
                    block.extend(subjects.into_iter().map(|subject| format!("- {subject}")));
                    blocks.push(block.join("\n"));
                }
                Ok(_) => {}
                Err(err) => progress("log", &format!("跳过 {}：{err}", project.name)),
            }
        }
        let commits = blocks.join("\n\n");
        let body = ai::summarize_daily_completion(period_label, &commits, locale, Some(&progress))?;
        Ok(DailyCompletionResult { title, body })
    })
    .await
    .map_err(|e| AppError::msg(format!("总结任务中断：{e}")))?
}

#[cfg(test)]
mod daily_completion_window_tests {
    use super::{daily_completion_window, parse_daily_completion_hm};
    use chrono::{Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone};

    fn at(date: NaiveDate, hour: u32, minute: u32) -> chrono::DateTime<Local> {
        let naive = NaiveDateTime::new(
            date,
            NaiveTime::from_hms_opt(hour, minute, 0).expect("valid time"),
        );
        Local
            .from_local_datetime(&naive)
            .single()
            .expect("local datetime")
    }

    #[test]
    fn parse_hhmm_defaults_invalid_to_midnight() {
        assert_eq!(parse_daily_completion_hm("01:30"), (1, 30));
        assert_eq!(parse_daily_completion_hm("25:00"), (0, 0));
        assert_eq!(parse_daily_completion_hm("bad"), (0, 0));
    }

    #[test]
    fn window_uses_configured_pole_for_past_24_hours() {
        let day = NaiveDate::from_ymd_opt(2026, 7, 23).unwrap();
        let (since, until, title) = daily_completion_window(at(day, 1, 5), "01:00");
        assert_eq!(since, "2026-07-22 01:00:00");
        assert_eq!(until, "2026-07-23 01:00:00");
        assert_eq!(title, "2026/07/23");
    }

    #[test]
    fn window_before_pole_uses_previous_day_boundary() {
        let day = NaiveDate::from_ymd_opt(2026, 7, 23).unwrap();
        let (since, until, title) = daily_completion_window(at(day, 0, 30), "01:00");
        assert_eq!(since, "2026-07-21 01:00:00");
        assert_eq!(until, "2026-07-22 01:00:00");
        assert_eq!(title, "2026/07/22");
    }
}
