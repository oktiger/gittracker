import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { api } from "../api";
import { applyLanguage, resolveLanguage } from "../i18n";
import type { AppLanguagePreference, ResolvedLanguage } from "../types";

interface LanguageContextValue {
  preference: AppLanguagePreference;
  language: ResolvedLanguage;
  setPreference: (preference: AppLanguagePreference) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

interface LanguageProviderProps extends PropsWithChildren {
  initialPreference: AppLanguagePreference;
}

export function LanguageProvider({ initialPreference, children }: LanguageProviderProps) {
  const [preference, setPreferenceState] = useState(initialPreference);
  const [language, setLanguage] = useState(() => resolveLanguage(initialPreference));

  const commitLanguage = useCallback(async (next: ResolvedLanguage) => {
    setLanguage(next);
    await applyLanguage(next);
  }, []);

  const setPreference = useCallback(async (nextPreference: AppLanguagePreference) => {
    const previousPreference = preference;
    const previousLanguage = language;
    const nextLanguage = resolveLanguage(nextPreference);
    setPreferenceState(nextPreference);
    await commitLanguage(nextLanguage);
    try {
      await api.setLanguagePreference(nextPreference, nextLanguage);
    } catch (error) {
      setPreferenceState(previousPreference);
      await commitLanguage(previousLanguage);
      throw error;
    }
  }, [commitLanguage, language, preference]);

  useEffect(() => {
    const onLanguageChange = () => {
      if (preference !== "system") return;
      const next = resolveLanguage("system");
      void commitLanguage(next)
        .then(() => api.syncNativeLanguage(next))
        .catch(() => undefined);
    };
    window.addEventListener("languagechange", onLanguageChange);
    return () => window.removeEventListener("languagechange", onLanguageChange);
  }, [commitLanguage, preference]);

  const value = useMemo(() => ({ preference, language, setPreference }), [language, preference, setPreference]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("LanguageProvider is missing");
  return context;
}
