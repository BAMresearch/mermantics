// @vitest-environment happy-dom
/** Real App callbacks/effects in a DOM; React Flow and layout are controlled test doubles. */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Box } from "../src/canvas/model.js";

const mocks = vi.hoisted(() => ({ narrow: false, flowRenders: 0, layout: vi.fn(), check: vi.fn(), supers: vi.fn(), fit: vi.fn(), initialized: false, cloneOnSet: false, nodes: [] as Box[], flowProps: {} as any, optionProps: {} as any, panelProps: {} as any, relationProps: {} as any, linkProps: {} as any, arrowProps: {} as any }));
vi.mock("../src/canvas/layout.js", () => ({ layout: mocks.layout }));
vi.mock("@xyflow/react", async () => {
  const { useState, useCallback } = await import("react");
  return {
    Background: () => null, MiniMap: () => null,
    ConnectionMode: { Loose: "loose" }, SelectionMode: { Full: "full" }, MarkerType: { ArrowClosed: "closed" },
    ReactFlow: (props: any) => { mocks.flowRenders++; mocks.nodes = props.nodes; mocks.flowProps = props; return null; },
    useReactFlow: () => flow,
    useNodesInitialized: () => mocks.initialized,
    useNodesState: (initial: Box[]) => {
      const [nodes, setNodes] = useState(initial);
      const set = useCallback((update: import("react").SetStateAction<Box[]>) => setNodes((previous) => {
        const next = typeof update === "function" ? update(previous) : update;
        return mocks.cloneOnSet ? next.map((b) => ({ ...b, measured: { width: 220, height: 90 } })) : next;
      }), []);
      return [nodes, set, (changes: { id: string; position: { x: number; y: number } }[]) =>
        setNodes((bs) => bs.filter((b) => !changes.some((c: any) => c.type === "remove" && c.id === b.id)).map((b) => ({ ...b, position: changes.find((c) => c.id === b.id)?.position ?? b.position })))];
    },
    useEdgesState: (initial: unknown[]) => { const [edges, setEdges] = useState(initial); return [edges, setEdges, (changes: any[]) => setEdges((es: any[]) => es
      .filter((e) => !changes.some((c) => c.type === "remove" && c.id === e.id))
      .map((e) => ({ ...e, selected: changes.find((c) => c.type === "select" && c.id === e.id)?.selected ?? e.selected })))]; },
  };
});
const flow = { fitView: mocks.fit, screenToFlowPosition: (p: unknown) => p };
vi.mock("../src/canvas/media.js", () => ({ NARROW: "narrow", TOUCH: "touch", useMedia: (query: string) => query === "narrow" && mocks.narrow }));
vi.mock("../src/canvas/checker.js", () => ({ check: mocks.check, supers: mocks.supers, loadOntology: vi.fn(async () => ({ title: "Test ontology" })) }));
vi.mock("../src/canvas/ZoomBar.js", () => ({ ZoomBar: () => null, loadWheelMode: () => "move", saveWheelMode: () => {} }));
vi.mock("../src/canvas/BoxNode.js", () => ({ BoxNode: () => null, worst: () => null }));
vi.mock("../src/canvas/FloatingEdge.js", () => ({ FloatingEdge: () => null }));
vi.mock("../src/canvas/OpenbisLane.js", () => ({ LaneNode: () => null }));
vi.mock("../src/canvas/Details.js", () => ({
  Overview: () => null, ArrowDetails: (props: any) => { mocks.arrowProps = props; return null; }, BoxDetails: () => null, SelectionPanel: () => null,
}));
vi.mock("../src/canvas/Options.js", () => ({
  OptionBar: (props: object) => { mocks.optionProps = props; return null; }, OptionPanel: (props: object) => { mocks.panelProps = props; return null; },
  Compare: () => null, TermsTree: () => null, checkStatus: vi.fn(),
}));
vi.mock("../src/canvas/ToolbarMenu.js", () => ({
  ToolbarIcon: () => null, ToolbarMenu: ({ children }: { children: import("react").ReactNode }) => children,
}));

vi.mock("../src/canvas/RelationMenu.js", () => ({
  loadOwnRelations: () => [], saveOwnRelations: () => {},
  PlainRelationMenu: (props: any) => { mocks.relationProps = props; return createElement("div", { "data-menu": "relation" }); },
  RelationMenu: (props: any) => { mocks.relationProps = props; return createElement("div", { "data-menu": "relation" }); },
}));
vi.mock("../src/canvas/DatastorePanel.js", () => ({
  WhereThingsGo: () => null,
  DatastoreLinkMenu: (props: any) => { mocks.linkProps = props; return createElement("div", { "data-menu": "link" }); },
}));

import { MSE_SHAPES } from "../src/canvas/palette.js";
import { readUses } from "../src/canvas/patterns.js";
import { App } from "../src/canvas/App.js";
import { MODES, type Mode } from "../src/canvas/mode.js";
import { readState } from "../src/canvas/options.js";
import { fromMermaid, toMermaid } from "../src/canvas/model.js";

