import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowLeft, ArrowRight, Folder, Loader2, PanelLeft, PanelRight, RefreshCw } from "lucide-react";
import { api } from "./api";
import { ActivitySidePanel, type AiActivity } from "./components/ActivitySidePanel";
import { AppSidebar, type NavView } from "./components/AppSidebar";
import { ChangesDialog } from "./components/ChangesDialog";
import { CommitDialog } from "./components/CommitDialog";
import { DiscardDialog } from "./components/DiscardDialog";
import { LogDiaryPage } from "./components/LogDiaryPage";
import { DailyCompletionPage } from "./components/DailyCompletionPage";
import { MarkdownEditorDialog } from "./components/MarkdownEditorDialog";
import { ProjectCard } from "./components/ProjectCard";
import { ResizableDivider } from "./components/ResizableDivider";
import { SettingsPage } from "./components/SettingsPage";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLogDiary } from "./hooks/useLogDiary";
import { useProjects } from "./hooks/useProjects";
import { newAiSessionId, type AiPanelSession } from "./lib/aiPanel";
import { useLanguage } from "./contexts/LanguageContext";
import { formatBackendError } from "./i18n";
import type { NewLogDiaryEntry, RunSession, RunTarget } from "./types";

type AppView = NavView | "project";
type AppLocation = { view: AppView; projectId: string | null };

type DialogState =
  | { type: "commit"; id: string; name: string }
  | { type: "discard"; id: string; name: string }
  | { type: "changes"; id: string; name: string }
  | { type: "doc"; id: string; relativePath: string; title: string; libraryFile?: boolean }
  | null;

type ActivityIndicator = "running" | "completed" | "failed" | null;

