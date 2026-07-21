use crate::error::{AppError, AppResult};
use crate::models::{AiConnectionTestResult, AiProvider};
use crate::store;
use serde::Serialize;
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter};

const MAX_DIFF_CHARS: usize = 80_000;
const MAX_PROMPT_CHARS: usize = 120_000;

/// 前端可订阅的 AI 进度事件（`ai-progress`）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProgressEvent {
    pub session_id: String,
    /// status | thinking | assistant | log | error
    pub kind: String,
    pub text: String,
}

pub type ProgressSink = Arc<dyn Fn(&str, &str) + Send + Sync>;

pub fn make_progress_sink(app: AppHandle, session_id: String) -> ProgressSink {
    Arc::new(move |kind: &str, text: &str| {
        let _ = app.emit(
            "ai-progress",
            AiProgressEvent {
                session_id: session_id.clone(),
                kind: kind.to_string(),
                text: text.to_string(),
            },
        );
    })
}

fn emit(progress: Option<&ProgressSink>, kind: &str, text: &str) {
    if let Some(p) = progress {
        if !text.trim().is_empty() {
            p(kind, text);
        }
    }
}

/// 设置页连通性测试：对指定 Provider 发一条最小只读请求，确认 CLI 已安装、已登录且可返回内容。
/// 传入的 `provider` 为当前界面选中项（可尚未保存），便于切换后立刻验证。
pub fn test_connection(
    provider: AiProvider,
    progress: Option<&ProgressSink>,
) -> AppResult<AiConnectionTestResult> {
    let label = label_for(provider);
    emit(progress, "status", &format!("正在测试 {label}…"));

    let prompt =
        "你是连通性测试助手。请只回复两个字：连通。不要解释、不要代码块、不要执行任何命令。";
    let reply = match provider {
        AiProvider::Codex => run_codex(prompt, None, false, progress)?,
        AiProvider::CursorAgent => run_cursor_agent(prompt, None, false, progress)?,
    };
    let reply = truncate_for_ui(&reply, 120);
    emit(progress, "assistant", &reply);
    Ok(AiConnectionTestResult {
        provider,
        provider_label: label.to_string(),
        reply,
    })
}

fn label_for(provider: AiProvider) -> &'static str {
    match provider {
        AiProvider::Codex => "Codex CLI",
        AiProvider::CursorAgent => "Cursor Agent CLI",
    }
}

fn truncate_for_ui(s: &str, max_chars: usize) -> String {
    let trimmed = s.trim();
    let count = trimmed.chars().count();
    if count <= max_chars {
        trimmed.to_string()
    } else {
        let truncated: String = trimmed.chars().take(max_chars).collect();
        format!("{truncated}…")
    }
}

/// 统一 AI 入口：按设置中的 AI Provider 路由到 Codex CLI 或 Cursor Agent CLI。
/// 本项目所有需要调用 AI 的能力都必须走此通道，禁止绕过。
pub fn generate_commit_message(
    changes_diff: &str,
    progress: Option<&ProgressSink>,
) -> AppResult<String> {
    if changes_diff.trim().is_empty() {
        return Err(AppError::msg("当前没有可提交的 Changes，无法生成 Commit message"));
    }

    let label = provider_label().unwrap_or("AI");
    emit(
        progress,
        "status",
        &format!("使用 {label} 生成 Commit message…"),
    );

    let truncated = if changes_diff.len() > MAX_DIFF_CHARS {
        format!(
            "{}\n\n...[diff truncated, {} chars total]",
            &changes_diff[..MAX_DIFF_CHARS],
            changes_diff.len()
        )
    } else {
        changes_diff.to_string()
    };

    let prompt = format!(
        "你是 Git commit message 助手。根据下方全部 Changes 的 diff，生成一条简体中文的 commit message。\n\
         要求：\n\
         1. 只输出 commit message 本身，不要解释、不要代码块、不要引号\n\
         2. 第一行尽量不超过 60 个中文字符，简洁说明实际修改\n\
         3. 如有必要可加简短正文，用空行分隔\n\
         4. 不要执行任何命令，不要修改文件\n\n\
         Changes diff:\n{truncated}"
    );

    run_readonly(&prompt, None, progress)
}

