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

import type { Rect } from "@xyflow/react";
import { domToForeignObjectSvg, domToPng } from "modern-screenshot";

export type ImageFormat = "png" | "svg";

const MARGIN = 32; // room for arrows that curve out past the outermost boxes
const MAX_SIDE = 16_000; // browsers refuse to draw larger images

/** The snapshot as a URL to download: a PNG data URL, or an object URL of the SVG text (the caller
 * revokes it). `viewport` is React Flow's `.react-flow__viewport`; `bounds` is around all boxes,
 * in canvas coordinates. */
export async function canvasImage(viewport: HTMLElement, bounds: Rect, format: ImageFormat): Promise<string> {
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
    // Twice the pixels for a sharp picture on slides and high-resolution screens.
    return domToPng(viewport, { ...options, scale: Math.min(2, MAX_SIDE / Math.max(width, height)) });
  }
  // The boxes kept as HTML inside the SVG, so text stays text and sharp at any size.
  // (modern-screenshot's domToSvg would wrap a PNG instead.)
  const svg = new XMLSerializer().serializeToString(await domToForeignObjectSvg(viewport, options));
  return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}

/** Resolves once the browser has drawn the latest render, e.g. with the selection hidden. */
export function afterPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
