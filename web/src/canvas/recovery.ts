import { MODES } from "./mode.js";
import { isOptionsState, VIEWS } from "./options.js";
import { validateRecoveryDiagram } from "./recoveryDiagram.js";
import { isRecord } from "./validation.js";
import { MINE_KEY, parsePattern } from "./patterns.js";
import { type PendingSave, writeStored } from "./persistence.js";

export function recoveryLabel(entry: PendingSave): string {
  return entry.area === "local" ? "Custom patterns"
    : Object.values(MODES).find((m) => m.storageKey === entry.key)?.title ?? "Diagram";
}

export function recoveryFile(entries: readonly PendingSave[]): string {
  return JSON.stringify({ format: "mermantics-recovery", version: 1, entries }, null, 2);
}

/** Validate the complete file before allowing any storage writes. Never accept arbitrary storage keys. */
export function readRecovery(text: string): PendingSave[] {
  try {
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw) || raw.format !== "mermantics-recovery" || raw.version !== 1
      || !Array.isArray(raw.entries) || !raw.entries.length) throw new Error();
    const seen = new Set<string>();
    return raw.entries.map((entry: unknown) => {
      if (!isRecord(entry) || typeof entry.text !== "string" || typeof entry.key !== "string") throw new Error();
      const id = `${entry.area}:${entry.key}`;
      if (seen.has(id)) throw new Error();
      seen.add(id);
      if (entry.area === "local" && entry.key === MINE_KEY) {
        const patterns: unknown = JSON.parse(entry.text);
        if (!Array.isArray(patterns)) throw new Error();
        const ids = new Set<string>();
        for (const text of patterns) {
          if (typeof text !== "string") throw new Error();
          validateRecoveryDiagram(text);
          const pattern = parsePattern(text);
          if (!pattern || ids.has(pattern.id)) throw new Error();
          ids.add(pattern.id);
        }
      } else if (entry.area === "session") {
        const mode = Object.values(MODES).find((m) => m.storageKey === entry.key);
        if (!mode) throw new Error();
        if (mode.options) {
          const options: unknown = JSON.parse(entry.text);
          if (!isOptionsState(options)) throw new Error();
          for (const option of options.options) for (const view of VIEWS) validateRecoveryDiagram(option.views[view.id]);
        } else validateRecoveryDiagram(entry.text);
      } else throw new Error();
      return { area: entry.area, key: entry.key, text: entry.text } as PendingSave;
    });
  } catch {
    throw new Error("This is not a supported mermantics recovery file, or its contents are invalid.");
  }
}

export function restoreRecovery(text: string): void {
  const entries = readRecovery(text);
  for (const entry of entries) writeStored(entry.area, entry.key, entry.text);
}

export function downloadRecovery(entries: readonly PendingSave[]): void {
  const url = URL.createObjectURL(new Blob([recoveryFile(entries)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "mermantics-recovery.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
