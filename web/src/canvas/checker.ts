/** Talks to the checker worker with promises. */

import type { RelationFit } from "../core/relations.js";
import type { SearchResult, Term } from "../core/terms.js";
import type { Checked, OntologyInfo, Request, Response, TreeNode } from "../worker/protocol.js";

type Pending = { resolve: (r: Response) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
type Body<T extends Request["type"]> = Omit<Extract<Request, { type: T }>, "id">;

const pending = new Map<number, Pending>();
let nextId = 1;
let worker: Worker | null = null;
let ontology: Promise<OntologyInfo> | null = null;
// Includes time queued behind ontology loading or another check. Allow slow devices
// two minutes, but never leave the UI waiting indefinitely for a silent worker.
const REQUEST_TIMEOUT_MS = 120_000;

function failWorker(current: Worker, error: Error): void {
  if (worker !== current) return;
  worker = null;
  ontology = null;
  current.onmessage = current.onerror = current.onmessageerror = null;
  current.terminate();
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(error);
  }
  pending.clear();
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
  current.onmessage = (event: MessageEvent<Response>) => {
    if (worker !== current) return;
    const msg = event.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.type === "error") p.reject(new Error(msg.message));
    else p.resolve(msg);
  };
  return current;
}

function ask<T extends Request["type"]>(body: Body<T>): Promise<Response> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    // Construct before registering: constructor errors must not leave pending entries.
    const current = getWorker();
    const timer = setTimeout(() => failWorker(current,
      new Error(`Checker worker timed out during ${body.type}; try again`)), REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    try {
      current.postMessage({ ...body, id } as unknown as Request);
    } catch (error) {
      failWorker(current, error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export const PMDCO = {
  name: "https://raw.githubusercontent.com/materialdigital/core-ontology/v3.1.2/pmdco-full.ttl",
  title: "PMDco 3.1.2",
  url: new URL(`${import.meta.env.BASE_URL}ontology/pmdco-full-3.1.2.ttl`, location.href).href,
};

export function loadOntology(): Promise<OntologyInfo> {
  if (ontology) return ontology;
  const loading = ask<"load">({ type: "load", name: PMDCO.name, title: PMDCO.title, url: PMDCO.url })
    .then((r) => {
      if (r.type !== "loaded") throw new Error("unexpected answer");
      return r.ontology;
    }).catch((error: unknown) => {
      if (ontology === loading) ontology = null;
      throw error;
    });
  ontology = loading;
  return loading;
}

/** A replacement worker must finish loading before any ontology-dependent operation. */
async function askLoaded<T extends Exclude<Request["type"], "load">>(body: Body<T>): Promise<Response> {
  const loading = loadOntology();
  await loading;
  // Another caller can fail the worker while this continuation is queued.
  if (ontology !== loading) throw new Error("Checker worker stopped; try again");
  return ask<T>(body);
}

export async function check(text: string): Promise<Checked> {
  const r = await askLoaded<"check">({ type: "check", text, diagramName: "canvas.mmd" });
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
