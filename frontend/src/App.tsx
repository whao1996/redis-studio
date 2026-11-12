import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { api } from "./api";
import ConnectionModal from "./components/ConnectionModal";
import ConsolePage from "./components/ConsolePage";
import KeyBrowser from "./components/KeyBrowser";
import NewKeyModal from "./components/NewKeyModal";
import PubSubPage from "./components/PubSubPage";
import SettingsModal from "./components/SettingsModal";
import Sidebar from "./components/Sidebar";
import SlowLogPage from "./components/SlowLogPage";
import StatusPage from "./components/StatusPage";
import AnalysisPage from "./components/AnalysisPage";
import ValuePanel from "./components/ValuePanel";
import { errorText } from "./format";
import { useSettings } from "./settings";
import "./titlebar";
import type {
  ConnectionForm,
  ConnectionInfo,
  CreateKeyForm,
  DatabaseInfo,
  EditPayload,
  KeyInfo,
  SavedConnection,
  SidebarConnection,
  ValueResult,
} from "./types";

const PAGE_SIZE = 200;
const KEY_PANE_STORAGE = "redis-studio.key-pane-ratio";
const KEY_PANE_WIDTH_STORAGE = "redis-studio.key-pane-content-width";
const DEFAULT_KEY_PANE_RATIO = 0.55;
const MIN_KEY_PANE_RATIO = 0.15;
const MAX_KEY_PANE_RATIO = 0.8;
const KEY_PANE_MAX_WIDTH = 720;
const KEY_PANE_FALLBACK_WIDTH = 428;

function clampRatio(value: number): number {
  return Math.min(MAX_KEY_PANE_RATIO, Math.max(MIN_KEY_PANE_RATIO, value));
}

function loadKeyPaneRatio(): number {
  const saved = Number(window.localStorage.getItem(KEY_PANE_STORAGE));
  return Number.isFinite(saved) && saved >= MIN_KEY_PANE_RATIO && saved <= MAX_KEY_PANE_RATIO
    ? saved
    : DEFAULT_KEY_PANE_RATIO;
}

function loadKeyPaneContentWidth(): number {
  const saved = Number(window.localStorage.getItem(KEY_PANE_WIDTH_STORAGE));
  return Number.isFinite(saved) && saved >= 300 && saved <= KEY_PANE_MAX_WIDTH
    ? saved
    : KEY_PANE_FALLBACK_WIDTH;
}

type Toast = { kind: "ok" | "err"; text: string };

