// Parser tests, ported from tests/test_mermaid.py.

import { describe, expect, test } from "vitest";

import { mermaid } from "../src/core/index.js";
import { fixture } from "./helpers.js";

const parse = mermaid.parse;

test("frontmatter, header, comments and styles are skipped", () => {
  const d = parse(
    "---\nconfig:\n  flowchart:\n    nodeSpacing: 50\n---\n" +
    'flowchart TB\n%% a comment\nA["x"]\nclassDef base fill:#fff\nstyle A fill:#000\n' +
    "linkStyle 0 stroke:#f00\nclick A callback\nsubgraph S\nend\ndirection LR\n",
  );
  expect([...d.nodes.keys()]).toEqual(["A"]);
  expect(d.findings).toEqual([]);
});

describe("node shapes", () => {
  test.each([
    ['A["quoted <b>label</b>"]', "quoted <b>label</b>"],
    ["A[plain label]", "plain label"],
    ['A("round")', "round"],
    ['A{"rhombus"}', "rhombus"],
    ['A[["subroutine"]]', "subroutine"],
    ['A(["stadium"])', "stadium"],
    ['A(("circle"))', "circle"],
    ['A{{"hexagon"}}', "hexagon"],
    ['A[("database")]', "database"],
    ['A>"flag"]', "flag"],
    ['A["with ] bracket inside"]', "with ] bracket inside"],
  ])("%s", (line, label) => {
    const d = parse(`flowchart TB\n${line}\n`);
    expect(d.nodes.get("A")!.label).toBe(label);
    expect(d.findings).toEqual([]);
  });
});

test("node style class inline and class statement", () => {
  const d = parse('flowchart TB\nA["a"]:::local\nB["b"]\nC["c"]\nclass B,C vocab\n');
  expect(d.nodes.get("A")!.css).toEqual(new Set(["local"]));
  expect(d.nodes.get("B")!.css).toEqual(new Set(["vocab"]));
  expect(d.nodes.get("C")!.css).toEqual(new Set(["vocab"]));
});

describe("arrows", () => {
  test.each([
    ["A --> B", "inherit", ""],
    ["A ---> B", "inherit", ""],
    ["A -->|has part BFO_0000051| B", "relation", "has part BFO_0000051"],
    ['A -- "has part<br>BFO_0000051" --> B', "relation", "has part<br>BFO_0000051"],
    ["A -- has part --> B", "relation", "has part"],
    ["A -.-> B", "relation", ""],
    ['A -. "has part<br>BFO_0000051" .-> B', "relation", "has part<br>BFO_0000051"],
    ["A -. has part .-> B", "relation", "has part"],
    ["A -.->|has part| B", "relation", "has part"],
    ["A ==> B", "relation", ""],
    ['A == "x" ==> B', "relation", "x"],
    ["A:::cls --> B", "inherit", ""],
  ])("%s", (line, kind, label) => {
    const d = parse(`flowchart TB\nA["a"]\nB["b"]\n${line}\n`);
    expect(d.edges).toHaveLength(1);
    const e = d.edges[0]!;
    expect([e.src, e.dst, e.kind, e.label]).toEqual(["A", "B", kind, label]);
    expect(d.findings).toEqual([]);
  });
});

test("undirected arrow is reported", () => {
  const d = parse('flowchart TB\nA["a"]\nB["b"]\nA --- B\n');
  expect(d.edges).toEqual([]);
  expect(d.findings.some((f) => f.message.includes("without a direction"))).toBe(true);
});

test("unknown line is reported with line number", () => {
  const d = parse('flowchart TB\nA["a"]\nthis is not mermaid ???\n');
  expect(d.findings).toHaveLength(1);
  expect(d.findings[0]!.where).toBe("line 3");
  expect(d.findings[0]!.line).toBe(3);
});

test("node only in arrow is created and reported", () => {
  const d = parse('flowchart TB\nA["a"]\nA --> B\n');
  expect(d.nodes.has("B") && !d.nodes.get("B")!.defined).toBe(true);
  expect(d.findings.some((f) => f.message.includes("only appears in an arrow"))).toBe(true);
});

test("duplicate node is reported", () => {
  const d = parse('flowchart TB\nA["a"]\nA["b"]\n');
  expect(d.nodes.get("A")!.label).toBe("b");
  expect(d.findings.some((f) => f.message.includes("defined twice"))).toBe(true);
});

test("example diagram parses cleanly", () => {
  const d = parse(fixture("simulation-data-model.mmd"));
  expect(d.nodes.size).toBe(25);
  expect(d.edges).toHaveLength(37);
  expect(d.edges.filter((e) => e.kind === "inherit")).toHaveLength(22);
  expect(d.findings).toEqual([]);
  expect(d.nodes.get("CalcType")!.css).toEqual(new Set(["vocab"]));
  expect(d.nodes.get("Note")!.css).toEqual(new Set(["note"]));
});

test("style class on arrow ends", () => {
  const d = parse('flowchart TB\nA["a"]\nB["b"]\nA:::local --> B:::vocab\n');
  expect(d.nodes.get("A")!.css).toEqual(new Set(["local"]));
  expect(d.nodes.get("B")!.css).toEqual(new Set(["vocab"]));
  expect(d.edges[0]!.kind).toBe("inherit");
});

// Hand-written expectations shared with Python; not generated golden output.
const statements: {
  message: string;
  unsupported: string[];
  chains: string[];
  nodes: { line: string; label: string; css: string[] }[];
  edges: { line: string; label: string }[];
} = JSON.parse(fixture("mermaid-statements.json"));

test.each(statements.unsupported)("unsupported compound statement: %s", (line) => {
  const d = parse(`flowchart TB\nKeep["keep"]\n${line}\nAfter["after"]\n`);
  expect([...d.nodes.keys()]).toEqual(["Keep", "After"]);
  expect(d.edges).toEqual([]);
  expect(d.findings).toHaveLength(1);
  expect(d.findings[0]).toMatchObject({
    level: "warning", check: "parse", message: statements.message,
    where: "line 3", details: line, line: 3,
  });
  expect(mermaid.matchNode(line)).toBeNull();
  expect(mermaid.matchEdge(line)).toBeNull();
});

test.each(statements.nodes)("statement node compatibility: $line", ({ line, label, css }) => {
  const d = parse(line);
  expect([...d.nodes.keys()]).toEqual(["A"]);
  expect(d.nodes.get("A")!.label).toBe(label);
  expect(d.nodes.get("A")!.css).toEqual(new Set(css));
  expect(d.edges).toEqual([]);
  expect(d.findings).toEqual([]);
});

test.each(statements.edges)("statement edge compatibility: $line", ({ line, label }) => {
  const d = parse(`A["a"]\nB["b"]\n${line}`);
  expect(d.edges).toHaveLength(1);
  expect(d.edges[0]).toMatchObject({ src: "A", dst: "B", kind: "relation", label });
  expect(d.findings).toEqual([]);
});


test.each(statements.chains)("mixed chain with declared nodes: %s", (line) => {
  const d = parse(`flowchart TB\nA["a"]\nB["b"]\nC["c"]\nD["d"]\n${line}`);
  expect([...d.nodes.values()].map((n) => [n.id, n.label])).toEqual([["A", "a"], ["B", "b"], ["C", "c"], ["D", "d"]]);
  expect(d.edges).toEqual([]);
  expect(d.findings).toHaveLength(1);
  expect(d.findings[0]).toMatchObject({
    check: "parse", message: statements.message, where: "line 6", details: line, line: 6,
  });
  expect(mermaid.matchEdge(line)).toBeNull();
});
