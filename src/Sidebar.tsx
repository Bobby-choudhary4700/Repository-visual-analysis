import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronRight, ChevronsDownUp, Folder, FolderOpen } from "lucide-react";
import { ROOT, drawnAs } from "./graph";
import { KeyFiles } from "./KeyFiles";
import type { KeyFile } from "./ranking";
import { loadChoice, saveSetting } from "./settings";
import { nameOf, type TreeIndex } from "./tree";

interface Props {
  tree: TreeIndex;
  /** The files the rest of the project leans on most, best first. */
  keyFiles: KeyFile[];
  /** The graph's node colours, so a row matches its node. */
  colorOf: (id: string) => string;
  /** The same open folders as the graph, so both always show the same level of detail. */
  expanded: Set<string>;
  selected: string | null;
  focusRequest: number;
  onToggle: (folderId: string) => void;
  /** Picks a file or folder, as clicking its node in the graph does. */
  onSelect: (path: string) => void;
  /** Hovering a row traces that node in the graph. */
  onHover: (id: string | null) => void;
  onCollapseAll: () => void;
}

type Tab = "files" | "key";
const TABS: { id: Tab; label: string }[] = [
  { id: "files", label: "Files" },
  { id: "key", label: "Key files" },
];
const TAB_IDS = TABS.map((t) => t.id);