/// 根据多个仓库的 commit message 生成面向用户的工作总结。
/// 与其它 AI 功能一样，始终经 `run_readonly` 按当前 Provider 路由。
pub fn summarize_daily_completion(
    period_label: &str,
    commits: &str,
    progress: Option<&ProgressSink>,
) -> AppResult<String> {
    if commits.trim().is_empty() {
        return Ok("这段时间还没有新的提交。".to_string());
    }
    let label = provider_label().unwrap_or("AI");
    emit(
        progress,
        "status",
        &format!("使用 {label} 整理{period_label}完成事项…"),
    );
    let prompt = format!(
        "你是 Git 工作总结助手。仅依据下方 commit message，总结用户{period_label}做了什么。\n\
         要求：\n\
         1. 使用简体中文，输出 3-6 条简短要点；若工作不足 3 项则按实际输出\n\
         2. 合并同类提交，写清完成的功能、修复或改进，不要臆测\n\
         3. 不要标题、前言、代码块、项目名或 commit hash\n\
         4. 每条以「- 」开头，适合放入手机分享卡片\n\n\
         Commit messages:\n{commits}"
    );
    run_readonly(&truncate_prompt(&prompt), None, progress)
}

/// 根据目标拆分任务（只读 / 分析，不改业务代码）。
pub fn run_goal(
    project_path: &Path,
    template: &str,
    goal_md: &str,
    project_context: &str,
    progress: Option<&ProgressSink>,
) -> AppResult<String> {
    let label = provider_label().unwrap_or("AI");
    emit(
        progress,
        "status",
        &format!("使用 {label} 根据目标拆分任务…"),
    );

    let prompt =
        format!("{template}\n\n【项目目标】\n{goal_md}\n\n【项目现状】\n{project_context}\n");
    let prompt = truncate_prompt(&prompt);
    run_readonly(&prompt, Some(project_path), progress)
}

/// 在项目目录中落地实现任务（可写）。
pub fn run_task(
    project_path: &Path,
    template: &str,
    task_md: &str,
    task_path: &str,
    progress: Option<&ProgressSink>,
) -> AppResult<String> {
    let label = provider_label().unwrap_or("AI");
    emit(
        progress,
        "status",
        &format!("使用 {label} 实现任务（{task_path}）…"),
    );

    let prompt = format!("{template}\n\n【任务文件】{task_path}\n\n【任务文档】\n{task_md}\n");
    let prompt = truncate_prompt(&prompt);
    run_writable(&prompt, project_path, progress)
}

fn truncate_prompt(prompt: &str) -> String {
    if prompt.len() <= MAX_PROMPT_CHARS {
        prompt.to_string()
    } else {
        format!(
            "{}\n\n...[prompt truncated, {} chars total]",
            &prompt[..MAX_PROMPT_CHARS],
            prompt.len()
        )
    }
}

fn run_readonly(
    prompt: &str,
    cwd: Option<&Path>,
    progress: Option<&ProgressSink>,
) -> AppResult<String> {
    match store::get_settings()?.ai_provider {
        AiProvider::Codex => run_codex(prompt, cwd, false, progress),
        AiProvider::CursorAgent => run_cursor_agent(prompt, cwd, false, progress),
    }
}

fn run_writable(prompt: &str, cwd: &Path, progress: Option<&ProgressSink>) -> AppResult<String> {
    match store::get_settings()?.ai_provider {
        AiProvider::Codex => run_codex(prompt, Some(cwd), true, progress),
        AiProvider::CursorAgent => run_cursor_agent(prompt, Some(cwd), true, progress),
    }
}

fn provider_label() -> AppResult<&'static str> {
    Ok(label_for(store::get_settings()?.ai_provider))
}

