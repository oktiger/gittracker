import { useEffect, type Dispatch, type SetStateAction } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import type { AiPanelSession } from "../lib/aiPanel";
import type { NewLogDiaryEntry, RunProgressEvent, RunSession, RunTarget } from "../types";
import { AiSidePanel } from "./AiSidePanel";
import "./ActivitySidePanel.css";

export interface AiActivity { id: string; session: AiPanelSession; }

interface Props {
  aiSessions: AiActivity[];
  runSessions: RunSession[];
  onClose: () => void;
  onDismissAi: (id: string, session: AiPanelSession) => void;
  onRunSessionsChange: Dispatch<SetStateAction<RunSession[]>>;
  onLog: (entry: NewLogDiaryEntry) => void;
  onTargetsSaved: (projectId: string, targets: RunTarget[]) => void;
  onProjectRefresh: (projectId: string, session: AiPanelSession) => void;
  onToast: (msg: string) => void;
}

function statusLabel(status: RunSession["status"]) {
  if (status === "running") return "运行中";
  if (status === "stopping") return "停止中";
  if (status === "stopped") return "已停止";
  if (status === "exited") return "已结束";
  return "运行失败";
}

export function ActivitySidePanel(props: Props) {
  const { onRunSessionsChange } = props;
  useEffect(() => {
    const unlistenPromise = listen<RunProgressEvent>("run-progress", ({ payload }) => {
      onRunSessionsChange((sessions) => sessions.map((session) => {
        if (session.id !== payload.sessionId) return session;
        const next = { ...session, output: [...session.output] };
        if (payload.kind === "output") {
          next.output.push({ stream: payload.stream ?? "stdout", text: payload.text });
          if (next.output.length > 2_000) { next.output.shift(); next.outputTruncated = true; }
        }
        if (payload.kind === "exit") {
          next.status = session.status === "stopping" ? "stopped" : payload.text.includes("异常") ? "failed" : "exited";
          next.endedAt = Math.floor(Date.now() / 1000);
        }
        if (payload.kind === "error") next.status = "failed";
        return next;
      }));
    });
    return () => { void unlistenPromise.then((unlisten) => unlisten()); };
  }, [onRunSessionsChange]);

  const stop = async (session: RunSession) => {
    try {
      await api.stopRunSession(session.id);
      onRunSessionsChange((sessions) => sessions.map((item) => item.id === session.id ? { ...item, status: "stopping" } : item));
    } catch (error) { props.onToast(String(error)); }
  };

  const restart = async (session: RunSession) => {
    try {
      const next = await api.runProjectTarget(session.projectId, session.targetId);
      onRunSessionsChange((sessions) => [...sessions, next]);
    } catch (error) { props.onToast(String(error)); }
  };

  return (
    <aside className="activity-side-panel" aria-label="运行中心">
      <header className="activity-side-header">
        <div><h3>运行中心</h3><p>命令与 AI 会话按时间顺序保留</p></div>
        <button type="button" className="btn-ghost btn-icon" onClick={props.onClose} aria-label="隐藏运行中心">×</button>
      </header>
      <div className="activity-side-body">
        {[...props.runSessions].sort((a, b) => a.startedAt - b.startedAt).map((session) => (
          <article className="run-session-card" key={session.id}>
            <div className="run-session-head"><div><strong>{session.targetName}</strong><small>{session.projectName} · {session.cwd}</small></div><span className={"run-session-status is-" + session.status}>{statusLabel(session.status)}</span></div>
            <code className="run-session-command">{session.command}</code>
            <pre className="run-session-output">{session.output.length ? session.output.map((line, index) => <span key={index} className={"is-" + line.stream}>{line.text + "\n"}</span>) : "正在等待输出…"}</pre>
            <div className="run-session-actions">{session.status === "running" && <button type="button" className="btn btn-secondary btn-sm" onClick={() => void stop(session)}>停止</button>}{session.endedAt && <><small>{session.exitCode == null ? statusLabel(session.status) : "退出码 " + session.exitCode}</small><button type="button" className="btn btn-secondary btn-sm" onClick={() => void restart(session)}>重新运行</button></>}</div>
          </article>
        ))}
        {props.aiSessions.map((item) => <AiSidePanel key={item.id} embedded session={item.session} onClose={() => props.onDismissAi(item.id, item.session)} onLog={props.onLog} onTargetsSaved={props.onTargetsSaved} onProjectRefresh={(projectId) => props.onProjectRefresh(projectId, item.session)} onToast={props.onToast} />)}
        {props.runSessions.length === 0 && props.aiSessions.length === 0 && <p className="activity-empty">还没有运行中的会话。</p>}
      </div>
    </aside>
  );
}
