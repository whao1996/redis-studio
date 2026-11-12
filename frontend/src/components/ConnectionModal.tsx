import { useEffect, useState, type FormEvent } from "react";
import { useSettings } from "../settings";
import type { ConnectionForm } from "../types";

interface Props {
  open: boolean;
  busy: boolean;
  error: string | null;
  mode: "create" | "edit";
  initial?: ConnectionForm | null;
  groups?: string[];
  onClose: () => void;
  onSubmit: (form: ConnectionForm) => void;
}

const EMPTY_FORM: ConnectionForm = {
  name: "",
  group: "",
  host: "127.0.0.1",
  port: 6379,
  username: "",
  password: "",
  db: 0,
  useTLS: false,
};

export default function ConnectionModal({ open, busy, error, mode, initial, groups = [], onClose, onSubmit }: Props) {
  const { t } = useSettings();
  const [form, setForm] = useState<ConnectionForm>(EMPTY_FORM);
  const isEdit = mode === "edit";

  useEffect(() => {
    if (!open) return;
    setForm(initial ? { ...EMPTY_FORM, ...initial } : EMPTY_FORM);
    // 只在打开时按初始值填充，避免父组件重渲染时覆盖用户输入。
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

  const update = <K extends keyof ConnectionForm>(key: K, value: ConnectionForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({
      ...form,
      name: form.name.trim(),
      group: form.group.trim(),
      host: form.host.trim(),
      port: Number(form.port) || 6379,
      db: Math.max(0, Number(form.db) || 0),
    });
  };

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
            <h2>{isEdit ? t("editConnection") : t("newConnection")}</h2>
            <p>{isEdit ? t("editConnectionHint") : t("connectionDetailsMemory")}</p>
          </div>
          <button type="button" className="icon-btn" title={t("close")} onClick={onClose} disabled={busy}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <label className="field">
            <span>{t("name")}</span>
            <input
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder={t("namePlaceholder")}
              autoFocus
            />
          </label>

          <label className="field">
            <span>{t("connectionGroup")}</span>
            <input
              value={form.group}
              onChange={(event) => update("group", event.target.value)}
              placeholder={t("connectionGroupPlaceholder")}
              list="connection-group-options"
              maxLength={40}
              spellCheck={false}
            />
            <datalist id="connection-group-options">
              {groups.map((group) => (
                <option key={group} value={group} />
              ))}
            </datalist>
          </label>

          <div className="field-row">
            <label className="field grow">
              <span>{t("host")}</span>
              <input
                value={form.host}
                onChange={(event) => update("host", event.target.value)}
                placeholder="127.0.0.1"
                spellCheck={false}
                required
              />
            </label>
            <label className="field port">
              <span>{t("port")}</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(event) => update("port", Number(event.target.value))}
                required
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field grow">
              <span>{t("username")}</span>
              <input
                value={form.username}
                onChange={(event) => update("username", event.target.value)}
                placeholder="default"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label className="field grow">
              <span>{t("password")}</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => update("password", event.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </label>
          </div>

          <div className="field-row align-end">
            <label className="field db">
              <span>{t("database")}</span>
              <input
                type="number"
                min={0}
                value={form.db}
                onChange={(event) => update("db", Number(event.target.value))}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.useTLS}
                onChange={(event) => update("useTLS", event.target.checked)}
              />
              <span>{t("enableTLS")}</span>
            </label>
          </div>

          {error && <p className="form-error">{error}</p>}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !form.host.trim()}>
            {busy ? (isEdit ? t("saving") : t("connecting")) : isEdit ? t("save") : t("connect")}
          </button>
        </div>
      </form>
    </div>
  );
}
