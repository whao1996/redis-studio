import { useEffect, useState } from "react";
import type { TranslationKey } from "../i18n";
import { useSettings } from "../settings";
import type { EditPayload } from "../types";

interface Props {
  type: string;
  onEdit: (payload: EditPayload) => Promise<boolean>;
}

interface ToolConfig {
  first: TranslationKey;
  second?: TranslationKey;
  button: TranslationKey;
}

const CONFIG: Record<string, ToolConfig> = {
  "TSDB-TYPE": { first: "sampleValue", second: "timestampMs", button: "addSample" },
  "MBbloom--": { first: "element", button: "addElement" },
  MBbloomCF: { first: "element", button: "addElement" },
  "CMSk-TYPE": { first: "element", second: "incrementDefault", button: "incrCount" },
  "TopK-TYPE": { first: "element", button: "addElement" },
  "TDIS-TYPE": { first: "number", button: "addNumber" },
  vectorset: { first: "elementName", second: "vectorExample", button: "addVector" },
};

export default function ModuleTools({ type, onEdit }: Props) {
  const { t } = useSettings();
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const config = CONFIG[type];

  useEffect(() => {
    setFirst("");
    setSecond("");
    setError(null);
  }, [type]);

  if (!config) return null;

  const submit = async () => {
    let payload: EditPayload;
    const number = (text: string) => {
      const parsed = Number(text);
      return Number.isFinite(parsed) ? parsed : null;
    };

    switch (type) {
      case "TSDB-TYPE": {
        const value = number(first);
        if (value === null) {
          setError(t("sampleNumber"));
          return;
        }
        let timestamp = 0;
        if (second.trim() !== "") {
          const parsed = number(second);
          if (parsed === null || parsed <= 0) {
            setError(t("timestampInvalid"));
            return;
          }
          timestamp = Math.floor(parsed);
        }
        payload = { action: "ts.add", value: first, index: timestamp };
        break;
      }
      case "MBbloom--":
      case "MBbloomCF":
      case "TopK-TYPE": {
        if (!first.trim()) {
          setError(t("elementRequired"));
          return;
        }
        const action = type === "MBbloom--" ? "bloom.add" : type === "MBbloomCF" ? "cuckoo.add" : "topk.add";
        payload = { action, field: first };
        break;
      }
      case "CMSk-TYPE": {
        if (!first.trim()) {
          setError(t("elementRequired"));
          return;
        }
        let increment = 1;
        if (second.trim() !== "") {
          const parsed = number(second);
          if (parsed === null || parsed <= 0) {
            setError(t("incrementInvalid"));
            return;
          }
          increment = Math.floor(parsed);
        }
        payload = { action: "cms.incr", field: first, index: increment };
        break;
      }
      case "TDIS-TYPE": {
        if (number(first) === null) {
          setError(t("numberInvalid"));
          return;
        }
        payload = { action: "tdigest.add", value: first };
        break;
      }
      case "vectorset": {
        if (!first.trim()) {
          setError(t("elementRequired"));
          return;
        }
        if (!second.trim()) {
          setError(t("vectorRequired"));
          return;
        }
        payload = { action: "vector.add", field: first, value: second };
        break;
      }
      default:
        return;
    }

    setBusy(true);
    setError(null);
    const ok = await onEdit(payload);
    setBusy(false);
    if (ok) {
      setFirst("");
      setSecond("");
    }
  };

  return (
    <section className="module-section">
      <h3 className="module-title">{t("add")}</h3>
      <div className="add-bar">
        <input
          className="bar-input"
          value={first}
          placeholder={t(config.first)}
          spellCheck={false}
          onChange={(event) => {
            setFirst(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
        />
        {config.second && (
          <input
            className="bar-input wide"
            value={second}
            placeholder={t(config.second)}
            spellCheck={false}
            onChange={(event) => {
              setSecond(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        )}
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void submit()}>
          {t(config.button)}
        </button>
      </div>
      {error && <p className="notice err">{error}</p>}
    </section>
  );
}
