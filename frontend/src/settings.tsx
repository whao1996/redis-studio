import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { dictionaries, type Lang, type TranslationKey } from "./i18n";

export type ThemeMode = "light" | "dark" | "system";
export type FontSize = "small" | "medium" | "large";

export const DEFAULT_SCAN_PAGE_SIZE = 1000;
export const MIN_SCAN_PAGE_SIZE = 100;
export const MAX_SCAN_PAGE_SIZE = 5000;

interface SettingsState {
  language: Lang;
  theme: ThemeMode;
  fontSize: FontSize;
  scanPageSize: number;
}

interface SettingsContextValue extends SettingsState {
  setLanguage: (language: Lang) => void;
  setTheme: (theme: ThemeMode) => void;
  setFontSize: (size: FontSize) => void;
  setScanPageSize: (size: number) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const STORAGE_KEY = "redis-studio.settings";

function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SettingsState>;
      const scanPageSize = Number(parsed.scanPageSize);
      return {
        language: parsed.language === "en" ? "en" : "zh",
        theme: parsed.theme === "light" || parsed.theme === "system" ? parsed.theme : "dark",
        fontSize: parsed.fontSize === "small" || parsed.fontSize === "large" ? parsed.fontSize : "medium",
        scanPageSize:
          Number.isInteger(scanPageSize) &&
          scanPageSize >= MIN_SCAN_PAGE_SIZE &&
          scanPageSize <= MAX_SCAN_PAGE_SIZE
            ? scanPageSize
            : DEFAULT_SCAN_PAGE_SIZE,
      };
    }
  } catch {
    // 配置损坏时回退到默认值。
  }
  return { language: "zh", theme: "dark", fontSize: "medium", scanPageSize: DEFAULT_SCAN_PAGE_SIZE };
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SettingsState>(loadSettings);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 存储不可用时忽略，仅影响持久化。
    }
  }, [settings]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = settings.theme === "system" ? (media.matches ? "dark" : "light") : settings.theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };

    apply();
    if (settings.theme !== "system") return;

    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme]);

  useEffect(() => {
    document.documentElement.dataset.fontSize = settings.fontSize;
    document.documentElement.lang = settings.language === "zh" ? "zh-CN" : "en";
  }, [settings.fontSize, settings.language]);

  const t = (key: TranslationKey, vars?: Record<string, string | number>) => {
    let text = dictionaries[settings.language][key] ?? dictionaries.zh[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.split(`{${name}}`).join(String(value));
      }
    }
    return text;
  };

  const value: SettingsContextValue = {
    ...settings,
    setLanguage: (language) => setSettings((prev) => ({ ...prev, language })),
    setTheme: (theme) => setSettings((prev) => ({ ...prev, theme })),
    setFontSize: (fontSize) => setSettings((prev) => ({ ...prev, fontSize })),
    setScanPageSize: (scanPageSize) => setSettings((prev) => ({ ...prev, scanPageSize })),
    t,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return context;
}
