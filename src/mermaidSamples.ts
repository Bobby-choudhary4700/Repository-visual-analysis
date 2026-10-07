import { diagramData } from "@mermaid-js/examples";

// Sample diagrams and documentation pages for the Mermaid viewer, after the Mermaid Live
// Editor (https://github.com/mermaid-js/mermaid-live-editor, MIT licence): the samples
// are Mermaid's own example set, and the docs pages follow the editor's diagram catalogue.

export interface SampleDiagram {
  /** Short name for the button, such as "Flowchart" or "Entity Relationship". */
  name: string;
  /** The examples for this kind of diagram, the default one first. */
  examples: { title: string; code: string }[];
}

/** The common kinds come first, as in the Live Editor; the rest follow by name. */
const FIRST = ["Flowchart", "Class", "Sequence", "Entity Relationship", "State", "Mindmap"];

export const SAMPLE_DIAGRAMS: SampleDiagram[] = diagramData
  .filter((d) => d.name && d.examples.length > 0)
  .map((d) => ({
    name: d.name.replace(/ (Diagram|Chart|Graph)\b/, ""),
    examples: [...d.examples].sort((a, b) => Number(b.isDefault ?? false) - Number(a.isDefault ?? false)),
  }))
  .sort((a, b) => {
    const ra = FIRST.indexOf(a.name);
    const rb = FIRST.indexOf(b.name);
    if (ra >= 0 || rb >= 0) return (ra < 0 ? FIRST.length : ra) - (rb < 0 ? FIRST.length : rb);
    return a.name.localeCompare(b.name);
  });

/** Mermaid's names for the same kind of diagram, folded together. */
const ALIASES: Record<string, string> = {
  classDiagram: "class",
  "class-v2": "class",
  "flowchart-elk": "flowchart",
  "flowchart-v2": "flowchart",
  graph: "flowchart",
  "stateDiagram-v2": "stateDiagram",
  state: "stateDiagram",
};

/** The page about each kind of diagram on mermaid.js.org, under /syntax/. */
const DOCS: Record<string, string> = {
  architecture: "architecture.html",
  block: "block.html",
  c4: "c4.html",
  class: "classDiagram.html",
  cynefin: "cynefin.html",
  er: "entityRelationshipDiagram.html",
  eventmodeling: "eventmodeling.html",
  flowchart: "flowchart.html",
  gantt: "gantt.html",
  gitGraph: "gitgraph.html",
  ishikawa: "ishikawa.html",
  journey: "userJourney.html",
  kanban: "kanban.html",
  mindmap: "mindmap.html",
  packet: "packet.html",
  pie: "pie.html",
  quadrantChart: "quadrantChart.html",
  radar: "radar.html",
  railroad: "railroad.html",
  railroadAbnf: "railroad.html",
  railroadEbnf: "railroad.html",
  railroadPeg: "railroad.html",
  requirement: "requirementDiagram.html",
  sankey: "sankey.html",
  sequence: "sequenceDiagram.html",
  stateDiagram: "stateDiagram.html",
  timeline: "timeline.html",
  treeView: "treeView.html",
  treemap: "treemap.html",
  usecase: "usecase.html",
  venn: "venn.html",
  wardley: "wardley.html",
  xychart: "xyChart.html",
};

/**
 * The docs page for a diagram kind as Mermaid detected it, such as `flowchart.html`, or
 * an empty string for the docs' front page when the kind is unknown.
 */
export function docsPage(diagramType: string | undefined): string {
  if (!diagramType) return "";
  return DOCS[ALIASES[diagramType] ?? diagramType] ?? "";
}

export const DOCS_BASE = "https://mermaid.js.org/";
