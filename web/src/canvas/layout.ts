/** Automatic layout with ELK (layered), for "Tidy up" and for imported diagrams without positions. */

import type { ELK as Elk } from "elkjs/lib/elk.bundled.js";

import type { Arrow, Box } from "./model.js";

// ELK is large, so it is only loaded the first time a layout is needed.
let elk: Promise<Elk> | null = null;
function getElk(): Promise<Elk> {
  elk ??= import("elkjs/lib/elk.bundled.js").then(({ default: ELK }) => new ELK());
  return elk;
}

export async function layout(boxes: Box[], arrows: Arrow[], direction: "DOWN" | "RIGHT" = "DOWN"): Promise<Box[]> {
  const ids = new Set(boxes.map((b) => b.id));
  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    },
    children: boxes.map((b) => ({ id: b.id, width: b.measured?.width ?? 220, height: b.measured?.height ?? 90 })),
    // Inheritance arrows point child -> parent on the canvas; lay parents out above children.
    edges: arrows.filter((a) => ids.has(a.source) && ids.has(a.target)).map((a) => (
      a.data?.kind === "inherit"
        ? { id: a.id, sources: [a.target], targets: [a.source] }
        : { id: a.id, sources: [a.source], targets: [a.target] })),
  };
  const result = await (await getElk()).layout(graph);
  const placed = new Map((result.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
  return boxes.map((b) => ({ ...b, position: placed.get(b.id) ?? b.position }));
}
