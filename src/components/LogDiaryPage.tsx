import { useState } from "react";
import type { LogDiaryEntry } from "../types";
import {
  formatLogForCopy,
  formatLogTime,
  kindLabel,
  statusLabel,
} from "../lib/logDiaryFormat";
import "./LogDiaryPage.css";

interface Props {
  entries: LogDiaryEntry[];
  loading: boolean;
  onClear: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
}

export function LogDiaryPage({
  entries,
  loading,
  onClear,
  onRefresh,
  onToast,
}: Props) {
  const [clearing, setClearing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyEntry = async (entry: LogDiaryEntry) => {
    const text = formatLogForCopy(entry);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(entry.id);
      onToast("已复制，可粘贴给 AI");
      setTimeout(() => setCopiedId((id) => (id === entry.id ? null : id)), 1600);
    } catch {
      onToast("复制失败，请手动选择文本");
    }
  };

  const handleClear = async () => {
    if (!entries.length) return;
    if (!window.confirm(`清空全部 ${entries.length} 条日志日记？`)) return;
    setClearing(true);
    try {
      await onClear();
      onToast("已清空日志日记");
    } catch (e) {
      onToast(String(e));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="log-diary">
      <div className="log-diary-toolbar">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void onRefresh()}
          disabled={loading || clearing}
        >
          刷新
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void handleClear()}
          disabled={loading || clearing || entries.length === 0}
        >
          {clearing ? "清空中…" : "清空"}
        </button>
      </div>

      {loading ? (
        <div className="log-diary-empty">加载中…</div>
      ) : entries.length === 0 ? (
        <div className="log-diary-empty">
          <h3>还没有日志</h3>
          <p>在看板里执行一键提交、生成任务、实现、识别启动方式等操作后，会自动出现在这里。</p>
        </div>
      ) : (
        <div className="log-diary-list">
          {entries.map((entry) => (
            <article
              key={entry.id}
              className={`log-block status-${entry.status}`}
              aria-label={entry.title}
            >
              <header className="log-block-head">
                <div className="log-block-meta">
                  <span className={`log-status status-${entry.status}`}>
                    {statusLabel(entry.status)}
                  </span>
                  <span className="log-kind">{kindLabel(entry.kind)}</span>
                  <time className="log-time" dateTime={new Date(entry.createdAt).toISOString()}>
                    {formatLogTime(entry.createdAt)}
                  </time>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm log-copy-btn"
                  onClick={() => void copyEntry(entry)}
                  title="复制本条日志与问题，便于反馈给 AI"
                >
                  {copiedId === entry.id ? "已复制" : "复制"}
                </button>
              </header>

              <h3 className="log-block-title">{entry.title}</h3>
              {(entry.projectName || entry.projectId) && (
                <p className="log-project">
                  项目 · {entry.projectName ?? entry.projectId}
                </p>
              )}

              {entry.detail?.trim() ? (
                <pre className="log-detail">{entry.detail.trim()}</pre>
              ) : null}

              {entry.error?.trim() ? (
                <div className="log-error-box">
                  <div className="log-error-label">问题 / 错误反馈</div>
                  <pre className="log-error">{entry.error.trim()}</pre>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
