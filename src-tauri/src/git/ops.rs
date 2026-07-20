use crate::error::{AppError, AppResult};
use crate::git::{run_git, run_git_allow_fail};
use crate::models::DiscardResult;
use crate::store;
use chrono::Local;
use std::fs;
use std::io::Write;
use std::path::Path;

pub fn commit(repo: &Path, message: &str) -> AppResult<()> {
    let msg = message.trim();
    if msg.is_empty() {
        return Err(AppError::msg("Commit message 不能为空"));
    }

    let staged = run_git(repo, &["diff", "--cached", "--name-only"])?;
    if staged.trim().is_empty() {
        return Err(AppError::msg("没有已暂存的更改，请先 stage 文件"));
    }

    run_git(repo, &["commit", "-m", msg])?;
    Ok(())
}

pub fn push(repo: &Path) -> AppResult<()> {
    run_git(repo, &["push"])?;
    Ok(())
}

pub fn create_recovery_patch(
    repo: &Path,
    project_id: &str,
    paths: &[String],
    include_untracked: bool,
) -> AppResult<Option<String>> {
    if paths.is_empty() {
        return Ok(None);
    }

    let dir = store::recovery_dir(project_id)?;
    let stamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let patch_path = dir.join(format!("{stamp}.patch"));
    let mut file = fs::File::create(&patch_path)?;

    writeln!(
        file,
        "# GitTracker recovery patch\n# created: {}\n# paths: {}\n",
        stamp,
        paths.join(", ")
    )?;

    let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
    let mut args = vec!["diff", "HEAD", "--"];
    args.extend(path_refs.iter().copied());
    let (code, stdout, _) = run_git_allow_fail(repo, &args)?;
    if code == 0 || code == 1 {
        if !stdout.trim().is_empty() {
            write!(file, "{stdout}")?;
            if !stdout.ends_with('\n') {
                writeln!(file)?;
            }
        }
    }

    if include_untracked {
        for path in paths {
            let full = repo.join(path);
            if full.is_file() {
                let (c, status_out, _) =
                    run_git_allow_fail(repo, &["status", "--porcelain=v1", "--", path])?;
                if c == 0 && status_out.trim_start().starts_with("??") {
                    writeln!(file, "diff --git a/{path} b/{path}")?;
                    writeln!(file, "new file mode 100644")?;
                    writeln!(file, "--- /dev/null")?;
                    writeln!(file, "+++ b/{path}")?;
                    if let Ok(content) = fs::read_to_string(&full) {
                        for line in content.lines() {
                            writeln!(file, "+{line}")?;
                        }
                    }
                }
            }
        }
    }

    let meta = fs::metadata(&patch_path)?;
    if meta.len() < 80 {
        // essentially empty header only
        let _ = fs::remove_file(&patch_path);
        return Ok(None);
    }

    Ok(Some(patch_path.to_string_lossy().to_string()))
}

pub fn discard_changes(
    repo: &Path,
    project_id: &str,
    paths: &[String],
    include_untracked: bool,
) -> AppResult<DiscardResult> {
    if paths.is_empty() {
        return Err(AppError::msg("未选择任何文件"));
    }

    let recovery_patch =
        create_recovery_patch(repo, project_id, paths, include_untracked)?;

    let mut tracked = Vec::new();
    let mut untracked = Vec::new();

    for path in paths {
        let (c, out, _) = run_git_allow_fail(repo, &["status", "--porcelain=v1", "--", path])?;
        if c != 0 {
            continue;
        }
        let line = out.lines().next().unwrap_or("").trim_start();
        if line.starts_with("??") {
            untracked.push(path.clone());
        } else if !line.is_empty() {
            tracked.push(path.clone());
        }
    }

    if !tracked.is_empty() {
        let mut args = vec!["restore", "--worktree", "--staged", "--"];
        let refs: Vec<&str> = tracked.iter().map(|s| s.as_str()).collect();
        args.extend(refs);
        run_git(repo, &args)?;
    }

    if include_untracked && !untracked.is_empty() {
        let mut args = vec!["clean", "-f", "--"];
        let refs: Vec<&str> = untracked.iter().map(|s| s.as_str()).collect();
        args.extend(refs);
        run_git(repo, &args)?;
    } else if !include_untracked && !untracked.is_empty() {
        // skip untracked by design
    }

    let mut discarded = tracked;
    if include_untracked {
        discarded.extend(untracked);
    }

    Ok(DiscardResult {
        recovery_patch,
        discarded,
    })
}
