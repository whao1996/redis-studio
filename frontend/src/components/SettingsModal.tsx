import { useEffect, useState } from "react";
import {
  MAX_SCAN_PAGE_SIZE,
  MIN_SCAN_PAGE_SIZE,
  useSettings,
  type FontSize,
  type ThemeMode,
} from "../settings";
import type { Lang } from "../i18n";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Option<T extends string> {
  value: T;
  label: string;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={"segment" + (value === option.value ? " active" : "")}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default function SettingsModal({ open, onClose }: Props) {
  const {
    t,
    language,
    setLanguage,
    theme,
    setTheme,
    fontSize,
    setFontSize,
    scanPageSize,
    setScanPageSize,
  } = useSettings();
  const [scanDraft, setScanDraft] = useState(String(scanPageSize));

  useEffect(() => {
    if (open) setScanDraft(String(scanPageSize));
  }, [open]);

  const updateScanDraft = (value: string) => {
    setScanDraft(value);
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= MIN_SCAN_PAGE_SIZE && parsed <= MAX_SCAN_PAGE_SIZE) {
      setScanPageSize(parsed);
    }
  };

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal settings-modal">
        <div className="modal-head">
          <div>
            <h2>{t("settings")}</h2>
            <p>{t("appearance")}</p>
          </div>
          <button type="button" className="icon-btn" title={t("close")} onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="settings-group">
            <span className="settings-label">{t("language")}</span>
            <Segmented<Lang>
              value={language}
              options={[
                { value: "zh", label: "中文" },
                { value: "en", label: "English" },
              ]}
              onChange={setLanguage}
            />
          </div>

          <div className="settings-group">
            <span className="settings-label">{t("theme")}</span>
            <Segmented<ThemeMode>
              value={theme}
              options={[
                { value: "light", label: t("themeLight") },
                { value: "dark", label: t("themeDark") },
                { value: "system", label: t("themeSystem") },
              ]}
              onChange={setTheme}
            />
          </div>

          <div className="settings-group">
            <span className="settings-label">{t("fontSize")}</span>
            <Segmented<FontSize>
              value={fontSize}
              options={[
                { value: "small", label: t("fontSmall") },
                { value: "medium", label: t("fontMedium") },
                { value: "large", label: t("fontLarge") },
              ]}
              onChange={setFontSize}
            />
          </div>

          <div className="settings-group">
            <span className="settings-label">{t("scanPageSize")}</span>
            <div className="settings-number">
              <input
                type="number"
                min={MIN_SCAN_PAGE_SIZE}
                max={MAX_SCAN_PAGE_SIZE}
                step={100}
                value={scanDraft}
                onChange={(event) => updateScanDraft(event.target.value)}
                onBlur={() => setScanDraft(String(scanPageSize))}
              />
              <span className="settings-hint">{t("scanPageSizeHint")}</span>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t("done")}
          </button>
        </div>
      </div>
    </div>
  );
}
