import { BACKGROUND } from "./colors";
import { ROOT, parentOf, type VisibleEdge, type VisibleNode } from "./graph";

// Turns the graph on screen into files people can paste into docs and pull requests: a
// picture (SVG, or PNG drawn from it) laid out the way the view shows it, and a Mermaid
// flowchart that GitHub and most Markdown tools draw themselves.

/** Where each drawn node sits on screen, in pixels with y pointing down. In 3D, `depth`
 * says how far away it is (larger is farther), so nearer nodes are drawn over farther ones. */
export type ScreenPositions = Map<string, { x: number; y: number; depth?: number }>;

export interface ExportInput {
  /** The project's folder name, used as the title. */
  title: string;
  nodes: VisibleNode[];
  edges: VisibleEdge[];
  /** File-level imports among the files shown, including those inside closed folders. */
  imports: number;
  /** Said after the summary, such as which files were left out. */
  note?: string;
  colorOf: (id: string) => string;
  /** Legend entries for the colours the picture uses, in legend order. */
  key: { label: string; color: string }[];
}

const EDGE_COLOR = "#475569";
const LABEL_COLOR = "#cbd5e1";
const MUTED_COLOR = "#94a3b8";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const PADDING = 48;
const HEADER = 64;
/** At most this many labels, so a huge graph stays a picture rather than a wall of text. */
const MAX_LABELS = 600;
const LABEL_FONT_SIZE = 12;
/** Mermaid's own default limit; renderers refuse bigger charts unless configured. */
export const MERMAID_MAX_EDGES = 500;

/** Node radius in pixels, the same as the 2D view draws it. */
function radiusOf(node: VisibleNode): number {
  return Math.min(4 + 2 * Math.sqrt(node.fileCount), 28);
}

type Measure = (text: string) => number;

/** Text width in pixels at the label size, measured with the real font where a canvas exists. */
function textMeasurer(): Measure {
  const context = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  if (!context) return (text) => text.length * 0.56 * LABEL_FONT_SIZE;
  context.font = `500 ${LABEL_FONT_SIZE}px ${FONT}`;
  const cache = new Map<string, number>();
  return (text) => {
    let width = cache.get(text);
    if (width === undefined) cache.set(text, (width = context.measureText(text).width));
    return width;
  };
}

/**
 * Picks which nodes get a label and where, like the live view does: the most important
 * nodes first (folders by size, then files by how many wires they have), skipping any
 * label that would overlap one already placed.
 */
function placeLabels(
  nodes: VisibleNode[],
  edges: VisibleEdge[],
  place: (id: string) => { x: number; y: number },
  measure: Measure,
): { x: number; y: number; text: string }[] {
  const wires = new Map<string, number>();
  for (const e of edges) {
    wires.set(e.source, (wires.get(e.source) ?? 0) + e.weight);
    wires.set(e.target, (wires.get(e.target) ?? 0) + e.weight);
  }
  const rank = (n: VisibleNode) => (n.kind === "folder" ? 1e9 + n.fileCount : (wires.get(n.id) ?? 0));
  const ordered = [...nodes].sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id));

  // Placed boxes, bucketed by a coarse grid so each check only looks nearby.
  const CELL = 120;
  const grid = new Map<string, { x0: number; y0: number; x1: number; y1: number }[]>();
  const cells = (b: { x0: number; y0: number; x1: number; y1: number }) => {
    const keys: string[] = [];
    for (let gx = Math.floor(b.x0 / CELL); gx <= Math.floor(b.x1 / CELL); gx++) {
      for (let gy = Math.floor(b.y0 / CELL); gy <= Math.floor(b.y1 / CELL); gy++) keys.push(`${gx},${gy}`);
    }
    return keys;
  };
  const placed: { x: number; y: number; text: string }[] = [];
  for (const n of ordered) {
    if (placed.length >= MAX_LABELS) break;
    const { x, y } = place(n.id);
    const left = x + radiusOf(n) + 4;
    const box = { x0: left - 2, y0: y - 9, x1: left + measure(n.label) + 2, y1: y + 6 };
    const keys = cells(box);
    const hit = keys.some((key) =>
      grid.get(key)?.some((o) => box.x0 < o.x1 && o.x0 < box.x1 && box.y0 < o.y1 && o.y0 < box.y1),
    );
    if (hit) continue;
    for (const key of keys) {
      const list = grid.get(key);
      if (list) list.push(box);
      else grid.set(key, [box]);
    }
    placed.push({ x: left, y: y + 4, text: n.label });
  }
  return placed;
}

