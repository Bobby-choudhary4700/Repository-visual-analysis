import { useEffect, useRef, useState } from "react";
import { ClipboardCopy, Eye, FileCode2, FileImage, History, ImageDown, LoaderCircle, Workflow } from "lucide-react";

export type ExportKind = "png" | "svg" | "mermaid" | "copy-mermaid" | "viewer";

const ITEMS: { kind: ExportKind; label: string; hint: string; Icon: typeof FileImage }[] = [
  { kind: "png", label: "Save as PNG", hint: "A picture for slides and chats", Icon: FileImage },
  { kind: "svg", label: "Save as SVG", hint: "Sharp at any size, editable", Icon: FileCode2 },
  { kind: "mermaid", label: "Save as Mermaid", hint: "A .mmd diagram GitHub can draw", Icon: Workflow },
  { kind: "copy-mermaid", label: "Copy Mermaid", hint: "Paste into a README or pull request", Icon: ClipboardCopy },
  { kind: "viewer", label: "Open in Mermaid viewer", hint: "See and tidy the diagram, then save it", Icon: Eye },
];

/** The export button beside the zoom controls, with its menu of formats. */
export function ExportMenu({
  busy,
  selection,
  onExport,
  onOpenManager,
}: {
  busy: boolean;
  /** The selected file or folder's name, which the export is limited to. */
  selection: string | null;
  onExport: (kind: ExportKind) => void;
  /** Opens the list of past exports. */
  onOpenManager: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // The menu takes focus when it opens, so the keyboard can pick a format; a click
  // anywhere else, or Escape, closes it.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      // Up and down move between the formats.
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      if (at < 0) return;
      e.preventDefault();
      items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className="export-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        className={open ? "icon-btn active" : "icon-btn"}
        title="Export the graph"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? <LoaderCircle size={16} className="spin" /> : <ImageDown size={16} />}
      </button>
      {open && (
        <div className="export-menu floating" role="menu" aria-label="Export the graph" ref={menuRef}>
          {ITEMS.map(({ kind, label, hint, Icon }) => (
            <button
              key={kind}
              role="menuitem"
              className="export-item"
              onClick={() => {
                setOpen(false);
                onExport(kind);
              }}
            >
              <Icon size={16} />
              <span>
                <span className="export-label">{label}</span>
                <span className="export-hint">{hint}</span>
              </span>
            </button>
          ))}
          <button
            role="menuitem"
            className="export-item"
            onClick={() => {
              setOpen(false);
              onOpenManager();
            }}
          >
            <History size={16} />
            <span>
              <span className="export-label">Export manager</span>
              <span className="export-hint">Past exports, with Show in folder</span>
            </span>
          </button>
          <div className="export-note">
            {selection ? (
              <>
                Exports <strong>{selection}</strong> and what it connects to. Clear the selection (Esc) to export the
                view.
              </>
            ) : (
              "Exports the part of the graph on screen, with its colours and current angle."
            )}
          </div>
        </div>
      )}
    </div>
  );
}
