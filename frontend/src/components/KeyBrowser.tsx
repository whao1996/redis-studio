import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatBytes, formatTTL, typeLabel } from "../format";
import { buildKeyTree, collectFolderPaths, keyLeafLabel, type KeyFolder } from "../keyTree";
import { useSettings } from "../settings";
import type { KeyInfo } from "../types";

const FOLDER_RENDER_STEP = 200;

interface Props {
  keys: KeyInfo[];
  selectedKey: string | null;
  loading: boolean;
  hasMore: boolean;
  hasConnection: boolean;
  treeScope: string;
  autoExpand: boolean;
  onSelect: (key: string) => void;
  onLoadMore: () => void;
  onLoadAll: () => void;
  onRefresh: () => void;
  onContentWidth: (width: number) => void;
}

interface FolderRowProps {
  folder: KeyFolder;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  limits: Record<string, number>;
  onShowMore: (path: string) => void;
}

function FolderRow({
  folder,
  depth,
  expanded,
  onToggle,
  selectedKey,
  onSelect,
  limits,
  onShowMore,
}: FolderRowProps) {
  const { t } = useSettings();
  const open = expanded.has(folder.path);
  const limit = limits[folder.path] ?? FOLDER_RENDER_STEP;
  const visibleKeys = folder.keys.slice(0, limit);
  const remaining = folder.keys.length - visibleKeys.length;

  return (
    <>
      <button
        type="button"
        className={"tree-row tree-folder" + (open ? " open" : "")}
        onClick={() => onToggle(folder.path)}
        title={folder.path}
      >
        <span className="tree-label" style={{ paddingLeft: depth * 16 }}>
          <svg className={"caret" + (open ? " open" : "")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 6 6 6-6 6" />
          </svg>
          <svg className="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17V7.5Z" />
          </svg>
          <span className="tree-name">{folder.name}</span>
          <span className="tree-count">{folder.count}</span>
        </span>
        <span />
        <span />
      </button>

      {open && (
        <>
          {folder.folders.map((child) => (
            <FolderRow
              key={child.path}
              folder={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedKey={selectedKey}
              onSelect={onSelect}
              limits={limits}
              onShowMore={onShowMore}
            />
          ))}
          {visibleKeys.map((item) => (
            <LeafRow
              key={item.key}
              item={item}
              depth={depth + 1}
              selectedKey={selectedKey}
              onSelect={onSelect}
            />
          ))}
          {remaining > 0 && (
            <button
              type="button"
              className="tree-more-row"
              style={{ paddingLeft: 18 + (depth + 1) * 16 }}
              onClick={() => onShowMore(folder.path)}
            >
              {t("showMoreKeys", { count: remaining })}
            </button>
          )}
        </>
      )}
    </>
  );
}

interface LeafRowProps {
  item: KeyInfo;
  depth: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

function LeafRow({ item, depth, selectedKey, onSelect }: LeafRowProps) {
  const { t } = useSettings();

  return (
    <div
      className={"tree-row tree-leaf" + (selectedKey === item.key ? " selected" : "")}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item.key)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(item.key);
        }
      }}
      title={item.key}
    >
      <span className="tree-label" style={{ paddingLeft: depth * 16 }}>
        <span className="caret-spacer" />
        <span className={`type-badge type-${item.type}`}>{typeLabel(item.type)}</span>
        <span className="tree-name">{keyLeafLabel(item.key)}</span>
      </span>
      <span className="key-ttl">{formatTTL(item.ttl, t)}</span>
      <span className="key-size">{formatBytes(item.size)}</span>
    </div>
  );
}

