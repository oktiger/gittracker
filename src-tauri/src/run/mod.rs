use crate::error::{AppError, AppResult};
use crate::models::RunTarget;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

/// 收集仓库内与启动相关的上下文，供 AI 识别使用（控制体量）。
pub fn gather_context(repo: &Path) -> AppResult<String> {
    let mut out = String::new();
    out.push_str(&format!("仓库根：{}\n\n", repo.display()));

    out.push_str("【顶层条目】\n");
    out.push_str(&list_dir_names(repo, 40));
    out.push('\n');

    let mut scan_dirs: Vec<PathBuf> = vec![repo.to_path_buf()];
    for sub in ["apps", "packages", "src"] {
        let p = repo.join(sub);
        if p.is_dir() {
            out.push_str(&format!("【{sub}/ 子目录】\n"));
            out.push_str(&list_dir_names(&p, 30));
            out.push('\n');
            if let Ok(entries) = fs::read_dir(&p) {
                for entry in entries.flatten().take(12) {
                    let path = entry.path();
                    if path.is_dir() {
                        scan_dirs.push(path);
                    }
                }
            }
        }
    }

    // 常见嵌套：仅一层 apps/*/package.json
    for dir in scan_dirs {
        let rel = dir
            .strip_prefix(repo)
            .map(|p| {
                if p.as_os_str().is_empty() {
                    ".".to_string()
                } else {
                    p.to_string_lossy().replace('\\', "/")
                }
            })
            .unwrap_or_else(|_| dir.display().to_string());

        let pkg = dir.join("package.json");
        if pkg.is_file() {
            out.push_str(&format!("【package.json @ {rel}】\n"));
            out.push_str(&summarize_package_json(&pkg));
            out.push('\n');
        }

        let markers = [
            ("pnpm-lock.yaml", "pnpm"),
            ("yarn.lock", "yarn"),
            ("bun.lockb", "bun"),
            ("package-lock.json", "npm"),
            ("next.config.js", "next"),
            ("next.config.mjs", "next"),
            ("next.config.ts", "next"),
            ("vite.config.ts", "vite"),
            ("vite.config.js", "vite"),
            ("src-tauri", "tauri"),
            ("Cargo.toml", "rust"),
        ];
        let mut found = Vec::new();
        for (name, tag) in markers {
            if dir.join(name).exists() {
                found.push(tag);
            }
        }
        if !found.is_empty() {
            found.sort();
            found.dedup();
            out.push_str(&format!("【标记 @ {rel}】 {}\n\n", found.join(", ")));
        }
    }

    for readme_name in ["README.md", "readme.md", "README"] {
        let readme = repo.join(readme_name);
        if readme.is_file() {
            out.push_str("【README 开头】\n");
            out.push_str(&read_head(&readme, 45));
            out.push_str("\n\n");
            break;
        }
    }

    const MAX: usize = 28_000;
    if out.len() > MAX {
        out.truncate(MAX);
        out.push_str("\n...[context truncated]\n");
    }
    Ok(out)
}

fn list_dir_names(dir: &Path, limit: usize) -> String {
    let mut names = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten().take(limit) {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let suffix = if entry.path().is_dir() { "/" } else { "" };
            names.push(format!("{name}{suffix}"));
        }
    }
    names.sort();
    if names.is_empty() {
        "(空)\n".into()
    } else {
        format!("{}\n", names.join("  "))
    }
}

fn summarize_package_json(path: &Path) -> String {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return "(无法读取)\n".into(),
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return "(JSON 解析失败)\n".into();
    };
    let mut lines = Vec::new();
    if let Some(name) = v.get("name").and_then(|x| x.as_str()) {
        lines.push(format!("name: {name}"));
    }
    if let Some(scripts) = v.get("scripts").and_then(|x| x.as_object()) {
        let keys = [
            "dev", "start", "preview", "build", "tauri", "tauri:dev", "tauri:build",
        ];
        let mut shown = Vec::new();
        for k in keys {
            if let Some(cmd) = scripts.get(k).and_then(|x| x.as_str()) {
                shown.push(format!("  {k}: {cmd}"));
            }
        }
        // 再补若干其它 scripts
        for (k, val) in scripts {
            if keys.contains(&k.as_str()) {
                continue;
            }
            if shown.len() >= 12 {
                break;
            }
            if let Some(cmd) = val.as_str() {
                shown.push(format!("  {k}: {cmd}"));
            }
        }
        if shown.is_empty() {
            lines.push("scripts: (无)".into());
        } else {
            lines.push("scripts:".into());
            lines.extend(shown);
        }
    }
    lines.join("\n") + "\n"
}

