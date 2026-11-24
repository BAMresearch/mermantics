// @vitest-environment happy-dom
/** Real App callbacks/effects in a DOM; React Flow and layout are controlled test doubles. */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getOntologyState, publishOntology, resetOntology } from "./helpers/ontology-state.js";
import type { Box } from "../src/canvas/model.js";

const mocks = vi.hoisted(() => ({ loadOntology: vi.fn(), overviewProps: {} as any, narrow: false, flowRenders: 0, layout: vi.fn(), check: vi.fn(), supers: vi.fn(), fit: vi.fn(), initialized: false, cloneOnSet: false, picture: vi.fn(), nodes: [] as Box[], flowProps: {} as any, optionProps: {} as any, panelProps: {} as any, relationProps: {} as any, linkProps: {} as any, arrowProps: {} as any, boxProps: {} as any }));
vi.mock("../src/canvas/layout.js", () => ({ layout: mocks.layout }));
vi.mock("@xyflow/react", async () => {
  const { useState, useCallback } = await import("react");
  return {
    Background: () => null, MiniMap: () => null,
    ConnectionMode: { Loose: "loose" }, SelectionMode: { Full: "full" }, MarkerType: { ArrowClosed: "closed" },
    ReactFlow: (props: any) => { mocks.flowRenders++; mocks.nodes = props.nodes; mocks.flowProps = props; return createElement("div", { className: "react-flow__viewport" }); },
    useReactFlow: () => flow,
    useNodesInitialized: () => mocks.initialized,
    useNodesState: (initial: Box[]) => {
      const [nodes, setNodes] = useState(initial);
      const set = useCallback((update: import("react").SetStateAction<Box[]>) => setNodes((previous) => {
        const next = typeof update === "function" ? update(previous) : update;
        return mocks.cloneOnSet ? next.map((b) => ({ ...b, measured: { width: 220, height: 90 } })) : next;
      }), []);
      return [nodes, set, (changes: { id: string; type?: string; selected?: boolean; position?: { x: number; y: number }; dragging?: boolean }[]) =>
        setNodes((bs) => bs.filter((b) => !changes.some((c: any) => c.type === "remove" && c.id === b.id)).map((b) => {
          const c = changes.find((x) => x.id === b.id);
          return { ...b, position: c?.position ?? b.position, ...(c && "dragging" in c ? { dragging: c.dragging } : {}),
                   ...(c?.type === "select" ? { selected: c.selected } : {}) };
        }))];
    },
    useEdgesState: (initial: unknown[]) => { const [edges, setEdges] = useState(initial); return [edges, setEdges, (changes: any[]) => setEdges((es: any[]) => es
      .filter((e) => !changes.some((c) => c.type === "remove" && c.id === e.id))
      .map((e) => ({ ...e, selected: changes.find((c) => c.type === "select" && c.id === e.id)?.selected ?? e.selected })))]; },
  };
});
const flow = { fitView: mocks.fit, screenToFlowPosition: (p: unknown) => p };
vi.mock("../src/canvas/canvasImage.js", () => ({
  afterPaint: async () => {}, drawnBounds: () => ({ x: 0, y: 0, width: 100, height: 50 }), canvasImage: mocks.picture,
}));
vi.mock("../src/canvas/media.js", () => ({ NARROW: "narrow", TOUCH: "touch", useMedia: (query: string) => query === "narrow" && mocks.narrow }));
vi.mock("../src/canvas/checker.js", async () => {
  const state = await import("./helpers/ontology-state.js");
  return { ...state, check: mocks.check, supers: mocks.supers, loadOntology: () => {
    state.publishOntology({ status: "loading", error: "", timedOut: false });
    return mocks.loadOntology().then((info: { title: string }) => {
      state.publishOntology({ status: "ready", title: info.title, revision: state.getOntologyState().revision + 1 });
      return info;
    }).catch((error: Error) => {
      state.publishOntology({ status: "failed", error: error.message });
      throw error;
    });
  } };
});
vi.mock("../src/canvas/ZoomBar.js", () => ({ ZoomBar: () => null, loadWheelMode: () => "move", saveWheelMode: () => {} }));
vi.mock("../src/canvas/BoxNode.js", () => ({ BoxNode: () => null, worst: () => null }));
vi.mock("../src/canvas/FloatingEdge.js", () => ({ FloatingEdge: () => null }));
vi.mock("../src/canvas/OpenbisLane.js", () => ({ LaneNode: () => null }));
vi.mock("../src/canvas/Details.js", () => ({
  Overview: (props: any) => { mocks.overviewProps = props; return createElement("div", {}, props.children); }, ArrowDetails: (props: any) => { mocks.arrowProps = props; return null; },
  BoxDetails: (props: any) => { mocks.boxProps = props; return null; }, SelectionPanel: () => null,
}));
vi.mock("../src/canvas/OptionsPanel.js", () => ({
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
import { pendingSaves, retrySaves } from "../src/canvas/persistence.js";
import * as recovery from "../src/canvas/recovery.js";
import { BUILT_IN, MINE_KEY, loadMine, readUses } from "../src/canvas/patterns.js";
import { Start } from "../src/canvas/Start.js";
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
  resetOntology();
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
  mocks.loadOntology.mockReset().mockResolvedValue({ title: "Test ontology" });
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
  // Failed-save retention intentionally outlives App mounts, but not individual tests.
  vi.stubGlobal("sessionStorage", { setItem: () => {} });
  vi.stubGlobal("localStorage", { setItem: () => {} });
  retrySaves();
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

test.each(["ArrowLeft", "End", "pointer"])("blocked expansion preserves the preferred width (%s)", async (input) => {
  await mount();
  const divider = container.querySelector<HTMLElement>('[role="separator"]')!;
  divider.setPointerCapture = vi.fn();
  divider.hasPointerCapture = () => true;
  divider.releasePointerCapture = vi.fn();
  const key = async (key: string) => act(async () => {
    divider.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
  });
  const drag = async (delta: number) => act(async () => {
    divider.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 700 }));
    divider.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 700 - delta }));
    divider.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
  });
  const viewport = async (size: number) => act(async () => { layoutWidth = size; measureDetails(); });
  const expectWidth = (width: number) => {
    expect(divider.getAttribute("aria-valuenow")).toBe(String(width));
    expect(container.querySelector<HTMLElement>(".body")!.style.getPropertyValue("--details-width")).toBe(`${width}px`);
  };
  await key("End");
  expectWidth(600);
  await viewport(1000);
  expectWidth(444);
  if (input === "pointer") await drag(20);
  else await key(input);
  expectWidth(444);
  await viewport(1200);
  expectWidth(600);
  await viewport(1000);
  if (input === "pointer") await drag(-20);
  else await key("ArrowRight");
  expectWidth(424);
  await viewport(1200);
  expectWidth(424);
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

