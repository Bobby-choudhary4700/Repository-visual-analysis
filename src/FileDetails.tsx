import { useMemo } from "react";
import type { ScanResult } from "./types";

interface Props {
  scan: ScanResult;
  path: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

/** Side panel for one file: what it imports and what imports it, each one a link. */
export function FileDetails({ scan, path, onSelect, onClose }: Props) {
  const { file, imports, importedBy } = useMemo(() => {
    const index = scan.files.findIndex((f) => f.path === path);
    const imports: string[] = [];
    const importedBy: string[] = [];
    for (const { from, to } of scan.edges) {
      if (from === index) imports.push(scan.files[to].path);
      if (to === index) importedBy.push(scan.files[from].path);
    }
    imports.sort();
    importedBy.sort();
    return { file: scan.files[index], imports, importedBy };
  }, [scan, path]);

  if (!file) return null;
  const cut = path.lastIndexOf("/");

  return (
    <aside className="details">
      <div className="details-head">
        <div>
          <div className="details-name">{path.slice(cut + 1)}</div>
          <div className="details-dir">{cut > 0 ? path.slice(0, cut) : "(project root)"}</div>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="details-meta">
        {file.lang ?? "not parsed"} · {formatSize(file.size)}
      </div>
      <FileList title="Imports" paths={imports} onSelect={onSelect} />
      <FileList title="Imported by" paths={importedBy} onSelect={onSelect} />
    </aside>
  );
}

function FileList({
  title,
  paths,
  onSelect,
}: {
  title: string;
  paths: string[];
  onSelect: (path: string) => void;
}) {
  return (
    <section>
      <h3>
        {title} <span className="count">{paths.length}</span>
      </h3>
      {paths.length === 0 ? (
        <p className="none">None in this project</p>
      ) : (
        <ul>
          {paths.map((p) => (
            <li key={p}>
              <button className="link" title={p} onClick={() => onSelect(p)}>
                {p}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
