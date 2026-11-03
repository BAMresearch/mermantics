/**
 * Which relations fit between two boxes, for drawing arrows on the canvas.
 *
 * Uses the same domain and range logic as the domain-range check (check 4), but asks it
 * before the arrow exists: a property fits when no domain or range of it rules out the
 * classes of the two boxes. "unknown" means a constraint could not be decided (a complex
 * class expression), so the arrow may still be fine.
 */

import { DataFactory } from "n3";

import * as labels from "./labels.js";
import { OWL, RDF, type Ontology } from "./ontology.js";
import { curieOf } from "./terms.js";

const { namedNode } = DataFactory;

export interface RelationFit {
  id: string; // e.g. "OBI_0000293"
  label: string;
  fit: "yes" | "unknown";
  constrained: boolean; // false if the property has no domain or range at all
}

/** Named superclasses of all the given classes (IDs), each class included. */
function supersOf(onto: Ontology, ids: string[], prefixes: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    for (const iri of onto.superclasses(namedNode(labels.curieToIri(id, prefixes)))) out.add(iri);
  }
  return out;
}

/**
 * Object properties that fit an arrow from a box whose classes are `src` to a box whose
 * classes are `dst` (IDs of the box's class and of its parents' classes). `only` limits
 * the answer to these property IDs, in that order; otherwise all object properties with an
 * ID are tried, constrained ones first.
 */
export function fittingRelations(onto: Ontology, prefixes: Record<string, string>, src: string[], dst: string[],
                                 only: string[] | null = null): RelationFit[] {
  const srcSupers = supersOf(onto, src, prefixes);
  const dstSupers = supersOf(onto, dst, prefixes);
  const candidates: [string, string][] = []; // [id, iri]
  if (only) {
    for (const id of only) candidates.push([id, labels.curieToIri(id, prefixes)]);
  } else {
    for (const p of onto.store.getSubjects(RDF.type, OWL.ObjectProperty, null)) {
      if (p.termType !== "NamedNode") continue;
      const id = curieOf(p.value, prefixes);
      if (id) candidates.push([id, p.value]);
    }
  }
  const out: RelationFit[] = [];
  for (const [id, iri] of candidates) {
    const prop = namedNode(iri);
    if (!onto.exists(prop) || onto.deprecated(prop)) continue;
    const [domains, ranges] = onto.propertyConstraints(prop);
    let fit: RelationFit["fit"] = "yes";
    let ruledOut = false;
    for (const [constraints, supers] of [[domains, srcSupers], [ranges, dstSupers]] as const) {
      for (const [expr] of constraints) {
        const verdict = onto.satisfied(expr, supers);
        if (verdict === false) ruledOut = true;
        else if (verdict === null) fit = "unknown";
      }
    }
    if (ruledOut) continue;
    out.push({ id, label: onto.label(prop), fit, constrained: domains.length + ranges.length > 0 });
  }
  if (!only) {
    out.sort((a, b) => Number(b.constrained) - Number(a.constrained) || a.label.localeCompare(b.label));
  }
  return out;
}
