import { formatSize, plural } from "./format";
import type { KeyFile } from "./ranking";
import { dirOf, nameOf } from "./tree";

interface Props {
  files: KeyFile[];
  colorOf: (id: string) => string;
  selected: string | null;
  onSelect: (path: string) => void;
  /** Hovering a row traces that file, or the closed folder it sits in, in the graph. */
  onHover: (path: string | null) => void;
}

/** The files the rest of the project leans on most, as a place to start reading. */
export function KeyFiles({ files, colorOf, selected, onSelect, onHover }: Props) {
  if (files.length === 0) {
    return (
      <p className="key-intro">
        Nothing to rank: none of this project's source files import each other. Tests, docs and
        examples are left out, and imports are read from JavaScript, TypeScript, Python and Rust
        files.
      </p>
    );
  }
  return (
    <>
      <p className="key-intro">
        Where to start reading: the files the rest of the project leans on most. Tests, docs and
        examples are left out of the list and the counts.
      </p>
      <ol className="key-list" onMouseLeave={() => onHover(null)}>
        {files.map((f) => (
          <li key={f.path}>
            <button
              className={f.path === selected ? "key-row selected" : "key-row"}
              aria-current={f.path === selected ? "true" : undefined}
              title={`${f.path}\nImported by ${plural(f.importedBy, "file")}, imports ${plural(f.imports, "file")}, ${formatSize(f.size)}`}
              onClick={() => onSelect(f.path)}
              onMouseEnter={() => onHover(f.path)}
            >
              <span className="key-line">
                <span className="dot" style={{ color: colorOf(f.path) }} />
                <span className="key-name">{nameOf(f.path)}</span>
                <span className="key-dir">{dirOf(f.path)}</span>
              </span>
              <span className="key-stats">
                imported by {f.importedBy.toLocaleString()} · imports {f.imports.toLocaleString()}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}