function escapeXml(text: string): string {
  // XML has no way to write most control characters, which file names can contain.
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Rounds coordinates so the file stays small without moving anything visibly. */
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Draws the graph as a standalone SVG. Positions come from the view, so the picture keeps
 * the arrangement (and, for 3D, the angle) the user was looking at, scaled to fit.
 */
export function buildSvg(
  input: ExportInput,
  positions: ScreenPositions,
): { svg: string; width: number; height: number } {
  const pos = (id: string) => positions.get(id)!;
  const nodes = input.nodes
    .filter((n) => positions.has(n.id))
    .sort((a, b) => (pos(b.id).depth ?? 0) - (pos(a.id).depth ?? 0));

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const { x, y } = pos(n.id);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (nodes.length === 0) minX = maxX = minY = maxY = 0;

  // Bigger graphs get a bigger page, so nodes keep about the spacing they have on screen.
  const target = Math.min(Math.max(140 * Math.sqrt(nodes.length), 960), 4800);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const scale = Math.max(spanX, spanY) > 0 ? target / Math.max(spanX, spanY) : 1;
  // Room for the widest label to the right of a node.
  const labelRoom = 160;
  const width = Math.ceil(Math.max(spanX * scale + 2 * PADDING + labelRoom, 640));
  const keyHeight = input.key.length > 0 ? 28 : 0;
  const height = Math.ceil(spanY * scale + 2 * PADDING + HEADER + keyHeight);
  const left = PADDING + (width - 2 * PADDING - labelRoom - spanX * scale) / 2;
  const top = PADDING + HEADER + keyHeight;
  const place = (id: string) => {
    const p = pos(id);
    return { x: left + (p.x - minX) * scale, y: top + (p.y - minY) * scale };
  };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const measure = textMeasurer();
  const labels = placeLabels(nodes, input.edges, place, measure);

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${escapeXml(FONT)}">`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10z" fill="${EDGE_COLOR}"/></marker></defs>`,
    `<rect width="100%" height="100%" fill="${BACKGROUND}"/>`,
    `<text x="${PADDING}" y="${PADDING + 8}" font-size="20" font-weight="600" fill="#f1f5f9">${escapeXml(input.title)}</text>`,
    `<text x="${PADDING}" y="${PADDING + 34}" font-size="13" fill="${MUTED_COLOR}">${escapeXml(summary(input))}</text>`,
  );

  // The key: one swatch per colour the picture uses.
  if (input.key.length > 0) {
    let x = PADDING;
    const y = PADDING + HEADER - 4;
    const parts: string[] = [];
    for (const k of input.key) {
      const itemWidth = 15 + measure(k.label);
      // Entries that would run off the page are left out rather than cut in half.
      if (x + itemWidth > width - PADDING) break;
      parts.push(
        `<circle cx="${x + 5}" cy="${y}" r="5" fill="${k.color}"/>`,
        `<text x="${x + 15}" y="${y + 4}" font-size="12" fill="${LABEL_COLOR}">${escapeXml(k.label)}</text>`,
      );
      x += itemWidth + 18;
    }
    out.push(`<g>${parts.join("")}</g>`);
  }

  // Wires first, so nodes sit on top. Each stops at its target's edge so the arrow shows.
  out.push(`<g stroke="${EDGE_COLOR}" stroke-opacity="0.75" fill="none" marker-end="url(#arrow)">`);
  for (const e of input.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    const a = place(s.id);
    const b = place(t.id);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const gap = radiusOf(t) + 2;
    if (length <= gap + radiusOf(s)) continue;
    const ex = b.x - (dx / length) * gap;
    const ey = b.y - (dy / length) * gap;
    const w = Math.min(1 + 0.6 * Math.log2(e.weight), 4);
    out.push(`<line x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(ex)}" y2="${r1(ey)}" stroke-width="${r1(w)}"/>`);
  }
  out.push(`</g>`);

  // Nodes: files are dots; folders are a coloured ring around a dot, as in the 2D view.
  out.push(`<g>`);
  for (const n of nodes) {
    const { x, y } = place(n.id);
    const r = radiusOf(n);
    const color = input.colorOf(n.id);
    if (n.kind === "folder") {
      out.push(
        `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r * 0.85)}" fill="${BACKGROUND}" stroke="${color}" stroke-width="${r1(r * 0.3)}"/>`,
        `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r * 0.52)}" fill="${color}"/>`,
      );
    } else {
      out.push(`<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}" fill="${color}"/>`);
    }
  }
  out.push(`</g>`);

  // Labels last, with a dark outline so they read over wires.
  out.push(
    `<g font-size="${LABEL_FONT_SIZE}" font-weight="500" fill="${LABEL_COLOR}" stroke="${BACKGROUND}" stroke-width="3" stroke-linejoin="round" paint-order="stroke">`,
  );
  for (const { x, y, text } of labels) {
    out.push(`<text x="${r1(x)}" y="${r1(y)}">${escapeXml(text)}</text>`);
  }
  out.push(`</g></svg>`);

  return { svg: out.join("\n"), width, height };
}

