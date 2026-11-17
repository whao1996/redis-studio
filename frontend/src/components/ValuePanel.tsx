import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { entryHeaders } from "../entryHeaders";
import { formatBytes, formatTTL, isJSONType, isModuleType, typeLabel } from "../format";
import type { TranslationKey } from "../i18n";
import { useSettings } from "../settings";
import type { EditPayload, ValueResult } from "../types";
import EntryEditor from "./EntryEditor";
import { JsonPreviewModal, JsonTreeView, prettyJson } from "./JsonPreview";
import JsonSourceEditor from "./JsonSourceEditor";
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

type TextMatch = { start: number; end: number };

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

function findTextMatches(text: string, query: string): TextMatch[] {
  const needle = query.toLocaleLowerCase();
  if (!needle) return [];
  const haystack = text.toLocaleLowerCase();
  const matches: TextMatch[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    matches.push({ start: index, end: index + needle.length });
    from = index + Math.max(needle.length, 1);
  }
  return matches;
}

function getHighlightApi() {
  const registry =
    typeof CSS === "undefined"
      ? undefined
      : (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
  const HighlightCtor = (window as unknown as {
    Highlight?: new (...ranges: Range[]) => unknown;
  }).Highlight;
  if (!registry || !HighlightCtor) return null;
  return {
    registry,
    create: (...ranges: Range[]) => new HighlightCtor(...ranges),
  };
}

function clearSearchHighlights() {
  const api = getHighlightApi();
  api?.registry.delete("value-search");
  api?.registry.delete("value-search-active");
}

function applySearchHighlights(ranges: Range[], active: number) {
  const api = getHighlightApi();
  if (!api) {
    const range = ranges[active];
    if (!range) return;
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }

  api.registry.delete("value-search");
  api.registry.delete("value-search-active");
  const activeRange = ranges[active];
  if (activeRange) api.registry.set("value-search-active", api.create(activeRange));
  const others = ranges.filter((_, index) => index !== active);
  if (others.length > 0) api.registry.set("value-search", api.create(...others));
}

function collectSearchRanges(root: HTMLElement, query: string): Range[] {
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const needle = query.toLocaleLowerCase();
  if (!needle) return ranges;

  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    const text = node.nodeValue ?? "";
    if (
      parent &&
      text &&
      !parent.closest("textarea, input, select, button, script, style, [aria-hidden='true']")
    ) {
      const style = window.getComputedStyle(parent);
      if (style.display !== "none" && style.visibility !== "hidden") {
        const haystack = text.toLocaleLowerCase();
        let from = 0;
        while (from <= haystack.length - needle.length) {
          const index = haystack.indexOf(needle, from);
          if (index < 0) break;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + needle.length);
          ranges.push(range);
          from = index + Math.max(needle.length, 1);
        }
      }
    }
    node = walker.nextNode();
  }
  return ranges;
}