fn read_head(path: &Path, max_lines: usize) -> String {
    let Ok(raw) = fs::read_to_string(path) else {
        return String::new();
    };
    raw.lines()
        .take(max_lines)
        .collect::<Vec<_>>()
        .join("\n")
}

/// 将相对 cwd 解析为仓库内的绝对路径，禁止逃出仓库。
pub fn resolve_cwd(repo: &Path, cwd: &str) -> AppResult<PathBuf> {
    let cwd = cwd.trim();
    let rel = if cwd.is_empty() || cwd == "." {
        PathBuf::from(".")
    } else {
        PathBuf::from(cwd)
    };
    for c in rel.components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir => {
                return Err(AppError::msg("工作目录不能包含 .."));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::msg("工作目录必须是相对路径"));
            }
        }
    }

    let repo = repo
        .canonicalize()
        .map_err(|e| AppError::msg(format!("无法解析仓库路径：{e}")))?;
    let joined = if rel == Path::new(".") {
        repo.clone()
    } else {
        repo.join(&rel)
    };
    let abs = joined
        .canonicalize()
        .map_err(|_| AppError::msg(format!("工作目录不存在：{cwd}")))?;
    if !abs.starts_with(&repo) {
        return Err(AppError::msg("工作目录必须位于仓库内"));
    }
    if !abs.is_dir() {
        return Err(AppError::msg("工作目录不是文件夹"));
    }
    Ok(abs)
}

pub fn validate_command(command: &str) -> AppResult<()> {
    let command = command.trim();
    if command.is_empty() {
        return Err(AppError::msg("命令不能为空"));
    }
    if command.contains('\n') || command.contains('\r') {
        return Err(AppError::msg("命令不能包含换行"));
    }
    Ok(())
}

/// 在系统终端中执行：cd 到目标目录后运行命令（macOS：生成 .command 并用 open 打开）。
pub fn run_in_terminal(repo: &Path, target: &RunTarget) -> AppResult<()> {
    validate_command(&target.command)?;
    let cwd = resolve_cwd(repo, &target.cwd)?;
    let script = format!(
        "#!/bin/zsh\ncd {} || exit 1\necho \"% cd {} && {}\"\n{}\necho\necho \"[GitTracker] 命令已结束，可关闭此窗口\"\nexec zsh\n",
        shell_single_quote(&cwd.to_string_lossy()),
        shell_single_quote(&cwd.to_string_lossy()),
        target.command.replace('"', "\\\""),
        target.command
    );

    let tmp_dir = std::env::temp_dir().join("gittracker-run");
    fs::create_dir_all(&tmp_dir)?;
    let file = tmp_dir.join(format!(
        "run-{}-{}.command",
        uuid::Uuid::new_v4(),
        sanitize_filename(&target.name)
    ));
    fs::write(&file, script)?;
    let mut perms = fs::metadata(&file)?.permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&file, perms)?;

    let status = Command::new("open")
        .arg(&file)
        .status()
        .map_err(|e| AppError::msg(format!("无法打开系统终端：{e}")))?;
    if !status.success() {
        return Err(AppError::msg("打开系统终端失败"));
    }
    Ok(())
}

fn shell_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn sanitize_filename(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .take(32)
        .collect();
    if s.is_empty() {
        "target".into()
    } else {
        s
    }
}

/// 从 AI 原始输出中解析 RunTarget 列表。
pub fn parse_suggested_targets(raw: &str) -> AppResult<Vec<RunTarget>> {
    let json_str = extract_json_array(raw)
        .ok_or_else(|| AppError::msg("AI 未返回可解析的 JSON 数组，请重试或手动添加"))?;

    let value: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| AppError::msg(format!("解析 AI 结果失败：{e}")))?;

    let arr = value
        .as_array()
        .ok_or_else(|| AppError::msg("AI 结果不是 JSON 数组"))?;

    let mut out = Vec::new();
    for (i, item) in arr.iter().enumerate() {
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let cwd = item
            .get("cwd")
            .and_then(|v| v.as_str())
            .unwrap_or(".")
            .trim()
            .to_string();
        let command = item
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if name.is_empty() || command.is_empty() {
            continue;
        }
        let kind = item
            .get("kind")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let description = item
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let is_default = item
            .get("isDefault")
            .or_else(|| item.get("is_default"))
            .and_then(|v| v.as_bool())
            .unwrap_or(i == 0);
        out.push(RunTarget {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            description,
            cwd: if cwd.is_empty() {
                ".".into()
            } else {
                cwd
            },
            command,
            kind,
            is_default,
        });
    }

    if out.is_empty() {
        return Err(AppError::msg("AI 未给出有效的启动目标"));
    }
    if !out.iter().any(|t| t.is_default) {
        out[0].is_default = true;
    }
    Ok(out)
}

