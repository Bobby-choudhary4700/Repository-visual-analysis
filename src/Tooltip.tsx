/** What the hover tooltip says about a node. */
export interface NodeInfo {
  title: string;
  path: string;
  color: string;
  /** Shape cue next to the colour, so a folder never reads by colour alone. */
  kind: "folder" | "file";
  detail: string;
  hint: string;
}

const WIDTH = 280;

/** The card shown next to the pointer while a node is hovered, in either view. */
export function NodeTooltip({
  info,
  x,
  y,
  container,
}: {
  info: NodeInfo;
  x: number;
  y: number;
  container: HTMLElement | null;
}) {
  return (
    <div className="tooltip" style={place(x, y, container)} role="tooltip">
      <div className="tooltip-title">
        <span className={info.kind === "folder" ? "dot ring" : "dot"} style={{ color: info.color }} />
        {info.title}
      </div>
      {info.path !== info.title && <div className="tooltip-path">{info.path}</div>}
      <div className="tooltip-detail">{info.detail}</div>
      <div className="tooltip-hint">{info.hint}</div>
    </div>
  );
}

/** Keeps the tooltip inside the canvas, flipping it to the other side of the pointer near an edge. */
function place(x: number, y: number, container: HTMLElement | null) {
  const width = container?.clientWidth ?? Infinity;
  const height = container?.clientHeight ?? Infinity;
  const left = x + 16 + WIDTH > width ? x - 16 - WIDTH : x + 16;
  const top = y + 120 > height ? y - 110 : y + 16;
  return { left: Math.max(8, left), top: Math.max(8, top), width: WIDTH };
}