test("copy preserves its stored other shape and keeps edits attached to the visible copy", async () => {
  const mode = { ...plain, options: true, ontology: true };
  const state = readState(null);
  const original = state.current;
  state.options.find((o) => o.id === original.option)!.views[original.view] =
    'flowchart TD\nA["Original<br/>PMD_0000000"]';
  storage.set(mode.storageKey, JSON.stringify(state));
  mocks.check.mockResolvedValue({ result: { findings: [] } });
  await mount(mode);
  await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Option")!.click());
  await act(async () => mocks.panelProps.onCopy());
  expect(mocks.supers).toHaveBeenCalledTimes(1);
  const copy = mocks.optionProps.current;
  expect(copy.option).not.toBe(original.option);
  await act(async () => nodes()[0]!.data.onRename!("Edit while classifying"));
  // The stored other shape is explicit; copying must not classify it again.
  await act(async () => vi.advanceTimersByTime(801));
  const saved = readState(storage.get(mode.storageKey)!);
  expect(saved.options.find((o) => o.id === original.option)!.views[original.view]).not.toContain("Edit while classifying");
  expect(saved.options.find((o) => o.id === copy.option)!.views[copy.view as "dft"]).toContain("Edit while classifying");
  expect(nodes()[0]!.data.name).toBe("Edit while classifying");
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

test.each(["classification", "layout"])("pattern %s failure leaves complete content and metadata", async (stage) => {
  mocks.check.mockResolvedValue({ result: { findings: [] } });
  await mount({ ...plain, patterns: true, ontology: true });
  await insertFirstPattern();
  await act(async () => vi.advanceTimersByTime(801));
  const before = storage.get(plain.storageKey)!;
  const pending = deferred<any>();
  (stage === "classification" ? mocks.supers : mocks.layout).mockImplementationOnce(() => pending.promise);
  await insertFirstPattern();
  await act(async () => pending.reject(new Error("Pattern failed")));
  expect(container.textContent).toContain(stage === "layout"
    ? "Could not insert the pattern: Pattern failed" : "Could not classify boxes: Pattern failed");
  await act(async () => vi.advanceTimersByTime(801));
  const copies = stage === "layout" ? 1 : 2;
  if (stage === "layout") expect(storage.get(plain.storageKey)).toBe(before);
  const reopened = fromMermaid(storage.get(plain.storageKey)!);
  const uses = readUses(reopened.patternUses);
  expect(uses).toHaveLength(copies);
  const ids = new Set(reopened.boxes.map((b) => b.id));
  for (const use of uses) for (const part of use.parts) expect(ids.has(part.box)).toBe(true);
  expect(nodes()).toHaveLength(1 + copies * 5);
  expect(mocks.flowProps.edges).toHaveLength(copies * 4);
  // A subsequent insertion still works after the failure.
  await insertFirstPattern();
  expect(nodes()).toHaveLength(1 + (copies + 1) * 5);
});

test("a failed picture export reports why, brings the selection back and allows the next one", async () => {
  const mode = { ...plain, examples: [{ title: "Connected", name: "connected.mmd", text: 'flowchart TD\nA["First"]\nB["Second"]\nA --> B' }] };
  await mount(mode);
  const arrowId = mocks.flowProps.edges[0].id;
  await act(async () => mocks.flowProps.onEdgesChange([{ type: "select", id: arrowId, selected: true }]));
  const picture = (format: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === `Picture .${format}`)!;
  const drawing = deferred<Blob>();
  mocks.picture.mockReset().mockReturnValue(drawing.promise);

  // Two clicks before React has drawn the first export's state: still one export.
  await act(async () => { picture("png").click(); picture("svg").click(); });
  expect(mocks.picture).toHaveBeenCalledTimes(1);
  expect(mocks.flowProps.edges[0].selected).toBe(false); // the picture is taken without the selection
  expect(picture("png").disabled && picture("svg").disabled).toBe(true);

  await act(async () => drawing.reject(new Error("out of memory")));
  expect(container.querySelector(".notice")!.textContent).toBe("Could not save the picture: out of memory");
  expect(mocks.flowProps.edges[0].selected).toBe(true);
  expect(picture("png").disabled || picture("svg").disabled).toBe(false);

  mocks.picture.mockResolvedValue(new Blob(["<svg/>"], { type: "image/svg+xml" }));
  await act(async () => picture("svg").click());
  expect(mocks.picture).toHaveBeenCalledTimes(2);
});

test("a picture is downloaded once, and its URL revoked only after the browser has read it", async () => {
  const mode = { ...plain, examples: [{ title: "Connected", name: "connected.mmd", text: 'flowchart TD\nA["First"]\nB["Second"]\nA --> B' }] };
  await mount(mode);
  const blob = new Blob(["png"], { type: "image/png" });
  mocks.picture.mockReset().mockResolvedValue(blob);
  const created = vi.fn((_: Blob) => "blob:picture");
  const revoked = vi.fn();
  vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL: created, revokeObjectURL: revoked }));
  const downloads: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(`${this.download} ${this.href}`); });

  const png = [...container.querySelectorAll("button")].find((b) => b.textContent === "Picture .png")!;
  await act(async () => png.click());
  expect(created).toHaveBeenCalledWith(blob);
  expect(downloads).toEqual(["connected.png blob:picture"]);
  expect(revoked).not.toHaveBeenCalled(); // Safari reads the file after the click
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(revoked).toHaveBeenCalledWith("blob:picture");
});

// ---- undo and redo ----------------------------------------------------------------------

const connected = { ...plain, examples: [{ title: "Connected", name: "connected.mmd", text: 'flowchart TD\nA["First"]\nB["Second"]\nA -- "feeds" --> B' }] };
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const press = async (key: string, opts: KeyboardEventInit = {}, target: EventTarget = window) =>
  act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...opts })); });
const move = (id: string, x: number, dragging?: boolean) =>
  mocks.flowProps.onNodesChange([{ type: "position", id, position: { x, y: 0 }, ...(dragging === undefined ? {} : { dragging }) }]);