function scrollRangeIntoView(range: Range, root: HTMLElement) {
  const element = range.startContainer.parentElement;
  if (!element) return;

  let scroller: HTMLElement | null = element;
  while (scroller && scroller !== root) {
    const style = window.getComputedStyle(scroller);
    if (
      /(auto|scroll)/.test(style.overflowY) &&
      scroller.scrollHeight > scroller.clientHeight + 1
    ) {
      break;
    }
    scroller = scroller.parentElement;
  }
  if (!scroller || scroller === root) return;

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const box = scroller.getBoundingClientRect();
  if (rect.top < box.top + 8 || rect.bottom > box.bottom - 8) {
    scroller.scrollTop +=
      rect.top - box.top - scroller.clientHeight / 2 + rect.height / 2;
  }
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
  const [jsonPreview, setJsonPreview] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCount, setSearchCount] = useState(0);
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchTick, setSearchTick] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRangesRef = useRef<Range[]>([]);
  const searchTextHitsRef = useRef<TextMatch[] | null>(null);
  const searchTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const searchIndexRef = useRef(0);

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
    setJsonPreview(null);
    setSearchOpen(false);
    setSearchQuery("");
    setSearchCount(0);
    setSearchIndex(0);
    searchRangesRef.current = [];
    searchTextHitsRef.current = null;
    searchTextareaRef.current = null;
    searchIndexRef.current = 0;
    clearSearchHighlights();
  }, [value]);

  useEffect(() => {
    if (!searchOpen) return;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [searchOpen]);

  useEffect(() => () => clearSearchHighlights(), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!value) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [value]);

  useEffect(() => {
    if (!searchOpen || !searchQuery) return;
    const body = panelRef.current?.querySelector<HTMLElement>(".value-body");
    if (!body) return;

    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setSearchTick((current) => current + 1);
      });
    });
    observer.observe(body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [searchOpen, searchQuery, value, jsonEditing]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    clearSearchHighlights();
    searchRangesRef.current = [];
    searchTextHitsRef.current = null;
    searchTextareaRef.current = null;
    searchIndexRef.current = 0;

    if (!searchOpen || !searchQuery || !panel) {
      setSearchCount(0);
      setSearchIndex(0);
      return;
    }

    const body = panel.querySelector<HTMLElement>(".value-body");
    if (!body) {
      setSearchCount(0);
      setSearchIndex(0);
      return;
    }

    const textarea = body.querySelector<HTMLTextAreaElement>(
      "textarea.value-editor, textarea.json-source-input"
    );
    if (textarea) {
      const matches = findTextMatches(textarea.value, searchQuery);
      searchTextareaRef.current = textarea;
      searchTextHitsRef.current = matches;
      setSearchCount(matches.length);
      setSearchIndex(0);
      return;
    }

    const ranges = collectSearchRanges(body, searchQuery);
    searchRangesRef.current = ranges;
    setSearchCount(ranges.length);
    setSearchIndex(0);
    if (ranges.length > 0) {
      applySearchHighlights(ranges, 0);
      scrollRangeIntoView(ranges[0], panel);
    }
  }, [searchOpen, searchQuery, searchTick, value, draft, jsonEditing, ttlEditing, confirming]);

  const draftJson = useMemo(
    () => (value?.type === "string" ? prettyJson(draft) : null),
    [value?.type, draft]
  );

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

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchCount(0);
    setSearchIndex(0);
    searchRangesRef.current = [];
    searchTextHitsRef.current = null;
    searchTextareaRef.current = null;
    searchIndexRef.current = 0;
    clearSearchHighlights();
  };

  const navigateSearch = (delta: number) => {
    if (searchCount === 0) return;
    const next = (searchIndexRef.current + delta + searchCount) % searchCount;
    searchIndexRef.current = next;
    setSearchIndex(next);

    const textarea = searchTextareaRef.current;
    const textHits = searchTextHitsRef.current;
    if (textarea && textHits) {
      const hit = textHits[next];
      if (!hit) return;
      textarea.focus();
      textarea.setSelectionRange(hit.start, hit.end);
      return;
    }

    const ranges = searchRangesRef.current;
    const panel = panelRef.current;
    if (!panel || !ranges[next]) return;
    applySearchHighlights(ranges, next);
    scrollRangeIntoView(ranges[next], panel);
  };

  return (
    <aside className="value-panel" ref={panelRef}>
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
          {isString && draftJson && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setJsonPreview(draft)}>
              {t("jsonPreview")}
            </button>
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
          <button
            type="button"
            className={"icon-btn value-search-toggle" + (searchOpen ? " active" : "")}
            title={t("searchValue")}
            aria-pressed={searchOpen}
            onClick={() => {
              if (searchOpen) closeSearch();
              else setSearchOpen(true);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </button>
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

      {searchOpen && (
        <div className="value-search-bar" role="search">
          <svg className="value-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={searchInputRef}
            className="value-search-input"
            value={searchQuery}
            placeholder={t("valueSearchPlaceholder")}
            aria-label={t("searchValue")}
            spellCheck={false}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setSearchIndex(0);
              searchIndexRef.current = 0;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                navigateSearch(event.shiftKey ? -1 : 1);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                closeSearch();
              }
            }}
          />
          <span
            className={"value-search-count" + (searchQuery && searchCount === 0 ? " empty" : "")}
            aria-live="polite"
          >
            {searchQuery ? (searchCount > 0 ? `${searchIndex + 1}/${searchCount}` : t("noMatches")) : ""}
          </span>
          <button
            type="button"
            className="icon-btn"
            title={t("previousMatch")}
            aria-label={t("previousMatch")}
            disabled={searchCount === 0}
            onClick={() => navigateSearch(-1)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m18 15-6-6-6 6" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t("nextMatch")}
            aria-label={t("nextMatch")}
            disabled={searchCount === 0}
            onClick={() => navigateSearch(1)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t("closeSearch")}
            aria-label={t("closeSearch")}
            onClick={closeSearch}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

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
            <JsonSourceEditor
              value={draft}
              onChange={(value) => {
                setDraft(value);
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
            <JsonTreeView
              text={draft}
              className="json-view"
              expandAll={searchOpen && searchQuery.length > 0}
            />
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

      {jsonPreview && (
        <JsonPreviewModal
          title={value.key}
          content={jsonPreview}
          onClose={() => setJsonPreview(null)}
        />
      )}
    </aside>
  );
}
