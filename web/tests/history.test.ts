// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { History, isTextEntry, restoreOnto, snapshotOf, undoKey } from "../src/canvas/history.js";
import { fromMermaid, type Box } from "../src/canvas/model.js";

const doc = () => fromMermaid('flowchart TD\nA["A"]\nB["B"]\nA -- "has part" --> B');
const entry = (boxes: Box[], arrows = doc().arrows) => snapshotOf(boxes, arrows, [], null);
const moved = (boxes: Box[], x: number) => boxes.map((b) => (b.id === "A" ? { ...b, position: { x, y: 0 } } : b));

describe("snapshots", () => {
  test("selection, dragging, sizes and findings are not part of the document", () => {
    const { boxes, arrows } = doc();
    const plain = entry(boxes, arrows).key;
    const viewed = boxes.map((b) => ({ ...b, selected: true, dragging: false, measured: { width: 220, height: 80 },
                                       data: { ...b.data, problems: [{ level: "error" as const, message: "x", details: "" }] } }));
    expect(entry(viewed, arrows.map((a) => ({ ...a, selected: true }))).key).toBe(plain);
    expect(entry(moved(boxes, 99), arrows).key).not.toBe(plain);
    expect(entry(boxes.map((b) => ({ ...b, data: { ...b.data, name: "renamed" } })), arrows).key).not.toBe(plain);
  });

  test("only the document's fields are history: anything else on a box or arrow is not", () => {
    const { boxes, arrows } = doc();
    const plain = entry(boxes, arrows).key;
    const extra = { className: "lit", hidden: false, zIndex: 3, somethingNew: 1 };
    expect(entry(boxes.map((b) => ({ ...b, ...extra })), arrows.map((a) => ({ ...a, ...extra, animated: true }))).key).toBe(plain);
    // A new field in the data is part of the document, so it is history.
    expect(entry(boxes.map((b) => ({ ...b, data: { ...b.data, note: "new" } })), arrows).key).not.toBe(plain);
  });

  test("a restored snapshot keeps the current selection and findings", () => {
    const { boxes, arrows } = doc();
    const old = entry(boxes, arrows).snapshot;
    const problems = [{ level: "warning" as const, message: "m", details: "" }];
    const now = boxes.slice(0, 1).map((b) => ({ ...b, selected: true, data: { ...b.data, problems } }));
    const restored = restoreOnto(old, now, []);
    expect(restored.boxes.map((b) => [b.id, b.selected, b.data.problems])).toEqual([["A", true, problems], ["B", false, []]]);
    expect(restored.arrows).toHaveLength(1);
  });
});

describe("history", () => {
  test("undo and redo walk the recorded steps; an unchanged document is not a step", () => {
    const h = new History();
    const { boxes } = doc();
    h.reset(entry(boxes));
    expect(h.record(entry(boxes))).toBe(false);
    expect(h.canUndo).toBe(false);
    h.record(entry(moved(boxes, 10)));
    h.record(entry(moved(boxes, 20)));
    expect(h.undo()!.boxes[0]!.position.x).toBe(10);
    expect(h.undo()!.boxes[0]!.position.x).toBe(boxes[0]!.position.x);
    expect(h.undo()).toBeNull();
    expect(h.redo()!.boxes[0]!.position.x).toBe(10);
    expect(h.canRedo).toBe(true);
  });

  test("a new edit after undo clears what could be redone", () => {
    const h = new History();
    const { boxes } = doc();
    h.reset(entry(boxes));
    h.record(entry(moved(boxes, 10)));
    h.undo();
    h.record(entry(moved(boxes, 30)));
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeNull();
  });

  test("history is capped, and reset starts again", () => {
    const h = new History(3);
    const { boxes } = doc();
    h.reset(entry(boxes));
    for (let x = 1; x <= 5; x++) h.record(entry(moved(boxes, x)));
    let steps = 0;
    while (h.undo()) steps++;
    expect(steps).toBe(3);
    h.reset(entry(boxes));
    expect([h.canUndo, h.canRedo]).toEqual([false, false]);
  });

  test("an amendment changes the steps it is about without adding one", () => {
    const h = new History();
    const { boxes } = doc();
    h.reset(entry(boxes));
    h.record(entry(moved(boxes, 10)));
    // Like the real ones, it changes only snapshots that have what it is about.
    h.amend((s) => snapshotOf(s.boxes[0]!.position.x === 10 ? moved(s.boxes, 11) : s.boxes, s.arrows, s.uses, s.useCase));
    expect(h.record(entry(moved(boxes, 11)))).toBe(false);
    expect(h.undo()!.boxes[0]!.position.x).toBe(boxes[0]!.position.x);
  });

  test("an amendment reaches the steps that can be undone and redone", () => {
    const h = new History();
    const { boxes } = doc();
    const named = (bs: Box[]) => bs.map((b) => (b.id === "B" ? { ...b, data: { ...b.data, name: "named" } } : b));
    h.reset(entry(boxes));
    h.record(entry(moved(boxes, 10)));
    h.record(entry(moved(boxes, 20)));
    h.undo();
    h.amend((s) => snapshotOf(named(s.boxes), s.arrows, s.uses, s.useCase));
    expect(h.redo()!.boxes[1]!.data.name).toBe("named");
    expect(h.undo()!.boxes[1]!.data.name).toBe("named");
    expect(h.undo()!.boxes[1]!.data.name).toBe("named");
  });
});

describe("keys", () => {
  const press = (key: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean; code?: string } = {}) =>
    undoKey({ key, code: mods.code ?? "", ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift, altKey: !!mods.alt });

  test("Ctrl or Cmd with Z, Shift+Z and Y", () => {
    expect(press("z", { ctrl: true })).toBe("undo");
    expect(press("z", { meta: true })).toBe("undo");
    expect(press("Z", { ctrl: true, shift: true })).toBe("redo");
    expect(press("Z", { meta: true, shift: true })).toBe("redo");
    expect(press("y", { ctrl: true })).toBe("redo");
    expect(press("y", { meta: true })).toBeNull(); // Cmd+Y stays the browser's
    expect(press("z")).toBeNull();
    expect(press("z", { ctrl: true, alt: true })).toBeNull();
    expect(press("x", { ctrl: true })).toBeNull();
    expect(press("я", { ctrl: true, code: "KeyZ" })).toBe("undo"); // a keyboard without Latin letters
  });

  test("text fields keep their own undo; checkboxes and buttons do not", () => {
    const make = (html: string) => { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild; };
    expect(isTextEntry(make("<input>"))).toBe(true);
    expect(isTextEntry(make('<input type="search">'))).toBe(true);
    expect(isTextEntry(make("<textarea></textarea>"))).toBe(true);
    expect(isTextEntry(make('<input type="checkbox">'))).toBe(false);
    expect(isTextEntry(make("<button></button>"))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});
