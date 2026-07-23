import { Check, ChevronDown, MoreHorizontal, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import type {
  BranchList,
  CommitInfo,
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  onViewChanges,
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
  const [branches, setBranches] = useState<BranchList | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [commitHistory, setCommitHistory] = useState<CommitInfo[]>([]);
  const [commitHistoryLoading, setCommitHistoryLoading] = useState(false);
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
    if (detailTab !== "code") return;
    setChangesLoading(true);
    void api.listChangedFiles(project.id).then(setChangedFiles).catch((e) => onError(formatBackendError(e, t))).finally(() => setChangesLoading(false));
  }, [detailTab, project.id, project.clean, project.staged, project.unstaged, project.untracked]);

  useEffect(() => {
    if (detailTab !== "code") return;
    setBranchesLoading(true);
    void api
      .listBranches(project.id)
      .then(setBranches)
      .catch((e) => {
        setBranches(null);
        onError(formatBackendError(e, t));
      })
      .finally(() => setBranchesLoading(false));
  }, [detailTab, project.id, project.branch]);

  useEffect(() => {
    if (detailTab !== "code") return;
    setCommitHistoryLoading(true);
    void api
      .listCommitHistory(project.id)
      .then(setCommitHistory)
      .catch((e) => {
        setCommitHistory([]);
        onError(formatBackendError(e, t));
      })
      .finally(() => setCommitHistoryLoading(false));
  }, [detailTab, project.id, project.branch, project.commits[0]?.hash]);

  const branchBadgeClass = (branch: BranchList["local"][number]) => {
    if (branch.current) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-500";
    if (branch.kind === "remote") return "border-border bg-muted text-muted-foreground";
    if (branch.name === "main" || branch.name === "master") return "border-sky-500/30 bg-sky-500/10 text-sky-500";
    return "border-violet-500/30 bg-violet-500/10 text-violet-500";
  };

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

  const runMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="xs" disabled={locked}>
          <Play className="h-3 w-3" />
          {t("projects:card.run")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {hasTargets ? (
          <>
            {targets.map((t) => (
              <DropdownMenuItem
                key={t.id}
                className="flex-col items-start gap-0.5"
                onClick={() => void onRunTarget(t.id)}
              >
                <span className="text-sm font-medium">
                  {t.name}
                  {t.isDefault ? " ★" : ""}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {t.description?.trim() || `${t.cwd} · ${t.command}`}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onConfigureRun("config")}>
              {t("projects:card.configureTargets")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onIdentify}>{t("projects:card.identifyAgain")}</DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onClick={onIdentify}>{t("projects:card.identifyTargets")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onConfigureRun("config")}>
              {t("projects:card.addTarget")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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

  const codeModule = (
    <section className="overflow-hidden">
      <header className="mb-2 flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{t("projects:card.code")}</span>
        </div>
        <span className="text-[11px] text-muted-foreground">{t("projects:card.recentThree")}</span>
      </header>
      {project.commits.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">{t("projects:card.noCommits")}</p>
      ) : (
        <ul className="max-h-[min(55vh,640px)] divide-y divide-border overflow-y-auto">
          {project.commits.map((c) => (
            <li
              key={c.hash}
              className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-baseline gap-2 py-2.5 text-xs"
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
      <footer className="flex flex-wrap items-center justify-between gap-2 pt-3">
        <span className="text-[11px] text-muted-foreground">
          {t("projects:card.changeCount", { count: changeCount })}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={locked || !hasChanges}
            onClick={onOneClick}
          >
            {t("projects:card.allCommits")}
          </Button>
          {runMenu}
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={locked || changeCount === 0}
            onClick={onViewChanges}
          >
            {t("projects:card.viewChanges")}
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={locked || !hasChanges}
            onClick={onManualCommit}
          >
            {t("projects:card.commitAction")}
          </Button>
        </div>
      </footer>
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="h-7 gap-1 font-mono text-xs"
                    aria-label={t("projects:card.currentBranch")}
                  >
                    {project.branch || "—"}
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[14rem] max-w-[20rem]">
                  {branchesLoading ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      {t("projects:card.loadingBranches")}
                    </div>
                  ) : !branches || (branches.local.length === 0 && branches.remote.length === 0) ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      {t("projects:card.noBranches")}
                    </div>
                  ) : (
                    <>
                      {branches.local.length > 0 ? (
                        <>
                          <DropdownMenuLabel>{t("projects:card.localBranches")}</DropdownMenuLabel>
                          {branches.local.map((branch) => (
                            <DropdownMenuItem
                              key={`local:${branch.name}`}
                              className="font-mono text-xs"
                              onSelect={(event) => event.preventDefault()}
                            >
                              <span className="min-w-0 flex-1 truncate">{branch.name}</span>
                              {branch.current ? (
                                <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />
                              ) : null}
                            </DropdownMenuItem>
                          ))}
                        </>
                      ) : null}
                      {branches.local.length > 0 && branches.remote.length > 0 ? (
                        <DropdownMenuSeparator />
                      ) : null}
                      {branches.remote.length > 0 ? (
                        <>
                          <DropdownMenuLabel>{t("projects:card.remoteBranches")}</DropdownMenuLabel>
                          {branches.remote.map((branch) => (
                            <DropdownMenuItem
                              key={`remote:${branch.name}`}
                              className="font-mono text-xs text-muted-foreground"
                              onSelect={(event) => event.preventDefault()}
                            >
                              <span className="min-w-0 flex-1 truncate">{branch.name}</span>
                            </DropdownMenuItem>
                          ))}
                        </>
                      ) : null}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
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

            <section className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground">
                  {t("projects:card.commitHistory")}
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  {t("projects:card.allBranches")}
                </span>
              </div>
              {commitHistoryLoading ? (
                <p className="py-3 text-xs text-muted-foreground">{t("projects:card.loadingCommits")}</p>
              ) : commitHistory.length === 0 ? (
                <p className="py-3 text-xs text-muted-foreground">{t("projects:card.noCommits")}</p>
              ) : (
                <div className="max-h-[min(45vh,480px)] overflow-y-auto rounded-lg border border-border">
                  <Table className="min-w-[860px] text-xs">
                    <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                      <TableRow>
                        <TableHead>{t("projects:card.commitHash")}</TableHead>
                        <TableHead>{t("projects:card.commitBranches")}</TableHead>
                        <TableHead>{t("projects:card.commitSubject")}</TableHead>
                        <TableHead>{t("projects:card.commitAuthor")}</TableHead>
                        <TableHead>{t("projects:card.commitTime")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {commitHistory.map((commit) => (
                        <TableRow key={commit.hash}>
                          <TableCell className="font-mono text-sky-500">{commit.hash.slice(0, 7)}</TableCell>
                          <TableCell className="max-w-[320px] whitespace-normal">
                            <div className="flex flex-wrap gap-1">
                              {commit.branches.map((branch) => (
                                <Badge
                                  key={`${branch.kind}:${branch.name}`}
                                  variant="outline"
                                  className={cn("rounded-full px-1.5 py-0 text-[10px] font-medium", branchBadgeClass(branch))}
                                >
                                  {branch.current ? `HEAD → ${branch.name}` : branch.name}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[360px] truncate" title={commit.subject}>{commit.subject}</TableCell>
                          <TableCell className="text-muted-foreground">{commit.author}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{formatRelativeTime(commit.timestamp, language)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
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
    <article className="bg-card">
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
        <p className="border-b border-border px-4 py-2 text-xs text-destructive">{project.error}</p>
      ) : null}

      <div className="space-y-4 pt-4">
        {codeModule}
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
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          {busy || docsBusy || (runBusy ? t("projects:card.starting") : null)}
        </div>
      )}
    </article>
  );
}
