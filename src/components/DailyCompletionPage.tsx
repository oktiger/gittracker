import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import type { AppSettings, LogDiaryEntry } from "../types";
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
import { Switch } from "@/components/ui/switch";
import { formatBackendError } from "../i18n";
import { formatLogTime } from "../lib/logDiaryFormat";
import { useLanguage } from "../contexts/LanguageContext";
import { Copy } from "lucide-react";

type Period = "today" | "week" | "sevenDays";

const DEFAULT_DAILY_TIME = "00:00";

const PERIODS = [
  {
    id: "today",
    labelKey: "todayAction", cardTitleKey: "todayTitle", subtitleKey: "todaySubtitle",
  },
  {
    id: "week",
    labelKey: "weekAction", cardTitleKey: "weekTitle", subtitleKey: "weekSubtitle",
  },
  {
    id: "sevenDays",
    labelKey: "sevenDaysAction", cardTitleKey: "sevenDaysTitle", subtitleKey: "sevenDaysSubtitle",
  },
] as const satisfies readonly {
  id: Period;
  labelKey: "todayAction" | "weekAction" | "sevenDaysAction";
  cardTitleKey: "todayTitle" | "weekTitle" | "sevenDaysTitle";
  subtitleKey: "todaySubtitle" | "weekSubtitle" | "sevenDaysSubtitle";
}[];

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char);
}

function extractRangeLabel(summary: string): string | null {
  const first = summary.split("\n").find((line) => line.trim())?.trim() ?? "";
  const zh = first.match(/^时间范围[：:]\s*(.+)$/);
  if (zh?.[1]) return zh[1].trim();
  const en = first.match(/^Period[：:]\s*(.+)$/i);
  if (en?.[1]) return en[1].trim();
  return null;
}

function buildShareImage(title: string, summary: string, footer: string, qr: string) {
  const lines = summary
    .replace(/^时间范围[：:].*$/m, "")
    .replace(/^Period[：:].*$/im, "")
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean)
    .flatMap((line) => (line.length > 18 ? [line.slice(0, 18), line.slice(18, 36)] : [line]))
    .slice(0, 8);
  const seed = Array.from(`${title}${summary}`).reduce((total, char) => total + char.charCodeAt(0), 0);
  const squares = Array.from({ length: 17 * 17 }, (_, index) => ((seed * (index + 3) + index * index) % 7) < 3)
    .map((filled, index) => filled ? `<rect x="${index % 17}" y="${Math.floor(index / 17)}" width="1" height="1"/>` : "")
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440">
    <rect width="1080" height="1440" fill="#f6f4ef"/><rect x="48" y="48" width="984" height="1344" rx="46" fill="#ffffff"/>
    <text x="110" y="160" fill="#236e96" font-size="42" font-family="Arial, sans-serif" font-weight="700">Git Tracker</text>
    <text x="110" y="285" fill="#18222a" font-size="74" font-family="Arial, sans-serif" font-weight="700">${escapeXml(title)}</text>
    <line x1="110" y1="338" x2="970" y2="338" stroke="#d9e2e5" stroke-width="3"/>
    ${lines.map((line, index) => `<text x="130" y="${420 + index * 78}" fill="#34444e" font-size="${line.startsWith("-") || /^[•·]/.test(line) ? 36 : 40}" font-family="Arial, sans-serif" font-weight="${/^[•·-]/.test(line) || line.includes("：") || line.includes(":") ? 400 : 700}">${escapeXml(line.startsWith("-") ? `• ${line.slice(1).trim()}` : line)}</text>`).join("")}
    <g transform="translate(748 1085) scale(13)" fill="#18222a"><rect x="0" y="0" width="21" height="21" fill="#fff"/>${squares}</g>
    <text x="110" y="1290" fill="#77858d" font-size="30" font-family="Arial, sans-serif">${escapeXml(footer)}</text>
    <text x="748" y="1380" fill="#77858d" font-size="24" font-family="Arial, sans-serif">${escapeXml(qr)}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

