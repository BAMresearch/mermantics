/**
 * An arrow that starts and ends on the side of each box that faces the other box, like in
 * draw.io, instead of at fixed connection dots. Based on React Flow's floating edges example.
 */

import { BaseEdge, getBezierPath, Position, useInternalNode, type EdgeProps, type InternalNode } from "@xyflow/react";

import type { Arrow } from "./model.js";

export type Rect = { x: number; y: number; w: number; h: number };

function rectOf(node: InternalNode): Rect {
  const { x, y } = node.internals.positionAbsolute;
  return { x, y, w: node.measured.width ?? 0, h: node.measured.height ?? 0 };
}

/** Where the line from the centre of `a` to the centre of `b` leaves `a`. */
function intersection(a: Rect, b: Rect): { x: number; y: number } {
  const w = a.w / 2;
  const h = a.h / 2;
  const x2 = a.x + w;
  const y2 = a.y + h;
  const x1 = b.x + b.w / 2;
  const y1 = b.y + b.h / 2;
  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
  const s = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = s * xx1;
  const yy3 = s * yy1;
  return { x: w * (xx3 + yy3) + x2, y: h * (-xx3 + yy3) + y2 };
}

function side(r: Rect, p: { x: number; y: number }): Position {
  if (p.x <= r.x + 1) return Position.Left;
  if (p.x >= r.x + r.w - 1) return Position.Right;
  if (p.y <= r.y + 1) return Position.Top;
  return Position.Bottom;
}

/** Route parallel relationships through separate midpoints. */
export function arrowPath(a: Rect, b: Rect, lane = 0, labelWidth = 40): [string, number, number] {
  const dx = b.x + b.w / 2 - a.x - a.w / 2;
  const dy = b.y + b.h / 2 - a.y - a.h / 2;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const offset = lane * (Math.abs(nx) * labelWidth + Math.abs(ny) * 40);
  const mid = { x: (a.x + a.w / 2 + b.x + b.w / 2) / 2 + nx * offset,
                y: (a.y + a.h / 2 + b.y + b.h / 2) / 2 + ny * offset, w: 0, h: 0 };
  const from = intersection(a, lane ? mid : b);
  const to = intersection(b, lane ? mid : a);
  if (!lane) {
    const [path, x, y] = getBezierPath({
      sourceX: from.x, sourceY: from.y, sourcePosition: side(a, from),
      targetX: to.x, targetY: to.y, targetPosition: side(b, to),
    });
    return [path, x, y];
  }
  // This control point puts the curve's midpoint exactly at the label.
  const cx = 2 * mid.x - (from.x + to.x) / 2;
  const cy = 2 * mid.y - (from.y + to.y) / 2;
  return [`M ${from.x},${from.y} Q ${cx},${cy} ${to.x},${to.y}`, mid.x, mid.y];
}

export function FloatingEdge({ id, source, target, data, markerEnd, style, label, labelStyle, labelBgStyle, labelBgPadding,
                               labelBgBorderRadius, interactionWidth }: EdgeProps<Arrow>) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t) return null;
  const [path, labelX, labelY] = arrowPath(rectOf(s), rectOf(t), data?.lane, data?.laneLabelWidth);
  return (
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} label={label} labelX={labelX} labelY={labelY}
              labelStyle={labelStyle} labelBgStyle={labelBgStyle} labelBgPadding={labelBgPadding}
              labelBgBorderRadius={labelBgBorderRadius} interactionWidth={interactionWidth ?? 16} />
  );
}
