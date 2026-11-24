// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Request, Response } from "../src/worker/protocol.js";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<Response>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn<(request: Request) => void>();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  reply(message: Response) { this.onmessage?.({ data: message } as MessageEvent<Response>); }
  request() { return this.postMessage.mock.calls.at(-1)![0]; }
}

let client: typeof import("../src/canvas/checker.js");
const info = { name: "test", title: "Test", version: "1", triples: 1, terms: 1, ms: 1 };
const latest = () => FakeWorker.instances.at(-1)!;
async function loaded() {
  const loading = client.loadOntology();
  const worker = latest();
  worker.reply({ type: "loaded", id: worker.request().id, ontology: info });
  await loading;
  return worker;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  client = await import("../src/canvas/checker.js");
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

test("starts lazily and shares ontology loading before dependent requests", async () => {
  expect(FakeWorker.instances).toHaveLength(0);
  const a = client.lookup(["A"]);
  const b = client.supers(["B"]);
  const worker = latest();
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  worker.reply({ type: "loaded", id: worker.request().id, ontology: info });
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 2; i++) {
    const r = worker.request();
    if (r.type === "terms") worker.reply({ type: "terms", id: r.id, terms: [null] });
    if (r.type === "supers") worker.reply({ type: "supers", id: r.id, supers: [[]] });
  }
  await expect(a).resolves.toEqual([null]);
  await expect(b).resolves.toEqual([[]]);
  expect(vi.getTimerCount()).toBe(0);
});

