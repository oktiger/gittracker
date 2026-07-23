import { MoreHorizontal, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import type {
  DocsOverview,
  DocsTaskItem,
  FileChange,
  NewLogDiaryEntry,
  ProjectStatus,
  RunTarget,
} from "../types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { workingTreeBadge } from "../lib/gitStatusBadge";
import { DocumentLibraryTab } from "./DocumentLibraryTab";
import { EvolutionPage } from "./EvolutionPage";
import { GitStatusIcon } from "./GitStatusIcon";
import { useLanguage } from "../contexts/LanguageContext";
import { formatBackendError } from "../i18n";
import { formatRelativeTime } from "../lib/formatters";

interface Props {
  project: ProjectStatus;
  busy?: string;
  hideTitle?: boolean;
  onOpenProject?: () => void;
  onManualCommit: () => void;
  onOneClick: () => void;
  onDiscard: () => void;
  onViewChanges: () => void;
  onViewChangedFile: (file: FileChange) => void;
  onRemove: () => void;
  onRunTarget: (target: RunTarget) => void;
  onOpenDoc: (relativePath: string, title: string, libraryFile?: boolean) => void;
  onConfigureRun: (mode: "identify" | "config") => void;
  onGenerateTasks: () => void;
  onImplementTask: (task: DocsTaskItem) => void;
  onExecuteDocument: (node: import("../types").DocumentNode) => void;
  docsEpoch?: number;
  onError: (msg: string) => void;
  onToast: (msg: string) => void;
  onLog: (entry: NewLogDiaryEntry) => void;
}

export function ProjectCard({
  project,
  busy,
  hideTitle = false,
  onOpenProject,
  onManualCommit,
  onOneClick,
  onDiscard,
  onViewChanges: _onViewChanges,
  onViewChangedFile,
  onRemove,
  onRunTarget: onRunTargetFromCenter,
  onOpenDoc,
  onConfigureRun,
  onGenerateTasks,
  onImplementTask,
  onExecuteDocument,
  docsEpoch = 0,
  onError,
  onToast,
  onLog,
}: Props) {
  const { t } = useTranslation(["projects", "common", "errors"]);
  const { language } = useLanguage();
  const disabled = Boolean(busy);
  const hasChanges = !project.clean;
  const changeCount = project.staged + project.unstaged + project.untracked;
  const [docs, setDocs] = useState<DocsOverview | null>(null);
  const [docsBusy, setDocsBusy] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [detailTab, setDetailTab] = useState("run");
  const [changedFiles, setChangedFiles] = useState<Awaited<ReturnType<typeof api.listChangedFiles>>>([]);
  const [changesLoading, setChangesLoading] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const targets: RunTarget[] = project.runTargets ?? [];
  const hasTargets = targets.length > 0;
  const locked = disabled || Boolean(docsBusy) || runBusy;
  const detailTabTriggerClass =
    "rounded-full px-3 py-1.5 text-muted-foreground shadow-none data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-muted dark:data-[state=active]:text-foreground";

  const loadDocs = async () => {
    try {
      setDocs(await api.listDocs(project.id));
    } catch (e) {
      setDocs(null);
      onError(formatBackendError(e, t));
    }
  };

  useEffect(() => {
    void loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.path, docsEpoch]);

  useEffect(() => {
    // 看板始终加载改动；详情页仅在「代码」Tab 加载
    if (hideTitle && detailTab !== "code") return;
    setChangesLoading(true);
    void api
      .listChangedFiles(project.id)
      .then(setChangedFiles)
      .catch((e) => onError(formatBackendError(e, t)))
      .finally(() => setChangesLoading(false));
  }, [
    hideTitle,
    detailTab,
    project.id,
    project.clean,
    project.staged,
    project.unstaged,
    project.untracked,
  ]);

  const onRunTarget = async (targetId: string) => {
    setRunBusy(true);
    const target = targets.find((x) => x.id === targetId);
    try {
      if (!target) throw new Error("runTargetNotFound");
      onRunTargetFromCenter(target);
    } catch (e) {
      const msg = e instanceof Error && e.message === "runTargetNotFound" ? t("projects:card.runTargetMissing") : formatBackendError(e, t);
      onLog({
        kind: "runTarget",
        status: "error",
        title: t("projects:card.runFailed", { name: target?.name ?? targetId }),
        projectId: project.id,
        projectName: project.name,
        detail: target ? `cwd: ${target.cwd}\ncommand: ${target.command}` : undefined,
        error: msg,
      });
      onError(msg);
    } finally {
      setRunBusy(false);
    }
  };

  const onIdentify = () => {
    if (
      hasTargets &&
      !window.confirm(t("projects:card.replaceTargets"))
    ) {
      return;
    }
    onConfigureRun("identify");
  };

  const onCreateDocs = async () => {
    setDocsBusy(t("projects:docs.initializing"));
    try {
      const overview = await api.ensureDocs(project.id, language);
      setDocs(overview);
      onLog({
        kind: "ensureDocs",
        status: "ok",
        title: t("projects:docs.initializeLog", { name: project.name }),
        projectId: project.id,
        projectName: project.name,
        detail: `Goal: ${overview.goalExists ? t("projects:docs.goalExisting") : t("projects:docs.goalMissing")}\nTasks: ${overview.tasks.length}`,
      });
      onToast(t("projects:docs.initialized"));
    } catch (e) {
      const msg = formatBackendError(e, t);
      onLog({
        kind: "ensureDocs",
        status: "error",
        title: t("projects:docs.initializeFailed", { name: project.name }),
        projectId: project.id,
        projectName: project.name,
        error: msg,
      });
      onError(msg);
    } finally {
      setDocsBusy(null);
    }
  };

  const statusBadge = (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
        project.clean
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          : "border-amber-500/30 bg-amber-500/10 text-amber-400",
      )}
    >
      {docsBusy ? t("projects:status.aiWorking") : project.clean ? t("projects:status.clean") : t("projects:status.changed")}
    </Badge>
  );

  const projectSettingsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={locked}
          title={t("projects:card.projectSettings")}
          aria-label={t("projects:card.projectSettings")}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => setRemoveConfirmOpen(true)}
        >
          {t("projects:card.remove")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const removeConfirmDialog = (
    <AlertDialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("projects:card.removeTitle", { name: project.name })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("projects:card.removeDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setRemoveConfirmOpen(false);
              onRemove();
            }}
          >
            {t("common:actions.remove")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const currentChangesSection = (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground">
        {t("projects:card.currentChanges")}
        {changeCount > 0 ? (
          <span className="ml-1.5 font-normal tabular-nums">{changeCount}</span>
        ) : null}
      </h3>
      {changesLoading ? (
        <p className="py-3 text-xs text-muted-foreground">{t("common:state.loading")}</p>
      ) : changedFiles.length === 0 ? (
        <p className="py-3 text-xs text-muted-foreground">{t("projects:changesDialog.empty")}</p>
      ) : (
        <ul className="max-h-64 overflow-y-auto">
          {changedFiles.map((file) => {
            const badge = workingTreeBadge(file);
            return (
              <li key={file.path}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 py-1.5 text-left text-xs hover:bg-accent/40"
                  onClick={() => onViewChangedFile(file)}
                >
                  <span
                    className="min-w-0 truncate font-mono text-muted-foreground"
                    title={file.path}
                  >
                    {file.path}
                  </span>
                  <GitStatusIcon badge={badge} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const commitHistorySection = (limit?: number) => {
    const commits = typeof limit === "number" ? project.commits.slice(0, limit) : project.commits;
    return (
      <section className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground">
            {t("projects:card.commitHistory")}
          </h3>
          {typeof limit === "number" ? (
            <span className="text-[11px] text-muted-foreground">{t("projects:card.recentThree")}</span>
          ) : null}
        </div>
        {commits.length === 0 ? (
          <p className="py-3 text-xs text-muted-foreground">{t("projects:card.noCommits")}</p>
        ) : (
          <ul
            className={cn(
              "overflow-y-auto",
              typeof limit === "number" ? undefined : "max-h-[min(45vh,480px)]",
            )}
          >
            {commits.map((c) => (
              <li
                key={c.hash}
                className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-baseline gap-2 py-1.5 text-xs"
              >
                <span className="font-mono text-sky-400">{c.hash}</span>
                <span className="truncate text-foreground/90" title={c.subject}>
                  {c.subject}
                </span>
                <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                  {formatRelativeTime(c.timestamp, language)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  const boardCodeActions = (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        type="button"
        size="xs"
        disabled={locked || !hasChanges}
        onClick={onOneClick}
      >
        {t("projects:card.oneClick")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="text-destructive hover:bg-destructive/10"
        disabled={locked || !hasChanges}
        onClick={onDiscard}
      >
        {t("projects:card.discardAll")}
      </Button>
    </div>
  );

  /** 看板代码区：当前改动 → 一键提交/放弃 → 最近 3 条提交；分区用标题与间距，不套内层卡片 */
  const boardCodeModule = (
    <section className="space-y-5">
      {currentChangesSection}
      {boardCodeActions}
      {commitHistorySection(3)}
    </section>
  );

  if (hideTitle) {
    return (
      <div className="space-y-4">
        {removeConfirmDialog}
        <Tabs value={detailTab} onValueChange={setDetailTab}>
          <div className="flex items-center justify-between gap-2">
            <TabsList className="h-auto gap-1 bg-transparent p-0">
              <TabsTrigger value="run" className={detailTabTriggerClass}>
                {t("projects:card.tabs.run")}
              </TabsTrigger>
              <TabsTrigger value="code" className={detailTabTriggerClass}>
                {t("projects:card.tabs.code")}
              </TabsTrigger>
              <TabsTrigger value="docs" className={detailTabTriggerClass}>
                {t("projects:card.tabs.documents")}
              </TabsTrigger>
              <TabsTrigger value="evolution" className={detailTabTriggerClass}>
                {t("projects:card.tabs.evolution")}
              </TabsTrigger>
            </TabsList>
            {projectSettingsMenu}
          </div>

          <TabsContent value="run" className="mt-4">
            <div className="rounded-lg border border-border bg-card">
              {hasTargets ? (
                <ul className="divide-y divide-border">
                  {targets.map((target) => (
                    <li
                      key={target.id}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {target.name}
                          {target.isDefault ? (
                            <>
                              {" "}
                              ★{" "}
                              <Badge variant="secondary" className="text-[10px]">
                                default
                              </Badge>
                            </>
                          ) : null}
                        </div>
                        <code className="block font-mono text-xs text-muted-foreground">
                          {target.cwd} · {target.command}
                        </code>
                        {target.description ? (
                          <span className="block text-xs text-muted-foreground">
                            {target.description}
                          </span>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        className="shrink-0"
                        disabled={locked}
                        onClick={() => void onRunTarget(target.id)}
                      >
                        <Play className="h-3 w-3" />
                        {t("projects:card.run")}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-muted-foreground">{t("projects:card.noRunnable")}</p>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={locked}
                  onClick={() => onConfigureRun("config")}
                >
                  {t("projects:card.customConfig")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={locked}
                  onClick={onIdentify}
                >
                  {t("projects:card.reIdentify")}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="code" className="mt-4 space-y-6">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                {project.branch || "—"}
              </code>
              {statusBadge}
              {(project.ahead > 0 || project.behind > 0) && (
                <span className="text-muted-foreground">
                  {project.ahead > 0 ? `↑${project.ahead}` : null}
                  {project.behind > 0 ? ` ↓${project.behind}` : null}
                </span>
              )}
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  size="xs"
                  disabled={locked || !hasChanges}
                  onClick={onOneClick}
                >
                  {t("projects:card.oneClick")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={locked || !hasChanges}
                  onClick={onManualCommit}
                >
                  {t("projects:card.manualCommit")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="text-destructive hover:bg-destructive/10"
                  disabled={locked || !hasChanges}
                  onClick={onDiscard}
                >
                  {t("projects:card.discardAll")}
                </Button>
              </div>
            </div>

            {currentChangesSection}
            {commitHistorySection()}
          </TabsContent>

          <TabsContent value="docs" className="mt-4">
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <DocumentLibraryTab
                projectId={project.id}
                projectPath={project.path}
                epoch={docsEpoch}
                onOpenFile={(relativePath, title) =>
                  onOpenDoc(relativePath, title, true)
                }
                onExecute={onExecuteDocument}
                onError={onError}
                onToast={onToast}
              />
            </div>
          </TabsContent>

          <TabsContent value="evolution" className="mt-4">
            <EvolutionPage
              overview={docs}
              busy={locked}
              onInitialize={() => void onCreateDocs()}
              onGenerateTasks={onGenerateTasks}
              onImplementTask={onImplementTask}
              onOpenGoal={(relativePath, title) => onOpenDoc(relativePath, title)}
              onOpenTask={(task) => {
                if (task.kind === "html") {
                  void api
                    .openDocExternal(project.id, task.relativePath)
                    .then(() => onToast(t("projects:card.htmlOpened")))
                    .catch((e) => onError(formatBackendError(e, t)));
                  return;
                }
                onOpenDoc(
                  task.relativePath,
                  `${String(task.number).padStart(3, "0")} ${task.title}`,
                );
              }}
            />
          </TabsContent>
        </Tabs>
        {(busy || docsBusy || runBusy) && (
          <p className="text-xs text-muted-foreground">
            {busy || docsBusy || (runBusy ? t("projects:card.starting") : null)}
          </p>
        )}
      </div>
    );
  }

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      {removeConfirmDialog}
      <header className="flex items-center justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 truncate text-base font-semibold tracking-tight">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_0_4px_hsl(var(--primary)/.08)]" />
            <button
              type="button"
              className="text-left hover:underline"
              onClick={onOpenProject}
              title={project.path}
            >
              {project.name}
            </button>
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {project.ahead > 0 ? <span>↑{project.ahead} {t("projects:status.ahead")}</span> : null}
            {project.behind > 0 ? <span>↓{project.behind} {t("projects:status.behind")}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {statusBadge}
          {projectSettingsMenu}
        </div>
      </header>

      {project.error ? (
        <p className="border-b border-border py-2 text-xs text-destructive">{project.error}</p>
      ) : null}

      <div className="space-y-5 pt-4">
        {boardCodeModule}
        <section className="overflow-hidden border-t border-border pt-4">
          <DocumentLibraryTab
            projectId={project.id}
            projectPath={project.path}
            epoch={docsEpoch}
            onOpenFile={(relativePath, title) => onOpenDoc(relativePath, title, true)}
            onExecute={onExecuteDocument}
            onError={onError}
            onToast={onToast}
          />
        </section>
      </div>

      {(busy || docsBusy || runBusy) && (
        <div className="border-t border-border pt-2 text-xs text-muted-foreground">
          {busy || docsBusy || (runBusy ? t("projects:card.starting") : null)}
        </div>
      )}
    </article>
  );
}
