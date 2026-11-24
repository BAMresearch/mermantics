import { expect, test } from "vitest";
import { validateRecoveryDiagram } from "../src/canvas/recoveryDiagram.js";
import { emptyUseCase, fromMermaid, toMermaid } from "../src/canvas/model.js";
import { BUILT_IN, instantiate, patternFromSelection } from "../src/canvas/patterns.js";
import { freshState, VIEWS, VERDICTS } from "../src/canvas/options.js";
import { MODES } from "../src/canvas/mode.js";
import { readRecovery, recoveryFile } from "../src/canvas/recovery.js";

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
