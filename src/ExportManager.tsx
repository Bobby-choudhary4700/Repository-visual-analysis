import { useCallback, useEffect, useMemo, useState } from "react";
import { FileCode2, FileImage, FolderSearch, History, RefreshCw, Search, Trash2, Workflow, X } from "lucide-react";
import { Dialog } from "./Dialog";
import {
  clearExports,
  exportsAvailable,
  forgetExport,
  listExports,
  revealExport,
  type ExportEntry,
} from "./exports";
import { formatSize, timeAgo } from "./format";
import { NodeLoader } from "./NodeLoader";

const KIND_ICON: Record<string, typeof FileImage> = { png: FileImage, svg: FileCode2, mmd: Workflow };
const KIND_LABEL: Record<string, string> = { png: "PNG", svg: "SVG", mmd: "Mermaid" };

/**
 * Every graph and diagram this app has saved, newest first, each with Show in folder.
 * The list lives in the user's app data, so it is the same in every window and survives
 * restarts. Files are only ever shown in the file manager, never opened.
 */
export function ExportManager({ onClose, onError }: { onClose: () => void; onError: (message: string) => void }) {
  const [entries, setEntries] = useState<ExportEntry[] | null>(null);
  const [filter, setFilter] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const available = exportsAvailable();

  const refresh = useCallback(async () => {
    if (!available) return setEntries([]);
    try {
      setEntries(await listExports());
    } catch (e) {
      onError(`Could not read the export list: ${String(e)}`);
      setEntries([]);
    }
  }, [available, onError]);

  // Read again when the window comes back to the front: a file may have been moved, or
  // another window may have exported something.
  useEffect(() => {
    void refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const shown = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    if (!entries || words.length === 0) return entries ?? [];
    return entries.filter((e) => {
      const text = `${e.name} ${e.folder} ${e.project ?? ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [entries, filter]);

  const run = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (e) {
      onError(String(e));
    }
    await refresh();
  };

  const footer = available && entries && entries.length > 0 && (
    <>
      <span className="muted">
        {entries.length === 1 ? "1 export" : `${entries.length.toLocaleString()} exports`}. Removing one only takes it
        off this list.
      </span>
      <button
        className={confirmClear ? "btn small danger" : "btn small"}
        onClick={() => {
          if (!confirmClear) return setConfirmClear(true);
          setConfirmClear(false);
          void run(clearExports);
        }}
        onBlur={() => setConfirmClear(false)}
      >
        <Trash2 size={14} />
        {confirmClear ? "Click again to clear the list" : "Clear list"}
      </button>
    </>
  );

  return (
    <Dialog
      title="Export manager"
      icon={<History size={18} />}
      onClose={onClose}
      footer={footer || undefined}
      className="export-manager"
    >
      {!available ? (
        <p className="dialog-empty">The export list is kept by the desktop app. Exports from a browser go to Downloads.</p>
      ) : entries === null ? (
        <p className="dialog-empty">
          <NodeLoader size={20} /> Reading the list…
        </p>
      ) : entries.length === 0 ? (
        <p className="dialog-empty">
          Nothing exported yet. Save the graph with the export button beside the zoom controls or from the Export menu,
          and it will be listed here.
        </p>
      ) : (
        <>
          <div className="em-toolbar">
            <label className="em-filter">
              <Search size={14} />
              <input
                data-autofocus
                value={filter}
                placeholder="Filter by name, folder or project"
                aria-label="Filter exports"
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            <button className="icon-btn" title="Check the files again" onClick={() => void refresh()}>
              <RefreshCw size={15} />
            </button>
          </div>
          <ul className="em-list">
            {shown.map((entry) => {
              const Icon = KIND_ICON[entry.kind] ?? FileImage;
              return (
                <li key={entry.id} className={entry.exists ? "em-row" : "em-row missing"}>
                  <Icon size={18} className="em-icon" />
                  <div className="em-text">
                    <div className="em-name" title={entry.path}>
                      {entry.name}
                      <span className="em-kind">{KIND_LABEL[entry.kind] ?? entry.kind.toUpperCase()}</span>
                      {!entry.exists && <span className="em-gone">Moved or deleted</span>}
                    </div>
                    <div className="em-folder" title={entry.folder}>
                      {entry.folder}
                    </div>
                    <div className="em-meta">
                      {[entry.project, timeAgo(entry.savedAt), entry.size ? formatSize(entry.size) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <button
                    className="btn small"
                    disabled={!entry.exists}
                    title={entry.exists ? "Show this file in the file manager" : "The file is no longer there"}
                    onClick={() => void run(() => revealExport(entry.id))}
                  >
                    <FolderSearch size={14} />
                    Show in folder
                  </button>
                  <button
                    className="icon-btn"
                    title="Remove from this list (the file stays)"
                    aria-label={`Remove ${entry.name} from the list`}
                    onClick={() => void run(() => forgetExport(entry.id))}
                  >
                    <X size={14} />
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && <li className="dialog-empty">No export matches “{filter}”.</li>}
          </ul>
        </>
      )}
    </Dialog>
  );
}
