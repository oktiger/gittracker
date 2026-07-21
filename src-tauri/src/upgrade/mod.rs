//! GitTracker 自升级：打包 → 退出 → 替换当前 .app → 重新打开。
//!
//! macOS 上不能覆盖正在运行的可执行文件，必须先退出进程再由外部脚本完成替换。

use crate::error::{AppError, AppResult};
use crate::models::RunTarget;
use crate::run::RunManager;
use crate::store;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;
use tauri::AppHandle;

pub const SELF_IDENTIFIER: &str = "com.tiger.gittracker";
pub const SELF_UPGRADE_TARGET_ID: &str = "__self_upgrade__";
const SELF_PRODUCT_NAME: &str = "GitTracker";

/// 当前仓库是否为 GitTracker 自身（可走专用自升级路径）。
pub fn is_self_repo(repo: &Path) -> bool {
    read_tauri_identifier(repo).as_deref() == Some(SELF_IDENTIFIER)
}

/// 启动自升级：先在运行中心展示打包过程，成功后退出并由脚本替换、重开。
pub fn start_self_upgrade(app: AppHandle, manager: &RunManager) -> AppResult<crate::models::RunSession> {
    let source = resolve_source_repo()?;
    let dest = resolve_install_dest()?;
    let product = read_tauri_product_name(&source).unwrap_or_else(|| SELF_PRODUCT_NAME.into());
    let build_cmd = tauri_build_command(&source);
    let built = source
        .join("src-tauri/target/release/bundle/macos")
        .join(format!("{product}.app"));

    let target = RunTarget {
        id: SELF_UPGRADE_TARGET_ID.into(),
        name: "升级".into(),
        description: Some("打包并用新版本替换当前 GitTracker，然后自动重开".into()),
        cwd: ".".into(),
        command: build_cmd,
        kind: Some("upgrade".into()),
        is_default: false,
    };

    let session = manager.start(
        app.clone(),
        "self".into(),
        SELF_PRODUCT_NAME.into(),
        &source,
        target,
    )?;

    let session_id = session.id.clone();
    let manager = manager.clone();
    thread::spawn(move || {
        wait_then_install(app, manager, session_id, built, dest);
    });

    Ok(session)
}

fn wait_then_install(
    app: AppHandle,
    manager: RunManager,
    session_id: String,
    built: PathBuf,
    dest: PathBuf,
) {
    loop {
        thread::sleep(Duration::from_millis(400));
        let Some(session) = manager.list().into_iter().find(|s| s.id == session_id) else {
            return;
        };
        match session.status.as_str() {
            "running" | "stopping" | "starting" => continue,
            "exited" if session.exit_code == Some(0) => break,
            _ => return,
        }
    }

    if !built.is_dir() {
        let _ = app.emit_upgrade_note(
            &session_id,
            &format!("构建完成但未找到产物：{}", built.display()),
        );
        return;
    }

    let _ = app.emit_upgrade_note(
        &session_id,
        "构建成功。即将退出，由后台脚本替换应用并重新打开…",
    );
    thread::sleep(Duration::from_millis(900));

    let pid = std::process::id();
    if let Err(err) = spawn_replace_helper(&built, &dest, pid) {
        let _ = app.emit_upgrade_note(&session_id, &format!("无法启动替换脚本：{err}"));
        return;
    }

    manager.stop_all();
    app.exit(0);
}

trait UpgradeEmit {
    fn emit_upgrade_note(&self, session_id: &str, text: &str) -> Result<(), tauri::Error>;
}

impl UpgradeEmit for AppHandle {
    fn emit_upgrade_note(&self, session_id: &str, text: &str) -> Result<(), tauri::Error> {
        use crate::models::RunProgressEvent;
        use tauri::Emitter;
        self.emit(
            "run-progress",
            RunProgressEvent {
                session_id: session_id.into(),
                kind: "output".into(),
                stream: Some("stdout".into()),
                text: text.into(),
            },
        )
    }
}

