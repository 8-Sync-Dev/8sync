// Layered graph layout for the workflow canvas.
//
// Backed by dagre rather than elkjs: both call sites only ever asked for
// `elk.algorithm: layered` with a direction and a node spacing, and read back
// one {x, y} per node. elk.bundled.js is a GWT-compiled Java port — 1 606 238 B
// raw, 85 % of the whole dashboard bundle — for a feature dagre covers in a
// fraction of that. See su-code/planning/lean-binary/M2-VERIFICATION.md.
import dagre from "@dagrejs/dagre";

export type LayoutNode = { id: string; width: number; height: number };
export type LayoutEdge = { source: string; target: string };
export type Positioned = Map<string, { x: number; y: number }>;

/**
 * Layered layout. `dir` is "RIGHT" (left→right ranks) or "DOWN" (top→bottom),
 * matching the elk direction names the call sites used.
 *
 * dagre reports node CENTRES; React Flow positions by top-left corner, which is
 * also what elk returned — so each result is shifted back by half the node box.
 */
export function layered(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  dir: "RIGHT" | "DOWN",
  nodeSep = 28,
): Positioned {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: dir === "RIGHT" ? "LR" : "TB", nodesep: nodeSep, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
  // dagre invents a node for an unknown endpoint, which would place a phantom
  // box on the canvas; elk simply ignored such edges.
  for (const e of edges) if (ids.has(e.source) && ids.has(e.target)) g.setEdge(e.source, e.target);

  dagre.layout(g);

  const out: Positioned = new Map();
  for (const n of nodes) {
    const p = g.node(n.id);
    out.set(n.id, p ? { x: p.x - n.width / 2, y: p.y - n.height / 2 } : { x: 0, y: 0 });
  }
  return out;
}
