import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { initializeI18n } from "../i18n";
import { LanguageProvider, useLanguage } from "./LanguageContext";

function Consumer() {
  const { language, setPreference } = useLanguage();
  return <button type="button" onClick={() => void setPreference("zh-CN").catch(() => undefined)}>{language}</button>;
}

describe("LanguageProvider", () => {
  beforeEach(async () => {
    await initializeI18n("en");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("switches immediately and persists the preference", async () => {
    const persist = vi.spyOn(api, "setLanguagePreference").mockResolvedValue({} as never);
    render(<LanguageProvider initialPreference="en"><Consumer /></LanguageProvider>);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("zh-CN");
    await waitFor(() => expect(persist).toHaveBeenCalledWith("zh-CN", "zh-CN"));
  });

  it("rolls back when persistence fails", async () => {
    vi.spyOn(api, "setLanguagePreference").mockRejectedValue(new Error("offline"));
    render(<LanguageProvider initialPreference="en"><Consumer /></LanguageProvider>);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("en"));
  });

  it("tracks operating-system language changes only in system mode", async () => {
    const originalLanguages = navigator.languages;
    const sync = vi.spyOn(api, "syncNativeLanguage").mockResolvedValue(undefined);
    Object.defineProperty(navigator, "languages", { configurable: true, value: ["en-US"] });
    render(<LanguageProvider initialPreference="system"><Consumer /></LanguageProvider>);
    expect(screen.getByRole("button")).toHaveTextContent("en");

    Object.defineProperty(navigator, "languages", { configurable: true, value: ["zh-HK"] });
    window.dispatchEvent(new Event("languagechange"));
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("zh-CN"));
    expect(sync).toHaveBeenCalledWith("zh-CN");
    Object.defineProperty(navigator, "languages", { configurable: true, value: originalLanguages });
  });
});
