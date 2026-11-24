// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { publishOntology, resetOntology } from "./helpers/ontology-state.js";
import type { SearchResult, Term } from "../src/core/terms.js";

const mocks = vi.hoisted(() => ({ search: vi.fn(), trees: vi.fn(), lookup: vi.fn(), relations: vi.fn() }));
vi.mock("../src/canvas/checker.js", async () => ({ ...await import("./helpers/ontology-state.js"), ...mocks, check: vi.fn() }));
import { TermSearch } from "../src/canvas/TermSearch.js";
import { TermsTree } from "../src/canvas/OptionsPanel.js";
import { RelationMenu } from "../src/canvas/RelationMenu.js";
import { fromMermaid } from "../src/canvas/model.js";
import { BoxDetails, Overview } from "../src/canvas/Details.js";
import { readState } from "../src/canvas/options.js";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  resetOntology();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.lookup.mockResolvedValue([]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.useRealTimers(); vi.unstubAllGlobals();
});
const click = async (text: string) => act(async () => {
  [...host.querySelectorAll("button")].find((b) => b.textContent === text)!.click();
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const type = async (value: string) => act(async () => {
  const input = host.querySelector("input")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const result = (label: string): SearchResult => ({ total: 1, terms: [{ label, id: label, iri: label,
  kind: "class", labels: [label], definition: "", deprecated: false }] });

test("search clears previous hits while waiting, reports failures and retries the current query", async () => {
  const pick = vi.fn<(term: Term) => void>();
  mocks.search.mockResolvedValueOnce(result("Material")).mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(result("Process"));
  await act(async () => root.render(createElement(TermSearch, { onPick: pick, placeholder: "Find" })));
  await type("Material");
  await act(async () => vi.advanceTimersByTime(151));
  expect(host.querySelector(".term-label")!.textContent).toBe("Material");
  await type("Process");
  expect(host.querySelector(".term-hits")).toBeNull();
  expect(host.textContent).toContain("Searching...");
  await act(async () => vi.advanceTimersByTime(151));
  expect(host.textContent).toContain("Search failed: offline");
  expect(host.querySelector(".term-hits")).toBeNull();
  await click("Retry search");
  await act(async () => vi.advanceTimersByTime(151));
  expect(host.querySelector(".term-label")!.textContent).toBe("Process");
  await act(async () => host.querySelector<HTMLButtonElement>(".term-hits button")!.click());
  expect(pick.mock.calls[0]![0].label).toBe("Process");
});

test("late search results cannot replace the current query", async () => {
  const old = deferred<SearchResult>();
  mocks.search.mockReturnValueOnce(old.promise).mockResolvedValueOnce(result("Process"));
  await act(async () => root.render(createElement(TermSearch, { onPick: vi.fn(), placeholder: "Find" })));
  await type("Material");
  await act(async () => vi.advanceTimersByTime(151));
  await type("Process");
  await act(async () => vi.advanceTimersByTime(151));
  await act(async () => old.resolve(result("Material")));
  expect(host.querySelector(".term-label")!.textContent).toBe("Process");
});

test("tree rejection is not cached and retry can render recovered trees", async () => {
  mocks.trees.mockRejectedValueOnce(new Error("worker failed"))
    .mockResolvedValueOnce([{ id: "TST_1", label: "Recovered tree", deprecated: false, children: [] }]);
  await act(async () => root.render(createElement(TermsTree, { option: readState(null).options[0]!, termsText: "flowchart TB" })));
  expect(host.textContent).toContain("Could not load the PMDco tree: worker failed");
  expect(host.querySelector(".tt-list")).toBeNull();
  await click("Retry tree");
  expect(mocks.trees).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("Recovered tree");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

const relationProps = { x: 0, y: 0, srcName: "A", dstName: "B", srcClasses: ["A"], dstClasses: ["B"],
  toVocab: false, own: [], onChoose: vi.fn(), onRemember: vi.fn(), onCancel: vi.fn() };

test("failed common relations show uncertainty, and only a successful empty response reports no fit", async () => {
  mocks.relations.mockRejectedValueOnce(new Error("worker failed")).mockResolvedValueOnce([]);
  await act(async () => root.render(createElement(RelationMenu, relationProps)));
  expect(host.textContent).toContain("Could not find common relations: worker failed");
  expect(host.textContent).not.toContain("None of the common relations fit");
  await click("Retry common relations");
  expect(host.textContent).toContain("None of the common relations fit");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

for (const mode of ["Other relation from the ontology...", "Make your own relation..."]) {
  test(`${mode} allows retry after an all-relations failure`, async () => {
    mocks.relations.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([{ id: "TST_1", label: "Recovered relation", constrained: false, fit: "yes" }]);
    await act(async () => root.render(createElement(RelationMenu, relationProps)));
    await click(mode);
    expect(host.textContent).toContain("Could not find relations: offline");
    await click("Retry relations");
    expect(host.textContent).toContain("Recovered relation");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
}

test("relation replies for previous boxes cannot overwrite new results", async () => {
  const old = deferred<[]>();
  mocks.relations.mockReturnValueOnce(old.promise).mockResolvedValueOnce([]);
  await act(async () => root.render(createElement(RelationMenu, relationProps)));
  await act(async () => root.render(createElement(RelationMenu, { ...relationProps, srcClasses: ["C"] })));
  await act(async () => old.reject(new Error("stale failure")));
  expect(host.textContent).not.toContain("stale failure");
  expect(host.textContent).toContain("None of the common relations fit");
});

test("unknown pattern validity is not rendered as following the pattern", async () => {
  await act(async () => root.render(createElement(Overview, { status: "The check failed", ontology: true,
    findings: [], passed: [], onSelect: vi.fn(), uses: [{ id: "p", title: "Pattern", version: "", boxes: 1, problems: null }] })));
  expect(host.textContent).toContain("not checked");
  expect(host.textContent).not.toContain("follows it");
  expect(host.querySelector(".pill.ok")).toBeNull();
});


for (const recovery of ["retry", "worker recovery"]) {
  test(`term details recover through ${recovery} without changing selection`, async () => {
    mocks.lookup.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([
      { ...result("Recovered term").terms[0]!, definition: "Recovered definition" },
    ]);
    const box = fromMermaid('flowchart TB\nA["Box<br/>TST_0000001"]').boxes[0]!;
    await act(async () => root.render(createElement(BoxDetails, { box, shapes: [], ontology: true,
      onChange: vi.fn(), onDelete: vi.fn() })));
    expect(host.textContent).toContain("Could not load term details: offline");
    if (recovery === "retry") await click("Retry details");
    else await act(async () => publishOntology({ status: "ready", revision: 1, title: "Recovered" }));
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("Recovered definition");
    expect(host.textContent).not.toContain("Could not load term details");
  });

  test(`tree class labels recover through ${recovery} without remounting`, async () => {
    mocks.trees.mockResolvedValue([]);
    mocks.lookup.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([result("Recovered label").terms[0]]);
    await act(async () => root.render(createElement(TermsTree, { option: readState(null).options[0]!,
      termsText: 'flowchart TB\nA["Custom<br/>TST_0000001"]' })));
    expect(host.textContent).toContain("Could not load class labels: offline");
    if (recovery === "retry") await click("Retry labels");
    else await act(async () => publishOntology({ status: "ready", revision: 1, title: "Recovered" }));
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain("Could not load class labels");
  });
}

test("unlinked custom relations remain selectable while loading and after failure", async () => {
  const pending = deferred<[]>();
  mocks.relations.mockReturnValueOnce(pending.promise);
  const choose = vi.fn();
  await act(async () => root.render(createElement(RelationMenu, { ...relationProps, onChoose: choose,
    own: [{ words: "custom unlinked", curie: "", name: "custom unlinked" },
      { words: "custom linked", curie: "TST_1", name: "linked" }] })));
  expect(host.textContent).toContain("custom unlinked");
  expect(host.textContent).not.toContain("custom linked");
  await act(async () => pending.reject(new Error("offline")));
  expect(host.textContent).toContain("custom unlinked");
  expect(host.textContent).not.toContain("custom linked");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")]
    .find((b) => b.textContent?.startsWith("custom unlinked"))!.click());
  expect(choose).toHaveBeenCalledWith(expect.objectContaining({ words: "custom unlinked", curie: "", own: true }));
});

test("details label retained markers as previous findings while rechecking", async () => {
  const box = fromMermaid('flowchart TB\nA["Box"]').boxes[0]!;
  box.data.problems = [{ level: "error", message: "Earlier finding", details: "" }];
  const props = { box, shapes: [], ontology: true, onChange: vi.fn(), onDelete: vi.fn() };
  await act(async () => root.render(createElement(BoxDetails, { ...props, validationStale: true })));
  expect(host.textContent).toContain("Previous findings");
  expect(host.textContent).toContain("not been confirmed for the current diagram");
  expect(host.textContent).toContain("Earlier finding");
  await act(async () => root.render(createElement(BoxDetails, { ...props, validationStale: false })));
  expect(host.textContent).toContain("Problems");
  expect(host.textContent).not.toContain("Previous findings");
});

test.each(["failed", "loading"] as const)("Overview uses %s state rather than parsing availability wording", async (ontologyState) => {
  await act(async () => root.render(createElement(Overview, { status: "Validation pending", ontology: true,
    ontologyState, checkedAgainst: "Custom availability message", findings: [], passed: [], onSelect: vi.fn() })));
  expect(host.textContent).toContain("Custom availability message");
});

test("Overview treats a ready ontology as ready regardless of its title", async () => {
  await act(async () => root.render(createElement(Overview, { status: "Checked", ontology: true,
    ontologyState: "ready", checkedAgainst: "Checker unavailable is an unusual ontology title",
    findings: [], passed: [], onSelect: vi.fn() })));
  expect(host.textContent).not.toContain("Checker unavailable is an unusual ontology title");
  expect(host.querySelector(".muted-inline")!.textContent).not.toBe("");
});

test.each(["failed", "loading"] as const)("Overview displays identical %s messages only once", async (ontologyState) => {
  const message = ontologyState === "failed" ? "Checker unavailable: offline" : "Loading PMDco 3.1.2...";
  await act(async () => root.render(createElement(Overview, { status: message, ontology: true,
    ontologyState, checkedAgainst: message, findings: [], passed: [], onSelect: vi.fn() })));
  expect(host.textContent!.split(message)).toHaveLength(2);
  expect(host.querySelector(".muted-inline")).toBeNull();
});

test("search changes and unmount cancel their obsolete requests", async () => {
  mocks.search.mockImplementation(() => new Promise(() => {}));
  await act(async () => root.render(createElement(TermSearch, { onPick: vi.fn(), placeholder: "Find" })));
  await type("Material");
  await act(async () => vi.advanceTimersByTime(151));
  const old = mocks.search.mock.lastCall![3] as AbortSignal;
  expect(old.aborted).toBe(false);
  await type("Process");
  expect(old.aborted).toBe(true);
  await act(async () => vi.advanceTimersByTime(151));
  const current = mocks.search.mock.lastCall![3] as AbortSignal;
  expect(current.aborted).toBe(false);
  await act(async () => root.render(null));
  expect(current.aborted).toBe(true);
});