fn extract_json_array(raw: &str) -> Option<String> {
    let s = raw.trim();
    if let Some(start) = s.find('[') {
        if let Some(end) = s.rfind(']') {
            if end > start {
                return Some(s[start..=end].to_string());
            }
        }
    }
    None
}

fn detect_pm(dir: &Path) -> &'static str {
    if dir.join("pnpm-lock.yaml").is_file() {
        "pnpm"
    } else if dir.join("yarn.lock").is_file() {
        "yarn"
    } else if dir.join("bun.lockb").is_file() || dir.join("bun.lock").is_file() {
        "bun"
    } else {
        "npm"
    }
}

fn run_script_cmd(pm: &str, script: &str) -> String {
    match pm {
        "pnpm" => format!("pnpm {script}"),
        "yarn" => format!("yarn {script}"),
        "bun" => format!("bun run {script}"),
        _ => format!("npm run {script}"),
    }
}

fn package_dirs(repo: &Path) -> Vec<(String, PathBuf)> {
    let mut dirs = vec![(".".into(), repo.to_path_buf())];
    for sub in ["apps", "packages"] {
        let base = repo.join(sub);
        if !base.is_dir() {
            continue;
        }
        if let Ok(entries) = fs::read_dir(&base) {
            for entry in entries.flatten().take(16) {
                let path = entry.path();
                if path.is_dir() && path.join("package.json").is_file() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    dirs.push((format!("{sub}/{name}"), path));
                }
            }
        }
    }
    dirs
}

fn is_tauri_dir(dir: &Path) -> bool {
    dir.join("src-tauri").is_dir()
        || dir.join("src-tauri").join("tauri.conf.json").is_file()
        || dir.join("src-tauri").join("Cargo.toml").is_file()
}

fn is_web_dir(dir: &Path) -> bool {
    [
        "next.config.js",
        "next.config.mjs",
        "next.config.ts",
        "vite.config.ts",
        "vite.config.js",
        "vite.config.mjs",
    ]
    .iter()
    .any(|n| dir.join(n).is_file())
}

