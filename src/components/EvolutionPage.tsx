import { MoreHorizontal } from "lucide-react";
import type { DocsOverview, DocsTaskItem } from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface Props {
  overview: DocsOverview | null;
  busy: boolean;
  onInitialize: () => void;
  onGenerateTasks: () => void;
  onImplementTask: (task: DocsTaskItem) => void;
  onOpenGoal: (relativePath: string, title: string) => void;
  onOpenTask: (task: DocsTaskItem) => void;
}

export function EvolutionPage({
  overview,
  busy,
  onInitialize,
  onGenerateTasks,
  onImplementTask,
  onOpenGoal,
  onOpenTask,
}: Props) {
  const needsInit = overview?.needsInit ?? true;
  const tasks = overview?.tasks ?? [];
  const done = tasks.filter((t) => t.status === "done").length;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  if (!overview) {
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        加载进化信息…
      </div>
    );
  }

  if (needsInit) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-muted text-lg">
          ↗
        </div>
        <h3 className="text-sm font-medium">从目标开始进化</h3>
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
          初始化会在此项目的 <code className="rounded bg-muted px-1 font-mono">DOCS</code>{" "}
          中创建 Goal / Task 文件夹，以及可编辑的 goal.md。
        </p>
        <Button
          type="button"
          className="mt-4"
          onClick={onInitialize}
          disabled={busy}
        >
          {busy ? "初始化中…" : "初始化"}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">Goal</h3>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              disabled={busy}
              onClick={() =>
                onOpenGoal(overview.goalRelativePath ?? "Goal/goal.md", "goal.md")
              }
            >
              打开 goal.md
            </Button>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {overview.goalExists
              ? "已检测到目标文档。打开后可编辑项目目标，再生成可执行任务。"
              : "尚未写入目标内容，请先编辑 goal.md。"}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-medium">任务列表</h3>
            <Badge variant="secondary" className="text-[10px]">
              {tasks.length}
            </Badge>
          </div>
          {tasks.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              暂无任务 · 可在右侧生成
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {tasks.map((task) => (
                <li
                  key={task.relativePath}
                  className="flex items-center gap-2 px-4 py-2.5"
                >
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {String(task.number).padStart(3, "0")}
                  </span>
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
                    onClick={() => onOpenTask(task)}
                    title={task.relativePath}
                  >
                    {task.title}
                  </button>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      task.status === "done" &&
                        "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
                    )}
                  >
                    {task.status === "done" ? "已完成" : "待做"}
                  </Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon-xs" disabled={busy}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onOpenTask(task)}>打开</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onImplementTask(task)}>
                        实现
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">任务进度</h3>
        <div className="mb-2 flex justify-between text-xs text-muted-foreground">
          <span>已完成</span>
          <span>
            {done} / {tasks.length || 0}
          </span>
        </div>
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <Button
          type="button"
          className="w-full"
          size="sm"
          disabled={busy || !overview.goalExists}
          onClick={onGenerateTasks}
        >
          生成任务
        </Button>
      </div>
    </div>
  );
}
