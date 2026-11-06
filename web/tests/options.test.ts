// The PMD Hackathon - Computations section: the built-in design options, the stored state,
// the tree of terms and the Markdown export.

import { beforeAll, describe, expect, test } from "vitest";

import { fromMermaid, toMermaid, emptyUseCase } from "../src/canvas/model.js";
import { BUILT_IN_VERSION, builtInOptions, freshState, readState, resultsMarkdown, VIEWS } from "../src/canvas/options.js";
import { countStatuses, mergeTree, type ClassTree } from "../src/canvas/termsTree.js";
import { checks, defaultConfig, labels, mermaid, type Ontology } from "../src/core/index.js";
import { DataFactory } from "n3";
import { PMDCO_ENABLED, PMDCO_FILE, loadOntology } from "./helpers.js";

const ALL = builtInOptions().flatMap((o) => VIEWS.map((v) => [`${o.letter} ${v.id}`, o.views[v.id]] as const));

function meaning(text: string) {
  const d = mermaid.parse(text);
  return {
    findings: d.findings.length,
    nodes: [...d.nodes.values()].map((n) => [n.id, labels.segments(n.label).filter((s) => s), [...n.css].sort()]),
    edges: d.edges.map((e) => [e.src, e.dst, e.kind, labels.segments(e.label).filter((s) => s)]),
  };
}

test("six built-in options, A to F, each with three views", () => {
  const options = builtInOptions();
  expect(options.map((o) => o.letter)).toEqual(["A", "B", "C", "D", "E", "F"]);
  for (const o of options) for (const v of VIEWS) expect(fromMermaid(o.views[v.id]).boxes.length, `${o.letter} ${v.id}`).toBeGreaterThan(3);
});

test.each(ALL)("%s: reads without warnings and keeps what the checker sees", (_name, text) => {
  const imported = fromMermaid(text);
  expect(imported.warnings).toEqual([]);
  // every box has a stored kind, so none is guessed
  expect(imported.boxes.filter((b) => b.data.kind === "other" && b.data.classId !== "PMD_0000051")).toEqual([]);
  expect(meaning(toMermaid(imported.boxes, imported.arrows))).toEqual(meaning(text));
});

describe.skipIf(!PMDCO_ENABLED)("built-in options on PMDco", () => {
  let onto: Ontology;
  beforeAll(() => {
    onto = loadOntology(PMDCO_FILE, "pmdco-full.ttl");
  });

  test.each(ALL)("%s passes the fast checks", (_name, text) => {
    const result = checks.run(mermaid.parse(text), onto, defaultConfig(), null);
    expect(result.findings.filter((f) => f.level === "error" || f.level === "warning")).toEqual([]);
  });

  test("subclasses: named and through an intersection", () => {
    const iri = (id: string) => DataFactory.namedNode(`https://w3id.org/pmd/co/${id}`);
    const under = onto.subclasses(iri("PMD_0000583")).map((t) => t.value.split("/").pop()).sort();
    // simulation process and analytical calculation are named; workflow run and node are
    // "computing process and ...".
    expect(under).toEqual(expect.arrayContaining(["PMD_0000933", "PMD_0025012", "PMD_0000016", "PMD_0000011"]));
  });
});

// ---- the tree of terms ----------------------------------------------------------------------

const PMDCO: ClassTree[] = [{
  id: "PMD_0000583", label: "computing process", deprecated: false, children: [
    { id: "PMD_0000933", label: "simulation process", deprecated: false, children: [
      { id: "PMD_0000956", label: "structural optimization simulation", deprecated: false, children: [] },
      { id: "PMD_0000594", label: "deep learning", deprecated: false, children: [] },
    ] },
  ],
}];

const TERMS = `flowchart TB
    Sim["<b>simulation process</b><br>PMD_0000933 simulation process"]:::local
    Geo["<b>geometry optimization</b><br>PMD_0000956 structural optimization simulation"]:::changed
    New["<b>multi-model simulation</b><br>PMD_0000933 simulation process"]:::proposed
    Task["<b>equilibrium task</b><br>IAO_0000005 objective specification"]:::proposed
    ML["<b>machine learning model training</b><br>PMD_0000933 simulation process"]:::proposed
    DL["<b>deep learning</b><br>PMD_0000594 deep learning"]:::changed
    Old["<b>physical simulation</b><br>PMD_0000884 physical simulation"]:::deprecated
    Sim --> New
    ML --> DL
`;

