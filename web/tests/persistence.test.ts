// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { pendingSaves, readStored, retrySaves, subscribeSaves, writeStored } from "../src/canvas/persistence.js";
import { hasWork, saveDiagram, savedDiagram } from "../src/canvas/saved.js";
import { BUILT_IN, loadMine, MINE_KEY, saveMine } from "../src/canvas/patterns.js";
import { MODES } from "../src/canvas/mode.js";
import { freshState } from "../src/canvas/options.js";
import { readRecovery, recoveryFile, restoreRecovery } from "../src/canvas/recovery.js";
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
  { format: "mermantics-recovery", version: 2, entries: [] },
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
  Object.defineProperty(input, "files", { value: [{ text: async () => recoveryFile([{ area: "session", key, text: diagram }]) }] });
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
