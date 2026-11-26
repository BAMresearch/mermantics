import { expect, test } from "vitest";
import { validateRecoveryDiagram } from "../src/canvas/recoveryDiagram.js";
import { emptyUseCase, fromMermaid, toMermaid } from "../src/canvas/model.js";
import { BUILT_IN, instantiate, patternFromSelection } from "../src/canvas/patterns.js";
import { freshState, VIEWS, VERDICTS } from "../src/canvas/options.js";
import { MODES } from "../src/canvas/mode.js";
import { readRecovery, recoveryFile } from "../src/canvas/recovery.js";
import { MAX_POSITION_COORDINATE } from "../src/canvas/validation.js";

test("recovery applies the same coordinate bounds as ordinary import", () => {
  const text = (x: number) => `flowchart TB\nA["A"]\n%% mermantics-layout {"A":[${x},0]}`;
  for (const x of [MAX_POSITION_COORDINATE, -MAX_POSITION_COORDINATE]) {
    expect(() => validateRecoveryDiagram(text(x))).not.toThrow();
  }
  for (const x of [MAX_POSITION_COORDINATE + 1, -MAX_POSITION_COORDINATE - 1, 1e308, -1e308]) {
    expect(() => validateRecoveryDiagram(text(x))).toThrow("Invalid mermantics-layout metadata");
  }
});

test("pattern placement at the coordinate limits exports a recoverable diagram", () => {
  const limit = MAX_POSITION_COORDINATE;
  const pattern = { ...BUILT_IN[0]!, text: `flowchart TB\nA["A"]\nB["B"]\nA --> B\n%% mermantics-layout {"A":[${-limit},0],"B":[${limit},0]}` };
  const inserted = instantiate(pattern, { x: 0, y: 0 });
  expect(inserted.positioned).toBe(true);
  expect(inserted.boxes.map((box) => box.position.x)).toEqual([0, 2 * limit]);

  const text = toMermaid(inserted.boxes, inserted.arrows);
  expect(() => validateRecoveryDiagram(text)).not.toThrow();
  const imported = fromMermaid(text);
  expect(imported.positioned).toBe(false);
  expect(imported.warnings).toEqual([]);
  expect(imported.boxes).toMatchObject([
    { id: "A", data: { name: "A", kind: "other", classId: "", lines: [] } },
    { id: "B", data: { name: "B", kind: "other", classId: "", lines: [] } },
  ]);
  expect(imported.arrows).toEqual(fromMermaid(pattern.text).arrows);
  expect(text).toContain('%% mermantics-layout {"A":[0,0]}');
  // Serialization does not move the boxes in the current editor.
  expect(inserted.boxes.map((box) => box.position.x)).toEqual([0, 2 * limit]);
});

test.each([MAX_POSITION_COORDINATE + 1, -MAX_POSITION_COORDINATE - 1, Infinity, -Infinity, NaN])(
  "export omits unusable generated coordinates (%s)", (coordinate) => {
    const { boxes, arrows } = fromMermaid('flowchart TB\nA["A"]\nB["B"]\nA --> B');
    boxes[0]!.position = { x: 12, y: 34 };
    boxes[1]!.position = { x: coordinate, y: coordinate };
    const text = toMermaid(boxes, arrows);
    expect(() => validateRecoveryDiagram(text)).not.toThrow();
    expect(text).toContain('%% mermantics-layout {"A":[12,34]}');
    expect(fromMermaid(text).positioned).toBe(false);
  },
);

test("export retains rounded positions at the coordinate limits", () => {
  const { boxes, arrows } = fromMermaid('flowchart TB\nA["A"]');
  boxes[0]!.position = { x: MAX_POSITION_COORDINATE - 0.1, y: -MAX_POSITION_COORDINATE + 0.1 };
  const text = toMermaid(boxes, arrows);
  expect(() => validateRecoveryDiagram(text)).not.toThrow();
  expect(fromMermaid(text).positioned).toBe(true);
  expect(fromMermaid(text).boxes[0]!.position).toEqual({ x: MAX_POSITION_COORDINATE, y: -MAX_POSITION_COORDINATE });
});

const files = import.meta.glob<string>(["../examples/*.mmd", "../patterns/*.mmd", "../options/**/*.mmd"],
  { eager: true, query: "?raw", import: "default" });
test.each(Object.entries(files))("bundled file and editor export remain recoverable: %s", (_name, text) => {
  expect(() => validateRecoveryDiagram(text)).not.toThrow();
  const { boxes, arrows, useCase, patternUses } = fromMermaid(text);
  expect(() => validateRecoveryDiagram(toMermaid(boxes, arrows, useCase, patternUses as unknown[]))).not.toThrow();
});

test.each(["", " \n", "flowchart TB\n", toMermaid([], [])])("intentionally empty diagrams remain recoverable (%j)", (text) => {
  expect(() => validateRecoveryDiagram(text)).not.toThrow();
});

test("exported workshop metadata and a pattern with deleted boxes remain recoverable", () => {
  const inserted = instantiate(BUILT_IN[0]!, { x: 0, y: 0 });
  inserted.use.id = "u1";
  const useCase = emptyUseCase();
  useCase.title = "Workshop";
  useCase.stories.push({ id: "s1", role: "engineer", want: "a result", benefit: "comparison", priority: "must" });
  useCase.questions.push({ id: "q1", text: "Why?", boxes: [] });
  useCase.openPoints.push({ id: "p1", text: "To discuss", done: false });
  expect(() => validateRecoveryDiagram(toMermaid([], [], useCase, [inserted.use]))).not.toThrow();
  const text = patternFromSelection(inserted.boxes, inserted.arrows, BUILT_IN[0]!);
  expect(() => validateRecoveryDiagram(text)).not.toThrow();
});

test("every declared verdict and empty computation view is supported", () => {
  const state = freshState();
  for (const verdict of VERDICTS) {
    state.options[0]!.verdict = verdict.id;
    for (const view of VIEWS) state.options[0]!.views[view.id] = "";
    expect(() => readRecovery(recoveryFile([{ area: "session", key: MODES.comp.storageKey, text: JSON.stringify(state) }]))).not.toThrow();
  }
});

test("Mermaid frontmatter uses the parser's supported boundary", () => {
  const text = '\n---\ntitle: My pattern\nconfig:\n  theme: neutral\n---\n' + BUILT_IN[0]!.text;
  expect(() => validateRecoveryDiagram(text)).not.toThrow();
  expect(() => validateRecoveryDiagram('---\ntitle: Unclosed\n' + BUILT_IN[0]!.text)).toThrow();
});
