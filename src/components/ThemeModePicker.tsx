import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

const THEME_OPTIONS = [
  {
    value: "system",
    titleKey: "appearance.system.title",
    descKey: "appearance.system.description",
    icon: Monitor,
  },
  {
    value: "light",
    titleKey: "appearance.light.title",
    descKey: "appearance.light.description",
    icon: Sun,
  },
  {
    value: "dark",
    titleKey: "appearance.dark.title",
    descKey: "appearance.dark.description",
    icon: Moon,
  },
] as const;

export function ThemeModePicker() {
  const { t } = useTranslation("settings");
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const current = mounted ? (theme ?? "system") : "system";

  return (
    <RadioGroup
      value={current}
      onValueChange={setTheme}
      className="grid gap-2"
      aria-label={t("appearance.modeLabel")}
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon;
        const selected = current === option.value;
        return (
          <label
            key={option.value}
            htmlFor={`theme-${option.value}`}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
              selected
                ? "border-primary bg-accent/30"
                : "border-border hover:bg-accent/20",
            )}
          >
            <RadioGroupItem
              id={`theme-${option.value}`}
              value={option.value}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Icon className="size-4 text-muted-foreground" aria-hidden />
                {t(option.titleKey)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t(option.descKey)}</p>
            </div>
          </label>
        );
      })}
    </RadioGroup>
  );
}
