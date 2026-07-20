import { useEffect, useState } from "react";
import { api } from "../api";
import type { NewLogDiaryEntry } from "../types";
import { HelpTip } from "./HelpTip";
import "./Dialog.css";

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onDone: () => void;
  onLog: (entry: NewLogDiaryEntry) => void;
  /** 打开右侧 AI 侧栏生成 message，成功后 resolve 文案 */
  onAiGenerate: () => Promise<string>;
}

export function CommitDialog({
  projectId,
  projectName,
  onClose,
  onDone,
  onLog,
  onAiGenerate,
}: Props) {
  const [message, setMessage] = useState("");
  const [alsoPush, setAlsoPush] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stagedHint, setStagedHint] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        // 打开对话框即自动暂存全部改动（Unstaged + Untracked）
        await api.stageAllChanges(projectId);
        const diff = await api.getStagedDiff(projectId);
        setStagedHint(
          diff.trim()
            ? `已自动暂存全部改动，diff 约 ${diff.length} 字符`
            : "当前没有可提交的更改",
        );
      } catch {
        setStagedHint("");
      }
    })();
  }, [projectId]);

  const onGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const msg = await onAiGenerate();
      setMessage(msg);
    } catch (e) {
      const err = String(e);
      if (!err.includes("已取消")) {
        setError(err);
      }
    } finally {
      setGenerating(false);
    }
  };

  const onSubmit = async () => {
    if (!message.trim()) {
      setError("请填写 Commit message");
      return;
    }
    setSubmitting(true);
    setError(null);
    const trimmed = message.trim();
    try {
      if (alsoPush) {
        await api.commitAndPush(projectId, trimmed);
      } else {
        await api.commitProject(projectId, trimmed);
      }
      onLog({
        kind: "commit",
        status: "ok",
        title: `${alsoPush ? "Commit & Push" : "Commit"} · ${projectName}`,
        projectId,
        projectName,
        detail: `Message:\n${trimmed}`,
      });
      onDone();
      onClose();
    } catch (e) {
      const err = String(e);
      onLog({
        kind: "commit",
        status: "error",
        title: `${alsoPush ? "Commit & Push" : "Commit"} 失败 · ${projectName}`,
        projectId,
        projectName,
        detail: `Message:\n${trimmed}`,
        error: err,
      });
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="commit-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dialog-header">
          <h3 id="commit-title">手动提交 · {projectName}</h3>
          <button type="button" className="btn-ghost btn-icon" onClick={onClose}>
            ×
          </button>
        </header>

        <p className="dialog-hint">
          {stagedHint}{" "}
          <HelpTip text="打开本对话框或点 AI Generate / Commit 时，会自动 git add -A（含 Unstaged 与 Untracked）。AI 根据暂存区 Diff 生成文案；具体走 Codex 还是 Cursor Agent，在设置中选择。" />
        </p>

        <label className="field">
          <span className="field-label">
            Commit message
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void onGenerate()}
              disabled={generating || submitting}
            >
              {generating ? "生成中…" : "AI Generate"}
            </button>
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder="简洁说明本次修改…"
            disabled={submitting}
            autoFocus
          />
        </label>

        <label className="check-row">
          <input
            type="checkbox"
            checked={alsoPush}
            onChange={(e) => setAlsoPush(e.target.checked)}
            disabled={submitting}
          />
          <span>
            提交后 Push{" "}
            <HelpTip text="使用系统 Git 凭证推送到当前跟踪的远程分支" />
          </span>
        </label>

        {error && <p className="dialog-error">{error}</p>}

        <footer className="dialog-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onSubmit()}
            disabled={submitting || generating}
          >
            {submitting ? "提交中…" : alsoPush ? "Commit & Push" : "Commit"}
          </button>
        </footer>
      </div>
    </div>
  );
}
