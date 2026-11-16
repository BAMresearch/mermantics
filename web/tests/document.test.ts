import { describe, expect, test } from "vitest";
import { applyPositions, DocumentWork } from "../src/canvas/document.js";
import { fromMermaid } from "../src/canvas/model.js";

const boxes = () => fromMermaid('flowchart TD\nA["A"]\nB["B"]\nC["C"]').boxes;

describe("document work", () => {
  test("replacement invalidates layouts and document callbacks, even with reused IDs", () => {
    const work = new DocumentWork();
    const document = work.replace();
    const valid = work.beginLayout();
    expect(valid()).toBe(true);
    work.replace();
    expect(valid()).toBe(false);
    expect(work.owns(document)).toBe(false);
  });

  test("latest layout wins without invalidating other document work", () => {
    const work = new DocumentWork();
    const document = work.replace();
    const first = work.beginLayout();
    const second = work.beginLayout();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
    expect(work.owns(document)).toBe(true);
  });

  test("only positions are merged; edits, moves, additions and deletions survive", () => {
    const snapshot = boxes();
    const placed = snapshot.map((b) => ({ ...b, position: { x: 100, y: 200 } }));
    const edited = { ...snapshot[0]!, selected: true, data: { ...snapshot[0]!.data, name: "Edited", kind: "note" as const } };
    const moved = { ...snapshot[1]!, position: { x: 44, y: 55 } };
    const added = { ...snapshot[2]!, id: "D" };
    const result = applyPositions([edited, moved, added], snapshot, placed);
    expect(result).toEqual([{ ...edited, position: { x: 100, y: 200 } }, moved, added]);
  });

  test("a box being dragged keeps its position", () => {
    const snapshot = boxes();
    const dragging = { ...snapshot[0]!, dragging: true };
    expect(applyPositions([dragging], snapshot, [{ ...dragging, position: { x: 1, y: 2 } }])).toEqual([dragging]);
  });
});
