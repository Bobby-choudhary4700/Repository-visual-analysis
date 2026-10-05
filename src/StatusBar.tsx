import { MOD_KEY } from "./platform";
import type { ScanResponse } from "./types";

export function StatusBar({ scan, shown }: { scan: ScanResponse; shown: number }) {
  const { stats } = scan;
  return (
    <footer className="statusbar">
      <span
        className={scan.watching ? "live on" : "live"}
        title={
          scan.watching
            ? "Saving a file in this project redraws the graph"
            : "This folder could not be watched, so the graph will not follow edits"
        }
      >
        <span className="live-dot" />
        {scan.watching ? "Live" : "Not watching"}
      </span>
      <span>{stats.files.toLocaleString()} files</span>
      <span>{scan.edges.length.toLocaleString()} wires</span>
      <span>{shown.toLocaleString()} shown</span>
      <span className="spacer" />
      <span className="faint">
        Scanned in {stats.elapsedMs.toLocaleString()} ms · {stats.parsed.toLocaleString()} parsed,{" "}
        {stats.cached.toLocaleString()} from cache
      </span>
      <span className="keys">
        <kbd>{MOD_KEY} K</kbd> find <kbd>F</kbd> fit <kbd>Esc</kbd> clear
      </span>
    </footer>
  );
}
