import type { OntologyState } from "../../src/canvas/checker.js";

let state: OntologyState = { status: "idle", title: "", error: "", revision: 0, timeoutMs: 120_000, timedOut: false };
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
  state = { status: "idle", title: "", error: "", revision: 0, timeoutMs: 120_000, timedOut: false };
}

export const CHECK_TIMEOUTS = [120_000, 300_000, 600_000, 1_800_000, 3_600_000];
export function setRequestTimeout(timeoutMs: number) {
  publishOntology({ timeoutMs });
}
