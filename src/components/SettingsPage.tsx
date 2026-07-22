import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { useLanguage } from "../contexts/LanguageContext";
import { formatBackendError } from "../i18n";
import type { AiPanelSession } from "../lib/aiPanel";
import { HelpTip } from "./HelpTip";
import { ThemeModePicker } from "./ThemeModePicker";
import type { AiProvider, AppLanguagePreference, AppSettings } from "../types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Props {
  onSaved: (msg: string) => void;
  openAiSession: (session: AiPanelSession) => void;
}

const PROVIDERS: {
  id: AiProvider;
  title: string;
  descKey: "provider.codexDescription" | "provider.cursorDescription";
}[] = [
  {
    id: "codex",
    title: "Codex CLI",
    descKey: "provider.codexDescription",
  },
  {
    id: "cursorAgent",
    title: "Cursor Agent CLI",
    descKey: "provider.cursorDescription",
  },
];

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

export function SettingsPage({ onSaved, openAiSession }: Props) {
  const { t } = useTranslation(["settings", "common", "errors"]);
  const { preference, language, setPreference } = useLanguage();
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
        setError(formatBackendError(e, t));
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
      outputLanguage: language,
      onResult: (ok, detail) => {
        setTestingId(null);
        if (ok) {
          setTestStatus((prev) => ({ ...prev, [provider]: { kind: "ok" } }));
        } else {
          setTestStatus((prev) => ({
            ...prev,
            [provider]: {
              kind: "error",
              message: detail ?? t("settings:provider.testFailed"),
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
      onSaved(t("settings:provider.saved", { provider: label }));
    } catch (e) {
      setError(formatBackendError(e, t));
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || testingId !== null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => void onSave()} disabled={!settings || busy}>
          {saving ? t("common:actions.saving") : t("common:actions.save")}
        </Button>
      </div>

      <Tabs defaultValue="appearance">
        <TabsList>
          <TabsTrigger value="appearance">{t("settings:tabs.appearance")}</TabsTrigger>
          <TabsTrigger value="provider">AI Provider</TabsTrigger>
          <TabsTrigger value="prompts">{t("settings:tabs.prompts")}</TabsTrigger>
          <TabsTrigger value="summary">{t("settings:tabs.summary")}</TabsTrigger>
        </TabsList>

        <TabsContent value="appearance" className="mt-4">
          <Card className="gap-0 py-4">
            <CardHeader className="px-4 pb-3">
              <CardTitle className="text-sm font-medium">{t("settings:appearance.theme")}</CardTitle>
              <CardDescription className="text-xs">
                {t("settings:appearance.themeDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4">
              <ThemeModePicker />
            </CardContent>
          </Card>

          <Card className="mt-3 gap-0 py-4">
            <CardHeader className="px-4 pb-3">
              <CardTitle className="text-sm font-medium">{t("settings:appearance.language")}</CardTitle>
              <CardDescription className="text-xs">{t("settings:appearance.languageDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="px-4">
              <RadioGroup
                value={preference}
                onValueChange={(value) => {
                  const next = value as AppLanguagePreference;
                  setError(null);
                  void setPreference(next)
                    .then(() => setSettings((previous) => previous ? { ...previous, language: next } : previous))
                    .catch((error) => setError(formatBackendError(error, t)));
                }}
                className="grid gap-2 sm:grid-cols-3"
                aria-label={t("settings:appearance.language")}
              >
                {(["system", "zh-CN", "en"] as const).map((value) => (
                  <label key={value} htmlFor={`language-${value}`} className="flex cursor-pointer items-center gap-2 rounded-md border border-border p-3 hover:bg-accent/20">
                    <RadioGroupItem id={`language-${value}`} value={value} />
                    <span className="text-sm">{t(`common:languageName.${value}`)}</span>
                  </label>
                ))}
              </RadioGroup>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="provider" className="mt-4 space-y-3">
          <Card className="gap-0 py-4">
            <CardHeader className="px-4 pb-3">
              <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
                {t("settings:provider.title")}
                <HelpTip text={t("settings:provider.help")} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-4">
              <div role="radiogroup" aria-label={t("settings:provider.aria")} className="space-y-2">
                {PROVIDERS.map((p) => {
                  const selected = settings?.aiProvider === p.id;
                  const status = testStatus[p.id];
                  const thisTesting = testingId === p.id;
                  return (
                    <div
                      key={p.id}
                      className={cn(
                        "rounded-md border p-3 transition-colors",
                        selected
                          ? "border-primary bg-accent/30"
                          : "border-border hover:bg-accent/20",
                      )}
                    >
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="radio"
                          name="aiProvider"
                          value={p.id}
                          checked={selected}
                          onChange={() => onSelect(p.id)}
                          disabled={!settings || busy}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{p.title}</div>
                          <p className="mt-1 text-xs text-muted-foreground">{t(`settings:${p.descKey}`)}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => onTest(p.id)}
                              disabled={!settings || busy}
                            >
                              {thisTesting ? t("common:actions.testing") : t("common:actions.test")}
                            </Button>
                            {status.kind === "running" && (
                              <span className="text-xs text-muted-foreground">{t("common:actions.testing")}</span>
                            )}
                            {status.kind === "ok" && (
                              <span className="text-xs text-emerald-400" role="status">
                                {t("settings:provider.testSuccess")}
                              </span>
                            )}
                            {status.kind === "error" && (
                              <span className="text-xs text-destructive" role="alert">
                                ✕ {status.message}
                              </span>
                            )}
                          </div>
                        </div>
                      </label>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prompts" className="mt-4 space-y-3">
          <Card className="gap-0 py-4">
            <CardHeader className="px-4 pb-3">
              <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
                {t("settings:prompts.goalTitle")}
                <HelpTip text={t("settings:prompts.goalHelp")} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-4">
              <Textarea
                className="min-h-[120px] font-mono text-xs"
                value={settings?.promptTemplates[language].goal ?? ""}
                onChange={(e) =>
                  setSettings((prev) =>
                    prev ? { ...prev, promptTemplates: { ...prev.promptTemplates, [language]: { ...prev.promptTemplates[language], goal: e.target.value } } } : prev,
                  )
                }
                disabled={!settings || busy}
                rows={8}
              />
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-xs"
                onClick={() =>
                  void api.getDefaultPromptTemplates(language)
                    .then((defaults) => setSettings((prev) => prev ? { ...prev, promptTemplates: { ...prev.promptTemplates, [language]: { ...prev.promptTemplates[language], goal: defaults.goal } } } : prev))
                    .catch((resetError) => setError(formatBackendError(resetError, t)))
                }
                disabled={!settings || busy}
              >
                {t("settings:prompts.goalReset")}
              </Button>
            </CardContent>
          </Card>

          <Card className="gap-0 py-4">
            <CardHeader className="px-4 pb-3">
              <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
                {t("settings:prompts.taskTitle")}
                <HelpTip text={t("settings:prompts.taskHelp")} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-4">
              <Textarea
                className="min-h-[120px] font-mono text-xs"
                value={settings?.promptTemplates[language].task ?? ""}
                onChange={(e) =>
                  setSettings((prev) =>
                    prev ? { ...prev, promptTemplates: { ...prev.promptTemplates, [language]: { ...prev.promptTemplates[language], task: e.target.value } } } : prev,
                  )
                }
                disabled={!settings || busy}
                rows={6}
              />
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-xs"
                onClick={() =>
                  void api.getDefaultPromptTemplates(language)
                    .then((defaults) => setSettings((prev) => prev ? { ...prev, promptTemplates: { ...prev.promptTemplates, [language]: { ...prev.promptTemplates[language], task: defaults.task } } } : prev))
                    .catch((resetError) => setError(formatBackendError(resetError, t)))
                }
                disabled={!settings || busy}
              >
                {t("settings:prompts.taskReset")}
              </Button>
            </CardContent>
          </Card>
          <Card className="gap-0 py-4">
            <CardHeader className="px-4 pb-3"><CardTitle className="flex items-center gap-1.5 text-sm font-medium">{t("settings:prompts.documentExecuteTitle")}<HelpTip text={t("settings:prompts.documentExecuteHelp")} /></CardTitle></CardHeader>
            <CardContent className="space-y-2 px-4">
              <Textarea className="min-h-20 font-mono text-xs" value={settings?.promptTemplates[language].documentExecute ?? ""} onChange={(e) => setSettings((prev) => prev ? { ...prev, promptTemplates: { ...prev.promptTemplates, [language]: { ...prev.promptTemplates[language], documentExecute: e.target.value } } } : prev)} disabled={!settings || busy} rows={3} />
              <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => void api.getDefaultPromptTemplates(language).then((defaults) => setSettings((prev) => prev ? { ...prev, promptTemplates: { ...prev.promptTemplates, [language]: { ...prev.promptTemplates[language], documentExecute: defaults.documentExecute } } } : prev)).catch((resetError) => setError(formatBackendError(resetError, t)))} disabled={!settings || busy}>{t("settings:prompts.documentExecuteReset")}</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="summary" className="mt-4">
          <Card className="gap-0 py-4">
            <CardHeader className="px-4 pb-3">
              <CardTitle className="text-sm font-medium">{t("settings:summary.title")}</CardTitle>
              <CardDescription className="text-xs">
                {t("settings:summary.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 px-4">
              <Label htmlFor="dailyCompletionTime" className="text-sm">
                {t("settings:summary.time")}
              </Label>
              <Input
                id="dailyCompletionTime"
                type="time"
                className="w-auto"
                value={settings?.dailyCompletionTime ?? "00:00"}
                disabled={!settings || busy}
                onChange={(e) =>
                  setSettings((prev) =>
                    prev ? { ...prev, dailyCompletionTime: e.target.value } : prev,
                  )
                }
              />
              <p className="text-xs text-muted-foreground">
                {t("settings:summary.hint")}
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
