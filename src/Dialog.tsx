import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface Props {
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Buttons along the bottom, if any. */
  footer?: ReactNode;
  className?: string;
}

/**
 * A modal window inside the app: Settings, the export manager, About and the shortcuts
 * list. Escape or a click on the dimmed page closes it, and focus goes back to where it was.
 */
export function Dialog({ title, icon, onClose, children, footer, className }: Props) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const box = boxRef.current;
    (box?.querySelector<HTMLElement>("[data-autofocus]") ?? box)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Handled here, so the graph does not also drop its selection.
        e.stopPropagation();
        closeRef.current();
        return;
      }
      // Tab stays inside the dialog.
      if (e.key !== "Tab" || !box) return;
      const items = [
        ...box.querySelectorAll<HTMLElement>("button:not(:disabled), input, select, [tabindex='0']"),
      ];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      before?.focus?.();
    };
  }, []);

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={className ? `dialog ${className}` : "dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={boxRef}
      >
        <header className="dialog-head">
          {icon}
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </div>
  );
}
