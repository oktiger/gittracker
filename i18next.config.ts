import { defineConfig } from "i18next-cli";

export default defineConfig({
  locales: ["en", "zh-CN"],
  extract: {
    input: ["src/**/*.{ts,tsx}"],
    output: "src/locales/{{language}}/{{namespace}}.json",
    defaultNS: "common",
  },
  lint: {
    checkInterpolationParams: true,
    ignoredAttributes: ["className", "data-tauri-drag-region", "data-testid"],
    ignoredTags: ["code", "pre"],
  },
  types: {
    input: "src/locales/en/*.json",
    output: "src/i18next.d.ts",
  },
});
