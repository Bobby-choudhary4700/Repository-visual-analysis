import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { MermaidConfig } from "mermaid";
import {
  BookOpen,
  ChevronDown,
  ClipboardCopy,
  FileCode2,
  FileImage,
  FileUp,
  Grid3x3,
  Maximize,
  Save,
  Shapes,
  Sparkles,
  SquareArrowOutUpRight,
  TriangleAlert,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { CodeEditor } from "./CodeEditor";
import { svgToPng } from "./exportGraph";
import { DOCS_BASE, SAMPLE_DIAGRAMS, docsPage, type SampleDiagram } from "./mermaidSamples";
import { mermaidSource, problemLine, renderMermaid, type MermaidTheme, type RenderedDiagram } from "./mermaidRender";
import { NodeLoader } from "./NodeLoader";
import { saveFile } from "./saveFile";
import { loadChoice, loadFlag, saveSetting } from "./settings";

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
type Tab = "code" | "config";
type PngSize = "auto" | "width" | "height";
const PNG_SIZES: { id: PngSize; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "width", label: "Width" },
  { id: "height", label: "Height" },
];

const DEFAULT_CONFIG = "{\n  \n}\n";

function loadText(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Reads the Config tab: Mermaid settings as a JSON object, or what is wrong with it. */
function readConfig(text: string): { config: MermaidConfig } | { problem: string; line: number | null } {
  if (!text.trim()) return { config: {} };
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { problem: "The config must be a JSON object, like { \"theme\": \"forest\" }.", line: 1 };
    }
    return { config: value as MermaidConfig };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const at = /line (\d+)/.exec(message);
    const position = /position (\d+)/.exec(message);
    const line = at ? Number(at[1]) : position ? text.slice(0, Number(position[1])).split("\n").length : null;
    return { problem: `The config is not valid JSON: ${message}`, line };
  }
}

