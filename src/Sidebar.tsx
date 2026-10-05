import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ChevronsDownUp, Folder, FolderOpen } from "lucide-react";
import { FOLDER_COLOR, fileColor } from "./colors";
import { ROOT } from "./graph";
import { nameOf, type TreeIndex } from "./tree";

interface Props {
  tree: TreeIndex;
  /** The same open folders as the graph, so both always show the same level of detail. */
  expanded: Set<string>;
  selected: string | null;
  focusRequest: number;
  onToggle: (folderId: string) => void;
  onSelectFile: (path: string) => void;
  /** Hovering a row traces that node in the graph. */
  onHover: (id: string | null) => void;
  onCollapseAll: () => void;
}

type Row = { id: string; depth: number; folder: boolean };

/** Every row has this height, which is what lets the list draw only the rows in view. */
const ROW_HEIGHT = 26;
/** Rows drawn beyond each edge of the view, so fast scrolling shows no gaps. */
const OVERSCAN = 10;

/**
 * File explorer that mirrors the graph: opening a folder here opens it there too. Only the
 * rows in view are drawn, so a folder of thousands of files opens as fast as a small one.
 */
export const Sidebar = memo(function Sidebar({
  tree,
  expanded,
  selected,
  focusRequest,
  onToggle,
  onSelectFile,
  onHover,
  onCollapseAll,
}: Props) {
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
    <nav className="sidebar" aria-label="Project files">
      <div className="sidebar-head">
        <span className="sidebar-title">Explorer</span>
        <button className="icon-btn" title="Close all folders" onClick={onCollapseAll}>
          <ChevronsDownUp size={15} />
        </button>
      </div>
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
              onClick={() => (folder ? onToggle(id) : onSelectFile(id))}
              onMouseEnter={() => onHover(id)}
            >
              {folder ? (
                <ChevronRight size={14} className={open ? "chev open" : "chev"} />
              ) : (
                <span className="chev" />
              )}
              {folder ? (
                open ? (
                  <FolderOpen size={15} color={FOLDER_COLOR} className="row-icon" />
                ) : (
                  <Folder size={15} color={FOLDER_COLOR} className="row-icon" />
                )
              ) : (
                <span className="row-icon">
                  <span className="dot" style={{ background: fileColor(tree.lang.get(id)) }} />
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
    </nav>
  );
});