function summary(input: ExportInput): string {
  const files = input.nodes.reduce((sum, n) => sum + n.fileCount, 0);
  const plural = (n: number, word: string) => `${n.toLocaleString("en")} ${word}${n === 1 ? "" : "s"}`;
  const parts = [plural(files, "file"), plural(input.imports, "import"), `${plural(input.nodes.length, "node")} shown`];
  if (input.note) parts.push(input.note);
  return parts.join(" · ");
}

/** The largest side and area a PNG gets, which every webview can still draw on one canvas. */
const MAX_PNG_SIDE = 8192;
const MAX_PNG_PIXELS = 40_000_000;

/** Draws the SVG onto a canvas at twice its size (less for huge graphs) and encodes it as PNG. */
export async function svgToPng(svg: string, width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
  const scale = Math.min(2, MAX_PNG_SIDE / Math.max(width, height), Math.sqrt(MAX_PNG_PIXELS / (width * height)));
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not draw the picture");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not encode the picture");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Text inside a quoted Mermaid label: characters Mermaid treats specially become entity codes. */
function mermaidText(text: string): string {
  return text.replace(/[\u0000-\u001f]+/g, " ").replace(/["<>#`]/g, (c) => `#${c.charCodeAt(0)};`);
}

/**
 * Writes the visible graph as a Mermaid flowchart. Open folders become nested subgraphs,
 * closed folders become boxes that say how many files they hold, and a wire standing for
 * several imports is labelled with the count. Colours carry over as classes.
 */
export function buildMermaid(input: ExportInput): string {
  const ids = new Map<string, string>();
  input.nodes.forEach((n, i) => ids.set(n.id, `n${i}`));

  // Every open folder that holds a drawn node, and the open folders above it, become subgraphs.
  const childrenOf = new Map<string, { folders: Set<string>; nodes: VisibleNode[] }>();
  const groupOf = (folder: string) => {
    let group = childrenOf.get(folder);
    if (!group) {
      childrenOf.set(folder, (group = { folders: new Set(), nodes: [] }));
      if (folder !== ROOT) groupOf(parentOf(folder)).folders.add(folder);
    }
    return group;
  };
  for (const n of input.nodes) groupOf(n.parent).nodes.push(n);

  const note = input.note ? ` (${mermaidText(input.note)})` : "";
  const lines = [`flowchart LR`, `  %% ${mermaidText(input.title)}, drawn by Repository Visual Analysis${note}`];
  let subgraphs = 0;
  const write = (folder: string, indent: string) => {
    const group = childrenOf.get(folder)!;
    for (const sub of [...group.folders].sort()) {
      const name = sub.slice(parentOf(sub).length);
      lines.push(`${indent}subgraph s${subgraphs++}["${mermaidText(name)}"]`);
      write(sub, indent + "  ");
      lines.push(`${indent}end`);
    }
    for (const n of group.nodes) {
      const id = ids.get(n.id)!;
      if (n.kind === "folder") {
        const files = `${n.fileCount.toLocaleString("en")} file${n.fileCount === 1 ? "" : "s"}`;
        lines.push(`${indent}${id}[["${mermaidText(n.label)} · ${files}"]]`);
      } else {
        lines.push(`${indent}${id}["${mermaidText(n.label)}"]`);
      }
    }
  };
  write(ROOT, "  ");

  for (const e of input.edges) {
    const a = ids.get(e.source);
    const b = ids.get(e.target);
    if (!a || !b) continue;
    lines.push(e.weight > 1 ? `  ${a} -->|${e.weight}| ${b}` : `  ${a} --> ${b}`);
  }

  // One class per colour, with dark text so labels read on every fill.
  const byColor = new Map<string, string[]>();
  for (const n of input.nodes) {
    const color = input.colorOf(n.id);
    const list = byColor.get(color);
    if (list) list.push(ids.get(n.id)!);
    else byColor.set(color, [ids.get(n.id)!]);
  }
  let c = 0;
  for (const [color, members] of byColor) {
    lines.push(`  classDef c${c} fill:${color},stroke:${color},color:${BACKGROUND}`);
    lines.push(`  class ${members.join(",")} c${c}`);
    c++;
  }
  return lines.join("\n") + "\n";
}
