import { StreamLanguage, type StringStream } from "@codemirror/language";

// Colours for Mermaid text in the viewer's code editor. Mermaid has many diagram kinds
// with their own grammars, so this is a light tokenizer that picks out what they share:
// the diagram kind, keywords, arrows, labels, strings, comments and directives.

const DIAGRAM_KINDS = new Set(
  (
    "flowchart graph sequenceDiagram classDiagram classDiagram-v2 stateDiagram stateDiagram-v2 erDiagram " +
    "gantt pie journey gitGraph mindmap timeline quadrantChart requirementDiagram C4Context C4Container " +
    "C4Component C4Dynamic C4Deployment sankey sankey-beta xychart xychart-beta block block-beta packet " +
    "packet-beta kanban architecture architecture-beta radar radar-beta treemap treemap-beta zenuml " +
    "ishikawa cynefin venn venn-beta wardley wardley-beta usecase eventmodeling treeView treeView-beta " +
    "railroad railroad-beta railroad-ebnf railroad-ebnf-beta railroad-abnf railroad-abnf-beta railroad-peg " +
    "railroad-peg-beta"
  ).split(" "),
);

const KEYWORDS = new Set(
  (
    "subgraph end direction classDef class style linkStyle click callback call href participant actor " +
    "loop alt else opt par and critical break rect note over of left right section title accTitle accDescr " +
    "dateFormat axisFormat tickInterval excludes includes todayMarker weekday state as autonumber activate " +
    "deactivate commit branch checkout merge cherry-pick id type tag showData box create destroy namespace " +
    "x-axis y-axis quadrant-1 quadrant-2 quadrant-3 quadrant-4 bar line group service junction in " +
    "columns space link requirement element functionalRequirement performanceRequirement interfaceRequirement " +
    "designConstraint physicalRequirement satisfies traces contains copies derives refines verifies " +
    "TD TB LR RL BT"
  ).split(" "),
);

interface State {
  /** Whether the diagram kind has been named yet; the first word names it. */
  started: boolean;
  /** Inside a `%%{ ... }%%` directive that spans lines. */
  directive: boolean;
  /** Inside the `---` front matter that can come before the diagram. */
  front: boolean;
}

function token(stream: StringStream, state: State): string | null {
  if (state.directive) {
    if (stream.skipTo("}%%")) {
      stream.match("}%%");
      state.directive = false;
    } else stream.skipToEnd();
    return "meta";
  }
  if (stream.eatSpace()) return null;
  if (stream.match("%%{")) {
    state.directive = true;
    return "meta";
  }
  if (stream.match("%%")) {
    stream.skipToEnd();
    return "comment";
  }
  if (!state.started && stream.match(/^---\s*$/)) {
    state.front = !state.front;
    return "meta";
  }
  const quote = stream.peek();
  if (quote === '"' || quote === "`") {
    stream.next();
    while (!stream.eol()) if (stream.next() === quote) break;
    return "string";
  }
  // A label on a link: A -->|label| B.
  if (stream.match(/^\|[^|\n]*\|/)) return "string";
  // Arrows and links of every kind: --> -.-> ==> ->> --x <|-- o-- ~~~ etc.
  if (stream.match(/^(<\|?|[ox](?=[-=.]))?[-=.~]{2,}(\|?>|>>|[>)xo*])?/) || stream.match(/^-[>)x]+/))
    return "operator";
  if (stream.match(/^:::/)) return "operator";
  if (stream.match(/^[[\](){}]/)) return "bracket";
  if (stream.match(/^-?\d+(\.\d+)?%?(?![\w-])/)) return "number";
  if (stream.match(/^#[0-9a-fA-F]{3,8}\b/)) return "number";
  const word = stream.match(/^[A-Za-z_][\w-]*/);
  if (word) {
    const text = (word as RegExpMatchArray)[0];
    if (!state.started && !state.front && stream.start === stream.indentation()) {
      state.started = true;
      if (DIAGRAM_KINDS.has(text)) return "keyword strong";
    }
    if (KEYWORDS.has(text)) return "keyword";
    // A name followed by a colon is a property or a field name: `title: x`, `fill:#fff`.
    if (stream.peek() === ":" && !stream.match(/^:::/, false)) return "propertyName";
    return "variableName";
  }
  stream.next();
  return null;
}

export const mermaidLanguage = StreamLanguage.define<State>({
  name: "mermaid",
  startState: () => ({ started: false, directive: false, front: false }),
  copyState: (s) => ({ ...s }),
  token,
  languageData: { commentTokens: { line: "%%" } },
});
