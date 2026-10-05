import { useEffect, useRef } from "react";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
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

interface Props {
  nodes: VisibleNode[];
  edges: VisibleEdge[];
  langOf: (fileId: string) => Lang | null;
  onExpand: (folderId: string) => void;
  onCollapse: (folderId: string) => void;
}

type Position = { x: number; y: number };

/**
 * Draws the visible graph with WebGL. Nodes keep their position across expand and
 * collapse: new children start where their folder was, so the layout settles locally
 * instead of reshuffling the whole picture.
 */
export function GraphView({ nodes, edges, langOf, onExpand, onCollapse }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef(new Graph({ type: "directed" }));
  const hoveredRef = useRef<string | null>(null);
  const handlersRef = useRef({ onExpand, onCollapse });
  handlersRef.current = { onExpand, onCollapse };

  // Create the renderer once.
  useEffect(() => {
    const graph = graphRef.current;
    const sigma = new Sigma(graph, containerRef.current!, {
      defaultEdgeType: "arrow",
      edgeProgramClasses: { arrow: EdgeArrowProgram },
      labelColor: { color: "#e2e8f0" },
      labelRenderedSizeThreshold: 6,
      zIndex: true,
      nodeReducer: (node, data) => {
        const hovered = hoveredRef.current;
        if (!hovered || node === hovered || graph.areNeighbors(node, hovered)) {
          return { ...data, zIndex: 1 };
        }
        return { ...data, color: DIM_COLOR, label: "", zIndex: 0 };
      },
      edgeReducer: (edge, data) => {
        const hovered = hoveredRef.current;
        if (!hovered || graph.hasExtremity(edge, hovered)) return data;
        return { ...data, hidden: true };
      },
    });

    sigma.on("clickNode", ({ node }) => {
      if (graph.getNodeAttribute(node, "kind") === "folder") {
        handlersRef.current.onExpand(node);
      }
    });
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

function colorFor(lang: Lang | null): string {
  return lang ? LANG_COLORS[lang] : OTHER_FILE_COLOR;
}
