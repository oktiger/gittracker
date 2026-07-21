import {
  CalendarCheck2,
  LayoutGrid,
  ScrollText,
  Settings,
  Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProjectStatus } from "../types";

export type NavView = "board" | "dailyCompletion" | "logDiary" | "settings";

interface Props {
  view: NavView | "project";
  selectedProjectId: string | null;
  projects: ProjectStatus[];
  logCount: number;
  upgrading?: boolean;
  onNavigate: (view: NavView) => void;
  onSelectProject: (id: string) => void;
  onUpgrade: () => void;
}

const NAV: { id: NavView; label: string; icon: typeof LayoutGrid }[] = [
  { id: "board", label: "看板", icon: LayoutGrid },
  { id: "dailyCompletion", label: "总结", icon: CalendarCheck2 },
  { id: "logDiary", label: "日志", icon: ScrollText },
  { id: "settings", label: "设置", icon: Settings },
];

export function AppSidebar({
  view,
  selectedProjectId,
  projects,
  logCount,
  upgrading = false,
  onNavigate,
  onSelectProject,
  onUpgrade,
}: Props) {
  return (
    <aside className="flex w-[240px] shrink-0 flex-col border-r border-border bg-card" aria-label="主导航">
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Target className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">GitTracker</div>
            <div className="text-xs text-muted-foreground">多项目 Git 看板</div>
          </div>
        </div>
      </div>

      <nav className="space-y-1 p-3" aria-label="主视图">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                active && "bg-accent text-accent-foreground",
                item.id === "logDiary" && "justify-between",
              )}
            >
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {item.label}
              </span>
              {item.id === "logDiary" && logCount > 0 ? (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  {logCount}
                </Badge>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <div className="mb-2 px-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          项目
        </div>
        {projects.length === 0 ? (
          <p className="px-2.5 text-xs text-muted-foreground">在看板中添加项目后会出现在这里</p>
        ) : (
          <div className="space-y-0.5">
            {projects.map((p) => {
              const active = view === "project" && selectedProjectId === p.id;
              const dirty = !p.clean;
              return (
                <button
                  key={p.id}
                  type="button"
                  title={p.path}
                  onClick={() => onSelectProject(p.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-accent",
                    active && "bg-accent text-accent-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      dirty ? "bg-amber-500" : "bg-emerald-500",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-left">{p.name}</span>
                  {dirty ? (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                      {p.staged + p.unstaged + p.untracked}
                    </Badge>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-border p-3">
        <Button
          type="button"
          variant="outline"
          className="h-auto w-full flex-col items-start gap-0.5 px-3 py-2.5"
          disabled={upgrading}
          onClick={onUpgrade}
        >
          <span className="text-sm font-medium">{upgrading ? "升级中…" : "升级"}</span>
          <span className="text-xs font-normal text-muted-foreground">打包并替换本应用</span>
        </Button>
      </div>
    </aside>
  );
}
