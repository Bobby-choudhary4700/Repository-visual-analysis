import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { COLOR_MODES, type ColorMode, type Coloring } from "./coloring";
import { NEUTRAL, RAMP_GRADIENT } from "./colors";

interface Props {
  coloring: Coloring;
  view: "2d" | "3d";
  onMode: (mode: ColorMode) => void;
  /** The entry being pointed at, whose nodes the graph keeps lit. */
  hovered: string | null;
  onHover: (key: string | null) => void;
}

/** What the node colours mean, with a switch for what they stand for. */
export function Legend({ coloring, view, onMode, hovered, onHover }: Props) {
  const [open, setOpen] = useState(true);

  return (
    <div className="legend floating" onMouseLeave={() => onHover(null)}>
      <div className="legend-head">
        <span className="legend-title">Color by</span>
        <div className="segmented" role="radiogroup" aria-label="Color nodes by">
          {COLOR_MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={coloring.mode === m.id}
              className={coloring.mode === m.id ? "active" : undefined}
              title={m.hint}
              onClick={() => onMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button
          className="icon-btn small"
          title={open ? "Hide the key" : "Show the key"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown size={14} className={open ? "chev-flip open" : "chev-flip"} />
        </button>
      </div>

      {open && coloring.mode === "links" && (
        <div className="legend-ramp">
          {coloring.maxLinks > 0 && (
            <>
              <div className="ramp-bar" style={{ background: RAMP_GRADIENT }} />
              <div className="ramp-labels">
                <span>1 wire</span>
                <span>
                  {coloring.maxLinks.toLocaleString()} wire{coloring.maxLinks === 1 ? "" : "s"}
                </span>
              </div>
            </>
          )}
          <div className="legend-row static">
            <span className="dot" style={{ color: NEUTRAL }} />
            <span className="legend-label">No wires</span>
          </div>
        </div>
      )}

      {open && coloring.mode !== "links" && (
        <ul className="legend-list">
          {coloring.entries.map((entry) => (
            <li key={entry.key}>
              <button
                className={hovered === entry.key ? "legend-row active" : "legend-row"}
                title={entry.detail ?? "Point here to pick these out in the graph"}
                onMouseEnter={() => onHover(entry.key)}
                onFocus={() => onHover(entry.key)}
                onBlur={() => onHover(null)}
              >
                <span className="dot" style={{ color: entry.color }} />
                <span className="legend-label">{entry.label}</span>
                <span className="legend-count">{entry.count.toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="legend-note">
          {coloring.mode === "type" && (
            <div>
              <span className="dot ring" style={{ color: "var(--text-muted)" }} />
              Folders take the color of what they mostly hold
            </div>
          )}
          <div>
            {view === "3d" ? "Point at a node to trace its wires; arrows" : "Arrows"} point at the
            imported file
          </div>
        </div>
      )}
    </div>
  );
}
