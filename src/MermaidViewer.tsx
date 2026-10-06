import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import {
  FileCode2,
  FileImage,
  FileUp,
  LoaderCircle,
  Maximize,
  Save,
  Sparkles,
  TriangleAlert,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { svgToPng } from "./exportGraph";
import { mermaidSource, renderMermaid, type MermaidTheme, type RenderedDiagram } from "./mermaidRender";
import { saveFile } from "./saveFile";
import { loadChoice, saveSetting } from "./settings";

interface Props {
  initialText: string;
  /** File name stem for saved files, such as `my-repo-graph`. */
  name: string;
  /**
   * Hides the viewer. It stays mounted while hidden, so its text, drawing and zoom are
   * all still there when it is shown again.
   */
  onClose: () => void;
  /** Hidden behind the explorer: kept as it is, but not shown and not listening for keys. */
  hidden?: boolean;
  onNotice: (message: string) => void;
}

const EXAMPLE = `flowchart LR
  ui["App.tsx"] --> graph["graph.ts"]
  ui --> view["GraphView.tsx"]
  view --> layout["layout.ts"]
  layout --> worker[["layout.worker.ts"]]
  ui --> exporter["exportGraph.ts"]
`;

const THEMES: { id: MermaidTheme; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
];
/** Typing pauses this long before the diagram is drawn again. */
const REDRAW_MS = 300;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;

type View = { x: number; y: number; k: number };

/**
 * Shows a Mermaid diagram next to its text, redrawn as the text changes, and saves it as
 * SVG, PNG or .mmd. The text can come from the graph's export, a file, or typing.
 */
export function MermaidViewer({ initialText, name: initialName, onClose, onNotice, hidden = false }: Props) {
  const [text, setText] = useState(initialText);
  const [name, setName] = useState(initialName);
  const [theme, setTheme] = useState<MermaidTheme>(() =>
    loadChoice("rva.mermaidTheme", THEMES.map((t) => t.id), "dark"),
  );
  const [diagram, setDiagram] = useState<RenderedDiagram | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const previewRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  /** The next drawing is framed to fit, as for a newly opened diagram. */
  const fitNextRef = useRef(true);
  const dragRef = useRef<{ x: number; y: number; view: View } | null>(null);

  useEffect(() => saveSetting("rva.mermaidTheme", theme), [theme]);

  // Redraw shortly after the text or theme changes; only the latest drawing is kept.
  useEffect(() => {
    if (!text.trim()) {
      setDiagram(null);
      setProblem(null);
      setDrawing(false);
      return;
    }
    let cancelled = false;
    setDrawing(true);
    const timer = window.setTimeout(() => {
      renderMermaid(text, theme)
        .then((result) => {
          if (cancelled) return;
          setDiagram(result);
          setProblem(null);
        })
        .catch((e) => {
          if (!cancelled) setProblem(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!cancelled) setDrawing(false);
        });
    }, REDRAW_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [text, theme]);

  const fit = useCallback(() => {
    const preview = previewRef.current;
    if (!preview || !diagram) return;
    const pad = 32;
    const k = Math.min(
      (preview.clientWidth - 2 * pad) / diagram.width,
      (preview.clientHeight - 2 * pad) / diagram.height,
      1.5,
    );
    const scale = Math.max(k, MIN_ZOOM);
    setView({
      k: scale,
      x: (preview.clientWidth - diagram.width * scale) / 2,
      y: (preview.clientHeight - diagram.height * scale) / 2,
    });
  }, [diagram]);

  useLayoutEffect(() => {
    if (diagram && fitNextRef.current) {
      fitNextRef.current = false;
      fit();
    }
  }, [diagram, fit]);

  /** Zooms by `factor`, keeping the point under (px, py) where it is. */
  const zoomAt = (factor: number, px?: number, py?: number) => {
    const preview = previewRef.current;
    if (!preview) return;
    const cx = px ?? preview.clientWidth / 2;
    const cy = py ?? preview.clientHeight / 2;
    setView((v) => {
      const k = Math.min(Math.max(v.k * factor, MIN_ZOOM), MAX_ZOOM);
      const f = k / v.k;
      return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
    });
  };

  // React's wheel listener is passive, so zooming without scrolling the page needs our own.
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = preview.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    preview.addEventListener("wheel", onWheel, { passive: false });
    return () => preview.removeEventListener("wheel", onWheel);
  }, []);

  const close = onClose;

  // Escape closes the viewer, or first leaves the text box.
  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.activeElement === textRef.current) textRef.current?.blur();
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, hidden]);

  const load = (next: string, nextName: string) => {
    fitNextRef.current = true;
    setText(next);
    setName(nextName);
  };

  const openFile = async (file: File) => {
    try {
      load(mermaidSource(await file.text(), file.name), file.name.replace(/\.[^.]+$/, "") || "diagram");
    } catch (e) {
      setProblem(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const save = async (kind: "svg" | "png" | "mmd") => {
    setSaving(true);
    try {
      let data: Uint8Array<ArrayBuffer>;
      if (kind === "mmd") data = new TextEncoder().encode(text.endsWith("\n") ? text : text + "\n");
      else if (!diagram) return;
      else if (kind === "svg") data = new TextEncoder().encode(diagram.svg);
      else data = await svgToPng(diagram.svg, diagram.width, diagram.height);
      const saved = await saveFile(`${name}.${kind}`, data);
      if (saved) onNotice(`Saved ${saved}.`);
    } catch (e) {
      setProblem(`Could not save the diagram: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, view };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setView({ ...drag.view, x: drag.view.x + e.clientX - drag.x, y: drag.view.y + e.clientY - drag.y });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const stale = problem !== null && diagram !== null;

  return (
    <section className="mermaid-viewer" role="dialog" aria-label="Mermaid viewer" hidden={hidden}>
      <div className="mv-bar">
        <Workflow size={18} className="mv-logo" />
        <span className="mv-title">Mermaid viewer</span>
        <button className="btn small" onClick={() => fileRef.current?.click()} title="Open a .mmd or Markdown file">
          <FileUp size={14} />
          Open file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".mmd,.mermaid,.md,.markdown,.txt"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void openFile(file);
          }}
        />
        {!text.trim() && (
          <button className="btn small" onClick={() => load(EXAMPLE, "example")}>
            <Sparkles size={14} />
            Example
          </button>
        )}
        <div className="mv-spacer" />
        <div className="segmented" role="radiogroup" aria-label="Theme">
          {THEMES.map(({ id, label }) => (
            <button
              key={id}
              role="radio"
              aria-checked={theme === id}
              className={theme === id ? "active" : undefined}
              onClick={() => setTheme(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="btn small" disabled={saving || !text.trim()} onClick={() => void save("mmd")}>
          <Save size={14} />
          Save .mmd
        </button>
        <button className="btn small" disabled={saving || !diagram} onClick={() => void save("svg")}>
          <FileCode2 size={14} />
          Export SVG
        </button>
        <button className="btn small" disabled={saving || !diagram} onClick={() => void save("png")}>
          <FileImage size={14} />
          Export PNG
        </button>
        <button className="icon-btn" onClick={close} title="Close (Esc)" aria-label="Close the Mermaid viewer">
          <X size={16} />
        </button>
      </div>
      <div className="mv-body">
        <textarea
          ref={textRef}
          className="mv-source"
          value={text}
          spellCheck={false}
          aria-label="Mermaid text"
          placeholder={"Paste or type a Mermaid diagram, for example:\n\nflowchart LR\n  A --> B"}
          onChange={(e) => setText(e.target.value)}
        />
        <div
          className={`mv-preview ${theme}`}
          ref={previewRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={fit}
        >
          {diagram && (
            <div
              className={stale ? "mv-stage stale" : "mv-stage"}
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
              // Drawn by Mermaid with its strict security level, which strips scripts and links.
              dangerouslySetInnerHTML={{ __html: diagram.svg }}
            />
          )}
          {!text.trim() && (
            <div className="mv-empty">
              <Workflow size={28} />
              <p>Paste Mermaid text on the left, open a .mmd file, or export the graph to here.</p>
            </div>
          )}
          {drawing && (
            <div className="mv-drawing" role="status">
              <LoaderCircle size={14} className="spin" />
              Drawing…
            </div>
          )}
          {problem && (
            <div className="mv-problem" role="alert">
              <TriangleAlert size={15} />
              <span>{problem}</span>
            </div>
          )}
          {diagram && (
            <div className="mv-zoom">
              <button className="icon-btn" title="Zoom in" onClick={() => zoomAt(1.25)}>
                <ZoomIn size={16} />
              </button>
              <button className="icon-btn" title="Zoom out" onClick={() => zoomAt(0.8)}>
                <ZoomOut size={16} />
              </button>
              <button className="icon-btn" title="Fit (or double-click)" onClick={fit}>
                <Maximize size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
