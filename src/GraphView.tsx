import { useEffect, useRef } from "react";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import type { NodeDisplayData, PartialButFor } from "sigma/types";
import type { Settings } from "sigma/settings";
import { EdgeArrowProgram } from "sigma/rendering";
import { ROOT, parentOf, type VisibleEdge, type VisibleNode } from "./graph";
import type { Lang } from "./types";

const LANG_COLORS: Record<Lang, string> = {
  javascript: "#facc15",
  typescript: "#3b82f6",
  tsx: "#06b6d4",
  python: "#22c55e",
  rust: "#f97316",
};
const FOLDER_COLOR = "#a78bfa";
const OTHER_FILE_COLOR = "#94a3b8";
const EDGE_COLOR = "#64748b";
const DIM_COLOR = "#1e293b";
const SELECTED_COLOR = "#f472b6";

interface Props {
  nodes: VisibleNode[];
  edges: VisibleEdge[];
  langOf: (fileId: string) => Lang | null;
  /** The selected file, highlighted and centred when it is drawn. */
  selected: string | null;
  /** Bumped to centre the camera on `selected` again, e.g. when it is picked twice. */
  focusRequest: number;
  onExpand: (folderId: string) => void;
  onCollapse: (folderId: string) => void;
  /** A file was clicked, or `null` when the empty background was. */
  onSelect: (fileId: string | null) => void;
}

type Position = { x: number; y: number };

/**
 * Draws the visible graph with WebGL. Nodes keep their position across expand and
 * collapse: new children start where their folder was, so the layout settles locally
 * instead of reshuffling the whole picture.
 */
