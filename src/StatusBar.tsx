import { MOD_KEY } from "./platform";
import type { ScanResponse } from "./types";

interface Props {
  /** The scan as shown, without any hidden files. */
  scan: ScanResponse;
  shown: number;
  /** Files left out by the hide switch, or `null` while it is off. */
  hidden: number | null;
  onToggleHidden: () => void;
}

export function StatusBar({ scan, shown, hidden, onToggleHidden }: Props) {
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
      <span>{scan.files.length.toLocaleString()} files</span>
      <span>{scan.edges.length.toLocaleString()} wires</span>
      <span>{shown.toLocaleString()} shown</span>
      {hidden !== null && (
        <button
          className="status-btn"
          title="Tests, docs, examples and generated files are hidden. Click to show them (H)"
          onClick={onToggleHidden}
        >
          {hidden.toLocaleString()} hidden
        </button>
      )}
      <span className="spacer" />
      <span className="faint">
        Scanned in {stats.elapsedMs.toLocaleString()} ms · {stats.parsed.toLocaleString()} parsed,{" "}
        {stats.cached.toLocaleString()} from cache
      </span>
      <span className="keys">
        <kbd>{MOD_KEY} K</kbd> find <kbd>F</kbd> fit <kbd>V</kbd> 2D/3D <kbd>Esc</kbd> clear
      </span>
    </footer>
  );
}
