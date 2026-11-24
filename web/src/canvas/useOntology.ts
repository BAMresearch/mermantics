import { useSyncExternalStore } from "react";
import { getOntologyState, subscribeOntology } from "./checker.js";

/** Observe recovery started by any consumer, without starting a worker. */
export function useOntology() {
  return useSyncExternalStore(subscribeOntology, getOntologyState);
}
