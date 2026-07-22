use crate::error::{AppError, AppResult};
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Resolve a project-relative path; must stay inside the project root.
pub fn resolve_project_path(project_path: &Path, relative: &str) -> AppResult<PathBuf> {
    let rel = relative.trim().trim_start_matches('/');
    if rel.is_empty() {
        return Err(AppError::msg("文件路径为空"));
    }
    let rel_path = Path::new(rel);
    if rel_path
        .components()
        .any(|c| matches!(c, Component::ParentDir | Component::RootDir))
    {
        return Err(AppError::msg("文件路径不允许包含 .. 或绝对路径"));
    }

    let root = project_path
        .canonicalize()
        .map_err(|e| AppError::msg(format!("无法解析项目路径：{e}")))?;
    let candidate = root.join(rel);

    let resolved = if candidate.exists() {
        candidate
            .canonicalize()
            .map_err(|e| AppError::msg(format!("无法解析路径：{e}")))?
    } else {
        let parent = candidate
            .parent()
            .ok_or_else(|| AppError::msg("无效文件路径"))?;
        if !parent.exists() {
            return Err(AppError::msg("文件所在目录不存在"));
        }
        let parent_c = parent
            .canonicalize()
            .map_err(|e| AppError::msg(format!("无法解析路径：{e}")))?;
        let name = candidate
            .file_name()
            .ok_or_else(|| AppError::msg("无效文件路径"))?;
        parent_c.join(name)
    };

    if !resolved.starts_with(&root) {
        return Err(AppError::msg("路径必须位于项目目录内"));
    }
    Ok(resolved)
}

pub fn read_project_file(project_path: &Path, relative: &str) -> AppResult<String> {
    let path = resolve_project_path(project_path, relative)?;
    if !path.is_file() {
        return Err(AppError::msg("文件不存在或已删除"));
    }
    let bytes = fs::read(&path).map_err(|e| AppError::msg(format!("读取文件失败：{e}")))?;
    String::from_utf8(bytes).map_err(|_| AppError::msg("文件不是有效的 UTF-8 文本，无法编辑"))
}

pub fn write_project_file(project_path: &Path, relative: &str, content: &str) -> AppResult<()> {
    let path = resolve_project_path(project_path, relative)?;
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| AppError::msg(format!("创建目录失败：{e}")))?;
        }
    }
    fs::write(&path, content).map_err(|e| AppError::msg(format!("写入文件失败：{e}")))
}