/**
 * Shows a Mermaid diagram next to its text, redrawn as the text changes, and saves it as
 * SVG, PNG or .mmd. The text can come from the graph's export, a file, a sample, or
 * typing. Its working parts follow the Mermaid Live Editor
 * (https://github.com/mermaid-js/mermaid-live-editor): a code editor with a Config tab,
 * sample diagrams, copy and export actions, and a dotted grid behind the drawing.
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
  const [tab, setTab] = useState<Tab>("code");
  const [configText, setConfigText] = useState(() => loadText("rva.mermaidConfig", DEFAULT_CONFIG));
  const [showGrid, setShowGrid] = useState(() => loadFlag("rva.mermaidGrid", true));
  const [samplesOpen, setSamplesOpen] = useState(() => loadFlag("rva.mermaidSamplesOpen", true));
  const [actionsOpen, setActionsOpen] = useState(() => loadFlag("rva.mermaidActionsOpen", false));
  /** The sample whose examples list is open, and where the list goes on screen. */
  const [examplesMenu, setExamplesMenu] = useState<{ name: string; style: CSSProperties } | null>(null);
  const examplesOf = examplesMenu?.name ?? null;
  const [pngSize, setPngSize] = useState<PngSize>(() => loadChoice("rva.mermaidPngSize", PNG_SIZES.map((p) => p.id), "auto"));
  const [pngPixels, setPngPixels] = useState(() => Number(loadText("rva.mermaidPngPixels", "1920")) || 1920);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  /** The next drawing is framed to fit, as for a newly opened diagram. */
  const fitNextRef = useRef(true);
  const dragRef = useRef<{ x: number; y: number; view: View } | null>(null);

  useEffect(() => saveSetting("rva.mermaidTheme", theme), [theme]);
  useEffect(() => saveSetting("rva.mermaidConfig", configText), [configText]);
  useEffect(() => saveSetting("rva.mermaidGrid", showGrid), [showGrid]);
  useEffect(() => saveSetting("rva.mermaidSamplesOpen", samplesOpen), [samplesOpen]);
  useEffect(() => saveSetting("rva.mermaidActionsOpen", actionsOpen), [actionsOpen]);
  useEffect(() => saveSetting("rva.mermaidPngSize", pngSize), [pngSize]);
  useEffect(() => saveSetting("rva.mermaidPngPixels", String(pngPixels)), [pngPixels]);

  const configRead = useMemo(() => readConfig(configText), [configText]);
  // While the config has a mistake, diagrams keep the last settings that worked.
  const lastConfigRef = useRef<MermaidConfig>({});
  if ("config" in configRead) lastConfigRef.current = configRead.config;
  const configKey = JSON.stringify(lastConfigRef.current);

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
      renderMermaid(text, theme, JSON.parse(configKey) as MermaidConfig)
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
  }, [text, theme, configKey]);

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

  // Escape closes the viewer, or first closes a samples list or leaves the editor.
  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const active = document.activeElement;
      if (examplesOf) setExamplesMenu(null);
      else if (active instanceof HTMLElement && sideRef.current?.contains(active)) active.blur();
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, hidden, examplesOf]);

  // A samples list closes when anything else is clicked, or when what it hangs from moves.
  useEffect(() => {
    if (!examplesOf) return;
    const onDown = (e: Event) => {
      if (!(e.target as HTMLElement).closest(".mv-sample")) setExamplesMenu(null);
    };
    const onMove = () => setExamplesMenu(null);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [examplesOf]);

  const load = (next: string, nextName: string) => {
    fitNextRef.current = true;
    setText(next);
    setName(nextName);
  };

  const loadSample = (sample: SampleDiagram, index = 0) => {
    const example = sample.examples[index];
    setExamplesMenu(null);
    setTab("code");
    load(example.code.endsWith("\n") ? example.code : example.code + "\n", slug(`${sample.name} ${index ? example.title : ""}`));
  };

  /**
   * Opens or closes a sample's list of examples. The samples scroll, so the list is placed
   * on screen beside its button rather than inside them, opening upwards near the bottom.
   */
  const toggleExamples = (sample: SampleDiagram, e: ReactMouseEvent<HTMLButtonElement>) => {
    if (examplesOf === sample.name) return setExamplesMenu(null);
    const button = e.currentTarget.getBoundingClientRect();
    const height = sample.examples.length * 30 + 10;
    const style: CSSProperties = { left: Math.max(8, button.right - 280) };
    if (button.bottom + 4 + height > window.innerHeight - 8) style.bottom = window.innerHeight - button.top + 4;
    else style.top = button.bottom + 4;
    setExamplesMenu({ name: sample.name, style });
  };

  /** The PNG's scale for the chosen size: twice the drawing, or a set width or height. */
  const pngScale = (d: RenderedDiagram) => {
    const pixels = Math.min(Math.max(pngPixels, 16), 8192);
    if (pngSize === "width") return pixels / d.width;
    if (pngSize === "height") return pixels / d.height;
    return 2;
  };

  const copy = async (kind: "text" | "svg" | "png") => {
    try {
      if (kind === "text") {
        await navigator.clipboard.writeText(text);
        onNotice("Copied the Mermaid text.");
        return;
      }
      if (!diagram) return;
      if (kind === "svg") {
        await navigator.clipboard.writeText(diagram.svg);
        onNotice("Copied the SVG.");
        return;
      }
      const png = svgToPng(diagram.svg, diagram.width, diagram.height, pngScale(diagram)).then(
        (data) => new Blob([data], { type: "image/png" }),
      );
      // The picture is handed over as a promise so the copy still counts as the click's.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      onNotice("Copied the picture.");
    } catch (e) {
      setProblem(`Could not copy: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const openDocs = () => {
    const page = docsPage(diagram?.diagramType);
    if (isTauri()) {
      void invoke("open_link", { which: "mermaid-docs", page }).catch((e) => setProblem(String(e)));
    } else {
      window.open(page ? `${DOCS_BASE}syntax/${page}` : `${DOCS_BASE}intro/`, "_blank", "noopener");
    }
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
      else data = await svgToPng(diagram.svg, diagram.width, diagram.height, pngScale(diagram));
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
  const configProblem = "problem" in configRead ? configRead : null;
  const codeProblemLine = problem ? problemLine(problem) : null;

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
        <aside className="mv-side" ref={sideRef}>
          <div className="mv-editor-pane">
            <div className="mv-pane-head">
              <div className="segmented" role="tablist" aria-label="Editor">
                {(["code", "config"] as const).map((id) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    className={tab === id ? "active" : undefined}
                    onClick={() => setTab(id)}
                  >
                    {id === "code" ? "Code" : "Config"}
                    {id === "config" && configProblem && <span className="mv-tab-dot" aria-label="has a problem" />}
                  </button>
                ))}
              </div>
              <div className="mv-spacer" />
              <button className="btn small" onClick={openDocs} title="Mermaid's documentation for this kind of diagram">
                <BookOpen size={14} />
                Docs
              </button>
            </div>
            <div className="mv-editor" hidden={tab !== "code"}>
              <CodeEditor
                language="mermaid"
                value={text}
                onChange={setText}
                problemLine={codeProblemLine}
                ariaLabel="Mermaid text"
                placeholder={"Paste or type a Mermaid diagram, for example:\n\nflowchart LR\n  A --> B"}
              />
            </div>
            <div className="mv-editor" hidden={tab !== "config"}>
              <CodeEditor
                language="json"
                value={configText}
                onChange={setConfigText}
                problemLine={configProblem?.line ?? null}
                ariaLabel="Mermaid config"
              />
            </div>
            {tab === "config" && (
              <p className={configProblem ? "mv-config-note problem" : "mv-config-note"}>
                {configProblem
                  ? configProblem.problem
                  : 'Mermaid settings as JSON, for example { "theme": "forest", "flowchart": { "curve": "basis" } }. They apply on top of the Dark or Light switch.'}
              </p>
            )}
          </div>

          <section className={samplesOpen ? "mv-panel open" : "mv-panel"}>
            <button className="mv-panel-head" aria-expanded={samplesOpen} onClick={() => setSamplesOpen((o) => !o)}>
              <Shapes size={15} />
              <span>Sample diagrams</span>
              <ChevronDown size={15} className="mv-chevron" />
            </button>
            {samplesOpen && (
              <div className="mv-samples">
                {SAMPLE_DIAGRAMS.map((sample) => (
                  <div className="mv-sample" key={sample.name}>
                    <button
                      className="btn small"
                      onClick={() => loadSample(sample)}
                      title={`Load a ${sample.name.toLowerCase()} example`}
                    >
                      {sample.name}
                    </button>
                    {sample.examples.length > 1 && (
                      <button
                        className="btn small mv-sample-more"
                        aria-label={`More ${sample.name} examples`}
                        aria-expanded={examplesOf === sample.name}
                        onClick={(e) => toggleExamples(sample, e)}
                      >
                        <ChevronDown size={13} />
                      </button>
                    )}
                    {examplesOf === sample.name && (
                      <div className="mb-menu mv-sample-menu" role="menu" style={examplesMenu?.style}>
                        {sample.examples.map((example, i) => (
                          <button key={example.title} className="mb-item" role="menuitem" onClick={() => loadSample(sample, i)}>
                            <span className="mb-label">{example.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={actionsOpen ? "mv-panel open" : "mv-panel"}>
            <button className="mv-panel-head" aria-expanded={actionsOpen} onClick={() => setActionsOpen((o) => !o)}>
              <SquareArrowOutUpRight size={15} />
              <span>Actions</span>
              <ChevronDown size={15} className="mv-chevron" />
            </button>
            {actionsOpen && (
              <div className="mv-actions">
                <div className="mv-action-row">
                  <span className="mv-action-label">Copy</span>
                  <button className="btn small" disabled={!text.trim()} onClick={() => void copy("text")}>
                    <ClipboardCopy size={14} />
                    Mermaid text
                  </button>
                  <button className="btn small" disabled={!diagram} onClick={() => void copy("svg")}>
                    <FileCode2 size={14} />
                    SVG
                  </button>
                  <button className="btn small" disabled={!diagram} onClick={() => void copy("png")}>
                    <FileImage size={14} />
                    Picture
                  </button>
                </div>
                <div className="mv-action-row">
                  <span className="mv-action-label">PNG size</span>
                  <div className="segmented" role="radiogroup" aria-label="PNG size">
                    {PNG_SIZES.map(({ id, label }) => (
                      <button
                        key={id}
                        role="radio"
                        aria-checked={pngSize === id}
                        className={pngSize === id ? "active" : undefined}
                        onClick={() => setPngSize(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {pngSize === "auto" ? (
                    <span className="mv-action-hint">Twice the drawing's size</span>
                  ) : (
                    <label className="mv-pixels">
                      <input
                        type="number"
                        min={16}
                        max={8192}
                        step={10}
                        value={pngPixels}
                        aria-label={`PNG ${pngSize} in pixels`}
                        onChange={(e) => setPngPixels(Number(e.target.value))}
                      />
                      px
                    </label>
                  )}
                </div>
                <div className="mv-action-row">
                  <span className="mv-action-label">Save</span>
                  <button className="btn small" disabled={saving || !text.trim()} onClick={() => void save("mmd")}>
                    <Save size={14} />
                    .mmd
                  </button>
                  <button className="btn small" disabled={saving || !diagram} onClick={() => void save("svg")}>
                    <FileCode2 size={14} />
                    SVG
                  </button>
                  <button className="btn small" disabled={saving || !diagram} onClick={() => void save("png")}>
                    <FileImage size={14} />
                    PNG
                  </button>
                </div>
              </div>
            )}
          </section>
        </aside>
        <div
          className={`mv-preview ${theme}${showGrid ? " grid" : ""}`}
          style={showGrid ? { backgroundPosition: `${view.x}px ${view.y}px` } : undefined}
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
              <p>Type Mermaid text on the left, pick a sample diagram, open a .mmd file, or export the graph to here.</p>
            </div>
          )}
          {drawing && (
            <div className="mv-drawing" role="status">
              <NodeLoader size={16} />
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
              <button
                className={showGrid ? "icon-btn active" : "icon-btn"}
                title={showGrid ? "Hide the grid" : "Show the grid"}
                aria-pressed={showGrid}
                onClick={() => setShowGrid((g) => !g)}
              >
                <Grid3x3 size={16} />
              </button>
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

/** A file name stem from a sample's name, such as `entity-relationship`. */
function slug(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "diagram";
}
