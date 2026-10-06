import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { fileColor } from "./colors";
import { MOD_KEY } from "./platform";
import { searchFiles } from "./search";
import type { FileNode } from "./types";

interface Props {
  files: FileNode[];
  onPick: (path: string) => void;
}

/** Type to find a file; Enter or a click opens it in the graph. Ctrl/Cmd+K focuses it. */
export function SearchBox({ files, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchFiles(files, query), [files, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = (path: string) => {
    onPick(path);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="search">
      <Search size={15} className="search-icon" />
      <input
        ref={inputRef}
        value={query}
        placeholder={`Find a file  ${MOD_KEY}+K`}
        aria-label="Find a file"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delay so a click on a result lands before the list disappears.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && results[active]) {
            pick(results[active].path);
          } else if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
      />
      {open && query.trim() && (
        <ul className="results">
          {results.length === 0 && <li className="none">No matching files</li>}
          {results.map((file, i) => {
            const cut = file.path.lastIndexOf("/");
            return (
              <li
                key={file.path}
                className={i === active ? "active" : undefined}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(file.path);
                }}
              >
                <span className="dot" style={{ color: fileColor(file.path) }} />
                <span className="name">{file.path.slice(cut + 1)}</span>
                <span className="dir">{cut > 0 ? file.path.slice(0, cut) : ""}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
