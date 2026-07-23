use crate::error::AppResult;
use crate::git::{run_git, run_git_allow_fail};
use crate::models::{BranchInfo, BranchList, CommitInfo, FileChange, ProjectRecord, ProjectStatus};
use std::collections::{HashMap, HashSet};
use std::path::Path;

pub fn fetch_project_status(project: &ProjectRecord) -> ProjectStatus {
    match fetch_project_status_inner(project) {
        Ok(status) => status,
        Err(err) => ProjectStatus {
            id: project.id.clone(),
            name: project.name.clone(),
            path: project.path.clone(),
            branch: String::new(),
            clean: false,
            staged: 0,
            unstaged: 0,
            untracked: 0,
            ahead: 0,
            behind: 0,
            commits: vec![],
            error: Some(err.to_string()),
            run_targets: project.run_targets.clone(),
        },
    }
}

fn fetch_project_status_inner(project: &ProjectRecord) -> AppResult<ProjectStatus> {
    let repo = Path::new(&project.path);
    let status_out = run_git(repo, &["status", "-sb", "--porcelain=v1"])?;
    let (branch, ahead, behind, staged, unstaged, untracked) = parse_status(&status_out);
    let commits = fetch_recent_commits(repo)?;
    let clean = staged == 0 && unstaged == 0 && untracked == 0;

    Ok(ProjectStatus {
        id: project.id.clone(),
        name: project.name.clone(),
        path: project.path.clone(),
        branch,
        clean,
        staged,
        unstaged,
        untracked,
        ahead,
        behind,
        commits,
        error: None,
        run_targets: project.run_targets.clone(),
    })
}

fn parse_status(raw: &str) -> (String, u32, u32, u32, u32, u32) {
    let mut lines = raw.lines();
    let header = lines.next().unwrap_or("");
    let (branch, ahead, behind) = parse_branch_header(header);

    let mut staged = 0u32;
    let mut unstaged = 0u32;
    let mut untracked = 0u32;

    for line in lines {
        if line.is_empty() {
            continue;
        }
        if line.starts_with("??") {
            untracked += 1;
            continue;
        }
        if line.len() < 2 {
            continue;
        }
        let xy: Vec<char> = line.chars().take(2).collect();
        let x = xy.first().copied().unwrap_or(' ');
        let y = xy.get(1).copied().unwrap_or(' ');
        if x != ' ' && x != '?' {
            staged += 1;
        }
        if y != ' ' && y != '?' {
            unstaged += 1;
        }
    }

    (branch, ahead, behind, staged, unstaged, untracked)
}

fn parse_branch_header(header: &str) -> (String, u32, u32) {
    // ## main...origin/main [ahead 1, behind 2]
    let trimmed = header.trim_start_matches("## ").trim();
    if trimmed.is_empty() {
        return ("HEAD".into(), 0, 0);
    }

    let (branch_part, rest) = match trimmed.split_once(' ') {
        Some((b, r)) => (b, Some(r)),
        None => (trimmed, None),
    };

    let branch = branch_part
        .split("...")
        .next()
        .unwrap_or(branch_part)
        .to_string();

    let mut ahead = 0u32;
    let mut behind = 0u32;
    if let Some(rest) = rest {
        if let Some(start) = rest.find('[') {
            if let Some(end) = rest.find(']') {
                let inside = &rest[start + 1..end];
                for part in inside.split(',') {
                    let part = part.trim();
                    if let Some(n) = part.strip_prefix("ahead ") {
                        ahead = n.trim().parse().unwrap_or(0);
                    } else if let Some(n) = part.strip_prefix("behind ") {
                        behind = n.trim().parse().unwrap_or(0);
                    }
                }
            }
        }
    }

    (branch, ahead, behind)
}

fn fetch_recent_commits(repo: &Path) -> AppResult<Vec<CommitInfo>> {
    let (code, stdout, _) =
        run_git_allow_fail(repo, &["log", "-3", "--pretty=format:%h\t%ct\t%an\t%s"])?;
    if code != 0 || stdout.trim().is_empty() {
        return Ok(vec![]);
    }

    let mut commits = Vec::new();
    for line in stdout.lines() {
        let mut parts = line.splitn(4, '\t');
        let hash = parts.next().unwrap_or("").to_string();
        let ts = parts
            .next()
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        let author = parts.next().unwrap_or("").to_string();
        let subject = parts.next().unwrap_or("").to_string();
        if !hash.is_empty() {
            commits.push(CommitInfo {
                hash,
                timestamp: ts,
                author,
                subject,
                branches: vec![],
            });
        }
    }
    Ok(commits)
}