export default function App() {
  const { t } = useSettings();
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [saved, setSaved] = useState<SavedConnection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [activeDB, setActiveDB] = useState(0);
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [pattern, setPattern] = useState("*");
  const [appliedPattern, setAppliedPattern] = useState("*");
  const [loadingDBs, setLoadingDBs] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [selected, setSelected] = useState<ValueResult | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loadingValue, setLoadingValue] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedConnection | null>(null);
  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const [newKeyBusy, setNewKeyBusy] = useState(false);
  const [newKeyError, setNewKeyError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState<"keys" | "status" | "analysis" | "console" | "pubsub" | "slowlog">("keys");
  const [keyPaneRatio, setKeyPaneRatio] = useState(loadKeyPaneRatio);
  const [keyPaneContentWidth, setKeyPaneContentWidth] = useState(loadKeyPaneContentWidth);
  const [resizingPanes, setResizingPanes] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const paneDragRef = useRef({ active: false, ratio: keyPaneRatio });
  const keyPaneCap = Math.max(300, Math.min(KEY_PANE_MAX_WIDTH, keyPaneContentWidth));
  const handleKeyPaneContentWidth = useCallback((width: number) => {
    const next = Math.min(KEY_PANE_MAX_WIDTH, width);
    setKeyPaneContentWidth((prev) => {
      if (Math.abs(prev - next) < 2) return prev;
      window.localStorage.setItem(KEY_PANE_WIDTH_STORAGE, String(next));
      return next;
    });
  }, []);
  const [toast, setToast] = useState<Toast | null>(null);

  const keysRef = useRef<KeyInfo[]>([]);
  const cursorRef = useRef("0");
  const scanToken = useRef(0);
  const valueToken = useRef(0);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setSaved(await api.listSavedConnections());
      } catch (error) {
        showToast("err", errorText(error, t));
      }
    })();
  }, []);

  useEffect(() => {
    if (!resizingPanes) return;
    document.body.classList.add("is-resizing-panes");
    return () => document.body.classList.remove("is-resizing-panes");
  }, [resizingPanes]);

  function showToast(kind: Toast["kind"], text: string) {
    setToast({ kind, text });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), kind === "err" ? 5000 : 2500);
  }

  function applyPaneRatio(value: number, persist = true) {
    const ratio = clampRatio(value);
    paneDragRef.current.ratio = ratio;
    setKeyPaneRatio(ratio);
    if (persist) {
      window.localStorage.setItem(KEY_PANE_STORAGE, ratio.toFixed(4));
    }
  }

  function handlePaneResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    paneDragRef.current.active = true;
    setResizingPanes(true);
  }

  function handlePaneResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!paneDragRef.current.active) return;
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;

    const gutter = 6;
    const minKey = 300;
    const minValue = 360;
    const maxKey = Math.max(minKey, Math.min(rect.width - minValue - gutter, keyPaneCap));
    const keyWidth = Math.min(maxKey, Math.max(minKey, event.clientX - rect.left));
    applyPaneRatio(keyWidth / rect.width, false);
  }

  function handlePaneResizeEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!paneDragRef.current.active) return;
    paneDragRef.current.active = false;
    setResizingPanes(false);
    applyPaneRatio(paneDragRef.current.ratio);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handlePaneResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 0.05 : 0.02;
    applyPaneRatio(keyPaneRatio + (event.key === "ArrowLeft" ? -step : step));
  }

  function resetPaneRatio() {
    applyPaneRatio(DEFAULT_KEY_PANE_RATIO);
  }

  async function refreshSaved() {
    try {
      setSaved(await api.listSavedConnections());
    } catch (error) {
      showToast("err", errorText(error, t));
    }
  }

  function applyKeys(next: KeyInfo[]) {
    keysRef.current = next;
    setKeys(next);
  }

  function resetSelection() {
    valueToken.current++;
    setSelected(null);
    setSelectedKey(null);
    setLoadingValue(false);
  }

  async function loadKeys(id: string, db: number, matchPattern: string, reset: boolean) {
    const token = ++scanToken.current;
    setLoadingKeys(true);

    if (reset) {
      applyKeys([]);
      cursorRef.current = "0";
      setHasMore(false);
    }

    try {
      let cursor = reset ? "0" : cursorRef.current;
      let merged = reset ? [] : [...keysRef.current];
      let more = false;

      // SCAN 可能返回空页，连续跟几页直到有数据或到达末尾。
      for (let page = 0; page < 5; page++) {
        const result = await api.scanKeys(id, db, cursor, matchPattern, PAGE_SIZE);
        if (token !== scanToken.current) return;

        const incoming = result.keys ?? [];
        if (incoming.length > 0) {
          const seen = new Set(merged.map((item) => item.key));
          for (const item of incoming) {
            if (!seen.has(item.key)) {
              seen.add(item.key);
              merged.push(item);
            }
          }
        }

        cursor = result.cursor;
        more = result.hasMore;
        if (merged.length > (reset ? 0 : keysRef.current.length) || !more) break;
      }

      applyKeys(merged);
      cursorRef.current = cursor;
      setHasMore(more);
    } catch (error) {
      if (token === scanToken.current) showToast("err", errorText(error, t));
    } finally {
      if (token === scanToken.current) setLoadingKeys(false);
    }
  }

  async function loadValue(key: string, id = activeId, db = activeDB) {
    if (!id) return;

    const token = ++valueToken.current;
    setSelectedKey(key);
    setLoadingValue(true);

    try {
      const value = await api.getValue(id, db, key);
      if (token !== valueToken.current) return;
      setSelected(value);
    } catch (error) {
      if (token === valueToken.current) {
        setSelected(null);
        showToast("err", errorText(error, t));
      }
    } finally {
      if (token === valueToken.current) setLoadingValue(false);
    }
  }

  async function activateConnection(conn: ConnectionInfo) {
    setActiveId(conn.id);
    resetSelection();
    setDatabases([]);
    setActiveDB(0);
    setPattern("*");
    setAppliedPattern("*");
    applyKeys([]);
    cursorRef.current = "0";
    setHasMore(false);
    setLoadingDBs(true);

    try {
      const dbs = await api.listDatabases(conn.id);
      setDatabases(dbs);
      setActiveDB(0);
      await loadKeys(conn.id, 0, "*", true);
    } catch (error) {
      showToast("err", errorText(error, t));
    } finally {
      setLoadingDBs(false);
    }
  }

  function clearWorkspace() {
    scanToken.current++;
    setActiveId(null);
    setView("keys");
    setDatabases([]);
    setActiveDB(0);
    applyKeys([]);
    cursorRef.current = "0";
    setHasMore(false);
    setLoadingKeys(false);
    resetSelection();
  }

  async function handleConnect(form: ConnectionForm) {
    setModalBusy(true);
    setModalError(null);

    try {
      const info = await api.connect(form);
      setConnections((prev) => [...prev.filter((conn) => conn.id !== info.id), info]);
      setModalOpen(false);
      await refreshSaved();
      await activateConnection(info);
      showToast("ok", t("connectedTo", { addr: info.address }));
    } catch (error) {
      setModalError(errorText(error, t));
    } finally {
      setModalBusy(false);
    }
  }

  async function handleUpdateConnection(form: ConnectionForm) {
    if (!editing) return;

    setModalBusy(true);
    setModalError(null);
    try {
      await api.updateSavedConnection({
        id: editing.id,
        name: form.name,
        group: form.group,
        host: form.host,
        port: form.port,
        username: form.username,
        password: form.password,
        db: form.db,
        useTLS: form.useTLS,
      });
      await refreshSaved();
      setModalOpen(false);
      setEditing(null);
      showToast("ok", t("connectionUpdated"));
    } catch (error) {
      setModalError(errorText(error, t));
    } finally {
      setModalBusy(false);
    }
  }

  async function handleSelectConnection(item: SidebarConnection) {
    const active = connections.find((conn) => conn.id === item.id);
    if (active) {
      if (active.id === activeId) {
        void refreshAll();
      } else {
        void activateConnection(active);
      }
      return;
    }

    const profile = saved.find((entry) => entry.id === item.id);
    if (!profile) return;

    try {
      const info = await api.connect({
        profileID: profile.id,
        name: profile.name || `${profile.host}:${profile.port}`,
        group: profile.group ?? "",
        host: profile.host,
        port: profile.port,
        username: profile.username,
        password: profile.password,
        db: profile.db,
        useTLS: profile.useTLS,
      });
      setConnections((prev) => [...prev.filter((conn) => conn.id !== info.id), info]);
      await refreshSaved();
      await activateConnection(info);
      showToast("ok", t("connectedTo", { addr: info.address }));
    } catch (error) {
      showToast("err", errorText(error, t));
    }
  }

  async function handleDeleteSaved(id: string) {
    try {
      await api.deleteSavedConnection(id);
      const restSaved = saved.filter((profile) => profile.id !== id);
      setSaved(restSaved);

      const restActive = connections.filter((conn) => conn.id !== id);
      setConnections(restActive);

      if (activeId === id) {
        if (restActive.length > 0) {
          void activateConnection(restActive[0]);
        } else {
          clearWorkspace();
        }
      }
      showToast("ok", t("deletedConnection"));
    } catch (error) {
      showToast("err", errorText(error, t));
    }
  }

  async function handleDisconnect(id: string) {
    try {
      await api.disconnect(id);
    } catch {
      // 连接可能已失效，继续移除本地条目。
    }

    const rest = connections.filter((conn) => conn.id !== id);
    setConnections(rest);

    if (activeId === id) {
      if (rest.length > 0) {
        void activateConnection(rest[0]);
      } else {
        clearWorkspace();
      }
    }
  }

  async function refreshDatabases(id = activeId) {
    if (!id) return;
    try {
      const dbs = await api.listDatabases(id);
      setDatabases(dbs);
    } catch (error) {
      showToast("err", errorText(error, t));
    }
  }

  async function refreshAll() {
    if (!activeId) return;
    await refreshDatabases(activeId);
    await loadKeys(activeId, activeDB, appliedPattern, true);
    if (selectedKey) await loadValue(selectedKey, activeId, activeDB);
  }

  function changeDB(db: number) {
    if (!activeId || db === activeDB) return;
    setActiveDB(db);
    resetSelection();
    void loadKeys(activeId, db, appliedPattern, true);
  }

  function applySearch() {
    if (!activeId) return;
    const nextPattern = pattern.trim() || "*";
    setAppliedPattern(nextPattern);
    resetSelection();
    void loadKeys(activeId, activeDB, nextPattern, true);
  }

  async function handleSave(value: string, ttlSeconds: number): Promise<boolean> {
    if (!activeId || !selected) return false;

    try {
      await api.setString(activeId, activeDB, selected.key, value, ttlSeconds);
      setKeys((prev) => {
        const next = prev.map((item) =>
          item.key === selected.key ? { ...item, ttl: ttlSeconds > 0 ? ttlSeconds : -1 } : item
        );
        keysRef.current = next;
        return next;
      });
      await loadValue(selected.key, activeId, activeDB);
      showToast("ok", t("saved"));
      return true;
    } catch (error) {
      showToast("err", errorText(error, t));
      return false;
    }
  }

  async function handleEdit(payload: EditPayload): Promise<boolean> {
    if (!activeId || !selected) return false;

    try {
      await api.edit(activeId, activeDB, selected.key, payload);
      await loadValue(selected.key, activeId, activeDB);
      return true;
    } catch (error) {
      showToast("err", errorText(error, t));
      return false;
    }
  }

  async function handleCreateKey(form: CreateKeyForm) {
    if (!activeId) return;

    setNewKeyBusy(true);
    setNewKeyError(null);
    try {
      await api.createKey(activeId, activeDB, form);
      setNewKeyOpen(false);
      await refreshDatabases(activeId);
      await loadKeys(activeId, activeDB, appliedPattern, true);
      await loadValue(form.key, activeId, activeDB);
      showToast("ok", t("createdKey", { key: form.key }));
    } catch (error) {
      setNewKeyError(errorText(error, t));
    } finally {
      setNewKeyBusy(false);
    }
  }

  async function handleDelete() {
    if (!activeId || !selected) return;

    try {
      await api.deleteKey(activeId, activeDB, selected.key);
      const next = keysRef.current.filter((item) => item.key !== selected.key);
      applyKeys(next);
      resetSelection();
      void refreshDatabases(activeId);
      showToast("ok", t("deleted"));
    } catch (error) {
      showToast("err", errorText(error, t));
    }
  }

  const sidebarConnections: SidebarConnection[] = saved.map((profile) => {
    const active = connections.find((conn) => conn.id === profile.id);
    return {
      id: profile.id,
      name: profile.name || `${profile.host}:${profile.port}`,
      group: profile.group ?? "",
      address: `${profile.host}:${profile.port}`,
      version: active?.version ?? "",
      connected: Boolean(active),
    };
  });

  for (const conn of connections) {
    if (!sidebarConnections.some((item) => item.id === conn.id)) {
      sidebarConnections.push({ ...conn, group: "", connected: true });
    }
  }

  const connectionGroups = Array.from(
    new Set(saved.map((profile) => profile.group?.trim()).filter((group): group is string => Boolean(group)))
  ).sort((a, b) => a.localeCompare(b));

  return (
    <div className="app">
      <Sidebar
        connections={sidebarConnections}
        activeId={activeId}
        onSelect={(conn) => void handleSelectConnection(conn)}
        onAdd={() => {
          setEditing(null);
          setModalError(null);
          setModalOpen(true);
        }}
        onAction={(conn) => {
          if (conn.connected) {
            void handleDisconnect(conn.id);
          } else {
            void handleDeleteSaved(conn.id);
          }
        }}
        onEdit={(conn) => {
          const profile = saved.find((entry) => entry.id === conn.id);
          if (!profile) return;
          setEditing(profile);
          setModalError(null);
          setModalOpen(true);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <label className="db-picker">
              <span>DB</span>
              <select
                value={activeDB}
                onChange={(event) => changeDB(Number(event.target.value))}
                disabled={!activeId}
              >
                {databases.length === 0 ? (
                  <option value={0}>db0</option>
                ) : (
                  databases.map((db) => (
                    <option key={db.index} value={db.index}>
                      db{db.index}
                      {db.keys >= 0 ? ` · ${db.keys} keys` : ""}
                    </option>
                  ))
                )}
              </select>
            </label>

            {view === "keys" && (
              <div className="search-box">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  value={pattern}
                  onChange={(event) => setPattern(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applySearch();
                  }}
                  placeholder={t("searchPlaceholder")}
                  disabled={!activeId}
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="search-btn"
                  onClick={applySearch}
                  disabled={!activeId}
                >
                  {t("search")}
                </button>
              </div>
            )}
          </div>

          <div className="topbar-right">
            {loadingDBs && <span className="muted">{t("loadingDatabases")}</span>}
            <div className="view-tabs">
              <button
                type="button"
                className={"view-tab" + (view === "keys" ? " active" : "")}
                onClick={() => setView("keys")}
              >
                {t("tabKeys")}
              </button>
              <button
                type="button"
                className={"view-tab" + (view === "status" ? " active" : "")}
                disabled={!activeId}
                onClick={() => setView("status")}
              >
                {t("tabStatus")}
              </button>
              <button
                type="button"
                className={"view-tab" + (view === "analysis" ? " active" : "")}
                disabled={!activeId}
                onClick={() => setView("analysis")}
              >
                {t("tabAnalysis")}
              </button>
              <button
                type="button"
                className={"view-tab" + (view === "console" ? " active" : "")}
                disabled={!activeId}
                onClick={() => setView("console")}
              >
                {t("tabConsole")}
              </button>
              <button
                type="button"
                className={"view-tab" + (view === "pubsub" ? " active" : "")}
                disabled={!activeId}
                onClick={() => setView("pubsub")}
              >
                {t("tabPubsub")}
              </button>
              <button
                type="button"
                className={"view-tab" + (view === "slowlog" ? " active" : "")}
                disabled={!activeId}
                onClick={() => setView("slowlog")}
              >
                {t("tabSlowlog")}
              </button>
            </div>
            <button type="button" className="btn btn-ghost" onClick={() => void refreshAll()} disabled={!activeId}>
              {t("refresh")}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!activeId}
              onClick={() => {
                setNewKeyError(null);
                setNewKeyOpen(true);
              }}
            >
              {t("newKey")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setEditing(null);
                setModalError(null);
                setModalOpen(true);
              }}
            >
              {t("newConnection")}
            </button>
          </div>
        </header>

        {view === "status" && activeId ? (
          <StatusPage id={activeId} />
        ) : view === "analysis" && activeId ? (
          <AnalysisPage id={activeId} db={activeDB} />
        ) : view === "console" && activeId ? (
          <ConsolePage id={activeId} db={activeDB} />
        ) : view === "slowlog" && activeId ? (
          <SlowLogPage id={activeId} />
        ) : view === "pubsub" ? null : (
          <div
            className="content"
            ref={contentRef}
            style={{
              gridTemplateColumns: `minmax(300px, min(${(keyPaneRatio * 100).toFixed(
                2
              )}%, ${keyPaneCap}px)) 6px minmax(0, 1fr)`,
            }}
          >
            <KeyBrowser
              keys={keys}
              selectedKey={selectedKey}
              loading={loadingKeys}
              hasMore={hasMore}
              hasConnection={activeId !== null}
              treeScope={`${activeId ?? "none"}:${activeDB}:${appliedPattern}`}
              autoExpand={appliedPattern !== "*"}
              onSelect={(key) => void loadValue(key)}
              onLoadMore={() => {
                if (activeId) void loadKeys(activeId, activeDB, appliedPattern, false);
              }}
              onRefresh={() => {
                if (activeId) void loadKeys(activeId, activeDB, appliedPattern, true);
              }}
              onContentWidth={handleKeyPaneContentWidth}
            />

            <div
              className={"pane-resizer" + (resizingPanes ? " dragging" : "")}
              role="separator"
              aria-orientation="vertical"
              aria-label={t("resizePanes")}
              title={t("resizePanes")}
              tabIndex={0}
              onPointerDown={handlePaneResizeStart}
              onPointerMove={handlePaneResizeMove}
              onPointerUp={handlePaneResizeEnd}
              onPointerCancel={handlePaneResizeEnd}
              onLostPointerCapture={handlePaneResizeEnd}
              onDoubleClick={resetPaneRatio}
              onKeyDown={handlePaneResizeKeyDown}
            />

            <ValuePanel
              value={selected}
              loading={loadingValue}
              onSave={handleSave}
              onEdit={handleEdit}
              onDelete={() => void handleDelete()}
              onRefresh={() => {
                if (selectedKey) void loadValue(selectedKey);
              }}
            />
          </div>
        )}

        {activeId && (
          <div className={view === "pubsub" ? "pubsub-host" : "pubsub-host hidden"}>
            <PubSubPage id={activeId} db={activeDB} />
          </div>
        )}
      </main>

      <ConnectionModal
        open={modalOpen}
        busy={modalBusy}
        error={modalError}
        mode={editing ? "edit" : "create"}
        groups={connectionGroups}
        initial={
          editing
            ? {
                profileID: editing.id,
                name: editing.name,
                group: editing.group ?? "",
                host: editing.host,
                port: editing.port,
                username: editing.username,
                password: editing.password,
                db: editing.db,
                useTLS: editing.useTLS,
              }
            : null
        }
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSubmit={(form) => {
          if (editing) {
            void handleUpdateConnection(form);
          } else {
            void handleConnect(form);
          }
        }}
      />

      <NewKeyModal
        open={newKeyOpen}
        db={activeDB}
        busy={newKeyBusy}
        error={newKeyError}
        onClose={() => setNewKeyOpen(false)}
        onSubmit={(form) => void handleCreateKey(form)}
      />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
