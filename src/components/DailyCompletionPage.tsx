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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatBackendError } from "../i18n";
import { formatLogTime } from "../lib/logDiaryFormat";
import { useLanguage } from "../contexts/LanguageContext";
import { Copy, ImageIcon, MoreHorizontal } from "lucide-react";

type Period = "today" | "week" | "sevenDays";

const DEFAULT_DAILY_TIME = "00:00";

const PERIODS = [
  {
    id: "today",
    labelKey: "todayAction", subtitleKey: "todaySubtitle",
  },
  {
    id: "week",
    labelKey: "weekAction", subtitleKey: "weekSubtitle",
  },
  {
    id: "sevenDays",
    labelKey: "sevenDaysAction", subtitleKey: "sevenDaysSubtitle",
  },
] as const satisfies readonly {
  id: Period;
  labelKey: "todayAction" | "weekAction" | "sevenDaysAction";
  subtitleKey: "todaySubtitle" | "weekSubtitle" | "sevenDaysSubtitle";
}[];

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char);
}

/** 兼容旧日志：去掉正文里的时间范围行。 */
function normalizeBody(text: string): string {
  return text
    .replace(/^时间范围[：:].*\n*/m, "")
    .replace(/^Period[：:].*\n*/im, "")
    .trim();
}

/** 卡片标题：优先用后端日期标题；旧日志尽量从正文推日期。 */
function cardTitle(entry: LogDiaryEntry): string {
  if (/^\d{4}\/\d{2}\/\d{2}( – \d{4}\/\d{2}\/\d{2})?$/.test(entry.title.trim())) {
    return entry.title.trim();
  }
  const first = entry.detail.split("\n").find((line) => line.trim())?.trim() ?? "";
  const zh = first.match(/^时间范围[：:]\s*(\d+)月(\d+)日/);
  if (zh) {
    const year = new Date(entry.createdAt).getFullYear();
    return `${year}/${zh[1].padStart(2, "0")}/${zh[2].padStart(2, "0")}`;
  }
  return entry.title;
}

function buildShareImage(title: string, summary: string, footer: string, qr: string) {
  const lines = normalizeBody(summary)
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean)
    .flatMap((line) => (line.length > 18 ? [line.slice(0, 18), line.slice(18, 36)] : [line]))
    .slice(0, 8);
  const seed = Array.from(`${title}${summary}`).reduce((total, char) => total + char.charCodeAt(0), 0);
  const squares = Array.from({ length: 17 * 17 }, (_, index) => ((seed * (index + 3) + index * index) % 7) < 3)
    .map((filled, index) => (filled ? `<rect x="${index % 17}" y="${Math.floor(index / 17)}" width="1" height="1"/>` : ""))
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440">
    <rect width="1080" height="1440" fill="#f6f4ef"/><rect x="48" y="48" width="984" height="1344" rx="46" fill="#ffffff"/>
    <text x="110" y="160" fill="#236e96" font-size="42" font-family="Arial, sans-serif" font-weight="700">Git Tracker</text>
    <text x="110" y="285" fill="#18222a" font-size="74" font-family="Arial, sans-serif" font-weight="700">${escapeXml(title)}</text>
    <line x1="110" y1="338" x2="970" y2="338" stroke="#d9e2e5" stroke-width="3"/>
    ${lines.map((line, index) => `<text x="130" y="${420 + index * 78}" fill="#34444e" font-size="38" font-family="Arial, sans-serif">${escapeXml(line)}</text>`).join("")}
    <g transform="translate(748 1085) scale(13)" fill="#18222a"><rect x="0" y="0" width="21" height="21" fill="#fff"/>${squares}</g>
    <text x="110" y="1290" fill="#77858d" font-size="30" font-family="Arial, sans-serif">${escapeXml(footer)}</text>
    <text x="748" y="1380" fill="#77858d" font-size="24" font-family="Arial, sans-serif">${escapeXml(qr)}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

interface Props {
  entries: LogDiaryEntry[];
  onToast: (message: string) => void;
  onGenerate: (
    period: Period,
    onResult: (result: { title: string; body: string }) => void,
    onComplete?: () => void,
  ) => void;
}

export function DailyCompletionPage({ entries, onToast, onGenerate }: Props) {
  const { t } = useTranslation(["projects", "common", "errors"]);
  const { language } = useLanguage();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingEnable, setPendingEnable] = useState(false);
  const [draftTime, setDraftTime] = useState(DEFAULT_DAILY_TIME);
  const [imageDialog, setImageDialog] = useState<{ title: string; image: string } | null>(null);

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
    setLoading(true);
    onGenerate(
      period,
      () => {
        /* 结果由日志历史承载，刷新后自动出现在下方 */
      },
      () => setLoading(false),
    );
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast(t("projects:daily.copied"));
    } catch {
      onToast(t("projects:daily.copyFailed"));
    }
  };

  const openImageDialog = (title: string, body: string) => {
    setImageDialog({
      title,
      image: buildShareImage(title, body, t("projects:daily.imageFooter"), t("projects:daily.imageQr")),
    });
  };

  const saveImage = () => {
    if (!imageDialog) return;
    const link = document.createElement("a");
    link.href = imageDialog.image;
    link.download = `git-tracker-${imageDialog.title.replace(/\s+/g, "-")}.svg`;
    link.click();
    onToast(t("projects:daily.imageSaved"));
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
            const title = cardTitle(entry);
            const body = normalizeBody(entry.detail);
            return (
              <Card key={entry.id} className="gap-0 py-4">
                <CardHeader className="flex-row items-start justify-between gap-3 px-4 pb-3">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="text-sm font-medium">{title}</CardTitle>
                    <CardDescription className="text-xs">
                      {formatLogTime(entry.createdAt, language)}
                    </CardDescription>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0"
                        aria-label={t("projects:daily.moreActions")}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem onClick={() => void copyText(body)}>
                        <Copy className="size-4" />
                        {t("projects:daily.copy")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openImageDialog(title, body)}>
                        <ImageIcon className="size-4" />
                        {t("projects:daily.generateImage")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent className="px-4">
                  <pre className="select-text whitespace-pre-wrap text-sm text-muted-foreground">{body}</pre>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <Dialog open={Boolean(imageDialog)} onOpenChange={(open) => !open && setImageDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("projects:daily.imageDialogTitle")}</DialogTitle>
            <DialogDescription>{t("projects:daily.imageDialogDescription")}</DialogDescription>
          </DialogHeader>
          {imageDialog && (
            <img
              src={imageDialog.image}
              alt={t("projects:daily.imageAlt", { title: imageDialog.title })}
              className="w-full rounded-md border border-border"
            />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setImageDialog(null)}>
              {t("common:actions.cancel")}
            </Button>
            <Button type="button" onClick={saveImage}>
              {t("projects:daily.saveImage")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
