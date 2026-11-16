// @vitest-environment happy-dom
/** Real App callbacks/effects in a DOM; React Flow and layout are controlled test doubles. */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Box } from "../src/canvas/model.js";

const mocks = vi.hoisted(() => ({ layout: vi.fn(), check: vi.fn(), supers: vi.fn(), fit: vi.fn(), initialized: false, cloneOnSet: false, nodes: [] as Box[], flowProps: {} as any, optionProps: {} as any, panelProps: {} as any }));
vi.mock("../src/canvas/layout.js", () => ({ layout: mocks.layout }));
vi.mock("@xyflow/react", async () => {
  const { useState, useCallback } = await import("react");
  return {
    Background: () => null, MiniMap: () => null,
    ConnectionMode: { Loose: "loose" }, SelectionMode: { Full: "full" }, MarkerType: { ArrowClosed: "closed" },
    ReactFlow: (props: any) => { mocks.nodes = props.nodes; mocks.flowProps = props; return null; },
    useReactFlow: () => flow,
    useNodesInitialized: () => mocks.initialized,
    useNodesState: (initial: Box[]) => {
      const [nodes, setNodes] = useState(initial);
      const set = useCallback((update: import("react").SetStateAction<Box[]>) => setNodes((previous) => {
        const next = typeof update === "function" ? update(previous) : update;
        return mocks.cloneOnSet ? next.map((b) => ({ ...b, measured: { width: 220, height: 90 } })) : next;
      }), []);
      return [nodes, set, (changes: { id: string; position: { x: number; y: number } }[]) =>
        setNodes((bs) => bs.map((b) => ({ ...b, position: changes.find((c) => c.id === b.id)?.position ?? b.position })))];
    },
    useEdgesState: (initial: unknown[]) => { const [edges, setEdges] = useState(initial); return [edges, setEdges, () => {}]; },
  };
});
const flow = { fitView: mocks.fit, screenToFlowPosition: (p: unknown) => p };
vi.mock("../src/canvas/media.js", () => ({ NARROW: "", TOUCH: "", useMedia: () => false }));
vi.mock("../src/canvas/checker.js", () => ({ check: mocks.check, supers: mocks.supers, loadOntology: vi.fn(async () => ({ title: "Test ontology" })) }));
vi.mock("../src/canvas/ZoomBar.js", () => ({ ZoomBar: () => null, loadWheelMode: () => "move", saveWheelMode: () => {} }));
vi.mock("../src/canvas/BoxNode.js", () => ({ BoxNode: () => null, worst: () => null }));
vi.mock("../src/canvas/FloatingEdge.js", () => ({ FloatingEdge: () => null }));
vi.mock("../src/canvas/OpenbisLane.js", () => ({ LaneNode: () => null }));
vi.mock("../src/canvas/Details.js", () => ({
  Overview: () => null, ArrowDetails: () => null, BoxDetails: () => null, SelectionPanel: () => null,
}));
vi.mock("../src/canvas/Options.js", () => ({
  OptionBar: (props: object) => { mocks.optionProps = props; return null; }, OptionPanel: (props: object) => { mocks.panelProps = props; return null; },
  Compare: () => null, TermsTree: () => null, checkStatus: vi.fn(),
}));
vi.mock("../src/canvas/ToolbarMenu.js", () => ({
  ToolbarIcon: () => null, ToolbarMenu: ({ children }: { children: import("react").ReactNode }) => children,
}));

import { App } from "../src/canvas/App.js";
import { MODES, type Mode } from "../src/canvas/mode.js";
import { readState } from "../src/canvas/options.js";
import { fromMermaid } from "../src/canvas/model.js";

let app: Root;
let container: HTMLDivElement;
let frames: FrameRequestCallback[];
let storage: Map<string, string>;
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
