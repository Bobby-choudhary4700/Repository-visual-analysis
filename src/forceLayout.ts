import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

/** Node positions by node id. */
export type Positions = Record<string, { x: number; y: number }>;

/** A layout job: where each node starts, how the nodes are wired, and how long to run. */
export interface LayoutRequest {
  id: number;
  nodes: { id: string; x: number; y: number }[];
  edges: { source: string; target: string; weight: number }[];
  iterations: number;
}

export type LayoutReply = { id: number; positions: Positions } | { id: number; error: string };

/** Runs ForceAtlas2. Shared by the layout worker and the inline fallback, so both agree. */
export function runLayout({ nodes, edges, iterations }: LayoutRequest): Positions {
  const graph = new Graph({ type: "directed" });
  for (const n of nodes) graph.addNode(n.id, { x: n.x, y: n.y });
  for (const e of edges) graph.addDirectedEdge(e.source, e.target, { weight: e.weight });
  return forceAtlas2(graph, {
    iterations,
    settings: {
      ...forceAtlas2.inferSettings(graph),
      barnesHutOptimize: graph.order > 500,
      outboundAttractionDistribution: true,
    },
  });
}
