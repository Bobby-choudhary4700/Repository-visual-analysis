import { useEffect, useMemo, useState } from "react";
import { Check, Copy, FolderSearch, X } from "lucide-react";
import { fileColor, typeLabel } from "./colors";
import { absolutePath, dirOf, nameOf } from "./tree";
import type { FileNode, ScanResult } from "./types";

interface Props {
  scan: ScanResult;
  path: string;
  onSelect: (path: string) => void;
  onReveal: (path: string) => void;
  onClose: () => void;
}

/** Side panel for one file: what it imports and what imports it, each one a link. */
export function FileDetails({ scan, path, onSelect, onReveal, onClose }: Props) {
  const byPath = useMemo(() => new Map(scan.files.map((f) => [f.path, f])), [scan]);
  const { imports, importedBy } = useMemo(() => {
    const index = scan.files.findIndex((f) => f.path === path);
    const imports: FileNode[] = [];
    const importedBy: FileNode[] = [];
    for (const { from, to } of scan.edges) {
      if (from === index) imports.push(scan.files[to]);
      if (to === index) importedBy.push(scan.files[from]);
    }
    const byPathName = (a: FileNode, b: FileNode) => a.path.localeCompare(b.path);
    return { imports: imports.sort(byPathName), importedBy: importedBy.sort(byPathName) };
  }, [scan, path]);

  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [path]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const file = byPath.get(path);
  if (!file) return null;

  const copyPath = async () => {
    if (await copyText(absolutePath(scan.root, path))) setCopied(true);
  };

  return (
    <aside className="details" aria-label="File details">
      <div className="details-head">
        <span className="dot large" style={{ color: fileColor(path) }} />
        <div className="details-title">
          <div className="details-name">{nameOf(path)}</div>
          <div className="details-dir">{dirOf(path) || "project root"}</div>
        </div>
        <button className="icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="chips">
        <span className="chip">{typeLabel(path)}</span>
        <span className="chip">{formatSize(file.size)}</span>
      </div>

      <div className="details-actions">
        <button className="btn small" onClick={() => onReveal(path)}>
          <FolderSearch size={14} />
          Show in folder
        </button>
        <button className="btn small" onClick={copyPath}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy path"}
        </button>
      </div>

      <FileList title="Imports" files={imports} onSelect={onSelect} />
      <FileList title="Imported by" files={importedBy} onSelect={onSelect} />
    </aside>
  );
}

function FileList({
  title,
  files,
  onSelect,
}: {
  title: string;
  files: FileNode[];
  onSelect: (path: string) => void;
}) {
  return (
    <section className="details-section">
      <h3>
        {title} <span className="count">{files.length}</span>
      </h3>
      {files.length === 0 ? (
        <p className="none">None in this project</p>
      ) : (
        <ul>
          {files.map((f) => (
            <li key={f.path}>
              <button className="dep" title={f.path} onClick={() => onSelect(f.path)}>
                <span className="dot" style={{ color: fileColor(f.path) }} />
                <span className="dep-name">{nameOf(f.path)}</span>
                <span className="dep-dir">{dirOf(f.path)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Copies through the Clipboard API, falling back to a hidden textarea where it is unavailable. */
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
