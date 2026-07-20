import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import type {
  AiProgressEvent,
  AiTranscriptLine,
  NewLogDiaryEntry,
  RunTarget,
} from "../types";
import "./AiSidePanel.css";

type Draft = RunTarget & { checked: boolean };

interface Props {
  projectId: string;
  projectName: string;
  mode: "identify" | "config";
  initialTargets?: RunTarget[];
  onClose: () => void;
  onSaved: (targets: RunTarget[]) => void;
  onLog: (entry: NewLogDiaryEntry) => void;
}

function toDraft(targets: RunTarget[], allChecked = true): Draft[] {
  return targets.map((t, i) => ({
    ...t,
    id: t.id || `draft-${i}`,
    cwd: t.cwd || ".",
    checked: allChecked,
    isDefault: Boolean(t.isDefault) || i === 0,
  }));
}

function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ai-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "status":
      return "状态";
    case "thinking":
      return "思考";
    case "assistant":
      return "AI";
    case "log":
      return "日志";
    case "error":
      return "错误";
    default:
      return kind;
  }
}

/** 等浏览器先画完侧栏，再开始阻塞式 AI 调用，避免整窗卡死感。 */
function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

export function AiSidePanel({
  projectId,
  projectName,
  mode,
  initialTargets = [],
  onClose,
  onSaved,
  onLog,
}: Props) {
  const [phase, setPhase] = useState<"loading" | "edit">(
    mode === "identify" ? "loading" : "edit",
  );
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    mode === "config"
      ? toDraft(
          initialTargets.length
            ? initialTargets
            : [
                {
                  id: "",
                  name: "开发",
                  cwd: ".",
                  command: "npm run dev",
                  isDefault: true,
                },
              ],
        )
      : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [transcript, setTranscript] = useState<AiTranscriptLine[]>(() =>
    mode === "identify"
      ? [
          {
            id: "boot",
            kind: "status",
            text: `开始识别「${projectName}」的启动方式…`,
          },
        ]
      : [],
  );
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const lineIdRef = useRef(0);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript, phase]);

  useEffect(() => {
    if (mode !== "identify") return;
    let cancelled = false;
    const sessionId = newSessionId();
    const unlistenPromise = listen<AiProgressEvent>("ai-progress", (event) => {
      const payload = event.payload;
      if (!payload || payload.sessionId !== sessionId) return;
      const text = (payload.text || "").trimEnd();
      if (!text) return;
      lineIdRef.current += 1;
      const id = `line-${lineIdRef.current}`;
      setTranscript((prev) => {
        const last = prev[prev.length - 1];
        if (
          last &&
          last.kind === payload.kind &&
          (payload.kind === "thinking" || payload.kind === "assistant")
        ) {
          const next = [...prev];
          next[next.length - 1] = { ...last, text: last.text + text };
          return next;
        }
        return [...prev, { id, kind: payload.kind, text }];
      });
    });

    void (async () => {
      setPhase("loading");
      setError(null);
      const unlisten = await unlistenPromise;
      if (cancelled) {
        unlisten();
        return;
      }
      await waitForPaint();
      if (cancelled) return;
      try {
        const result = await api.suggestRunTargets(projectId, sessionId);
        if (cancelled) return;
        setDrafts(toDraft(result.targets));
        if (result.warning) setError(result.warning);
        const preview = result.targets
          .map((t) => {
            const desc = t.description?.trim();
            return desc
              ? `- ${t.name}：${desc}（${t.cwd} · ${t.command}）`
              : `- ${t.name}: ${t.cwd} · ${t.command}`;
          })
          .join("\n");
        onLog({
          kind: "suggestRunTargets",
          status: "ok",
          title: `识别启动方式 · ${projectName}`,
          projectId,
          projectName,
          detail: `来源: ${result.source}\n建议 ${result.targets.length} 条:\n${preview || "（空）"}`,
          error: result.warning ?? undefined,
        });
        setPhase("edit");
      } catch (e) {
        if (cancelled) return;
        const err = String(e);
        onLog({
          kind: "suggestRunTargets",
          status: "error",
          title: `识别启动方式失败 · ${projectName}`,
          projectId,
          projectName,
          detail: "经统一 AI 通道分析仓库并建议 Run Targets。",
          error: err,
        });
        setError(err);
        setDrafts(
          toDraft([
            {
              id: "",
              name: "开发",
              cwd: ".",
              command: "npm run dev",
              isDefault: true,
            },
          ]),
        );
        setPhase("edit");
      }
    })();

    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [mode, projectId, projectName, onLog]);

  const updateDraft = (idx: number, patch: Partial<Draft>) => {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const setDefault = (idx: number) => {
    setDrafts((prev) =>
      prev.map((d, i) => ({
        ...d,
        isDefault: i === idx,
        checked: i === idx ? true : d.checked,
      })),
    );
  };

  const addRow = () => {
    setDrafts((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        name: "自定义",
        cwd: ".",
        command: "npm run dev",
        isDefault: prev.length === 0,
        checked: true,
      },
    ]);
  };

  const onSave = async () => {
    const kept = drafts.filter((d) => d.checked);
    if (kept.length === 0) {
      setError("请至少勾选一条启动目标");
      return;
    }
    for (const d of kept) {
      if (!d.name.trim() || !d.command.trim()) {
        setError("名称和命令不能为空");
        return;
      }
    }
    let payload = kept.map((d) => ({
      id: d.id.startsWith("draft-") || d.id.startsWith("new-") ? "" : d.id,
      name: d.name.trim(),
      description: d.description?.trim() || null,
      cwd: (d.cwd || ".").trim() || ".",
      command: d.command.trim(),
      kind: d.kind ?? null,
      isDefault: Boolean(d.isDefault),
    }));
    if (!payload.some((t) => t.isDefault)) {
      payload = payload.map((t, i) => ({ ...t, isDefault: i === 0 }));
    }

    setSaving(true);
    setError(null);
    try {
      const saved = await api.setRunTargets(projectId, payload);
      onLog({
        kind: "saveRunTargets",
        status: "ok",
        title: `保存启动目标 · ${projectName}`,
        projectId,
        projectName,
        detail: saved
          .map((t) => `- ${t.name}${t.isDefault ? " ★" : ""}: ${t.cwd} · ${t.command}`)
          .join("\n"),
      });
      onSaved(saved);
      onClose();
    } catch (e) {
      const err = String(e);
      onLog({
        kind: "saveRunTargets",
        status: "error",
        title: `保存启动目标失败 · ${projectName}`,
        projectId,
        projectName,
        error: err,
      });
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const title =
    phase === "loading"
      ? "AI 识别中"
      : mode === "config"
        ? "配置启动方式"
        : "确认启动目标";

  return (
    <aside className="ai-side-panel" aria-label={title}>
      <header className="ai-side-header">
        <div className="ai-side-heading">
          <h3>{title}</h3>
          <p className="ai-side-sub">
            {projectName}
            {phase === "loading" ? " · 只读分析，不会执行命令" : ""}
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost btn-icon"
          onClick={onClose}
          disabled={saving}
          aria-label="关闭侧边栏"
        >
          ×
        </button>
      </header>

      {phase === "loading" ? (
        <div className="ai-side-body">
          <div className="ai-transcript" aria-live="polite" aria-relevant="additions">
            {transcript.map((line) => (
              <div key={line.id} className={`ai-line ai-line-${line.kind}`}>
                <span className="ai-line-kind">{kindLabel(line.kind)}</span>
                <pre className="ai-line-text">{line.text}</pre>
              </div>
            ))}
            <div className="ai-line ai-line-status ai-line-pending">
              <span className="run-spinner" aria-hidden />
              <span className="ai-line-text">进行中…</span>
            </div>
            <div ref={transcriptEndRef} />
          </div>
          <footer className="ai-side-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              取消
            </button>
          </footer>
        </div>
      ) : (
        <div className="ai-side-body">
          {transcript.length > 0 && (
            <details className="ai-side-history">
              <summary>查看 AI 过程（{transcript.length} 条）</summary>
              <div className="ai-transcript ai-transcript-compact">
                {transcript.map((line) => (
                  <div key={line.id} className={`ai-line ai-line-${line.kind}`}>
                    <span className="ai-line-kind">{kindLabel(line.kind)}</span>
                    <pre className="ai-line-text">{line.text}</pre>
                  </div>
                ))}
              </div>
            </details>
          )}

          <p className="ai-side-hint">
            {mode === "config"
              ? "编辑启动目标。保存后可从运行菜单选择。"
              : "请勾选需要保留的项，可改名称、说明、目录与命令。"}
          </p>
          {error && (
            <p className={error.includes("已改用本地") ? "ai-side-warn" : "ai-side-error"}>
              {error}
            </p>
          )}

          <div className="run-target-list">
            {drafts.map((d, idx) => (
              <div
                key={d.id || idx}
                className={`run-target-row${d.checked ? " is-checked" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={d.checked}
                  onChange={(e) => updateDraft(idx, { checked: e.target.checked })}
                  aria-label={`选用 ${d.name}`}
                />
                <div className="run-target-fields">
                  <div className="run-target-name-row">
                    <input
                      type="text"
                      value={d.name}
                      onChange={(e) => updateDraft(idx, { name: e.target.value })}
                      placeholder="名称，如：启动 APP"
                    />
                    <label className="run-default-check">
                      <input
                        type="radio"
                        name="run-default-side"
                        checked={Boolean(d.isDefault)}
                        onChange={() => setDefault(idx)}
                      />
                      默认
                    </label>
                  </div>
                  <label className="run-field">
                    <span>说明</span>
                    <input
                      type="text"
                      value={d.description ?? ""}
                      onChange={(e) =>
                        updateDraft(idx, { description: e.target.value || null })
                      }
                      placeholder="一句话说明用途"
                    />
                  </label>
                  <label className="run-field">
                    <span>目录</span>
                    <input
                      type="text"
                      value={d.cwd}
                      onChange={(e) => updateDraft(idx, { cwd: e.target.value })}
                      placeholder="."
                    />
                  </label>
                  <label className="run-field">
                    <span>命令</span>
                    <input
                      type="text"
                      value={d.command}
                      onChange={(e) => updateDraft(idx, { command: e.target.value })}
                      placeholder="pnpm dev"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>

          <footer className="ai-side-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={addRow}
              disabled={saving}
            >
              手动添加
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void onSave()}
              disabled={saving}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </footer>
        </div>
      )}
    </aside>
  );
}
