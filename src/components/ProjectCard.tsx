import { HelpTip } from "./HelpTip";
import type { ProjectStatus } from "../types";
import "./ProjectCard.css";

interface Props {
  project: ProjectStatus;
  busy?: string;
  onManualCommit: () => void;
  onOneClick: () => void;
  onDiscard: () => void;
  onViewChanges: () => void;
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
  onViewChanges,
  onRemove,
}: Props) {
  const disabled = Boolean(busy);
  const hasChanges = !project.clean;
  const workingChanges = project.unstaged + project.untracked;

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

      <div className="counts counts-2">
        <div className="count">
          <span className="count-num">{project.staged}</span>
          <span className="count-label">
            Staged <HelpTip text="已暂存、等待提交的文件数" />
          </span>
        </div>
        <button
          type="button"
          className={`count count-btn${workingChanges > 0 ? " is-clickable" : ""}`}
          disabled={workingChanges === 0 || disabled}
          onClick={onViewChanges}
          title={
            workingChanges > 0
              ? "查看 Unstaged / Untracked 文件列表"
              : "没有未暂存改动"
          }
        >
          <span className="count-num">{workingChanges}</span>
          <span className="count-label">
            Changes{" "}
            <span
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <HelpTip text="合并 Unstaged（已跟踪但未暂存的改动）与 Untracked（新文件）。点击查看文件名及 M/U/D 等状态标识。" />
            </span>
          </span>
        </button>
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
