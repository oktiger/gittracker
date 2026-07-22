import type { ResolvedLanguage } from "../types";

export function formatDateTime(ms: number, locale: ResolvedLanguage): string {
  if (!ms) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(ms));
}

export function formatRelativeTime(seconds: number, locale: ResolvedLanguage): string {
  if (!seconds) return "";
  const diff = Math.max(0, Date.now() / 1000 - seconds);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (diff < 60) return relative.format(0, "second");
  if (diff < 3600) return relative.format(-Math.floor(diff / 60), "minute");
  if (diff < 86400) return relative.format(-Math.floor(diff / 3600), "hour");
  if (diff < 86400 * 30) return relative.format(-Math.floor(diff / 86400), "day");
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(seconds * 1000));
}
