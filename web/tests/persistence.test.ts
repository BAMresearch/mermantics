// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { pendingSaves, readStored, retrySaves, subscribeSaves, writeStored } from "../src/canvas/persistence.js";
import { hasWork, saveDiagram, savedDiagram } from "../src/canvas/saved.js";
import { BUILT_IN, loadMine, MINE_KEY, saveMine } from "../src/canvas/patterns.js";
import { MODES } from "../src/canvas/mode.js";
import { freshState } from "../src/canvas/options.js";
import { downloadRecovery, readRecovery, recoveryFile, recoverySources, restoreRecovery } from "../src/canvas/recovery.js";
import { SaveNotice } from "../src/canvas/SaveNotice.js";
import { Start } from "../src/canvas/Start.js";

let session: Map<string, string>;
let local: Map<string, string>;
let failSession = false;
let failLocal = false;
let root: Root | undefined;
let container: HTMLDivElement;
const key = MODES.process.storageKey;
const diagram = 'flowchart TD\nA["Latest"]';
const pattern = { ...BUILT_IN[0]!, builtIn: false };

beforeEach(() => {
  session = new Map(); local = new Map(); failSession = false; failLocal = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => session.get(k) ?? null,
    setItem: (k: string, v: string) => { if (failSession) throw new DOMException("Full", "QuotaExceededError"); session.set(k, v); },
  });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => { if (failLocal) throw new DOMException("Blocked", "SecurityError"); local.set(k, v); },
  });
  container = document.createElement("div"); document.body.append(container);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; container.remove();
  failSession = false; failLocal = false; retrySaves();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const mount = async (component: typeof SaveNotice | typeof Start = SaveNotice, props = {}) => act(async () => {
  root = createRoot(container); root.render(createElement(component as typeof SaveNotice, props));
});
const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === text)!;

test("failed writes retain the latest value ahead of an older browser copy", () => {
  session.set(key, "old"); failSession = true;
  expect(saveDiagram(key, diagram)).toBe(false);
  saveDiagram(key, diagram + "\nB[New]");
  expect(session.get(key)).toBe("old");
  expect(savedDiagram(key)).toContain("B[New]");
  expect(pendingSaves()).toHaveLength(1);
  expect(hasWork()).toBe(true);
  failSession = false; retrySaves();
  expect(pendingSaves()).toHaveLength(0);
  expect(session.get(key)).toContain("B[New]");
});

test("unavailable storage still retains work and asks before leaving", () => {
  vi.stubGlobal("sessionStorage", undefined);
  expect(saveDiagram(key, diagram)).toBe(false);
  expect(savedDiagram(key)).toBe(diagram);
  expect(hasWork()).toBe(true);
  vi.stubGlobal("sessionStorage", { setItem: () => {} });
});

test("saving a diagram does not clear failed pattern additions or removals", () => {
  failLocal = true;
  saveMine([pattern]);
  expect(loadMine().map((p) => p.text)).toEqual([pattern.text]);
  saveDiagram(key, diagram);
  expect(pendingSaves().map((p) => p.key)).toEqual([MINE_KEY]);
  saveMine([]);
  expect(loadMine()).toEqual([]);
  expect(pendingSaves()[0]!.text).toBe("[]");
  failLocal = false; retrySaves();
  expect(local.get(MINE_KEY)).toBe("[]");
});

test("subscribers receive changes, without repeated notifications for the same failure", () => {
  failSession = true;
  const listener = vi.fn(); const stop = subscribeSaves(listener);
  saveDiagram(key, diagram); saveDiagram(key, diagram);
  expect(listener).toHaveBeenCalledTimes(1);
  saveDiagram(key, diagram + "\nB[New]");
  failSession = false; retrySaves();
  expect(listener).toHaveBeenCalledTimes(3);
  stop();
});

test("recovery round trip preserves all options, notes, diagrams and custom patterns", () => {
  failSession = true; failLocal = true;
  const state = freshState(); state.useCase.title = "Workshop";
  state.options[0]!.views.terms = diagram;
  state.options[1]!.why = "Reason for this choice";
  saveDiagram(MODES.comp.storageKey, JSON.stringify(state));
  saveDiagram(key, diagram); saveMine([pattern]);
  const backup = recoveryFile(pendingSaves());
  expect(readRecovery(backup)).toHaveLength(3);
  failSession = false; failLocal = false; retrySaves(); session.clear(); local.clear();
  restoreRecovery(backup);
  expect(JSON.parse(session.get(MODES.comp.storageKey)!)).toEqual(state);
  expect(savedDiagram(key)).toBe(diagram);
  expect(loadMine().map((p) => p.text)).toEqual([pattern.text]);
});

test("restoring with storage disabled retains the backup and the failure state", () => {
  failSession = true;
  restoreRecovery(recoveryFile([{ area: "session", key, text: diagram }]));
  expect(readStored("session", key)).toBe(diagram);
  expect(pendingSaves()).toHaveLength(1);
});

