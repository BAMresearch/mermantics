import { stripFrontmatter } from "../core/mermaid.js";
import { fromMermaid, isUseCase } from "./model.js";
import { isShapeKind } from "./palette.js";
import { isPatternMeta, isPatternUses } from "./patternValidation.js";
import { isRecord } from "./validation.js";

/**
 * Recovery replaces work, so tolerant import is insufficient. Check syntax and persisted
 * shapes without checking ontology meaning. Blank option views and empty flowcharts are valid.
 */
export function validateRecoveryDiagram(text: string): void {
  if (!text.trim()) return;
  const rawLines = text.split(/\r?\n/);
  const lines = rawLines.slice(stripFrontmatter(rawLines)).map((line) => line.trim()).filter(Boolean);
  const statements = lines.filter((line) => !line.startsWith("%%"));
  const header = /^(?:flowchart|graph)\s+(?:TB|TD|BT|LR|RL)$/;
  if (!header.test(statements[0] ?? "")
    || statements.slice(1).some((line) => /^(?:flowchart|graph)(?:\s|$)/.test(line))) throw new Error("Invalid flowchart header");

  let subgraphs = 0;
  for (const line of statements.slice(1)) {
    if (/^subgraph(?:\s|$)/.test(line)) {
      if (!/^subgraph\s+\S/.test(line)) throw new Error("Missing subgraph name");
      subgraphs++;
    }
    else if (line === "end") {
      if (--subgraphs < 0) throw new Error("Unmatched subgraph end");
    } else if (/^direction(?:\s|$)/.test(line) && !/^direction\s+(?:TB|TD|BT|LR|RL)$/.test(line)) {
      throw new Error("Invalid diagram direction");
    }
  }
  if (subgraphs) throw new Error("Unclosed subgraph");
  const boxMetadata: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (!/^%%\s*mermantics-/.test(line)) continue;
    const match = /^%% (mermantics-[\w-]+)\s+(.+)$/.exec(line);
    if (!match || seen.has(match[1]!)) throw new Error("Invalid or duplicate diagram metadata");
    const [, key, json] = match;
    seen.add(key!);
    let value: unknown;
    try { value = JSON.parse(json!); }
    catch { throw new Error(`Invalid JSON in ${key} metadata`); }
    let valid = false;
    switch (key) {
      case "mermantics-layout":
        valid = isRecord(value) && Object.values(value).every((p) => Array.isArray(p) && p.length === 2
          && p.every((n) => typeof n === "number" && Number.isFinite(n)));
        break;
      case "mermantics-kinds":
        valid = isRecord(value) && Object.values(value).every((kind) => isShapeKind(kind));
        break;
      case "mermantics-kind-names":
        valid = isRecord(value) && Object.values(value).every((name) => typeof name === "string");
        break;
      case "mermantics-usecase": valid = isUseCase(value); break;
      case "mermantics-pattern-uses": valid = isPatternUses(value); break;
      case "mermantics-pattern": valid = isPatternMeta(value); break;
    }
    if (!valid) throw new Error(`Invalid ${key} metadata`);
    if (["mermantics-layout", "mermantics-kinds", "mermantics-kind-names"].includes(key!)) {
      boxMetadata.push(value as Record<string, unknown>);
    }
  }
  const diagram = fromMermaid(text);
  const ids = new Set(diagram.boxes.map((box) => box.id));
  if (boxMetadata.some((metadata) => Object.keys(metadata).some((id) => !ids.has(id)))) {
    throw new Error("Diagram metadata names an unknown box");
  }
  if (diagram.warnings.length) throw new Error(`Unreadable diagram content: ${diagram.warnings[0]}`);
}