fn run_codex(
    prompt: &str,
    cwd: Option<&Path>,
    writable: bool,
    progress: Option<&ProgressSink>,
) -> AppResult<String> {
    let bin = resolve_bin(
        "codex",
        &[],
        "未找到 Codex CLI。请先安装并登录：npm i -g @openai/codex && codex login",
    )?;

    let tmp = std::env::temp_dir().join(format!("gittracker-ai-{}.txt", uuid::Uuid::new_v4()));

    let sandbox = if writable {
        "workspace-write"
    } else {
        "read-only"
    };

    let stream = progress.is_some();
    let mut args: Vec<String> = vec![
        "exec".into(),
        "--sandbox".into(),
        sandbox.into(),
        "--ephemeral".into(),
        "--skip-git-repo-check".into(),
        "-o".into(),
        tmp.to_string_lossy().into_owned(),
    ];
    if stream {
        args.push("--json".into());
    }
    if writable {
        args.push("--ask-for-approval".into());
        args.push("never".into());
    }
    if let Some(dir) = cwd {
        args.push("-C".into());
        args.push(dir.to_string_lossy().into_owned());
    }
    args.push(prompt.to_string());

    emit(progress, "status", "正在启动 Codex CLI…");

    let mut cmd = Command::new(&bin);
    cmd.args(&args)
        .env("PATH", augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    if !stream {
        let output = cmd.output().map_err(|e| {
            AppError::msg(format!(
                "无法启动 Codex CLI：{e}。请确认已安装并登录 Codex。"
            ))
        })?;
        return finish_codex_output(output, &tmp);
    }

    let mut child = cmd.spawn().map_err(|e| {
        AppError::msg(format!(
            "无法启动 Codex CLI：{e}。请确认已安装并登录 Codex。"
        ))
    })?;

    emit(progress, "status", "Codex 正在分析项目…");

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let progress_out = progress.cloned();
    let progress_err = progress.cloned();

    let out_handle = thread::spawn(move || {
        let Some(stdout) = stdout else {
            return String::new();
        };
        let reader = BufReader::new(stdout);
        let mut raw = String::new();
        for line in reader.lines().flatten() {
            raw.push_str(&line);
            raw.push('\n');
            if let Some(ref p) = progress_out {
                forward_codex_json_line(p.as_ref(), &line);
            }
        }
        raw
    });

    let err_handle = thread::spawn(move || {
        let Some(stderr) = stderr else {
            return String::new();
        };
        let reader = BufReader::new(stderr);
        let mut raw = String::new();
        for line in reader.lines().flatten() {
            raw.push_str(&line);
            raw.push('\n');
            if let Some(ref p) = progress_err {
                let trimmed = line.trim();
                if !trimmed.is_empty() && !looks_like_noise(trimmed) {
                    p("log", trimmed);
                }
            }
        }
        raw
    });

    let status = child
        .wait()
        .map_err(|e| AppError::msg(format!("Codex 执行失败：{e}")))?;
    let _stdout_raw = out_handle.join().unwrap_or_default();
    let stderr_raw = err_handle.join().unwrap_or_default();

    let mut message = if tmp.exists() {
        let content = std::fs::read_to_string(&tmp).unwrap_or_default();
        let _ = std::fs::remove_file(&tmp);
        content
    } else {
        String::new()
    };

    if !status.success() && message.trim().is_empty() {
        let stderr = stderr_raw.trim().to_string();
        return Err(AppError::msg(if stderr.is_empty() {
            "Codex 执行失败，请确认已登录 Codex CLI".into()
        } else {
            format!("Codex 执行失败：{stderr}")
        }));
    }

    message = clean_message(&message);
    if message.is_empty() {
        return Err(AppError::msg("Codex 未返回有效内容"));
    }
    emit(progress, "status", "Codex 已完成，正在整理结果…");
    Ok(message)
}

fn finish_codex_output(output: std::process::Output, tmp: &Path) -> AppResult<String> {
    let mut message = if tmp.exists() {
        let content = std::fs::read_to_string(tmp).unwrap_or_default();
        let _ = std::fs::remove_file(tmp);
        content
    } else {
        String::from_utf8_lossy(&output.stdout).to_string()
    };

    if !output.status.success() && message.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::msg(if stderr.is_empty() {
            "Codex 执行失败，请确认已登录 Codex CLI".into()
        } else {
            format!("Codex 执行失败：{stderr}")
        }));
    }

    message = clean_message(&message);
    if message.is_empty() {
        return Err(AppError::msg("Codex 未返回有效内容"));
    }
    Ok(message)
}

fn forward_codex_json_line(progress: &dyn Fn(&str, &str), line: &str) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }
    let Ok(v) = serde_json::from_str::<Value>(trimmed) else {
        if !looks_like_noise(trimmed) {
            progress("log", trimmed);
        }
        return;
    };

    let event_type = v
        .get("type")
        .or_else(|| v.get("msg").and_then(|m| m.get("type")))
        .and_then(|t| t.as_str())
        .unwrap_or("");

    match event_type {
        "agent_message" | "agent_message_content_delta" | "message" => {
            if let Some(text) = extract_text_field(&v) {
                progress("assistant", &text);
            }
        }
        "agent_reasoning" | "agent_reasoning_delta" | "reasoning" | "thinking" => {
            if let Some(text) = extract_text_field(&v) {
                progress("thinking", &text);
            }
        }
        "task_started" => progress("status", "Codex 任务已开始…"),
        "task_complete" | "turn_complete" => progress("status", "Codex 回合完成…"),
        "error" => {
            if let Some(text) = extract_text_field(&v) {
                progress("error", &text);
            }
        }
        _ => {
            if let Some(text) = v.get("text").and_then(|t| t.as_str()) {
                if !text.trim().is_empty() {
                    progress("log", text.trim());
                }
            }
        }
    }
}

