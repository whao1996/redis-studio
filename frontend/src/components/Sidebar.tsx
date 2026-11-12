import { useEffect, useState } from "react";
import { useSettings } from "../settings";
import type { SidebarConnection } from "../types";

interface Props {
  connections: SidebarConnection[];
  activeId: string | null;
  onSelect: (conn: SidebarConnection) => void;
  onAdd: () => void;
  onAction: (conn: SidebarConnection) => void;
  onEdit: (conn: SidebarConnection) => void;
  onOpenSettings: () => void;
}

interface ConnectionItemProps {
  conn: SidebarConnection;
  active: boolean;
  onSelect: (conn: SidebarConnection) => void;
  onAction: (conn: SidebarConnection) => void;
  onEdit: (conn: SidebarConnection) => void;
  onRequestDelete: (conn: SidebarConnection) => void;
}

function ConnectionItem({ conn, active, onSelect, onAction, onEdit, onRequestDelete }: ConnectionItemProps) {
  const { t } = useSettings();

  return (
    <div
      className={"conn-item" + (active ? " active" : "")}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(conn)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(conn);
        }
      }}
    >
      <span className={"status-dot" + (conn.connected ? "" : " idle")} />
      <span className="conn-meta">
        <span className="conn-name">{conn.name}</span>
        <span className="conn-addr">
          {conn.address}
          {conn.connected && conn.version ? ` · v${conn.version}` : ""}
        </span>
      </span>
      <span className="conn-actions">
        <button
          type="button"
          className="conn-close"
          title={conn.connected ? t("disconnect") : t("editConnection")}
          onClick={(event) => {
            event.stopPropagation();
            if (conn.connected) {
              onAction(conn);
            } else {
              onEdit(conn);
            }
          }}
        >
          {conn.connected ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 3v9" />
              <path d="M6.34 6.34a8 8 0 1 0 11.32 0" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
            </svg>
          )}
        </button>
        {!conn.connected && (
          <button
            type="button"
            className="conn-close"
            title={t("deleteConnection")}
            onClick={(event) => {
              event.stopPropagation();
              onRequestDelete(conn);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
            </svg>
          </button>
        )}
      </span>
    </div>
  );
}

export default function Sidebar({ connections, activeId, onSelect, onAdd, onAction, onEdit, onOpenSettings }: Props) {
  const { t } = useSettings();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<SidebarConnection | null>(null);

  useEffect(() => {
    if (!pendingDelete) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingDelete(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingDelete]);

  const groups = new Map<string, SidebarConnection[]>();
  const ungrouped: SidebarConnection[] = [];
  for (const conn of connections) {
    const group = conn.group?.trim() ?? "";
    if (!group) {
      ungrouped.push(conn);
      continue;
    }
    const list = groups.get(group) ?? [];
    list.push(conn);
    groups.set(group, list);
  }
  const groupNames = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
  const hasGroups = groupNames.length > 0;

  // 当前连接所在分组始终保持展开。
  useEffect(() => {
    if (!activeId) return;
    const active = connections.find((conn) => conn.id === activeId);
    const group = active?.group?.trim() ?? "";
    setCollapsedGroups((prev) => {
      if (!prev.has(group)) return prev;
      const next = new Set(prev);
      next.delete(group);
      return next;
    });
  }, [activeId, connections]);

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  const renderGroup = (group: string, list: SidebarConnection[]) => {
    const open = !collapsedGroups.has(group);
    return (
      <div className={"conn-group" + (open ? " open" : "")} key={group || "__ungrouped__"}>
        <button
          type="button"
          className="conn-group-head"
          onClick={() => toggleGroup(group)}
          title={open ? t("collapseGroup") : t("expandGroup")}
        >
          <svg className={"caret" + (open ? " open" : "")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 6 6 6-6 6" />
          </svg>
          <span className="conn-group-name">{group || t("ungroupedConnections")}</span>
          <span className="conn-group-count">{list.length}</span>
        </button>
        {open && (
          <div className="conn-group-list">
            {list.map((conn) => (
              <ConnectionItem
                key={conn.id}
                conn={conn}
                active={conn.id === activeId}
                onSelect={onSelect}
                onAction={onAction}
                onEdit={onEdit}
                onRequestDelete={setPendingDelete}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <ellipse cx="12" cy="5" rx="8" ry="3" />
            <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
            <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
          </svg>
        </div>
        <div className="brand-text">
          <h1>Redis Studio</h1>
          <p>{t("appSubtitle")}</p>
        </div>
      </div>

      <div className="sidebar-section">
        <div className="section-head">
          <span>{t("connections")}</span>
          <button type="button" className="icon-btn" title={t("newConnection")} onClick={onAdd}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>

        <div className="conn-list">
          {connections.length === 0 ? (
            <div className="conn-empty">
              {t("noConnections")}
              <span>{t("addConnectionHint")}</span>
            </div>
          ) : hasGroups ? (
            <>
              {groupNames.map((group) => renderGroup(group, groups.get(group) ?? []))}
              {ungrouped.length > 0 && renderGroup("", ungrouped)}
            </>
          ) : (
            connections.map((conn) => (
              <ConnectionItem
                key={conn.id}
                conn={conn}
                active={conn.id === activeId}
                onSelect={onSelect}
                onAction={onAction}
                onEdit={onEdit}
                onRequestDelete={setPendingDelete}
              />
            ))
          )}
        </div>
      </div>

      <div className="sidebar-footer">
        <button type="button" className="icon-btn settings-btn" title={t("settings")} onClick={onOpenSettings}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </svg>
        </button>
      </div>

      {pendingDelete && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingDelete(null);
          }}
        >
          <div className="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-connection-title">
            <div className="modal-head">
              <div>
                <h2 id="delete-connection-title">{t("deleteConnection")}</h2>
                <p>{t("deleteConnectionConfirm", { name: pendingDelete.name })}</p>
              </div>
              <button
                type="button"
                className="icon-btn"
                title={t("close")}
                onClick={() => setPendingDelete(null)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setPendingDelete(null)} autoFocus>
                {t("cancel")}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  const conn = pendingDelete;
                  setPendingDelete(null);
                  onAction(conn);
                }}
              >
                {t("confirmDelete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
