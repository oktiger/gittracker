//! GUI 应用启动时 PATH 往往不完整（尤其缺 nvm），统一补上常见 CLI 目录。

use std::path::PathBuf;

pub fn cli_bin_dirs() -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let mut dirs = Vec::new();

    let mut push_dir = |p: PathBuf| {
        if p.is_dir() && !dirs.iter().any(|d| d == &p) {
            dirs.push(p);
        }
    };

    for p in [
        home.join(".local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        home.join("bin"),
        home.join(".cargo/bin"),
        home.join(".volta/bin"),
        home.join(".asdf/shims"),
        home.join(".fnm/current/bin"),
        home.join(".local/share/fnm/aliases/default/bin"),
    ] {
        push_dir(p);
    }

    let nvm_dir = std::env::var_os("NVM_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".nvm"));
    push_dir(nvm_dir.join("current/bin"));

    // nvm alias/default → versions/node/<ver>/bin（GUI 下 ~/.nvm/current 常不存在）
    if let Ok(default) = std::fs::read_to_string(nvm_dir.join("alias/default")) {
        let ver = default.trim();
        if !ver.is_empty() {
            push_dir(nvm_dir.join("versions/node").join(ver).join("bin"));
        }
    }

    if let Ok(entries) = std::fs::read_dir(nvm_dir.join("versions/node")) {
        let mut versions: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        // 版本名大致按新到旧排序（v25.8.0 > v20.x）
        versions.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
        for ver_path in versions {
            push_dir(ver_path.join("bin"));
        }
    }

    dirs
}

pub fn augmented_path() -> String {
    let mut parts: Vec<String> = cli_bin_dirs()
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    let current = std::env::var("PATH").unwrap_or_default();
    for p in current.split(':') {
        if !p.is_empty() && !parts.iter().any(|x| x == p) {
            parts.push(p.to_string());
        }
    }
    parts.join(":")
}
