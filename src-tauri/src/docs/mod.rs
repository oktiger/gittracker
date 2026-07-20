use crate::error::{AppError, AppResult};
use crate::models::{DocsOverview, DocsTaskItem};
use std::fs;
use std::path::{Component, Path, PathBuf};

const DOCS_DIR: &str = "DOCS";
const GOAL_DIR: &str = "Goal";
const TASK_DIR: &str = "Task";
const GOAL_FILE: &str = "goal.md";

pub fn docs_root(project_path: &Path) -> PathBuf {
    project_path.join(DOCS_DIR)
}

pub fn goal_path(project_path: &Path) -> PathBuf {
    docs_root(project_path).join(GOAL_DIR).join(GOAL_FILE)
}

pub fn task_dir(project_path: &Path) -> PathBuf {
    docs_root(project_path).join(TASK_DIR)
}

/// Resolve a path under DOCS/, rejecting `..` traversal.
pub fn resolve_docs_path(project_path: &Path, relative: &str) -> AppResult<PathBuf> {
    let rel = relative.trim().trim_start_matches('/');
    if rel.is_empty() {
        return Err(AppError::msg("文档路径为空"));
    }
    let candidate = docs_root(project_path).join(rel);
    let docs = docs_root(project_path)
        .canonicalize()
        .unwrap_or_else(|_| docs_root(project_path));
    // If file does not exist yet, canonicalize parent and append name.
    let resolved = if candidate.exists() {
        candidate
            .canonicalize()
            .map_err(|e| AppError::msg(format!("无法解析路径：{e}")))?
    } else {
        let parent = candidate
            .parent()
            .ok_or_else(|| AppError::msg("无效文档路径"))?;
        if !parent.exists() {
            return Err(AppError::msg("文档目录不存在"));
        }
        let parent_c = parent
            .canonicalize()
            .map_err(|e| AppError::msg(format!("无法解析路径：{e}")))?;
        let name = candidate
            .file_name()
            .ok_or_else(|| AppError::msg("无效文档路径"))?;
        parent_c.join(name)
    };

    if !resolved.starts_with(&docs) {
        return Err(AppError::msg("路径必须位于项目 DOCS/ 目录下"));
    }
    // Also reject any `..` in the relative input explicitly.
    let rel_path = Path::new(rel);
    if rel_path
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(AppError::msg("文档路径不允许包含 .."));
    }
    Ok(resolved)
}

pub fn list_docs(project_path: &Path) -> AppResult<DocsOverview> {
    let root = docs_root(project_path);
    let has_docs = root.is_dir();
    let goal_dir_ok = root.join(GOAL_DIR).is_dir();
    let task_dir_ok = task_dir(project_path).is_dir();
    let goal = goal_path(project_path);
    let goal_exists = goal.is_file();
    let needs_init = !goal_dir_ok || !task_dir_ok || !goal_exists;
    let goal_rel = if goal_dir_ok || has_docs {
        Some(format!("{GOAL_DIR}/{GOAL_FILE}"))
    } else {
        None
    };

    let mut tasks = Vec::new();
    let td = task_dir(project_path);
    if td.is_dir() {
        let mut entries: Vec<PathBuf> = fs::read_dir(&td)?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("html"))
                    .unwrap_or(false)
            })
            .collect();
        entries.sort();

        for path in entries {
            let name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let (number, title) = parse_task_filename(&name);
            let status = read_task_status(&path).unwrap_or_else(|| "pending".into());
            let relative_path = format!("{TASK_DIR}/{name}");
            tasks.push(DocsTaskItem {
                number,
                title,
                relative_path,
                status,
                kind: if name.to_lowercase().ends_with(".html") {
                    "html".into()
                } else {
                    "md".into()
                },
            });
        }
        tasks.sort_by_key(|t| t.number);
    }

    Ok(DocsOverview {
        has_docs,
        goal_exists,
        needs_init,
        goal_relative_path: goal_rel,
        tasks,
    })
}

pub fn ensure_docs(project_path: &Path) -> AppResult<DocsOverview> {
    let goal_dir = docs_root(project_path).join(GOAL_DIR);
    let td = task_dir(project_path);
    fs::create_dir_all(&goal_dir)?;
    fs::create_dir_all(&td)?;
    let goal = goal_path(project_path);
    if !goal.exists() {
        fs::write(
            &goal,
            "# 项目目标\n\n在此描述本项目要达成的目标。\n",
        )?;
    }
    list_docs(project_path)
}

pub fn read_doc_file(project_path: &Path, relative: &str) -> AppResult<String> {
    let path = resolve_docs_path(project_path, relative)?;
    if !path.is_file() {
        return Err(AppError::msg("文件不存在"));
    }
    Ok(fs::read_to_string(path)?)
}

pub fn write_doc_file(project_path: &Path, relative: &str, content: &str) -> AppResult<()> {
    let path = resolve_docs_path(project_path, relative)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, content)?;
    Ok(())
}

/// Parse AI output into task files. Returns number of tasks written.
pub fn write_tasks_from_ai_output(project_path: &Path, ai_output: &str) -> AppResult<usize> {
    let parsed = parse_tasks_from_output(ai_output);
    if parsed.is_empty() {
        return Err(AppError::msg(
            "AI 未返回可解析的任务列表。请确认提示词要求按 ### Task 格式输出。",
        ));
    }

    fs::create_dir_all(task_dir(project_path))?;
    let mut next_num = next_task_number(project_path)?;
    let mut created = 0usize;

    for (title, body) in parsed {
        let slug = slugify(&title);
        let filename = format!("{next_num:03}-{slug}.md");
        let path = task_dir(project_path).join(&filename);
        let content = format!(
            "---\nstatus: pending\n---\n\n# {title}\n\n{body}\n"
        );
        fs::write(path, content)?;
        next_num += 1;
        created += 1;
    }
    Ok(created)
}