test.each([
  { format: "other", version: 1, entries: [] },
  { format: "mermantics-recovery", version: 3, entries: [] },
  { format: "mermantics-recovery", version: 1, entries: [{ area: "local", key: "unrelated", text: "bad" }] },
  { format: "mermantics-recovery", version: 1, entries: [{ area: "session", key: MODES.comp.storageKey, text: '{"options": []}' }] },
  { format: "mermantics-recovery", version: 1, entries: [{ area: "local", key: MINE_KEY, text: '["not a pattern"]' }] },
])("invalid recovery files cause no partial writes (%j)", (bad) => {
  const input = { ...bad, entries: [{ area: "session", key, text: diagram }, ...bad.entries] };
  expect(() => restoreRecovery(JSON.stringify(input))).toThrow("not a supported");
  expect(session.size + local.size).toBe(0);
  expect(pendingSaves()).toHaveLength(0);
});

test("persistent notice survives clicking, lists separate failures, and clears only successful retries", async () => {
  failSession = true; failLocal = true; saveDiagram(key, diagram); saveMine([pattern]);
  await mount();
  expect(container.textContent).toContain("Model anything, Custom patterns");
  await act(async () => container.querySelector<HTMLElement>(".save-notice")!.click());
  expect(container.textContent).toContain("could not be saved");
  failSession = false;
  await act(async () => button("Retry save").click());
  expect(container.textContent).toContain("Unsaved: Custom patterns.");
  failLocal = false;
  await act(async () => button("Retry save").click());
  expect(container.querySelector(".save-notice")).toBeNull();
});

test("start page validates and previews a backup before replacing work", async () => {
  session.set(key, "previous");
  await mount(Start, { onChoose: () => {} });
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [{ name: "recovery.json", text: async () => recoveryFile([{ area: "session", key, text: diagram }]) }] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(container.textContent).toContain("Restore Model anything?");
  expect(session.get(key)).toBe("previous");
  await act(async () => button("Restore this copy").click());
  expect(session.get(key)).toBe(diagram);
  expect(container.textContent).toContain("Recovery copy restored");
});

test("download contains the recoverable entries and leaves the failure visible", async () => {
  vi.useFakeTimers();
  try {
    failSession = true; saveDiagram(key, diagram);
    let blob: Blob | undefined;
    const url = vi.spyOn(URL, "createObjectURL").mockImplementation((value) => { blob = value as Blob; return "blob:recovery"; });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("mermantics-recovery.json");
    });
    await mount();
    await act(async () => button("Download recovery copy").click());
    expect(url).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce();
    expect(readRecovery(await blob!.text())).toEqual([{ area: "session", key, text: diagram }]);
    expect(container.textContent).toContain("could not be saved");
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith("blob:recovery");
  } finally { vi.useRealTimers(); }
});

test("failed recovery downloads report the problem without losing retained work", async () => {
  failSession = true; saveDiagram(key, diagram);
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => { throw new Error("download unavailable"); });
  await mount();
  await act(async () => button("Download recovery copy").click());
  expect(container.textContent).toContain("could not be downloaded");
  expect(savedDiagram(key)).toBe(diagram);
  expect(container.textContent).toContain("could not be saved");
});

test.each([
  "This is not a valid diagram!!!",
  'flowchart TB\nA["broken"',
  'flowchart TB\nA["First"]\nA["Overwritten"]',
  "flowchart TB\nA --> B", // recovery must not silently invent missing boxes
  "flowchart CORRUPTED",
  'flowchart TB\nsubgraph group\nA["Unclosed group"]',
  "flowchart TB\nend",
  "flowchart TB\nsubgraph\nend",
  "flowchart TB\ndirection CORRUPTED",
  'flowchart TB\n%% mermantics-layout {"Missing":[0,0]}',
  "%% only comments, no diagram",
  'flowchart TB\n%% mermantics-layout null',
  'flowchart TB\n%% mermantics-layout {"A":["bad",{}]}',
  'flowchart TB\n%% mermantics-layout {"A":[1e400,0]}',
  'flowchart TB\n%% mermantics-layout {"A":[0]}',
  'flowchart TB\n%% mermantics-layout {broken',
  'flowchart TB\n%% mermantics-usecase null',
  'flowchart TB\n%% mermantics-usecase {"title":"lost notes"}',
  'flowchart TB\n%% mermantics-kinds {"A":42}',
  'flowchart TB\n%% mermantics-kind-names []',
  'flowchart TB\n%% mermantics-pattern-uses [null]',
  'flowchart TB\n%% mermantics-layout {}\n%% mermantics-layout {}',
])("corrupt diagram or computation view cannot overwrite any stored work (%s)", (text) => {
  session.set(key, diagram);
  session.set(MODES.datastore.storageKey, diagram);
  const options = freshState();
  options.options[0]!.views.terms = text;
  for (const entry of [
    { area: "session" as const, key, text },
    { area: "session" as const, key: MODES.comp.storageKey, text: JSON.stringify(options) },
  ]) {
    const backup = recoveryFile([
      { area: "session", key: MODES.datastore.storageKey, text: 'flowchart TB\nB["Replacement"]' }, entry,
    ]);
    expect(() => restoreRecovery(backup)).toThrow("not a supported");
    expect(session.get(key)).toBe(diagram);
    expect(session.get(MODES.datastore.storageKey)).toBe(diagram);
    expect(session.has(MODES.comp.storageKey)).toBe(false);
    expect(pendingSaves()).toHaveLength(0);
  }
});

