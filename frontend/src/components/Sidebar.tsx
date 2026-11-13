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
  onMoveGroup: (conn: SidebarConnection, group: string) => void;
  onOpenSettings: () => void;
}

interface ConnectionItemProps {
  conn: SidebarConnection;
  active: boolean;
  dragging: boolean;
  onSelect: (conn: SidebarConnection) => void;
  onAction: (conn: SidebarConnection) => void;
  onEdit: (conn: SidebarConnection) => void;
  onRequestDelete: (conn: SidebarConnection) => void;
  onDragStart: (conn: SidebarConnection) => void;
  onDragEnd: () => void;
}

function ConnectionItem({
  conn,
  active,
  dragging,
  onSelect,
  onAction,
  onEdit,
  onRequestDelete,
  onDragStart,
  onDragEnd,
}: ConnectionItemProps) {
  const { t } = useSettings();

  return (
    <div
      className={"conn-item" + (active ? " active" : "") + (dragging ? " dragging" : "")}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", conn.id);
        onDragStart(conn);
      }}
      onDragEnd={onDragEnd}
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 17H7A5 5 0 0 1 7 7h1" />
              <path d="M15 7h2a5 5 0 1 1 0 10h-1" />
              <path d="M8 12h4" />
              <path d="m2 2 20 20" />
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

export default function Sidebar({ connections, activeId, onSelect, onAdd, onAction, onEdit, onMoveGroup, onOpenSettings }: Props) {
  const { t } = useSettings();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<SidebarConnection | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

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

  const endDrag = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

  const handleDrop = (group: string) => {
    const conn = connections.find((item) => item.id === draggingId);
    if (!conn) {
      endDrag();
      return;
    }

    const current = conn.group?.trim() ?? "";
    if (current !== group) {
      onMoveGroup(conn, group);
    }
    setCollapsedGroups((prev) => {
      if (!prev.has(group)) return prev;
      const next = new Set(prev);
      next.delete(group);
      return next;
    });
    endDrag();
  };

  const draggingGroup = connections.find((conn) => conn.id === draggingId)?.group?.trim() ?? "";

  const renderGroup = (group: string, list: SidebarConnection[]) => {
    const open = !collapsedGroups.has(group);
    const canDrop = draggingId !== null && draggingGroup !== group;
    return (
      <div
        className={
          "conn-group" +
          (open ? " open" : "") +
          (dropTarget === group && canDrop ? " drop-target" : "")
        }
        key={group || "__ungrouped__"}
        onDragOver={(event) => {
          if (!canDrop) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          if (dropTarget !== group) setDropTarget(group);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropTarget((current) => (current === group ? null : current));
          }
        }}
        onDrop={(event) => {
          if (!canDrop) return;
          event.preventDefault();
          handleDrop(group);
        }}
      >
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
                dragging={draggingId === conn.id}
                onSelect={onSelect}
                onAction={onAction}
                onEdit={onEdit}
                onRequestDelete={setPendingDelete}
                onDragStart={(item) => setDraggingId(item.id)}
                onDragEnd={endDrag}
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
          <button type="button" className="icon-btn conn-add-btn" title={t("newConnection")} onClick={onAdd}>
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
              {(ungrouped.length > 0 || draggingId !== null) && renderGroup("", ungrouped)}
            </>
          ) : (
            connections.map((conn) => (
              <ConnectionItem
                key={conn.id}
                conn={conn}
                active={conn.id === activeId}
                dragging={draggingId === conn.id}
                onSelect={onSelect}
                onAction={onAction}
                onEdit={onEdit}
                onRequestDelete={setPendingDelete}
                onDragStart={(item) => setDraggingId(item.id)}
                onDragEnd={endDrag}
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
