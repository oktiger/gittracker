import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import type { AppSettings } from "../types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatBackendError } from "../i18n";

type Period = "today" | "week" | "sevenDays";

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

function buildShareImage(title: string, summary: string, footer: string, qr: string) {
  const lines = summary.replace(/^-\s*/gm, "").split("\n").filter(Boolean).flatMap((line) => {
    const words = line.trim();
    return words.length > 18 ? [words.slice(0, 18), words.slice(18, 36)] : [words];
  }).slice(0, 6);
  const seed = Array.from(`${title}${summary}`).reduce((total, char) => total + char.charCodeAt(0), 0);
  const squares = Array.from({ length: 17 * 17 }, (_, index) => ((seed * (index + 3) + index * index) % 7) < 3)
    .map((filled, index) => filled ? `<rect x="${index % 17}" y="${Math.floor(index / 17)}" width="1" height="1"/>` : "")
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440">
    <rect width="1080" height="1440" fill="#f6f4ef"/><rect x="48" y="48" width="984" height="1344" rx="46" fill="#ffffff"/>
    <text x="110" y="160" fill="#236e96" font-size="42" font-family="Arial, sans-serif" font-weight="700">Git Tracker</text>
    <text x="110" y="285" fill="#18222a" font-size="74" font-family="Arial, sans-serif" font-weight="700">${escapeXml(title)}</text>
    <line x1="110" y1="338" x2="970" y2="338" stroke="#d9e2e5" stroke-width="3"/>
    ${lines.map((line, index) => `<text x="130" y="${440 + index * 92}" fill="#34444e" font-size="42" font-family="Arial, sans-serif">• ${escapeXml(line)}</text>`).join("")}
    <g transform="translate(748 1085) scale(13)" fill="#18222a"><rect x="0" y="0" width="21" height="21" fill="#fff"/>${squares}</g>
    <text x="110" y="1290" fill="#77858d" font-size="30" font-family="Arial, sans-serif">${escapeXml(footer)}</text>
    <text x="748" y="1380" fill="#77858d" font-size="24" font-family="Arial, sans-serif">${escapeXml(qr)}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

interface Props {
  onToast: (message: string) => void;
  onGenerate: (period: Period, onResult: (summary: string) => void) => void;
}

export function DailyCompletionPage({ onToast, onGenerate }: Props) {
  const { t } = useTranslation(["projects", "common", "errors"]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ title: string; summary: string; image: string } | null>(null);

  useEffect(() => {
    void api.getSettings().then(setSettings).catch((error) => onToast(formatBackendError(error, t)));
  }, [onToast]);

  const saveSettings = async (next: AppSettings) => {
    const saved = await api.updateSettings(next);
    setSettings(saved);
    onToast(saved.dailyCompletionEnabled ? t("projects:daily.enabledToast", { time: saved.dailyCompletionTime }) : t("projects:daily.disabledToast"));
  };

  const generate = async (period: Period) => {
    const option = PERIODS.find((item) => item.id === period)!;
    setLoading(true);
    onGenerate(period, (summary) => {
      const title = t(`projects:daily.${option.cardTitleKey}`);
      setResult({ title, summary, image: buildShareImage(title, summary, t("projects:daily.imageFooter"), t("projects:daily.imageQr")) });
      setLoading(false);
    });
  };

  const download = () => {
    if (!result) return;
    const link = document.createElement("a");
    link.href = result.image;
    link.download = `git-tracker-${result.title}.svg`;
    link.click();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card className="flex-row items-center justify-between gap-4 py-4">
        <CardHeader className="flex-1 px-4 py-0">
          <CardTitle className="text-sm font-medium">{t("projects:daily.autoTitle")}</CardTitle>
          <CardDescription className="text-xs">
            {t("projects:daily.autoDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-2 px-4 py-0">
          <Switch
            id="daily-completion-enabled"
            checked={settings?.dailyCompletionEnabled ?? false}
            disabled={!settings}
            onCheckedChange={(checked) =>
              settings && void saveSettings({ ...settings, dailyCompletionEnabled: checked })
            }
          />
          <Label htmlFor="daily-completion-enabled" className="text-xs font-medium">
            {settings?.dailyCompletionEnabled ? t("projects:daily.enabled") : t("projects:daily.disabled")}
          </Label>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        {PERIODS.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={loading}
            onClick={() => void generate(item.id)}
            className="rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent/40 disabled:opacity-50"
          >
            <div className="text-sm font-medium">
              {loading ? t("projects:daily.generating") : t(`projects:daily.${item.labelKey}`)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{t(`projects:daily.${item.subtitleKey}`)}</div>
          </button>
        ))}
      </div>

      {result && (
        <Card className="gap-0 py-4">
          <CardHeader className="flex-row items-center justify-between px-4 pb-3">
            <CardTitle className="text-sm font-medium">{result.title} · {t("projects:daily.preview")}</CardTitle>
            <Button type="button" variant="outline" size="xs" onClick={download}>
              {t("projects:daily.download")}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 px-4">
            <pre className="whitespace-pre-wrap text-sm text-muted-foreground">{result.summary}</pre>
            <img
              src={result.image}
              alt={t("projects:daily.imageAlt", { title: result.title })}
              className="w-full max-w-sm rounded-md border border-border"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
