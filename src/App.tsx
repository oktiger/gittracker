import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { ChangesDialog } from "./components/ChangesDialog";
import { CommitDialog } from "./components/CommitDialog";
import { DiscardDialog } from "./components/DiscardDialog";
import { HelpTip } from "./components/HelpTip";
import { LogDiaryPage } from "./components/LogDiaryPage";
import { MarkdownEditorDialog } from "./components/MarkdownEditorDialog";
import { ProjectCard } from "./components/ProjectCard";
import { RunTargetsDialog } from "./components/RunTargetsDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { useLogDiary } from "./hooks/useLogDiary";
import { useProjects } from "./hooks/useProjects";
import type { NewLogDiaryEntry, RunTarget } from "./types";
import "./App.css";

type AppView = "board" | "logDiary";

type DialogState =
  | { type: "commit"; id: string; name: string }
  | { type: "discard"; id: string; name: string }
  | { type: "changes"; id: string; name: string }
  | { type: "settings" }
  | { type: "doc"; id: string; relativePath: string; title: string }
  | {
      type: "runTargets";
      id: string;
      name: string;
      mode: "identify" | "config";
      initialTargets?: RunTarget[];
    }
  | null;

function App() {
  const {
    projects,
    loading,
    error,
    setError,
    busyIds,
    setBusy,
    refresh,
    refreshOne,
  } = useProjects();
  const logDiary = useLogDiary();
  const [view, setView] = useState<AppView>("board");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const appendLog = useCallback(
    (entry: NewLogDiaryEntry) => {
      void logDiary.append(entry);
    },
    [logDiary.append],
  );

  const onAdd = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择 Git 项目目录",
      });
      if (!selected || Array.isArray(selected)) return;
      await api.addProject(selected);
      await refresh();
      showToast("已添加项目");
    } catch (e) {
      setError(String(e));
    }
  };

  const onRemove = async (id: string, name: string) => {
    if (!window.confirm(`从看板移除「${name}」？\n不会删除磁盘上的仓库。`)) return;
    try {
      await api.removeProject(id);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const onOneClick = async (id: string) => {
    const project = projects.find((p) => p.id === id);
    const projectName = project?.name ?? id;
    setBusy(id, "一键提交中：AI → Commit → Push…");
    setError(null);
    try {
      const result = await api.oneClickCommit(id);
      appendLog({
        kind: "oneClick",
        status: "ok",
        title: `一键提交 · ${projectName}`,
        projectId: id,
        projectName,
        detail: `Message:\n${result.message}\n\n已推送: ${result.pushed ? "是" : "否"}`,
      });
      showToast(`已提交并推送：${result.message.split("\n")[0]}`);
      await refreshOne(id);
    } catch (e) {
      const msg = String(e);
      appendLog({
        kind: "oneClick",
        status: "error",
        title: `一键提交失败 · ${projectName}`,
        projectId: id,
        projectName,
        detail: "流程：AI 生成 Commit Message → Commit → Push",
        error: msg,
      });
      setError(msg);
      await refreshOne(id);
    } finally {
      setBusy(id, null);
    }
  };

  return (
    <div className="app">
      <div className="app-bg" aria-hidden="true" />

      <header className="topbar">
        <div className="brand">
          <h1>GitTracker</h1>
          <p>
            多项目 Git 看板
            <HelpTip text="文件变更自动刷新；每 60 秒兜底全量刷新。关闭窗口后仍驻留托盘。" />
          </p>
        </div>
        <div className="topbar-actions">
          <nav className="view-tabs" aria-label="主视图">
            <button
              type="button"
              className={`view-tab${view === "board" ? " is-active" : ""}`}
              onClick={() => setView("board")}
            >
              看板
            </button>
            <button
              type="button"
              className={`view-tab${view === "logDiary" ? " is-active" : ""}`}
              onClick={() => {
                setView("logDiary");
                void logDiary.refresh();
              }}
            >
              日志日记
              {logDiary.entries.length > 0 ? (
                <span className="view-tab-count">{logDiary.entries.length}</span>
              ) : null}
            </button>
          </nav>
          {view === "board" && (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>
                刷新
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setDialog({ type: "settings" })}
              >
                设置
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void onAdd()}>
                添加项目
              </button>
            </>
          )}
          {view === "logDiary" && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setDialog({ type: "settings" })}
            >
              设置
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="banner-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn-link" onClick={() => setError(null)}>
            关闭
          </button>
        </div>
      )}

      {view === "board" ? (
        <main className="board">
          {loading ? (
            <div className="empty-state">加载中…</div>
          ) : projects.length === 0 ? (
            <div className="empty-state">
              <h2>还没有项目</h2>
              <p>添加本地 Git 仓库，即可在同一窗口查看状态并提交。</p>
              <button type="button" className="btn btn-primary" onClick={() => void onAdd()}>
                添加第一个项目
              </button>
            </div>
          ) : (
            <div className="grid">
              {projects.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  busy={busyIds[p.id]}
                  onManualCommit={() =>
                    setDialog({ type: "commit", id: p.id, name: p.name })
                  }
                  onOneClick={() => void onOneClick(p.id)}
                  onDiscard={() =>
                    setDialog({ type: "discard", id: p.id, name: p.name })
                  }
                  onViewChanges={() =>
                    setDialog({ type: "changes", id: p.id, name: p.name })
                  }
                  onRemove={() => void onRemove(p.id, p.name)}
                  onOpenDoc={(relativePath, title) =>
                    setDialog({
                      type: "doc",
                      id: p.id,
                      relativePath,
                      title,
                    })
                  }
                  onConfigureRun={(mode) =>
                    setDialog({
                      type: "runTargets",
                      id: p.id,
                      name: p.name,
                      mode,
                      initialTargets: mode === "config" ? p.runTargets ?? [] : undefined,
                    })
                  }
                  onError={(msg) => setError(msg)}
                  onToast={showToast}
                  onLog={appendLog}
                  onRefreshProject={() => void refreshOne(p.id)}
                />
              ))}
            </div>
          )}
        </main>
      ) : (
        <main className="board">
          <LogDiaryPage
            entries={logDiary.entries}
            loading={logDiary.loading}
            onClear={logDiary.clear}
            onRefresh={logDiary.refresh}
            onToast={showToast}
          />
        </main>
      )}

      {dialog?.type === "commit" && (
        <CommitDialog
          projectId={dialog.id}
          projectName={dialog.name}
          onClose={() => setDialog(null)}
          onDone={() => {
            void refreshOne(dialog.id);
            showToast("提交完成");
          }}
          onLog={appendLog}
        />
      )}

      {dialog?.type === "discard" && (
        <DiscardDialog
          projectId={dialog.id}
          projectName={dialog.name}
          onClose={() => setDialog(null)}
          onDone={() => {
            void refreshOne(dialog.id);
            showToast("已 Discard");
          }}
          onLog={appendLog}
        />
      )}

      {dialog?.type === "changes" && (
        <ChangesDialog
          projectId={dialog.id}
          projectName={dialog.name}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.type === "settings" && (
        <SettingsDialog
          onClose={() => setDialog(null)}
          onSaved={(msg) => showToast(msg)}
        />
      )}

      {dialog?.type === "doc" && (
        <MarkdownEditorDialog
          projectId={dialog.id}
          relativePath={dialog.relativePath}
          title={dialog.title}
          onClose={() => setDialog(null)}
          onSaved={() => showToast("文档已保存")}
        />
      )}

      {dialog?.type === "runTargets" && (
        <RunTargetsDialog
          projectId={dialog.id}
          projectName={dialog.name}
          mode={dialog.mode}
          initialTargets={dialog.initialTargets}
          onClose={() => setDialog(null)}
          onSaved={(targets) => {
            showToast(`已保存 ${targets.length} 个启动目标`);
            void refreshOne(dialog.id);
          }}
          onLog={appendLog}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;
