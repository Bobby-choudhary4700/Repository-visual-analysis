import { Folder, FolderOpen, Upload, X } from "lucide-react";
import { FOLDER_COLOR } from "./colors";
import { Logo } from "./Logo";
import { MOD_KEY } from "./platform";
import { baseName } from "./tree";

interface Props {
  recent: string[];
  busy: boolean;
  onOpen: () => void;
  onOpenRecent: (path: string) => void;
  onForget: (path: string) => void;
}

/** First screen: open a folder, drop one on the window, or pick up a recent project. */
export function Welcome({ recent, busy, onOpen, onOpenRecent, onForget }: Props) {
  return (
    <div className="welcome">
      <div className="welcome-card">
        <Logo size={56} />
        <h1>Repository Visual Analysis</h1>
        <p className="lead">
          See how a codebase fits together. Every file is a node, and every import is a wire
          between two of them.
        </p>
        <button className="btn primary large" onClick={onOpen} disabled={busy}>
          <FolderOpen size={18} />
          Open a project folder
        </button>
        <p className="hint">
          <Upload size={14} /> or drop a folder onto this window
        </p>

        {recent.length > 0 && (
          <section className="recent">
            <h2>Recent projects</h2>
            <ul>
              {recent.map((path) => (
                <li key={path}>
                  <button
                    className="recent-open"
                    title={path}
                    disabled={busy}
                    onClick={() => onOpenRecent(path)}
                  >
                    <Folder size={16} color={FOLDER_COLOR} />
                    <span className="recent-name">{baseName(path)}</span>
                    <span className="recent-path">{path}</span>
                  </button>
                  <button
                    className="icon-btn"
                    title="Remove from this list"
                    aria-label={`Remove ${baseName(path)} from recent projects`}
                    onClick={() => onForget(path)}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="tips">
          <span>
            <kbd>{MOD_KEY} O</kbd> open a folder
          </span>
          <span>
            <kbd>{MOD_KEY} K</kbd> find a file
          </span>
          <span>
            <kbd>F</kbd> fit the graph
          </span>
        </div>
      </div>
    </div>
  );
}
