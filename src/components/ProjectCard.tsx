import { HelpTip } from "./HelpTip";
import type { ProjectStatus } from "../types";
import "./ProjectCard.css";

interface Props {
  project: ProjectStatus;
  busy?: string;
  onManualCommit: () => void;
  onOneClick: () => void;
  onDiscard: () => void;
  onRemove: () => void;
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
  onManualCommit,
  onOneClick,
  onDiscard,
  onRemove,
}: Props) {
  const disabled = Boolean(busy);
  const hasChanges = !project.clean;

  return (
    <article className={`project-card ${project.clean ? "is-clean" : "is-dirty"}`}>
      <header className="card-header">
        <div className="card-title-row">
          <h2 className="card-title" title={project.path}>
            {project.name}
          </h2>
          <button
            type="button"
            className="btn-ghost btn-icon"
            onClick={onRemove}
            title="从看板移除"
            disabled={disabled}
          >
            ×
          </button>
        </div>
        <div className="card-meta">
          <span className="branch" title="当前分支">
            {project.branch || "—"}
          </span>
          <span className={`badge ${project.clean ? "badge-clean" : "badge-dirty"}`}>
            {project.clean ? "Clean" : "Changed"}
          </span>
          {(project.ahead > 0 || project.behind > 0) && (
            <span className="ahead-behind">
              {project.ahead > 0 && <span>↑{project.ahead}</span>}
              {project.behind > 0 && <span>↓{project.behind}</span>}
              <HelpTip text="相对远程分支：Ahead（本地超前）/ Behind（本地落后）" />
            </span>
          )}
        </div>
      </header>

      {project.error && <p className="card-error">{project.error}</p>}

      <div className="counts">
        <div className="count">
          <span className="count-num">{project.staged}</span>
          <span className="count-label">
            Staged <HelpTip text="已暂存、等待提交的文件数" />
          </span>
        </div>
        <div className="count">
          <span className="count-num">{project.unstaged}</span>
          <span className="count-label">
            Unstaged <HelpTip text="已修改但尚未暂存的文件数" />
          </span>
        </div>
        <div className="count">
          <span className="count-num">{project.untracked}</span>
          <span className="count-label">
            Untracked{" "}
            <HelpTip text="全新文件：从未被 Git 跟踪过（例如新建的源码/文档）。与 Unstaged 不同：Unstaged 是「已跟踪文件被改了但还没暂存」。提交时会一并自动暂存。" />
          </span>
        </div>
      </div>

      <section className="commits">
        <div className="commits-label">
          最近提交 <HelpTip text="仅显示最近 3 条，不读取完整历史" />
        </div>
        {project.commits.length === 0 ? (
          <p className="commits-empty">暂无提交</p>
        ) : (
          <ul>
            {project.commits.map((c) => (
              <li key={c.hash}>
                <code className="hash">{c.hash}</code>
                <span className="when">{relativeTime(c.timestamp)}</span>
                <span className="subject" title={c.subject}>
                  {c.subject}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="card-actions">
        {busy && <span className="busy-label">{busy}</span>}
        <button
          type="button"
          className="btn btn-secondary"
          disabled={disabled || !hasChanges}
          onClick={onManualCommit}
        >
          手动提交
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled || !hasChanges}
          onClick={onOneClick}
        >
          一键提交
        </button>
        <HelpTip text="点击后自动暂存全部改动（含 Unstaged / Untracked），再 AI 生成 message → Commit → Push；任一步失败即停止" />
        <button
          type="button"
          className="btn btn-danger"
          disabled={disabled || !hasChanges}
          onClick={onDiscard}
        >
          Discard
        </button>
      </footer>
    </article>
  );
}
