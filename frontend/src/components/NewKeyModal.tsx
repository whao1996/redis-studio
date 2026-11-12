import { useEffect, useState, type FormEvent } from "react";
import type { TranslationKey } from "../i18n";
import { useSettings } from "../settings";
import type { CreateKeyForm, CreateKeyItem } from "../types";

interface Props {
  open: boolean;
  db: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (form: CreateKeyForm) => void;
}

type Mode = "textarea" | "single" | "pair" | "multi";

interface TypeConfig {
  value: string;
  label: string;
  mode: Mode;
  first: TranslationKey;
  second?: TranslationKey;
  hint?: string;
}

const TYPES: TypeConfig[] = [
  { value: "string", label: "String", mode: "textarea", first: "value", hint: "" },
  { value: "hash", label: "Hash", mode: "multi", first: "field" },
  { value: "list", label: "List", mode: "multi", first: "initialElement" },
  { value: "set", label: "Set", mode: "multi", first: "initialMember" },
  { value: "zset", label: "ZSet", mode: "multi", first: "member" },
  { value: "stream", label: "Stream", mode: "multi", first: "messageFieldsJson", hint: '{"level":"info","message":"hello"}' },
  { value: "ReJSON-RL", label: "JSON", mode: "textarea", first: "jsonContent", hint: '{"name":"alice","age":30}' },
  { value: "TSDB-TYPE", label: "TimeSeries", mode: "pair", first: "sampleValue", second: "timestampMs" },
  { value: "MBbloom--", label: "Bloom", mode: "single", first: "initialElement" },
  { value: "MBbloomCF", label: "Cuckoo", mode: "single", first: "initialElement" },
  { value: "CMSk-TYPE", label: "CMS", mode: "pair", first: "element", second: "incrementDefault" },
  { value: "TopK-TYPE", label: "TopK", mode: "single", first: "initialElement" },
  { value: "TDIS-TYPE", label: "TDigest", mode: "single", first: "initialNumber" },
  { value: "vectorset", label: "VectorSet", mode: "pair", first: "elementName", second: "vectorExample" },
];

const MULTI_LABEL_KEYS: Record<string, TranslationKey> = {
  hash: "hashRows",
  list: "listRows",
  set: "setRows",
  zset: "zsetRows",
  stream: "streamRows",
};

interface Row {
  field: string;
  value: string;
  score: string;
}

const emptyRow = (): Row => ({ field: "", value: "", score: "" });

function parseObject(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    return !!parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0;
  } catch {
    return false;
  }
}

