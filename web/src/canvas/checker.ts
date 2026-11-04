/** Talks to the checker worker with promises. */

import type { RelationFit } from "../core/relations.js";
import type { SearchResult, Term } from "../core/terms.js";
import type { Checked, OntologyInfo, Request, Response } from "../worker/protocol.js";

type Pending = { resolve: (r: Response) => void; reject: (e: Error) => void };
type Body<T extends Request["type"]> = Omit<Extract<Request, { type: T }>, "id">;

const pending = new Map<number, Pending>();
let nextId = 1;
let worker: Worker | null = null;

/** The worker starts when it is first needed, so process modelling (no ontology) never starts it. */
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../worker/checker.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<Response>) => {
    const msg = event.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.type === "error") p.reject(new Error(msg.message));
    else p.resolve(msg);
  };
  return worker;
}

function ask<T extends Request["type"]>(body: Body<T>): Promise<Response> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...body, id } as unknown as Request);
  });
}

export const PMDCO = {
  name: "https://raw.githubusercontent.com/materialdigital/core-ontology/v3.1.2/pmdco-full.ttl",
  title: "PMDco 3.1.2",
  url: new URL(`${import.meta.env.BASE_URL}ontology/pmdco-full-3.1.2.ttl`, location.href).href,
};

export async function loadOntology(): Promise<OntologyInfo> {
  const r = await ask<"load">({ type: "load", name: PMDCO.name, title: PMDCO.title, url: PMDCO.url });
  if (r.type !== "loaded") throw new Error("unexpected answer");
  return r.ontology;
}

export async function check(text: string): Promise<Checked> {
  const r = await ask<"check">({ type: "check", text, diagramName: "canvas.mmd" });
  if (r.type !== "checked") throw new Error("unexpected answer");
  return r.checked;
}

export async function search(query: string, kinds: string[], limit = 25): Promise<SearchResult> {
  const r = await ask<"search">({ type: "search", query, kinds, limit });
  if (r.type !== "found") throw new Error("unexpected answer");
  return r.result;
}

export async function lookup(ids: string[]): Promise<(Term | null)[]> {
  const r = await ask<"terms">({ type: "terms", ids });
  if (r.type !== "terms") throw new Error("unexpected answer");
  return r.terms;
}

export async function relations(src: string[], dst: string[], only: string[] | null): Promise<RelationFit[]> {
  const r = await ask<"relations">({ type: "relations", src, dst, only });
  if (r.type !== "relations") throw new Error("unexpected answer");
  return r.relations;
}

export async function supers(ids: string[]): Promise<string[][]> {
  const r = await ask<"supers">({ type: "supers", ids });
  if (r.type !== "supers") throw new Error("unexpected answer");
  return r.supers;
}
