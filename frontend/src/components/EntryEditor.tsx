import { useEffect, useState, type ReactNode } from "react";
import { entryHeaders } from "../entryHeaders";
import { useSettings } from "../settings";
import type { EditPayload, Entry } from "../types";

interface Props {
  type: string;
  entries: Entry[];
  length: number;
  truncated: boolean;
  onEdit: (payload: EditPayload) => Promise<boolean>;
}

type RowActionKind = "copy" | "copied" | "edit" | "delete" | "confirm" | "cancel";

function RowActionButton({ kind, title, onClick }: { kind: RowActionKind; title: string; onClick: () => void }) {
  let icon: ReactNode;

  switch (kind) {
    case "copy":
      icon = (
        <>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V6a2 2 0 0 1 2-2h9" />
        </>
      );
      break;
    case "copied":
      icon = <path d="m5 13 4 4L19 7" />;
      break;
    case "edit":
      icon = (
        <>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
        </>
      );
      break;
    case "delete":
      icon = (
        <>
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 14H6L5 6" />
        </>
      );
      break;
    case "confirm":
      icon = <path d="m5 13 4 4L19 7" />;
      break;
    default:
      icon = <path d="M18 6 6 18M6 6l12 12" />;
  }

  return (
    <button type="button" className={`row-btn ${kind}`} title={title} onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {icon}
      </svg>
    </button>
  );
}

