import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { CommitDialog } from "./components/CommitDialog";
import { DiscardDialog } from "./components/DiscardDialog";
import { HelpTip } from "./components/HelpTip";
import { ProjectCard } from "./components/ProjectCard";
import { useProjects } from "./hooks/useProjects";
import "./App.css";

type DialogState =
  | { type: "commit"; id: string; name: string }
  | { type: "discard"; id: string; name: string }
  | null;

function App() {
  const {
    projects,
    loading,
    error,
    setError,
    busyIds,
    setBusy,
    refresh,
    refreshOne,
  } = useProjects();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const onAdd = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择 Git 项目目录",
      });
      if (!selected || Array.isArray(selected)) return;
      await api.addProject(selected);
      await refresh();
      showToast("已添加项目");
    } catch (e) {
      setError(String(e));
    }
  };

  const onRemove = async (id: string, name: string) => {
    if (!window.confirm(`从看板移除「${name}」？\n不会删除磁盘上的仓库。`)) return;
    try {
      await api.removeProject(id);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const onOneClick = async (id: string) => {
    setBusy(id, "一键提交中：AI → Commit → Push…");
    setError(null);
    try {
      const result = await api.oneClickCommit(id);
      showToast(`已提交并推送：${result.message.split("\n")[0]}`);
      await refreshOne(id);
    } catch (e) {
      setError(String(e));
      await refreshOne(id);
    } finally {
      setBusy(id, null);
    }
  };

  return (
    <div className="app">
      <div className="app-bg" aria-hidden="true" />

      <header className="topbar">
        <div className="brand">
          <h1>GitTracker</h1>
          <p>
            多项目 Git 看板
            <HelpTip text="文件变更自动刷新；每 60 秒兜底全量刷新。关闭窗口后仍驻留托盘。" />
          </p>
        </div>
        <div className="topbar-actions">
          <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>
            刷新
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void onAdd()}>
            添加项目
          </button>
        </div>
      </header>

      {error && (
        <div className="banner-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn-link" onClick={() => setError(null)}>
            关闭
          </button>
        </div>
      )}

      <main className="board">
        {loading ? (
          <div className="empty-state">加载中…</div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <h2>还没有项目</h2>
            <p>添加本地 Git 仓库，即可在同一窗口查看状态并提交。</p>
            <button type="button" className="btn btn-primary" onClick={() => void onAdd()}>
              添加第一个项目
            </button>
          </div>
        ) : (
          <div className="grid">
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                busy={busyIds[p.id]}
                onManualCommit={() =>
                  setDialog({ type: "commit", id: p.id, name: p.name })
                }
                onOneClick={() => void onOneClick(p.id)}
                onDiscard={() =>
                  setDialog({ type: "discard", id: p.id, name: p.name })
                }
                onRemove={() => void onRemove(p.id, p.name)}
              />
            ))}
          </div>
        )}
      </main>

      {dialog?.type === "commit" && (
        <CommitDialog
          projectId={dialog.id}
          projectName={dialog.name}
          onClose={() => setDialog(null)}
          onDone={() => {
            void refreshOne(dialog.id);
            showToast("提交完成");
          }}
        />
      )}

      {dialog?.type === "discard" && (
        <DiscardDialog
          projectId={dialog.id}
          projectName={dialog.name}
          onClose={() => setDialog(null)}
          onDone={() => {
            void refreshOne(dialog.id);
            showToast("已 Discard");
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;
