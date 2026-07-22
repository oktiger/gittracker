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
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation(["projects", "common"]);
  const needsInit = overview?.needsInit ?? true;
  const tasks = overview?.tasks ?? [];
  const done = tasks.filter((t) => t.status === "done").length;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  if (!overview) {
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        {t("projects:docs.loadingEvolution")}
      </div>
    );
  }

  if (needsInit) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-muted text-lg">
          ↗
        </div>
        <h3 className="text-sm font-medium">{t("projects:docs.startTitle")}</h3>
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
          {t("projects:docs.startDescription")}
        </p>
        <Button
          type="button"
          className="mt-4"
          onClick={onInitialize}
          disabled={busy}
        >
          {busy ? t("projects:docs.initializing") : t("projects:docs.initialize")}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">{t("projects:docs.goalTitle")}</h3>
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
              {t("projects:docs.openGoal")}
            </Button>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {overview.goalExists
              ? t("projects:docs.goalReady")
              : t("projects:docs.goalEmpty")}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-medium">{t("projects:docs.taskList")}</h3>
            <Badge variant="secondary" className="text-[10px]">
              {tasks.length}
            </Badge>
          </div>
          {tasks.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              {t("projects:docs.noTasks")}
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
                    {task.status === "done" ? t("projects:docs.done") : t("projects:docs.todo")}
                  </Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon-xs" disabled={busy}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onOpenTask(task)}>{t("common:actions.open")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onImplementTask(task)}>
                        {t("projects:docs.implement")}
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
        <h3 className="mb-3 text-sm font-medium">{t("projects:docs.progress")}</h3>
        <div className="mb-2 flex justify-between text-xs text-muted-foreground">
          <span>{t("projects:docs.done")}</span>
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
          {t("projects:docs.generate")}
        </Button>
      </div>
    </div>
  );
}