export default function KeyBrowser({
  keys,
  selectedKey,
  loading,
  hasMore,
  hasConnection,
  treeScope,
  autoExpand,
  onSelect,
  onLoadMore,
  onLoadAll,
  onRefresh,
  onContentWidth,
}: Props) {
  const { t, fontSize } = useSettings();
  const tree = useMemo(() => buildKeyTree(keys), [keys]);
  const folderPaths = useMemo(() => collectFolderPaths(tree), [tree]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [folderLimits, setFolderLimits] = useState<Record<string, number>>({});
  const rootLimit = folderLimits[""] ?? FOLDER_RENDER_STEP;
  const rootKeys = tree.keys.slice(0, rootLimit);
  const rootRemaining = tree.keys.length - rootKeys.length;
  const tableRef = useRef<HTMLDivElement>(null);

  const showMore = (path: string) => {
    setFolderLimits((prev) => ({
      ...prev,
      [path]: (prev[path] ?? FOLDER_RENDER_STEP) + FOLDER_RENDER_STEP,
    }));
  };

  useEffect(() => {
    setExpanded(new Set());
    setFolderLimits({});
  }, [treeScope]);

  useEffect(() => {
    if (!autoExpand || folderPaths.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const path of folderPaths) next.add(path);
      return next;
    });
  }, [autoExpand, folderPaths]);

  const allExpanded = folderPaths.length > 0 && folderPaths.every((path) => expanded.has(path));

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const toggleAll = () => {
    setExpanded(allExpanded ? new Set() : new Set(folderPaths));
  };

  // 计算当前可见行真正需要的宽度，供外层限制键列表最大宽度。
  useLayoutEffect(() => {
    const root = tableRef.current;
    if (!root) return;

    const rows = Array.from(root.querySelectorAll<HTMLElement>(".tree-row"));
    if (rows.length === 0) return;

    let labelWidth = 0;
    for (const row of rows) {
      const label = row.querySelector<HTMLElement>(".tree-label");
      const name = row.querySelector<HTMLElement>(".tree-name");
      if (!label || !name) continue;

      const labelStyle = getComputedStyle(label);
      const labelGap = parseFloat(labelStyle.columnGap) || 0;
      const children = Array.from(label.children) as HTMLElement[];
      let fixedWidth = 0;
      for (const child of children) {
        if (child === name) continue;
        fixedWidth += child.getBoundingClientRect().width;
      }
      fixedWidth += labelGap * Math.max(0, children.length - 1);

      labelWidth = Math.max(
        labelWidth,
        (parseFloat(labelStyle.paddingLeft) || 0) + fixedWidth + name.scrollWidth
      );
    }

    const head = root.querySelector<HTMLElement>(".key-head");
    const sample = rows[0];
    if (!head || !sample || head.children.length < 3) return;

    const rowStyle = getComputedStyle(sample);
    const gap = parseFloat(rowStyle.columnGap) || 0;
    const padding =
      (parseFloat(rowStyle.paddingLeft) || 0) + (parseFloat(rowStyle.paddingRight) || 0);
    const fixedWidth =
      head.children[1].getBoundingClientRect().width +
      head.children[2].getBoundingClientRect().width;
    const required = Math.ceil(labelWidth + fixedWidth + gap * 2 + padding + 24);
    onContentWidth(required);
  }, [tree, expanded, fontSize, onContentWidth]);

  return (
    <section className="keys-panel">
      <div className="panel-head">
        <span>{t("keys")}</span>
        <div className="panel-head-right">
          <span className="panel-hint">{t("groupHint")}</span>
          <button
            type="button"
            className="link-btn"
            onClick={toggleAll}
            disabled={folderPaths.length === 0}
          >
            {allExpanded ? t("collapseAll") : t("expandAll")}
          </button>
        </div>
      </div>

      <div className="key-table" ref={tableRef}>
        <div className="key-row key-head">
          <span>{t("keyColumn")}</span>
          <span className="key-ttl-head">{t("ttlColumn")}</span>
          <span className="key-size-head">{t("sizeColumn")}</span>
        </div>

        {!hasConnection && (
          <div className="panel-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
              <ellipse cx="12" cy="5" rx="8" ry="3" />
              <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
              <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
            </svg>
            <p>{t("noConnectionTitle")}</p>
            <span>{t("noConnectionSub")}</span>
          </div>
        )}

        {hasConnection && keys.length === 0 && !loading && (
          <div className="panel-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <p>{t("noKeysTitle")}</p>
            <span>{t("noKeysSub")}</span>
          </div>
        )}

        {tree.folders.map((folder) => (
          <FolderRow
            key={folder.path}
            folder={folder}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            selectedKey={selectedKey}
            onSelect={onSelect}
            limits={folderLimits}
            onShowMore={showMore}
          />
        ))}

        {tree.keys.map((item) => (
          <LeafRow
            key={item.key}
            item={item}
            depth={0}
            selectedKey={selectedKey}
            onSelect={onSelect}
          />
        ))}

        {rootRemaining > 0 && (
          <button type="button" className="tree-more-row" style={{ paddingLeft: 18 }} onClick={() => showMore("")}>
            {t("showMoreKeys", { count: rootRemaining })}
          </button>
        )}

        {loading && (
          <div className="key-loading">
            <span className="spinner" />
            {t("scanning")}
          </div>
        )}
      </div>

      <div className="panel-foot">
        <span className="muted">{t("loadedKeys", { count: keys.length })}</span>
        {hasMore ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={onLoadMore} disabled={loading}>
              {t("loadMore")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onLoadAll} disabled={loading}>
              {t("loadAll")}
            </button>
          </>
        ) : (
          <span className="muted">{hasConnection && keys.length > 0 ? t("endOfList") : ""}</span>
        )}
        <button type="button" className="icon-btn" title={t("rescan")} onClick={onRefresh} disabled={!hasConnection || loading}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
      </div>
    </section>
  );
}
