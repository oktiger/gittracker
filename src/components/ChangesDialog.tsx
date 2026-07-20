import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  isWorkingTreeChange,
  workingTreeBadge,
} from "../lib/gitStatusBadge";
import type { FileChange } from "../types";
import { HelpTip } from "./HelpTip";
import "./Dialog.css";

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

export function ChangesDialog({ projectId, projectName, onClose }: Props) {
  const [files, setFiles] = useState<FileChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const all = await api.listChangedFiles(projectId);
        setFiles(all.filter(isWorkingTreeChange));
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  const sorted = useMemo(() => {
    return [...files].sort((a, b) => {
      // Untracked 靠后一点，先看改动的已跟踪文件
      if (a.untracked !== b.untracked) return a.untracked ? 1 : -1;
      return a.path.localeCompare(b.path);
    });
  }, [files]);

  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="changes-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dialog-header">
          <h3 id="changes-title">Changes · {projectName}</h3>
          <button type="button" className="btn-ghost btn-icon" onClick={onClose}>
            ×
          </button>
        </header>

        <p className="dialog-hint">
          未暂存改动（Unstaged）与未跟踪新文件（Untracked）。{" "}
          <HelpTip text="文件名右侧字母沿用 VS Code / GitHub Desktop：U Untracked、M Modified、D Deleted、A Added、R Renamed。" />
        </p>

        <div className="git-badge-legend" aria-hidden="true">
          <span className="git-badge git-badge-untracked">U</span>
          <span>Untracked</span>
          <span className="git-badge git-badge-modified">M</span>
          <span>Modified</span>
          <span className="git-badge git-badge-deleted">D</span>
          <span>Deleted</span>
        </div>

        {loading ? (
          <p className="dialog-hint">加载变更文件…</p>
        ) : error ? (
          <p className="dialog-error">{error}</p>
        ) : (
          <ul className="file-list changes-file-list">
            {sorted.map((f) => {
              const badge = workingTreeBadge(f);
              return (
                <li key={f.path}>
                  <div className="changes-file-row">
                    <span className="file-path" title={f.path}>
                      {f.path}
                    </span>
                    <span
                      className={`git-badge git-badge-${badge.kind}`}
                      title={badge.label}
                    >
                      {badge.letter}
                    </span>
                  </div>
                </li>
              );
            })}
            {sorted.length === 0 && (
              <li className="empty">当前没有 Unstaged / Untracked 文件</li>
            )}
          </ul>
        )}

        <footer className="dialog-footer">
          <span className="dialog-hint" style={{ margin: 0 }}>
            共 {sorted.length} 个文件
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}
