/** Failed writes remain recoverable until this page is reloaded or closed. */
export type StorageArea = "session" | "local";
export interface PendingSave { area: StorageArea; key: string; text: string }
let pending: readonly PendingSave[] = [];
const listeners = new Set<() => void>();
const storage = (area: StorageArea) => area === "session" ? sessionStorage : localStorage;

export const pendingSaves = () => pending;
export function subscribeSaves(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function writeStored(area: StorageArea, key: string, text: string): boolean {
  let saved = false;
  try { storage(area).setItem(key, text); saved = true; } catch { /* retain the latest value below */ }
  const previous = pending.find((p) => p.area === area && p.key === key);
  if (saved ? !!previous : previous?.text !== text) {
    pending = pending.filter((p) => p.area !== area || p.key !== key);
    if (!saved) pending = [...pending, { area, key, text }];
    listeners.forEach((listener) => listener());
  }
  return saved;
}

export function readStored(area: StorageArea, key: string): string | null {
  const retained = pending.find((p) => p.area === area && p.key === key);
  if (retained) return retained.text;
  try { return storage(area).getItem(key); } catch { return null; }
}

export function retrySaves(): void {
  for (const p of pending) writeStored(p.area, p.key, p.text);
}
