import { expect, test } from "vitest";
import { separateArrows } from "../src/canvas/edgeLanes.js";
import { arrowPath, type Rect } from "../src/canvas/FloatingEdge.js";
import { fromMermaid, toMermaid } from "../src/canvas/model.js";

const a: Rect = { x: 0, y: 0, w: 120, h: 60 };

test.each([
  { x: 400, y: 0, w: 120, h: 60 },
  { x: 0, y: 400, w: 120, h: 60 },
  { x: 400, y: 300, w: 120, h: 60 },
])("parallel and reverse arrows have separate paths and readable labels: %j", (b) => {
  const imported = fromMermaid('flowchart TB\n A["A"]\n B["B"]\n A -. "first relationship" .-> B\n B -. "second relationship" .-> A\n A -. "third relationship" .-> B');
  const routed = separateArrows(imported.arrows);
  const paths = routed.map((edge) => arrowPath(edge.source === "A" ? a : b, edge.target === "B" ? b : a,
    edge.data!.lane, edge.data!.laneLabelWidth));
  expect(new Set(paths.map(([path]) => path)).size).toBe(3);
  for (let i = 1; i < paths.length; i++) {
    const [, x, y] = paths[i]!;
    const [, px, py] = paths[i - 1]!;
    expect(Math.abs(x - px) >= routed[i]!.data!.laneLabelWidth! - 1 || Math.abs(y - py) >= 39).toBe(true);
  }
  expect(toMermaid(imported.boxes, routed)).toBe(toMermaid(imported.boxes, imported.arrows));
  expect(imported.arrows.every((edge) => edge.data!.lane === undefined)).toBe(true);
  const remaining = separateArrows([routed[0]!]);
  expect(remaining[0]!.data!.lane).toBe(0);
  expect(arrowPath(a, b, remaining[0]!.data!.lane)).toEqual(arrowPath(a, b));
});

test("two arrows in the same direction split around the original path", () => {
  const { arrows } = fromMermaid('flowchart TB\n A["A"]\n B["B"]\n A -. "first" .-> B\n A -. "second" .-> B\n B -. "other" .-> C');
  expect(separateArrows(arrows).map((edge) => edge.data!.lane)).toEqual([-0.5, 0.5, 0]);
});
