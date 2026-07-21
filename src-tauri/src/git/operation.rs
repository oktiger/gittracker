use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// 同一 Worktree 同时只能运行一个会写入 Git 状态的提交流程。
#[derive(Default)]
pub struct GitOperationState {
    active_repositories: Mutex<HashSet<PathBuf>>,
}

pub struct GitOperationGuard<'a> {
    state: &'a GitOperationState,
    repository: PathBuf,
}

impl GitOperationState {
    pub fn try_acquire(&self, repository: &Path) -> AppResult<GitOperationGuard<'_>> {
        let repository = repository
            .canonicalize()
            .unwrap_or_else(|_| repository.to_path_buf());
        let mut active = self.active_repositories.lock();
        if !active.insert(repository.clone()) {
            return Err(AppError::msg(
                "该 Worktree 已有提交操作正在运行，请等待其完成后再试",
            ));
        }
        drop(active);

        Ok(GitOperationGuard {
            state: self,
            repository,
        })
    }
}

impl Drop for GitOperationGuard<'_> {
    fn drop(&mut self) {
        self.state.active_repositories.lock().remove(&self.repository);
    }
}
