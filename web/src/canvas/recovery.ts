import { MODES } from "./mode.js";
import { fromMermaid } from "./model.js";
import { MINE_KEY, parsePattern } from "./patterns.js";
import { type PendingSave, writeStored } from "./persistence.js";

export function recoveryLabel(entry: PendingSave): string {
  return entry.area === "local" ? "Custom patterns"
    : Object.values(MODES).find((m) => m.storageKey === entry.key)?.title ?? "Diagram";
}

export function recoveryFile(entries: readonly PendingSave[]): string {
  return JSON.stringify({ format: "mermantics-recovery", version: 1, entries }, null, 2);
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: Record<string, unknown>, keys: string[]) => keys.every((k) => typeof v[k] === "string");
const list = (v: unknown, valid: (x: Record<string, unknown>) => boolean): boolean =>
  Array.isArray(v) && v.every((x) => object(x) && valid(x));

function validOptions(v: unknown): boolean {
  if (!object(v) || !Number.isInteger(v.version) || !object(v.current) || !object(v.useCase)) return false;
  const views = ["terms", "dft", "fem"];
  if (!list(v.options, (o) => strings(o, ["id", "letter", "title", "summary", "kinds", "gains", "costs", "why", "source"])
    && !!o.id && typeof o.builtIn === "boolean" && ["", "preferred", "maybe", "rejected"].includes(o.verdict as string)
    && object(o.views) && strings(o.views, views))) return false;
  const options = v.options as Record<string, unknown>[];
  if (new Set(options.map((o) => o.id)).size !== options.length
    || !options.some((o) => o.id === (v.current as Record<string, unknown>).option)
    || !views.includes(v.current.view as string)) return false;
  const u = v.useCase;
  if (!strings(u, ["title", "description"])
    || !list(u.stories, (s) => strings(s, ["id", "role", "want", "benefit", "priority"]))
    || !list(u.questions, (q) => strings(q, ["id", "text"]) && Array.isArray(q.boxes) && q.boxes.every((b) => typeof b === "string"))
    || !list(u.openPoints, (p) => strings(p, ["id", "text"]) && typeof p.done === "boolean")) return false;
  for (const o of options) for (const text of Object.values(o.views as Record<string, string>)) fromMermaid(text);
  return true;
}

/** Validate the complete file before allowing any storage writes. Never accept arbitrary storage keys. */
export function readRecovery(text: string): PendingSave[] {
  try {
    const raw: unknown = JSON.parse(text);
    if (!object(raw) || raw.format !== "mermantics-recovery" || raw.version !== 1
      || !Array.isArray(raw.entries) || !raw.entries.length) throw new Error();
    const seen = new Set<string>();
    return raw.entries.map((entry: unknown) => {
      if (!object(entry) || typeof entry.text !== "string" || typeof entry.key !== "string") throw new Error();
      const id = `${entry.area}:${entry.key}`;
      if (seen.has(id)) throw new Error();
      seen.add(id);
      if (entry.area === "local" && entry.key === MINE_KEY) {
        const patterns: unknown = JSON.parse(entry.text);
        if (!Array.isArray(patterns) || !patterns.every((p) => typeof p === "string" && parsePattern(p))) throw new Error();
      } else if (entry.area === "session") {
        const mode = Object.values(MODES).find((m) => m.storageKey === entry.key);
        if (!mode) throw new Error();
        if (mode.options) {
          if (!validOptions(JSON.parse(entry.text))) throw new Error();
        } else fromMermaid(entry.text);
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