pub fn append_task_result(
    project_path: &Path,
    relative: &str,
    summary: &str,
) -> AppResult<()> {
    let path = resolve_docs_path(project_path, relative)?;
    let mut content = if path.is_file() {
        fs::read_to_string(&path)?
    } else {
        String::new()
    };

    // Mark status done in frontmatter if present.
    if content.starts_with("---") {
        if let Some(end) = content[3..].find("---") {
            let fm_end = 3 + end;
            let fm = &content[3..fm_end];
            let new_fm = if fm.contains("status:") {
                fm.lines()
                    .map(|line| {
                        if line.trim_start().starts_with("status:") {
                            "status: done"
                        } else {
                            line
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                format!("{fm}\nstatus: done")
            };
            content = format!("---{new_fm}---{}", &content[fm_end + 3..]);
        }
    } else {
        content = format!("---\nstatus: done\n---\n\n{content}");
    }

    let summary = summary.trim();
    if !summary.is_empty() {
        content.push_str("\n\n## 实现结果\n\n");
        content.push_str(summary);
        content.push('\n');
    }
    fs::write(path, content)?;
    Ok(())
}

fn next_task_number(project_path: &Path) -> AppResult<u32> {
    let overview = list_docs(project_path)?;
    Ok(overview.tasks.iter().map(|t| t.number).max().unwrap_or(0) + 1)
}

fn parse_task_filename(name: &str) -> (u32, String) {
    let stem = name
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(name);
    if let Some((num, rest)) = stem.split_once('-') {
        if let Ok(n) = num.parse::<u32>() {
            let title = rest.replace('-', " ");
            return (n, title);
        }
    }
    (0, stem.to_string())
}

fn read_task_status(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    if !content.starts_with("---") {
        return None;
    }
    let end = content[3..].find("---")?;
    let fm = &content[3..3 + end];
    for line in fm.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("status:") {
            return Some(v.trim().to_string());
        }
    }
    None
}

fn slugify(title: &str) -> String {
    let mut out = String::new();
    for c in title.chars().take(40) {
        if c.is_alphanumeric() {
            out.push(c);
        } else if c.is_whitespace() || c == '-' || c == '_' {
            if !out.ends_with('-') {
                out.push('-');
            }
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "task".into()
    } else {
        out
    }
}

/// Parse `### Task` blocks from AI output.
pub fn parse_tasks_from_output(raw: &str) -> Vec<(String, String)> {
    let mut tasks = Vec::new();
    let text = raw.trim();
    if text.is_empty() {
        return tasks;
    }

    // Split by ### Task (case-insensitive heading)
    let lower = text.to_lowercase();
    let mut indices = Vec::new();
    let mut search_from = 0;
    while let Some(pos) = lower[search_from..].find("### task") {
        let abs = search_from + pos;
        // ensure start of line-ish
        if abs == 0 || text.as_bytes().get(abs - 1) == Some(&b'\n') {
            indices.push(abs);
        }
        search_from = abs + 8;
    }

    if indices.is_empty() {
        // Fallback: numbered list "- title" lines
        for line in text.lines() {
            let line = line.trim();
            let title = line
                .strip_prefix("- ")
                .or_else(|| line.strip_prefix("* "))
                .or_else(|| {
                    let mut chars = line.chars();
                    if chars.next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
                        line.split_once('.').map(|(_, r)| r.trim())
                    } else {
                        None
                    }
                });
            if let Some(t) = title {
                let t = t.trim();
                if !t.is_empty() && t.len() < 80 {
                    tasks.push((t.to_string(), format!("- 要做什么：{t}\n- 验收标准：待补充\n")));
                }
            }
        }
        return tasks;
    }

    indices.push(text.len());
    for win in indices.windows(2) {
        let block = text[win[0]..win[1]].trim();
        let body_start = block.find('\n').map(|i| i + 1).unwrap_or(block.len());
        let body = block[body_start..].trim();
        let mut title = String::new();
        let mut content_lines = Vec::new();
        let mut in_body = false;

        for line in body.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("title:") {
                title = rest.trim().to_string();
            } else if trimmed.starts_with("body:") {
                in_body = true;
                let rest = trimmed["body:".len()..].trim();
                if let Some(r) = rest.strip_prefix('|') {
                    let r = r.trim();
                    if !r.is_empty() {
                        content_lines.push(r.to_string());
                    }
                } else if !rest.is_empty() {
                    content_lines.push(rest.to_string());
                }
            } else if in_body {
                content_lines.push(line.to_string());
            } else if title.is_empty() && !trimmed.is_empty() && !trimmed.starts_with('#') {
                title = trimmed.trim_start_matches(['#', '-', '*', ' ']).to_string();
            } else if !title.is_empty() {
                content_lines.push(line.to_string());
            }
        }

        if title.is_empty() {
            title = format!("任务 {}", tasks.len() + 1);
        }
        let content = content_lines.join("\n").trim().to_string();
        let content = if content.is_empty() {
            format!("- 要做什么：{title}\n")
        } else {
            content
        };
        tasks.push((title, content));
    }

    tasks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_task_blocks() {
        let raw = r#"
### Task
title: 调研
body: |
  做调研

### Task
title: 搭骨架
body: |
  搭页面
"#;
        let tasks = parse_tasks_from_output(raw);
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].0, "调研");
    }
}