export function GraphView({ nodes, edges, langOf, selected, focusRequest, onExpand, onCollapse, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef(new Graph({ type: "directed" }));
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const handlersRef = useRef({ onExpand, onCollapse, onSelect });
  handlersRef.current = { onExpand, onCollapse, onSelect };

  // Create the renderer once.
  useEffect(() => {
    const graph = graphRef.current;
    const sigma = new Sigma(graph, containerRef.current!, {
      defaultEdgeType: "arrow",
      edgeProgramClasses: { arrow: EdgeArrowProgram },
      labelColor: { color: "#e2e8f0" },
      labelRenderedSizeThreshold: 6,
      defaultDrawNodeHover: drawHover,
      zIndex: true,
      // Hovering traces a node's wires; with nothing hovered, the selected file's wires show.
      nodeReducer: (node, data) => {
        const sel = selectedRef.current;
        const styled = node === sel ? { ...data, color: SELECTED_COLOR, size: data.size * 1.5, forceLabel: true } : data;
        const focus = focusNode(graph);
        if (!focus || node === focus || graph.areNeighbors(node, focus)) {
          return { ...styled, zIndex: 1 };
        }
        return { ...styled, color: DIM_COLOR, label: "", zIndex: 0 };
      },
      edgeReducer: (edge, data) => {
        const focus = focusNode(graph);
        if (!focus) return data;
        if (graph.hasExtremity(edge, focus)) return { ...data, color: "#cbd5e1" };
        return { ...data, hidden: true };
      },
    });

    sigma.on("clickNode", ({ node }) => {
      if (graph.getNodeAttribute(node, "kind") === "folder") {
        handlersRef.current.onExpand(node);
      } else {
        handlersRef.current.onSelect(node);
      }
    });
    sigma.on("clickStage", () => handlersRef.current.onSelect(null));
    sigma.on("rightClickNode", ({ node, event }) => {
      event.original.preventDefault();
      const parent = parentOf(node);
      if (parent !== ROOT) handlersRef.current.onCollapse(parent);
    });
    sigma.on("enterNode", ({ node }) => {
      hoveredRef.current = node;
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("leaveNode", () => {
      hoveredRef.current = null;
      sigma.refresh({ skipIndexation: true });
    });

    sigmaRef.current = sigma;
    function focusNode(g: Graph): string | null {
      const candidate = hoveredRef.current ?? selectedRef.current;
      return candidate && g.hasNode(candidate) ? candidate : null;
    }
    return () => {
      sigma.kill();
      sigmaRef.current = null;
    };
  }, []);

  // Sync the graph whenever the visible nodes change.
  useEffect(() => {
    const graph = graphRef.current;
    const previous = new Map<string, Position>();
    graph.forEachNode((id, attrs) => previous.set(id, { x: attrs.x, y: attrs.y }));

    graph.clear();
    hoveredRef.current = null;

    let fresh = 0;
    for (const node of nodes) {
      const pos = previous.get(node.id) ?? startPosition(node, previous);
      if (!previous.has(node.id)) fresh++;
      graph.addNode(node.id, {
        ...pos,
        label: node.label,
        kind: node.kind,
        size: Math.min(4 + 2 * Math.sqrt(node.fileCount), 28),
        color: node.kind === "folder" ? FOLDER_COLOR : colorFor(langOf(node.id)),
      });
    }
    for (const edge of edges) {
      graph.addDirectedEdge(edge.source, edge.target, {
        size: Math.min(1.5 + Math.log2(edge.weight), 6),
        color: EDGE_COLOR,
        weight: edge.weight,
      });
    }

    if (graph.order > 1) {
      // A full layout on first draw; a short settle when only part of the graph changed.
      const iterations = fresh === graph.order ? 300 : 80;
      forceAtlas2.assign(graph, {
        iterations,
        settings: { ...forceAtlas2.inferSettings(graph), barnesHutOptimize: graph.order > 500 },
      });
    }
    sigmaRef.current?.refresh();
  }, [nodes, edges, langOf]);

  // Declared after the sync above so a newly revealed file is in the graph before the camera moves.
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    sigma.refresh({ skipIndexation: true });
    if (focusRequest === 0 || !selected || !graphRef.current.hasNode(selected)) return;
    const target = sigma.getNodeDisplayData(selected);
    if (target) {
      sigma.getCamera().animate(
        { x: target.x, y: target.y, ratio: Math.min(sigma.getCamera().ratio, 0.6) },
        { duration: 400 },
      );
    }
  }, [selected, focusRequest]);

  return (
    <div
      ref={containerRef}
      className="graph"
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

/** Places a new node on its nearest drawn ancestor (the folder that was just expanded), or on a former child after a collapse. */
function startPosition(node: VisibleNode, previous: Map<string, Position>): Position {
  // Seeded by the node id so the same project lays out the same way every time.
  let seed = hash(node.id);
  const jitter = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 2 ** 32 - 0.5) * 2;
  };
  let ancestor = node.parent;
  while (true) {
    const pos = previous.get(ancestor);
    if (pos) return { x: pos.x + jitter(), y: pos.y + jitter() };
    if (ancestor === ROOT) break;
    ancestor = parentOf(ancestor);
  }
  for (const [id, pos] of previous) {
    if (id.startsWith(node.id)) return { ...pos };
  }
  return { x: jitter() * 50, y: jitter() * 50 };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Sigma's default hover label is a white box, unreadable with light label text on a dark theme. */
function drawHover(
  context: CanvasRenderingContext2D,
  data: PartialButFor<NodeDisplayData, "x" | "y" | "size" | "label" | "color">,
  settings: Settings,
): void {
  const size = settings.labelSize;
  context.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
  const label = data.label ?? "";
  const width = context.measureText(label).width;
  const pad = 4;
  context.fillStyle = "#1e293b";
  context.strokeStyle = "#475569";
  context.beginPath();
  context.roundRect(data.x + data.size + 2, data.y - size / 2 - pad, width + pad * 2, size + pad * 2, 4);
  context.fill();
  context.stroke();
  context.beginPath();
  context.arc(data.x, data.y, data.size + 2, 0, Math.PI * 2);
  context.strokeStyle = "#e2e8f0";
  context.stroke();
  context.fillStyle = "#f8fafc";
  context.fillText(label, data.x + data.size + 2 + pad, data.y + size / 3);
}

function colorFor(lang: Lang | null): string {
  return lang ? LANG_COLORS[lang] : OTHER_FILE_COLOR;
}
