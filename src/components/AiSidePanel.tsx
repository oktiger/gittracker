import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import {
  aiSessionSubtitle,
  aiSessionTitle,
  newAiSessionId,
  waitForPaint,
  type AiPanelSession,
} from "../lib/aiPanel";
import type {
  AiProgressEvent,
  AiTranscriptLine,
  NewLogDiaryEntry,
  RunTarget,
} from "../types";
import "./AiSidePanel.css";

type Draft = RunTarget & { checked: boolean };

interface Props {
  session: AiPanelSession;
  onClose: () => void;
  onLog: (entry: NewLogDiaryEntry) => void;
  onTargetsSaved?: (projectId: string, targets: RunTarget[]) => void;
  onProjectRefresh?: (projectId: string) => void;
  onToast?: (msg: string) => void;
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

function formatTranscriptLines(lines: AiTranscriptLine[]): string {
  return lines
    .map((line) => `[${kindLabel(line.kind)}] ${line.text}`)
    .join("\n\n");
}

/** 拼成便于粘贴给 AI 的整段运行过程 */
function formatAiRunForCopy(opts: {
  title: string;
  subtitle: string;
  transcript: AiTranscriptLine[];
  resultSummary: string | null;
  error: string | null;
  phase: "running" | "done" | "edit";
}): string {
  const status =
    opts.error
      ? "失败"
      : opts.phase === "running"
        ? "进行中"
        : "完成";
  const lines = [
    "# GitTracker AI 运行过程（反馈用）",
    "",
    `标题: ${opts.title}`,
    `说明: ${opts.subtitle}`,
    `状态: ${status}`,
    "",
  ];

  if (opts.transcript.length > 0) {
    lines.push("## AI 过程", "", formatTranscriptLines(opts.transcript), "");
  }

  if (opts.resultSummary?.trim()) {
    lines.push("## 结果", "", opts.resultSummary.trim(), "");
  }

  if (opts.error?.trim()) {
    lines.push("## 错误", "", opts.error.trim(), "");
  }

  lines.push(
    "---",
    "请根据以上 AI 运行过程帮忙分析问题原因，并给出可执行的修复建议。",
  );
  return lines.join("\n");
}

function bootLine(session: AiPanelSession): AiTranscriptLine {
  const text = (() => {
    switch (session.kind) {
      case "dailyCompletion":
        return `开始整理${session.period === "week" ? "本周" : session.period === "sevenDays" ? "过去 7 天" : "本日"}的完成事项…`;
      case "identify":
        return `开始识别「${session.projectName}」的启动方式…`;
      case "testConnection":
        return `开始测试 ${session.provider === "cursorAgent" ? "Cursor Agent CLI" : "Codex CLI"}…`;
      case "generateCommit":
        return `开始为「${session.projectName}」生成 Commit message…`;
      case "oneClick":
        return `一键提交「${session.projectName}」：AI → Commit → Push…`;
      case "generateTasks":
        return `根据 Goal 为「${session.projectName}」生成任务…`;
      case "runTask":
        return `实现任务 ${session.taskNumber}「${session.taskTitle}」…`;
      case "config":
        return "";
    }
  })();
  return { id: "boot", kind: "status", text };
}

export function AiSidePanel({
  session,
  onClose,
  onLog,
  onTargetsSaved,
  onProjectRefresh,
  onToast,
}: Props) {
  const needsAi = session.kind !== "config";
  const [phase, setPhase] = useState<"running" | "done" | "edit">(
    session.kind === "config"
      ? "edit"
      : session.kind === "identify"
        ? "running"
        : "running",
  );
  const [resultSummary, setResultSummary] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    session.kind === "config"
      ? toDraft(
          session.initialTargets?.length
            ? session.initialTargets
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
  const [copied, setCopied] = useState(false);
  const [transcript, setTranscript] = useState<AiTranscriptLine[]>(() => {
    const boot = bootLine(session);
    return boot.text ? [boot] : [];
  });
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const lineIdRef = useRef(0);
  const closedRef = useRef(false);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript, phase]);

  useEffect(() => {
    closedRef.current = false;
    return () => {
      closedRef.current = true;
    };
  }, [session]);