test("a whole drag is one step, and undo and redo move the box back and forth", async () => {
  await mount(connected);
  const start = nodes().find((b) => b.id === "A")!.position;
  expect(button("Undo").disabled).toBe(true);
  expect(button("Redo").disabled).toBe(true);
  for (const x of [10, 20, 30]) await act(async () => move("A", x, true));
  expect(button("Undo").disabled).toBe(true); // still dragging
  await act(async () => move("A", 40, false));
  expect(button("Undo").disabled).toBe(false);
  await click("Undo");
  expect(nodes().find((b) => b.id === "A")!.position).toEqual(start);
  expect(button("Undo").disabled).toBe(true);
  expect(button("Redo").disabled).toBe(false);
  await press("z", { shiftKey: true });
  expect(nodes().find((b) => b.id === "A")!.position).toEqual({ x: 40, y: 0 });
  await press("z");
  await press("y");
  expect(nodes().find((b) => b.id === "A")!.position).toEqual({ x: 40, y: 0 });
});

test("undoing a deletion brings the box back with its arrows, and the restored diagram is saved", async () => {
  await mount(connected);
  const before = toMermaid(nodes(), mocks.flowProps.edges);
  const arrow = mocks.flowProps.edges[0].id;
  await act(async () => {
    mocks.flowProps.onNodesChange([{ type: "remove", id: "A" }]);
    mocks.flowProps.onEdgesChange([{ type: "remove", id: arrow }]);
  });
  expect(nodes().map((b) => b.id)).toEqual(["B"]);
  expect(mocks.flowProps.edges).toHaveLength(0);
  await press("z", { metaKey: true, ctrlKey: false });
  expect(nodes().map((b) => b.id).sort()).toEqual(["A", "B"]);
  expect(mocks.flowProps.edges.map((a: { id: string }) => a.id)).toEqual([arrow]);
  await act(async () => vi.advanceTimersByTime(801));
  expect(storage.get(plain.storageKey)).toBe(toMermaid(nodes(), mocks.flowProps.edges));
  expect(toMermaid(nodes(), mocks.flowProps.edges)).toBe(before);
});

test("selecting is not a step, and a new edit after undo clears redo", async () => {
  await mount(connected);
  await act(async () => mocks.flowProps.onEdgesChange([{ type: "select", id: mocks.flowProps.edges[0].id, selected: true }]));
  expect(button("Undo").disabled).toBe(true);
  await act(async () => move("A", 50));
  await click("Undo");
  expect(button("Redo").disabled).toBe(false);
  await act(async () => move("B", 70));
  expect(button("Redo").disabled).toBe(true);
  expect(button("Undo").disabled).toBe(false);
});

test("typing in a field keeps the field's own undo and becomes one step when the field is left", async () => {
  await mount(connected);
  const field = document.createElement("input");
  container.append(field);
  field.focus();
  for (const name of ["F", "Fi", "Fin"]) await act(async () => nodes().find((b) => b.id === "A")!.data.onRename!(name));
  expect(button("Undo").disabled).toBe(false); // the typing can be undone from the toolbar
  await press("z", {}, field);
  expect(nodes().find((b) => b.id === "A")!.data.name).toBe("Fin"); // Ctrl+Z in the field is the field's
  await act(async () => field.blur());
  await act(async () => nodes().find((b) => b.id === "A")!.data.onRename!("Final"));
  await click("Undo");
  expect(nodes().find((b) => b.id === "A")!.data.name).toBe("Fin");
  await click("Undo");
  expect(nodes().find((b) => b.id === "A")!.data.name).toBe("First");
  expect(button("Undo").disabled).toBe(true);
});

test("Tidy up is one step, and a layout still running cannot overwrite what undo restored", async () => {
  await mount(connected);
  const start = nodes().map((b) => b.position);
  mocks.layout.mockImplementationOnce(async (bs: Box[]) => bs.map((b) => ({ ...b, position: { x: 900, y: 900 } })));
  await click("Tidy up");
  expect(nodes().every((b) => b.position.x === 900)).toBe(true);
  await click("Undo");
  expect(nodes().map((b) => b.position)).toEqual(start);
  const pending = deferred<Box[]>();
  mocks.layout.mockImplementationOnce(() => pending.promise);
  await act(async () => move("A", 5));
  await click("Tidy up");
  await click("Undo");
  await act(async () => pending.resolve(nodes().map((b) => ({ ...b, position: { x: 1, y: 1 } }))));
  expect(nodes().map((b) => b.position)).toEqual(start);
});

test("a pattern insertion is undone as one step", async () => {
  await mount({ ...plain, patterns: true });
  const before = nodes().map((b) => b.id);
  await insertFirstPattern();
  expect(nodes().length).toBeGreaterThan(before.length + 1);
  await click("Undo");
  expect(nodes().map((b) => b.id)).toEqual(before);
  expect(button("Undo").disabled).toBe(true);
});

test("history belongs to the document on the canvas", async () => {
  await mount(connected);
  await act(async () => move("A", 50));
  expect(button("Undo").disabled).toBe(false);
  await click("New");
  expect(button("Undo").disabled).toBe(true);
  await press("z");
  expect(nodes()).toEqual([]);
});

test("undo cancels obsolete classification and redo retries the pending class", async () => {
  mocks.check.mockResolvedValue({ result: { findings: [] } });
  await mount({ ...plain, ontology: true });
  await act(async () => mocks.flowProps.onNodesChange([{ type: "select", id: "A", selected: true }]));
  const box = () => nodes().find((b) => b.id === "A")!.data;
  expect(box().kind).toBe("other");
  const late = deferred<string[][]>();
  mocks.supers.mockImplementationOnce(() => late.promise);
  await act(async () => mocks.boxProps.onChange({ classId: "TEST_1", classLabel: "a process" }));
  const signal = mocks.supers.mock.lastCall![1] as AbortSignal;
  await click("Undo"); // before the class has been looked up
  expect(signal.aborted).toBe(true);
  await act(async () => late.resolve([["COB_0000035"]]));
  expect([box().classId, box().kind]).toEqual(["", "other"]);
  const lookups = mocks.supers.mock.calls.length;
  mocks.supers.mockResolvedValueOnce([["COB_0000035"]]);
  await click("Redo");
  expect([box().classId, box().kind]).toEqual(["TEST_1", "process"]);
  await click("Undo");
  await click("Redo");
  expect(box().kind).toBe("process");
  expect(mocks.supers.mock.calls.length).toBe(lookups + 1); // Only the cancelled lookup is retried.
});

