// Semantic patterns: the built-in ones from PMDco, inserting them, saving a selection as a
// pattern, and checking that a diagram still follows the patterns it uses.

import { beforeAll, describe, expect, test } from "vitest";

import { fromMermaid, toMermaid, type Box } from "../src/canvas/model.js";
import { BUILT_IN, checkUses, instantiate, parsePattern, patternFromSelection, readMeta, readUses,
         type PatternUse } from "../src/canvas/patterns.js";
import { checks, defaultConfig, mermaid, type Ontology } from "../src/core/index.js";
import { PMDCO_ENABLED, PMDCO_FILE, loadOntology } from "./helpers.js";

/** Classes of a box as the canvas sees them, without an ontology: just the box's own class. */
const ownClass = (boxes: Box[]) => (id: string) => new Set([boxes.find((b) => b.id === id)?.data.classId ?? ""]);

test("the built-in patterns read cleanly and say what they are for", () => {
  expect(BUILT_IN.map((p) => p.id)).toEqual(["pmdco-process-inputs-outputs", "pmdco-process-chain", "pmdco-measurement",
                                              "pmdco-role-in-process", "pmdco-property-with-value",
                                              "pmdco-simulation-inputs-outputs", "pmdco-value-with-unit",
                                              "pmdco-chemical-composition",
                                              "pmdco-object-and-material", "pmdco-device-identifier"]);
  for (const p of BUILT_IN) {
    expect(mermaid.parse(p.text).findings, p.id).toEqual([]);
    expect(p.title && p.description && p.version && p.source.includes("PMDco"), p.id).toBeTruthy();
    expect(p.questions.length, p.id).toBeGreaterThan(0);
    expect(fromMermaid(p.text).boxes.every((b) => b.data.classId), p.id).toBe(true);
  }
});

test("inserting a pattern gives free box ids and remembers which box plays which part", () => {
  const p = BUILT_IN.find((x) => x.id === "pmdco-process-inputs-outputs")!;
  const taken = new Set(["Process", "Input"]);
  const ins = instantiate(p, taken, { x: 100, y: 50 }, "u1");
  const ids = ins.boxes.map((b) => b.id);
  expect(ids).not.toContain("Process");
  expect(ids).not.toContain("Input");
  expect(new Set(ids).size).toBe(ids.length);
  expect(ins.use.parts.find((x) => x.part === "Process")!.box).toBe("Process2");
  for (const a of ins.arrows) {
    expect(ids).toContain(a.source);
    expect(ids).toContain(a.target);
  }
  expect(ins.use.arrows).toHaveLength(ins.arrows.length);
  expect(checkUses([ins.use], ins.boxes, ins.arrows, ownClass(ins.boxes))).toEqual([]);
});

describe("checking a diagram against the patterns it uses", () => {
  const p = BUILT_IN.find((x) => x.id === "pmdco-process-inputs-outputs")!;
  const fresh = () => instantiate(p, new Set(), { x: 0, y: 0 }, "u1");

  test("a missing arrow", () => {
    const { boxes, arrows, use } = fresh();
    const without = arrows.filter((a) => a.data!.curie !== "OBI_0000299");
    const found = checkUses([use], boxes, without, ownClass(boxes));
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("'has specified output' (OBI_0000299) from 'Process' to 'Output' is missing");
    expect(found[0]!.box).toBe("Process");
  });

  test("a box that no longer has the part's class", () => {
    const { boxes, arrows, use } = fresh();
    const changed = boxes.map((b) => (b.id === "Input" ? { ...b, data: { ...b.data, classId: "IAO_0000027", classLabel: "data entity" } } : b));
    const found = checkUses([use], changed, arrows, ownClass(changed));
    expect(found.map((f) => f.box)).toEqual(["Input"]);
    expect(found[0]!.message).toContain("must be a BFO_0000030 or something more specific, but it is now 'data entity'");
  });

  test("a more specific class is fine", () => {
    const { boxes, arrows, use } = fresh();
    const classes = (id: string) => (id === "Input" ? new Set(["PMD_0020193", "BFO_0000030"]) : ownClass(boxes)(id));
    expect(checkUses([use], boxes, arrows, classes)).toEqual([]);
  });

  test("a deleted box", () => {
    const { boxes, arrows, use } = fresh();
    const found = checkUses([use], boxes.filter((b) => b.id !== "Plan"), arrows.filter((a) => a.source !== "Plan" && a.target !== "Plan"),
                            ownClass(boxes));
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("the box for 'Plan' was deleted");
  });
});

test("pattern uses are saved in the diagram file and read back", () => {
  const ins = instantiate(BUILT_IN[0]!, new Set(), { x: 0, y: 0 }, "u1");
  const text = toMermaid(ins.boxes, ins.arrows, undefined, [ins.use]);
  expect(readMeta(text)).toBeNull(); // a model that uses a pattern is not itself a pattern
  const back = fromMermaid(text);
  expect(readUses(back.patternUses)).toEqual([ins.use]);
  expect(readUses([{ id: "x" }, "junk", { id: "u2", parts: [{ part: "A", box: "B" }] }]))
    .toEqual([{ id: "u2", pattern: "", title: "", version: "", parts: [{ part: "A", name: "", classId: "", box: "B" }], arrows: [] }]);
});

test("saving selected boxes as a pattern", () => {
  const { boxes, arrows, useCase } = fromMermaid(BUILT_IN[0]!.text.replace("%% mermantics-pattern", "%% not a pattern"));
  void useCase;
  const picked = boxes.filter((b) => ["Process", "Input", "Output"].includes(b.id));
  const text = patternFromSelection(picked, arrows, {
    id: "my-io", title: "My inputs and outputs", description: "test", version: "1.0.0", source: "test",
    questions: ["What went in?"],
  });
  const p = parsePattern(text)!;
  expect(p).not.toBeNull();
  expect(p.title).toBe("My inputs and outputs");
  expect(p.questions).toEqual(["What went in?"]);
  const back = fromMermaid(p.text);
  expect(back.boxes.map((b) => b.id).sort()).toEqual(["Input", "Output", "Process"]);
  expect(back.arrows.map((a) => a.data!.curie).sort()).toEqual(["OBI_0000293", "OBI_0000299"]); // not the arrow to Plan
  expect(Math.min(...back.boxes.map((b) => b.position.x))).toBe(0);
});

describe.skipIf(!PMDCO_ENABLED)("built-in patterns on PMDco", () => {
  let onto: Ontology;
  beforeAll(() => {
    onto = loadOntology(PMDCO_FILE, "pmdco-full.ttl");
  });

  test.each(BUILT_IN.map((p) => [p.id, p.text]))("%s passes the fast checks", (_id, text) => {
    const result = checks.run(mermaid.parse(text), onto, defaultConfig(), null);
    expect(result.findings.filter((f) => f.level === "error" || f.level === "warning")).toEqual([]);
  });
});

export type { PatternUse };