test.each([
  [pattern.text, pattern.text],
  [pattern.text + '\nThis is not a valid diagram!!!'],
  [pattern.text + '\n%% mermantics-usecase null'],
  [pattern.text.replace(/"questions":\[[^\]]*\]/, '"questions":42')],
].map((texts) => ({ texts })))("malformed or duplicate custom patterns cannot replace a valid collection", ({ texts }) => {
  saveMine([pattern]);
  const before = local.get(MINE_KEY);
  expect(() => restoreRecovery(recoveryFile([{ area: "local", key: MINE_KEY, text: JSON.stringify(texts) }]))).toThrow();
  expect(local.get(MINE_KEY)).toBe(before);
});

test("validating a corrupt backup also preserves pending in-memory work", () => {
  failSession = true;
  saveDiagram(key, diagram);
  expect(() => restoreRecovery(recoveryFile([{ area: "session", key, text: "corrupt content!" }]))).toThrow();
  expect(savedDiagram(key)).toBe(diagram);
  expect(pendingSaves()).toEqual([{ area: "session", key, text: diagram }]);
});

const deferredRead = () => {
  let resolve!: (text: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
};
const selectRecovery = async (name: string, read: Promise<string>) => act(async () => {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [{ name, text: () => read }] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
});

test.each(["success", "failure"])("late file A %s cannot replace file B's recovery preview", async (outcome) => {
  await mount(Start, { onChoose: () => {} });
  const first = deferredRead(); const second = deferredRead();
  await selectRecovery("A.json", first.promise);
  await selectRecovery("B.json", second.promise);
  const backup = recoveryFile([{ area: "session", key, text: diagram }]);
  await act(async () => second.resolve(backup));
  expect(container.textContent).toContain("Selected file: B.json");
  await act(async () => outcome === "success"
    ? first.resolve(recoveryFile([{ area: "session", key, text: 'flowchart TB\nWrong["Wrong"]' }]))
    : first.reject(new Error("Stale read error")));
  expect(container.textContent).toContain("Selected file: B.json");
  expect(container.textContent).not.toContain("A.json");
  expect(container.textContent).not.toContain("Stale read error");
  await act(async () => button("Restore this copy").click());
  expect(session.get(key)).toBe(diagram);
});

test("a newer invalid file leaves no older backup available to restore", async () => {
  await mount(Start, { onChoose: () => {} });
  const first = deferredRead();
  await selectRecovery("A.json", first.promise);
  await selectRecovery("broken.json", Promise.resolve("not JSON"));
  await act(async () => first.resolve(recoveryFile([{ area: "session", key, text: diagram }])));
  expect(button("Restore this copy")).toBeUndefined();
  expect(container.textContent).toContain("not a supported");
  expect(session.size).toBe(0);
});


test("downloads preserve legacy pattern source and duplicate IDs without blocking other entries", async () => {
  vi.useFakeTimers();
  try {
    failLocal = true; failSession = true;
    const legacy = pattern.text + "\nUnsupported old content!!!";
    writeStored("local", MINE_KEY, JSON.stringify([legacy, pattern.text]));
    saveDiagram(key, diagram);
    let blob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((value) => { blob = value as Blob; return "blob:recovery"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadRecovery(pendingSaves());
    const text = await blob!.text();
    const entries = readRecovery(text);
    expect(JSON.parse(text).version).toBe(2);
    expect(recoverySources(entries)).toHaveLength(1);
    failLocal = false; failSession = false; retrySaves(); local.clear(); session.clear();
    restoreRecovery(text);
    expect(savedDiagram(key)).toBe(diagram);
    expect(loadMine().map((p) => p.text)).toEqual([legacy, pattern.text]);
    expect(new Set(loadMine().map((p) => p.id)).size).toBe(2);
    vi.advanceTimersByTime(60_000);
  } finally { vi.useRealTimers(); }
});

test("recovery errors identify the section, option/view, or pattern and retain the reason", () => {
  const invalid = 'flowchart TB\n%% mermantics-layout null';
  expect(() => readRecovery(recoveryFile([{ area: "session", key, text: invalid }]))).toThrow(/Model anything: Invalid mermantics-layout/);
  expect(() => readRecovery(recoveryFile([{ area: "local", key: MINE_KEY,
    text: JSON.stringify([pattern.text + "\n%% mermantics-usecase null"]) }]))).toThrow(/Custom patterns:.*Invalid mermantics-usecase/);
  const options = freshState();
  options.options[0]!.title = "My option";
  options.options[0]!.views.terms = invalid;
  expect(() => readRecovery(recoveryFile([{ area: "session", key: MODES.comp.storageKey, text: JSON.stringify(options) }]))).toThrow(/My option \/ Terms: Invalid mermantics-layout/);
});
