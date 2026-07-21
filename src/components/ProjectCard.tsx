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
import { DocumentLibraryTab } from "./DocumentLibraryTab";
import { EvolutionPage } from "./EvolutionPage";
import { HelpTip } from "./HelpTip";

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

  const codeModule = (board: boolean) => (
    <section className="overflow-hidden rounded-md border border-border bg-background/40">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-muted font-mono text-[10px] font-semibold text-muted-foreground">
            {"</>"}
          </span>
          <span className="text-sm font-semibold">代码</span>
        </div>
        <span className="text-[11px] text-muted-foreground">最近 3 次提交</span>
      </header>
      {project.commits.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">暂无提交</p>
      ) : (
        <ul className="divide-y divide-border px-3">
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
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card px-3 py-2.5">
        <span className="text-[11px] text-muted-foreground">
          {changeCount} Changes
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {board ? (
            <>
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
            </>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                disabled={locked || !hasChanges}
                onClick={onOneClick}
              >
                一键提交
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={locked || !hasChanges}
                onClick={onManualCommit}
              >
                手动提交
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive hover:bg-destructive/10"
                disabled={locked || !hasChanges}
                onClick={onDiscard}
              >
                Discard
              </Button>
            </>
          )}
        </div>
      </footer>
    </section>
  );

  if (hideTitle) {
    return (
      <div className="space-y-4">
        <Tabs value={detailTab} onValueChange={setDetailTab}>
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

          <TabsContent value="code" className="mt-4 space-y-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
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
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="ml-auto text-muted-foreground"
                  disabled={locked}
                  onClick={onRemove}
                >
                  从看板移除
                </Button>
              </div>
              <div className="mb-4 grid max-w-md grid-cols-2 gap-3">
                <div className="rounded-md border border-border p-4 text-center">
                  <div className="text-3xl font-semibold tabular-nums">{changeCount}</div>
                  <div className="text-xs text-muted-foreground">
                    Changes <HelpTip text="当前 Worktree 中全部尚未提交的文件改动。" />
                  </div>
                </div>
                <button
                  type="button"
                  disabled={changeCount === 0 || locked}
                  onClick={onViewChanges}
                  className="rounded-md border border-border p-4 text-center hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                >
                  <div className="text-3xl font-semibold tabular-nums">{changeCount}</div>
                  <div className="text-xs text-muted-foreground">Changes · 点击查看</div>
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={locked || !hasChanges} onClick={onOneClick}>
                  一键提交
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={locked || !hasChanges}
                  onClick={onManualCommit}
                >
                  手动提交
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="text-destructive hover:bg-destructive/10"
                  disabled={locked || !hasChanges}
                  onClick={onDiscard}
                >
                  Discard
                </Button>
              </div>
            </div>
            {codeModule(false)}
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
    <article className="rounded-lg border border-border bg-card shadow-sm">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold tracking-tight">
            <button
              type="button"
              className="text-left hover:underline"
              onClick={onOpenProject}
              title={project.path}
            >
              {project.name}
            </button>
          </h2>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={project.path}>
            {project.path}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono">
              {project.branch || "—"}
            </code>
            {project.ahead > 0 ? <span>↑{project.ahead} ahead</span> : null}
            {project.behind > 0 ? <span>↓{project.behind} behind</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {statusBadge}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" disabled={locked}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onRemove}>从看板移除</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {project.error ? (
        <p className="border-b border-border px-4 py-2 text-xs text-destructive">{project.error}</p>
      ) : null}

      <div className="space-y-3 p-3">
        {codeModule(true)}
        <section className="overflow-hidden rounded-md border border-border bg-background/40">
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