let app: Root;
let container: HTMLDivElement;
let frames: FrameRequestCallback[];
let storage: Map<string, string>;
let layoutWidth: number;
let measureDetails: () => void;
const plain: Mode = { ...MODES.process!, ontology: false, options: false, patterns: false,
  examples: [{ title: "Example", name: "example.mmd", text: 'flowchart TD\nA["Original"]' }] };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const nodes = (): Box[] => mocks.nodes;
const click = async (label: string) => act(async () => { container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click(); });
const mount = async (mode = plain) => act(async () => { app = createRoot(container); app.render(createElement(App, { mode, onHome: () => {} })); });
const flushFrames = () => { const pending = frames.splice(0); pending.forEach((f) => f(0)); };

beforeEach(() => {
  vi.useFakeTimers();
  mocks.narrow = false;
  layoutWidth = 1200;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { width: this.classList.contains("body") ? layoutWidth : this.classList.contains("palette") ? 236 : 0 } as DOMRect;
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { measureDetails = callback; }
    observe() {}
    disconnect() {}
  });
  mocks.layout.mockReset().mockImplementation(async (bs: Box[]) => bs);
  mocks.check.mockReset();
  mocks.supers.mockReset().mockImplementation(async (ids: string[]) => ids.map(() => []));
  mocks.fit.mockClear();
  mocks.initialized = false;
  mocks.cloneOnSet = false;
  container = document.createElement("div");
  document.body.append(container);
  frames = [];
  storage = new Map();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal("sessionStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
  vi.stubGlobal("localStorage", { getItem: () => null });
});
afterEach(async () => {
  if (app) await act(async () => app.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("details can be resized, collapsed, and reopened without losing their width", async () => {
  await mount();
  const rendersBeforeResize = mocks.flowRenders;
  const divider = container.querySelector<HTMLElement>('[role="separator"]')!;
  const panel = container.querySelector<HTMLElement>("#details-panel")!;
  divider.setPointerCapture = vi.fn();
  divider.hasPointerCapture = () => true;
  divider.releasePointerCapture = vi.fn();
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ width: 340 } as DOMRect);
  await act(async () => {
    divider.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 700 }));
    divider.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 760 }));
    divider.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
  });
  expect(mocks.flowRenders).toBe(rendersBeforeResize);
  expect(divider.getAttribute("aria-valuenow")).toBe("280");
  await act(async () => divider.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" })));
  expect(divider.getAttribute("aria-valuenow")).toBe("240");
  await click("Collapse details panel");
  flushFrames();
  expect(panel.hidden).toBe(true);
  expect(container.querySelector('[role="separator"]')).toBeNull();
  const reopen = container.querySelector<HTMLButtonElement>(".details-reopen")!;
  expect(document.activeElement).toBe(reopen);
  await act(async () => reopen.click());
  flushFrames();
  expect(panel.hidden).toBe(false);
  expect(container.querySelector('[role="separator"]')!.getAttribute("aria-valuenow")).toBe("240");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Collapse details panel");
});

test("details use the effective width after layout changes and retain preferences across mobile", async () => {
  const mode = { ...plain, examples: [{ title: "Connected", name: "connected.mmd", text: 'flowchart TD\nA["First"]\nB["Second"]\nA --> B' }] };
  await mount(mode);
  const selectedId = mocks.flowProps.edges[0].id;
  await act(async () => mocks.flowProps.onEdgesChange([{ type: "select", id: selectedId, selected: true }]));
  const divider = () => container.querySelector<HTMLElement>('[role="separator"]')!;
  const key = async (key: string) => act(async () => { divider().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key })); });
  const expectWidth = (width: number) => {
    expect(divider().getAttribute("aria-valuenow")).toBe(String(width));
    expect(container.querySelector<HTMLElement>(".body")!.style.getPropertyValue("--details-width")).toBe(`${width}px`);
  };
  const originalNodes = nodes();
  const originalEdges = mocks.flowProps.edges;
  const documentBefore = toMermaid(nodes(), originalEdges);
  expect(originalEdges[0].selected).toBe(true);
  const renders = mocks.flowRenders;
  await key("End");
  expectWidth(600);
  await key("ArrowLeft");
  expectWidth(600);
  await act(async () => { layoutWidth = 1000; measureDetails(); });
  expectWidth(444);
  expect(divider().getAttribute("aria-valuemax")).toBe("444");
  await act(async () => { layoutWidth = 1200; measureDetails(); });
  expectWidth(600);
  await act(async () => { layoutWidth = 1000; measureDetails(); });
  await key("ArrowRight");
  expectWidth(424);
  await key("Home");
  await key("ArrowRight");
  expectWidth(240);
  await key("End");
  expectWidth(444);
  expect(mocks.flowRenders).toBe(renders);
  expect(nodes()).toBe(originalNodes);
  expect(mocks.flowProps.edges).toBe(originalEdges);
  expect(mocks.flowProps.edges[0].selected).toBe(true);
  expect(toMermaid(nodes(), mocks.flowProps.edges)).toBe(documentBefore);
  await click("Collapse details panel");
  await act(async () => { mocks.narrow = true; layoutWidth = 900; app.render(createElement(App, { mode, onHome: () => {} })); });
  expect(container.querySelector(".details-resizer")).toBeNull();
  expect(container.querySelector<HTMLElement>("#details-panel")!.hidden).toBe(false);
  await act(async () => { mocks.narrow = false; layoutWidth = 901; app.render(createElement(App, { mode, onHome: () => {} })); });
  expect(container.querySelector<HTMLElement>("#details-panel")!.hidden).toBe(true);
  await act(async () => container.querySelector<HTMLButtonElement>(".details-reopen")!.click());
  expectWidth(345);
  await act(async () => { layoutWidth = 1200; measureDetails(); });
  expectWidth(444);
});

