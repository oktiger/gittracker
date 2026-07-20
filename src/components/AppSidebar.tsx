import type { ProjectStatus } from "../types";
import "./AppSidebar.css";

export type NavView = "board" | "dailyCompletion" | "logDiary" | "settings";

interface Props {
  view: NavView | "project";
  selectedProjectId: string | null;
  projects: ProjectStatus[];
  logCount: number;
  onNavigate: (view: NavView) => void;
  onSelectProject: (id: string) => void;
}

export function AppSidebar({
  view,
  selectedProjectId,
  projects,
  logCount,
  onNavigate,
  onSelectProject,
}: Props) {
  return (
    <aside className="app-sidebar" aria-label="主导航">
      <div className="sidebar-brand">
        <h1>GitTracker</h1>
        <p>多项目 Git 看板</p>
      </div>

      <nav className="sidebar-nav" aria-label="主视图">
        <button
          type="button"
          className={`sidebar-nav-item${view === "dailyCompletion" ? " is-active" : ""}`}
          onClick={() => onNavigate("dailyCompletion")}
        >
          <span className="sidebar-nav-label">每日完成</span>
        </button>
        <button
          type="button"
          className={`sidebar-nav-item${view === "board" ? " is-active" : ""}`}
          onClick={() => onNavigate("board")}
        >
          <span className="sidebar-nav-label">看板</span>
        </button>
        <button
          type="button"
          className={`sidebar-nav-item${view === "logDiary" ? " is-active" : ""}`}
          onClick={() => onNavigate("logDiary")}
        >
          <span className="sidebar-nav-label">日志</span>
          {logCount > 0 ? <span className="sidebar-nav-count">{logCount}</span> : null}
        </button>
        <button
          type="button"
          className={`sidebar-nav-item${view === "settings" ? " is-active" : ""}`}
          onClick={() => onNavigate("settings")}
        >
          <span className="sidebar-nav-label">设置</span>
        </button>
      </nav>

      <div className="sidebar-projects">
        <div className="sidebar-section-label">项目</div>
        {projects.length === 0 ? (
          <p className="sidebar-projects-empty">在看板中添加项目后会出现在这里</p>
        ) : (
          <ul className="sidebar-project-list">
            {projects.map((p) => {
              const active = view === "project" && selectedProjectId === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`sidebar-project-item${active ? " is-active" : ""}${
                      p.clean ? " is-clean" : " is-dirty"
                    }`}
                    onClick={() => onSelectProject(p.id)}
                    title={p.path}
                  >
                    <span className="sidebar-project-dot" aria-hidden="true" />
                    <span className="sidebar-project-name">{p.name}</span>
                    {!p.clean ? (
                      <span className="sidebar-project-badge">
                        {p.staged + p.unstaged + p.untracked}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