  useEffect(() => {
    if (!needsAi) return;
    let cancelled = false;
    const sessionId = newAiSessionId();
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
          transcriptRef.current = next;
          return next;
        }
        const next = [...prev, { id, kind: payload.kind, text }];
        transcriptRef.current = next;
        return next;
      });
    });

    void (async () => {
      setPhase("running");
      setError(null);
      setResultSummary(null);
      const unlisten = await unlistenPromise;
      if (cancelled) {
        unlisten();
        return;
      }
      await waitForPaint();
      if (cancelled) return;

      try {
        switch (session.kind) {
          case "dailyCompletion": {
            const result = await api.generateDailyCompletion(session.period, sessionId);
            if (cancelled) return;
            const periodLabel = session.period === "week" ? "本周" : session.period === "sevenDays" ? "过去 7 天" : "本日";
            onLog({
              kind: "dailyCompletion",
              status: "ok",
              title: `${session.automatic ? "自动" : "手动"}总结每日完成 · ${periodLabel}`,
              detail: result,
            });
            setResultSummary(result);
            session.onResult?.(result);
            onToast?.(session.automatic ? "已自动生成每日完成" : "每日完成已生成");
            setPhase("done");
            break;
          }
          case "identify": {
            const result = await api.suggestRunTargets(session.projectId, sessionId);
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
              title: `识别启动方式 · ${session.projectName}`,
              projectId: session.projectId,
              projectName: session.projectName,
              detail: `来源: ${result.source}\n建议 ${result.targets.length} 条:\n${preview || "（空）"}`,
              error: result.warning ?? undefined,
            });
            setPhase("edit");
            break;
          }
          case "testConnection": {
            const result = await api.testAiConnection(session.provider, sessionId);
            if (cancelled) return;
            const label = result.providerLabel;
            const process = formatTranscriptLines(transcriptRef.current);
            onLog({
              kind: "testConnection",
              status: "ok",
              title: `测试 ${label}`,
              detail: [
                `Provider: ${label}`,
                `回复: ${result.reply}`,
                process ? `\n## AI 过程\n${process}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            });
            setResultSummary(`${label} 回复：${result.reply}`);
            session.onResult(true, result.reply);
            setPhase("done");
            break;
          }
          case "generateCommit": {
            const msg = await api.generateCommitMessage(session.projectId, sessionId);
            if (cancelled) return;
            onLog({
              kind: "generateCommit",
              status: "ok",
              title: `AI Generate · ${session.projectName}`,
              projectId: session.projectId,
              projectName: session.projectName,
              detail: `生成的 Commit message:\n${msg}`,
            });
            setResultSummary(msg);
            session.onResult(msg);
            setPhase("done");
            break;
          }
          case "oneClick": {
            const result = await api.oneClickCommit(session.projectId, sessionId);
            if (cancelled) return;
            onLog({
              kind: "oneClick",
              status: "ok",
              title: `一键提交 · ${session.projectName}`,
              projectId: session.projectId,
              projectName: session.projectName,
              detail: `Message:\n${result.message}\n\n已推送: ${result.pushed ? "是" : "否"}`,
            });
            setResultSummary(
              `已提交并推送：\n${result.message.split("\n")[0] ?? result.message}`,
            );
            onToast?.(`已提交并推送：${result.message.split("\n")[0]}`);
            onProjectRefresh?.(session.projectId);
            setPhase("done");
            break;
          }
          case "generateTasks": {
            const result = await api.generateTasksFromGoal(session.projectId, sessionId);
            if (cancelled) return;
            onLog({
              kind: "generateTasks",
              status: "ok",
              title: `生成任务 · ${session.projectName}`,
              projectId: session.projectId,
              projectName: session.projectName,
              detail: `新建 ${result.created} 条任务\n当前共 ${result.overview.tasks.length} 条`,
            });
            setResultSummary(`已生成 ${result.created} 条任务`);
            onToast?.(`已生成 ${result.created} 条任务`);
            onProjectRefresh?.(session.projectId);
            setPhase("done");
            break;
          }
          case "runTask": {
            const result = await api.runDocsTask(
              session.projectId,
              session.relativePath,
              sessionId,
            );
            if (cancelled) return;
            onLog({
              kind: "runTask",
              status: "ok",
              title: `实现任务 ${session.taskNumber} · ${session.taskTitle}`,
              projectId: session.projectId,
              projectName: session.projectName,
              detail: `路径: ${session.relativePath}\n\n实现摘要:\n${result.summary || "（无摘要）"}`,
            });
            setResultSummary(result.summary || `已实现 ${session.taskNumber}`);
            onToast?.(`已实现 ${session.taskNumber}`);
            onProjectRefresh?.(session.projectId);
            setPhase("done");
            break;
          }
          default:
            break;
        }
      } catch (e) {
        if (cancelled) return;
        const err = String(e);
        setError(err);
        switch (session.kind) {
          case "dailyCompletion":
            onLog({
              kind: "dailyCompletion",
              status: "error",
              title: "每日完成总结失败",
              detail: "根据各项目 commit message，经统一 AI 通道生成总结。",
              error: err,
            });
            setPhase("done");
            break;
          case "identify":
            onLog({
              kind: "suggestRunTargets",
              status: "error",
              title: `识别启动方式失败 · ${session.projectName}`,
              projectId: session.projectId,
              projectName: session.projectName,
              detail: "经统一 AI 通道分析仓库并建议 Run Targets。",
              error: err,
            });
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
            break;
          case "testConnection": {
            const label =
              session.provider === "cursorAgent" ? "Cursor Agent CLI" : "Codex CLI";
            const process = formatTranscriptLines(transcriptRef.current);
            onLog({
              kind: "testConnection",
              status: "error",
              title: `测试 ${label} 失败`,
              detail: [
                `Provider: ${label}`,
                "验证 CLI 已安装并可返回最小只读回复。",
                process ? `\n## AI 过程\n${process}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
              error: err,
            });
            session.onResult(false, err);
            setPhase("done");
            break;
          }
          case "generateCommit":
            onLog({
              kind: "generateCommit",
              status: "error",
              title: `AI Generate 失败 · ${session.projectName}`,
              projectId: session.projectId,
              projectName: session.projectName,
              detail: "根据 Staged Diff，经统一 AI 通道生成 Commit message。",
              error: err,
            });
            session.onError?.(err);
            setPhase("done");
            break;
          case "oneClick":
            onLog({
              kind: "oneClick",
              status: "error",
              title: `一键提交失败 · ${session.projectName}`,
              projectId: session.projectId,
              projectName: session.projectName,
              detail: "流程：AI 生成 Commit Message → Commit → Push",
              error: err,
            });
            onProjectRefresh?.(session.projectId);
            setPhase("done");
            break;
          case "generateTasks":
            onLog({
              kind: "generateTasks",
              status: "error",
              title: `生成任务失败 · ${session.projectName}`,
              projectId: session.projectId,
              projectName: session.projectName,
              detail: "根据 Goal + 提示词模板，经统一 AI 通道生成 Task。",
              error: err,
            });
            setPhase("done");
            break;
          case "runTask":
            onLog({
              kind: "runTask",
              status: "error",
              title: `实现任务失败 ${session.taskNumber} · ${session.taskTitle}`,
              projectId: session.projectId,
              projectName: session.projectName,
              detail: `路径: ${session.relativePath}`,
              error: err,
            });
            setPhase("done");
            break;
          default:
            setPhase("done");
        }
      } finally {
        unlisten();
      }
    })();

    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
    // session object identity changes each open — intentional
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.kind, needsAi]);

  const handleClose = () => {
    if (closedRef.current) return;
    if (phase === "running" && session.kind === "generateCommit") {
      session.onError?.("已取消");
    }
    if (phase === "running" && session.kind === "testConnection") {
      session.onResult(false, "已取消");
    }
    onClose();
  };

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

  const onSaveTargets = async () => {
    if (session.kind !== "identify" && session.kind !== "config") return;
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
      const saved = await api.setRunTargets(session.projectId, payload);
      onLog({
        kind: "saveRunTargets",
        status: "ok",
        title: `保存启动目标 · ${session.projectName}`,
        projectId: session.projectId,
        projectName: session.projectName,
        detail: saved
          .map((t) => `- ${t.name}${t.isDefault ? " ★" : ""}: ${t.cwd} · ${t.command}`)
          .join("\n"),
      });
      onTargetsSaved?.(session.projectId, saved);
      onClose();
    } catch (e) {
      const err = String(e);
      onLog({
        kind: "saveRunTargets",
        status: "error",
        title: `保存启动目标失败 · ${session.projectName}`,
        projectId: session.projectId,
        projectName: session.projectName,
        error: err,
      });
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const title = phase === "edit" && session.kind === "identify"
    ? "确认启动目标"
    : aiSessionTitle(session);
  const subtitle = aiSessionSubtitle(session);

  const canCopy =
    transcript.length > 0 || Boolean(resultSummary) || Boolean(error);

  const copyAiRun = async () => {
    if (!canCopy) return;
    const text = formatAiRunForCopy({
      title,
      subtitle,
      transcript: transcriptRef.current,
      resultSummary,
      error,
      phase,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onToast?.("已复制，可粘贴给 AI");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      onToast?.("复制失败，请手动选择文本");
    }
  };

  return (
    <aside className="ai-side-panel" aria-label={title}>
      <header className="ai-side-header">
        <div className="ai-side-heading">
          <h3>{title}</h3>
          <p className="ai-side-sub">
            {subtitle}
            {phase === "running" ? " · 进行中" : ""}
          </p>
        </div>
        <div className="ai-side-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm ai-side-copy-btn"
            onClick={() => void copyAiRun()}
            disabled={!canCopy || saving}
            aria-label="复制 AI 运行过程"
            title="复制整段 AI 过程"
          >
            {copied ? "已复制" : "复制"}
          </button>
          <button
            type="button"
            className="btn-ghost btn-icon"
            onClick={handleClose}
            disabled={saving}
            aria-label="关闭侧边栏"
          >
            ×
          </button>
        </div>
      </header>

      {phase === "running" && (
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
            <button type="button" className="btn btn-secondary" onClick={handleClose}>
              取消
            </button>
          </footer>
        </div>
      )}

      {phase === "done" && (
        <div className="ai-side-body">
          {transcript.length > 0 && (
            <details className="ai-side-history" open>
              <summary>AI 过程（{transcript.length} 条）</summary>
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
          {resultSummary && !error && (
            <pre className="ai-side-result">{resultSummary}</pre>
          )}
          {error && <p className="ai-side-error">{error}</p>}
          <footer className="ai-side-footer">
            <button type="button" className="btn btn-primary" onClick={onClose}>
              完成
            </button>
          </footer>
        </div>
      )}

      {phase === "edit" && (session.kind === "identify" || session.kind === "config") && (
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
            {session.kind === "config"
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
              onClick={() => void onSaveTargets()}
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
