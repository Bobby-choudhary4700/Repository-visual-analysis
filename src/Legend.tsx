import { useMemo } from "react";
import { FOLDER_COLOR, LANGS, OTHER_FILE_COLOR } from "./colors";
import type { FileNode, Lang } from "./types";

/** What the node colours mean, with how many files of each kind the project has. */
export function Legend({ files }: { files: FileNode[] }) {
  const counts = useMemo(() => {
    const byLang = new Map<Lang | null, number>();
    for (const f of files) byLang.set(f.lang, (byLang.get(f.lang) ?? 0) + 1);
    return byLang;
  }, [files]);
  const other = counts.get(null) ?? 0;

  return (
    <div className="legend floating">
      <div className="legend-row">
        <span className="dot" style={{ background: FOLDER_COLOR }} />
        Folder
      </div>
      {LANGS.filter((l) => counts.get(l.lang)).map((l) => (
        <div className="legend-row" key={l.lang}>
          <span className="dot" style={{ background: l.color }} />
          {l.label}
          <span className="legend-count">{counts.get(l.lang)!.toLocaleString()}</span>
        </div>
      ))}
      {other > 0 && (
        <div className="legend-row">
          <span className="dot" style={{ background: OTHER_FILE_COLOR }} />
          Other files
          <span className="legend-count">{other.toLocaleString()}</span>
        </div>
      )}
      <div className="legend-note">Arrows point at the imported file</div>
    </div>
  );
}
