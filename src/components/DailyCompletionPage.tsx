import { useEffect, useState } from "react";
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

type Period = "today" | "week" | "sevenDays";

const PERIODS: {
  id: Period;
  label: string;
  cardTitle: string;
  subtitle: string;
}[] = [
  {
    id: "today",
    label: "本日做了什么",
    cardTitle: "今日完成",
    subtitle: "生成今日总结卡片",
  },
  {
    id: "week",
    label: "本周做了什么",
    cardTitle: "本周完成",
    subtitle: "按自然周汇总",
  },
  {
    id: "sevenDays",
    label: "过去 7 天做了什么",
    cardTitle: "过去 7 天完成",
    subtitle: "滚动 7 日窗口",
  },
];

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char);
}

function buildShareImage(title: string, summary: string) {
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
    <text x="110" y="1290" fill="#77858d" font-size="30" font-family="Arial, sans-serif">由 Git Tracker 根据提交记录生成</text>
    <text x="748" y="1380" fill="#77858d" font-size="24" font-family="Arial, sans-serif">扫码关注 Git Tracker</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

interface Props {
  onToast: (message: string) => void;
  onGenerate: (period: Period, onResult: (summary: string) => void) => void;
}

export function DailyCompletionPage({ onToast, onGenerate }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ title: string; summary: string; image: string } | null>(null);

  useEffect(() => {
    void api.getSettings().then(setSettings).catch((error) => onToast(`读取设置失败：${String(error)}`));
  }, [onToast]);

  const saveSettings = async (next: AppSettings) => {
    const saved = await api.updateSettings(next);
    setSettings(saved);
    onToast(saved.dailyCompletionEnabled ? `已开启每日 ${saved.dailyCompletionTime} 自动生成` : "已关闭每日自动生成");
  };

  const generate = async (period: Period) => {
    const option = PERIODS.find((item) => item.id === period)!;
    setLoading(true);
    onGenerate(period, (summary) => {
      setResult({ title: option.cardTitle, summary, image: buildShareImage(option.cardTitle, summary) });
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
          <CardTitle className="text-sm font-medium">每日自动生成总结</CardTitle>
          <CardDescription className="text-xs">
            汇总已配置项目的 commit message，并生成可分享的工作总结。
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
            {settings?.dailyCompletionEnabled ? "已开启" : "已关闭"}
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
              {loading ? "生成中…" : item.label}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{item.subtitle}</div>
          </button>
        ))}
      </div>

      {result && (
        <Card className="gap-0 py-4">
          <CardHeader className="flex-row items-center justify-between px-4 pb-3">
            <CardTitle className="text-sm font-medium">{result.title} · 预览</CardTitle>
            <Button type="button" variant="outline" size="xs" onClick={download}>
              下载 SVG
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 px-4">
            <pre className="whitespace-pre-wrap text-sm text-muted-foreground">{result.summary}</pre>
            <img
              src={result.image}
              alt={`${result.title}的 Git Tracker 分享图片`}
              className="w-full max-w-sm rounded-md border border-border"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