/** The explorer: every file as a tree, or the key files as a short list. */
export const Sidebar = memo(function Sidebar({ keyFiles, onCollapseAll, ...treeProps }: Props) {
  const [tab, setTab] = useState<Tab>(() => loadChoice("rva.sidebarTab", TAB_IDS, "files"));
  useEffect(() => saveSetting("rva.sidebarTab", tab), [tab]);
  const { colorOf, expanded, selected, onSelect, onHover } = treeProps;

  // The row under the pointer goes away with its tab, so stop tracing it.
  const pick = (next: Tab) => {
    setTab(next);
    onHover(null);
  };

  // Left and right move between the tabs, as in any tab list.
  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const at = TAB_IDS.indexOf(tab);
    const next = TAB_IDS[(at + (e.key === "ArrowRight" ? 1 : TAB_IDS.length - 1)) % TAB_IDS.length];
    pick(next);
    document.getElementById(`sidebar-tab-${next}`)?.focus();
  };

  return (
    <nav className="sidebar" aria-label="Project files">
      <div className="sidebar-head">
        <div className="segmented" role="tablist" aria-label="Explorer" onKeyDown={onTabKey}>
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              id={`sidebar-tab-${id}`}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`sidebar-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              className={tab === id ? "active" : undefined}
              onClick={() => pick(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "files" && (
          <button className="icon-btn" title="Close all folders" onClick={onCollapseAll}>
            <ChevronsDownUp size={15} />
          </button>
        )}
      </div>
      {tab === "files" ? (
        <FileTree {...treeProps} />
      ) : (
        <div className="key-files" id="sidebar-panel-key" role="tabpanel" aria-labelledby="sidebar-tab-key">
          <KeyFiles
            files={keyFiles}
            colorOf={colorOf}
            selected={selected}
            onSelect={onSelect}
            // A file inside a closed folder is traced through that folder.
            onHover={(path) => onHover(path && drawnAs(path, expanded))}
          />
        </div>
      )}
    </nav>
  );
});

type Row = { id: string; depth: number; folder: boolean };

/** Every row has this height, which is what lets the list draw only the rows in view. */
const ROW_HEIGHT = 26;
/** Rows drawn beyond each edge of the view, so fast scrolling shows no gaps. */
const OVERSCAN = 10;

/**
 * File tree that mirrors the graph: opening a folder here opens it there too. Only the
 * rows in view are drawn, so a folder of thousands of files opens as fast as a small one.
 */
function FileTree({
  tree,
  colorOf,
  expanded,
  selected,
  focusRequest,
  onToggle,
  onSelect,
  onHover,
}: Omit<Props, "keyFiles" | "onCollapseAll">) {
  // Only open folders contribute rows, so a huge project costs no more than what is shown.
  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (dir: string, depth: number) => {
      const entry = tree.children.get(dir);
      if (!entry) return;
      for (const folder of entry.folders) {
        out.push({ id: folder, depth, folder: true });
        if (expanded.has(folder)) walk(folder, depth + 1);
      }
      for (const file of entry.files) out.push({ id: file, depth, folder: false });
    };
    walk(ROOT, 0);
    return out;
  }, [tree, expanded]);

  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(800);
  useEffect(() => {
    const list = listRef.current!;
    const observer = new ResizeObserver(() => setViewHeight(list.clientHeight));
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  // Bring the selected file into view when it was picked elsewhere (graph, search, panel),
  // centred so the files around it show too.
  useEffect(() => {
    const list = listRef.current;
    const index = selected ? rows.findIndex((row) => row.id === selected) : -1;
    if (!list || index < 0) return;
    const drawn = list.querySelector(`[data-id="${CSS.escape(rows[index].id)}"]`);
    if (drawn) {
      const row = drawn.getBoundingClientRect();
      const view = list.getBoundingClientRect();
      if (row.top >= view.top && row.bottom <= view.bottom) return;
    }
    list.scrollTop = index * ROW_HEIGHT - (list.clientHeight - ROW_HEIGHT) / 2;
  }, [selected, focusRequest]);

  // Closing folders can shorten the list below the last scroll position, so clamp to it.
  const top = Math.min(scrollTop, Math.max(0, rows.length * ROW_HEIGHT - viewHeight));
  const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((top + viewHeight) / ROW_HEIGHT) + OVERSCAN);

  return (
    <div className="tree-panel" id="sidebar-panel-files" role="tabpanel" aria-labelledby="sidebar-tab-files">
      <div
        className="tree"
        role="tree"
        ref={listRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onMouseLeave={() => onHover(null)}
      >
        <div style={{ height: first * ROW_HEIGHT }} />
        {rows.slice(first, last).map(({ id, depth, folder }) => {
          const open = folder && expanded.has(id);
          return (
            <button
              key={id}
              data-id={id}
              role="treeitem"
              aria-expanded={folder ? open : undefined}
              aria-selected={id === selected}
              className={id === selected ? "tree-row selected" : "tree-row"}
              style={{ paddingLeft: 8 + depth * 14 }}
              title={folder ? id.slice(0, -1) : id}
              // A click selects, as in the graph; the arrow or a double click opens a folder.
              onClick={() => onSelect(id)}
              onDoubleClick={() => folder && onToggle(id)}
              onKeyDown={(e) => {
                if (!folder) return;
                if ((e.key === "ArrowRight" && !open) || (e.key === "ArrowLeft" && open)) {
                  e.preventDefault();
                  onToggle(id);
                }
              }}
              onMouseEnter={() => onHover(id)}
            >
              {folder ? (
                <span
                  className="chev-hit"
                  title={open ? "Close this folder" : "Open this folder"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(id);
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  <ChevronRight size={14} className={open ? "chev open" : "chev"} />
                </span>
              ) : (
                <span className="chev" />
              )}
              {folder ? (
                open ? (
                  <FolderOpen size={15} color={colorOf(id)} className="row-icon" />
                ) : (
                  <Folder size={15} color={colorOf(id)} className="row-icon" />
                )
              ) : (
                <span className="row-icon">
                  <span className="dot" style={{ color: colorOf(id) }} />
                </span>
              )}
              <span className="tree-name">{nameOf(id)}</span>
              {folder && (
                <span className="tree-count">{(tree.fileCount.get(id) ?? 0).toLocaleString()}</span>
              )}
            </button>
          );
        })}
        <div style={{ height: (rows.length - last) * ROW_HEIGHT }} />
      </div>
    </div>
  );
}
