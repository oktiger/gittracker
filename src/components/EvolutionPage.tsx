import type { DocsOverview } from "../types";
import "./EvolutionPage.css";

interface Props {
  overview: DocsOverview | null;
  busy: boolean;
  onInitialize: () => void;
  onOpenGoal: (relativePath: string, title: string) => void;
}

export function EvolutionPage({ overview, busy, onInitialize, onOpenGoal }: Props) {
  const needsInit = overview?.needsInit ?? true;
  return <section className="evolution-page" aria-label="项目进化">
    {!overview ? <div className="empty-state">加载进化信息…</div> : needsInit ? (
      <div className="evolution-empty">
        <span className="evolution-mark" aria-hidden="true">↗</span>
        <h3>从目标开始进化</h3>
        <p>初始化会在此项目的 <code>DOCS</code> 中创建 <code>Goal</code>、<code>Task</code> 文件夹，以及可编辑的 <code>Goal/goal.md</code> 目标文档。Task 文件夹会保持为空。</p>
        <button type="button" className="btn btn-primary" onClick={onInitialize} disabled={busy}>{busy ? "初始化中…" : "初始化"}</button>
      </div>
    ) : (
      <div className="evolution-ready">
        <div className="evolution-status"><span className="evolution-status-dot" />进化空间已就绪</div>
        <div className="evolution-cards">
          <article className="evolution-card">
            <span className="evolution-card-kicker">GOAL</span>
            <h3>项目目标</h3>
            <p>明确这个项目要解决的问题与成功标准，再由目标逐步拆解任务。</p>
            <button type="button" className="btn btn-secondary" onClick={() => onOpenGoal(overview.goalRelativePath ?? "Goal/goal.md", "项目目标")}>打开并编辑目标</button>
          </article>
          <article className="evolution-card">
            <span className="evolution-card-kicker">TASK</span>
            <h3>任务</h3>
            <p>{overview.tasks.length ? `已有 ${overview.tasks.length} 个任务，后续将在这里管理。` : "任务文件夹目前为空；后续添加任务后会显示在这里。"}</p>
            <span className="evolution-card-path">DOCS/Task</span>
          </article>
        </div>
      </div>
    )}
  </section>;
}
