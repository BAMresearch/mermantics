/**
 * Owns the ontology store and runs the checks, so the page never freezes while
 * parsing the ontology or checking a large diagram. Loads and checks are handled one at a
 * time, in the order they arrive. Term searches are answered at once from the index of the
 * current ontology, so typing in a search field does not wait for a check or a download.
 * Class trees wait in the queue, so they are answered once the ontology has loaded.
 */

import { DataFactory } from "n3";

import { checks, DEFAULT_PREFIXES, defaultConfig, mermaid, Ontology, relations, report, terms } from "../core/index.js";
import { labels as labelUtil } from "../core/index.js";
import { OWL, RDF } from "../core/ontology.js";
import type { OntologyInfo, Request, Response, TreeNode } from "./protocol.js";

let onto: Ontology | null = null;
let index: terms.TermIndex | null = null;
let queue: Promise<void> = Promise.resolve();

function post(message: Response) {
  self.postMessage(message);
}

const VERSION_INFO = DataFactory.namedNode("http://www.w3.org/2002/07/owl#versionInfo");

function versionOf(o: Ontology): string {
  for (const header of o.store.getSubjects(RDF.type, OWL.Ontology, null)) {
    for (const p of [VERSION_INFO, OWL.versionIRI]) {
      const value = o.store.getObjects(header, p, null)[0];
      if (value) return value.value;
    }
  }
  return "";
}

async function load(request: Extract<Request, { type: "load" }>): Promise<OntologyInfo> {
  const start = performance.now();
  let text = request.text;
  if (text === undefined) {
    const response = await fetch(request.url!);
    if (!response.ok) throw new Error(`could not download ${request.url}: ${response.status} ${response.statusText}`);
    text = await response.text();
  }
  // Only replace the current ontology once the new one has parsed.
  const loaded = Ontology.fromTurtle([{ name: request.name, text }]);
  const loadedIndex = terms.TermIndex.build(loaded, DEFAULT_PREFIXES);
  onto = loaded;
  index = loadedIndex;
  return { name: request.name, title: request.title, version: versionOf(loaded), triples: loaded.store.size,
           terms: loadedIndex.size, ms: performance.now() - start };
}

function check(request: Extract<Request, { type: "check" }>) {
  if (onto === null) throw new Error("no ontology loaded");
  const start = performance.now();
  const diagram = mermaid.parse(request.text);
  let turtle = "";
  const result = checks.run(diagram, onto, defaultConfig(), null, { emitOwl: (t) => (turtle = t) });
  return {
    result,
    summary: report.summaryLine(result),
    edges: diagram.edges.map(({ src, dst }) => ({ src, dst })),
    nodes: [...diagram.nodes.values()].filter((n) => n.defined).map(({ id, line }) => ({ id, line })),
    markdown: report.toMarkdown(result, request.diagramName),
    json: report.toJson(result, request.diagramName),
    turtle,
    ms: performance.now() - start,
  };
}

function supersOf(id: string): string[] {
  if (onto === null) return [];
  const iri = DataFactory.namedNode(labelUtil.curieToIri(id, DEFAULT_PREFIXES));
  if (!onto.exists(iri)) return [];
  return [...onto.superclasses(iri)].map((s) => terms.curieOf(s, DEFAULT_PREFIXES)).filter((s): s is string => !!s);
}

/** The classes under `id`, down to `depth` levels, sorted by label; null for an unknown ID. */
function treeOf(id: string, depth: number): TreeNode | null {
  if (onto === null) return null;
  const o = onto;
  const root = DataFactory.namedNode(labelUtil.curieToIri(id, DEFAULT_PREFIXES));
  if (!o.exists(root)) return null;
  const seen = new Set<string>();
  const walk = (iri: ReturnType<typeof DataFactory.namedNode>, left: number): TreeNode => {
    seen.add(iri.value);
    const children = left <= 0 ? [] : o.subclasses(iri)
      .filter((c) => !seen.has(c.value) && c.termType === "NamedNode")
      .map((c) => walk(c as ReturnType<typeof DataFactory.namedNode>, left - 1))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { id: terms.curieOf(iri.value, DEFAULT_PREFIXES) ?? iri.value, label: o.label(iri), deprecated: o.deprecated(iri), children };
  };
  return walk(root, depth);
}

async function handle(request: Request) {
  try {
    switch (request.type) {
      case "load":
        post({ type: "loaded", id: request.id, ontology: await load(request) });
        break;
      case "check":
        post({ type: "checked", id: request.id, checked: check(request) });
        break;
      case "search": {
        const result = index?.search(request.query, { kinds: request.kinds, limit: request.limit })
          ?? { terms: [], total: 0 };
        post({ type: "found", id: request.id, result });
        break;
      }
      case "terms":
        post({ type: "terms", id: request.id, terms: request.ids.map((id) => index?.get(id) ?? null) });
        break;
      case "relations":
        post({ type: "relations", id: request.id,
              relations: onto ? relations.fittingRelations(onto, DEFAULT_PREFIXES, request.src, request.dst,
                                                          request.only) : [] });
        break;
      case "supers":
        post({ type: "supers", id: request.id, supers: request.ids.map((id) => supersOf(id)) });
        break;
      case "tree":
        post({ type: "tree", id: request.id, trees: request.ids.map((id) => treeOf(id, request.depth)) });
        break;
    }
  } catch (exc) {
    post({ type: "error", id: request.id, request: request.type, message: (exc as Error).message });
  }
}

self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.type === "search" || request.type === "terms" || request.type === "relations"
      || request.type === "supers") void handle(request);
  else queue = queue.then(() => handle(request));
};