test("details drag ignores unrelated pointers and stops on cancellation or capture loss", async () => {
  await mount();
  const divider = container.querySelector<HTMLElement>('[role="separator"]')!;
  divider.setPointerCapture = vi.fn();
  divider.hasPointerCapture = () => true;
  divider.releasePointerCapture = vi.fn();
  const pointer = async (type: string, pointerId: number, clientX: number) => act(async () => {
    divider.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId, clientX }));
  });
  for (const termination of ["pointercancel", "lostpointercapture"]) {
    await pointer("pointerdown", 1, 700);
    await pointer("pointerdown", 2, 700);
    await pointer("pointermove", 2, 500);
    await pointer("pointerup", 2, 500);
    await pointer("pointercancel", 2, 500);
    await pointer("lostpointercapture", 2, 500);
    expect(divider.getAttribute("aria-valuenow")).toBe("340");
    await pointer("pointermove", 1, 680);
    expect(divider.getAttribute("aria-valuenow")).toBe("360");
    await pointer(termination, 1, 680);
    await pointer("pointermove", 1, 500);
    expect(divider.getAttribute("aria-valuenow")).toBe("360");
    await act(async () => divider.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })));
  }
  await pointer("pointerdown", 1, 700);
  await click("Collapse details panel");
  expect(divider.releasePointerCapture).toHaveBeenLastCalledWith(1);
  await act(async () => container.querySelector<HTMLButtonElement>(".details-reopen")!.click());
  const reopened = container.querySelector<HTMLElement>('[role="separator"]')!;
  await act(async () => reopened.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 500 })));
  expect(reopened.getAttribute("aria-valuenow")).toBe("340");
});

test("Tidy then New never restores old boxes or fits the old document", async () => {
  await mount();
  flushFrames(); mocks.fit.mockClear();
  const pending = deferred<Box[]>();
  const old = nodes();
  mocks.layout.mockImplementationOnce(() => pending.promise);
  await click("Tidy up");
  await click("New");
  expect(nodes()).toEqual([]);
  await act(async () => pending.resolve(old));
  flushFrames();
  expect(nodes()).toEqual([]);
  expect(mocks.fit).toHaveBeenCalledTimes(1); // New only
});

test("Tidy preserves a rename and manual movement made while layout runs", async () => {
  await mount();
  const pending = deferred<Box[]>();
  const before = nodes();
  mocks.layout.mockImplementationOnce(() => pending.promise);
  await click("Tidy up");
  await act(async () => {
    nodes()[0]!.data.onRename!("Edited");
    mocks.flowProps.onNodesChange([{ type: "position", id: "A", position: { x: 77, y: 88 } }]);
  });
  await act(async () => pending.resolve(before.map((b) => ({ ...b, position: { x: 500, y: 600 } }))));
  expect(nodes()[0]).toMatchObject({ position: { x: 77, y: 88 }, data: { name: "Edited" } });
});

test("late layout failure cannot put a notice on a new document", async () => {
  await mount();
  const pending = deferred<Box[]>();
  mocks.layout.mockImplementationOnce(() => pending.promise);
  await click("Tidy up");
  await click("New");
  await act(async () => pending.reject(new Error("old failure")));
  expect(container.textContent).not.toContain("old failure");
});