fn extract_text_field(v: &Value) -> Option<String> {
    for key in ["text", "delta", "message", "content", "reason"] {
        if let Some(s) = v.get(key).and_then(|x| x.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    if let Some(msg) = v.get("msg") {
        return extract_text_field(msg);
    }
    if let Some(item) = v.get("item") {
        return extract_text_field(item);
    }
    None
}

fn run_cursor_agent(
    prompt: &str,
    cwd: Option<&Path>,
    writable: bool,
    progress: Option<&ProgressSink>,
) -> AppResult<String> {
    let bin = resolve_bin(
        "agent",
        &["cursor-agent"],
        "未找到 Cursor Agent CLI。请先安装并登录：curl https://cursor.com/install -fsS | bash && agent login",
    )?;

    let mode = if writable { "agent" } else { "ask" };
    let sandbox = if writable { "disabled" } else { "enabled" };
    let stream = progress.is_some();

    let mut args = vec![
        "-p".into(),
        "--mode".into(),
        mode.into(),
        "--output-format".into(),
        if stream {
            "stream-json".into()
        } else {
            "text".into()
        },
        "--sandbox".into(),
        sandbox.into(),
        "--trust".into(),
    ];
    if stream {
        args.push("--stream-partial-output".into());
    }
    if let Some(dir) = cwd {
        args.push("--workspace".into());
        args.push(dir.to_string_lossy().into_owned());
    }
    args.push(prompt.to_string());

    emit(progress, "status", "正在启动 Cursor Agent CLI…");

    let mut cmd = Command::new(&bin);
    cmd.args(&args)
        .env("PATH", augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    if !stream {
        let output = cmd.output().map_err(|e| {
            AppError::msg(format!(
                "无法启动 Cursor Agent CLI：{e}。请确认已安装并登录（agent login）。"
            ))
        })?;
        return finish_cursor_output(output);
    }

    let mut child = cmd.spawn().map_err(|e| {
        AppError::msg(format!(
            "无法启动 Cursor Agent CLI：{e}。请确认已安装并登录（agent login）。"
        ))
    })?;

    emit(progress, "status", "Cursor Agent 正在分析项目…");

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let progress_out = progress.cloned();
    let progress_err = progress.cloned();

    let out_handle = thread::spawn(move || {
        let Some(stdout) = stdout else {
            return CursorStreamAcc::default();
        };
        let reader = BufReader::new(stdout);
        let mut acc = CursorStreamAcc::default();
        for line in reader.lines().flatten() {
            if let Some(ref p) = progress_out {
                forward_cursor_json_line(p.as_ref(), &line, &mut acc);
            } else {
                acc.raw_lines.push(line);
            }
        }
        acc
    });

    let err_handle = thread::spawn(move || {
        let Some(stderr) = stderr else {
            return String::new();
        };
        let reader = BufReader::new(stderr);
        let mut raw = String::new();
        for line in reader.lines().flatten() {
            raw.push_str(&line);
            raw.push('\n');
            if let Some(ref p) = progress_err {
                let trimmed = line.trim();
                if !trimmed.is_empty() && !looks_like_noise(trimmed) {
                    p("log", trimmed);
                }
            }
        }
        raw
    });

    let status = child
        .wait()
        .map_err(|e| AppError::msg(format!("Cursor Agent 执行失败：{e}")))?;
    let acc = out_handle.join().unwrap_or_default();
    let stderr_raw = err_handle.join().unwrap_or_default();

    let mut message = if let Some(result) = acc.final_result {
        result
    } else {
        acc.assistant_text
    };

    if !status.success() && message.trim().is_empty() {
        let stderr = stderr_raw.trim().to_string();
        return Err(AppError::msg(if stderr.is_empty() {
            "Cursor Agent 执行失败，请确认已登录 Cursor CLI（agent login）".into()
        } else {
            format!("Cursor Agent 执行失败：{stderr}")
        }));
    }

    message = clean_message(&message);
    if message.is_empty() {
        return Err(AppError::msg("Cursor Agent 未返回有效内容"));
    }
    emit(progress, "status", "Cursor Agent 已完成，正在整理结果…");
    Ok(message)
}

#[derive(Default)]
struct CursorStreamAcc {
    assistant_text: String,
    final_result: Option<String>,
    raw_lines: Vec<String>,
    /// 已展示过完整 assistant 气泡时，避免重复刷同一段
    last_assistant_emitted: String,
}

fn forward_cursor_json_line(progress: &dyn Fn(&str, &str), line: &str, acc: &mut CursorStreamAcc) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }
    let Ok(v) = serde_json::from_str::<Value>(trimmed) else {
        if !looks_like_noise(trimmed) {
            progress("log", trimmed);
        }
        return;
    };

    let event_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
    let subtype = v.get("subtype").and_then(|t| t.as_str()).unwrap_or("");

    match event_type {
        "system" if subtype == "init" => {
            let model = v.get("model").and_then(|m| m.as_str()).unwrap_or("unknown");
            progress("status", &format!("已连接 Cursor Agent（模型：{model}）"));
        }
        "user" => {
            progress("status", "已发送分析请求…");
        }
        "thinking" => {
            if let Some(text) = v.get("text").and_then(|t| t.as_str()) {
                let t = text.trim();
                if !t.is_empty() {
                    progress("thinking", t);
                }
            } else if subtype == "completed" {
                progress("status", "思考完成，正在生成建议…");
            }
        }
        "assistant" => {
            if let Some(text) = extract_assistant_text(&v) {
                // stream-json 可能先发 delta 再发完整 message；避免整段重复刷屏
                if text != acc.last_assistant_emitted {
                    let delta = if text.starts_with(&acc.last_assistant_emitted)
                        && !acc.last_assistant_emitted.is_empty()
                    {
                        text[acc.last_assistant_emitted.len()..].to_string()
                    } else if acc.assistant_text.is_empty()
                        || !text.starts_with(&acc.assistant_text)
                    {
                        text.clone()
                    } else {
                        text[acc.assistant_text.len()..].to_string()
                    };
                    if !delta.trim().is_empty() {
                        progress("assistant", delta.trim_end());
                    }
                    acc.last_assistant_emitted = text.clone();
                }
                if text.len() >= acc.assistant_text.len() {
                    acc.assistant_text = text;
                }
            }
        }
        "tool_call" | "tool_result" => {
            let name = v
                .get("name")
                .or_else(|| v.pointer("/tool_call/name"))
                .or_else(|| v.pointer("/message/name"))
                .and_then(|n| n.as_str())
                .unwrap_or(event_type);
            progress("log", &format!("工具：{name}"));
        }
        "result" => {
            if let Some(result) = v.get("result").and_then(|r| r.as_str()) {
                acc.final_result = Some(result.to_string());
            }
            if subtype == "success" {
                progress("status", "分析完成");
            } else if v.get("is_error").and_then(|e| e.as_bool()) == Some(true) {
                let err = v
                    .get("result")
                    .and_then(|r| r.as_str())
                    .unwrap_or("Cursor Agent 返回错误");
                progress("error", err);
            }
        }
        _ => {}
    }
}

fn extract_assistant_text(v: &Value) -> Option<String> {
    if let Some(arr) = v.pointer("/message/content").and_then(|c| c.as_array()) {
        let mut parts = Vec::new();
        for item in arr {
            if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                    parts.push(t.to_string());
                }
            }
        }
        if !parts.is_empty() {
            return Some(parts.join(""));
        }
    }
    v.get("text")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
}

