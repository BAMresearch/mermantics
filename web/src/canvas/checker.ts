/** Talks to the checker worker with promises. */

import type { RelationFit } from "../core/relations.js";
import type { SearchResult, Term } from "../core/terms.js";
import type { Checked, OntologyInfo, Request, Response, TreeNode } from "../worker/protocol.js";

type Pending = { resolve: (r: Response) => void; reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout> | null; request: Request; latest: boolean };
type Body<T extends Request["type"]> = Omit<Extract<Request, { type: T }>, "id">;

const pending = new Map<number, Pending>();
let nextId = 1;
let activeId: number | null = null;
let latestCheck = 0;
let worker: Worker | null = null;
let ontology: Promise<OntologyInfo> | null = null;
export type OntologyState = {
  status: "idle" | "loading" | "ready" | "failed";
  title: string;
  error: string;
  revision: number; // advances only after a successful load
  timeoutMs: number;
  timedOut: boolean;
};
let ontologyState: OntologyState = { status: "idle", title: "", error: "", revision: 0, timeoutMs: 120_000, timedOut: false };
const listeners = new Set<() => void>();
export const getOntologyState = () => ontologyState;
export function subscribeOntology(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publishOntology(patch: Partial<OntologyState>): void {
  ontologyState = { ...ontologyState, ...patch };
  for (const listener of listeners) listener();
}
// The timeout covers dispatched work only, never time waiting in the client queue.
// A single operation still has a finite limit to detect an unresponsive worker.
export const CHECK_TIMEOUTS: readonly number[] = [120_000, 300_000, 600_000, 1_800_000, 3_600_000];
/** Applies to future dispatches in this tab; an active operation keeps its existing deadline. */
export function setRequestTimeout(timeoutMs: number): void {
  if (!CHECK_TIMEOUTS.includes(timeoutMs)) throw new Error("Unsupported checking time limit");
  publishOntology({ timeoutMs });
}
class WorkerTimeoutError extends Error {}

const RESPONSE_TYPES = new Set<Response["type"]>(["loaded", "checked", "found", "terms", "relations", "supers", "tree", "error"]);
/** Validate the envelope at the runtime boundary; payloads remain protocol-owned. */
function isResponse(value: unknown): value is Response {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<Response>;
  return Number.isSafeInteger(r.id) && r.id! > 0 && RESPONSE_TYPES.has(r.type!)
    && (r.type !== "error" || typeof r.message === "string");
}

function failWorker(current: Worker, error: Error): void {
  if (worker !== current) return;
  worker = null;
  ontology = null;
  current.onmessage = current.onerror = current.onmessageerror = null;
  current.terminate();
  for (const p of pending.values()) {
    if (p.timer !== null) clearTimeout(p.timer);
    p.reject(error);
  }
  pending.clear();
  activeId = null;
  publishOntology({ status: "failed", error: error.message, timedOut: error instanceof WorkerTimeoutError });
}

/** The worker starts when it is first needed, so process modelling (no ontology) never starts it. */
function getWorker(): Worker {
  if (worker) return worker;
  const current = new Worker(new URL("../worker/checker.worker.ts", import.meta.url), { type: "module" });
  worker = current;
  current.onerror = (event) => {
    event.preventDefault();
    failWorker(current, new Error(event.message || "Checker worker failed"));
  };
  current.onmessageerror = () => failWorker(current, new Error("Could not read the checker worker response"));
  current.onmessage = (event: MessageEvent<unknown>) => {
    if (worker !== current) return;
    const msg = event.data;
    if (!isResponse(msg)) {
      failWorker(current, new Error("Invalid checker worker response"));
      return;
    }
    const p = pending.get(msg.id);
    if (!p || msg.id !== activeId) return;
    pending.delete(msg.id);
    activeId = null;
    if (p.timer !== null) clearTimeout(p.timer);
    if (msg.type === "error") p.reject(new Error(msg.message));
    else p.resolve(msg);
    dispatchNext(current);
  };
  return current;
}

/** Serial dispatch prevents queued requests from consuming each other's timeout. */
function dispatchNext(current: Worker): void {
  if (worker !== current || activeId !== null) return;
  const next = pending.entries().next();
  if (next.done) return;
  const [id, p] = next.value;
  activeId = id;
  const timeoutMs = ontologyState.timeoutMs;
  p.timer = setTimeout(() => failWorker(current,
    new WorkerTimeoutError(`Checker worker timed out during ${p.request.type} after ${timeoutMs / 60_000} minutes; retry with more time`)), timeoutMs);
  try {
    current.postMessage(p.request);
  } catch (error) {
    failWorker(current, error instanceof Error ? error : new Error(String(error)));
  }
}

function ask<T extends Request["type"]>(body: Body<T>, latestRevision?: number): Promise<Response> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    // Construct before registering: constructor errors must not leave pending entries.
    const current = getWorker();
    if (latestRevision !== undefined) {
      if (latestRevision !== latestCheck) {
        reject(new Error("Superseded by a newer diagram check"));
        return;
      }
      for (const [queuedId, p] of pending) {
        if (p.latest && p.timer === null) {
          pending.delete(queuedId);
          p.reject(new Error("Superseded by a newer diagram check"));
        }
      }
    }
    pending.set(id, { resolve, reject, timer: null, request: { ...body, id } as unknown as Request, latest: latestRevision !== undefined });
    dispatchNext(current);
  });
}