/// 不依赖 AI：从 package.json scripts 启发式生成启动目标。
pub fn suggest_from_fs(repo: &Path) -> AppResult<Vec<RunTarget>> {
    let mut out = Vec::new();
    let preferred = [
        "dev",
        "start",
        "tauri:dev",
        "tauri",
        "preview",
    ];

    for (rel, dir) in package_dirs(repo) {
        let pkg = dir.join("package.json");
        if !pkg.is_file() {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&pkg) else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        let Some(scripts) = v.get("scripts").and_then(|x| x.as_object()) else {
            continue;
        };
        let pm = detect_pm(&dir);
        let desktop = is_tauri_dir(&dir);
        let web = is_web_dir(&dir);

        for script in preferred {
            let Some(_) = scripts.get(script) else {
                continue;
            };
            // tauri 脚本通常在根 package.json，避免和纯 web 的 dev 混淆命名
            let kind = if script.contains("tauri") || (desktop && script == "dev" && !web) {
                "dev"
            } else if script == "preview" {
                "dev"
            } else {
                "dev"
            };
            let name = if script.contains("tauri") || (desktop && !web && script == "dev") {
                if rel == "." {
                    "启动桌面".into()
                } else {
                    format!("启动桌面 · {rel}")
                }
            } else if web || script == "dev" || script == "start" {
                if rel == "." {
                    if desktop && web {
                        format!("启动网页 · {script}")
                    } else {
                        "启动网页".into()
                    }
                } else {
                    format!("启动网页 · {rel}")
                }
            } else {
                format!("运行 · {script}")
            };

            let description = if script.contains("tauri") || (desktop && !web && script == "dev") {
                Some("启动桌面应用的开发模式".into())
            } else if web || script == "dev" || script == "start" {
                Some("启动本地网页开发服务器".into())
            } else {
                Some(format!("运行 npm script：{script}"))
            };

            // 跳过重复名称
            if out.iter().any(|t: &RunTarget| t.name == name && t.cwd == rel) {
                continue;
            }

            let command = if script == "tauri" {
                // bare "tauri" script: pass:dev
                if scripts.contains_key("tauri:dev") {
                    continue;
                }
                match pm {
                    "pnpm" => "pnpm exec tauri:dev".into(),
                    "yarn" => "yarn tauri:dev".into(),
                    "bun" => "bunx tauri:dev".into(),
                    _ => "npm run tauri -- dev".into(),
                }
            } else {
                run_script_cmd(pm, script)
            };

            out.push(RunTarget {
                id: uuid::Uuid::new_v4().to_string(),
                name,
                description,
                cwd: rel.clone(),
                command,
                kind: Some(kind.into()),
                is_default: false,
            });

            // 每个目录优先只收 1～2 个常用脚本，避免刷屏
            if out
                .iter()
                .filter(|t| t.cwd == rel)
                .count()
                >= 2
            {
                break;
            }
        }
    }

    // 根目录有 src-tauri 但 scripts 没扫到时补一条
    if out.iter().all(|t| !t.name.contains("桌面")) && is_tauri_dir(repo) {
        let pm = detect_pm(repo);
        out.push(RunTarget {
            id: uuid::Uuid::new_v4().to_string(),
            name: "启动桌面".into(),
            description: Some("启动桌面应用的开发模式".into()),
            cwd: ".".into(),
            command: run_script_cmd(pm, "tauri:dev"),
            kind: Some("dev".into()),
            is_default: false,
        });
    }

    push_shell_scripts(repo, &mut out);
    push_macos_apps(repo, &mut out);
    push_python_targets(repo, &mut out);

    if out.is_empty() {
        return Err(AppError::msg(
            "未能识别启动方式（无 package.json scripts / run.sh / .app / Python 入口）。请手动添加一条。",
        ));
    }

    // 仅保留一个默认
    for t in out.iter_mut() {
        t.is_default = false;
    }
    out[0].is_default = true;
    Ok(out)
}

fn push_unique(out: &mut Vec<RunTarget>, target: RunTarget) {
    if out
        .iter()
        .any(|t| t.command == target.command && t.cwd == target.cwd)
    {
        return;
    }
    out.push(target);
}

fn push_shell_scripts(repo: &Path, out: &mut Vec<RunTarget>) {
    let Ok(entries) = fs::read_dir(repo) else {
        return;
    };
    let mut scripts: Vec<String> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let path = e.path();
            if !path.is_file() {
                return None;
            }
            let lower = name.to_lowercase();
            if !(lower.ends_with(".sh") || lower.ends_with(".command")) {
                return None;
            }
            if lower.starts_with("run")
                || lower.starts_with("start")
                || lower.starts_with("dev")
                || lower == "serve.sh"
            {
                Some(name)
            } else {
                None
            }
        })
        .collect();
    scripts.sort();
    for name in scripts.into_iter().take(6) {
        let (label, description) = if name.contains("menubar") || name.contains("menu") {
            (
                "脚本启动菜单栏".into(),
                format!("执行 {name}，用脚本启动菜单栏程序"),
            )
        } else if name.contains("headless")
            || name.contains("daemon")
            || name.contains("server")
            || name == "run.sh"
        {
            (
                "脚本启动后台".into(),
                format!("执行 {name}，用脚本启动无界面后台服务"),
            )
        } else if name.starts_with("run") {
            (
                format!("脚本启动 · {name}"),
                format!("执行仓库脚本 {name}"),
            )
        } else {
            (
                format!("运行脚本 · {name}"),
                format!("执行仓库脚本 {name}"),
            )
        };
        push_unique(
            out,
            RunTarget {
                id: uuid::Uuid::new_v4().to_string(),
                name: label,
                description: Some(description),
                cwd: ".".into(),
                command: format!("./{name}"),
                kind: Some("dev".into()),
                is_default: false,
            },
        );
    }
}

