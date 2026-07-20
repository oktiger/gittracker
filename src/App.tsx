import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { AppSidebar, type NavView } from "./components/AppSidebar";
import { ChangesDialog } from "./components/ChangesDialog";
import { CommitDialog } from "./components/CommitDialog";
import { DiscardDialog } from "./components/DiscardDialog";
import { HelpTip } from "./components/HelpTip";
import { LogDiaryPage } from "./components/LogDiaryPage";
import { MarkdownEditorDialog } from "./components/MarkdownEditorDialog";
import { ProjectCard } from "./components/ProjectCard";
import { AiSidePanel } from "./components/AiSidePanel";
import { SettingsPage } from "./components/SettingsPage";
import { useLogDiary } from "./hooks/useLogDiary";
import { useProjects } from "./hooks/useProjects";
import type { NewLogDiaryEntry, RunTarget } from "./types";
import "./App.css";

type AppView = NavView | "project";

type DialogState =
  | { type: "commit"; id: string; name: string }
  | { type: "discard"; id: string; name: string }
  | { type: "changes"; id: string; name: string }
  | { type: "doc"; id: string; relativePath: string; title: string }
  | null;

type SidePanelState = {
  id: string;
  name: string;
  mode: "identify" | "config";
  initialTargets?: RunTarget[];
} | null;

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
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [sidePanel, setSidePanel] = useState<SidePanelState>(null);
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

  const goNav = (next: NavView) => {
    setSelectedProjectId(null);
    setView(next);
    if (next === "logDiary") void logDiary.refresh();
  };

  const openProject = (id: string) => {
    setSelectedProjectId(id);
    setView("project");
  };

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
      if (selectedProjectId === id) {
        setSelectedProjectId(null);
        setView("board");
      }
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

  const selectedProject =
    view === "project" && selectedProjectId
      ? projects.find((p) => p.id === selectedProjectId) ?? null
      : null;

  const renderProjectCard = (
    p: (typeof projects)[number],
    opts?: { hideTitle?: boolean },
  ) => (
    <ProjectCard
      key={p.id}
      project={p}
      busy={busyIds[p.id]}
      hideTitle={opts?.hideTitle}
      onManualCommit={() => setDialog({ type: "commit", id: p.id, name: p.name })}
      onOneClick={() => void onOneClick(p.id)}
      onDiscard={() => setDialog({ type: "discard", id: p.id, name: p.name })}
      onViewChanges={() => setDialog({ type: "changes", id: p.id, name: p.name })}
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
        setSidePanel({
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
  );

  return (
    <div className={`app${sidePanel ? " has-ai-side" : ""}`}>
      <div className="app-bg" aria-hidden="true" />

      <div className="app-shell">
        <AppSidebar
          view={view}
          selectedProjectId={selectedProjectId}
          projects={projects}
          logCount={logDiary.entries.length}
          onNavigate={goNav}
          onSelectProject={openProject}
        />

        <div className="app-main">
          <header className="main-header">
            {view === "board" && (
              <>
                <div className="main-heading">
                  <h2>看板</h2>
                  <p>
                    总览全部项目状态
                    <HelpTip text="文件变更自动刷新；每 60 秒兜底全量刷新。关闭窗口后仍驻留托盘。" />
                  </p>
                </div>
                <div className="main-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>
                    刷新
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => void onAdd()}>
                    添加项目
                  </button>
                </div>
              </>
            )}

            {view === "project" && (
              <>
                <div className="main-heading">
                  <button
                    type="button"
                    className="btn-link main-back"
                    onClick={() => goNav("board")}
                  >
                    ← 看板
                  </button>
                  <h2>{selectedProject?.name ?? "项目详情"}</h2>
                  {selectedProject ? (
                    <p className="main-path" title={selectedProject.path}>
                      {selectedProject.path}
                    </p>
                  ) : null}
                </div>
                <div className="main-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => selectedProjectId && void refreshOne(selectedProjectId)}
                    disabled={!selectedProjectId}
                  >
                    刷新
                  </button>
                </div>
              </>
            )}

            {view === "logDiary" && (
              <div className="main-heading">
                <h2>日志</h2>
                <p>
                  每次运行（AI、提交、DOCS、启动目标等）会留下一条记录；点条目「复制」可粘贴给
                  AI。
                </p>
              </div>
            )}

            {view === "settings" && (
              <div className="main-heading">
                <h2>设置</h2>
                <p>配置 AI 调用通道与 DOCS 提示词模板</p>
              </div>
            )}
          </header>

          {error && (
            <div className="banner-error" role="alert">
              <span>{error}</span>
              <button type="button" className="btn-link" onClick={() => setError(null)}>
                关闭
              </button>
            </div>
          )}

          <main className="board">
            {view === "board" &&
              (loading ? (
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
                    <div
                      key={p.id}
                      className="board-card-wrap"
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest("button, a, input, textarea, select, label")) return;
                        openProject(p.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openProject(p.id);
                        }
                      }}
                    >
                      {renderProjectCard(p)}
                    </div>
                  ))}
                </div>
              ))}

            {view === "project" &&
              (loading ? (
                <div className="empty-state">加载中…</div>
              ) : !selectedProject ? (
                <div className="empty-state">
                  <h2>项目不存在</h2>
                  <p>该项目可能已被移除。</p>
                  <button type="button" className="btn btn-primary" onClick={() => goNav("board")}>
                    返回看板
                  </button>
                </div>
              ) : (
                <div className="project-detail">
                  {renderProjectCard(selectedProject, { hideTitle: true })}
                </div>
              ))}

            {view === "logDiary" && (
              <LogDiaryPage
                entries={logDiary.entries}
                loading={logDiary.loading}
                onClear={logDiary.clear}
                onRefresh={logDiary.refresh}
                onToast={showToast}
              />
            )}

            {view === "settings" && <SettingsPage onSaved={showToast} />}
          </main>
        </div>
      </div>

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

      {dialog?.type === "doc" && (
        <MarkdownEditorDialog
          projectId={dialog.id}
          relativePath={dialog.relativePath}
          title={dialog.title}
          onClose={() => setDialog(null)}
          onSaved={() => showToast("文档已保存")}
        />
      )}

      {sidePanel && (
        <AiSidePanel
          projectId={sidePanel.id}
          projectName={sidePanel.name}
          mode={sidePanel.mode}
          initialTargets={sidePanel.initialTargets}
          onClose={() => setSidePanel(null)}
          onSaved={(targets) => {
            showToast(`已保存 ${targets.length} 个启动目标`);
            void refreshOne(sidePanel.id);
          }}
          onLog={appendLog}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;