function isCompletedRun(session: RunSession) {
  return session.status === "exited" || session.status === "stopped";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function App() {
  const { t } = useTranslation(["common", "navigation", "projects", "activity", "errors"]);
  const { language } = useLanguage();
  const {
    projects,
    loading,
    refreshing,
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
  const [seenCompletedRunIds, setSeenCompletedRunIds] = useState<Set<string>>(() => new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [activityWidth, setActivityWidth] = useState(448);
  const [history, setHistory] = useState<AppLocation[]>([{ view: "board", projectId: null }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [docsEpoch, setDocsEpoch] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const onBoardRefresh = async () => {
    const ok = await refresh();
    if (ok) showToast(t("projects:board.refreshed"));
  };

  const onProjectRefreshClick = async () => {
    if (!selectedProjectId) return;
    const ok = await refreshOne(selectedProjectId);
    if (ok) showToast(t("projects:board.projectRefreshed"));
  };

  const appendLog = useCallback(
    (entry: NewLogDiaryEntry) => {
      void logDiary.append(entry);
    },
    [logDiary.append],
  );

  const updateRunLog = useCallback(
    (entry: Parameters<typeof logDiary.updateByRunSession>[0]) => {
      void logDiary.updateByRunSession(entry);
    },
    [logDiary.updateByRunSession],
  );

  const openAiSession = useCallback((session: AiPanelSession) => {
    setAiSessions((items) => [...items, { id: newAiSessionId(), session: { ...session, outputLanguage: session.outputLanguage ?? language } }]);
    setActivityOpen(true);
  }, [language]);

  useEffect(() => {
    void api.listRunSessions().then(setRunSessions).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!activityOpen) return;
    setSeenCompletedRunIds((seen) => {
      const next = new Set(seen);
      runSessions.filter(isCompletedRun).forEach((session) => next.add(session.id));
      return next.size === seen.size ? seen : next;
    });
  }, [activityOpen, runSessions]);

  const activityIndicator = useMemo<ActivityIndicator>(() => {
    if (activityOpen) return null;
    if (runSessions.some((session) => session.status === "failed")) return "failed";
    if (runSessions.some((session) => session.status === "running" || session.status === "stopping")) {
      return "running";
    }
    if (runSessions.some((session) => isCompletedRun(session) && !seenCompletedRunIds.has(session.id))) {
      return "completed";
    }
    return null;
  }, [activityOpen, runSessions, seenCompletedRunIds]);

  const onRunTarget = async (project: { id: string; name: string }, target: RunTarget) => {
    setActivityOpen(true);
    try {
      const session = await api.runProjectTarget(project.id, target.id);
      setRunSessions((items) => [...items, session]);
      appendLog({
        kind: "runTarget",
        status: "running",
        title: `${t("projects:card.run")} · ${target.name}`,
        projectId: project.id,
        projectName: project.name,
        runSessionId: session.id,
        detail: `cwd: ${target.cwd}\ncommand: ${target.command}\n\n${t("activity:center.runStarted")}`,
      });
    } catch (e) {
      setError(formatBackendError(e, t));
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

  const navigate = (next: AppLocation) => {
    if (next.view === view && next.projectId === selectedProjectId) return;
    setHistory((items) => {
      const nextItems = [...items.slice(0, historyIndex + 1), next];
      setHistoryIndex(nextItems.length - 1);
      return nextItems;
    });
    setView(next.view);
    setSelectedProjectId(next.projectId);
  };

  const goNav = (next: NavView) => {
    navigate({ view: next, projectId: null });
    if (next === "logDiary") void logDiary.refresh();
  };

  const openProject = (id: string) => {
    navigate({ view: "project", projectId: id });
  };

  const goHistory = (direction: -1 | 1) => {
    const nextIndex = historyIndex + direction;
    const next = history[nextIndex];
    if (!next) return;
    setHistoryIndex(nextIndex);
    setView(next.view);
    setSelectedProjectId(next.projectId);
    if (next.view === "logDiary") void logDiary.refresh();
  };

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;
  const windowControls = useMemo(() => getCurrentWindow(), []);

  const startWindowDrag = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, [role='separator']")) return;
    void windowControls.startDragging();
  };

  const onAdd = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("projects:board.chooseDirectory"),
      });
      if (!selected || Array.isArray(selected)) return;
      await api.addProject(selected);
      await refresh();
      showToast(t("projects:board.added"));
    } catch (e) {
      setError(formatBackendError(e, t));
    }
  };

  const onRemove = async (id: string, name: string) => {
    try {
      await api.removeProject(id);
      if (selectedProjectId === id) {
        setSelectedProjectId(null);
        setView("board");
      }
      await refresh();
      showToast(t("projects:board.removed", { name }));
    } catch (e) {
      setError(formatBackendError(e, t));
    }
  };

  const onOneClick = (id: string) => {
    const project = projects.find((p) => p.id === id);
    const projectName = project?.name ?? id;
    setBusy(id, t("projects:card.oneClickBusy"));
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

  const pageTitle = (() => {
    if (view === "board") {
      return t("navigation:board");
    }
    if (view === "project") {
      return selectedProject?.name ?? t("navigation:projectDetails");
    }
    if (view === "dailyCompletion") {
      return t("navigation:summary");
    }
    if (view === "logDiary") {
      return t("navigation:logDiary");
    }
    return t("navigation:settings");
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
        {sidebarOpen ? (
          <AppSidebar
            width={sidebarWidth}
            view={view}
            selectedProjectId={selectedProjectId}
            projects={projects}
            logCount={logDiary.entries.length}
            onNavigate={goNav}
            onSelectProject={openProject}
            onCollapse={() => setSidebarOpen(false)}
            onCloseWindow={() => void windowControls.close()}
            onMinimizeWindow={() => void windowControls.minimize()}
            onMaximizeWindow={() => void windowControls.toggleMaximize()}
            onBack={() => goHistory(-1)}
            onForward={() => goHistory(1)}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            onStartDragging={startWindowDrag}
          />
        ) : null}

        {sidebarOpen ? (
          <ResizableDivider
            ariaLabel={t("navigation:resize")}
            onDrag={(deltaX) => setSidebarWidth((width) => clamp(width + deltaX, 220, 420))}
          />
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/80 px-3" data-tauri-drag-region onMouseDown={startWindowDrag}>
            <div className="flex min-w-0 items-center gap-1" data-tauri-drag-region>
              {!sidebarOpen ? (
                <>
                  <div className="mr-2 flex items-center gap-1.5">
                    <button type="button" className="h-3 w-3 rounded-full bg-[#ff5f57] transition hover:brightness-90" onClick={() => void windowControls.close()} aria-label={t("common:window.close")} title={t("common:window.close")} />
                    <button type="button" className="h-3 w-3 rounded-full bg-[#febc2e] transition hover:brightness-90" onClick={() => void windowControls.minimize()} aria-label={t("common:window.minimize")} title={t("common:window.minimize")} />
                    <button type="button" className="h-3 w-3 rounded-full bg-[#28c840] transition hover:brightness-90" onClick={() => void windowControls.toggleMaximize()} aria-label={t("common:window.maximize")} title={t("common:window.maximize")} />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setSidebarOpen(true)}
                    aria-label={t("navigation:expand")}
                    title={t("navigation:expand")}
                  >
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => goHistory(-1)} disabled={!canGoBack} aria-label={t("common:window.back")} title={t("common:window.back")}>
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => goHistory(1)} disabled={!canGoForward} aria-label={t("common:window.forward")} title={t("common:window.forward")}>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </>
              ) : null}
              <div className="flex min-w-0 items-center gap-2 px-2" data-tauri-drag-region>
                {view === "project" ? <Folder className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
                <h1 className="truncate text-sm font-medium" data-tauri-drag-region>{pageTitle}</h1>
              </div>
            </div>
            <div className="flex flex-1 justify-end" data-tauri-drag-region>
              {!activityOpen ? (
                <div className="flex items-center gap-2" data-tauri-drag-region={undefined}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="relative"
                    title={t("activity:center.show")}
                    aria-label={t("activity:center.show")}
                    aria-pressed={false}
                    onClick={() => setActivityOpen(true)}
                  >
                    <PanelRight className="h-4 w-4" />
                    {activityIndicator ? (
                      <span
                        aria-hidden="true"
                        className={
                          "absolute right-0.5 top-0.5 h-2 w-2 rounded-full ring-2 ring-background " +
                          (activityIndicator === "running"
                            ? "bg-amber-400"
                            : activityIndicator === "completed"
                              ? "bg-emerald-400"
                              : "bg-destructive")
                        }
                      />
                    ) : null}
                  </Button>
                </div>
              ) : null}
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col">
          {error ? (
            <div
              className="flex items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-sm text-destructive"
              role="alert"
            >
              <span className="min-w-0 truncate">{error}</span>
              <Button type="button" variant="ghost" size="xs" onClick={() => setError(null)}>
                {t("common:actions.close")}
              </Button>
            </div>
          ) : null}

          <main className="flex-1 overflow-y-auto p-6">
            {view === "board" && (
              <>
                <div className="mb-5 flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={refreshing || loading}
                    onClick={() => void onBoardRefresh()}
                  >
                    {refreshing ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <RefreshCw className="size-3.5" aria-hidden />
                    )}
                    {refreshing ? t("common:actions.refreshing") : t("common:actions.refresh")}
                  </Button>
                  <Button type="button" size="sm" onClick={() => void onAdd()}>
                    {t("projects:board.add")}
                  </Button>
                </div>
                {loading ? (
                <div className="px-2 py-16 text-center text-sm text-muted-foreground">{t("common:state.loading")}</div>
              ) : projects.length === 0 ? (
                <div className="mx-auto max-w-md px-2 py-16 text-center">
                  <h2 className="text-lg font-semibold">{t("projects:board.emptyTitle")}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("projects:board.emptyDescription")}
                  </p>
                  <Button type="button" className="mt-4" onClick={() => void onAdd()}>
                    {t("projects:board.addFirst")}
                  </Button>
                </div>
              ) : (
                <div className="grid gap-5 xl:grid-cols-2">{projects.map((p) => renderProjectCard(p))}</div>
                )}
              </>
            )}

            {view === "project" && (
              <>
                <div className="mb-5 flex items-center justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!selectedProjectId || refreshing || loading}
                    onClick={() => void onProjectRefreshClick()}
                  >
                    {refreshing ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <RefreshCw className="size-3.5" aria-hidden />
                    )}
                    {refreshing ? t("common:actions.refreshing") : t("common:actions.refresh")}
                  </Button>
                </div>
                {loading ? (
                <div className="px-2 py-16 text-center text-sm text-muted-foreground">{t("common:state.loading")}</div>
              ) : !selectedProject ? (
                <div className="mx-auto max-w-md px-2 py-16 text-center">
                  <h2 className="text-lg font-semibold">{t("projects:board.missingTitle")}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{t("projects:board.missingDescription")}</p>
                  <Button type="button" className="mt-4" onClick={() => goNav("board")}>
                    {t("projects:board.back")}
                  </Button>
                </div>
              ) : (
                renderProjectCard(selectedProject)
                )}
              </>
            )}

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

        {activityOpen ? (
          <ResizableDivider
            ariaLabel={t("activity:center.resize")}
            onDrag={(deltaX) => setActivityWidth((width) => clamp(width - deltaX, 300, 640))}
          />
        ) : null}

        <ActivitySidePanel
          open={activityOpen}
          width={activityWidth}
          aiSessions={aiSessions}
          runSessions={runSessions}
          onHide={() => setActivityOpen(false)}
          onDismissAi={(id, session) => {
            if (session.kind === "oneClick") setBusy(session.projectId, null);
            setAiSessions((items) => items.filter((item) => item.id !== id));
          }}
          onRunSessionsChange={setRunSessions}
          onLog={appendLog}
          onUpdateRunLog={updateRunLog}
          onTargetsSaved={(projectId, targets) => {
            showToast(t("activity:center.targetsSaved", { count: targets.length }));
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

        {dialog?.type === "commit" && (
          <CommitDialog
            projectId={dialog.id}
            projectName={dialog.name}
            onClose={() => setDialog(null)}
            onDone={() => {
              void refreshOne(dialog.id);
              showToast(t("projects:commit.done"));
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
              showToast(t("projects:discard.done"));
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
            onSaved={() => showToast(t("projects:docs.saved"))}
          />
        )}

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
