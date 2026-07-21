import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { PanelRight } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLogDiary } from "./hooks/useLogDiary";
import { useProjects } from "./hooks/useProjects";
import { newAiSessionId, type AiPanelSession } from "./lib/aiPanel";
import type { NewLogDiaryEntry, RunSession, RunTarget } from "./types";

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
  const [upgrading, setUpgrading] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const onUpgradeSelf = async () => {
    if (upgrading) return;
    setUpgrading(true);
    setActivityOpen(true);
    try {
      const session = await api.upgradeSelf();
      setRunSessions((items) => [...items, session]);
      appendLog({
        kind: "runTarget",
        status: "running",
        title: "升级 · GitTracker",
        projectName: "GitTracker",
        detail:
          "正在打包；成功后会自动退出、替换本机应用并重新打开。过程见运行中心。",
      });
      showToast("已开始升级，完成后将自动重启");
    } catch (e) {
      setError(String(e));
      setUpgrading(false);
    }
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

  useEffect(() => {
    if (!upgrading) return;
    const latest = [...runSessions]
      .reverse()
      .find((s) => s.targetId === "__self_upgrade__");
    if (!latest || latest.status === "running" || latest.status === "stopping") return;
    if (latest.status === "failed" || latest.status === "stopped") {
      setUpgrading(false);
      return;
    }
    if (latest.status === "exited" && latest.exitCode !== 0) {
      setUpgrading(false);
    }
  }, [runSessions, upgrading]);

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
      } catch {
        /* 下次轮询重试；不打断主界面 */
      }
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

  const headerMeta = (() => {
    if (view === "board") {
      return {
        eyebrow: null as string | null,
        title: "看板",
        desc: (
          <>
            总览全部项目状态 · 变更自动刷新
            <HelpTip text="文件变更自动刷新；每 60 秒兜底全量刷新。关闭窗口后仍驻留托盘。" />
          </>
        ),
      };
    }
    if (view === "project") {
      return {
        eyebrow: "← 看板",
        title: selectedProject?.name ?? "项目详情",
        desc: selectedProject?.path ?? "",
      };
    }
    if (view === "dailyCompletion") {
      return {
        eyebrow: null,
        title: "总结",
        desc: "从 commit message 整理可分享的工作总结",
      };
    }
    if (view === "logDiary") {
      return {
        eyebrow: null,
        title: "日志",
        desc: "记录一键提交、AI 操作与其它事件",
      };
    }
    return {
      eyebrow: null,
      title: "设置",
      desc: "AI Provider 与提示词模板",
    };
  })();

  const renderProjectCard = (p: (typeof projects)[number]) => (
    <ProjectCard
      key={p.id}
      project={p}
      hideTitle={view === "project"}
      busy={busyIds[p.id]}
      onOpenProject={() => openProject(p.id)}
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
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full">
        <AppSidebar
          view={view}
          selectedProjectId={selectedProjectId}
          projects={projects}
          logCount={logDiary.entries.length}
          upgrading={upgrading}
          onNavigate={goNav}
          onSelectProject={openProject}
          onUpgrade={() => void onUpgradeSelf()}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-end justify-between gap-4 border-b border-border px-6 py-4">
            <div>
              {headerMeta.eyebrow ? (
                <button
                  type="button"
                  className="mb-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => goNav("board")}
                >
                  {headerMeta.eyebrow}
                </button>
              ) : null}
              <h1 className="text-xl font-semibold tracking-tight">{headerMeta.title}</h1>
              <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                {headerMeta.desc}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {view === "board" ? (
                <>
                  <Button type="button" variant="outline" onClick={() => void refresh()}>
                    刷新
                  </Button>
                  <Button type="button" onClick={() => void onAdd()}>
                    添加项目
                  </Button>
                </>
              ) : null}
              {view === "project" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => selectedProjectId && void refreshOne(selectedProjectId)}
                  disabled={!selectedProjectId}
                >
                  刷新
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="运行中心"
                aria-label="打开运行中心"
                onClick={() => setActivityOpen(true)}
              >
                <PanelRight className="h-4 w-4" />
              </Button>
            </div>
          </header>

          {error ? (
            <div
              className="flex items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-sm text-destructive"
              role="alert"
            >
              <span className="min-w-0 truncate">{error}</span>
              <Button type="button" variant="ghost" size="xs" onClick={() => setError(null)}>
                关闭
              </Button>
            </div>
          ) : null}

          <main className="flex-1 overflow-y-auto p-6">
            {view === "board" &&
              (loading ? (
                <div className="px-2 py-16 text-center text-sm text-muted-foreground">加载中…</div>
              ) : projects.length === 0 ? (
                <div className="mx-auto max-w-md px-2 py-16 text-center">
                  <h2 className="text-lg font-semibold">还没有项目</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    添加本地 Git 仓库，即可在同一窗口查看状态并提交。
                  </p>
                  <Button type="button" className="mt-4" onClick={() => void onAdd()}>
                    添加第一个项目
                  </Button>
                </div>
              ) : (
                <div className="grid gap-5 xl:grid-cols-2">{projects.map((p) => renderProjectCard(p))}</div>
              ))}

            {view === "project" &&
              (loading ? (
                <div className="px-2 py-16 text-center text-sm text-muted-foreground">加载中…</div>
              ) : !selectedProject ? (
                <div className="mx-auto max-w-md px-2 py-16 text-center">
                  <h2 className="text-lg font-semibold">项目不存在</h2>
                  <p className="mt-2 text-sm text-muted-foreground">该项目可能已被移除。</p>
                  <Button type="button" className="mt-4" onClick={() => goNav("board")}>
                    返回看板
                  </Button>
                </div>
              ) : (
                renderProjectCard(selectedProject)
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

        <ActivitySidePanel
          open={activityOpen}
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

        {toast ? (
          <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-md border border-border bg-card px-4 py-2 text-sm shadow-lg">
            {toast}
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

export default App;