interface Props {
  entries: LogDiaryEntry[];
  onToast: (message: string) => void;
  onGenerate: (period: Period, onResult: (summary: string) => void, onComplete?: () => void) => void;
}

export function DailyCompletionPage({ entries, onToast, onGenerate }: Props) {
  const { t } = useTranslation(["projects", "common", "errors"]);
  const { language } = useLanguage();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingEnable, setPendingEnable] = useState(false);
  const [draftTime, setDraftTime] = useState(DEFAULT_DAILY_TIME);
  const [preview, setPreview] = useState<{ title: string; summary: string; image: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const history = useMemo(
    () =>
      entries
        .filter((entry) => entry.kind === "dailyCompletion" && entry.status === "ok" && entry.detail?.trim())
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt),
    [entries],
  );

  useEffect(() => {
    void api.getSettings().then(setSettings).catch((error) => onToast(formatBackendError(error, t)));
  }, [onToast, t]);

  useEffect(() => {
    if (settings && !pendingEnable) {
      setDraftTime(settings.dailyCompletionTime || DEFAULT_DAILY_TIME);
    }
  }, [settings, pendingEnable]);

  const enabled = settings?.dailyCompletionEnabled ?? false;
  const switchChecked = pendingEnable || enabled;
  const timeDirty = draftTime !== (settings?.dailyCompletionTime || DEFAULT_DAILY_TIME);
  const showTimePicker = switchChecked;
  const showConfirmActions = pendingEnable || (enabled && timeDirty);

  const saveSettings = async (next: AppSettings) => {
    setSaving(true);
    try {
      const saved = await api.updateSettings(next);
      setSettings(saved);
      setPendingEnable(false);
      onToast(
        saved.dailyCompletionEnabled
          ? t("projects:daily.enabledToast", { time: saved.dailyCompletionTime })
          : t("projects:daily.disabledToast"),
      );
    } catch (error) {
      onToast(formatBackendError(error, t));
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchChange = (checked: boolean) => {
    if (!settings || saving) return;
    if (checked) {
      setDraftTime(DEFAULT_DAILY_TIME);
      setPendingEnable(true);
      return;
    }
    setPendingEnable(false);
    if (enabled) {
      void saveSettings({ ...settings, dailyCompletionEnabled: false });
    }
  };

  const confirmSchedule = () => {
    if (!settings) return;
    void saveSettings({
      ...settings,
      dailyCompletionEnabled: true,
      dailyCompletionTime: draftTime || DEFAULT_DAILY_TIME,
    });
  };

  const cancelPending = () => {
    setPendingEnable(false);
    setDraftTime(settings?.dailyCompletionTime || DEFAULT_DAILY_TIME);
  };

  const generate = (period: Period) => {
    const option = PERIODS.find((item) => item.id === period)!;
    setLoading(true);
    onGenerate(
      period,
      (summary) => {
        const range = extractRangeLabel(summary);
        const title = range
          ? `${t(`projects:daily.${option.cardTitleKey}`)} · ${range}`
          : t(`projects:daily.${option.cardTitleKey}`);
        setPreview({
          title,
          summary,
          image: buildShareImage(title, summary, t("projects:daily.imageFooter"), t("projects:daily.imageQr")),
        });
      },
      () => setLoading(false),
    );
  };

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      onToast(t("projects:daily.copied"));
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1600);
    } catch {
      onToast(t("projects:daily.copyFailed"));
    }
  };

  const download = (title: string, image: string) => {
    const link = document.createElement("a");
    link.href = image;
    link.download = `git-tracker-${title}.svg`;
    link.click();
  };

  const cardTitleForEntry = (entry: LogDiaryEntry) => {
    const range = extractRangeLabel(entry.detail);
    return range ?? entry.title;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card className="gap-0 py-4">
        <div className="flex flex-row items-center justify-between gap-4 px-4">
          <CardHeader className="flex-1 px-0 py-0">
            <CardTitle className="text-sm font-medium">{t("projects:daily.autoTitle")}</CardTitle>
            <CardDescription className="text-xs">
              {t("projects:daily.autoDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-2 px-0 py-0">
            <Switch
              id="daily-completion-enabled"
              checked={switchChecked}
              disabled={!settings || saving}
              onCheckedChange={handleSwitchChange}
            />
            <Label htmlFor="daily-completion-enabled" className="text-xs font-medium">
              {switchChecked ? t("projects:daily.enabled") : t("projects:daily.disabled")}
            </Label>
          </CardContent>
        </div>

        {showTimePicker && (
          <CardContent className="mt-4 space-y-3 border-t border-border px-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="daily-completion-time" className="text-sm">
                {t("projects:daily.timeLabel")}
              </Label>
              <Input
                id="daily-completion-time"
                type="time"
                className="w-auto"
                value={draftTime}
                disabled={!settings || saving}
                onChange={(e) => setDraftTime(e.target.value || DEFAULT_DAILY_TIME)}
              />
              <p className="text-xs text-muted-foreground">{t("projects:daily.timeHint")}</p>
            </div>
            {showConfirmActions && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={cancelPending}
                >
                  {t("common:actions.cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!settings || saving || !draftTime}
                  onClick={confirmSchedule}
                >
                  {t("common:actions.confirm")}
                </Button>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        {PERIODS.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={loading}
            onClick={() => generate(item.id)}
            className="rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent/40 disabled:opacity-50"
          >
            <div className="text-sm font-medium">
              {loading ? t("projects:daily.generating") : t(`projects:daily.${item.labelKey}`)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{t(`projects:daily.${item.subtitleKey}`)}</div>
          </button>
        ))}
      </div>

      {preview && (
        <Card className="gap-0 py-4">
          <CardHeader className="flex-row items-start justify-between gap-3 px-4 pb-3">
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-sm font-medium">
                {preview.title} · {t("projects:daily.preview")}
              </CardTitle>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void copyText("preview", preview.summary)}
              >
                <Copy className="size-3.5" />
                {copiedId === "preview" ? t("projects:daily.copied") : t("projects:daily.copy")}
              </Button>
              <Button type="button" variant="outline" size="xs" onClick={() => download(preview.title, preview.image)}>
                {t("projects:daily.download")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 px-4">
            <pre className="select-text whitespace-pre-wrap text-sm text-muted-foreground">{preview.summary}</pre>
            <img
              src={preview.image}
              alt={t("projects:daily.imageAlt", { title: preview.title })}
              className="w-full max-w-sm rounded-md border border-border"
            />
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <div className="flex items-end justify-between gap-3 px-0.5">
          <div>
            <h3 className="text-sm font-medium">{t("projects:daily.historyTitle")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t("projects:daily.historyDescription")}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {history.length > 0 ? t("projects:daily.historyCount", { count: history.length }) : null}
          </p>
        </div>

        {history.length === 0 ? (
          <Card className="gap-0 py-8">
            <CardContent className="px-4 text-center text-sm text-muted-foreground">
              {t("projects:daily.empty")}
            </CardContent>
          </Card>
        ) : (
          history.map((entry) => {
            const title = cardTitleForEntry(entry);
            const image = buildShareImage(
              title,
              entry.detail,
              t("projects:daily.imageFooter"),
              t("projects:daily.imageQr"),
            );
            return (
              <Card key={entry.id} className="gap-0 py-4">
                <CardHeader className="flex-row items-start justify-between gap-3 px-4 pb-3">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="text-sm font-medium">{title}</CardTitle>
                    <CardDescription className="text-xs">
                      {formatLogTime(entry.createdAt, language)} · {entry.title}
                    </CardDescription>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => void copyText(entry.id, entry.detail)}
                    >
                      <Copy className="size-3.5" />
                      {copiedId === entry.id ? t("projects:daily.copied") : t("projects:daily.copy")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => download(title, image)}
                    >
                      {t("projects:daily.download")}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="px-4">
                  <pre className="select-text whitespace-pre-wrap text-sm text-muted-foreground">{entry.detail}</pre>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
