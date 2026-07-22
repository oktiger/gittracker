import i18n, { type TFunction } from "i18next";
import { initReactI18next } from "react-i18next";
import commonEn from "./locales/en/common.json";
import navigationEn from "./locales/en/navigation.json";
import projectsEn from "./locales/en/projects.json";
import activityEn from "./locales/en/activity.json";
import settingsEn from "./locales/en/settings.json";
import errorsEn from "./locales/en/errors.json";
import commonZh from "./locales/zh-CN/common.json";
import navigationZh from "./locales/zh-CN/navigation.json";
import projectsZh from "./locales/zh-CN/projects.json";
import activityZh from "./locales/zh-CN/activity.json";
import settingsZh from "./locales/zh-CN/settings.json";
import errorsZh from "./locales/zh-CN/errors.json";
import type {
  AppLanguagePreference,
  BackendError,
  LocalizedMessage,
  ResolvedLanguage,
} from "./types";

export const resources = {
  en: { common: commonEn, navigation: navigationEn, projects: projectsEn, activity: activityEn, settings: settingsEn, errors: errorsEn },
  "zh-CN": { common: commonZh, navigation: navigationZh, projects: projectsZh, activity: activityZh, settings: settingsZh, errors: errorsZh },
} as const;

export const namespaces = ["common", "navigation", "projects", "activity", "settings", "errors"] as const;

export function resolveLanguage(
  preference: AppLanguagePreference,
  languages: readonly string[] = navigator.languages,
): ResolvedLanguage {
  if (preference !== "system") return preference;
  return languages[0]?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export async function initializeI18n(language: ResolvedLanguage): Promise<void> {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources,
      lng: language,
      fallbackLng: "en",
      supportedLngs: ["en", "zh-CN"],
      defaultNS: "common",
      ns: namespaces,
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
      returnNull: false,
    });
  } else {
    await i18n.changeLanguage(language);
  }
  document.documentElement.lang = language;
  document.documentElement.dir = "ltr";
}

export async function applyLanguage(language: ResolvedLanguage): Promise<void> {
  await i18n.changeLanguage(language);
  document.documentElement.lang = language;
  document.documentElement.dir = "ltr";
}

export function translateMessage(message: LocalizedMessage | undefined, fallback = ""): string {
  if (!message) return fallback;
  if (import.meta.env.DEV && !i18n.exists(message.key, { lng: "en" })) {
    console.warn(`[i18n] Unknown backend message key: ${message.key}`);
  }
  return i18n.t(message.key, { ...message.params, defaultValue: fallback || message.key });
}

export function formatBackendError(error: unknown, t: TFunction<any> = i18n.t): string {
  const candidate = error as Partial<BackendError> | null;
  if (candidate && typeof candidate === "object" && typeof candidate.code === "string") {
    const summary = t(`errors:${candidate.code}`, {
      ...candidate.params,
      defaultValue: t("errors:backend"),
    });
    return candidate.detail ? `${summary}\n${candidate.detail}` : summary;
  }
  const raw = String(error).replace(/^Error:\s*/i, "").trim();
  return raw || t("errors:unknown");
}

export default i18n;
