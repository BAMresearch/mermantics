/**
 * Where the terms of a design option sit: the PMDco class tree, with the option's proposed
 * terms added under their parents, changed terms moved or relabelled, and deprecated terms
 * marked. Read from the option's Terms diagram:
 *
 * - a proposed box is a new term; its parents are the boxes it is a kind of (inheritance
 *   arrows), or else the PMDco class it is aligned to;
 * - any other box stands for the PMDco class it is aligned to; if it is a kind of other boxes,
 *   the term moves under them; a changed box whose name differs from the PMDco label is
 *   relabelled.
 */

import type { Arrow, Box } from "./model.js";
import { statusOf, type TermStatus } from "./palette.js";

/** A PMDco class and the classes under it (as the worker sends it). */
export interface ClassTree {
  id: string;
  label: string;
  deprecated: boolean;
  children: ClassTree[];
}

export interface TermNode {
  key: string; // "id:PMD_0000933" for a PMDco class, "box:Name" for a proposed term
  label: string;
  id: string; // the PMDco ID, "" for a proposed term
  box: string; // the box in the Terms diagram, "" if the class is not drawn
  status: TermStatus | "pmdco" | "outside"; // outside: a PMDco class outside the trees shown, as a parent of new terms
  was: string; // the PMDco label, when the option relabels the term
  moved: boolean; // the option puts the term under a different parent
  children: TermNode[];
}

export function mergeTree(pmdco: ClassTree[], boxes: Box[], arrows: Arrow[],
                          labelOf: (id: string) => string): TermNode[] {
  const nodes = new Map<string, TermNode>();
  const parentOf = new Map<string, Set<string>>(); // node key -> parent keys
  const roots: string[] = [];

  const add = (key: string, node: Omit<TermNode, "key" | "children">): TermNode => {
    let n = nodes.get(key);
    if (!n) {
      n = { key, children: [], ...node };
      nodes.set(key, n);
      parentOf.set(key, new Set());
    }
    return n;
  };
  const walk = (t: ClassTree, parent: string | null) => {
    const key = `id:${t.id}`;
    add(key, { label: t.label, id: t.id, box: "", status: t.deprecated ? "deprecated" : "pmdco", was: "", moved: false });
    if (parent) parentOf.get(key)!.add(parent);
    else if (!roots.includes(key)) roots.push(key);
    for (const c of t.children) walk(c, key);
  };
  pmdco.forEach((t) => walk(t, null));

  const terms = boxes.filter((b) => b.data.kind !== "note" && b.data.kind !== "vocab");
  const byId = new Map(terms.map((b) => [b.id, b]));
  const keyOf = (b: Box) => (statusOf(b.data.css) === "proposed" || !b.data.classId ? `box:${b.id}` : `id:${b.data.classId}`);
  const ensureClass = (id: string): string => {
    const key = `id:${id}`;
    if (!nodes.has(key)) {
      add(key, { label: labelOf(id) || id, id, box: "", status: "outside", was: "", moved: false });
      roots.push(key);
    }
    return key;
  };

  // First every drawn term gets its node, then the parents are set.
  for (const b of terms) {
    const status = statusOf(b.data.css);
    const key = keyOf(b);
    if (key.startsWith("box:")) {
      add(key, { label: b.data.name || b.id, id: "", box: b.id, status: status || "proposed", was: "", moved: false });
    } else {
      const known = nodes.has(key);
      const n = add(key, { label: b.data.classLabel || b.data.classId, id: b.data.classId, box: b.id, status: "pmdco",
                           was: "", moved: false });
      if (!known) roots.push(key);
      n.box = b.id;
      if (status) n.status = status;
      const name = b.data.name.trim();
      if (status === "changed" && name && name.toLowerCase() !== n.label.toLowerCase()) {
        n.was = n.label;
        n.label = name;
      }
    }
  }

  const isBelow = (key: string, ancestor: string): boolean => {
    const seen = new Set<string>();
    const stack = [key];
    while (stack.length) {
      const k = stack.pop()!;
      if (k === ancestor) return true;
      if (seen.has(k)) continue;
      seen.add(k);
      stack.push(...(parentOf.get(k) ?? []));
    }
    return false;
  };

  for (const b of terms) {
    const key = keyOf(b);
    const parents = arrows.filter((a) => a.data?.kind === "inherit" && a.source === b.id)
      .map((a) => byId.get(a.target)).filter((p): p is Box => !!p).map(keyOf);
    const node = nodes.get(key)!;
    let wanted = parents;
    if (!wanted.length && key.startsWith("box:") && b.data.classId) wanted = [ensureClass(b.data.classId)];
    wanted = wanted.filter((p) => p !== key && !isBelow(p, key));
    if (!wanted.length) {
      if (key.startsWith("box:") && !roots.includes(key)) roots.push(key);
      continue;
    }
    const before = parentOf.get(key)!;
    if (key.startsWith("id:") && before.size && [...before].some((p) => !wanted.includes(p))) node.moved = true;
    parentOf.set(key, new Set(wanted));
    const r = roots.indexOf(key);
    if (r >= 0 && key.startsWith("box:")) roots.splice(r, 1);
    if (r >= 0 && key.startsWith("id:") && nodes.get(key)!.status !== "outside") roots.splice(r, 1);
  }

  for (const [key, parents] of parentOf) for (const p of parents) nodes.get(p)?.children.push(nodes.get(key)!);
  const rank = (n: TermNode) => (n.status === "pmdco" ? 1 : 0);
  for (const n of nodes.values()) n.children.sort((x, y) => rank(x) - rank(y) || x.label.localeCompare(y.label));
  return roots.map((k) => nodes.get(k)!).filter((n) => n && (n.status !== "outside" || n.children.length));
}

/** How many terms each status has in the tree (each class counted once). */
export function countStatuses(tree: TermNode[]): Record<string, number> {
  const seen = new Set<string>();
  const out: Record<string, number> = {};
  const walk = (n: TermNode) => {
    if (seen.has(n.key)) return;
    seen.add(n.key);
    const s = n.status === "pmdco" && n.moved ? "changed" : n.status;
    out[s] = (out[s] ?? 0) + 1;
    n.children.forEach(walk);
  };
  tree.forEach(walk);
  return out;
}
