import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Folder, FolderOpen, FolderSearch, X } from "lucide-react";
import { typeLabel } from "./colors";
import { FileList, copyText } from "./FileDetails";
import { formatSize, plural } from "./format";
import { absolutePath, dirOf, nameOf } from "./tree";
import type { FileNode, ScanResult } from "./types";

interface Props {
  scan: ScanResult;
  /** The folder's id, ending in `/`. */
  path: string;
  color: string;
  /** Whether the folder is open in the graph, showing its contents. */
  open: boolean;
  onSelect: (path: string) => void;
  onToggle: (folder: string) => void;
  onReveal: (path: string) => void;
  onClose: () => void;
}

/** How many of the folder's most imported files are listed. */
const MOST_USED = 10;

/**
 * Side panel for one folder, like the file panel: what is in it, which files outside it
 * its files import, and which files outside it import them.
 */
export function FolderDetails({ scan, path, color, open, onSelect, onToggle, onReveal, onClose }: Props) {
  const facts = useMemo(() => {
    const inside = (f: FileNode) => f.path.startsWith(path);
    let size = 0;
    let count = 0;
    const types = new Map<string, number>();
    const folders = new Set<string>();
    for (const f of scan.files) {
      if (!inside(f)) continue;
      count++;
      size += f.size;
      const type = typeLabel(f.path);
      types.set(type, (types.get(type) ?? 0) + 1);
      const rest = f.path.slice(path.length);
      const cut = rest.indexOf("/");
      if (cut >= 0) folders.add(rest.slice(0, cut));
    }
    const uses = new Set<FileNode>();
    const usedBy = new Set<FileNode>();
    const importers = new Map<FileNode, number>();
    for (const { from, to } of scan.edges) {
      const a = scan.files[from];
      const b = scan.files[to];
      const fromIn = inside(a);
      const toIn = inside(b);
      if (fromIn && !toIn) uses.add(b);
      if (!fromIn && toIn) usedBy.add(a);
      if (toIn) importers.set(b, (importers.get(b) ?? 0) + 1);
    }
    const byPath = (a: FileNode, b: FileNode) => a.path.localeCompare(b.path);
    const mostUsed = [...importers]
      .sort((a, b) => b[1] - a[1] || byPath(a[0], b[0]))
      .slice(0, MOST_USED)
      .map(([file]) => file);
    return {
      count,
      size,
      folders: folders.size,
      types: [...types].sort((a, b) => b[1] - a[1]),
      uses: [...uses].sort(byPath),
      usedBy: [...usedBy].sort(byPath),
      mostUsed,
    };
  }, [scan, path]);

  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [path]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  if (facts.count === 0) return null;
  const rel = path.slice(0, -1);

  return (
    <aside className="details" aria-label="Folder details">
      <div className="details-head">
        <Folder size={18} color={color} className="details-icon" />
        <div className="details-title">
          <div className="details-name">{nameOf(path)}/</div>
          <div className="details-dir">{dirOf(rel) || "project root"}</div>
        </div>
        <button className="icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="chips">
        <span className="chip">{plural(facts.count, "file")}</span>
        {facts.folders > 0 && <span className="chip">{plural(facts.folders, "folder")}</span>}
        <span className="chip">{formatSize(facts.size)}</span>
      </div>

      <div className="details-actions">
        <button className="btn small" onClick={() => onToggle(path)} title="Or double-click it">
          {open ? <Folder size={14} /> : <FolderOpen size={14} />}
          {open ? "Close in graph" : "Open in graph"}
        </button>
        <button className="btn small" onClick={() => onReveal(rel)}>
          <FolderSearch size={14} />
          Show in folder
        </button>
        <button
          className="btn small"
          onClick={async () => {
            if (await copyText(absolutePath(scan.root, rel))) setCopied(true);
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy path"}
        </button>
      </div>

      <section className="details-section">
        <h3>Contents</h3>
        <ul className="type-counts">
          {facts.types.map(([type, n]) => (
            <li key={type}>
              <span>{type}</span>
              <span className="count">{n.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </section>
      {facts.mostUsed.length > 0 && <FileList title="Most used inside" files={facts.mostUsed} onSelect={onSelect} />}
      <FileList title="Uses from outside" files={facts.uses} onSelect={onSelect} />
      <FileList title="Used from outside by" files={facts.usedBy} onSelect={onSelect} />
    </aside>
  );
}
