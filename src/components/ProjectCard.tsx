import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type {
  DocsOverview,
  DocsTaskItem,
  NewLogDiaryEntry,
  ProjectStatus,
  RunTarget,
} from "../types";
import { HelpTip } from "./HelpTip";
import { DocumentLibraryTab } from "./DocumentLibraryTab";
import { EvolutionPage } from "./EvolutionPage";
import "./ProjectCard.css";

interface Props {
  project: ProjectStatus;
  busy?: string;
  /** 详情页已有外层标题时隐藏卡片内项目名，避免重复 */
  hideTitle?: boolean;
  onManualCommit: () => void;
  onOneClick: () => void;
  onDiscard: () => void;
  onViewChanges: () => void;
  onRemove: () => void;
  onRunTarget: (target: RunTarget) => void;
  onOpenDoc: (relativePath: string, title: string, libraryFile?: boolean) => void;
  onConfigureRun: (mode: "identify" | "config") => void;
  onGenerateTasks: () => void;
  onImplementTask: (task: DocsTaskItem) => void;
  /** 侧栏 AI 完成后递增，用于刷新 DOCS 列表 */
  docsEpoch?: number;
  onError: (msg: string) => void;
  onToast: (msg: string) => void;
  onLog: (entry: NewLogDiaryEntry) => void;
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

function statusLabel(status: string): { text: string; cls: string } {
  if (status === "done") return { text: "已完成", cls: "done" };
  return { text: "待做", cls: "" };
}

export function ProjectCard({
  project,
  busy,
  hideTitle = false,
  onManualCommit,
  onOneClick,
  onDiscard,
  onViewChanges,
  onRemove,
  onRunTarget: onRunTargetFromCenter,
  onOpenDoc,
  onConfigureRun,
  onGenerateTasks,
  onImplementTask,
  docsEpoch = 0,
  onError,
  onToast,
  onLog,
}: Props) {
  const disabled = Boolean(busy);
  const hasChanges = !project.clean;
  const workingChanges = project.unstaged + project.untracked;
  const [docs, setDocs] = useState<DocsOverview | null>(null);
  const [docsBusy, setDocsBusy] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [detailTab, setDetailTab] = useState<"run" | "code" | "docs" | "evolution">("run");
  const docsRef = useRef<HTMLElement>(null);
  const runRef = useRef<HTMLDivElement>(null);
  const targets: RunTarget[] = project.runTargets ?? [];
  const hasTargets = targets.length > 0;

  const loadDocs = async () => {
    try {
      const overview = await api.listDocs(project.id);
      setDocs(overview);
    } catch (e) {
      setDocs(null);
      onError(String(e));
    }
  };

  useEffect(() => {
    void loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.path, docsEpoch]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!docsRef.current?.contains(target)) {
        setMenuId(null);
      }
      if (!runRef.current?.contains(target)) {
        setRunMenuOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const locked = disabled || Boolean(docsBusy) || runBusy;
  const needsInit =
    docs != null && (docs.needsInit ?? (!docs.hasDocs || !docs.goalExists));

  const onRunTarget = async (targetId: string) => {
    setRunMenuOpen(false);
    setRunBusy(true);
    const t = targets.find((x) => x.id === targetId);
    try {
      if (!t) throw new Error("未找到启动目标");
      onRunTargetFromCenter(t);
    } catch (e) {
      const msg = String(e);
      onLog({
        kind: "runTarget",
        status: "error",
        title: `运行失败 · ${t?.name ?? targetId}`,
        projectId: project.id,
        projectName: project.name,
        detail: t ? `cwd: ${t.cwd}\ncommand: ${t.command}` : undefined,
        error: msg,
      });
      onError(msg);
    } finally {
      setRunBusy(false);
    }
  };

  const onIdentify = () => {
    setRunMenuOpen(false);
    if (hasTargets) {
      if (
        !window.confirm(
          "将用新的识别结果替换当前启动目标，是否继续？",
        )
      ) {
        return;
      }
    }
    onConfigureRun("identify");
  };

  const onCreateDocs = async () => {
    setDocsBusy("正在初始化…");
    try {
      const overview = await api.ensureDocs(project.id);
      setDocs(overview);
      onLog({
        kind: "ensureDocs",
        status: "ok",
        title: `初始化 DOCS · ${project.name}`,
        projectId: project.id,
        projectName: project.name,
        detail: `Goal: ${overview.goalExists ? "已有" : "未检测到"}\nTasks: ${overview.tasks.length}`,
      });
      onToast("已初始化 Goal / Task 与 goal.md");
    } catch (e) {
      const msg = String(e);
      onLog({
        kind: "ensureDocs",
        status: "error",
        title: `初始化 DOCS 失败 · ${project.name}`,
        projectId: project.id,
        projectName: project.name,
        error: msg,
      });
      onError(msg);
    } finally {
      setDocsBusy(null);
    }
  };

  const onGenerate = () => {
    setMenuId(null);
    onGenerateTasks();
  };

  const openTask = async (task: DocsTaskItem) => {
    setMenuId(null);
    if (task.kind === "html") {
      try {
        await api.openDocExternal(project.id, task.relativePath);
        onToast("已用系统应用打开 HTML");
      } catch (e) {
        onError(String(e));
      }
      return;
    }
    onOpenDoc(task.relativePath, `${String(task.number).padStart(3, "0")} ${task.title}`);
  };

  const implementTask = (task: DocsTaskItem) => {
    setMenuId(null);
    onImplementTask(task);
  };

  return (
    <article className={`project-card ${project.clean ? "is-clean" : "is-dirty"}`}>
      {hideTitle && (
        <nav className="detail-tabs" aria-label="项目详情">
          <button type="button" className={detailTab === "run" ? "is-active" : ""} onClick={() => setDetailTab("run")}>运行</button>
          <button type="button" className={detailTab === "code" ? "is-active" : ""} onClick={() => setDetailTab("code")}>代码</button>
          <button type="button" className={detailTab === "docs" ? "is-active" : ""} onClick={() => setDetailTab("docs")}>文档</button>
          <button type="button" className={detailTab === "evolution" ? "is-active" : ""} onClick={() => setDetailTab("evolution")}>进化</button>
        </nav>
      )}
      {hideTitle && detailTab === "run" && (
        <section className="run-tab" aria-label="运行">
          <div className="docs-head"><span className="docs-label">可运行命令</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => onConfigureRun("config")} disabled={locked}>配置</button></div>
          {hasTargets ? <ul className="run-target-list">{targets.map((target) => <li key={target.id}><button type="button" disabled={locked} onClick={() => void onRunTarget(target.id)}><span>{target.name}{target.isDefault ? " ★" : ""}</span><code>{target.cwd} · {target.command}</code>{target.description && <small>{target.description}</small>}</button></li>)}</ul> : <div className="docs-empty"><p>还没有可运行的命令</p><button type="button" className="btn btn-primary btn-sm" disabled={locked} onClick={onIdentify}>识别启动方式</button></div>}
        </section>
      )}
      {hideTitle && detailTab === "docs" && <DocumentLibraryTab projectId={project.id} projectPath={project.path} epoch={docsEpoch} onOpenFile={(relativePath, title) => onOpenDoc(relativePath, title, true)} onError={onError} onToast={onToast} />}
      {hideTitle && detailTab === "evolution" && <EvolutionPage overview={docs} busy={locked} onInitialize={() => void onCreateDocs()} onOpenGoal={(relativePath, title) => onOpenDoc(relativePath, title)} />}
      {(!hideTitle || detailTab === "code") && <>
      <header className="card-header">
        <div className={`card-title-row${hideTitle ? " is-meta-only" : ""}`}>
          {!hideTitle && (
            <h2 className="card-title" title={project.path}>
              {project.name}
            </h2>
          )}
          <button
            type="button"
            className="btn-ghost btn-icon"
            onClick={onRemove}
            title="从看板移除"
            disabled={locked}
          >
            ×
          </button>
        </div>
        <div className="card-meta">
          <span className="branch" title="当前分支">
            {project.branch || "—"}
          </span>
          <span className={`badge ${project.clean ? "badge-clean" : "badge-dirty"}`}>
            {docsBusy ? "AI 工作中" : project.clean ? "Clean" : "Changed"}
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
          disabled={workingChanges === 0 || locked}
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

      {!hideTitle && <section className="docs-block" ref={docsRef} aria-label="DOCS">
        <div className="docs-head">
          <span className="docs-label">
            DOCS <HelpTip text="Goal 写目标；生成任务拆成 Task；⋯ 可打开或实现" />
          </span>
          {docs == null ? null : needsInit ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={locked}
              onClick={() => void onCreateDocs()}
            >
              初始化
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={locked || !docs.goalExists}
              onClick={() => void onGenerate()}
            >
              生成任务
            </button>
          )}
        </div>

        {docsBusy && <p className="docs-busy">{docsBusy}</p>}

        {!docs ? (
          <p className="docs-empty">加载中…</p>
        ) : needsInit ? (
          <div className="docs-empty">
            <p>未检测到 Goal / Task 或 goal.md</p>
            <p className="docs-empty-hint">点击「初始化」自动创建文件夹与 goal.md</p>
          </div>
        ) : docs.tasks.length === 0 ? (
          <div className="docs-empty">
            <p>暂无 Task · {docs.goalExists ? "已有 goal.md" : "请先写 goal.md"}</p>
            {docs.goalRelativePath && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={locked}
                onClick={() => onOpenDoc(docs.goalRelativePath!, "goal.md")}
              >
                打开 goal.md
              </button>
            )}
          </div>
        ) : (
          <>
            <ul className="task-list">
              {docs.tasks.map((task) => {
                const st =
                  docsBusy?.includes(String(task.number).padStart(3, "0")) &&
                  docsBusy.startsWith("正在实现")
                    ? { text: "实现中…", cls: "busy" }
                    : statusLabel(task.status);
                const key = task.relativePath;
                const open = menuId === key;
                return (
                  <li key={key} className={`task-row${open ? " is-open" : ""}`}>
                    <span className="task-num">
                      {String(task.number).padStart(3, "0")}
                    </span>
                    <button
                      type="button"
                      className="task-title"
                      disabled={locked}
                      onClick={() => void openTask(task)}
                      title={task.relativePath}
                    >
                      {task.title}
                    </button>
                    <span className={`task-status ${st.cls}`}>{st.text}</span>
                    <div className="more-wrap">
                      <button
                        type="button"
                        className={`more-btn${open ? " is-open" : ""}`}
                        disabled={locked}
                        aria-label="更多"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuId(open ? null : key);
                        }}
                      >
                        ⋯
                      </button>
                      {open && (
                        <div className="more-menu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => void openTask(task)}
                          >
                            打开
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => void implementTask(task)}
                          >
                            实现
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {docs.goalRelativePath && (
              <button
                type="button"
                className="btn btn-ghost btn-sm docs-goal-link"
                disabled={locked}
                onClick={() => onOpenDoc(docs.goalRelativePath!, "goal.md")}
              >
                打开 goal.md
              </button>
            )}
          </>
        )}
      </section>}

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
        {(busy || docsBusy || runBusy) && (
          <span className="busy-label">
            {busy || docsBusy || (runBusy ? "正在打开终端…" : null)}
          </span>
        )}
        {!hideTitle && <div className="run-wrap" ref={runRef}>
          <button
            type="button"
            className="btn btn-run"
            disabled={locked}
            onClick={(e) => {
              e.stopPropagation();
              setRunMenuOpen((v) => !v);
              setMenuId(null);
            }}
          >
            运行 ▾
          </button>
          {runMenuOpen && (
            <div className="run-menu" role="menu">
              {hasTargets ? (
                <>
                  {targets.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="menuitem"
                      className="run-menu-item"
                      onClick={() => void onRunTarget(t.id)}
                    >
                      <span className="run-menu-name">
                        {t.name}
                        {t.isDefault ? <span className="run-star"> ★</span> : null}
                      </span>
                      <span
                        className={
                          t.description?.trim() ? "run-menu-desc" : "run-menu-cmd"
                        }
                        title={
                          t.description?.trim()
                            ? `${t.cwd} · ${t.command}`
                            : undefined
                        }
                      >
                        {t.description?.trim() || `${t.cwd} · ${t.command}`}
                      </span>
                    </button>
                  ))}
                  <div className="run-menu-sep" />
                  <button
                    type="button"
                    role="menuitem"
                    className="run-menu-item muted"
                    onClick={() => {
                      setRunMenuOpen(false);
                      onConfigureRun("config");
                    }}
                  >
                    配置启动方式…
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="run-menu-item muted"
                    onClick={onIdentify}
                  >
                    重新用 AI 识别…
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="run-menu-item"
                    onClick={onIdentify}
                  >
                    <span className="run-menu-name">识别启动方式…</span>
                    <span className="run-menu-cmd">用 AI 分析本项目</span>
                  </button>
                  <div className="run-menu-sep" />
                  <button
                    type="button"
                    role="menuitem"
                    className="run-menu-item muted"
                    onClick={() => {
                      setRunMenuOpen(false);
                      onConfigureRun("config");
                    }}
                  >
                    手动添加一条…
                  </button>
                </>
              )}
            </div>
          )}
        </div>}
        <button
          type="button"
          className="btn btn-secondary"
          disabled={locked || !hasChanges}
          onClick={onManualCommit}
        >
          手动提交
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={locked || !hasChanges}
          onClick={onOneClick}
        >
          一键提交
        </button>
        <HelpTip text="点击后自动暂存全部改动（含 Unstaged / Untracked），再 AI 生成 message → Commit → Push；任一步失败即停止" />
        <button
          type="button"
          className="btn btn-danger"
          disabled={locked || !hasChanges}
          onClick={onDiscard}
        >
          Discard
        </button>
      </footer>
      </>}
    </article>
  );
}