export default function EntryEditor({ type, entries, length, truncated, onEdit }: Props) {
  const { t } = useSettings();
  const [editing, setEditing] = useState<{ row: string; value: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [newA, setNewA] = useState("");
  const [newB, setNewB] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedRow, setCopiedRow] = useState<string | null>(null);

  useEffect(() => {
    setEditing(null);
    setConfirming(null);
    setNewA("");
    setNewB("");
    setError(null);
    setCopiedRow(null);
  }, [type]);

  const [columnA, columnB] = entryHeaders(type, t);
  const editable = type === "hash" || type === "list" || type === "zset";

  const addLabels = (): [string, string, string] => {
    switch (type) {
      case "hash":
        return [t("field"), t("value"), t("addField")];
      case "list":
        return [t("newValueAppend"), "", t("append")];
      case "set":
        return [t("newMember"), "", t("addMember")];
      case "zset":
        return [t("member"), t("score"), t("add")];
      case "stream":
        return [t("messageJson"), "", t("appendMessage")];
      default:
        return [t("value"), "", t("add")];
    }
  };
  const [firstLabel, secondLabel, addLabel] = addLabels();

  const rowId = (entry: Entry) => (type === "set" ? entry.value : entry.field);

  const copyRowValue = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopiedRow(id);
    window.setTimeout(() => setCopiedRow((current) => (current === id ? null : current)), 1500);
  };

  const saveRow = async (entry: Entry) => {
    if (!editing) return;

    let payload: EditPayload;
    switch (type) {
      case "hash":
        payload = { action: "hash.set", field: entry.field, value: editing.value };
        break;
      case "list":
        payload = { action: "list.set", index: Number(entry.field), value: editing.value };
        break;
      case "zset": {
        const score = Number(editing.value);
        if (!Number.isFinite(score)) {
          setError(t("scoreMustBeNumber"));
          return;
        }
        payload = { action: "zset.set", field: entry.field, score };
        break;
      }
      default:
        return;
    }

    setBusy(true);
    setError(null);
    const ok = await onEdit(payload);
    setBusy(false);
    if (ok) setEditing(null);
  };

  const deleteRow = async (entry: Entry) => {
    let payload: EditPayload;
    switch (type) {
      case "hash":
        payload = { action: "hash.del", field: entry.field };
        break;
      case "list":
        payload = { action: "list.del", index: Number(entry.field) };
        break;
      case "set":
        payload = { action: "set.del", field: entry.value };
        break;
      case "zset":
        payload = { action: "zset.del", field: entry.field };
        break;
      case "stream":
        payload = { action: "stream.del", field: entry.field };
        break;
      default:
        return;
    }

    setBusy(true);
    setError(null);
    const ok = await onEdit(payload);
    setBusy(false);
    if (ok) setConfirming(null);
  };

  const addEntry = async () => {
    let payload: EditPayload;

    switch (type) {
      case "hash":
        if (!newA.trim()) {
          setError(t("fieldRequired"));
          return;
        }
        payload = { action: "hash.set", field: newA, value: newB };
        break;
      case "list":
        payload = { action: "list.push", value: newA };
        break;
      case "set":
        if (!newA.trim()) {
          setError(t("memberRequired"));
          return;
        }
        payload = { action: "set.add", field: newA };
        break;
      case "zset": {
        const score = Number(newB);
        if (!newA.trim() || !Number.isFinite(score)) {
          setError(t("scoreMustBeNumber"));
          return;
        }
        payload = { action: "zset.set", field: newA, score };
        break;
      }
      case "stream": {
        try {
          const parsed = JSON.parse(newA);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
            setError(t("messageJsonRequired"));
            return;
          }
        } catch {
          setError(t("messageJsonInvalid"));
          return;
        }
        payload = { action: "stream.add", value: newA };
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
      setNewA("");
      setNewB("");
    }
  };

  return (
    <>
      <div className={`entry-table with-actions ${type}`}>
        <div className="entry-row entry-head">
          <span>{columnA}</span>
          {type !== "set" && <span>{columnB}</span>}
          <span />
        </div>

        {entries.map((entry) => {
          const id = rowId(entry);
          const isEditing = editing?.row === id;
          const isConfirming = confirming === id;

          return (
            <div className="entry-row" key={id}>
              {type === "set" ? (
                <span className="entry-value">{entry.value}</span>
              ) : (
                <>
                  <span className="entry-field">{entry.field}</span>
                  {isEditing ? (
                    <input
                      className="cell-input"
                      value={editing.value}
                      autoFocus
                      spellCheck={false}
                      onChange={(event) => setEditing({ row: id, value: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void saveRow(entry);
                        if (event.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <span
                      className={"entry-value" + (editable ? " editable" : "")}
                      onDoubleClick={() => {
                        if (editable && !busy) setEditing({ row: id, value: entry.value });
                      }}
                    >
                      {entry.value}
                    </span>
                  )}
                </>
              )}

              <span className="row-actions">
                {isEditing ? (
                  <>
                    <RowActionButton kind="confirm" title={t("saveTitle")} onClick={() => void saveRow(entry)} />
                    <RowActionButton kind="cancel" title={t("cancelTitle")} onClick={() => setEditing(null)} />
                  </>
                ) : isConfirming ? (
                  <>
                    <RowActionButton kind="confirm" title={t("confirmDeleteTitle")} onClick={() => void deleteRow(entry)} />
                    <RowActionButton kind="cancel" title={t("cancelTitle")} onClick={() => setConfirming(null)} />
                  </>
                ) : (
                  <>
                    <RowActionButton
                      kind={copiedRow === id ? "copied" : "copy"}
                      title={copiedRow === id ? t("copied") : t("copy")}
                      onClick={() => void copyRowValue(id, entry.value)}
                    />
                    {editable && (
                      <RowActionButton
                        kind="edit"
                        title={t("editTitle")}
                        onClick={() => {
                          if (!busy) setEditing({ row: id, value: entry.value });
                        }}
                      />
                    )}
                    <RowActionButton
                      kind="delete"
                      title={t("deleteTitle")}
                      onClick={() => {
                        if (!busy) setConfirming(id);
                      }}
                    />
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {truncated && (
        <p className="notice">
          {type === "zset"
            ? t("zsetTruncated", { shown: entries.length, total: length })
            : t("entriesTruncated", { shown: entries.length, total: length })}
        </p>
      )}

      <div className="add-bar">
        <input
          className="bar-input"
          value={newA}
          placeholder={firstLabel}
          spellCheck={false}
          onChange={(event) => {
            setNewA(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void addEntry();
          }}
        />
        {secondLabel && (
          <input
            className="bar-input narrow"
            value={newB}
            placeholder={secondLabel}
            spellCheck={false}
            onChange={(event) => {
              setNewB(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void addEntry();
            }}
          />
        )}
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void addEntry()}>
          {addLabel}
        </button>
      </div>

      {error && <p className="notice err">{error}</p>}
    </>
  );
}