fn finish_cursor_output(output: std::process::Output) -> AppResult<String> {
    let mut message = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.status.success() && message.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::msg(if stderr.is_empty() {
            "Cursor Agent 执行失败，请确认已登录 Cursor CLI（agent login）".into()
        } else {
            format!("Cursor Agent 执行失败：{stderr}")
        }));
    }

    message = clean_message(&message);
    if message.is_empty() {
        return Err(AppError::msg("Cursor Agent 未返回有效内容"));
    }
    Ok(message)
}

fn looks_like_noise(line: &str) -> bool {
    line.starts_with("npm ")
        || line.contains("Debugger listening")
        || line.contains("ExperimentalWarning")
}

fn resolve_bin(primary: &str, aliases: &[&str], missing_msg: &str) -> AppResult<PathBuf> {
    let mut names = vec![primary];
    names.extend_from_slice(aliases);

    for name in &names {
        if let Some(path) = which_bin(name) {
            return Ok(path);
        }
    }

    for dir in crate::path_env::cli_bin_dirs() {
        for name in &names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    Err(AppError::msg(missing_msg))
}

fn which_bin(name: &str) -> Option<PathBuf> {
    let output = Command::new("which")
        .arg(name)
        .env("PATH", augmented_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        return None;
    }
    let p = PathBuf::from(&path);
    if p.is_file() {
        Some(p)
    } else {
        None
    }
}

fn augmented_path() -> String {
    crate::path_env::augmented_path()
}

fn clean_message(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if s.starts_with("```") {
        if let Some(rest) = s.strip_prefix("```") {
            let rest = rest
                .strip_prefix("text")
                .or_else(|| rest.strip_prefix("markdown"))
                .or_else(|| rest.strip_prefix("json"))
                .unwrap_or(rest);
            s = rest.trim().to_string();
        }
        if let Some(idx) = s.rfind("```") {
            s = s[..idx].trim().to_string();
        }
    }
    s.trim_matches(|c| c == '"' || c == '\'').trim().to_string()
}

/// 根据仓库上下文建议启动目标（只读分析，不执行命令）。
pub fn suggest_run_targets(
    project_path: &Path,
    context: &str,
    progress: Option<&ProgressSink>,
) -> AppResult<String> {
    let label = provider_label().unwrap_or("AI");
    emit(
        progress,
        "status",
        &format!("使用 {label} 识别启动方式（只读分析，不会执行命令）"),
    );

    let prompt = format!(
        "你是项目启动方式助手。根据下方【仓库上下文】，判断该仓库有哪些常用启动方式。\n\
         可能是网页（Next/Vite 等）、桌面（Tauri/Electron/py2app 等），或 monorepo 多端并存。\n\n\
         要求：\n\
         1. 只输出一个 JSON 数组，不要解释、不要 Markdown 标题\n\
         2. 每项字段：name、description、cwd、command、kind、isDefault\n\
         3. name：2～8 字动作短语，普通人一眼能懂。优先用这类说法：\n\
            「启动 APP」「打包 APP」「升级 APP」「启动网页」「启动桌面」「启动后台」「启动菜单栏」\n\
            不要把 py2app、模块路径、脚本文件名写进 name\n\
         4. description：一句人话说明「做什么、给谁用」。例如：\n\
            「打开已打包好的 macOS 应用」\n\
            「用 py2app 打成 .app（开发别名模式）」\n\
            「打包后替换 /Applications 里的旧版并打开」\n\
            「无界面后台服务，供菜单栏调用」\n\
            「用脚本启动菜单栏（开发调试）」\n\
         5. cwd：相对仓库根，如 \".\" 或 \"apps/web\"\n\
         6. command：一行 shell（含包管理器）；技术细节只放这里\n\
         7. kind：dev|build|open|upgrade|custom（打包用 build，打开 .app 用 open，打包并替换安装用 upgrade）\n\
         8. isDefault：布尔，至多一个 true；日常开发优先，不要把打包/升级/打开已构建 App 设为默认\n\
         9. 同类目标可并存，但 name 要能区分（如「启动 APP」与「启动菜单栏」）\n\
         10. 双端仓库请分别给出网页与桌面目标\n\
         11. 命令要符合上下文里的 package manager 与 scripts\n\
         12. 若是 macOS 桌面项目（Tauri / Electron / py2app 等），除「打包 APP」外务必再给一条「升级 APP」：\n\
             先 build 出 .app，再退出已安装应用（如有），用 ditto 替换 /Applications 下同名 .app，最后 open 打开。\n\
             kind 必须为 upgrade；不要把「升级 APP」设为默认\n\
         13. 不要执行任何命令，不要修改文件\n\n\
         【仓库上下文】\n{context}\n"
    );
    let prompt = truncate_prompt(&prompt);
    run_readonly(&prompt, Some(project_path), progress)
}

#[allow(dead_code)]
pub fn write_prompt_via_stdin(prompt: &str) -> AppResult<String> {
    let bin = resolve_bin(
        "codex",
        &[],
        "未找到 Codex CLI。请先安装并登录：npm i -g @openai/codex && codex login",
    )?;
    let mut child = Command::new(&bin)
        .args([
            "exec",
            "--sandbox",
            "read-only",
            "--ephemeral",
            "--skip-git-repo-check",
            "-",
        ])
        .env("PATH", augmented_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::msg(format!("无法启动 Codex CLI：{e}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes())?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| AppError::msg(format!("Codex 执行失败：{e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::msg(format!("Codex 生成失败：{stderr}")));
    }

    Ok(clean_message(&String::from_utf8_lossy(&output.stdout)))
}
