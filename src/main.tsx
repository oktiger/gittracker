import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./components/theme-provider";
import { LanguageProvider } from "./contexts/LanguageContext";
import { api } from "./api";
import { initializeI18n, resolveLanguage } from "./i18n";
import type { AppLanguagePreference } from "./types";
import "./index.css";

async function syncWindowMaximizedClass() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const apply = async () => {
      const maximized = await win.isMaximized();
      document.documentElement.classList.toggle("window-maximized", maximized);
    };
    await apply();
    await win.onResized(() => {
      void apply();
    });
  } catch {
    // Browser / non-Tauri preview: keep default rounded chrome.
  }
}

async function bootstrap() {
  let preference: AppLanguagePreference = "system";
  try {
    preference = (await api.getSettings()).language;
  } catch {
    // The UI can still start with a safe system-language fallback.
  }
  const language = resolveLanguage(preference);
  await initializeI18n(language);
  void api.syncNativeLanguage(language).catch(() => undefined);
  void syncWindowMaximizedClass();

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <LanguageProvider initialPreference={preference}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <App />
        </ThemeProvider>
      </LanguageProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
