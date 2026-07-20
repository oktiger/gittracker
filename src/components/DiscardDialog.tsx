import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { HelpTip } from "./HelpTip";
import type { FileChange } from "../types";
import "./Dialog.css";

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onDone: () => void;
}

export function DiscardDialog({ projectId, projectName, onClose, onDone }: Props) {
  const [files, setFiles] = useState<FileChange[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryDir, setRecoveryDir] = useState("");
  const [resultNote, setResultNote] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const preview = await api.previewDiscard(projectId);
        setFiles(preview.files);
        setRecoveryDir(preview.recoveryDir);
        const initial = new Set(
          preview.files.filter((f) => !f.untracked).map((f) => f.path),
        );
        setSelected(initial);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  const visibleFiles = useMemo(() => {
    if (includeUntracked) return files;
    return files.filter((f) => !f.untracked);
  }, [files, includeUntracked]);

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === visibleFiles.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleFiles.map((f) => f.path)));
    }
  };

  const onConfirm = async () => {
    if (confirmText !== "DISCARD") {
      setError('请输入 DISCARD 以确认危险操作');
      return;
    }
    const paths = [...selected];
    if (paths.length === 0) {
      setError("请至少选择一个文件");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.discardChanges(projectId, paths, includeUntracked);
      if (result.recoveryPatch) {
        setResultNote(`已创建恢复补丁：${result.recoveryPatch}`);
      } else {
        setResultNote("未生成恢复补丁（可能无可用 diff），更改仍已丢弃");
      }
      setTimeout(() => {
        onDone();
        onClose();
      }, 900);
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discard-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dialog-header">
          <h3 id="discard-title">Discard · {projectName}</h3>
          <button type="button" className="btn-ghost btn-icon" onClick={onClose}>
            ×
          </button>
        </header>

        <p className="dialog-warn">
          此操作会丢弃选中文件的本地修改，且默认不可撤销。
          <HelpTip text="执行前会尽量写入 Recovery Patch，便于手动恢复" />
        </p>

        {recoveryDir && (
          <p className="dialog-hint">恢复补丁目录：{recoveryDir}</p>
        )}

        <label className="check-row">
          <input
            type="checkbox"
            checked={includeUntracked}
            onChange={(e) => setIncludeUntracked(e.target.checked)}
            disabled={submitting}
          />
          <span>
            同时删除 Untracked 文件{" "}
            <HelpTip text="默认关闭：未跟踪文件不会被删除" />
          </span>
        </label>

        <div className="file-list-header">
          <button type="button" className="btn-link" onClick={toggleAll}>
            {selected.size === visibleFiles.length ? "取消全选" : "全选"}
          </button>
          <span>
            已选 {selected.size} / {visibleFiles.length}
          </span>
        </div>

        {loading ? (
          <p className="dialog-hint">加载变更文件…</p>
        ) : (
          <ul className="file-list">
            {visibleFiles.map((f) => (
              <li key={f.path}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(f.path)}
                    onChange={() => toggle(f.path)}
                    disabled={submitting}
                  />
                  <code className="file-status">{f.status}</code>
                  <span className="file-path">{f.path}</span>
                  {f.untracked && <span className="tag">untracked</span>}
                </label>
              </li>
            ))}
            {visibleFiles.length === 0 && (
              <li className="empty">没有可丢弃的文件</li>
            )}
          </ul>
        )}

        <label className="field">
          <span className="field-label">输入 DISCARD 确认</span>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DISCARD"
            disabled={submitting}
            autoComplete="off"
          />
        </label>

        {error && <p className="dialog-error">{error}</p>}
        {resultNote && <p className="dialog-ok">{resultNote}</p>}

        <footer className="dialog-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void onConfirm()}
            disabled={submitting || loading}
          >
            {submitting ? "处理中…" : "确认 Discard"}
          </button>
        </footer>
      </div>
    </div>
  );
}