fn push_macos_apps(repo: &Path, out: &mut Vec<RunTarget>) {
    let Ok(entries) = fs::read_dir(repo) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".app") || !path.is_dir() {
            continue;
        }
        // 跳过明显构建缓存
        if name.starts_with('.') {
            continue;
        }
        push_unique(
            out,
            RunTarget {
                id: uuid::Uuid::new_v4().to_string(),
                name: "启动 APP".into(),
                description: Some(format!("打开已打包好的 {name}")),
                cwd: ".".into(),
                command: format!("open \"{name}\""),
                kind: Some("open".into()),
                is_default: false,
            },
        );
    }
    // dist/*.app
    let dist = repo.join("dist");
    if dist.is_dir() {
        if let Ok(entries) = fs::read_dir(&dist) {
            for entry in entries.flatten().take(4) {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".app") && entry.path().is_dir() {
                    push_unique(
                        out,
                        RunTarget {
                            id: uuid::Uuid::new_v4().to_string(),
                            name: format!("启动 APP · {name}"),
                            description: Some(format!("打开 dist 目录里已打包的 {name}")),
                            cwd: ".".into(),
                            command: format!("open \"dist/{name}\""),
                            kind: Some("open".into()),
                            is_default: false,
                        },
                    );
                }
            }
        }
    }
}

fn python_bin(repo: &Path) -> String {
    let venv = repo.join(".venv/bin/python");
    if venv.is_file() {
        ".venv/bin/python".into()
    } else {
        "python3".into()
    }
}

fn push_python_targets(repo: &Path, out: &mut Vec<RunTarget>) {
    let is_python = repo.join("requirements.txt").is_file()
        || repo.join("pyproject.toml").is_file()
        || repo.join("setup.py").is_file()
        || repo.join("Pipfile").is_file();
    if !is_python {
        // 仍可能有 app_main.py
        if !repo.join("app_main.py").is_file() && !repo.join("main.py").is_file() {
            return;
        }
    }

    let py = python_bin(repo);

    // 若已有 ./run.sh 类目标，仍可补 Python 模块入口
    if repo.join("app_main.py").is_file() {
        push_unique(
            out,
            RunTarget {
                id: uuid::Uuid::new_v4().to_string(),
                name: "启动 APP 入口".into(),
                description: Some("直接运行 app_main.py（开发调试用）".into()),
                cwd: ".".into(),
                command: format!("{py} app_main.py"),
                kind: Some("dev".into()),
                is_default: false,
            },
        );
    }

    // 包内常见入口：<pkg>/main.py、menubar.py、app.py
    if let Ok(entries) = fs::read_dir(repo) {
        for entry in entries.flatten().take(20) {
            let pkg_dir = entry.path();
            if !pkg_dir.is_dir() {
                continue;
            }
            let pkg = entry.file_name().to_string_lossy().to_string();
            if pkg.starts_with('.')
                || pkg == "tests"
                || pkg == "docs"
                || pkg == "build"
                || pkg == "dist"
                || pkg == "assets"
                || pkg == "logs"
            {
                continue;
            }
            for (module_file, label, desc) in [
                (
                    "main.py",
                    "启动后台",
                    "无界面后台服务（开发用，供菜单栏等调用）",
                ),
                (
                    "menubar.py",
                    "启动菜单栏",
                    "以 Python 直接跑菜单栏界面（开发用，未打包）",
                ),
                (
                    "app.py",
                    "启动 APP",
                    "以 Python 直接跑应用入口（开发用）",
                ),
            ] {
                if pkg_dir.join(module_file).is_file() {
                    let mod_name = module_file.trim_end_matches(".py");
                    push_unique(
                        out,
                        RunTarget {
                            id: uuid::Uuid::new_v4().to_string(),
                            name: label.into(),
                            description: Some(format!("{desc} · {pkg}.{mod_name}")),
                            cwd: ".".into(),
                            command: format!("{py} -m {pkg}.{mod_name}"),
                            kind: Some("dev".into()),
                            is_default: false,
                        },
                    );
                }
            }
        }
    }

    if repo.join("setup.py").is_file() && repo.join("app_main.py").is_file() {
        push_unique(
            out,
            RunTarget {
                id: uuid::Uuid::new_v4().to_string(),
                name: "打包 APP".into(),
                description: Some(
                    "用 py2app 打成 macOS .app（-A 开发别名模式，便于调试）".into(),
                ),
                cwd: ".".into(),
                command: format!("{py} setup.py py2app -A"),
                kind: Some("build".into()),
                is_default: false,
            },
        );
    }

    // 通用 main.py
    if repo.join("main.py").is_file() {
        push_unique(
            out,
            RunTarget {
                id: uuid::Uuid::new_v4().to_string(),
                name: "启动主程序".into(),
                description: Some("直接运行仓库根目录 main.py".into()),
                cwd: ".".into(),
                command: format!("{py} main.py"),
                kind: Some("dev".into()),
                is_default: false,
            },
        );
    }
}