test("the tree places new terms, moves and relabels changed ones", () => {
  const d = fromMermaid(TERMS);
  const tree = mergeTree(PMDCO, d.boxes, d.arrows, (id) => ({ IAO_0000005: "objective specification",
                                                               PMD_0000884: "physical simulation" })[id] ?? id);
  const find = (label: string) => {
    const stack = [...tree];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.label === label) return n;
      stack.push(...n.children);
    }
    return null;
  };
  const sim = find("simulation process")!;
  expect(sim.children.map((c) => c.label)).toEqual(["geometry optimization", "machine learning model training", "multi-model simulation"]);
  expect(find("geometry optimization")!.was).toBe("structural optimization simulation");
  // deep learning moved from simulation process to the new class
  expect(find("machine learning model training")!.children.map((c) => c.label)).toEqual(["deep learning"]);
  expect(find("deep learning")!.moved).toBe(true);
  // a new term under a class outside the PMDco trees gets that class as its own root
  const outside = tree.find((n) => n.id === "IAO_0000005")!;
  expect(outside.status).toBe("outside");
  expect(outside.children.map((c) => c.label)).toEqual(["equilibrium task"]);
  expect(find("physical simulation")!.status).toBe("deprecated");
  expect(countStatuses(tree)).toMatchObject({ proposed: 3, changed: 2, deprecated: 1 });
});

test("the tree never loops, even when the diagram does", () => {
  const d = fromMermaid(`flowchart TB
    A["<b>a</b><br>PMD_0000933 simulation process"]:::proposed
    B["<b>b</b><br>PMD_0000933 simulation process"]:::proposed
    A --> B
    B --> A
`);
  const tree = mergeTree(PMDCO, d.boxes, d.arrows, (id) => id);
  expect(JSON.stringify(tree.map((n) => n.label))).toBeTruthy();
});

// ---- stored state -------------------------------------------------------------------------

test("stored state: notes are kept; built-in diagrams only for the same version; own options kept", () => {
  const s = freshState();
  const e = s.options.find((o) => o.letter === "E")!;
  e.verdict = "preferred";
  e.why = "It works for FEM too.";
  e.views.dft = "flowchart TB\n    X[\"x\"]\n";
  s.options.push({ ...e, id: "option-g", letter: "G", title: "Mine", builtIn: false });
  s.current = { option: "option-g", view: "fem" };

  const same = readState(JSON.stringify(s));
  expect(same.options.find((o) => o.letter === "E")!.views.dft).toContain("X[");
  expect(same.options.find((o) => o.letter === "E")!.verdict).toBe("preferred");
  expect(same.options.map((o) => o.letter)).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
  expect(same.current).toEqual({ option: "option-g", view: "fem" });

  const older = readState(JSON.stringify({ ...s, version: BUILT_IN_VERSION - 1 }));
  expect(older.options.find((o) => o.letter === "E")!.views.dft).not.toContain("X[");
  expect(older.options.find((o) => o.letter === "E")!.why).toBe("It works for FEM too.");
  expect(older.options.find((o) => o.letter === "G")!.views.dft).toContain("X[");
});

test("stored state: unreadable storage gives the built-in options", () => {
  expect(readState("not json").options).toHaveLength(6);
  expect(readState(null).current).toEqual({ option: "e-task-model-solver", view: "dft" });
  expect(readState(JSON.stringify({ current: { option: "gone", view: "dft" } })).current.option).toBe("e-task-model-solver");
});

// ---- export -------------------------------------------------------------------------------

test("results: use case, a verdict table and every option with its diagrams", () => {
  const options = builtInOptions();
  options[4]!.verdict = "preferred";
  options[4]!.why = "Same pattern | for both";
  const useCase = { ...emptyUseCase(), title: "Computations", openPoints: [{ id: "p1", text: "Ask about QM/MM", done: false }] };
  const md = resultsMarkdown(useCase, options, { [options[4]!.id]: { dft: "no problems" } });
  expect(md).toMatch(/^# PMD Hackathon - Computations: Computations/);
  expect(md).toContain("- [ ] Ask about QM/MM");
  expect(md).not.toContain("## Data model");
  expect(md).toContain("| E | Task, model and solver as parts | Preferred | Same pattern \\| for both |");
  expect(md).toContain("### A. PMDco 3.1.2 today");
  expect(md).toContain("Quick check against PMDco 3.1.2 (no reasoner): no problems.");
  expect(md.match(/```mermaid/g)).toHaveLength(18);
});
