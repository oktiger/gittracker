import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { DocumentLibrary, DocumentNode } from "../types";

interface Props {
  projectId: string;
  projectPath: string;
  epoch?: number;
  onOpenFile: (relativePath: string, title: string) => void;
  onError: (message: string) => void;
  onToast: (message: string) => void;
}

export function DocumentLibraryTab({ projectId, projectPath, epoch = 0, onOpenFile, onError, onToast }: Props) {
  const [library, setLibrary] = useState<DocumentLibrary | null>(null);
  const [root, setRoot] = useState("DOCS");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const load = async () => {
    try { setLibrary(await api.listDocumentLibrary(projectId)); }
    catch (e) { onError(String(e)); }
  };
  useEffect(() => { void load(); }, [projectId, epoch]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setMenu(null); };
    document.addEventListener("click", close); return () => document.removeEventListener("click", close);
  }, []);
  const saveRoot = async (value: string) => {
    const clean = value.trim().replace(/^\/+|\/+$/g, "");
    if (!clean) return onError("请输入项目内的文档库文件夹名称");
    setBusy(true);
    try { setLibrary(await api.setDocumentLibrary(projectId, clean)); onToast(`已设置文档库：${clean}`); }
    catch (e) { onError(String(e)); } finally { setBusy(false); }
  };
  const chooseExisting = async () => {
    const chosen = await open({ directory: true, multiple: false, title: "选择项目内的文档库" });
    if (!chosen || Array.isArray(chosen)) return;
    const prefix = projectPath.endsWith("/") ? projectPath : `${projectPath}/`;
    if (!chosen.startsWith(prefix)) return onError("请选择当前项目目录内的文件夹");
    await saveRoot(chosen.slice(prefix.length));
  };
  const openFile = async (node: DocumentNode) => {
    if (/\.html?$/i.test(node.name)) {
      try {
        await api.openDocumentLibraryHtml(projectId, node.relativePath);
        onToast("已用默认浏览器打开 HTML");
      } catch (e) {
        onError(String(e));
      }
      return;
    }
    onOpenFile(node.relativePath, node.name);
  };
  const renderNode = (node: DocumentNode) => {
    const opened = menu === node.relativePath;
    return <li key={node.relativePath} className="document-node">
      <div className="document-row">
        <button type="button" className={`document-name${node.isDirectory ? " is-folder" : ""}`} onClick={() => !node.isDirectory && void openFile(node)} title={node.relativePath}>
          <span>{node.isDirectory ? "▸" : "·"}</span>{node.name}
        </button>
        <div className="more-wrap">
          <button type="button" className={`more-btn${opened ? " is-open" : ""}`} aria-label={`${node.name} 的更多操作`} onClick={(e) => { e.stopPropagation(); setMenu(opened ? null : node.relativePath); }}>⋯</button>
          {opened && <div className="more-menu" role="menu">
            {!node.isDirectory && <button type="button" role="menuitem" onClick={() => { setMenu(null); void openFile(node); }}>{/\.html?$/i.test(node.name) ? "用浏览器打开" : "打开并编辑"}</button>}
            <button type="button" role="menuitem" onClick={() => { void navigator.clipboard.writeText(node.relativePath); setMenu(null); onToast("已复制路径"); }}>复制路径</button>
          </div>}
        </div>
      </div>
      {node.isDirectory && node.children.length > 0 && <ul className="document-children">{node.children.map(renderNode)}</ul>}
    </li>;
  };
  return <section className="document-library" ref={ref} aria-label="文档">
    <div className="docs-head"><span className="docs-label">文档</span>{library?.root && <span className="document-root">{library.root}</span>}</div>
    {!library ? <p className="docs-empty">加载中…</p> : !library.root ? <div className="docs-empty"><p>尚未设置文档库</p><div className="document-create"><input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="例如 DOCS 或 DOC" disabled={busy} /><button type="button" className="btn btn-primary btn-sm" onClick={() => void saveRoot(root)} disabled={busy}>创建文档库</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => void chooseExisting()} disabled={busy}>选择已有文件夹</button></div></div> : library.entries.length === 0 ? <div className="docs-empty"><p>文档库为空</p></div> : <ul className="document-tree">{library.entries.map(renderNode)}</ul>}
  </section>;
}
