import { useEffect, useState, type ReactNode } from "react";
import { entryHeaders } from "../entryHeaders";
import { formatBytes, formatTTL, isJSONType, isModuleType, typeLabel } from "../format";
import type { TranslationKey } from "../i18n";
import { useSettings } from "../settings";
import type { EditPayload, ValueResult } from "../types";
import EntryEditor from "./EntryEditor";
import ModuleTools from "./ModuleTools";

const MODULE_TITLES: Record<string, TranslationKey> = {
  timeseries: "samples",
  topk: "topkList",
  tdigest: "quantiles",
  vectorset: "vectorSamples",
};

interface Props {
  value: ValueResult | null;
  loading: boolean;
  onSave: (value: string, ttlSeconds: number) => Promise<boolean>;
  onEdit: (payload: EditPayload) => Promise<boolean>;
  onUpdateTTL: (ttlSeconds: number) => Promise<boolean>;
  onDelete: () => void;
  onRefresh: () => void;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function highlightJSON(text: string): ReactNode {
  // 超大文档不做高亮，避免生成过多节点。
  if (text.length > 120_000) return text;

  const tokens: ReactNode[] = [];
  const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      tokens.push(text.slice(last, match.index));
    }

    if (match[1] !== undefined) {
      tokens.push(
        <span key={index++} className={match[2] ? "json-key" : "json-string"}>
          {match[1]}
        </span>
      );
      if (match[2]) tokens.push(match[2]);
    } else if (match[3] !== undefined) {
      tokens.push(
        <span key={index++} className="json-literal">
          {match[3]}
        </span>
      );
    } else {
      tokens.push(
        <span key={index++} className="json-number">
          {match[0]}
        </span>
      );
    }

    last = pattern.lastIndex;
  }

  tokens.push(text.slice(last));
  return tokens;
}

