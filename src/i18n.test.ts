import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import i18n, { initializeI18n, resolveLanguage, resources } from "./i18n";
import { formatRelativeTime } from "./lib/formatters";

function keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

function logicalKeys(value: unknown): string[] {
  return [...new Set(keys(value).map((key) => key.replace(/_(one|other)$/, "")))].sort();
}

describe("language resolution", () => {
  it("maps every Chinese system locale to zh-CN", () => {
    expect(resolveLanguage("system", ["zh-HK", "en-US"])).toBe("zh-CN");
    expect(resolveLanguage("system", ["zh-TW"])).toBe("zh-CN");
  });

  it("falls back to English for unsupported locales", () => {
    expect(resolveLanguage("system", ["fr-FR"])).toBe("en");
    expect(resolveLanguage("system", ["fr-FR", "zh-CN"])).toBe("en");
    expect(resolveLanguage("zh-CN", ["en-US"])).toBe("zh-CN");
  });
});

describe("translation resources", () => {
  it("keeps every namespace and key in sync", () => {
    for (const namespace of Object.keys(resources.en) as Array<keyof typeof resources.en>) {
      expect(logicalKeys(resources["zh-CN"][namespace])).toEqual(logicalKeys(resources.en[namespace]));
    }
  });

  it("updates the document language", async () => {
    await initializeI18n("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("formats relative time, interpolation, and plurals for both languages", async () => {
    const now = Date.now;
    Date.now = () => 1_800_000;
    expect(formatRelativeTime(1_740, "en")).toMatch(/minute ago/i);
    expect(formatRelativeTime(1_740, "zh-CN")).toContain("1");
    Date.now = now;

    await i18n.changeLanguage("en");
    expect(i18n.t("common:counts.files", { count: 2 })).toBe("2 files");
    await i18n.changeLanguage("zh-CN");
    expect(i18n.t("projects:discard.logDetail", { count: 2, files: "a\nb", note: "ok" })).toContain("2");
  });

  it("contains every semantic key emitted by Rust", () => {
    const source = ["commands.rs", "ai/mod.rs", "run/mod.rs"]
      .map((file) => readFileSync(join(process.cwd(), "src-tauri", "src", file), "utf8"))
      .join("\n");
    const emitted = [...source.matchAll(/i18n:([a-zA-Z0-9:._-]+)/g)].map((match) => match[1]);
    for (const key of emitted) {
      const [namespace, path] = key.split(":");
      const parts = path.split(".");
      let current: unknown = resources.en[namespace as keyof typeof resources.en];
      for (const part of parts) current = (current as Record<string, unknown>)?.[part];
      expect(current, `Missing English translation for ${key}`).toBeTypeOf("string");
    }

    const errorCodes = [...source.matchAll(/AppError::coded\("([a-zA-Z0-9._-]+)"/g)].map((match) => match[1]);
    for (const code of errorCodes) {
      expect(resources.en.errors[code as keyof typeof resources.en.errors], `Missing error translation for ${code}`).toBeTypeOf("string");
    }
  });
});
