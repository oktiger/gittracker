import { MoreHorizontal, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type {
  DocsOverview,
  DocsTaskItem,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { workingTreeBadge } from "../lib/gitStatusBadge";
import { DocumentLibraryTab } from "./DocumentLibraryTab";
import { EvolutionPage } from "./EvolutionPage";
import { GitStatusIcon } from "./GitStatusIcon";

interface Props {
  project: ProjectStatus;
  busy?: string;
  hideTitle?: boolean;
  onOpenProject?: () => void;
  onManualCommit: () => void;
  onOneClick: () => void;
  onDiscard: () => void;
  onViewChanges: () => void;
  onRemove: () => void;
  onRunTarget: (target: RunTarget) => void;
  onOpenDoc: (relativePath: string, title: string, libraryFile?: boolean) => void;
  onConfigureRun: (mode: "identify" | "config") => void;
  onGenerateTasks: () => void;
  onImplementTask: (task: DocsTaskItem) => void;
  docsEpoch?: number;
  onError: (msg: string) => void;
  onToast: (msg: string) => void;
  onLog: (entry: NewLogDiaryEntry) => void;
}

function relativeTime(ts: number): string {
  if (!ts) return "";
  const diff = Math.max(0, Date.now() / 1000 - ts);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(ts * 1000).toLocaleDateString("zh-CN");
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
  onRemove,
  onRunTarget: onRunTargetFromCenter,
  onOpenDoc,
  onConfigureRun,
  onGenerateTasks,
  onImplementTask,
  docsEpoch = 0,
  onError,
  onToast,
  onLog,
}: Props) {
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

  const loadDocs = async () => {
    try {
      setDocs(await api.listDocs(project.id));
    } catch (e) {
      setDocs(null);
      onError(String(e));
    }
  };

  useEffect(() => {
    void loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.path, docsEpoch]);

  useEffect(() => {
    if (detailTab !== "code") return;
    setChangesLoading(true);
    void api.listChangedFiles(project.id).then(setChangedFiles).catch((e) => onError(String(e))).finally(() => setChangesLoading(false));
  }, [detailTab, project.id, project.clean, project.staged, project.unstaged, project.untracked]);

  const onRunTarget = async (targetId: string) => {
    setRunBusy(true);
    const t = targets.find((x) => x.id === targetId);
    try {
      if (!t) throw new Error("未找到启动目标");
      onRunTargetFromCenter(t);
    } catch (e) {
      const msg = String(e);
      onLog({
        kind: "runTarget",
        status: "error",
        title: `运行失败 · ${t?.name ?? targetId}`,
        projectId: project.id,
        projectName: project.name,
        detail: t ? `cwd: ${t.cwd}\ncommand: ${t.command}` : undefined,
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
      !window.confirm("将用新的识别结果替换当前启动目标，是否继续？")
    ) {
      return;
    }
    onConfigureRun("identify");
  };

  const onCreateDocs = async () => {
    setDocsBusy("正在初始化…");
    try {
      const overview = await api.ensureDocs(project.id);
      setDocs(overview);
      onLog({
        kind: "ensureDocs",
        status: "ok",
        title: `初始化 DOCS · ${project.name}`,
        projectId: project.id,
        projectName: project.name,
        detail: `Goal: ${overview.goalExists ? "已有" : "未检测到"}\nTasks: ${overview.tasks.length}`,
      });
      onToast("已初始化 Goal / Task 与 goal.md");
    } catch (e) {
      const msg = String(e);
      onLog({
        kind: "ensureDocs",
        status: "error",
        title: `初始化 DOCS 失败 · ${project.name}`,
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
      {docsBusy ? "AI 工作中" : project.clean ? "Clean" : "Changed"}
    </Badge>
  );

  const runMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="xs" disabled={locked}>
          <Play className="h-3 w-3" />
          运行
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
              配置启动方式…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onIdentify}>重新用 AI 识别…</DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onClick={onIdentify}>识别启动方式…</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onConfigureRun("config")}>
              手动添加一条…
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
          title="项目设置"
          aria-label="项目设置"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => setRemoveConfirmOpen(true)}
        >
          移除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const removeConfirmDialog = (
    <AlertDialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>移除「{project.name}」？</AlertDialogTitle>
          <AlertDialogDescription>
            将从 GitTracker 中移除该项目，不会删除磁盘上的仓库。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setRemoveConfirmOpen(false);
              onRemove();
            }}
          >
            移除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const codeModule = (
    <section className="overflow-hidden">
      <header className="mb-2 flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">代码</span>
        </div>
        <span className="text-[11px] text-muted-foreground">最近 3 次提交</span>
      </header>
      {project.commits.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">暂无提交</p>
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
                {relativeTime(c.timestamp)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <footer className="flex flex-wrap items-center justify-between gap-2 pt-3">
        <span className="text-[11px] text-muted-foreground">
          {changeCount} 处改动
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={locked || !hasChanges}
            onClick={onOneClick}
          >
            全部提交
          </Button>
          {runMenu}
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={locked || changeCount === 0}
            onClick={onViewChanges}
          >
            查看变更
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={locked || !hasChanges}
            onClick={onManualCommit}
          >
            提交…
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
            <TabsList className="h-auto rounded-lg border border-border bg-muted/40 p-1">
              <TabsTrigger value="run" className="rounded-md px-3 py-1.5">
                运行
              </TabsTrigger>
              <TabsTrigger value="code" className="rounded-md px-3 py-1.5">
                代码
              </TabsTrigger>
              <TabsTrigger value="docs" className="rounded-md px-3 py-1.5">
                文档
              </TabsTrigger>
              <TabsTrigger value="evolution" className="rounded-md px-3 py-1.5">
                进化
              </TabsTrigger>
            </TabsList>
            {projectSettingsMenu}
          </div>

          <TabsContent value="run" className="mt-4">
            <div className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <h3 className="text-sm font-medium">可运行命令</h3>
                  <p className="text-xs text-muted-foreground">来自项目配置 / AI 识别</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={locked}
                  onClick={() => onConfigureRun("config")}
                >
                  配置
                </Button>
              </div>
              {hasTargets ? (
                <ul className="divide-y divide-border">
                  {targets.map((target) => (
                    <li key={target.id}>
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => void onRunTarget(target.id)}
                        className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-accent/50 disabled:opacity-50"
                      >
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
                        <code className="font-mono text-xs text-muted-foreground">
                          {target.cwd} · {target.command}
                        </code>
                        {target.description ? (
                          <span className="text-xs text-muted-foreground">
                            {target.description}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-muted-foreground">还没有可运行的命令</p>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-3"
                    disabled={locked}
                    onClick={onIdentify}
                  >
                    识别启动方式
                  </Button>
                </div>
              )}
              {hasTargets ? (
                <div className="border-t border-border px-4 py-3">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    onClick={onIdentify}
                    disabled={locked}
                  >
                    识别启动方式
                  </button>
                </div>
              ) : null}
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
                  一键提交
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={locked || !hasChanges}
                  onClick={onManualCommit}
                >
                  手动提交
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="text-destructive hover:bg-destructive/10"
                  disabled={locked || !hasChanges}
                  onClick={onDiscard}
                >
                  放弃所有更改
                </Button>
              </div>
            </div>

            <section className="space-y-1.5">
              <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground">
                当前改动
                {changeCount > 0 ? (
                  <span className="ml-1.5 font-normal tabular-nums">{changeCount}</span>
                ) : null}
              </h3>
              {changesLoading ? (
                <p className="py-3 text-xs text-muted-foreground">加载中…</p>
              ) : changedFiles.length === 0 ? (
                <p className="py-3 text-xs text-muted-foreground">没有变更</p>
              ) : (
                <ul className="max-h-64 overflow-y-auto">
                  {changedFiles.map((file) => {
                    const badge = workingTreeBadge(file);
                    return (
                      <li key={file.path}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 py-1.5 text-left text-xs hover:bg-accent/40"
                          onClick={onViewChanges}
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
              <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground">
                提交记录
              </h3>
              {project.commits.length === 0 ? (
                <p className="py-3 text-xs text-muted-foreground">暂无提交</p>
              ) : (
                <ul className="max-h-[min(45vh,480px)] overflow-y-auto">
                  {project.commits.map((c) => (
                    <li
                      key={c.hash}
                      className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-baseline gap-2 py-1.5 text-xs"
                    >
                      <span className="font-mono text-sky-400">{c.hash}</span>
                      <span className="truncate text-foreground/90" title={c.subject}>
                        {c.subject}
                      </span>
                      <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                        {relativeTime(c.timestamp)}
                      </span>
                    </li>
                  ))}
                </ul>
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
                    .then(() => onToast("已用系统应用打开 HTML"))
                    .catch((e) => onError(String(e)));
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
            {busy || docsBusy || (runBusy ? "正在启动…" : null)}
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
            {project.ahead > 0 ? <span>↑{project.ahead} ahead</span> : null}
            {project.behind > 0 ? <span>↓{project.behind} behind</span> : null}
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
            onError={onError}
            onToast={onToast}
          />
        </section>
      </div>

      {(busy || docsBusy || runBusy) && (
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          {busy || docsBusy || (runBusy ? "正在启动…" : null)}
        </div>
      )}
    </article>
  );
}
