mod ops;
mod status;

pub use ops::*;
pub use status::*;

use crate::error::{AppError, AppResult};
use std::path::Path;
use std::process::Command;

pub fn run_git(repo: &Path, args: &[&str]) -> AppResult<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .map_err(|e| AppError::msg(format!("无法执行 git：{e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("git {} 失败", args.join(" "))
        };
        return Err(AppError::msg(detail));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn run_git_allow_fail(repo: &Path, args: &[&str]) -> AppResult<(i32, String, String)> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .map_err(|e| AppError::msg(format!("无法执行 git：{e}")))?;

    let code = output.status.code().unwrap_or(1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok((code, stdout, stderr))
}

pub fn is_git_repo(path: &Path) -> bool {
    run_git(path, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s.trim() == "true")
        .unwrap_or(false)
}