test("a file read started before New cannot replace it", async () => {
  await mount();
  const pending = deferred<string>();
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[accept=".mmd,.md,.txt"]')!;
    Object.defineProperty(input, "files", { value: [{ name: "late.mmd", text: () => pending.promise }] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("New");
  await act(async () => pending.resolve('flowchart TD\nLate["Late"]'));
  expect(nodes()).toEqual([]);
});

test("unmount invalidates a pending layout and deferred viewport work", async () => {
  await mount();
  const pending = deferred<Box[]>();
  const before = nodes();
  mocks.layout.mockImplementationOnce(() => pending.promise);
  await click("Tidy up");
  await act(async () => app.unmount());
  await act(async () => pending.resolve(before));
  flushFrames();
  expect(mocks.fit).not.toHaveBeenCalled();
});

test("overlapping Terms / DFT / Terms loads keep selection, canvas and save target together", async () => {
  const mode: Mode = { ...plain, options: true };
  await mount(mode);
  const bar = () => mocks.optionProps;
  const { option } = bar().current;
  await act(async () => bar().onGo(option, "terms"));
  await act(async () => nodes()[0]!.data.onRename!("Saved before debounce"));
  const slow = deferred<Box[]>();
  mocks.layout.mockImplementationOnce(() => slow.promise);
  await act(async () => bar().onGo(option, "dft"));
  await act(async () => bar().onGo(option, "terms"));
  expect(nodes().some((b) => b.data.name === "Saved before debounce")).toBe(true);
  await act(async () => slow.resolve(fromMermaid('flowchart TD\nWrong["Wrong view"]').boxes));
  expect(bar().current).toEqual({ option, view: "terms" });
  expect(nodes().some((b) => b.id === "Wrong")).toBe(false);
  let filename = "";
  const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    filename = this.download;
  });
  await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Mermaid diagram"))!.click());
  expect(filename).toBe(`${bar().options.find((o: { id: string }) => o.id === option).letter}-terms.mmd`);
  download.mockRestore();
  await act(async () => nodes()[0]!.data.onRename!("Saved to Terms"));
  await act(async () => vi.advanceTimersByTime(801));
  const saved = readState(storage.get(mode.storageKey)!);
  expect(saved.options.find((o) => o.id === option)!.views.terms).toContain("Saved to Terms");
  expect(saved.options.find((o) => o.id === option)!.views.dft).not.toContain("Saved to Terms");
});

test("measurement updates during opening cannot leave saving disabled", async () => {
  mocks.cloneOnSet = true;
  await mount();
  await act(async () => nodes()[0]!.data.onRename!("Save despite new array"));
  await act(async () => vi.advanceTimersByTime(801));
  expect(storage.get(plain.storageKey)).toContain("Save despite new array");
});

test("initial measured layout still runs and fits the current diagram", async () => {
  mocks.cloneOnSet = true;
  mocks.initialized = true;
  mocks.layout.mockResolvedValueOnce(fromMermaid('flowchart TD\nA["Original"]').boxes)
    .mockImplementationOnce(async (bs: Box[]) => bs.map((b) => ({ ...b, position: { x: 321, y: 123 } })));
  await mount();
  expect(mocks.layout).toHaveBeenCalledTimes(2);
  expect(nodes()[0]!.position).toEqual({ x: 321, y: 123 });
  flushFrames();
  expect(mocks.fit).toHaveBeenCalled();
});

test("the latest Tidy request wins whichever layout finishes first", async () => {
  await mount();
  const before = nodes();
  const first = deferred<Box[]>();
  const second = deferred<Box[]>();
  mocks.layout.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  await click("Tidy up");
  await click("Tidy up");
  await act(async () => second.resolve(before.map((b) => ({ ...b, position: { x: 2, y: 2 } }))));
  await act(async () => first.resolve(before.map((b) => ({ ...b, position: { x: 1, y: 1 } }))));
  expect(nodes()[0]!.position).toEqual({ x: 2, y: 2 });
});

test("an example replaces pending layout work", async () => {
  await mount();
  const pending = deferred<Box[]>();
  mocks.layout.mockImplementationOnce(() => pending.promise);
  await click("Tidy up");
  await act(async () => {
    [...container.querySelectorAll("button")].find((b) => b.textContent === "Example")!.click();
  });
  await act(async () => pending.resolve(fromMermaid('flowchart TD\nWrong["Stale"]').boxes));
  expect(nodes().map((b) => b.id)).toEqual(["A"]);
});

test.each(["reset", "option", "clear"])("%s invalidates pending layout in computation views", async (action) => {
  await mount({ ...plain, options: true });
  const pending = deferred<Box[]>();
  mocks.layout.mockImplementationOnce(() => pending.promise);
  await click("Tidy up");
  if (action === "clear") await click("Clear");
  else if (action === "option") {
    const next = mocks.optionProps.options.find((o: { id: string }) => o.id !== mocks.optionProps.current.option);
    await act(async () => mocks.optionProps.onGo(next.id, "terms"));
  } else {
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Option")!.click());
    await act(async () => mocks.panelProps.onReset());
  }
  const expected = nodes();
  await act(async () => pending.resolve(fromMermaid('flowchart TD\nWrong["Stale"]').boxes));
  expect(nodes()).toEqual(expected);
});

