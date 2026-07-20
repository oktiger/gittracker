import { useEffect, useState } from "react";
import { api } from "../api";
import "./Dialog.css";

interface Props {
  projectId: string;
  relativePath: string;
  title: string;
  libraryFile?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function MarkdownEditorDialog({
  projectId,
  relativePath,
  title,
  libraryFile = false,
  onClose,
  onSaved,
}: Props) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        setContent(libraryFile
          ? await api.readDocumentLibraryFile(projectId, relativePath)
          : await api.readDocFile(projectId, relativePath));
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId, relativePath]);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (libraryFile) await api.writeDocumentLibraryFile(projectId, relativePath, content);
      else await api.writeDocFile(projectId, relativePath, content);
      onSaved();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="md-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dialog-header">
          <h3 id="md-editor-title">{title}</h3>
          <button type="button" className="btn-ghost btn-icon" onClick={onClose}>
            ×
          </button>
        </header>
        <p className="dialog-hint">{relativePath}</p>

        {loading ? (
          <p className="dialog-hint">加载中…</p>
        ) : (
          <textarea
            className="md-editor-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            disabled={saving}
          />
        )}

        {error && <p className="dialog-error">{error}</p>}

        <footer className="dialog-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onSave()}
            disabled={loading || saving}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </footer>
      </div>
    </div>
  );
}
