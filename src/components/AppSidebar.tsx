import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck2,
  ChevronsLeft,
  LayoutGrid,
  ScrollText,
  Settings,
  Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectStatus } from "../types";

export type NavView = "board" | "dailyCompletion" | "logDiary" | "settings";

interface Props {
  width: number;
  view: NavView | "project";
  selectedProjectId: string | null;
  projects: ProjectStatus[];
  logCount: number;
  onNavigate: (view: NavView) => void;
  onSelectProject: (id: string) => void;
  onCollapse: () => void;
  onCloseWindow: () => void;
  onMinimizeWindow: () => void;
  onMaximizeWindow: () => void;
  onBack: () => void;
  onForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onStartDragging: (event: ReactMouseEvent<HTMLElement>) => void;
}

const NAV: { id: NavView; labelKey: "board" | "summary" | "logDiary" | "settings"; icon: typeof LayoutGrid }[] = [
  { id: "board", labelKey: "board", icon: LayoutGrid },
  { id: "dailyCompletion", labelKey: "summary", icon: CalendarCheck2 },
  { id: "logDiary", labelKey: "logDiary", icon: ScrollText },
  { id: "settings", labelKey: "settings", icon: Settings },
];

const APP_NAME = "GitTracker";

export function AppSidebar({
  width,
  view,
  selectedProjectId,
  projects,
  logCount,
  onNavigate,
  onSelectProject,
  onCollapse,
  onCloseWindow,
  onMinimizeWindow,
  onMaximizeWindow,
  onBack,
  onForward,
  canGoBack,
  canGoForward,
  onStartDragging,
}: Props) {
  const { t } = useTranslation(["navigation", "common"]);
  return (
    <aside className="flex shrink-0 flex-col bg-card/70" style={{ width }} aria-label={t("navigation:main")}>
      <div className="flex h-12 items-center px-3" data-tauri-drag-region onMouseDown={onStartDragging}>
        <div className="flex items-center gap-3" data-tauri-drag-region>
          <div className="flex items-center gap-1.5">
            <button type="button" className="h-3 w-3 rounded-full bg-[#ff5f57] transition hover:brightness-90" onClick={onCloseWindow} aria-label={t("common:window.close")} title={t("common:window.close")} />
            <button type="button" className="h-3 w-3 rounded-full bg-[#febc2e] transition hover:brightness-90" onClick={onMinimizeWindow} aria-label={t("common:window.minimize")} title={t("common:window.minimize")} />
            <button type="button" className="h-3 w-3 rounded-full bg-[#28c840] transition hover:brightness-90" onClick={onMaximizeWindow} aria-label={t("common:window.maximize")} title={t("common:window.maximize")} />
          </div>
          <div className="flex items-center gap-0.5">
            <Button type="button" variant="ghost" size="icon-sm" onClick={onCollapse} aria-label={t("navigation:collapse")} title={t("navigation:collapse")}>
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} disabled={!canGoBack} aria-label={t("common:window.back")} title={t("common:window.back")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={onForward} disabled={!canGoForward} aria-label={t("common:window.forward")} title={t("common:window.forward")}>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex h-12 items-center gap-2.5 px-4" data-tauri-drag-region onMouseDown={onStartDragging}>
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Target className="h-3.5 w-3.5" />
        </div>
        <div className="text-sm font-semibold tracking-tight">{APP_NAME}</div>
      </div>

      <nav className="space-y-1 p-3 pt-1" aria-label={t("navigation:views")}>
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
                {t(`navigation:${item.labelKey}`)}
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
          {t("navigation:projects")}
        </div>
        {projects.length === 0 ? (
          <p className="px-2.5 text-xs text-muted-foreground">{t("navigation:projectsEmpty")}</p>
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
    </aside>
  );
}
