import { useEffect, useMemo, useState } from "react";
import { useSettings } from "../settings";

const MAX_PREVIEW_CHARS = 500_000;

export function prettyJson(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > MAX_PREVIEW_CHARS) return null;
  if (!(
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  )) {
    return null;
  }

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

function tokenCopyText(text: string): string {
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text) as string;
    } catch {
      return text.slice(1, -1);
    }
  }
  return text;
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

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const MAX_TREE_CHARS = 100_000;
const MAX_TREE_NODES = 3000;

function countNodes(value: JsonValue, limit: number): number {
  if (value === null || typeof value !== "object") return 1;
  let total = 1;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    total += countNodes(child, limit);
    if (total > limit) return total;
  }
  return total;
}


function primitiveNode(value: string | number | boolean | null) {
  if (value === null) return <span className="json-tree-null">null</span>;
  if (typeof value === "string") return <span className="json-tree-string">{JSON.stringify(value)}</span>;
  if (typeof value === "number") return <span className="json-tree-number">{String(value)}</span>;
  return <span className="json-tree-boolean">{String(value)}</span>;
}

function JsonStringToken({ value, selected }: { value: string; selected: boolean }) {
  const quoted = JSON.stringify(value);
  return (
    <>
      <span className="json-tree-quote">"</span>
      <span className={"json-tree-token-inner" + (selected ? " selected" : "")}>
        {quoted.slice(1, -1)}
      </span>
      <span className="json-tree-quote">"</span>
    </>
  );
}

function JsonNode({
  value,
  name,
  path,
  depth,
  isLast,
  collapsed,
  onToggle,
  selectedToken,
  onSelectToken,
}: {
  value: JsonValue;
  name?: string;
  path: string;
  depth: number;
  isLast: boolean;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  selectedToken: string | null;
  onSelectToken: (id: string, text: string) => void;
}) {
  const indent = { paddingLeft: depth * 16 };
  const isObject = value !== null && typeof value === "object";
  const isArray = Array.isArray(value);
  const entries = isObject ? (isArray ? value.map((item, index) => [String(index), item] as const) : Object.entries(value as { [key: string]: JsonValue })) : [];
  const hasChildren = isObject && entries.length > 0;
  const expanded = hasChildren && !collapsed.has(path);
  const punctuation = <span className="json-tree-punct">{isLast ? "" : ","}</span>;

  if (!isObject || !hasChildren) {
    return (
      <div className="json-tree-line" style={indent}>
        {hasChildren && (
          <button type="button" className="json-tree-toggle" onClick={() => onToggle(path)} aria-label="toggle">
            +
          </button>
        )}
        {name !== undefined && (
          <>
            <span
              className="json-tree-key json-tree-token"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelectToken(`${path}:key`, event.currentTarget.textContent ?? "");
              }}
            >
              <JsonStringToken value={name} selected={selectedToken === `${path}:key`} />
            </span>
            <span className="json-tree-punct">: </span>
          </>
        )}
        {isObject ? (
          <>
            <span className="json-tree-punct">{isArray ? "[]" : "{}"}</span>
            {punctuation}
          </>
        ) : (
          <>
            <span
              className="json-tree-token"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelectToken(`${path}:value`, event.currentTarget.textContent ?? "");
              }}
            >
              {typeof value === "string" ? (
                <span className="json-tree-string">
                  <JsonStringToken
                    value={value}
                    selected={selectedToken === `${path}:value`}
                  />
                </span>
              ) : (
                <span
                  className={"json-tree-token-inner" + (selectedToken === `${path}:value` ? " selected" : "")}
                >
                  {primitiveNode(value)}
                </span>
              )}
            </span>
            {punctuation}
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="json-tree-line" style={indent}>
        <button type="button" className="json-tree-toggle" onClick={() => onToggle(path)} aria-label="toggle">
          {expanded ? "−" : "+"}
        </button>
        {name !== undefined && (
          <>
            <span
              className="json-tree-key json-tree-token"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelectToken(`${path}:key`, event.currentTarget.textContent ?? "");
              }}
            >
              <JsonStringToken value={name} selected={selectedToken === `${path}:key`} />
            </span>
            <span className="json-tree-punct">: </span>
          </>
        )}
        <span className="json-tree-punct">{isArray ? "[" : "{"}</span>
        {!expanded && (
          <>
            <span className="json-tree-summary">…</span>
            <span className="json-tree-punct">{isArray ? "]" : "}"}</span>
            {punctuation}
          </>
        )}
      </div>
      {expanded && (
        <>
          {entries.map(([key, child], index) => (
            <JsonNode
              key={`${path}/${key}`}
              value={child}
              name={isArray ? undefined : key}
              path={`${path}/${key}`}
              depth={depth + 1}
              isLast={index === entries.length - 1}
              collapsed={collapsed}
              onToggle={onToggle}
              selectedToken={selectedToken}
              onSelectToken={onSelectToken}
            />
          ))}
          <div className="json-tree-line" style={indent}>
            <span className="json-tree-brace">{isArray ? "]" : "}"}</span>
            {punctuation}
          </div>
        </>
      )}
    </>
  );
}

export function JsonTreeView({ text, className = "json-view" }: { text: string; className?: string }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedToken, setSelectedToken] = useState<{ id: string; text: string } | null>(null);
  const parsed = useMemo(() => {
    if (text.length > MAX_TREE_CHARS) return undefined;
    try {
      const value = JSON.parse(text) as JsonValue;
      return countNodes(value, MAX_TREE_NODES) > MAX_TREE_NODES ? undefined : value;
    } catch {
      return undefined;
    }
  }, [text]);

  useEffect(() => {
    setCollapsed(new Set());
    setSelectedToken(null);
  }, [text]);

  useEffect(() => {
    if (!selectedToken) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "c") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      event.preventDefault();
      void copyText(tokenCopyText(selectedToken.text));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedToken]);

  if (parsed === undefined) {
    return <pre className={className}>{text}</pre>;
  }

  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <div className={`${className} json-tree`}>
      <JsonNode
        value={parsed}
        path="root"
        depth={0}
        isLast
        collapsed={collapsed}
        onToggle={toggle}
        selectedToken={selectedToken?.id ?? null}
        onSelectToken={(id, tokenText) => setSelectedToken({ id, text: tokenText })}
      />
    </div>
  );
}

export function JsonPreviewModal({
  title,
  content,
  onClose,
}: {
  title: string;
  content: string;
  onClose: () => void;
}) {
  const { t } = useSettings();
  const [copied, setCopied] = useState(false);
  const formatted = prettyJson(content) ?? content;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const copy = async () => {
    if (await copyText(formatted)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal json-preview-modal" role="dialog" aria-modal="true" aria-label={t("jsonPreview")}>
        <div className="modal-head">
          <div>
            <h2>{t("jsonPreview")}</h2>
            <p>{title} · {t("jsonPreviewHint")}</p>
          </div>
          <button type="button" className="icon-btn" title={t("close")} onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <JsonTreeView text={content} className="json-preview-body" />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={() => void copy()}>
            {copied ? t("copied") : t("copy")}
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