test("a shape found after later edits is in the earlier steps too", async () => {
  mocks.check.mockResolvedValue({ result: { findings: [] } });
  await mount({ ...connected, ontology: true });
  await act(async () => mocks.flowProps.onNodesChange([{ type: "select", id: "A", selected: true }]));
  const a = () => nodes().find((b) => b.id === "A")!.data;
  const late = deferred<string[][]>();
  mocks.supers.mockImplementationOnce(() => late.promise);
  await act(async () => mocks.boxProps.onChange({ classId: "TEST_1", classLabel: "a process" }));
  await act(async () => move("B", 80)); // another step while the class is being looked up
  await act(async () => late.resolve([["COB_0000035"]]));
  expect(a().kind).toBe("process");
  await click("Undo"); // back to just after the class was chosen
  expect(nodes().find((b) => b.id === "B")!.position).not.toEqual({ x: 80, y: 0 });
  expect([a().classId, a().kind]).toEqual(["TEST_1", "process"]);
  await click("Undo");
  expect([a().classId, a().kind]).toEqual(["", "other"]);
});

test("a pattern still being placed is dropped by undo, so redo stays possible", async () => {
  await mount({ ...plain, patterns: true });
  await act(async () => move("A", 50));
  const placing = deferred<Box[]>();
  let prepared: Box[] = [];
  mocks.layout.mockImplementationOnce((bs: Box[]) => { prepared = bs; return placing.promise; });
  await insertFirstPattern();
  await click("Undo");
  await act(async () => placing.resolve(prepared));
  expect(nodes().map((b) => b.id)).toEqual(["A"]);
  expect(button("Redo").disabled).toBe(false);
  await click("Redo");
  expect(nodes()[0]!.position).toEqual({ x: 50, y: 0 });
});

test.each(["Tidy up", "a pattern"])("%s finishing while a field has focus is a step of its own, not part of the typing", async (what) => {
  await mount({ ...plain, patterns: true });
  const start = nodes().map((b) => [b.id, b.position]);
  const field = document.createElement("input");
  container.append(field);
  field.focus();
  await act(async () => nodes()[0]!.data.onRename!("Typed"));
  mocks.layout.mockImplementationOnce(async (bs: Box[]) => bs.map((b) => ({ ...b, position: { x: 900, y: 900 } })));
  if (what === "Tidy up") await click("Tidy up");
  else await insertFirstPattern();
  expect(document.activeElement).toBe(field);
  await click("Undo");
  expect(nodes().map((b) => [b.id, b.position])).toEqual(start);
  expect(nodes()[0]!.data.name).toBe("Typed");
  await click("Undo");
  expect(nodes()[0]!.data.name).toBe("Original");
});


test("failed autosave keeps the latest diagram through section switching", async () => {
  await mount();
  let fail = true;
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => { if (fail) throw new Error("full"); storage.set(k, v); },
  });
  await act(async () => nodes()[0]!.data.onRename!("First unsaved edit"));
  await act(async () => vi.advanceTimersByTime(801));
  expect(container.querySelector(".save-notice")!.textContent).toContain("could not be saved");
  await act(async () => nodes()[0]!.data.onRename!("Edit just before switching"));
  await act(async () => app.unmount());
  await mount({ ...plain, id: "datastore", storageKey: MODES.datastore.storageKey });
  expect(nodes()[0]!.data.name).toBe("Original");
  expect(container.querySelector(".save-notice")!.textContent).toContain("Model anything");
  await act(async () => app.unmount());
  await mount();
  expect(nodes()[0]!.data.name).toBe("Edit just before switching");
  fail = false;
  await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Retry save")!.click());
  expect(storage.get(plain.storageKey)).toContain("Edit just before switching");
  expect(container.querySelector(".save-notice")).toBeNull();
});

test.each([false, true])("recovery download flushes a pending edit even if storage recovers (%s)", async (recovers) => {
  await mount();
  let fail = true;
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => { if (fail) throw new Error("full"); storage.set(k, v); },
  });
  await act(async () => nodes()[0]!.data.onRename!("Earlier failure"));
  await act(async () => vi.advanceTimersByTime(801));
  await act(async () => nodes()[0]!.data.onRename!("Newest edit before debounce"));
  const download = vi.spyOn(recovery, "downloadRecovery").mockImplementation(() => {});
  fail = !recovers;
  await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Download recovery copy")!.click());
  const entries = download.mock.calls[0]![0];
  expect(entries.find((p) => p.key === plain.storageKey)!.text).toContain("Newest edit before debounce");
  expect(pendingSaves()).toHaveLength(recovers ? 0 : 1);
});

test("computations recovery flushes the canvas and retains other option views", async () => {
  const mode = { ...MODES.comp, ontology: false };
  await mount(mode);
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => { throw new Error("full"); } });
  await act(async () => nodes()[0]!.data.onRename!("Unsaved computation"));
  await act(async () => vi.advanceTimersByTime(801));
  const older = JSON.parse(pendingSaves()[0]!.text);
  await act(async () => nodes()[0]!.data.onRename!("Latest computation"));
  const download = vi.spyOn(recovery, "downloadRecovery").mockImplementation(() => {});
  await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Download recovery copy")!.click());
  const entries = download.mock.calls[0]![0];
  // The exported file also passes restore validation.
  const restored = recovery.readRecovery(recovery.recoveryFile(entries));
  const state = JSON.parse(restored[0]!.text);
  expect(state.options).toHaveLength(older.options.length);
  for (const option of state.options) for (const view of ["terms", "dft", "fem"]) {
    if (option.id === state.current.option && view === state.current.view) expect(option.views[view]).toContain("Latest computation");
    else expect(option.views[view]).toBe(older.options.find((o: { id: string }) => o.id === option.id).views[view]);
  }
});


test("failed custom-pattern imports and removals survive remounting", async () => {
  await mount({ ...plain, patterns: true });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("blocked"); } });
  const input = container.querySelectorAll<HTMLInputElement>('input[accept=".mmd,.md,.txt"]')[1]!;
  for (const pattern of BUILT_IN.slice(0, 2)) {
    Object.defineProperty(input, "files", { configurable: true, value: [{ name: "pattern.mmd", text: async () => pattern.text }] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  }
  expect(container.querySelectorAll(".pattern-actions")).toHaveLength(2);
  expect(container.querySelector(".save-notice")!.textContent).toContain("Custom patterns");
  await act(async () => app.unmount());
  await mount({ ...plain, patterns: true });
  expect(container.querySelectorAll(".pattern-actions")).toHaveLength(2);
  await act(async () => container.querySelector<HTMLButtonElement>(".pattern-actions .danger-link")!.click());
  expect(container.querySelectorAll(".pattern-actions")).toHaveLength(1);
  await act(async () => app.unmount());
  await mount({ ...plain, patterns: true });
  expect(container.querySelectorAll(".pattern-actions")).toHaveLength(1);
  expect(container.querySelector(".save-notice")!.textContent).toContain("Custom patterns");
});