fn spawn_replace_helper(src: &Path, dst: &Path, pid: u32) -> AppResult<()> {
    let script_path = std::env::temp_dir().join(format!("gittracker-upgrade-{pid}.sh"));
    let log_path = std::env::temp_dir().join(format!("gittracker-upgrade-{pid}.log"));
    let script = format!(
        r#"#!/bin/bash
set -euo pipefail
SRC="$1"
DST="$2"
PID="$3"
LOG="$4"
exec >>"$LOG" 2>&1
echo "[$(date)] waiting for pid $PID to exit…"
for i in $(seq 1 120); do
  if ! kill -0 "$PID" 2>/dev/null; then
    break
  fi
  sleep 0.25
done
if kill -0 "$PID" 2>/dev/null; then
  echo "timeout waiting for process $PID"
  exit 1
fi
sleep 0.6
echo "installing: $SRC -> $DST"
OLD="${{DST}}.gittracker-old"
rm -rf "$OLD" 2>/dev/null || true
if [ -d "$DST" ]; then
  mv "$DST" "$OLD" || rm -rf "$DST"
fi
mkdir -p "$(dirname "$DST")"
ditto "$SRC" "$DST"
rm -rf "$OLD" 2>/dev/null || true
echo "opening $DST"
open "$DST"
echo "done"
"#
    );
    fs::write(&script_path, script)
        .map_err(|e| AppError::msg(format!("无法写入升级脚本：{e}")))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&script_path)
            .map_err(|e| AppError::msg(format!("无法读取升级脚本权限：{e}")))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&script_path, perms)
            .map_err(|e| AppError::msg(format!("无法设置升级脚本可执行：{e}")))?;
    }

    let mut command = Command::new("/bin/bash");
    command
        .arg(&script_path)
        .arg(src)
        .arg(dst)
        .arg(pid.to_string())
        .arg(&log_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    // 脱离当前进程组，避免父进程退出后被挂掉
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }

    command
        .spawn()
        .map_err(|e| AppError::msg(format!("无法启动升级脚本：{e}")))?;
    Ok(())
}

fn resolve_source_repo() -> AppResult<PathBuf> {
    if let Some(path) = find_repo_from_exe() {
        return Ok(path);
    }
    for project in store::list_projects()? {
        let path = PathBuf::from(&project.path);
        if is_self_repo(&path) {
            return Ok(path);
        }
    }
    Err(AppError::msg(
        "找不到 GitTracker 源码目录。请先在看板把本仓库加为项目，或从源码目录启动后再点「升级」。",
    ))
}

fn find_repo_from_exe() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    for ancestor in exe.ancestors() {
        if is_self_repo(ancestor) {
            return Some(ancestor.to_path_buf());
        }
        // 运行于 *.app/Contents/MacOS/… 时，再往上可能经过 bundle 路径回到 target/
        if ancestor.ends_with("src-tauri") {
            let repo = ancestor.parent()?;
            if is_self_repo(repo) {
                return Some(repo.to_path_buf());
            }
        }
    }
    None
}

fn resolve_install_dest() -> AppResult<PathBuf> {
    let exe = std::env::current_exe()
        .map_err(|e| AppError::msg(format!("无法定位当前程序：{e}")))?;
    if let Some(bundle) = find_enclosing_app_bundle(&exe) {
        return Ok(bundle);
    }
    Ok(PathBuf::from(format!("/Applications/{SELF_PRODUCT_NAME}.app")))
}

fn find_enclosing_app_bundle(path: &Path) -> Option<PathBuf> {
    for ancestor in path.ancestors() {
        if ancestor
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("app"))
        {
            return Some(ancestor.to_path_buf());
        }
    }
    None
}

pub fn read_tauri_product_name(repo: &Path) -> Option<String> {
    read_tauri_conf(repo)?
        .get("productName")?
        .as_str()
        .map(str::to_string)
}

pub fn read_tauri_identifier(repo: &Path) -> Option<String> {
    read_tauri_conf(repo)?
        .get("identifier")?
        .as_str()
        .map(str::to_string)
}

fn read_tauri_conf(repo: &Path) -> Option<serde_json::Value> {
    let conf = repo.join("src-tauri").join("tauri.conf.json");
    let raw = fs::read_to_string(conf).ok()?;
    serde_json::from_str(&raw).ok()
}

fn tauri_build_command(repo: &Path) -> String {
    // 自升级只需要 .app；打 dmg 会挂载磁盘镜像并弹出「拖到 Applications」窗口。
    let pm = detect_pm(repo);
    match pm {
        "pnpm" => "pnpm exec tauri build --bundles app".into(),
        "yarn" => "yarn tauri build --bundles app".into(),
        "bun" => "bunx tauri build --bundles app".into(),
        _ => "npm run tauri -- build --bundles app".into(),
    }
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

/// 为其它桌面项目生成「升级 APP」启发式命令（GitTracker 跑该命令时对方可先退出再替换）。
pub fn tauri_upgrade_shell_command(repo: &Path, cwd_rel: &str) -> Option<String> {
    let dir = if cwd_rel == "." {
        repo.to_path_buf()
    } else {
        repo.join(cwd_rel)
    };
    if !dir.join("src-tauri").is_dir() {
        return None;
    }
    let product = read_tauri_product_name(&dir)?;
    let build = tauri_build_command(&dir);
    // 先打包，再尝试退出已安装应用、替换 /Applications、打开。
    Some(format!(
        r#"{build} && APP_NAME='{product}' && BUILT="src-tauri/target/release/bundle/macos/${{APP_NAME}}.app" && DEST="/Applications/${{APP_NAME}}.app" && test -d "$BUILT" && {{ osascript -e "tell application \"$APP_NAME\" to quit" 2>/dev/null || true; sleep 1; }} && rm -rf "$DEST" && ditto "$BUILT" "$DEST" && open "$DEST""#
    ))
}