export default function NewKeyModal({ open, db, busy, error, onClose, onSubmit }: Props) {
  const { t } = useSettings();
  const [keyName, setKeyName] = useState("");
  const [type, setType] = useState("string");
  const [ttlText, setTTLText] = useState("");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKeyName("");
    setType("string");
    setTTLText("");
    setFirst("");
    setSecond("");
    setRows([emptyRow()]);
    setLocalError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  const config = TYPES.find((item) => item.value === type) ?? TYPES[0];

  const updateRow = (index: number, key: keyof Row, value: string) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
    setLocalError(null);
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
    setLocalError(null);
  };

  const buildItems = (): CreateKeyItem[] | null => {
    const items: CreateKeyItem[] = [];

    if (type === "hash") {
      for (const row of rows) {
        if (!row.field.trim() && !row.value) continue;
        if (!row.field.trim()) {
          setLocalError(t("fieldRequired"));
          return null;
        }
        items.push({ field: row.field, value: row.value, score: 0 });
      }
      if (items.length === 0) {
        setLocalError(t("hashRequired"));
        return null;
      }
    } else if (type === "list" || type === "set") {
      for (const row of rows) {
        if (row.value === "") continue;
        items.push({ field: "", value: row.value, score: 0 });
      }
      if (items.length === 0) {
        setLocalError(type === "list" ? t("listRequired") : t("setRequired"));
        return null;
      }
    } else if (type === "zset") {
      for (const row of rows) {
        if (!row.field.trim() && !row.score.trim()) continue;
        const score = Number(row.score);
        if (!row.field.trim() || !Number.isFinite(score)) {
          setLocalError(t("scoreMustBeNumber"));
          return null;
        }
        items.push({ field: row.field, value: "", score });
      }
      if (items.length === 0) {
        setLocalError(t("zsetRequired"));
        return null;
      }
    } else if (type === "stream") {
      for (const row of rows) {
        if (!row.value.trim()) continue;
        if (!parseObject(row.value)) {
          setLocalError(t("messageJsonRequired"));
          return null;
        }
        items.push({ field: "", value: row.value, score: 0 });
      }
      if (items.length === 0) {
        setLocalError(t("streamRequired"));
        return null;
      }
    }

    return items;
  };

  const build = (): CreateKeyForm | null => {
    const name = keyName.trim();
    if (!name) {
      setLocalError(t("keyRequired"));
      return null;
    }

    let ttl = 0;
    if (ttlText.trim() !== "") {
      const parsed = Number(ttlText);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setLocalError(t("ttlInvalid"));
        return null;
      }
      ttl = Math.floor(parsed);
    }

    const base: CreateKeyForm = {
      key: name,
      type,
      ttl,
      field: "",
      value: "",
      score: 0,
      index: 0,
      items: [],
    };
    const number = (text: string) => {
      const parsed = Number(text);
      return Number.isFinite(parsed) ? parsed : null;
    };

    if (config.mode === "multi") {
      const items = buildItems();
      return items ? { ...base, items } : null;
    }

    switch (type) {
      case "string":
        return { ...base, value: first };

      case "ReJSON-RL":
        try {
          JSON.parse(first);
        } catch {
          setLocalError(t("jsonInvalid"));
          return null;
        }
        return { ...base, value: first };

      case "TSDB-TYPE": {
        const value = number(first);
        if (value === null) {
          setLocalError(t("sampleNumber"));
          return null;
        }
        let timestamp = 0;
        if (second.trim() !== "") {
          const parsed = number(second);
          if (parsed === null || parsed <= 0) {
            setLocalError(t("timestampInvalid"));
            return null;
          }
          timestamp = Math.floor(parsed);
        }
        return { ...base, value: first, index: timestamp };
      }

      case "MBbloom--":
      case "MBbloomCF":
      case "TopK-TYPE":
        if (!first.trim()) {
          setLocalError(t("elementRequired"));
          return null;
        }
        return { ...base, field: first };

      case "CMSk-TYPE": {
        if (!first.trim()) {
          setLocalError(t("elementRequired"));
          return null;
        }
        let increment = 1;
        if (second.trim() !== "") {
          const parsed = number(second);
          if (parsed === null || parsed <= 0) {
            setLocalError(t("incrementInvalid"));
            return null;
          }
          increment = Math.floor(parsed);
        }
        return { ...base, field: first, index: increment };
      }

      case "TDIS-TYPE":
        if (number(first) === null) {
          setLocalError(t("numberInvalid"));
          return null;
        }
        return { ...base, value: first };

      case "vectorset":
        if (!first.trim() || !second.trim()) {
          setLocalError(t("vectorRequired"));
          return null;
        }
        return { ...base, field: first, value: second };

      default:
        return base;
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    const form = build();
    if (form) onSubmit(form);
  };

  const message = localError ?? error;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form className="modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h2>{t("newKeyTitle")}</h2>
            <p>{t("newKeySubtitle", { db })}</p>
          </div>
          <button type="button" className="icon-btn" title={t("close")} onClick={onClose} disabled={busy}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <label className="field">
            <span>{t("keyName")}</span>
            <input
              value={keyName}
              onChange={(event) => {
                setKeyName(event.target.value);
                setLocalError(null);
              }}
              placeholder={t("keyNamePlaceholder")}
              spellCheck={false}
              autoFocus
              required
            />
          </label>

          <div className="field-row">
            <label className="field grow">
              <span>{t("type")}</span>
              <select
                value={type}
                onChange={(event) => {
                  setType(event.target.value);
                  setFirst("");
                  setSecond("");
                  setRows([emptyRow()]);
                  setLocalError(null);
                }}
              >
                {TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field port">
              <span>{t("ttlSecondsOptional")}</span>
              <input
                type="number"
                min={1}
                value={ttlText}
                onChange={(event) => {
                  setTTLText(event.target.value);
                  setLocalError(null);
                }}
                placeholder={t("neverExpires")}
              />
            </label>
          </div>

          {config.mode === "textarea" && (
            <label className="field">
              <span>{t(config.first)}</span>
              <textarea
                rows={5}
                value={first}
                onChange={(event) => {
                  setFirst(event.target.value);
                  setLocalError(null);
                }}
                placeholder={type === "string" ? t("valuePlaceholder") : config.hint}
                spellCheck={false}
              />
            </label>
          )}

          {config.mode === "single" && (
            <label className="field">
              <span>{t(config.first)}</span>
              <input
                value={first}
                onChange={(event) => {
                  setFirst(event.target.value);
                  setLocalError(null);
                }}
                spellCheck={false}
                placeholder={t(config.first)}
              />
            </label>
          )}

          {config.mode === "pair" && (
            <div className="field-row">
              <label className="field grow">
                <span>{t(config.first)}</span>
                <input
                  value={first}
                  onChange={(event) => {
                    setFirst(event.target.value);
                    setLocalError(null);
                  }}
                  spellCheck={false}
                />
              </label>
              <label className="field grow">
                <span>{config.second ? t(config.second) : ""}</span>
                <input
                  value={second}
                  onChange={(event) => {
                    setSecond(event.target.value);
                    setLocalError(null);
                  }}
                  spellCheck={false}
                />
              </label>
            </div>
          )}

          {config.mode === "multi" && (
            <div className="field">
              <span>{t(MULTI_LABEL_KEYS[type] ?? "value")}</span>
              <div className="create-rows">
                {rows.map((row, index) => (
                  <div className="create-row" key={index}>
                    {(type === "hash" || type === "zset") && (
                      <input
                        className="bar-input"
                        value={row.field}
                        placeholder={type === "hash" ? t("field") : t("member")}
                        spellCheck={false}
                        onChange={(event) => updateRow(index, "field", event.target.value)}
                      />
                    )}

                    {type !== "zset" && (
                      <input
                        className="bar-input"
                        value={row.value}
                        placeholder={
                          type === "hash"
                            ? t("value")
                            : type === "stream"
                              ? (config.hint ?? t("messageFieldsJson"))
                              : type === "set"
                                ? t("member")
                                : t("element")
                        }
                        spellCheck={false}
                        onChange={(event) => updateRow(index, "value", event.target.value)}
                      />
                    )}

                    {type === "zset" && (
                      <input
                        className="bar-input narrow"
                        value={row.score}
                        placeholder={t("score")}
                        spellCheck={false}
                        onChange={(event) => updateRow(index, "score", event.target.value)}
                      />
                    )}

                    {rows.length > 1 && (
                      <button type="button" className="link-btn" onClick={() => removeRow(index)}>
                        {t("removeRow")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="link-btn add-row"
                onClick={() => {
                  setRows((prev) => [...prev, emptyRow()]);
                  setLocalError(null);
                }}
              >
                {t("addRow")}
              </button>
            </div>
          )}

          {message && <p className="form-error">{message}</p>}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t("creating") : t("create")}
          </button>
        </div>
      </form>
    </div>
  );
}