test("failed current import preserves the diagram, reports the error and remains saveable", async () => {
  await mount();
  const pending = deferred<string>();
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[accept=".mmd,.md,.txt"]')!;
    Object.defineProperty(input, "files", { value: [{ name: "broken.mmd", text: () => pending.promise }] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => pending.reject(new Error("Read failed")));
  expect(nodes()[0]!.data.name).toBe("Original");
  expect(container.textContent).toContain("Could not open the diagram: Read failed");
  await act(async () => nodes()[0]!.data.onRename!("Still saveable"));
  await act(async () => vi.advanceTimersByTime(801));
  expect(storage.get(plain.storageKey)).toContain("Still saveable");
});

test.each(["failed import", "identical reopen"])("%s restarts an invalidated ontology check without a structural edit", async (action) => {
  const stale = deferred<{ result: { findings: { level: string; message: string; nodeId: string }[] } }>();
  const fresh = deferred<{ result: { findings: [] } }>();
  mocks.check.mockImplementationOnce(() => stale.promise).mockImplementationOnce(() => fresh.promise);
  await mount({ ...plain, ontology: true });
  await act(async () => vi.advanceTimersByTime(300));
  expect(mocks.check).toHaveBeenCalledTimes(1);
  expect(container.querySelector(".status")!.textContent).toBe("Checking...");

  if (action === "failed import") {
    const pending = deferred<string>();
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('input[accept=".mmd,.md,.txt"]')!;
      Object.defineProperty(input, "files", { value: [{ name: "broken.mmd", text: () => pending.promise }] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => pending.reject(new Error("Read failed")));
  } else {
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Example")!.click());
  }

  await act(async () => vi.advanceTimersByTime(300));
  expect(mocks.check).toHaveBeenCalledTimes(2);
  expect(mocks.check.mock.calls[1]![0]).toBe(mocks.check.mock.calls[0]![0]);
  await act(async () => fresh.resolve({ result: { findings: [] } }));
  expect(container.querySelector(".status")!.textContent).toBe("Quick check: no problems");
  // The old result cannot overwrite the completed replacement check either.
  await act(async () => stale.resolve({ result: { findings: [{ level: "error", message: "Stale error", nodeId: "A" }] } }));
  expect(container.querySelector(".status")!.textContent).toBe("Quick check: no problems");
  expect(nodes()[0]!.data.problems).toEqual([]);
});

test("copy keeps late edits attached to the visible original while classification is pending", async () => {
  const mode = { ...plain, options: true, ontology: true };
  const state = readState(null);
  const original = state.current;
  state.options.find((o) => o.id === original.option)!.views[original.view] =
    'flowchart TD\nA["Original<br/>PMD_0000000"]';
  storage.set(mode.storageKey, JSON.stringify(state));
  mocks.check.mockResolvedValue({ result: { findings: [] } });
  await mount(mode);
  await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Option")!.click());
  const pending = deferred<string[][]>();
  mocks.supers.mockImplementationOnce(() => pending.promise);
  await act(async () => mocks.panelProps.onCopy());
  expect(mocks.supers).toHaveBeenCalledTimes(2);
  const copy = mocks.optionProps.current;
  expect(copy.option).not.toBe(original.option);
  await act(async () => nodes()[0]!.data.onRename!("Late original edit"));
  // Complete before the debounce: open must flush to the original save destination.
  await act(async () => pending.resolve([[]]));
  const saved = readState(storage.get(mode.storageKey)!);
  expect(saved.options.find((o) => o.id === original.option)!.views[original.view]).toContain("Late original edit");
  expect(saved.options.find((o) => o.id === copy.option)!.views[copy.view as "dft"]).not.toContain("Late original edit");
  expect(nodes()[0]!.data.name).toBe("Original");
});

test.each(["failure", "success"])("reset %s retains saving until the replacement commits", async (outcome) => {
  const mode = { ...plain, options: true };
  await mount(mode);
  const target = mocks.optionProps.current;
  const savedText = () => readState(storage.get(mode.storageKey)!).options.find((o) => o.id === target.option)!.views[target.view as "dft"];
  await act(async () => nodes()[0]!.data.onRename!("Before reset"));
  await act(async () => vi.advanceTimersByTime(801));
  await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Option")!.click());
  const pending = deferred<Box[]>();
  let replacement: Box[] = [];
  mocks.layout.mockImplementationOnce((bs: Box[]) => { replacement = bs; return pending.promise; });
  await act(async () => mocks.panelProps.onReset());
  expect(savedText()).toContain("Before reset");
  await act(async () => nodes()[0]!.data.onRename!("While resetting"));
  await act(async () => vi.advanceTimersByTime(801));
  expect(savedText()).toContain("While resetting");
  if (outcome === "failure") {
    await act(async () => pending.reject(new Error("Reset layout failed")));
    expect(container.textContent).toContain("Reset layout failed");
    await act(async () => nodes()[0]!.data.onRename!("After failed reset"));
    await act(async () => vi.advanceTimersByTime(801));
    expect(savedText()).toContain("After failed reset");
  } else {
    await act(async () => pending.resolve(replacement));
    expect(savedText()).not.toContain("While resetting");
    expect(savedText()).not.toContain("Before reset");
    expect(nodes()[0]!.data.name).toBe(replacement[0]!.data.name);
  }
});

const connectionMode = (datastore: boolean): Mode => ({ ...plain, datastore,
  examples: [{ title: "Example", name: "example.mmd", text: 'flowchart TD\nA["A"]\nB["B"]' }] });
const choice = { kind: "relation", name: "uses", words: "uses", curie: "", own: true };
const openConnection = async (datastore: boolean) => {
  await act(async () => mocks.flowProps.onConnect({ source: "A", target: "B" }));
  const props = datastore ? mocks.linkProps : mocks.relationProps;
  return () => props.onChoose(datastore ? "is parent of" : choice);
};

test.each([[false, "A"], [false, "B"], [true, "A"], [true, "B"]] as const)("deleted endpoints invalidate pending connections (Data Store: %s, endpoint: %s)", async (datastore, endpoint) => {
  await mount(connectionMode(datastore));
  const choose = await openConnection(datastore);
  await act(async () => mocks.flowProps.onNodesChange([{ type: "remove", id: endpoint }]));
  expect(container.querySelector("[data-menu]")).toBeNull();
  await act(async () => choose());
  expect(mocks.flowProps.edges).toEqual([]);
  const reopened = fromMermaid(toMermaid(nodes(), mocks.flowProps.edges));
  expect(reopened.boxes.map((b) => b.id)).toEqual([endpoint === "A" ? "B" : "A"]);
  expect(reopened.warnings).toEqual([]);
});

test.each([false, true])("old callbacks cannot connect reused IDs (Data Store: %s)", async (datastore) => {
  await mount(connectionMode(datastore));
  const choose = await openConnection(datastore);
  await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Example")!.click());
  expect(container.querySelector("[data-menu]")).toBeNull();
  await act(async () => choose());
  expect(mocks.flowProps.edges).toEqual([]);
});

test.each([false, true])("valid connection choices still add arrows (Data Store: %s)", async (datastore) => {
  await mount(connectionMode(datastore));
  const choose = await openConnection(datastore);
  await act(async () => choose());
  expect(mocks.flowProps.edges).toHaveLength(1);
  expect(mocks.flowProps.edges[0]).toMatchObject({ source: "A", target: "B" });
});


test("deleting an arrow closes its replacement chooser and never recreates it", async () => {
  await mount(connectionMode(false));
  const choose = await openConnection(false);
  await act(async () => choose());
  const id = mocks.flowProps.edges[0].id;
  await act(async () => mocks.flowProps.onEdgesChange([{ type: "select", id, selected: true }]));
  await act(async () => mocks.arrowProps.onReconnect());
  const replace = mocks.relationProps.onChoose;
  await act(async () => mocks.flowProps.onEdgesChange([{ type: "remove", id }]));
  expect(container.querySelector("[data-menu]")).toBeNull();
  await act(async () => replace(choice));
  expect(mocks.flowProps.edges).toEqual([]);
});

test.each([false, true])("New revokes pending callbacks without phantom boxes (Data Store: %s)", async (datastore) => {
  await mount(connectionMode(datastore));
  const choose = await openConnection(datastore);
  await click("New");
  expect(container.querySelector("[data-menu]")).toBeNull();
  await act(async () => choose());
  const reopened = fromMermaid(toMermaid(nodes(), mocks.flowProps.edges));
  expect(reopened.boxes).toEqual([]);
  expect(reopened.arrows).toEqual([]);
  expect(reopened.warnings).toEqual([]);
});

test.each([false, true])("imports revoke connections before the file finishes loading (Data Store: %s)", async (datastore) => {
  await mount(connectionMode(datastore));
  const choose = await openConnection(datastore);
  const pending = deferred<string>();
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[accept=".mmd,.md,.txt"]')!;
    Object.defineProperty(input, "files", { value: [{ name: "next.mmd", text: () => pending.promise }] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelector("[data-menu]")).toBeNull();
  await act(async () => choose());
  expect(mocks.flowProps.edges).toEqual([]);
  // The old canvas is still visible, but cannot start choices for the loading document.
  await act(async () => mocks.flowProps.onConnect({ source: "A", target: "B" }));
  expect(container.querySelector("[data-menu]")).toBeNull();
  await act(async () => pending.resolve(connectionMode(datastore).examples[0]!.text));
  await act(async () => choose());
  expect(mocks.flowProps.edges).toEqual([]);
});

test("changing the Data Store view revokes its connection menu", async () => {
  await mount(connectionMode(true));
  const choose = await openConnection(true);
  await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("openBIS view"))!.click());
  expect(container.querySelector("[data-menu]")).toBeNull();
  await act(async () => choose());
  expect(mocks.flowProps.edges).toEqual([]);
});

test.each(["reset", "option", "view"])("%s closes the previous computation connection menu", async (action) => {
  await mount({ ...plain, options: true });
  const [source, target] = nodes();
  await act(async () => mocks.flowProps.onConnect({ source: source!.id, target: target!.id }));
  expect(container.querySelector("[data-menu]")).not.toBeNull();
  const choose = mocks.relationProps.onChoose;
  if (action === "reset") {
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Option")!.click());
    await act(async () => mocks.panelProps.onReset());
  } else {
    const bar = mocks.optionProps;
    const option = action === "option" ? bar.options.find((o: { id: string }) => o.id !== bar.current.option).id : bar.current.option;
    await act(async () => bar.onGo(option, bar.current.view === "terms" ? "dft" : "terms"));
  }
  expect(container.querySelector("[data-menu]")).toBeNull();
  const before = mocks.flowProps.edges;
  await act(async () => choose(choice));
  expect(mocks.flowProps.edges).toEqual(before);
});


test.each([false, true])("a superseded menu cannot commit or close the new menu (Data Store: %s)", async (datastore) => {
  await mount(connectionMode(datastore));
  const oldChoose = await openConnection(datastore);
  const newChoose = await openConnection(datastore);
  await act(async () => oldChoose());
  expect(mocks.flowProps.edges).toEqual([]);
  expect(container.querySelector("[data-menu]")).not.toBeNull();
  await act(async () => newChoose());
  expect(mocks.flowProps.edges).toHaveLength(1);
});

test.each(["A", "B"])("dataset attachments keep their direction and reject missing endpoints (%s)", async (dataset) => {
  const mode = connectionMode(true);
  const imported = fromMermaid(mode.examples[0]!.text);
  imported.boxes.find((b) => b.id === dataset)!.data.kind = "dataset";
  mode.examples = [{ ...mode.examples[0]!, text: toMermaid(imported.boxes, []) }];
  await mount(mode);
  await act(async () => mocks.flowProps.onConnect({ source: "A", target: "B" }));
  expect(mocks.flowProps.edges).toHaveLength(1);
  expect(mocks.flowProps.edges[0]).toMatchObject({ source: dataset, target: dataset === "A" ? "B" : "A", data: { name: "is attached to" } });
  await click("New");
  await act(async () => mocks.flowProps.onConnect({ source: "A", target: "B" }));
  expect(mocks.flowProps.edges).toEqual([]);
  expect(container.querySelector("[data-menu]")).toBeNull();
});

test("an existing arrow can still have its relation replaced", async () => {
  await mount(connectionMode(false));
  const choose = await openConnection(false);
  await act(async () => choose());
  const id = mocks.flowProps.edges[0].id;
  await act(async () => mocks.flowProps.onEdgesChange([{ type: "select", id, selected: true }]));
  await act(async () => mocks.arrowProps.onReconnect());
  await act(async () => mocks.relationProps.onChoose({ ...choice, name: "produces", words: "produces" }));
  expect(mocks.flowProps.edges).toHaveLength(1);
  expect(mocks.flowProps.edges[0]).toMatchObject({ id, data: { name: "produces" } });
});

test.each(["plain", "ontology", "datastore"])("%s menu cancellation only revokes its own generation", async (kind) => {
  const datastore = kind === "datastore";
  mocks.check.mockResolvedValue({ result: { findings: [] } });
  const mode = connectionMode(datastore);
  mode.examples = mode.examples.map((example) => ({ ...example, text: `${example.text}\nC["C"]` }));
  await mount({ ...mode, ontology: kind === "ontology" });
  const menu = () => datastore ? mocks.linkProps : mocks.relationProps;
  await openConnection(datastore);
  const oldCancel = menu().onCancel;
  const choose = await openConnection(datastore);
  await act(async () => oldCancel());
  expect(container.querySelector("[data-menu]")).not.toBeNull();
  await act(async () => choose());
  expect(mocks.flowProps.edges).toHaveLength(1);

  // Use an unlinked pair so Data Store's duplicate-link guard cannot mask a stale choice.
  await act(async () => mocks.flowProps.onConnect({ source: "A", target: "C" }));
  const cancelledChoose = menu().onChoose;
  await act(async () => menu().onCancel());
  expect(container.querySelector("[data-menu]")).toBeNull();
  await act(async () => cancelledChoose(datastore ? "is parent of" : choice));
  expect(mocks.flowProps.edges).toHaveLength(1);
  expect(mocks.flowProps.edges.some((edge: { source: string; target: string }) =>
    (edge.source === "A" && edge.target === "C") || (edge.source === "C" && edge.target === "A"))).toBe(false);
});

const insertFirstPattern = async () => act(async () => {
  container.querySelector<HTMLButtonElement>('button.pattern')!.click();
});

// Resolve both operations without a React render between them as well as in either order.
test.each(["first", "second", "same batch"])("overlapping patterns keep independent identities (%s finishes first)", async (order) => {
  await mount({ ...plain, patterns: true });
  const pending = [deferred<Box[]>(), deferred<Box[]>()];
  const prepared: Box[][] = [];
  for (const p of pending) mocks.layout.mockImplementationOnce((bs: Box[]) => { prepared.push(bs); return p.promise; });
  await insertFirstPattern();
  await insertFirstPattern();
  expect(prepared).toHaveLength(2);
  if (order === "same batch") await act(async () => pending.forEach((p, i) => p.resolve(prepared[i]!)));
  else for (const i of order === "first" ? [0, 1] : [1, 0]) await act(async () => pending[i]!.resolve(prepared[i]!));
  const boxes = nodes();
  const arrows = mocks.flowProps.edges as import("../src/canvas/model.js").Arrow[];
  expect(boxes).toHaveLength(11);
  expect(new Set(boxes.map((b) => b.id)).size).toBe(11);
  expect(arrows).toHaveLength(8);
  expect(new Set(arrows.map((a) => a.id)).size).toBe(8);
  await act(async () => vi.advanceTimersByTime(801));
  const reopened = fromMermaid(storage.get(plain.storageKey)!);
  const uses = readUses(reopened.patternUses);
  expect(reopened.boxes).toHaveLength(11);
  expect(reopened.arrows).toHaveLength(8);
  expect(uses).toHaveLength(2);
  expect(new Set(uses.map((u) => u.id)).size).toBe(2);
  expect(new Set(uses.flatMap((u) => u.parts.map((p) => p.box))).size).toBe(10);
  for (const use of uses) {
    const ids = new Map(use.parts.map((p) => [p.part, p.box]));
    for (const required of use.arrows) {
      for (const actual of [arrows, reopened.arrows]) expect(actual.some((a) =>
        a.source === ids.get(required.from) && a.target === ids.get(required.to) && a.data?.curie === required.curie)).toBe(true);
    }
  }
  // Clicked copies are placed when they commit, so the later one goes beside the earlier one.
  const spans = uses.map((use) => {
    const xs = use.parts.map((p) => boxes.find((b) => b.id === p.box)!.position.x);
    return [Math.min(...xs), Math.max(...xs)] as const;
  }).sort((a, b) => a[0] - b[0]);
  expect(spans[1]![0]).toBeGreaterThan(spans[0]![1]);
  expect(reopened.warnings).toEqual([]);
});

test("a palette box added in the same batch as a pattern completion keeps its own ID", async () => {
  await mount({ ...plain, patterns: true, shapes: MSE_SHAPES });
  const pending = deferred<Box[]>();
  let prepared: Box[] = [];
  mocks.layout.mockImplementationOnce((bs: Box[]) => { prepared = bs; return pending.promise; });
  // Both the palette shape and the pattern's box are named 'Device', so they compete for one ID.
  const pattern = [...container.querySelectorAll<HTMLButtonElement>("button.pattern")]
    .find((b) => b.querySelector("b")?.textContent === "Device identifier")!;
  await act(async () => pattern.click());
  expect(prepared.some((b) => b.data.name === "Device")).toBe(true);
  // Resolve first, then click before any microtask runs: the pattern resumes after addBox has
  // chosen its ID but before React renders, so only the refs can tell it that 'Device' is taken.
  await act(async () => {
    pending.resolve(prepared);
    container.querySelector<HTMLButtonElement>("button.shape.kind-device")!.click();
  });
  const ids = nodes().map((b) => b.id);
  expect(ids).toHaveLength(1 + 1 + prepared.length);
  expect(new Set(ids).size).toBe(ids.length);
  await act(async () => vi.advanceTimersByTime(801));
  const reopened = fromMermaid(storage.get(plain.storageKey)!);
  expect(reopened.boxes.map((b) => b.id).sort()).toEqual([...ids].sort());
  const [use] = readUses(reopened.patternUses);
  const device = use!.parts.find((p) => p.part === "Device")!.box;
  expect(device).not.toBe("Device"); // the palette box committed first and kept the plain name
  expect(reopened.boxes.filter((b) => b.data.name === "Device")).toHaveLength(2);
});

test.each(["success", "failure"])("a replaced document discards pending pattern %s", async (outcome) => {
  await mount({ ...plain, patterns: true });
  const pending = deferred<Box[]>();
  let prepared: Box[] = [];
  mocks.layout.mockImplementationOnce((bs: Box[]) => { prepared = bs; return pending.promise; });
  await insertFirstPattern();
  await click("New");
  await act(async () => outcome === "success" ? pending.resolve(prepared) : pending.reject(new Error("Stale pattern")));
  expect(nodes()).toEqual([]);
  expect(mocks.flowProps.edges).toEqual([]);
  expect(container.textContent).not.toContain("Stale pattern");
});

test.each(["classification", "layout"])("failed pattern %s preserves content without partial metadata", async (stage) => {
  mocks.check.mockResolvedValue({ result: { findings: [] } });
  await mount({ ...plain, patterns: true, ontology: true });
  await insertFirstPattern();
  await act(async () => vi.advanceTimersByTime(801));
  const before = storage.get(plain.storageKey)!;
  const pending = deferred<any>();
  (stage === "classification" ? mocks.supers : mocks.layout).mockImplementationOnce(() => pending.promise);
  await insertFirstPattern();
  await act(async () => pending.reject(new Error("Pattern failed")));
  expect(container.textContent).toContain("Could not insert the pattern: Pattern failed");
  await act(async () => vi.advanceTimersByTime(801));
  expect(storage.get(plain.storageKey)).toBe(before);
  expect(nodes()).toHaveLength(6);
  expect(mocks.flowProps.edges).toHaveLength(4);
  // A subsequent insertion still works after the failure.
  await insertFirstPattern();
  expect(nodes()).toHaveLength(11);
});