export default function ValuePanel({ value, loading, onSave, onEdit, onUpdateTTL, onDelete, onRefresh }: Props) {
  const { t } = useSettings();
  const [draft, setDraft] = useState("");
  const [ttlInput, setTtlInput] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [jsonEditing, setJSONEditing] = useState(false);
  const [jsonBusy, setJSONBusy] = useState(false);
  const [jsonError, setJSONError] = useState<string | null>(null);
  const [ttlEditing, setTTLEditing] = useState(false);
  const [ttlDraft, setTTLDraft] = useState("");
  const [ttlBusy, setTTLBusy] = useState(false);
  const [ttlError, setTTLError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value?.value ?? "");
    setTtlInput(value && value.ttl > 0 ? String(value.ttl) : "");
    setDirty(false);
    setFormError(null);
    setConfirming(false);
    setCopied(false);
    setKeyCopied(false);
    setJSONEditing(false);
    setJSONError(null);
    setTTLEditing(false);
    setTTLDraft(value && value.ttl > 0 ? String(value.ttl) : "");
    setTTLBusy(false);
    setTTLError(null);
  }, [value]);

  if (loading) {
    return (
      <aside className="value-panel">
        <div className="value-loading">
          <span className="spinner" />
          {t("loadingValue")}
        </div>
      </aside>
    );
  }

  if (!value) {
    return (
      <aside className="value-panel">
        <div className="value-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m12 3 9 5-9 5-9-5 9-5Z" />
            <path d="m3 13 9 5 9-5" />
            <path d="m3 17 9 5 9-5" />
          </svg>
          <p>{t("selectKeyTitle")}</p>
          <span>{t("selectKeySub")}</span>
        </div>
      </aside>
    );
  }

  const isString = value.type === "string";
  const isJSON = isJSONType(value.type);
  const isModule = isModuleType(value.type) || value.entryKind !== "";
  const isCollection =
    value.type === "hash" ||
    value.type === "list" ||
    value.type === "set" ||
    value.type === "zset" ||
    value.type === "stream";
  const [columnA, columnB] = entryHeaders(value.entryKind || value.type, t);

  const save = async () => {
    const ttlText = ttlInput.trim();
    let ttl = 0;

    if (ttlText !== "") {
      const parsed = Number(ttlText);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setFormError(t("ttlInputInvalid"));
        return;
      }
      ttl = Math.floor(parsed);
    }

    setBusy(true);
    setFormError(null);
    const ok = await onSave(draft, ttl);
    setBusy(false);
    if (ok) setDirty(false);
  };

  const copyValue = async () => {
    if (await copyText(draft)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  const copyKeyName = async () => {
    if (await copyText(value.key)) {
      setKeyCopied(true);
      window.setTimeout(() => setKeyCopied(false), 1500);
    }
  };

  const formatJSON = () => {
    try {
      const parsed = JSON.parse(draft);
      setDraft(JSON.stringify(parsed, null, 2));
      setJSONError(null);
    } catch {
      setJSONError(t("jsonInvalid"));
    }
  };

  const cancelJSON = () => {
    setDraft(value.value);
    setJSONError(null);
    setJSONEditing(false);
  };

  const saveJSON = async () => {
    try {
      JSON.parse(draft);
    } catch {
      setJSONError(t("jsonInvalid"));
      return;
    }

    setJSONBusy(true);
    setJSONError(null);
    const ok = await onEdit({ action: "json.set", value: draft });
    setJSONBusy(false);
    if (ok) setJSONEditing(false);
  };

  const openTTLEditor = () => {
    setTTLDraft(value.ttl > 0 ? String(value.ttl) : "");
    setTTLError(null);
    setTTLEditing(true);
  };

  const saveTTL = async () => {
    const text = ttlDraft.trim();
    let ttl = -1;
    if (text !== "") {
      const parsed = Number(text);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setTTLError(t("ttlInputInvalid"));
        return;
      }
      ttl = parsed;
    }

    setTTLBusy(true);
    setTTLError(null);
    const ok = await onUpdateTTL(ttl);
    setTTLBusy(false);
    if (ok) setTTLEditing(false);
  };

  return (
    <aside className="value-panel">
      <div className="value-head">
        <div className="value-title">
          <span className="value-key" title={value.key}>
            {value.key}
          </span>
          <span className={`type-badge type-${value.type}`}>{typeLabel(value.type)}</span>
          <button
            type="button"
            className="icon-btn key-copy-btn"
            title={keyCopied ? t("copied") : t("copyKeyName")}
            onClick={() => void copyKeyName()}
          >
            {keyCopied ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m5 12 5 5L20 7" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V6a2 2 0 0 1 2-2h9" />
              </svg>
            )}
          </button>
        </div>
        <div className="value-actions">
          <button type="button" className="ttl-meta" title={t("editTTL")} onClick={openTTLEditor}>
            <span>TTL {formatTTL(value.ttl, t)}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
            </svg>
          </button>
          {isJSON ? (
            <span className="meta">{formatBytes(value.length)}</span>
          ) : (
            !isString && !isModule && <span className="meta">{t("itemsCount", { count: value.length })}</span>
          )}
          {(isJSON || isString) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyValue()}>
              {copied ? t("copied") : t("copy")}
            </button>
          )}
          {isJSON && !jsonEditing && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setJSONEditing(true)}>
              {t("edit")}
            </button>
          )}
          <button type="button" className="icon-btn" title={t("refresh")} onClick={onRefresh}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
          <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
            {t("delete")}
          </button>
        </div>
      </div>

      {ttlEditing && (
        <div className="ttl-edit-bar">
          <span className="ttl-edit-label">{t("ttlEditorLabel")}</span>
          <input
            type="number"
            min={1}
            value={ttlDraft}
            onChange={(event) => {
              setTTLDraft(event.target.value);
              setTTLError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void saveTTL();
              }
              if (event.key === "Escape") setTTLEditing(false);
            }}
            placeholder={t("neverExpires")}
            autoFocus
            disabled={ttlBusy}
          />
          {ttlError && <span className="ttl-edit-error">{ttlError}</span>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTTLEditing(false)} disabled={ttlBusy}>
            {t("cancel")}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveTTL()} disabled={ttlBusy}>
            {ttlBusy ? t("saving") : t("save")}
          </button>
        </div>
      )}

      {confirming && (
        <div className="confirm-bar">
          <span>{t("deleteKeyConfirm", { key: value.key })}</span>
          <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              setConfirming(false);
              onDelete();
            }}
          >
            {t("confirmDelete")}
          </button>
        </div>
      )}

      {isString ? (
        <div className="value-body string-body">
          <textarea
            className="value-editor"
            value={draft}
            readOnly={!value.editable}
            spellCheck={false}
            onChange={(event) => {
              setDraft(event.target.value);
              setDirty(true);
              setFormError(null);
            }}
          />
          {value.truncated && (
            <p className="notice warn">{t("valueTooLarge")}</p>
          )}
          {formError && <p className="notice err">{formError}</p>}
          <div className="editor-foot">
            <span className="muted">
              {t("chars", { count: draft.length })}
              {value.editable ? "" : ` · ${t("readOnly")}`}
            </span>
            <label className="ttl-input">
              TTL
              <input
                value={ttlInput}
                onChange={(event) => {
                  setTtlInput(event.target.value);
                  setDirty(true);
                  setFormError(null);
                }}
                placeholder={t("forever")}
                inputMode="numeric"
                disabled={!value.editable}
              />
              <span>{t("secondsUnit")}</span>
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!dirty || busy || !value.editable}
              onClick={save}
            >
              {busy ? t("saving") : t("save")}
            </button>
          </div>
        </div>
      ) : isJSON ? (
        jsonEditing ? (
          <div className="value-body string-body">
            <textarea
              className="value-editor"
              value={draft}
              spellCheck={false}
              onChange={(event) => {
                setDraft(event.target.value);
                setJSONError(null);
              }}
            />
            {jsonError && <p className="notice err">{jsonError}</p>}
            <div className="editor-foot">
              <span className="muted">{t("chars", { count: draft.length })}</span>
              <div className="editor-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={formatJSON}>
                  {t("format")}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={cancelJSON} disabled={jsonBusy}>
                  {t("cancel")}
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveJSON()} disabled={jsonBusy}>
                  {jsonBusy ? t("saving") : t("save")}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="value-body json-body">
            <pre className="json-view">{highlightJSON(draft)}</pre>
            <div className="json-foot">
              <span className="muted">
                {t("chars", { count: draft.length })} · {t("previewOnly")}
              </span>
              <span className="muted">{t("jsonFormatted")}</span>
            </div>
          </div>
        )
      ) : isModule ? (
        <div className="value-body module-body">
          {value.info.length > 0 && (
            <section className="module-section">
              <h3 className="module-title">{t("properties")}</h3>
              <div className="entry-table">
                <div className="entry-row entry-head">
                  <span>{t("property")}</span>
                  <span>{t("value")}</span>
                </div>
                {value.info.map((entry, index) => (
                  <div className="entry-row" key={`${entry.field}-${index}`}>
                    <span className="entry-field">{entry.field}</span>
                    <span className="entry-value">{entry.value}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {value.entries.length > 0 && (
            <section className="module-section">
              <h3 className="module-title">{t(MODULE_TITLES[value.entryKind] ?? "content")}</h3>
              <div className="entry-table">
                <div className="entry-row entry-head">
                  <span>{columnA}</span>
                  <span>{columnB}</span>
                </div>
                {value.entries.map((entry, index) => (
                  <div className="entry-row" key={`${entry.field}-${index}`}>
                    <span className="entry-field">{entry.field}</span>
                    <span className="entry-value">{entry.value}</span>
                  </div>
                ))}
              </div>
              {value.truncated && (
                <p className="notice">
                  {t("entriesTruncated", { shown: value.entries.length, total: value.length })}
                </p>
              )}
            </section>
          )}

          <ModuleTools type={value.type} onEdit={onEdit} />
        </div>
      ) : isCollection ? (
        <div className="value-body">
          <EntryEditor
            type={value.type}
            entries={value.entries}
            length={value.length}
            truncated={value.truncated}
            onEdit={onEdit}
          />
        </div>
      ) : (
        <div className="value-body">
          <p className="notice">{value.value || t("noContent")}</p>
        </div>
      )}
    </aside>
  );
}
