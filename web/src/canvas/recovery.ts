import { MODES } from "./mode.js";
import { isOptionsState, VIEWS } from "./options.js";
import { validateRecoveryDiagram } from "./recoveryDiagram.js";
import { isRecord } from "./validation.js";
import { MINE_KEY, importPattern, isPatternSource, readMeta, readMine, storedPatterns } from "./patterns.js";
import { type PendingSave, writeStored } from "./persistence.js";

export function recoveryLabel(entry: PendingSave): string {
  return entry.area === "local" ? "Custom patterns"
    : Object.values(MODES).find((m) => m.storageKey === entry.key)?.title ?? "Diagram";
}

export function recoveryFile(entries: readonly PendingSave[]): string {
  // Version 2 adds explicitly inert source files for older patterns needing repair.
  const version = entries.some((entry) => {
    if (entry.area !== "local" || entry.key !== MINE_KEY) return false;
    const patterns: unknown = JSON.parse(entry.text);
    return Array.isArray(patterns) && patterns.some(isPatternSource);
  }) ? 2 : 1;
  return JSON.stringify({ format: "mermantics-recovery", version, entries }, null, 2);
}

function inContext<T>(label: string, action: () => T): T {
  try { return action(); }
  catch (error) { throw new Error(`${label}: ${error instanceof Error ? error.message : "Invalid content"}`); }
}

/** Source-only legacy items are explicitly identified before restoring them. */
export function recoverySources(entries: readonly PendingSave[]): string[] {
  return entries.filter((e) => e.area === "local" && e.key === MINE_KEY)
    .flatMap((e) => (JSON.parse(e.text) as unknown[]).filter(isPatternSource).map((p) => p.title));
}

/** Validate the complete file before allowing any storage writes. Never accept arbitrary storage keys. */
export function readRecovery(text: string): PendingSave[] {
  try {
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw) || raw.format !== "mermantics-recovery" || (raw.version !== 1 && raw.version !== 2)
      || !Array.isArray(raw.entries) || !raw.entries.length) throw new Error("Unsupported recovery format or version.");
    const seen = new Set<string>();
    return raw.entries.map((entry: unknown) => {
      if (!isRecord(entry) || typeof entry.text !== "string" || typeof entry.key !== "string") throw new Error("Invalid recovery entry.");
      const id = `${entry.area}:${entry.key}`;
      if (seen.has(id)) throw new Error("Repeated recovery destination.");
      seen.add(id);
      const text = entry.text;
      if (entry.area === "local" && entry.key === MINE_KEY) {
        inContext("Custom patterns", () => {
          const patterns: unknown = JSON.parse(text);
          if (!Array.isArray(patterns)) throw new Error("Expected a pattern collection.");
          const ids = new Set<string>();
          patterns.forEach((item: unknown, index) => {
            const title = typeof item === "string" ? readMeta(item)?.title : isPatternSource(item) ? item.title : null;
            inContext(title ? `“${title}”` : `Pattern ${index + 1}`, () => {
              let id: string;
              if (raw.version === 2 && isPatternSource(item)) id = item.id;
              else {
                if (typeof item !== "string") throw new Error("Invalid pattern source.");
                id = importPattern(item).id;
              }
              if (ids.has(id)) throw new Error("Duplicate pattern ID.");
              ids.add(id);
            });
          });
        });
      } else if (entry.area === "session") {
        const mode = Object.values(MODES).find((m) => m.storageKey === entry.key);
        if (!mode) throw new Error("Unknown diagram destination.");
        inContext(mode.title, () => {
          if (mode.options) {
            const options: unknown = JSON.parse(text);
            if (!isOptionsState(options)) throw new Error("Invalid computation options or workshop notes.");
            for (const option of options.options) for (const view of VIEWS) {
              inContext(`${option.title || option.id} / ${view.title}`, () => validateRecoveryDiagram(option.views[view.id]));
            }
          } else validateRecoveryDiagram(text);
        });
      } else throw new Error("Unknown recovery destination.");
      return { area: entry.area, key: entry.key, text } as PendingSave;
    });
  } catch (error) {
    throw new Error(`This is not a supported mermantics recovery file, or its contents are invalid. ${error instanceof Error ? error.message : ""}`);
  }
}

export function restoreRecovery(text: string): void {
  const entries = readRecovery(text);
  for (const entry of entries) writeStored(entry.area, entry.key, entry.text);
}

export function downloadRecovery(entries: readonly PendingSave[]): void {
  // Older collections may contain source accepted before strict import validation. Preserve
  // that source as an inert item rather than making the entire recovery file unrestorable.
  const prepared = entries.map((entry) => entry.area === "local" && entry.key === MINE_KEY
    ? { ...entry, text: JSON.stringify(storedPatterns(readMine(JSON.parse(entry.text)))) } : entry);
  const text = recoveryFile(prepared);
  readRecovery(text); // never offer a recovery download that this application cannot restore
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "mermantics-recovery.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