export const PMDCO = {
  name: "https://raw.githubusercontent.com/materialdigital/core-ontology/v3.1.2/pmdco-full.ttl",
  title: "PMDco 3.1.2",
  url: new URL(`${import.meta.env.BASE_URL}ontology/pmdco-full-3.1.2.ttl`, location.href).href,
};

export function loadOntology(): Promise<OntologyInfo> {
  if (ontology) return ontology;
  publishOntology({ status: "loading", error: "", timedOut: false });
  const loading = ask<"load">({ type: "load", name: PMDCO.name, title: PMDCO.title, url: PMDCO.url })
    .then((r) => {
      if (r.type !== "loaded") throw new Error("unexpected answer");
      if (ontology !== loading) throw new Error("Checker worker stopped; try again");
      publishOntology({ status: "ready", title: r.ontology.title, error: "", revision: ontologyState.revision + 1 });
      return r.ontology;
    }).catch((error: unknown) => {
      if (ontology === loading) {
        ontology = null;
        publishOntology({ status: "failed", error: error instanceof Error ? error.message : String(error), timedOut: error instanceof WorkerTimeoutError });
      }
      throw error;
    });
  ontology = loading;
  return loading;
}

/** A replacement worker must finish loading before any ontology-dependent operation. */
async function askLoaded<T extends Exclude<Request["type"], "load">>(body: Body<T>, latestRevision?: number): Promise<Response> {
  let loading = loadOntology();
  for (;;) {
    try {
      await loading;
    } catch (error) {
      // Follow a replacement already started by another consumer; don't start retry loops.
      if (!ontology || ontology === loading) throw error;
    }
    if (ontology === loading) return ask<T>(body, latestRevision);
    if (!ontology) throw new Error("Checker worker stopped; try again");
    loading = ontology;
  }
}

export async function check(text: string, { latest = false }: { latest?: boolean } = {}): Promise<Checked> {
  const revision = latest ? ++latestCheck : undefined;
  const r = await askLoaded<"check">({ type: "check", text, diagramName: "canvas.mmd" }, revision);
  if (r.type !== "checked") throw new Error("unexpected answer");
  return r.checked;
}

export async function search(query: string, kinds: string[], limit = 25): Promise<SearchResult> {
  const r = await askLoaded<"search">({ type: "search", query, kinds, limit });
  if (r.type !== "found") throw new Error("unexpected answer");
  return r.result;
}

export async function lookup(ids: string[]): Promise<(Term | null)[]> {
  const r = await askLoaded<"terms">({ type: "terms", ids });
  if (r.type !== "terms") throw new Error("unexpected answer");
  return r.terms;
}

export async function relations(src: string[], dst: string[], only: string[] | null): Promise<RelationFit[]> {
  const r = await askLoaded<"relations">({ type: "relations", src, dst, only });
  if (r.type !== "relations") throw new Error("unexpected answer");
  return r.relations;
}

export async function supers(ids: string[]): Promise<string[][]> {
  const r = await askLoaded<"supers">({ type: "supers", ids });
  if (r.type !== "supers") throw new Error("unexpected answer");
  return r.supers;
}

/** The classes under each ID, as trees, `depth` levels down; null for unknown IDs. */
export async function trees(ids: string[], depth = 6): Promise<(TreeNode | null)[]> {
  const r = await askLoaded<"tree">({ type: "tree", ids, depth });
  if (r.type !== "tree") throw new Error("unexpected answer");
  return r.trees;
}