test.each(["frontmatter", "legacy source"])("pattern %s survives real import/save-failure/download/restore flow", async (kind) => {
  const mine = new Map<string, string>();
  const frontmatter = "---\ntitle: Imported pattern\nconfig:\n  theme: neutral\n---\n" + BUILT_IN[0]!.text;
  const legacy = BUILT_IN[0]!.text + "\nUnsupported old content!!!";
  if (kind === "legacy source") mine.set(MINE_KEY, JSON.stringify([legacy]));
  let fail = false;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => mine.get(key) ?? null,
    setItem: (key: string, value: string) => { if (fail) throw new Error("blocked"); mine.set(key, value); },
  });
  const mode = { ...plain, patterns: true };
  await mount(mode);
  fail = true;
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => { throw new Error("blocked"); } });
  const input = container.querySelectorAll<HTMLInputElement>('input[accept=".mmd,.md,.txt"]')[1]!;
  const imported = kind === "frontmatter" ? frontmatter : BUILT_IN[1]!.text;
  Object.defineProperty(input, "files", { value: [{ name: "pattern.mmd", text: async () => imported }] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await act(async () => nodes()[0]!.data.onRename!("Also recover this diagram"));
  await act(async () => vi.advanceTimersByTime(801));
  let blob: Blob | undefined;
  vi.spyOn(URL, "createObjectURL").mockImplementation((value) => { blob = value as Blob; return "blob:recovery"; });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Download recovery copy")!.click());
  expect(blob).toBeDefined();
  const backup = await blob!.text();
  expect(recovery.readRecovery(backup)).toHaveLength(2);
  await act(async () => app.unmount());
  // Simulate a reload: remove both the retained writes and all browser copies.
  fail = false;
  vi.stubGlobal("sessionStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
  retrySaves(); mine.clear(); storage.clear();
  await act(async () => { app = createRoot(container); app.render(createElement(Start, { onChoose: () => {} })); });
  const restoreInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(restoreInput, "files", { value: [{ name: "recovery.json", text: async () => backup }] });
  await act(async () => restoreInput.dispatchEvent(new Event("change", { bubbles: true })));
  if (kind === "legacy source") expect(container.textContent).toContain("source files needing repair");
  await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Restore this copy")!.click());
  expect(storage.get(mode.storageKey)).toContain("Also recover this diagram");
  expect(loadMine().some((p) => p.text === imported && !p.unavailable)).toBe(true);
  await act(async () => app.unmount());
  await mount(mode);
  expect(nodes()[0]!.data.name).toBe("Also recover this diagram");
  if (kind === "legacy source") {
    expect(loadMine().some((p) => p.text === legacy && !!p.unavailable)).toBe(true);
    expect(container.textContent).toContain("Needs repair:");
    expect(container.querySelector<HTMLButtonElement>("button.pattern:disabled")).not.toBeNull();
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Download original")!.click());
    expect(await blob!.text()).toBe(legacy);
  } else expect(loadMine()[0]!.text).toBe(frontmatter);
});

test("a new malformed custom-pattern import is rejected before saving", async () => {
  await mount({ ...plain, patterns: true });
  const write = vi.fn();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: write });
  const input = container.querySelectorAll<HTMLInputElement>('input[accept=".mmd,.md,.txt"]')[1]!;
  Object.defineProperty(input, "files", { value: [{ name: "broken.mmd", text: async () => BUILT_IN[0]!.text + "\nBroken content!!!" }] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(write).not.toHaveBeenCalled();
  expect(container.querySelectorAll(".pattern-actions")).toHaveLength(0);
  expect(container.textContent).toContain("Could not import pattern");
  expect(container.textContent).toContain("Unreadable diagram content");
});

test("a pattern file read finishing after unmount cannot overwrite restored patterns", async () => {
  const mine = new Map([[MINE_KEY, JSON.stringify([BUILT_IN[0]!.text])]]);
  const write = vi.fn((key: string, value: string) => { mine.set(key, value); });
  vi.stubGlobal("localStorage", { getItem: (key: string) => mine.get(key) ?? null, setItem: write });
  await mount({ ...plain, patterns: true });
  const pending = deferred<string>();
  const input = container.querySelectorAll<HTMLInputElement>('input[accept=".mmd,.md,.txt"]')[1]!;
  Object.defineProperty(input, "files", { value: [{ name: "late.mmd", text: () => pending.promise }] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await act(async () => app.unmount());

  const restored = JSON.stringify([BUILT_IN[1]!.text]);
  recovery.restoreRecovery(recovery.recoveryFile([{ area: "local", key: MINE_KEY, text: restored }]));
  write.mockClear();
  await act(async () => pending.resolve(BUILT_IN[2]!.text));

  expect(write).not.toHaveBeenCalled();
  expect(mine.get(MINE_KEY)).toBe(restored);
  expect(loadMine().map((pattern) => pattern.text)).toEqual([BUILT_IN[1]!.text]);
  expect(pendingSaves()).toHaveLength(0);
});


test("saved ontology diagrams open and persist edits while loading fails, then retry without replacing work", async () => {
  const loading = deferred<{ title: string }>();
  mocks.loadOntology.mockReturnValueOnce(loading.promise);
  storage.set(plain.storageKey, 'flowchart TB\nA["Saved<br/>TST_0000001"]');
  await mount({ ...plain, ontology: true });
  expect(nodes()[0]!.data.name).toBe("Saved");
  expect(mocks.supers).not.toHaveBeenCalled();
  await act(async () => nodes()[0]!.data.onRename!("Edited while loading"));
  await act(async () => vi.advanceTimersByTime(801));
  expect(storage.get(plain.storageKey)).toContain("Edited while loading");
  await act(async () => loading.reject(new Error("offline")));
  expect(container.querySelector(".status")!.textContent).toContain("offline");
  expect(mocks.check).not.toHaveBeenCalled();
  await act(async () => nodes()[0]!.data.onRename!("Edited offline"));
  await act(async () => vi.advanceTimersByTime(801));
  expect(storage.get(plain.storageKey)).toContain("Edited offline");
  mocks.check.mockResolvedValue({ result: { findings: [] } });
  await act(async () => container.querySelector<HTMLButtonElement>(".status")!.click());
  await act(async () => vi.advanceTimersByTime(301));
  expect(mocks.loadOntology).toHaveBeenCalledTimes(2);
  expect(nodes()[0]!.data.name).toBe("Edited offline");
  expect(container.querySelector(".status")!.textContent).toBe("Quick check: no problems");
});

test("pending and failed checks retain previous markers as stale until a successful recheck", async () => {
  mocks.check.mockResolvedValueOnce({ result: { findings: [
    { level: "error", message: "Old box error", nodeId: "A" },
    { level: "error", message: "Old arrow error", edgeIndex: 0 },
  ] } });
  await mount({ ...connected, ontology: true, patterns: true });
  await act(async () => vi.advanceTimersByTime(301));
  expect(nodes()[0]!.data.problems).toHaveLength(1);
  expect(mocks.flowProps.edges[0].data.problems).toHaveLength(1);
  const oldBoxProblems = nodes()[0]!.data.problems;
  const oldArrowProblems = mocks.flowProps.edges[0].data.problems;
  const pending = deferred<never>();
  mocks.check.mockReturnValueOnce(pending.promise);
  await act(async () => nodes()[0]!.data.onRename!("Changed"));
  expect(nodes()[0]!.data.problems).toBe(oldBoxProblems);
  expect(mocks.flowProps.edges[0].data.problems).toBe(oldArrowProblems);
  expect(container.querySelector(".status")!.classList.contains("unavailable")).toBe(true);
  expect(container.querySelector(".app")!.classList.contains("validation-stale")).toBe(true);
  expect(container.querySelector(".status")!.textContent).toContain("Previous markers shown");
  // More keystrokes keep the same marker data; no clearing and recreating node data.
  await act(async () => nodes()[0]!.data.onRename!("Changed again"));
  expect(nodes()[0]!.data.problems).toBe(oldBoxProblems);
  expect(mocks.flowProps.edges[0].data.problems).toBe(oldArrowProblems);
  await act(async () => vi.advanceTimersByTime(301));
  await act(async () => pending.reject(new Error("worker failed")));
  expect(nodes()[0]!.data.problems).toBe(oldBoxProblems);
  expect(mocks.flowProps.edges[0].data.problems).toBe(oldArrowProblems);
  expect(mocks.overviewProps.findings).toEqual([]);
  expect(mocks.overviewProps.passed).toEqual([]);
  expect(container.querySelector(".status")!.textContent).toContain("worker failed");
  expect(container.querySelector(".status")!.classList.contains("good")).toBe(false);
  mocks.check.mockResolvedValue({ result: { findings: [] } });
  await act(async () => container.querySelector<HTMLButtonElement>(".status")!.click());
  await act(async () => vi.advanceTimersByTime(301));
  expect(container.querySelector(".status")!.textContent).toBe("Quick check: no problems");
  expect(container.querySelector(".app")!.classList.contains("validation-stale")).toBe(false);
  expect(nodes()[0]!.data.problems).toEqual([]);
  expect(mocks.flowProps.edges[0].data.problems).toEqual([]);
});

test("option documents remain editable and saveable when initial ontology loading fails", async () => {
  const mode = { ...plain, options: true, ontology: true };
  const state = readState(null);
  const { option, view } = state.current;
  state.options.find((o) => o.id === option)!.views[view] = 'flowchart TB\nA["Saved option<br/>TST_0000001"]';
  storage.set(mode.storageKey, JSON.stringify(state));
  mocks.loadOntology.mockRejectedValueOnce(new Error("offline"));
  await mount(mode);
  expect(nodes()[0]!.data.name).toBe("Saved option");
  await act(async () => nodes()[0]!.data.onRename!("Edited option offline"));
  await act(async () => vi.advanceTimersByTime(801));
  const saved = readState(storage.get(mode.storageKey)!);
  expect(saved.options.find((o) => o.id === option)!.views[view]).toContain("Edited option offline");
  expect(mocks.check).not.toHaveBeenCalled();
});

test("arrow-only edits persist without an available ontology", async () => {
  mocks.loadOntology.mockRejectedValueOnce(new Error("offline"));
  await mount({ ...connected, ontology: true });
  const arrow = mocks.flowProps.edges[0];
  await act(async () => mocks.flowProps.onEdgesChange([{ type: "select", id: arrow.id, selected: true }]));
  await act(async () => mocks.arrowProps.onChange({ name: "offline relation", words: "offline relation" }));
  await act(async () => vi.advanceTimersByTime(801));
  expect(storage.get(plain.storageKey)).toContain("offline relation");
  expect(mocks.check).not.toHaveBeenCalled();
});

test("background classification preserves edits and cannot update a replacement document", async () => {
  const classification = deferred<string[][]>();
  mocks.supers.mockReturnValueOnce(classification.promise);
  mocks.check.mockResolvedValue({ result: { findings: [] } });
  const mode = { ...plain, ontology: true, examples: [{ title: "Classed", name: "classed.mmd",
    text: 'flowchart TB\nA["Original<br/>TST_0000001"]' }] };
  await mount(mode);
  await act(async () => nodes()[0]!.data.onRename!("Keep this edit"));
  await act(async () => classification.resolve([["COB_0000035"]]));
  expect(nodes()[0]!.data.name).toBe("Keep this edit");
  expect(nodes()[0]!.data.kind).toBe("process");
  await click("Undo");
  expect(nodes()[0]!.data.name).toBe("Original");
  expect(nodes()[0]!.data.kind).toBe("process");

  const late = deferred<string[][]>();
  mocks.supers.mockReturnValueOnce(late.promise);
  await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Classed")!.click());
  await click("New");
  await act(async () => late.resolve([["COB_0000035"]]));
  expect(nodes()).toEqual([]);
});

test("classifying an untouched example does not save it as user work", async () => {
  mocks.supers.mockResolvedValue([["COB_0000035"]]);
  mocks.check.mockResolvedValue({ result: { findings: [] } });
  await mount({ ...plain, ontology: true, examples: [{ title: "Classed", name: "classed.mmd",
    text: 'flowchart TB\nA["Original<br/>TST_0000001"]' }] });
  expect(nodes()[0]!.data.kind).toBe("process");
  await act(async () => vi.advanceTimersByTime(1000));
  expect(storage.has(plain.storageKey)).toBe(false);
});

test("recovery initiated elsewhere resumes automatic validation after initial loading fails", async () => {
  mocks.loadOntology.mockRejectedValueOnce(new Error("offline"));
  mocks.check.mockResolvedValue({ result: { findings: [] } });
  await mount({ ...plain, ontology: true });
  expect(container.querySelector(".status")!.textContent).toContain("offline");
  await act(async () => publishOntology({ status: "loading", error: "" }));
  await act(async () => publishOntology({ status: "ready", title: "Recovered ontology", revision: 1 }));
  await act(async () => vi.advanceTimersByTime(301));
  expect(mocks.check).toHaveBeenCalledTimes(1);
  expect(mocks.loadOntology).toHaveBeenCalledTimes(1); // No separate App retry.
  expect(container.querySelector(".status")!.textContent).toBe("Quick check: no problems");
  await act(async () => nodes()[0]!.data.onRename!("Still checking"));
  await act(async () => vi.advanceTimersByTime(301));
  expect(mocks.check).toHaveBeenCalledTimes(2);
});

test("an explicitly stored other shape is not automatically classified on open or recovery", async () => {
  storage.set(plain.storageKey, 'flowchart TB\nA["Deliberate shape<br/>TST_0000001"]\n%% mermantics-kinds {"A":"other"}');
  mocks.check.mockResolvedValue({ result: { findings: [] } });
  await mount({ ...plain, ontology: true });
  expect(nodes()[0]!.data.kind).toBe("other");
  expect(mocks.supers).not.toHaveBeenCalled();
  await act(async () => publishOntology({ status: "failed", error: "crash" }));
  await act(async () => publishOntology({ status: "ready", revision: 2, error: "" }));
  await act(async () => vi.advanceTimersByTime(301));
  expect(nodes()[0]!.data.kind).toBe("other");
  expect(mocks.supers).not.toHaveBeenCalled();
});

test("choosing other cancels pending import classification, including history amendments and retries", async () => {
  const pending = deferred<string[][]>();
  mocks.supers.mockReturnValueOnce(pending.promise);
  mocks.check.mockResolvedValue({ result: { findings: [] } });
  await mount({ ...plain, ontology: true, examples: [{ title: "Classed", name: "classed.mmd",
    text: 'flowchart TB\nA["Original<br/>TST_0000001"]' }] });
  await act(async () => mocks.flowProps.onNodesChange([{ type: "select", id: "A", selected: true }]));
  await act(async () => mocks.boxProps.onChange({ kind: "other" }));
  await act(async () => nodes()[0]!.data.onRename!("Renamed"));
  await act(async () => pending.resolve([["COB_0000035"]]));
  expect(nodes()[0]!.data.kind).toBe("other");
  await click("Undo");
  expect(nodes()[0]!.data.kind).toBe("other");
  await act(async () => publishOntology({ status: "failed", error: "crash" }));
  await act(async () => container.querySelector<HTMLButtonElement>(".status")!.click());
  expect(mocks.supers).toHaveBeenCalledTimes(1);
  expect(nodes()[0]!.data.kind).toBe("other");
});

test("a new ontology generation revalidates even when failure and recovery are batched", async () => {
  mocks.check.mockResolvedValue({ result: { findings: [] } });
  await mount({ ...plain, ontology: true });
  await act(async () => vi.advanceTimersByTime(301));
  expect(mocks.check).toHaveBeenCalledTimes(1);
  await act(async () => {
    publishOntology({ status: "failed", error: "crash" });
    publishOntology({ status: "ready", revision: 2, error: "" });
  });
  await act(async () => vi.advanceTimersByTime(301));
  expect(mocks.check).toHaveBeenCalledTimes(2);
});

for (const interrupted of ["offline", "still loading"]) {
  test(`autosaving while ontology is ${interrupted} preserves automatic classification after remount`, async () => {
    storage.set(plain.storageKey, 'flowchart TB\nA["Saved<br/>TST_0000001"]');
    const loading = deferred<{ title: string }>();
    if (interrupted === "offline") mocks.loadOntology.mockRejectedValueOnce(new Error("offline"));
    else mocks.loadOntology.mockReturnValueOnce(loading.promise);
    await mount({ ...plain, ontology: true });
    await act(async () => vi.advanceTimersByTime(801));
    const saved = storage.get(plain.storageKey)!;
    expect(saved).not.toContain('"A":"other"');
    expect(fromMermaid(saved).unclassified).toEqual(["A"]);
    await act(async () => app.unmount());
    mocks.supers.mockResolvedValue([["COB_0000035"]]);
    mocks.check.mockResolvedValue({ result: { findings: [] } });
    await mount({ ...plain, ontology: true });
    expect(mocks.supers).toHaveBeenCalledWith(["TST_0000001"], expect.any(AbortSignal));
    expect(nodes()[0]!.data.kind).toBe("process");
    await act(async () => vi.advanceTimersByTime(801));
    expect(storage.get(plain.storageKey)).toContain('"A":"process"');
  });
}

for (const explicit of [false, true]) {
  test(`export during ontology loading preserves ${explicit ? "an explicit other shape" : "pending classification"}`, async () => {
    storage.set(plain.storageKey, 'flowchart TB\nA["Saved<br/>TST_0000001"]');
    mocks.loadOntology.mockReturnValueOnce(deferred<{ title: string }>().promise);
    await mount({ ...plain, ontology: true });
    if (explicit) {
      await act(async () => mocks.flowProps.onNodesChange([{ type: "select", id: "A", selected: true }]));
      await act(async () => mocks.boxProps.onChange({ kind: "other" }));
    }
    let exported: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => { exported = blob as Blob; return "blob:export"; });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Mermaid diagram"))!.click());
    const text = await exported!.text();
    expect(fromMermaid(text).unclassified).toEqual(explicit ? [] : ["A"]);
    expect(text.includes('"A":"other"')).toBe(explicit);
  });
}

test("worker failures after loading are reported as checker unavailability", async () => {
  mocks.check.mockResolvedValue({ result: { findings: [] } });
  await mount({ ...plain, ontology: true });
  await act(async () => publishOntology({ status: "failed", error: "Checker worker timed out during check; try again" }));
  const status = container.querySelector(".status")!.textContent;
  expect(status).toContain("Checker unavailable:");
  expect(status).toContain("timed out during check");
  expect(status).not.toContain("Could not load the ontology");
});

test("timeout recovery offers a longer limit and keeps the current diagram", async () => {
  mocks.check.mockResolvedValue({ result: { findings: [] } });
  await mount({ ...plain, ontology: true });
  await act(async () => publishOntology({ status: "failed", timedOut: true, error: "Timed out" }));
  expect(container.querySelector(".status")!.textContent).toContain("Retry with 5 minutes");
  await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Retry with 5 minutes")!.click());
  expect(getOntologyState().timeoutMs).toBe(300_000);
  expect(mocks.loadOntology).toHaveBeenCalledTimes(2);
  expect(nodes()[0]!.data.name).toBe("Original");
  await act(async () => vi.advanceTimersByTime(301));
  expect(container.querySelector(".status")!.textContent).toBe("Quick check: no problems");
  const select = container.querySelector<HTMLSelectElement>('[aria-label="Checking time limit"]')!;
  expect(select.value).toBe("300000");
  await act(async () => { select.value = "600000"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(getOntologyState().timeoutMs).toBe(600_000);
});

for (const unavailable of ["loading", "offline"]) {
  test(`patterns insert and save while the ontology is ${unavailable}, then classify after recovery`, async () => {
    const loading = deferred<{ title: string }>();
    if (unavailable === "loading") mocks.loadOntology.mockReturnValueOnce(loading.promise);
    else mocks.loadOntology.mockRejectedValueOnce(new Error("offline"));
    mocks.check.mockResolvedValue({ result: { findings: [] } });
    await mount({ ...plain, ontology: true, patterns: true });
    await insertFirstPattern();
    const pending = nodes().filter((b) => b.data.autoClassify);
    expect(pending.length).toBeGreaterThan(0);
    expect(nodes().length).toBeGreaterThan(1);
    expect(mocks.supers).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Could not insert the pattern");
    await act(async () => vi.advanceTimersByTime(801));
    const saved = fromMermaid(storage.get(plain.storageKey)!);
    for (const box of pending) expect(saved.unclassified).toContain(box.id);

    mocks.supers.mockImplementation(async (ids: string[]) => ids.map(() => ["COB_0000035"]));
    if (unavailable === "loading") await act(async () => loading.resolve({ title: "Recovered ontology" }));
    else await act(async () => publishOntology({ status: "ready", title: "Recovered ontology", revision: 1, error: "" }));
    for (const box of pending) {
      const current = nodes().find((b) => b.id === box.id)!;
      expect(current.data.kind).toBe("process");
      expect(current.data.autoClassify).toBeUndefined();
    }
    await click("Undo");
    expect(nodes().map((b) => b.id)).toEqual(["A"]);
    await click("Redo");
    for (const box of pending) expect(nodes().find((b) => b.id === box.id)!.data.kind).toBe("process");
  });
}

test("patterns in a plain modelling section do not request ontology classification", async () => {
  await mount({ ...plain, patterns: true });
  await insertFirstPattern();
  expect(nodes().length).toBeGreaterThan(1);
  expect(mocks.supers).not.toHaveBeenCalled();
  expect(mocks.loadOntology).not.toHaveBeenCalled();
});

for (const outcome of ["success", "failure"]) {
  test(`a ready ontology cannot delay pattern placement, even when classification ends in ${outcome}`, async () => {
    mocks.check.mockResolvedValue({ result: { findings: [] } });
    await mount({ ...plain, ontology: true, patterns: true });
    expect(getOntologyState().status).toBe("ready");
    const classification = deferred<string[][]>();
    mocks.supers.mockReturnValueOnce(classification.promise);
    await insertFirstPattern();
    const inserted = nodes().filter((b) => b.data.autoClassify);
    expect(inserted.length).toBeGreaterThan(0);
    expect(mocks.supers).toHaveBeenCalledTimes(1);
    // Classification is still pending: placement and persistence must already work.
    await act(async () => vi.advanceTimersByTime(801));
    const saved = fromMermaid(storage.get(plain.storageKey)!);
    for (const box of inserted) expect(saved.unclassified).toContain(box.id);
    if (outcome === "success") {
      await act(async () => classification.resolve(inserted.map(() => ["COB_0000035"])));
      for (const box of inserted) expect(nodes().find((b) => b.id === box.id)!.data.kind).toBe("process");
    } else {
      await act(async () => classification.reject(new Error("worker crashed")));
      for (const box of inserted) expect(nodes().find((b) => b.id === box.id)!.data.autoClassify).toBe(box.data.classId);
      expect(container.textContent).toContain("Could not classify boxes: worker crashed");
    }
    expect(container.textContent).not.toContain("Could not insert the pattern");
    await click("Undo");
    expect(nodes().map((b) => b.id)).toEqual(["A"]);
  });
}

for (const failure of ["ontology unavailable", "lookup failed"]) {
  test(`manual class assignments persist and classify after recovery when ${failure}`, async () => {
    mocks.check.mockResolvedValue({ result: { findings: [] } });
    if (failure === "ontology unavailable") mocks.loadOntology.mockRejectedValueOnce(new Error("offline"));
    await mount({ ...plain, ontology: true });
    await act(async () => mocks.flowProps.onNodesChange([{ type: "select", id: "A", selected: true }]));
    if (failure === "lookup failed") mocks.supers.mockRejectedValueOnce(new Error("worker failed"));
    await act(async () => mocks.boxProps.onChange({ classId: "TST_0000001", classLabel: "chosen class" }));
    expect(nodes()[0]!.data.autoClassify).toBe("TST_0000001");
    expect(nodes()[0]!.data.kind).toBe("other");
    if (failure === "ontology unavailable") expect(mocks.supers).not.toHaveBeenCalled();
    else expect(container.textContent).toContain("Could not classify boxes: worker failed");
    await act(async () => vi.advanceTimersByTime(801));
    expect(fromMermaid(storage.get(plain.storageKey)!).unclassified).toEqual(["A"]);
    mocks.supers.mockResolvedValue([["COB_0000035"]]);
    await act(async () => publishOntology({ status: "ready", error: "", revision: 2 }));
    expect(nodes()[0]!.data.kind).toBe("process");
    expect(nodes()[0]!.data.autoClassify).toBeUndefined();
    await click("Undo");
    expect(nodes()[0]!.data.classId).toBe("");
    await click("Redo");
    expect(nodes()[0]!.data.kind).toBe("process");
  });
}

test("an explicit shape cancels manual classification and prevents recovery from overwriting it", async () => {
  mocks.check.mockResolvedValue({ result: { findings: [] } });
  await mount({ ...plain, ontology: true });
  await act(async () => mocks.flowProps.onNodesChange([{ type: "select", id: "A", selected: true }]));
  const pending = deferred<string[][]>();
  mocks.supers.mockReturnValueOnce(pending.promise);
  await act(async () => mocks.boxProps.onChange({ classId: "TST_0000001" }));
  const signal = mocks.supers.mock.lastCall![1] as AbortSignal;
  await act(async () => mocks.boxProps.onChange({ kind: "other" }));
  expect(signal.aborted).toBe(true);
  expect(nodes()[0]!.data.autoClassify).toBeUndefined();
  await act(async () => pending.resolve([["COB_0000035"]]));
  await act(async () => publishOntology({ status: "ready", revision: 2 }));
  expect(nodes()[0]!.data.kind).toBe("other");
  expect(mocks.supers).toHaveBeenCalledTimes(1);
});
