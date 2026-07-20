import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { ActivitySidePanel, type AiActivity } from "./components/ActivitySidePanel";
import { AppSidebar, type NavView } from "./components/AppSidebar";
import { ChangesDialog } from "./components/ChangesDialog";
import { CommitDialog } from "./components/CommitDialog";
import { DiscardDialog } from "./components/DiscardDialog";
import { HelpTip } from "./components/HelpTip";
import { LogDiaryPage } from "./components/LogDiaryPage";
import { DailyCompletionPage } from "./components/DailyCompletionPage";
import { MarkdownEditorDialog } from "./components/MarkdownEditorDialog";
import { ProjectCard } from "./components/ProjectCard";
import { SettingsPage } from "./components/SettingsPage";
import { useLogDiary } from "./hooks/useLogDiary";
import { useProjects } from "./hooks/useProjects";
import { newAiSessionId, type AiPanelSession } from "./lib/aiPanel";
import type { NewLogDiaryEntry, RunSession, RunTarget } from "./types";
import "./App.css";

type AppView = NavView | "project";

type DialogState =
  | { type: "commit"; id: string; name: string }
  | { type: "discard"; id: string; name: string }
  | { type: "changes"; id: string; name: string }
  | { type: "doc"; id: string; relativePath: string; title: string; libraryFile?: boolean }
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
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [aiSessions, setAiSessions] = useState<AiActivity[]>([]);
  const [runSessions, setRunSessions] = useState<RunSession[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const [docsEpoch, setDocsEpoch] = useState(0);
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

  const openAiSession = useCallback((session: AiPanelSession) => {
    setAiSessions((items) => [...items, { id: newAiSessionId(), session }]);
    setActivityOpen(true);
  }, []);

  useEffect(() => {
    void api.listRunSessions().then(setRunSessions).catch(() => undefined);
  }, []);

  const onRunTarget = async (project: { id: string; name: string }, target: RunTarget) => {
    setActivityOpen(true);
    try {
      const session = await api.runProjectTarget(project.id, target.id);
      setRunSessions((items) => [...items, session]);
      appendLog({
        kind: "runTarget",
        status: "running",
        title: `运行 · ${target.name}`,
        projectId: project.id,
        projectName: project.name,
        detail: `cwd: ${target.cwd}\ncommand: ${target.command}\n\n已在运行中心启动，输出会实时显示。`,
      });
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    const checkSchedule = async () => {
      try {
        const settings = await api.getSettings();
        if (!settings.dailyCompletionEnabled) return;
        const now = new Date();
        const today = now.toLocaleDateString("sv-SE");
        const time = now.toTimeString().slice(0, 5);
        const key = "gittracker.daily-completion.last-run";
        if (time < settings.dailyCompletionTime || localStorage.getItem(key) === today) return;
        localStorage.setItem(key, today);
        openAiSession({ kind: "dailyCompletion", period: "today", automatic: true });
      } catch { /* 下次轮询重试；不打断主界面 */ }
    };
    void checkSchedule();
    const timer = window.setInterval(() => void checkSchedule(), 60_000);
    return () => window.clearInterval(timer);
  }, [openAiSession]);

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

  const onOneClick = (id: string) => {
    const project = projects.find((p) => p.id === id);
    const projectName = project?.name ?? id;
    setBusy(id, "一键提交中…");
    setError(null);
    openAiSession({
      kind: "oneClick",
      projectId: id,
      projectName,
    });
  };

  const selectedProject =
    view === "project" && selectedProjectId
      ? projects.find((p) => p.id === selectedProjectId) ?? null
      : null;

  const renderProjectCard = (p: (typeof projects)[number]) => (
    <ProjectCard
      key={p.id}
      project={p}
      hideTitle={view === "project"}
      busy={busyIds[p.id]}
      onManualCommit={() => setDialog({ type: "commit", id: p.id, name: p.name })}
      onOneClick={() => onOneClick(p.id)}
      onDiscard={() => setDialog({ type: "discard", id: p.id, name: p.name })}
      onViewChanges={() => setDialog({ type: "changes", id: p.id, name: p.name })}
      onRemove={() => void onRemove(p.id, p.name)}
      onRunTarget={(target) => void onRunTarget(p, target)}
      onOpenDoc={(relativePath, title, libraryFile = false) =>
        setDialog({
          type: "doc",
          id: p.id,
          relativePath,
          title,
          libraryFile,
        })
      }
      onConfigureRun={(mode) =>
        openAiSession(
          mode === "config"
            ? {
                kind: "config",
                projectId: p.id,
                projectName: p.name,
                initialTargets: p.runTargets ?? [],
              }
            : {
                kind: "identify",
                projectId: p.id,
                projectName: p.name,
              },
        )
      }
      onGenerateTasks={() =>
        openAiSession({
          kind: "generateTasks",
          projectId: p.id,
          projectName: p.name,
        })
      }
      onImplementTask={(task) =>
        openAiSession({
          kind: "runTask",
          projectId: p.id,
          projectName: p.name,
          relativePath: task.relativePath,
          taskTitle: task.title,
          taskNumber: String(task.number).padStart(3, "0"),
        })
      }
      docsEpoch={docsEpoch}
      onError={(msg) => setError(msg)}
      onToast={showToast}
      onLog={appendLog}
    />
  );

  return (
    <div className={`app${activityOpen ? " has-ai-side" : ""}`}>
      <div className="app-bg" aria-hidden="true" />

      {!activityOpen && (
        <button
          type="button"
          className="activity-panel-trigger"
          onClick={() => setActivityOpen(true)}
          aria-label="打开运行中心侧边栏"
        >
          <span aria-hidden="true">▤</span>
          运行中心
        </button>
      )}

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
                <p>记录一键提交、AI 操作与其它事件</p>
              </div>
            )}

            {view === "dailyCompletion" && (
              <div className="main-heading"><h2>每日完成</h2><p>从 commit message 整理可分享的工作总结</p></div>
            )}

            {view === "settings" && (
              <div className="main-heading">
                <h2>设置</h2>
                <p>AI Provider 与提示词模板</p>
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
                <div className="project-detail">{renderProjectCard(selectedProject)}</div>
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

            {view === "dailyCompletion" && (
              <DailyCompletionPage
                onToast={showToast}
                onGenerate={(period, onResult) =>
                  openAiSession({ kind: "dailyCompletion", period, onResult })
                }
              />
            )}

            {view === "settings" && (
              <SettingsPage onSaved={showToast} openAiSession={openAiSession} />
            )}
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
          onAiGenerate={() =>
            new Promise<string>((resolve, reject) => {
              openAiSession({
                kind: "generateCommit",
                projectId: dialog.id,
                projectName: dialog.name,
                onResult: resolve,
                onError: (err) => reject(new Error(err)),
              });
            })
          }
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
          libraryFile={dialog.libraryFile}
          onClose={() => setDialog(null)}
          onSaved={() => showToast("文档已保存")}
        />
      )}

      {activityOpen && (
        <ActivitySidePanel
          aiSessions={aiSessions}
          runSessions={runSessions}
          onClose={() => setActivityOpen(false)}
          onDismissAi={(id, session) => {
            if (session.kind === "oneClick") setBusy(session.projectId, null);
            setAiSessions((items) => items.filter((item) => item.id !== id));
          }}
          onRunSessionsChange={setRunSessions}
          onLog={appendLog}
          onTargetsSaved={(projectId, targets) => {
            showToast(`已保存 ${targets.length} 个启动目标`);
            void refreshOne(projectId);
          }}
          onProjectRefresh={(projectId, session) => {
            if (session.kind === "oneClick") {
              setBusy(projectId, null);
            }
            if (session.kind === "generateTasks" || session.kind === "runTask") {
              setDocsEpoch((n) => n + 1);
            }
            void refreshOne(projectId);
          }}
          onToast={showToast}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;
