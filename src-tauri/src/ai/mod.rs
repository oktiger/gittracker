use crate::error::{AppError, AppResult};
use crate::models::AiProvider;
use crate::store;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

const MAX_DIFF_CHARS: usize = 80_000;

/// 统一 AI 入口：按设置中的 AI Provider 路由到 Codex CLI 或 Cursor Agent CLI。
/// 本项目所有需要调用 AI 的能力都必须走此通道，禁止绕过。
pub fn generate_commit_message(staged_diff: &str) -> AppResult<String> {
    if staged_diff.trim().is_empty() {
        return Err(AppError::msg("没有 staged diff，无法生成 Commit message"));
    }

    let truncated = if staged_diff.len() > MAX_DIFF_CHARS {
        format!(
            "{}\n\n...[diff truncated, {} chars total]",
            &staged_diff[..MAX_DIFF_CHARS],
            staged_diff.len()
        )
    } else {
        staged_diff.to_string()
    };

    let prompt = format!(
        "你是 Git commit message 助手。根据下方 staged diff，生成一条简体中文的 commit message。\n\
         要求：\n\
         1. 只输出 commit message 本身，不要解释、不要代码块、不要引号\n\
         2. 第一行尽量不超过 60 个中文字符，简洁说明实际修改\n\
         3. 如有必要可加简短正文，用空行分隔\n\
         4. 不要执行任何命令，不要修改文件\n\n\
         Staged diff:\n{truncated}"
    );

    match store::get_settings()?.ai_provider {
        AiProvider::Codex => run_codex(&prompt),
        AiProvider::CursorAgent => run_cursor_agent(&prompt),
    }
}

fn run_codex(prompt: &str) -> AppResult<String> {
    let bin = resolve_bin(
        "codex",
        &[],
        "未找到 Codex CLI。请先安装并登录：npm i -g @openai/codex && codex login",
    )?;

    // Prefer writing last message to a temp file for reliability.
    let tmp = std::env::temp_dir().join(format!(
        "gittracker-commit-{}.txt",
        uuid::Uuid::new_v4()
    ));

    let output = Command::new(&bin)
        .args([
            "exec",
            "--sandbox",
            "read-only",
            "--ephemeral",
            "--skip-git-repo-check",
            "-o",
            tmp.to_str().unwrap_or("/tmp/gittracker-commit.txt"),
            prompt,
        ])
        .env("PATH", augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| {
            AppError::msg(format!(
                "无法启动 Codex CLI：{e}。请确认已安装并登录 Codex。"
            ))
        })?;

    let mut message = if tmp.exists() {
        let content = std::fs::read_to_string(&tmp).unwrap_or_default();
        let _ = std::fs::remove_file(&tmp);
        content
    } else {
        String::from_utf8_lossy(&output.stdout).to_string()
    };

    if !output.status.success() && message.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::msg(if stderr.is_empty() {
            "Codex 生成失败，请确认已登录 Codex CLI".into()
        } else {
            format!("Codex 生成失败：{stderr}")
        }));
    }

    message = clean_message(&message);
    if message.is_empty() {
        return Err(AppError::msg("Codex 未返回有效的 Commit message"));
    }
    Ok(message)
}

fn run_cursor_agent(prompt: &str) -> AppResult<String> {
    let bin = resolve_bin(
        "agent",
        &["cursor-agent"],
        "未找到 Cursor Agent CLI。请先安装并登录：curl https://cursor.com/install -fsS | bash && agent login",
    )?;

    // ask 模式只作答不改文件；print 模式便于脚本解析最终文本。
    let output = Command::new(&bin)
        .args([
            "-p",
            "--mode",
            "ask",
            "--output-format",
            "text",
            "--sandbox",
            "enabled",
            "--trust",
            prompt,
        ])
        .env("PATH", augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| {
            AppError::msg(format!(
                "无法启动 Cursor Agent CLI：{e}。请确认已安装并登录（agent login）。"
            ))
        })?;

    let mut message = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.status.success() && message.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::msg(if stderr.is_empty() {
            "Cursor Agent 生成失败，请确认已登录 Cursor CLI（agent login）".into()
        } else {
            format!("Cursor Agent 生成失败：{stderr}")
        }));
    }

    message = clean_message(&message);
    if message.is_empty() {
        return Err(AppError::msg("Cursor Agent 未返回有效的 Commit message"));
    }
    Ok(message)
}

fn resolve_bin(primary: &str, aliases: &[&str], missing_msg: &str) -> AppResult<PathBuf> {
    let mut names = vec![primary];
    names.extend_from_slice(aliases);

    for name in &names {
        if let Some(path) = which_bin(name) {
            return Ok(path);
        }
    }

    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let candidates = [
        home.join(".local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        home.join("bin"),
    ];

    for dir in candidates {
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

/// GUI 应用启动时 PATH 往往不完整，补上常见 CLI 安装目录。
fn augmented_path() -> String {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let extras = [
        home.join(".local/bin").to_string_lossy().into_owned(),
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        home.join("bin").to_string_lossy().into_owned(),
        home.join(".nvm/current/bin").to_string_lossy().into_owned(),
    ];
    let current = std::env::var("PATH").unwrap_or_default();
    let mut parts: Vec<String> = extras.to_vec();
    for p in current.split(':') {
        if !p.is_empty() && !parts.iter().any(|x| x == p) {
            parts.push(p.to_string());
        }
    }
    parts.join(":")
}

fn clean_message(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if s.starts_with("```") {
        if let Some(rest) = s.strip_prefix("```") {
            let rest = rest
                .strip_prefix("text")
                .or_else(|| rest.strip_prefix("markdown"))
                .unwrap_or(rest);
            s = rest.trim().to_string();
        }
        if let Some(idx) = s.rfind("```") {
            s = s[..idx].trim().to_string();
        }
    }
    s.trim_matches(|c| c == '"' || c == '\'').trim().to_string()
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