/// Returns one chronological history for all local and remote branches.  A branch is
/// attached to every commit it currently contains, so users can see the complete
/// branch context without duplicating the commit in the list.
pub fn list_commit_history(repo: &Path) -> AppResult<Vec<CommitInfo>> {
    const HISTORY_LIMIT: &str = "500";

    let branch_refs = history_branch_refs(repo)?;
    if branch_refs.is_empty() {
        return Ok(vec![]);
    }

    let out = run_git(
        repo,
        &[
            "log",
            "--date-order",
            "--max-count",
            HISTORY_LIMIT,
            "--pretty=format:%H\t%ct\t%an\t%s",
            "--branches",
            "--remotes",
        ],
    )?;

    let mut commits = Vec::new();
    let mut commit_hashes = HashSet::new();
    for line in out.lines() {
        let mut parts = line.splitn(4, '\t');
        let hash = parts.next().unwrap_or("").to_string();
        if hash.is_empty() {
            continue;
        }
        let timestamp = parts
            .next()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0);
        let author = parts.next().unwrap_or("").to_string();
        let subject = parts.next().unwrap_or("").to_string();
        commit_hashes.insert(hash.clone());
        commits.push(CommitInfo {
            hash,
            timestamp,
            author,
            subject,
            branches: vec![],
        });
    }

    let mut branches_by_commit: HashMap<String, Vec<BranchInfo>> = HashMap::new();
    for (ref_name, branch) in branch_refs {
        let out = run_git(repo, &["rev-list", &ref_name])?;
        for hash in out.lines() {
            if commit_hashes.contains(hash) {
                branches_by_commit
                    .entry(hash.to_string())
                    .or_default()
                    .push(branch.clone());
            }
        }
    }

    for commit in &mut commits {
        let mut branches = branches_by_commit.remove(&commit.hash).unwrap_or_default();
        branches.sort_by(|left, right| {
            right
                .current
                .cmp(&left.current)
                .then_with(|| left.kind.cmp(&right.kind))
                .then_with(|| left.name.cmp(&right.name))
        });
        commit.branches = branches;
    }

    Ok(commits)
}

fn history_branch_refs(repo: &Path) -> AppResult<Vec<(String, BranchInfo)>> {
    let current = run_git(repo, &["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|_| "HEAD".into());
    let out = run_git(
        repo,
        &[
            "for-each-ref",
            "--format=%(refname)%09%(refname:short)",
            "refs/heads/",
            "refs/remotes/",
        ],
    )?;

    let mut refs = Vec::new();
    for line in out.lines() {
        let Some((ref_name, short_name)) = line.split_once('\t') else {
            continue;
        };
        if short_name.is_empty() || ref_name.ends_with("/HEAD") {
            continue;
        }
        let kind = if ref_name.starts_with("refs/remotes/") {
            "remote"
        } else {
            "local"
        };
        refs.push((
            ref_name.to_string(),
            BranchInfo {
                name: short_name.to_string(),
                kind: kind.into(),
                current: kind == "local" && short_name == current,
            },
        ));
    }
    Ok(refs)
}

pub fn list_branches(repo: &Path) -> AppResult<BranchList> {
    let current = run_git(repo, &["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "HEAD".into());

    let out = run_git(
        repo,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname)%09%(refname:short)%09%(HEAD)",
            "refs/heads/",
            "refs/remotes/",
        ],
    )?;

    let mut local = Vec::new();
    let mut remote = Vec::new();

    for line in out.lines() {
        if line.is_empty() {
            continue;
        }
        let mut parts = line.splitn(3, '\t');
        let full_ref = parts.next().unwrap_or("");
        let short = parts.next().unwrap_or("").to_string();
        let head_mark = parts.next().unwrap_or("");
        if short.is_empty() {
            continue;
        }

        if full_ref.starts_with("refs/remotes/") {
            // Skip remote symbolic HEAD pointers such as refs/remotes/origin/HEAD
            // (short name is often just "origin", not "origin/HEAD").
            if full_ref.ends_with("/HEAD") {
                continue;
            }
            remote.push(BranchInfo {
                name: short,
                kind: "remote".into(),
                current: false,
            });
            continue;
        }

        if full_ref.starts_with("refs/heads/") {
            let is_current = head_mark == "*" || short == current;
            local.push(BranchInfo {
                name: short,
                kind: "local".into(),
                current: is_current,
            });
        }
    }

    Ok(BranchList {
        current,
        local,
        remote,
    })
}

pub fn list_changed_files(repo: &Path) -> AppResult<Vec<FileChange>> {
    let out = run_git(repo, &["status", "--porcelain=v1"])?;
    let mut files = Vec::new();

    for line in out.lines() {
        if line.len() < 3 {
            continue;
        }
        let status = line[..2].to_string();
        let mut path = line[3..].to_string();
        if let Some((_, right)) = path.split_once(" -> ") {
            path = right.to_string();
        }
        path = path.trim_matches('"').to_string();

        let chars: Vec<char> = status.chars().collect();
        let x = chars.first().copied().unwrap_or(' ');
        let y = chars.get(1).copied().unwrap_or(' ');
        let untracked = status == "??";
        let staged = !untracked && x != ' ';
        let unstaged = !untracked && y != ' ';

        files.push(FileChange {
            path,
            status,
            staged,
            unstaged,
            untracked,
        });
    }

    Ok(files)
}

pub fn file_diff(repo: &Path, path: &str, staged: bool) -> AppResult<String> {
    if staged {
        run_git(repo, &["diff", "--cached", "--", path])
    } else {
        let (code, stdout, _) = run_git_allow_fail(repo, &["diff", "--", path])?;
        if code == 0 && !stdout.is_empty() {
            return Ok(stdout);
        }
        // Untracked: show as /dev/null diff if possible
        let (c2, out2, _) =
            run_git_allow_fail(repo, &["diff", "--no-index", "--", "/dev/null", path])?;
        if c2 == 0 || c2 == 1 {
            return Ok(out2);
        }
        Ok(String::new())
    }
}
