use crate::error::{AppError, AppResult};
use crate::models::PullRequestInfo;
use crate::path_env::augmented_path;
use serde::Deserialize;
use std::path::Path;
use std::process::Command;

use super::{run_git, run_git_allow_fail};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPullRequest {
    number: u64,
    title: String,
    head_ref_name: String,
    author: Option<GhAuthor>,
    is_draft: bool,
    updated_at: String,
    url: String,
    mergeable: Option<String>,
    base_ref_name: String,
}

#[derive(Debug, Deserialize)]
struct GhAuthor {
    login: String,
}

/// 只读取当前仓库以默认分支为目标的开放 PR；非 GitHub 仓库没有候选项。
pub fn list_open_pull_requests(repo: &Path) -> AppResult<Vec<PullRequestInfo>> {
    if !is_github_remote(repo) {
        return Ok(vec![]);
    }

    let default_branch = default_branch(repo)?;
    let output = run_gh(
        repo,
        &[
            "pr",
            "list",
            "--state",
            "open",
            "--limit",
            "100",
            "--json",
            "number,title,headRefName,author,isDraft,updatedAt,url,mergeable,baseRefName",
        ],
    )?;
    let prs: Vec<GhPullRequest> = serde_json::from_str(&output)
        .map_err(|error| AppError::msg(format!("无法解析 GitHub PR 列表：{error}")))?;

    Ok(prs
        .into_iter()
        .filter(|pr| pr.base_ref_name == default_branch)
        .map(|pr| PullRequestInfo {
            number: pr.number,
            title: pr.title,
            head_branch: pr.head_ref_name,
            author: pr.author.map(|author| author.login).unwrap_or_else(|| "GitHub".into()),
            draft: pr.is_draft,
            updated_at: pr.updated_at,
            url: pr.url,
            mergeable: pr.mergeable,
        })
        .collect())
}

pub fn default_branch(repo: &Path) -> AppResult<String> {
    let (code, out, _) = run_git_allow_fail(repo, &["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])?;
    if code == 0 {
        if let Some(branch) = out.trim().strip_prefix("origin/") {
            if !branch.is_empty() {
                return Ok(branch.to_string());
            }
        }
    }
    Ok("main".into())
}

pub fn fetch_pr_head(repo: &Path, number: u64) -> AppResult<String> {
    let ref_name = format!("refs/remotes/gittracker/pr/{number}");
    let source = format!("pull/{number}/head:{ref_name}");
    run_git(repo, &["fetch", "origin", &source])?;
    Ok(format!("gittracker/pr/{number}"))
}

pub fn ensure_clean_default_branch(repo: &Path, default_branch: &str) -> AppResult<()> {
    let status = run_git(repo, &["status", "--porcelain=v1"])?;
    if !status.trim().is_empty() {
        return Err(AppError::msg("请先提交、暂存或放弃当前工作区改动，再执行 AI 一键合并"));
    }
    let current = run_git(repo, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if current.trim() != default_branch {
        return Err(AppError::msg(format!(
            "请先切换到 {default_branch} 分支，再执行 AI 一键合并"
        )));
    }
    Ok(())
}

fn is_github_remote(repo: &Path) -> bool {
    run_git(repo, &["remote", "get-url", "origin"])
        .map(|url| url.trim().to_ascii_lowercase().contains("github.com"))
        .unwrap_or(false)
}

fn run_gh(repo: &Path, args: &[&str]) -> AppResult<String> {
    let output = Command::new("gh")
        .args(args)
        .current_dir(repo)
        .env("PATH", augmented_path())
        .output()
        .map_err(|error| AppError::msg(format!("无法启动 GitHub CLI：{error}。请安装并登录 gh。")))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::msg(if detail.is_empty() {
            "GitHub CLI 查询 PR 失败".into()
        } else {
            detail
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
