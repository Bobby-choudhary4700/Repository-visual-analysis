import type { Mermaid, MermaidConfig } from "mermaid";

// Draws Mermaid text as a standalone SVG for the Mermaid viewer. Mermaid is large, so it
// loads the first time the viewer draws something rather than with the app.

export type MermaidTheme = "dark" | "light";

/** The page colour behind each theme, painted into the exported picture. */
export const THEME_BACKGROUND: Record<MermaidTheme, string> = { dark: "#0b1120", light: "#ffffff" };

let loading: Promise<Mermaid> | null = null;
function loadMermaid(): Promise<Mermaid> {
  loading ??= import("mermaid").then((m) => m.default);
  return loading;
}

/** Mermaid keeps global state while it draws, so draws run one after another. */
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;

export interface RenderedDiagram {
  /** A standalone SVG with its size set and the theme's background painted in. */
  svg: string;
  width: number;
  height: number;
  /** The kind of diagram as Mermaid detected it, such as `flowchart-v2` or `sequence`. */
  diagramType: string;
}

/**
 * Draws `text` in `theme`. `config` holds the user's own Mermaid settings from the
 * viewer's Config tab; it can pick another Mermaid theme or tune a diagram kind, but
 * never loosen the security level or turn HTML labels back on.
 */
export function renderMermaid(text: string, theme: MermaidTheme, config: MermaidConfig = {}): Promise<RenderedDiagram> {
  const run = queue.then(() => draw(text, theme, config));
  queue = run.catch(() => {});
  return run;
}

async function draw(text: string, theme: MermaidTheme, config: MermaidConfig): Promise<RenderedDiagram> {
  const mermaid = await loadMermaid();
  mermaid.initialize({
    theme: theme === "dark" ? "dark" : "default",
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    ...config,
    startOnLoad: false,
    // Text from a file is never trusted to run scripts or links.
    securityLevel: "strict",
    // Labels as SVG text rather than HTML, so the picture can be drawn onto a canvas for PNG.
    htmlLabels: false,
    flowchart: { ...config.flowchart, htmlLabels: false },
    // The app's own exports of big projects pass Mermaid's default limits.
    maxTextSize: 2_000_000,
    maxEdges: 10_000,
  });
  const id = `mermaid-view-${++counter}`;
  try {
    const { svg, diagramType } = await mermaid.render(id, text);
    return { ...standalone(svg, THEME_BACKGROUND[theme]), diagramType };
  } finally {
    // A failed draw can leave its scratch element behind.
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}

/** Gives the SVG a fixed size (Mermaid sizes it to its container) and a background. */
function standalone(markup: string, background: string): Omit<RenderedDiagram, "diagramType"> {
  const doc = new DOMParser().parseFromString(markup, "text/html");
  const svg = doc.querySelector("svg");
  if (!svg) throw new Error("Mermaid did not draw a picture");
  const box = svg.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
  const [x, y, width, height] = box && box.length === 4 && box.every(Number.isFinite) ? box : [0, 0, 800, 600];
  svg.setAttribute("width", String(Math.ceil(width)));
  svg.setAttribute("height", String(Math.ceil(height)));
  svg.style.removeProperty("max-width");
  svg.style.backgroundColor = background;
  const rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(x));
  rect.setAttribute("y", String(y));
  rect.setAttribute("width", String(width));
  rect.setAttribute("height", String(height));
  rect.setAttribute("fill", background);
  // Lets the viewer show the drawing straight on its grid; saved files keep the background.
  rect.setAttribute("data-background", "");
  svg.insertBefore(rect, svg.firstChild);
  return { svg: new XMLSerializer().serializeToString(svg), width: Math.ceil(width), height: Math.ceil(height) };
}

/** The first ```mermaid block of a Markdown file, or the whole text when it has none. */
export function mermaidSource(text: string, fileName: string): string {
  if (!/\.(md|markdown)$/i.test(fileName)) return text;
  const block = /```mermaid[^\n]*\n([\s\S]*?)```/.exec(text);
  return block ? block[1] : text;
}

/** The 1-based line a Mermaid error points at, such as "Parse error on line 4", if any. */
export function problemLine(message: string): number | null {
  const match = /\bline (\d+)/i.exec(message);
  return match ? Number(match[1]) : null;
}
