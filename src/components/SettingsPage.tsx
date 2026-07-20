import { useEffect, useState } from "react";
import { api } from "../api";
import type { AiPanelSession } from "../lib/aiPanel";
import { HelpTip } from "./HelpTip";
import type { AiProvider, AppSettings } from "../types";
import "./SettingsPage.css";

interface Props {
  onSaved: (msg: string) => void;
  openAiSession: (session: AiPanelSession) => void;
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
  | { kind: "ok" }
  | { kind: "error"; message: string };

type TestStatusMap = Record<AiProvider, TestStatus>;

const IDLE_TESTS: TestStatusMap = {
  codex: { kind: "idle" },
  cursorAgent: { kind: "idle" },
};

function formatTestError(err: unknown): string {
  const raw = String(err);
  return raw.replace(/^Error:\s*/i, "").trim() || "未知错误";
}

export function SettingsPage({ onSaved, openAiSession }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<AiProvider | null>(null);
  const [testStatus, setTestStatus] = useState<TestStatusMap>(IDLE_TESTS);
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

  const onTest = (provider: AiProvider) => {
    if (!settings || testingId) return;
    setTestingId(provider);
    setError(null);
    setTestStatus((prev) => ({ ...prev, [provider]: { kind: "running" } }));
    openAiSession({
      kind: "testConnection",
      provider,
      onResult: (ok, detail) => {
        setTestingId(null);
        if (ok) {
          setTestStatus((prev) => ({ ...prev, [provider]: { kind: "ok" } }));
        } else {
          setTestStatus((prev) => ({
            ...prev,
            [provider]: {
              kind: "error",
              message: formatTestError(detail ?? "测试失败"),
            },
          }));
        }
      },
    });
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
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || testingId !== null;

  return (
    <div className="settings-page">
      <div className="settings-page-toolbar">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void onSave()}
          disabled={!settings || busy}
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>

      <section className="settings-section">
        <h3 className="settings-section-title">
          AI 调用通道
          <HelpTip text="生成 Commit、生成任务、实现任务等所有 AI 能力都会走此处选择的 CLI，不会混用。" />
        </h3>

        <div className="provider-list" role="radiogroup" aria-label="AI 调用通道">
          {PROVIDERS.map((p) => {
            const selected = settings?.aiProvider === p.id;
            const status = testStatus[p.id];
            const thisTesting = testingId === p.id;
            return (
              <div
                key={p.id}
                className={`provider-option${selected ? " is-selected" : ""}`}
              >
                <label className="provider-option-main">
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

                <div className="provider-test">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onTest(p.id)}
                    disabled={!settings || busy}
                  >
                    {thisTesting ? "测试中…" : "测试"}
                  </button>
                  {status.kind === "running" && (
                    <span className="provider-test-result is-running">测试中…</span>
                  )}
                  {status.kind === "ok" && (
                    <span className="provider-test-result is-ok" role="status">
                      <span className="provider-test-icon" aria-hidden="true">
                        ✓
                      </span>
                      测试成功
                    </span>
                  )}
                  {status.kind === "error" && (
                    <span className="provider-test-result is-error" role="alert">
                      <span className="provider-test-icon" aria-hidden="true">
                        ✕
                      </span>
                      <span className="provider-test-fail-copy">
                        <span className="provider-test-fail-title">测试失败</span>
                        <span className="provider-test-fail-reason">{status.message}</span>
                      </span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">
          生成任务 · 提示词模板
          <HelpTip text="点「生成任务」时：模板 + goal.md + 项目现状 → AI" />
        </h3>
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
          onClick={() =>
            setSettings((prev) =>
              prev ? { ...prev, goalPromptTemplate: DEFAULT_GOAL } : prev,
            )
          }
          disabled={!settings || busy}
        >
          恢复「生成任务」默认模板
        </button>
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">
          实现任务 · 提示词模板
          <HelpTip text="点「⋯ → 实现」时使用；AI 会在项目目录改代码" />
        </h3>
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
      </section>

      {error && <p className="settings-error">{error}</p>}
    </div>
  );
}
