// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DatastoreBoxSection, DatastoreLinkMenu, DatastoreArrowSection } from "../src/canvas/DatastorePanel.js";
import { datastoreLinkOrder, fixedBamProject, openbisFor, projectCodeWarning, IS_CHILD_OF, IS_PARENT_OF, IS_ATTACHED_TO, type ShapeKind } from "../src/canvas/palette.js";
import { fromMermaid } from "../src/canvas/model.js";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const data = fromMermaid('flowchart TB\nA["A"]').boxes[0]!.data;
function panel(kind: ShapeKind, patch = {}) {
  const onChange = vi.fn();
  act(() => root.render(createElement(DatastoreBoxSection, { data: { ...data, kind, openbis: { ...openbisFor(kind), ...patch } }, boxes: [], onChange })));
  return onChange;
}

test.each(["Equipment", "Materials", "Methods", "Publications"])("BAM %s projects are automatic and read-only", (space) => {
  const change = panel("instrument");
  const select = host.querySelectorAll("select")[1]!;
  act(() => { select.value = `Bam ${space}`; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(change.mock.lastCall![0].openbis.project).toBe(`FB ${space} Open`);
  panel("instrument", change.mock.lastCall![0].openbis);
  expect(host.querySelector<HTMLInputElement>('input[list="ds-project"]')!.readOnly).toBe(true);
  expect(host.textContent).toContain("division’s fixed project");
  expect(host.textContent).not.toContain("openBIS project codes");
});

test.each([
  [0, "FB-Inventory"], [1, "Bam Global"], [0, "Lab Notebook"],
] as const)("leaving a fixed BAM place via select %s → %s clears its project", (index, destination) => {
  const change = panel("instrument");
  const select = host.querySelectorAll("select")[index]!;
  act(() => { select.value = destination; select.dispatchEvent(new Event("change", { bubbles: true })); });
  const next = change.mock.lastCall![0].openbis;
  expect(next.project).toBe("");
  panel("instrument", next);
  const project = host.querySelector<HTMLInputElement>('input[list="ds-project"]')!;
  expect(project.value).toBe("");
  expect(project.readOnly).toBe(false);
  expect(host.textContent).not.toContain("openBIS project codes");
});

test("moving between free places preserves a group-chosen project", () => {
  const change = panel("chemical", { project: "CHEMICALS_SYNTHESIS" });
  const select = host.querySelectorAll("select")[0]!;
  act(() => { select.value = "Lab Notebook"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(change.mock.lastCall![0].openbis.project).toBe("CHEMICALS_SYNTHESIS");
});

test("Bam Global and FB Inventory projects remain editable", () => {
  for (const area of ["BAM-Inventory", "FB-Inventory"]) {
    panel("object", { area, space: area === "BAM-Inventory" ? "Bam Global" : "FB Materials" });
    expect(host.querySelector<HTMLInputElement>('input[list="ds-project"]')!.readOnly).toBe(false);
    expect(fixedBamProject(area, "Bam Global")).toBeUndefined();
  }
});

test.each(["AB", "A".repeat(31), "lowercase", "HAS SPACE", "BAD/CODE", "ÄBC"])("invalid project %s warns without blocking edits", (project) => {
  const change = panel("step", { project });
  expect(host.textContent).toContain("openBIS project codes");
  const input = host.querySelector<HTMLInputElement>('input[list="ds-project"]')!;
  expect(input.readOnly).toBe(false);
  expect(input.value).toBe(project);
  expect(change).not.toHaveBeenCalled();
});

test.each(["", "ABC", "A".repeat(30), "MATERIAL_SYNTHESIS", "A-B.C_123"])("valid or undecided code %s does not warn", (project) => {
  expect(projectCodeWarning({ ...openbisFor("step"), project })).toBe("");
});

test("placeholders distinguish the Notebook and Inventory", () => {
  panel("step");
  expect(host.querySelector<HTMLInputElement>('input[list="ds-project"]')!.placeholder).toBe("e.g. MATERIAL_SYNTHESIS");
  expect(host.querySelector<HTMLInputElement>('input[list="ds-collection"]')!.placeholder).toBe("e.g. Synthesis");
  panel("chemical");
  expect(host.querySelector<HTMLInputElement>('input[list="ds-project"]')!.placeholder).toBe("e.g. CHEMICALS_SYNTHESIS");
});

test.each([
  ["step", "instrument", IS_CHILD_OF], ["step", "chemical", IS_CHILD_OF],
  ["instrument", "step", IS_PARENT_OF], ["chemical", "step", IS_PARENT_OF],
  ["step", "sample", IS_PARENT_OF], ["sample", "step", IS_PARENT_OF],
  ["step", "step", IS_PARENT_OF], ["sample", "sample", IS_PARENT_OF],
] as const)("link menu for %s → %s orders and focuses the likely parent", (source, target, first) => {
  const choose = vi.fn();
  act(() => root.render(createElement(DatastoreLinkMenu, { x: 0, y: 0, srcName: "Source", dstName: "Target", choices: datastoreLinkOrder(source, target), onChoose: choose, onCancel: vi.fn() })));
  const buttons = host.querySelectorAll("button");
  expect(buttons[0]!.textContent).toContain(`Source ${first} Target`);
  expect(buttons[0]!.textContent).toContain(`${first === IS_PARENT_OF ? "Source" : "Target"} is the parent`);
  expect(document.activeElement).toBe(buttons[0]);
  expect(buttons[1]!.textContent).toContain(first === IS_PARENT_OF ? IS_CHILD_OF : IS_PARENT_OF);
  act(() => buttons[0]!.click()); expect(choose).toHaveBeenCalledWith(first);
});

test("recommended dataset types are offered before typing", () => {
  const change = panel("dataset");
  expect([...host.querySelectorAll(".term-label")].map((e) => e.textContent)).toEqual(["RAW_DATA", "ATTACHMENT", "ELN_PREVIEW"]);
  expect(host.textContent!.match(/recommended by the Data Store/g)).toHaveLength(3);
  act(() => host.querySelector<HTMLButtonElement>(".term-hits button")!.click());
  expect(change.mock.lastCall![0].openbis.type).toBe("RAW_DATA");
});

test.each(["sample", "instrument", "step"] as const)("dataset attachment to %s has appropriate guidance", (dstKind) => {
  act(() => root.render(createElement(DatastoreArrowSection, { srcName: "Files", dstName: "Object", dstKind, name: IS_ATTACHED_TO, onFlip: vi.fn(), onSwap: vi.fn() })));
  expect(host.textContent!.includes("The Data Store recommends attaching datasets")).toBe(dstKind !== "step");
});


test("an older BAM project is corrected in the stored model as well as the field", () => {
  const change = panel("instrument", { project: "INSTRUMENTS" });
  expect(change).toHaveBeenCalledWith({ openbis: { ...openbisFor("instrument"), project: "FB Equipment Open" } });
  expect(host.querySelector<HTMLInputElement>('input[list="ds-project"]')!.value).toBe("FB Equipment Open");
});


test("changing an instrument in Bam Materials to a chemical clears incompatible placement", () => {
  const move = panel("instrument");
  const space = host.querySelectorAll("select")[1]!;
  act(() => { space.value = "Bam Materials"; space.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(move.mock.lastCall![0].openbis.project).toBe("FB Materials Open");
  const change = panel("instrument", move.mock.lastCall![0].openbis);
  const chooseType = [...host.querySelectorAll("button")].find((b) => b.textContent === "Choose another type...")!;
  act(() => chooseType.click());
  const search = host.querySelector<HTMLInputElement>(".term-search input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "CHEMICAL");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const chemical = [...host.querySelectorAll<HTMLButtonElement>(".term-hits button")]
    .find((b) => b.querySelector(".term-label")?.textContent === "CHEMICAL")!;
  expect(chemical).toBeDefined();
  act(() => chemical.click());
  const next = change.mock.lastCall![0];
  expect(next).toEqual({ kind: "chemical", openbis: {
    type: "CHEMICAL", area: "FB-Inventory", space: "", project: "", collection: "Chemicals",
  } });
  panel(next.kind, next.openbis);
  expect(host.textContent).not.toContain("not a Data Store Space");
  expect(host.textContent).not.toContain("openBIS project codes");
});
