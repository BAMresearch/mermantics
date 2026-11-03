import { useEffect, useMemo, useState } from "react";

import type { RelationFit } from "../core/relations.js";
import { relations } from "./checker.js";
import { COMMON_RELATIONS, wordsFor } from "./palette.js";

export interface Choice {
  kind: "relation" | "inherit";
  name: string;
  curie: string;
  words: string;
}

/**
 * The menu that opens when an arrow is drawn: the relations that fit between the two boxes,
 * in plain words, the common ones first.
 */
export function RelationMenu({ x, y, srcName, dstName, srcClasses, dstClasses, toVocab, onChoose, onCancel }: {
  x: number;
  y: number;
  srcName: string;
  dstName: string;
  srcClasses: string[];
  dstClasses: string[];
  toVocab: boolean;
  onChoose: (choice: Choice) => void;
  onCancel: () => void;
}) {
  const [common, setCommon] = useState<RelationFit[] | null>(null);
  const [all, setAll] = useState<RelationFit[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState("");
  const [field, setField] = useState("type");

  useEffect(() => {
    if (toVocab) return;
    relations(srcClasses, dstClasses, COMMON_RELATIONS.map((r) => r.id)).then(setCommon).catch(() => setCommon([]));
  }, [srcClasses, dstClasses, toVocab]);

  useEffect(() => {
    if (!showAll || all) return;
    relations(srcClasses, dstClasses, null).then(setAll).catch(() => setAll([]));
  }, [showAll, all, srcClasses, dstClasses]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const filtered = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter((w) => w);
    return (all ?? []).filter((r) => words.every((w) => `${r.label} ${r.id}`.toLowerCase().includes(w))).slice(0, 40);
  }, [all, filter]);

  const pick = (r: RelationFit) => onChoose({ kind: "relation", name: r.label, curie: r.id, words: wordsFor(r.id, r.label) });

  return (
    <div className="menu" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="menu-head">
        <b>{srcName}</b> → <b>{dstName}</b>
      </div>
      {toVocab ? (
        <div className="menu-section">
          <label className="field">
            Which field takes a value from this list?
            <input value={field} autoFocus onChange={(e) => setField(e.target.value)} />
          </label>
          <button type="button" className="primary" disabled={!field.trim()}
                  onClick={() => onChoose({ kind: "relation", name: field.trim(), curie: "", words: field.trim() })}>
            Connect
          </button>
        </div>
      ) : (
        <>
          <div className="menu-section">
            {common === null && <div className="muted">Finding relations that fit...</div>}
            {common?.map((r) => (
              <button type="button" key={r.id} className="menu-item" onClick={() => pick(r)}>
                <span>{wordsFor(r.id, r.label)}</span>
                <span className="menu-id">{r.label} · {r.id}{r.fit === "unknown" ? " · not sure it fits" : ""}</span>
              </button>
            ))}
            {common?.length === 0 && <div className="muted">None of the common relations fit these two boxes.</div>}
            <button type="button" className="menu-item" onClick={() => onChoose({ kind: "inherit", name: "", curie: "", words: "is a kind of" })}>
              <span>is a kind of</span>
              <span className="menu-id">{srcName} is a more specific kind of {dstName}</span>
            </button>
          </div>
          <div className="menu-section">
            {!showAll ? (
              <button type="button" className="link" onClick={() => setShowAll(true)}>Other relation from the ontology...</button>
            ) : (
              <>
                <input autoFocus placeholder="Search relations that fit" value={filter} onChange={(e) => setFilter(e.target.value)} />
                <div className="menu-scroll">
                  {all === null && <div className="muted">Loading...</div>}
                  {filtered.map((r) => (
                    <button type="button" key={r.id} className="menu-item small" onClick={() => pick(r)}>
                      <span>{r.label}</span>
                      <span className="menu-id">{r.id}{r.constrained ? "" : " · no domain or range"}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
      <div className="menu-foot">
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
