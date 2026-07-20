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

const DEFAULT_GOAL = `你是项目规划助手。请根据下方【项目目标】与【项目现状】，把目标拆成一组可执行任务。

你可以查阅公开网上资料作补充，但必须以目标与当前仓库情况为准，不要编造仓库里不存在的模块。

输出要求：
1. 只输出任务列表，不要开场白、不要总结
2. 每条任务足够小，一个人（或一次 AI 实现）能做完
3. 严格按下面格式重复多条：

### Task
title: 不超过 20 字的标题
body: |
  - 要做什么
  - 验收标准是什么
  - 涉及哪些路径/模块（若已知）
`;

const DEFAULT_TASK = `你是实现助手。请根据下方【任务文档】在当前项目目录中落地实现。

要求：
1. 直接修改/创建必要文件，完成任务
2. 不要执行 git commit / push
3. 完成后用简体中文写一段「实现摘要」（改了什么、如何验收），不要其它废话
`;

type TestStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; label: string; reply: string }
  | { kind: "error"; message: string };

export function SettingsDialog({ onClose, onSaved }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>({ kind: "idle" });
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
    setTestStatus({ kind: "idle" });
  };

  const onTest = async () => {
    if (!settings || testing) return;
    setTesting(true);
    setError(null);
    setTestStatus({ kind: "running" });
    try {
      const result = await api.testAiConnection(settings.aiProvider);
      setTestStatus({
        kind: "ok",
        label: result.providerLabel,
        reply: result.reply,
      });
    } catch (e) {
      setTestStatus({ kind: "error", message: String(e) });
    } finally {
      setTesting(false);
    }
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
      onSaved(`设置已保存（AI：${label}）`);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || testing;

  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <div
        className="dialog dialog-wide"
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
          <HelpTip text="生成 Commit、生成任务、实现任务等所有 AI 能力都会走此处选择的 CLI，不会混用。" />
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
                  disabled={!settings || busy}
                />
                <span className="provider-copy">
                  <strong>{p.title}</strong>
                  <span>{p.desc}</span>
                </span>
              </label>
            );
          })}
        </div>

        <div className="provider-test-row">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void onTest()}
            disabled={!settings || busy}
          >
            {testing ? "测试中…" : "测试联通"}
          </button>
          <HelpTip text="对当前选中的 CLI 发一条最小只读请求，确认已安装、已登录且能正常返回。" />
        </div>
        {testStatus.kind === "running" && (
          <p className="dialog-hint provider-test-msg">正在调用 CLI，请稍候…</p>
        )}
        {testStatus.kind === "ok" && (
          <p className="dialog-ok provider-test-msg">
            {testStatus.label} 已联通（回复：{testStatus.reply}）
          </p>
        )}
        {testStatus.kind === "error" && (
          <p className="dialog-error provider-test-msg">{testStatus.message}</p>
        )}

        <p className="dialog-hint" style={{ marginTop: "1rem" }}>
          生成任务 · 提示词模板
          <HelpTip text="点「生成任务」时：模板 + goal.md + 项目现状 → AI" />
        </p>
        <textarea
          className="settings-textarea"
          value={settings?.goalPromptTemplate ?? ""}
          onChange={(e) =>
            setSettings((prev) =>
              prev ? { ...prev, goalPromptTemplate: e.target.value } : prev,
            )
          }
          disabled={!settings || busy}
          rows={8}
        />
        <button
          type="button"
          className="btn-link"
          style={{ marginBottom: "0.75rem" }}
          onClick={() =>
            setSettings((prev) =>
              prev ? { ...prev, goalPromptTemplate: DEFAULT_GOAL } : prev,
            )
          }
          disabled={!settings || busy}
        >
          恢复「生成任务」默认模板
        </button>

        <p className="dialog-hint">
          实现任务 · 提示词模板
          <HelpTip text="点「⋯ → 实现」时使用；AI 会在项目目录改代码" />
        </p>
        <textarea
          className="settings-textarea"
          value={settings?.taskPromptTemplate ?? ""}
          onChange={(e) =>
            setSettings((prev) =>
              prev ? { ...prev, taskPromptTemplate: e.target.value } : prev,
            )
          }
          disabled={!settings || busy}
          rows={6}
        />
        <button
          type="button"
          className="btn-link"
          onClick={() =>
            setSettings((prev) =>
              prev ? { ...prev, taskPromptTemplate: DEFAULT_TASK } : prev,
            )
          }
          disabled={!settings || busy}
        >
          恢复「实现任务」默认模板
        </button>

        {error && <p className="dialog-error">{error}</p>}

        <footer className="dialog-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onSave()}
            disabled={!settings || busy}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </footer>
      </div>
    </div>
  );
}