for (const failure of ["error", "messageerror", "timeout"] as const) {
  test(`${failure} rejects all requests and reloads ontology on the next request`, async () => {
    const old = await loaded();
    const a = client.lookup(["A"]);
    const b = client.supers(["B"]);
    const outcomes = Promise.allSettled([a, b]);
    await vi.advanceTimersByTimeAsync(0);
    const staleMessage = old.onmessage!;
    const staleError = old.onerror!;
    if (failure === "error") old.onerror!(new ErrorEvent("error", { message: "crashed" }));
    if (failure === "messageerror") old.onmessageerror!();
    if (failure === "timeout") await vi.advanceTimersByTimeAsync(120_000);
    expect((await outcomes).map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(old.terminate).toHaveBeenCalledOnce();
    expect(old.onmessage).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    const retry = client.lookup(["A"]);
    const fresh = latest();
    expect(fresh).not.toBe(old);
    expect(fresh.request().type).toBe("load");
    staleMessage({ data: { type: "loaded", id: fresh.request().id, ontology: info } } as MessageEvent<Response>);
    staleError(new ErrorEvent("error"));
    expect(fresh.terminate).not.toHaveBeenCalled();
    expect(fresh.postMessage).toHaveBeenCalledTimes(1);
    fresh.reply({ type: "loaded", id: fresh.request().id, ontology: info });
    await vi.advanceTimersByTimeAsync(0);
    expect(fresh.request().type).toBe("terms");
    fresh.reply({ type: "terms", id: fresh.request().id, terms: [null] });
    await expect(retry).resolves.toEqual([null]);
    expect(vi.getTimerCount()).toBe(0);
  });
}

test("startup failure rejects loading and permits retry", async () => {
  const loading = client.loadOntology();
  const rejected = expect(loading).rejects.toThrow("startup failed");
  latest().onerror!(new ErrorEvent("error", { message: "startup failed" }));
  await rejected;
  await loaded();
  expect(FakeWorker.instances).toHaveLength(2);
});

test("constructor exceptions leave no pending timers and permit retry", async () => {
  vi.stubGlobal("Worker", class { constructor() { throw new Error("construction failed"); } });
  await expect(client.loadOntology()).rejects.toThrow("construction failed");
  expect(vi.getTimerCount()).toBe(0);
  vi.stubGlobal("Worker", FakeWorker);
  await loaded();
});

test("postMessage exceptions reject waiting requests and permit retry", async () => {
  const worker = await loaded();
  const a = client.lookup(["A"]);
  const b = client.supers(["B"]);
  const c = client.lookup(["C"]);
  const results = Promise.allSettled([b, c]);
  await vi.advanceTimersByTimeAsync(0);
  worker.postMessage.mockImplementationOnce(() => { throw new Error("send failed"); });
  worker.reply({ type: "terms", id: worker.request().id, terms: [null] });
  await a;
  expect((await results).map((r) => r.status)).toEqual(["rejected", "rejected"]);
  expect(vi.getTimerCount()).toBe(0);
  await loaded();
  expect(FakeWorker.instances).toHaveLength(2);
});

test("concurrent calls cannot send to an unloaded replacement after a synchronous failure", async () => {
  const worker = await loaded();
  worker.postMessage.mockImplementationOnce(() => { throw new Error("send failed"); });
  const results = await Promise.allSettled([client.lookup(["A"]), client.supers(["B"])]);
  expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
  expect(FakeWorker.instances).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
  await loaded();
});

test("protocol errors reject only their request and clear its timer", async () => {
  const worker = await loaded();
  const a = client.lookup(["A"]);
  const b = client.supers(["B"]);
  const rejected = expect(a).rejects.toThrow("bad request");
  await vi.advanceTimersByTimeAsync(0);
  worker.reply({ type: "error", id: worker.request().id, request: "terms", message: "bad request" });
  worker.reply({ type: "supers", id: worker.request().id, supers: [[]] });
  await rejected;
  await expect(b).resolves.toEqual([[]]);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(worker.terminate).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("failed ontology responses can be retried on the existing worker", async () => {
  const loading = client.loadOntology();
  const rejected = expect(loading).rejects.toThrow("download failed");
  const worker = latest();
  worker.reply({ type: "error", id: worker.request().id, request: "load", message: "download failed" });
  await rejected;
  await loaded();
  expect(FakeWorker.instances).toHaveLength(1);
});

test("a stalled ontology load rejects dependent calls and permits retry", async () => {
  const results = Promise.allSettled([client.loadOntology(), client.check("flowchart TB"), client.search("test", [])]);
  const worker = latest();
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(120_000);
  for (const result of await results) {
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason.message).toContain("timed out during load");
  }
  expect(vi.getTimerCount()).toBe(0);
  await loaded();
  expect(FakeWorker.instances).toHaveLength(2);
});


test.each([null, {}, { id: "1", type: "loaded" }, { id: 0, type: "loaded" },
  { id: 1, type: "unexpected" }, { id: 1, type: "error", message: null }])(
  "invalid response envelope %j fails immediately and permits recovery", async (message) => {
    const loading = client.loadOntology();
    const rejected = expect(loading).rejects.toThrow("Invalid checker worker response");
    latest().reply(message as unknown as Response);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    await loaded();
    expect(FakeWorker.instances).toHaveLength(2);
  });

test("ontology subscribers observe failures and recovery initiated by a search", async () => {
  const seen: string[] = [];
  const unsubscribe = client.subscribeOntology(() => seen.push(client.getOntologyState().status));
  expect(client.getOntologyState().status).toBe("idle");
  const initial = client.loadOntology();
  const rejected = expect(initial).rejects.toThrow("offline");
  latest().onerror!(new ErrorEvent("error", { message: "offline" }));
  await rejected;
  expect(client.getOntologyState()).toMatchObject({ status: "failed", error: "offline", revision: 0 });
  const search = client.search("Material", []);
  const fresh = latest();
  fresh.reply({ type: "loaded", id: fresh.request().id, ontology: info });
  await vi.advanceTimersByTimeAsync(0);
  expect(client.getOntologyState()).toMatchObject({ status: "ready", title: info.title, error: "", revision: 1 });
  fresh.reply({ type: "found", id: fresh.request().id, result: { terms: [], total: 0 } });
  await search;
  expect(seen).toEqual(["loading", "failed", "loading", "ready"]);
  unsubscribe();
  fresh.onerror!(new ErrorEvent("error", { message: "crashed while idle" }));
  expect(client.getOntologyState().status).toBe("failed");
  expect(seen).toHaveLength(4);
});

test("a load response queued just before a crash cannot announce a recovered worker", async () => {
  const loading = client.loadOntology();
  const rejected = expect(loading).rejects.toThrow("stopped");
  const worker = latest();
  worker.reply({ type: "loaded", id: worker.request().id, ontology: info });
  worker.onerror!(new ErrorEvent("error", { message: "crash" }));
  await rejected;
  expect(client.getOntologyState()).toMatchObject({ status: "failed", revision: 0 });
  await loaded();
  expect(client.getOntologyState()).toMatchObject({ status: "ready", revision: 1 });
});

test("waiting in the client queue does not consume an operation's timeout", async () => {
  const worker = await loaded();
  const a = client.lookup(["A"]);
  const b = client.supers(["B"]);
  await vi.advanceTimersByTimeAsync(110_000);
  expect(worker.request().type).toBe("terms");
  expect(worker.postMessage).toHaveBeenCalledTimes(2); // load and the active lookup
  worker.reply({ type: "terms", id: worker.request().id, terms: [null] });
  await a;
  expect(worker.request().type).toBe("supers");
  await vi.advanceTimersByTimeAsync(110_000);
  expect(worker.terminate).not.toHaveBeenCalled();
  worker.reply({ type: "supers", id: worker.request().id, supers: [[]] });
  await expect(b).resolves.toEqual([[]]);
  expect(vi.getTimerCount()).toBe(0);
});

test("background checks keep only the newest waiting diagram and preserve explicit checks", async () => {
  const worker = await loaded();
  const a = client.check("active", { latest: true });
  await vi.advanceTimersByTimeAsync(0);
  const b = client.check("obsolete", { latest: true });
  const c = client.check("comparison");
  const d = client.check("newest", { latest: true });
  const results = Promise.allSettled([a, b, c, d]);
  await vi.advanceTimersByTimeAsync(0);
  const sent: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = worker.request();
    if (r.type !== "check") throw new Error("expected check");
    sent.push(r.text);
    worker.reply({ type: "checked", id: r.id, checked: {} as import("../src/worker/protocol.js").Checked });
  }
  expect(sent).toEqual(["active", "comparison", "newest"]);
  expect((await results).map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled", "fulfilled"]);
  expect(vi.getTimerCount()).toBe(0);
});

for (const initial of ["loaded", "loading"]) {
  test(`dependent calls follow an existing recovery after the previous worker was ${initial}`, async () => {
    if (initial === "loaded") await loaded();
    const lookup = client.lookup(["A"]);
    const old = latest();
    old.onerror!(new ErrorEvent("error", { message: "crash" }));
    const recovery = client.loadOntology();
    const fresh = latest();
    await vi.advanceTimersByTimeAsync(0);
    expect(fresh.request().type).toBe("load");
    fresh.reply({ type: "loaded", id: fresh.request().id, ontology: info });
    await recovery;
    await vi.advanceTimersByTimeAsync(0);
    expect(fresh.request().type).toBe("terms");
    fresh.reply({ type: "terms", id: fresh.request().id, terms: [null] });
    await expect(lookup).resolves.toEqual([null]);
  });
}

test("an older background check resuming after recovery cannot supersede the newest diagram", async () => {
  const old = client.check("old", { latest: true });
  latest().onerror!(new ErrorEvent("error", { message: "crash" }));
  const recovery = client.loadOntology();
  const newest = client.check("newest", { latest: true });
  const results = Promise.allSettled([old, newest]);
  const worker = latest();
  worker.reply({ type: "loaded", id: worker.request().id, ontology: info });
  await recovery;
  await vi.advanceTimersByTimeAsync(0);
  expect(worker.request()).toMatchObject({ type: "check", text: "newest" });
  worker.reply({ type: "checked", id: worker.request().id, checked: {} as import("../src/worker/protocol.js").Checked });
  expect((await results).map((r) => r.status)).toEqual(["rejected", "fulfilled"]);
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
});

test("a longer limit lets a slow ontology load and check finish past two minutes", async () => {
  client.setRequestTimeout(300_000);
  const loading = client.loadOntology();
  const worker = latest();
  await vi.advanceTimersByTimeAsync(120_001);
  expect(worker.terminate).not.toHaveBeenCalled();
  worker.reply({ type: "loaded", id: worker.request().id, ontology: info });
  await loading;
  const checking = client.check("slow diagram");
  await vi.advanceTimersByTimeAsync(120_001);
  expect(worker.terminate).not.toHaveBeenCalled();
  worker.reply({ type: "checked", id: worker.request().id, checked: {} as import("../src/worker/protocol.js").Checked });
  await checking;
  expect(vi.getTimerCount()).toBe(0);
});

test("changing the limit affects future dispatches, and timeouts remain finite", async () => {
  const loading = client.loadOntology();
  const rejected = expect(loading).rejects.toThrow("after 2 minutes");
  client.setRequestTimeout(300_000);
  await vi.advanceTimersByTimeAsync(120_000);
  await rejected;
  expect(client.getOntologyState()).toMatchObject({ timedOut: true, timeoutMs: 300_000 });
  const retry = client.loadOntology();
  const failedRetry = expect(retry).rejects.toThrow("after 5 minutes");
  expect(client.getOntologyState().timedOut).toBe(false);
  await vi.advanceTimersByTimeAsync(299_999);
  expect(latest().terminate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await failedRetry;
  expect(latest().terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

test.each([0, -1, NaN, Infinity, 121_000, 3_600_001])("invalid time limit %s cannot disable failure detection", (ms) => {
  expect(() => client.setRequestTimeout(ms)).toThrow("Unsupported checking time limit");
  expect(client.getOntologyState().timeoutMs).toBe(120_000);
  expect(FakeWorker.instances).toHaveLength(0);
});

test("obsolete queued searches and classification requests never reach the worker", async () => {
  const worker = await loaded();
  const active = client.check("long check");
  await vi.advanceTimersByTimeAsync(0);
  const searches = new AbortController();
  const classification = new AbortController();
  const oldSearch = client.search("old query", [], 12, searches.signal);
  const oldClasses = client.supers(["OldClass"], classification.signal);
  const cancelled = Promise.allSettled([oldSearch, oldClasses]);
  await vi.advanceTimersByTimeAsync(0);
  searches.abort(); classification.abort();
  for (const result of await cancelled) {
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason.name).toBe("AbortError");
  }
  const current = client.search("current query", []);
  await vi.advanceTimersByTimeAsync(0);
  worker.reply({ type: "checked", id: worker.request().id, checked: {} as import("../src/worker/protocol.js").Checked });
  await active;
  expect(worker.request()).toMatchObject({ type: "search", query: "current query" });
  expect(worker.postMessage).toHaveBeenCalledTimes(3); // load, check, current search
  worker.reply({ type: "found", id: worker.request().id, result: { terms: [], total: 0 } });
  await current;
  expect(vi.getTimerCount()).toBe(0);
});

test("cancelling during ontology loading settles immediately without cancelling the shared load", async () => {
  const controller = new AbortController();
  const old = client.search("old", [], 12, controller.signal);
  const rejected = expect(old).rejects.toMatchObject({ name: "AbortError" });
  const loading = client.loadOntology();
  controller.abort();
  await rejected;
  const worker = latest();
  expect(worker.terminate).not.toHaveBeenCalled();
  worker.reply({ type: "loaded", id: worker.request().id, ontology: info });
  await loading;
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("cancelling active work releases its caller but keeps serial dispatch until its response", async () => {
  const worker = await loaded();
  const controller = new AbortController();
  const active = client.search("old", [], 12, controller.signal);
  const rejected = expect(active).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0);
  const next = client.supers(["Next"]);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await rejected;
  expect(worker.request().type).toBe("search");
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(1);
  worker.reply({ type: "found", id: worker.request().id, result: { terms: [], total: 0 } });
  expect(worker.request().type).toBe("supers");
  worker.reply({ type: "supers", id: worker.request().id, supers: [[]] });
  await next;
  expect(worker.terminate).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("a pre-cancelled request never starts the worker", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(client.search("old", [], 12, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  await expect(client.supers(["Old"], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(FakeWorker.instances).toHaveLength(0);
});

for (const outcome of ["success", "failure"]) {
  test(`${outcome} removes cancellation listeners`, async () => {
    const worker = await loaded();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const request = client.supers(["A"], controller.signal);
    const result = Promise.allSettled([request]);
    await vi.advanceTimersByTimeAsync(0);
    if (outcome === "success") worker.reply({ type: "supers", id: worker.request().id, supers: [[]] });
    else worker.onerror!(new ErrorEvent("error", { message: "crash" }));
    await result;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
}

test("a cancelled active operation still has a watchdog for callers queued behind it", async () => {
  const worker = await loaded();
  const controller = new AbortController();
  const active = client.search("old", [], 12, controller.signal);
  const cancelled = expect(active).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0);
  const waiting = client.lookup(["Next"]);
  const timedOut = expect(waiting).rejects.toThrow("timed out during search");
  controller.abort();
  await cancelled;
  await vi.advanceTimersByTimeAsync(120_000);
  await timedOut;
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
