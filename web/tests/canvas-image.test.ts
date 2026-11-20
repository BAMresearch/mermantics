// @vitest-environment happy-dom
// "Export → Picture": what is asked of the snapshot library. The picture itself needs a real
// browser: scripts/check-picture-export.mjs.

import { beforeEach, expect, test, vi } from "vitest";

const shot = vi.hoisted(() => ({ png: vi.fn(async () => "data:image/png;base64,"), svg: vi.fn() }));
vi.mock("modern-screenshot", () => ({ domToPng: shot.png, domToForeignObjectSvg: shot.svg }));

import { canvasImage } from "../src/canvas/canvasImage.js";

type Options = { width: number; height: number; scale?: number; style: Record<string, string>;
  filter: (n: Node) => boolean; onCloneEachNode: (n: Node) => void };
const optionsOf = (mock: typeof shot.png) => (mock.mock.calls[0] as unknown as [HTMLElement, Options])[1];

beforeEach(() => { shot.png.mockClear(); shot.svg.mockClear(); });

test("the picture is cropped to the boxes with a margin, at 100 %", async () => {
  await canvasImage(document.createElement("div"), { x: -50, y: 100, width: 800, height: 400 }, "png");
  const o = optionsOf(shot.png);
  expect([o.width, o.height, o.scale]).toEqual([864, 464, 2]);
  expect(o.style.transform).toBe("translate(82px, -68px) scale(1)");
});

test("a very large diagram gets fewer pixels, not an error", async () => {
  await canvasImage(document.createElement("div"), { x: 0, y: 0, width: 11_936, height: 1_000 }, "png");
  expect(optionsOf(shot.png).scale).toBeCloseTo(16_000 / 12_000);
});

test("connection dots are left out, and CSS variables and arrow clipping are fixed", async () => {
  await canvasImage(document.createElement("div"), { x: 0, y: 0, width: 10, height: 10 }, "png");
  const o = optionsOf(shot.png);
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

test("the SVG is the drawn foreignObject SVG, as a downloadable URL", async () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  shot.svg.mockResolvedValue(svg);
  const url = await canvasImage(document.createElement("div"), { x: 0, y: 0, width: 10, height: 10 }, "svg");
  expect(url).toMatch(/^blob:/);
  URL.revokeObjectURL(url);
});
