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
  for (const [r] of worker.postMessage.mock.calls.slice(1)) {
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

test("postMessage exceptions reject concurrent requests and permit retry", async () => {
  const worker = await loaded();
  const a = client.lookup(["A"]);
  const results = Promise.allSettled([a]);
  await vi.advanceTimersByTimeAsync(0);
  worker.postMessage.mockImplementationOnce(() => { throw new Error("send failed"); });
  await expect(client.supers(["B"])).rejects.toThrow("send failed");
  expect((await results)[0].status).toBe("rejected");
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
  const requests = worker.postMessage.mock.calls.slice(1).map(([r]) => r);
  worker.reply({ type: "error", id: requests[0]!.id, request: "terms", message: "bad request" });
  worker.reply({ type: "supers", id: requests[1]!.id, supers: [[]] });
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
