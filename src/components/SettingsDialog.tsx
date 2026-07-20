import { useEffect, useState } from "react";
import { api } from "../api";
import { HelpTip } from "./HelpTip";
import type { AiProvider, AppSettings } from "../types";
import "./Dialog.css";

interface Props {
  onClose: () => void;
  onSaved: (msg: string) => void;
}

const PROVIDERS: {
  id: AiProvider;
  title: string;
  desc: string;
}[] = [
  {
    id: "codex",
    title: "Codex CLI",
    desc: "调用本机 codex，走 OpenAI / Codex 账号与额度。",
  },
  {
    id: "cursorAgent",
    title: "Cursor Agent CLI",
    desc: "调用本机 agent，走 Cursor 订阅额度。",
  },
];

export function SettingsDialog({ onClose, onSaved }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setSettings(await api.getSettings());
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  const onSelect = (aiProvider: AiProvider) => {
    setSettings((prev) => (prev ? { ...prev, aiProvider } : prev));
  };

  const onSave = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const next = await api.updateSettings(settings);
      setSettings(next);
      const label =
        next.aiProvider === "cursorAgent" ? "Cursor Agent CLI" : "Codex CLI";
      onSaved(`已切换 AI 通道为 ${label}`);
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
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dialog-header">
          <h3 id="settings-title">设置</h3>
          <button type="button" className="btn-ghost btn-icon" onClick={onClose}>
            ×
          </button>
        </header>

        <p className="dialog-hint">
          AI 调用通道
          <HelpTip text="手动提交的 AI Generate、一键提交等所有 AI 能力都会走此处选择的 CLI，不会混用。" />
        </p>

        <div className="provider-list" role="radiogroup" aria-label="AI 调用通道">
          {PROVIDERS.map((p) => {
            const selected = settings?.aiProvider === p.id;
            return (
              <label
                key={p.id}
                className={`provider-option${selected ? " is-selected" : ""}`}
              >
                <input
                  type="radio"
                  name="aiProvider"
                  value={p.id}
                  checked={selected}
                  onChange={() => onSelect(p.id)}
                  disabled={!settings || saving}
                />
                <span className="provider-copy">
                  <strong>{p.title}</strong>
                  <span>{p.desc}</span>
                </span>
              </label>
            );
          })}
        </div>

        {error && <p className="dialog-error">{error}</p>}

        <footer className="dialog-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onSave()}
            disabled={!settings || saving}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </footer>
      </div>
    </div>
  );
}
