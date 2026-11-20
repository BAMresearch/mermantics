/**
 * The canvas as a picture, as you see it: the boxes where you put them, with their captions,
 * fields, colours and arrows. It is a snapshot of the drawn canvas, as in React Flow's "download
 * image" example, cropped to the diagram, on white, without the zoom bar, minimap or connection
 * dots. The caller hides the selection first (see `exporting` in App.tsx).
 *
 * modern-screenshot writes only the styles that differ from the browser's defaults, so the SVG
 * stays small; html-to-image, which React Flow's example uses, copies every style onto every
 * element (1.4 MB for the coffee example, against 300 kB here).
 */

import type { Rect, XYPosition } from "@xyflow/react";
import { domToBlob, domToForeignObjectSvg } from "modern-screenshot";

export type ImageFormat = "png" | "svg";

// White space around the diagram. It also holds the arrowheads, which browsers leave out of an
// arrow's bounds: ours reach at most about 7 px past the end of the line.
const MARGIN = 32;
// The largest PNG every browser draws: iOS Safari stops at 4096 × 4096 pixels in all (any shape),
// the others at 32,767 on a side or less. A larger canvas comes out empty, not as an error.
const MAX_PIXELS = 4096 * 4096;
const MAX_SIDE = 16_384;

/** What is drawn: boxes (and the openBIS lanes), arrows and arrow labels. */
const DRAWN = ".react-flow__node, .react-flow__edge-path, .react-flow__edge-textwrapper";

/** Everything drawn on the canvas, in canvas coordinates. It is measured where the browser drew
 * it, so curved and parallel arrows and long labels are inside, whatever the pan and zoom.
 * `toCanvas` is React Flow's `screenToFlowPosition`. Null when nothing is drawn. */
export function drawnBounds(viewport: HTMLElement, toCanvas: (point: XYPosition) => XYPosition): Rect | null {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const element of viewport.querySelectorAll(DRAWN)) {
    const r = element.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  if (left > right) return null;
  const a = toCanvas({ x: left, y: top });
  const b = toCanvas({ x: right, y: bottom });
  return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}

/** Pixels per canvas pixel for the PNG: twice, for slides and sharp screens, unless that is
 * more than every browser can draw. */
export function pngScale(width: number, height: number): number {
  return Math.min(2, MAX_SIDE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
}

/** The snapshot of `viewport` (React Flow's `.react-flow__viewport`) cropped to `bounds`. */
export async function canvasImage(viewport: HTMLElement, bounds: Rect, format: ImageFormat): Promise<Blob> {
  const width = Math.ceil(bounds.width + 2 * MARGIN);
  const height = Math.ceil(bounds.height + 2 * MARGIN);
  const options = {
    backgroundColor: "#ffffff",
    width,
    height,
    // Drawn at 100 %, whatever the zoom on screen, with the diagram's top left corner at the margin.
    style: { width: `${width}px`, height: `${height}px`,
             transform: `translate(${MARGIN - bounds.x}px, ${MARGIN - bounds.y}px) scale(1)` },
    filter: (node: Node) => !(node instanceof Element && node.classList.contains("react-flow__handle")),
    // The copied styles are resolved values; the CSS variables they came from (React Flow
    // defines about a hundred on every element) would only make the file large.
    onCloneEachNode: (clone: Node) => {
      if (!(clone instanceof HTMLElement || clone instanceof SVGElement)) return;
      const { style } = clone;
      const variables = Array.from({ length: style.length }, (_, i) => style.item(i)).filter((name) => name.startsWith("--"));
      for (const name of variables) style.removeProperty(name);
      // Each arrow is its own small <svg> that React Flow lets draw outside itself. "visible" is
      // the default for HTML, so it is not copied, but an inner <svg> clips by default: without
      // this every arrow is cut off.
      if (clone instanceof SVGSVGElement) clone.style.overflow = "visible";
    },
  };
  if (format === "png") {
    const png = await domToBlob(viewport, { ...options, type: "image/png", scale: pngScale(width, height) });
    // Within the limits above this does not happen, but a browser short of memory gives an empty
    // canvas, which comes back as a few bytes of PNG settings rather than an error. 67 bytes is
    // the smallest possible PNG.
    if (png.size < 67) throw new Error("the diagram is too large for a PNG in this browser; save it as SVG");
    return png;
  }
  // The boxes kept as HTML inside the SVG, so text stays text and sharp at any size.
  // (modern-screenshot's domToSvg would wrap a PNG instead.)
  const svg = await domToForeignObjectSvg(viewport, options);
  // White behind the whole picture: the snapshot's own background moves with the diagram, so
  // without this the strips the crop shifts it away from stay transparent.
  const white = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  white.setAttribute("width", "100%");
  white.setAttribute("height", "100%");
  white.setAttribute("fill", "#ffffff");
  svg.prepend(white);
  return new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
}

/** Resolves once the browser has drawn the latest render, e.g. with the selection hidden. */
export function afterPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
