// The canvas editor's Mermaid import and export, and the relations offered when drawing
// an arrow.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, test } from "vitest";

import { fromMermaid, toMermaid } from "../src/canvas/model.js";
import { coverage, toMarkdown } from "../src/canvas/usecase.js";
import { checks, defaultConfig, labels, mermaid, relations, type Ontology } from "../src/core/index.js";
import { DEFAULT_PREFIXES } from "../src/core/model.js";
import { PMDCO_ENABLED, PMDCO_FILE, WEB, loadOntology } from "./helpers.js";

const example = (name: string) => readFileSync(join(WEB, "examples", name), "utf8");
const NAMES = ["process-example.mmd", "simulation-example.mmd", "broken-unknown-id.mmd",
               "broken-impossible-class.mmd", "broken-wrong-relation.mmd"];

/** What the checker sees in a diagram: boxes (label lines, styles) and arrows. */
function meaning(text: string) {
  const d = mermaid.parse(text);
  return {
    findings: d.findings.length,
    nodes: [...d.nodes.values()].map((n) => [n.id, labels.segments(n.label).filter((s) => s), [...n.css].sort()]),
    edges: d.edges.map((e) => [e.src, e.dst, e.kind, labels.segments(e.label).filter((s) => s)]),
  };
}

test.each(NAMES)("%s: import then export keeps what the checker sees", (name) => {
  const text = example(name);
  const imported = fromMermaid(text);
  expect(imported.warnings).toEqual([]);
  const again = toMermaid(imported.boxes, imported.arrows);
  expect(meaning(again)).toEqual(meaning(text));
});

test("box positions survive a round trip", () => {
  const imported = fromMermaid(example("process-example.mmd"));
  expect(imported.positioned).toBe(false);
  imported.boxes.forEach((b, i) => { b.position = { x: 10 * i, y: 7 * i }; });
  const back = fromMermaid(toMermaid(imported.boxes, imported.arrows));
  expect(back.positioned).toBe(true);
  expect(back.boxes.map((b) => b.position)).toEqual(imported.boxes.map((b) => b.position));
});

describe.skipIf(!PMDCO_ENABLED)("on PMDco", () => {
  let onto: Ontology;
  beforeAll(() => {
    onto = loadOntology(PMDCO_FILE, "pmdco-full.ttl");
  });

  test("the process example is clean", () => {
    const result = checks.run(mermaid.parse(example("process-example.mmd")), onto, defaultConfig(), null);
    expect(result.findings.filter((f) => f.level !== "ok")).toEqual([]);
  });

  test("relations offered from a process step to a material", () => {
    const fits = relations.fittingRelations(onto, DEFAULT_PREFIXES, ["COB_0000035"], ["PMD_0000000"],
                                            ["OBI_0000293", "OBI_0000299", "BFO_0000063", "RO_0000057"]);
    const ids = fits.map((f) => f.id);
    expect(ids).toContain("OBI_0000293"); // has specified input
    expect(ids).toContain("OBI_0000299"); // has specified output
    expect(ids).toContain("RO_0000057"); // has participant
    expect(ids).not.toContain("BFO_0000063"); // precedes: only between occurrents
  });

  test("a material cannot use something as input", () => {
    const fits = relations.fittingRelations(onto, DEFAULT_PREFIXES, ["PMD_0000000"], ["PMD_0000000"], ["OBI_0000293"]);
    expect(fits).toEqual([]);
  });

  test("all fitting relations between two process steps", () => {
    const fits = relations.fittingRelations(onto, DEFAULT_PREFIXES, ["PMD_0000779"], ["PMD_0000974"], null);
    const ids = fits.map((f) => f.id);
    expect(ids).toContain("BFO_0000063");
    expect(ids).not.toContain("RO_0000056"); // participates in: subject must be a continuant
  });
});

// ---- use case (workshop mode) ----------------------------------------------------------------

test("the use case notes survive a round trip", () => {
  const imported = fromMermaid(example("process-example.mmd"));
  expect(imported.useCase.title).toContain("heat treatment");
  expect(imported.useCase.stories).toHaveLength(2);
  expect(imported.useCase.questions.map((q) => q.boxes.length)).toEqual([3, 3, 0]);
  expect(imported.useCase.openPoints).toHaveLength(1);
  const back = fromMermaid(toMermaid(imported.boxes, imported.arrows, imported.useCase));
  expect(back.useCase).toEqual(imported.useCase);
  expect(back.warnings).toEqual([]);
});

test("a diagram without use case notes gets none written", () => {
  const imported = fromMermaid(example("simulation-example.mmd"));
  expect(toMermaid(imported.boxes, imported.arrows, imported.useCase)).not.toContain("mermantics-usecase");
});

test("links to deleted boxes are dropped when saving", () => {
  const imported = fromMermaid(example("process-example.mmd"));
  const boxes = imported.boxes.filter((b) => b.id !== "Furnace");
  const back = fromMermaid(toMermaid(boxes, imported.arrows.filter((a) => a.target !== "Furnace"), imported.useCase));
  expect(back.useCase.questions[0]!.boxes).toEqual(["HeatTreatment", "TestPiece"]);
});

test("unreadable or partial use case notes do not break the diagram", () => {
  const broken = fromMermaid("flowchart TB\n    A[\"<b>A</b>\"]\n%% mermantics-usecase {not json\n");
  expect(broken.boxes).toHaveLength(1);
  expect(broken.useCase.questions).toEqual([]);
  expect(broken.warnings).toContain("the use case notes in this file could not be read");
  const partial = fromMermaid('flowchart TB\n%% mermantics-usecase {"questions":[{"text":"why?","boxes":["A",3]}],"stories":"x"}\n');
  expect(partial.useCase.questions).toEqual([{ id: "q1", text: "why?", boxes: ["A"] }]);
  expect(partial.useCase.stories).toEqual([]);
});

test("coverage and the Markdown export", () => {
  const { boxes, arrows, useCase } = fromMermaid(example("process-example.mmd"));
  const cov = coverage(useCase, boxes);
  expect(cov.linked).toBe(2);
  expect(cov.unlinked).toEqual(["q3"]);
  expect(cov.unusedBoxes.sort()).toEqual(["Curve", "TensileTest", "TestingMachine"]);
  const md = toMarkdown(useCase, boxes, toMermaid(boxes, arrows, useCase), "No problems found");
  expect(md).toContain("| 1 | materials engineer | to trace which heat treatment a test piece received |");
  expect(md).toContain("   - Furnace (heat treatment device, PMD_0000780)");
  expect(md).toContain("   - not linked to the data model yet");
  expect(md).toContain("- [ ] Do we record the furnace temperature");
  expect(md).toContain("2 of 3 competency questions are linked to the model.");
  expect(md).toContain("```mermaid\nflowchart TB");
});
