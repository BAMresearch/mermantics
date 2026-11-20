// @vitest-environment happy-dom
// "Export → Picture": the crop, the PNG size and what is asked of the snapshot library. The
// pictures themselves need a real browser: scripts/check-picture-export.mjs.

import { beforeEach, expect, test, vi } from "vitest";

const shot = vi.hoisted(() => ({ blob: vi.fn(), svg: vi.fn() }));
vi.mock("modern-screenshot", () => ({ domToBlob: shot.blob, domToForeignObjectSvg: shot.svg }));

import { canvasImage, drawnBounds, pngScale } from "../src/canvas/canvasImage.js";

type Options = { width: number; height: number; scale?: number; style: Record<string, string>;
  filter: (n: Node) => boolean; onCloneEachNode: (n: Node) => void };
const optionsOf = (mock: typeof shot.blob) => (mock.mock.calls[0] as unknown as [HTMLElement, Options])[1];
const png = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: "image/png" });

beforeEach(() => {
  shot.blob.mockReset().mockResolvedValue(png(1000));
  shot.svg.mockReset().mockResolvedValue(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
});

/** A viewport whose drawn parts sit at these screen rectangles. */
function viewport(parts: Record<string, [left: number, top: number, width: number, height: number][]>): HTMLElement {
  const root = document.createElement("div");
  for (const [className, rects] of Object.entries(parts)) {
    for (const [left, top, width, height] of rects) {
      const el = document.createElement("div");
      el.className = className;
      el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height } as DOMRect);
      root.append(el);
    }
  }
  return root;
}

test("the crop holds the arrows and labels that reach past the boxes, not the connection dots", () => {
  const v = viewport({
    "react-flow__node": [[100, 100, 200, 80], [100, 500, 200, 80]],
    // A parallel arrow curving out to the left, and its long label further out still.
    "react-flow__edge-path": [[-150, 180, 260, 320]],
    "react-flow__edge-textwrapper": [[-400, 330, 380, 24]],
    "react-flow__handle": [[-900, -900, 10, 10]],
  });
  expect(drawnBounds(v, (p) => p)).toEqual({ x: -400, y: 100, width: 700, height: 480 });
});

test("the crop is in canvas coordinates, whatever the pan and zoom", () => {
  const v = viewport({ "react-flow__node": [[100, 100, 200, 80]] });
  // Zoomed to 50 % and panned by (40, 20): a screen point (x, y) is canvas ((x - 40) * 2, (y - 20) * 2).
  const toCanvas = ({ x, y }: { x: number; y: number }) => ({ x: (x - 40) * 2, y: (y - 20) * 2 });
  expect(drawnBounds(v, toCanvas)).toEqual({ x: 120, y: 160, width: 400, height: 160 });
});

test("an empty canvas has nothing to crop to", () => {
  expect(drawnBounds(viewport({ "react-flow__node": [[0, 0, 0, 0]] }), (p) => p)).toBeNull();
});

test("the PNG has twice the pixels while every browser can draw that, and fewer beyond", () => {
  expect(pngScale(874, 584)).toBe(2);
  // Large diagrams: at most 4096 × 4096 pixels in all (iOS Safari) ...
  const scale = pngScale(5000, 3000);
  expect(scale).toBeLessThan(2);
  expect(Math.floor(5000 * scale) * Math.floor(3000 * scale)).toBeLessThanOrEqual(4096 * 4096);
  // ... and at most 16,384 on a side, also for a long thin one.
  expect(Math.floor(40_000 * pngScale(40_000, 100))).toBeLessThanOrEqual(16_384);
});

test("the picture is cropped with a margin and drawn at 100 %", async () => {
  await canvasImage(document.createElement("div"), { x: -50, y: 100, width: 800, height: 400 }, "png");
  const o = optionsOf(shot.blob);
  expect([o.width, o.height, o.scale]).toEqual([864, 464, 2]);
  expect(o.style.transform).toBe("translate(82px, -68px) scale(1)");
});

test("connection dots are left out, and CSS variables and arrow clipping are fixed", async () => {
  await canvasImage(document.createElement("div"), { x: 0, y: 0, width: 10, height: 10 }, "png");
  const o = optionsOf(shot.blob);
  const handle = document.createElement("div");
  handle.className = "react-flow__handle";
  expect(o.filter(handle)).toBe(false);
  expect(o.filter(document.createElement("div"))).toBe(true);
  expect(o.filter(document.createTextNode("x"))).toBe(true);

  const box = document.createElement("div");
  box.style.setProperty("--xy-edge-stroke", "#b1b1b7");
  box.style.color = "red";
  o.onCloneEachNode(box);
  expect(box.style.getPropertyValue("--xy-edge-stroke")).toBe("");
  expect(box.style.color).toBe("red");

  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  o.onCloneEachNode(arrow);
  expect(arrow.style.overflow).toBe("visible");
});

test("an empty PNG from a browser that could not draw it is an error, not a blank file", async () => {
  shot.blob.mockResolvedValue(png(33)); // what an empty canvas comes back as: just the PNG settings
  await expect(canvasImage(document.createElement("div"), { x: 0, y: 0, width: 10, height: 10 }, "png"))
    .rejects.toThrow(/too large for a PNG/);
});

test("the SVG is the drawn foreignObject SVG", async () => {
  const blob = await canvasImage(document.createElement("div"), { x: 0, y: 0, width: 10, height: 10 }, "svg");
  expect(blob.type).toBe("image/svg+xml");
  expect(await blob.text()).toMatch(/^<svg/);
});
