import { hasStrings, isRecord, isRecordList, isStringArray } from "./validation.js";
import type { PatternUse } from "./patterns.js";

/** Metadata accepted by readMeta, without silently repairing malformed field types. */
export function isPatternMeta(value: unknown): boolean {
  return isRecord(value) && typeof value.title === "string" && !!value.title.trim()
    && ["id", "description", "version", "source"].every((key) => value[key] === undefined || typeof value[key] === "string")
    && (value.questions === undefined || isStringArray(value.questions));
}

/** Missing diagram boxes/arrows are allowed: they are reported by checkUses. */
export function isPatternUses(value: unknown): value is PatternUse[] {
  if (!isRecordList(value, (u) => hasStrings(u, ["id", "pattern", "title", "version"]) && !!u.id
    && isRecordList(u.parts, (p) => hasStrings(p, ["part", "name", "classId", "box"]) && !!p.part && !!p.box)
    && Array.isArray(u.parts) && u.parts.length > 0
    && isRecordList(u.arrows, (a) => hasStrings(a, ["from", "to", "curie", "name"])
      && !!a.from && !!a.to && (a.kind === "inherit" || a.kind === "relation")))) return false;
  const uses = value as PatternUse[];
  return new Set(uses.map((u) => u.id)).size === uses.length
    && uses.every((u) => new Set(u.parts.map((p) => p.part)).size === u.parts.length);
}

