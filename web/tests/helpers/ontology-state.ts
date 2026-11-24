import type { OntologyState } from "../../src/canvas/checker.js";

let state: OntologyState = { status: "idle", title: "", error: "", revision: 0 };
const listeners = new Set<() => void>();
export const getOntologyState = () => state;
export function subscribeOntology(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function publishOntology(patch: Partial<OntologyState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}
export function resetOntology() {
  state = { status: "idle", title: "", error: "", revision: 0 };
}
