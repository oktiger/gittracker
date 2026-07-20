use crate::error::{AppError, AppResult};
use std::io::Write;
use std::process::{Command, Stdio};

const MAX_DIFF_CHARS: usize = 80_000;

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

    which_codex()?;

    // Prefer writing last message to a temp file for reliability.
    let tmp = std::env::temp_dir().join(format!(
        "gittracker-commit-{}.txt",
        uuid::Uuid::new_v4()
    ));

    let output = Command::new("codex")
        .args([
            "exec",
            "--sandbox",
            "read-only",
            "--ephemeral",
            "--skip-git-repo-check",
            "-o",
            tmp.to_str().unwrap_or("/tmp/gittracker-commit.txt"),
            &prompt,
        ])
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

fn which_codex() -> AppResult<()> {
    let status = Command::new("which")
        .arg("codex")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| AppError::msg(format!("无法检测 Codex：{e}")))?;
    if !status.success() {
        return Err(AppError::msg(
            "未找到 Codex CLI。请先安装并登录：npm i -g @openai/codex && codex login",
        ));
    }
    Ok(())
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
    let mut child = Command::new("codex")
        .args([
            "exec",
            "--sandbox",
            "read-only",
            "--ephemeral",
            "--skip-git-repo-check",
            "-",
        ])
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
