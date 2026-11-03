import { useEffect, useMemo, useState } from "react";

import type { RelationFit } from "../core/relations.js";
import { relations } from "./checker.js";
import { COMMON_RELATIONS, wordsFor } from "./palette.js";

export interface Choice {
  kind: "relation" | "inherit";
  name: string; // ontology label of `curie` (for an own relation without a parent: its name)
  curie: string;
  words: string;
  own: boolean;
}

/** A relation the user made: a name, and optionally the ontology relation it is a kind of. */
export interface OwnRelation {
  words: string;
  curie: string; // "" if not linked to the ontology
  name: string; // the ontology's label for curie
}

const OWN_KEY = "mermantics-my-relations";

export function loadOwnRelations(): OwnRelation[] {
  try {
    const raw = JSON.parse(localStorage.getItem(OWN_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((r): r is OwnRelation => !!r && typeof r === "object" && typeof (r as OwnRelation).words === "string"
      && typeof (r as OwnRelation).curie === "string" && typeof (r as OwnRelation).name === "string");
  } catch {
    return [];
  }
}

export function saveOwnRelations(list: OwnRelation[]) {
  try { localStorage.setItem(OWN_KEY, JSON.stringify(list)); } catch { /* storage can be off */ }
}

/** The relations offered first: the common ones, and the user's own ones whose parent fits. */
function fitting(fits: RelationFit[], id: string): RelationFit | undefined {
  return fits.find((f) => f.id === id);
}

/**
 * The menu that opens when an arrow is drawn: the relations that fit between the two boxes,
 * in plain words, the user's own relations and the common ones first.
 */
export function RelationMenu({ x, y, srcName, dstName, srcClasses, dstClasses, toVocab, own, onChoose, onRemember,
                               onCancel }: {
  x: number;
  y: number;
  srcName: string;
  dstName: string;
  srcClasses: string[];
  dstClasses: string[];
  toVocab: boolean;
  own: OwnRelation[];
  onChoose: (choice: Choice) => void;
  onRemember: (relation: OwnRelation) => void;
  onCancel: () => void;
}) {
  const [quick, setQuick] = useState<RelationFit[] | null>(null);
  const [all, setAll] = useState<RelationFit[] | null>(null);
  const [mode, setMode] = useState<"menu" | "all" | "own">("menu");
  const [filter, setFilter] = useState("");
  const [field, setField] = useState("type");
  const [ownName, setOwnName] = useState("");
  const [parent, setParent] = useState<RelationFit | null>(null);
  const [remember, setRemember] = useState(true);

  const quickIds = useMemo(() => [...new Set([...COMMON_RELATIONS.map((r) => r.id), ...own.map((r) => r.curie).filter((c) => c)])],
                           [own]);

  useEffect(() => {
    if (toVocab) return;
    relations(srcClasses, dstClasses, quickIds).then(setQuick).catch(() => setQuick([]));
  }, [srcClasses, dstClasses, toVocab, quickIds]);

  useEffect(() => {
    if (mode === "menu" || all) return;
    relations(srcClasses, dstClasses, null).then(setAll).catch(() => setAll([]));
  }, [mode, all, srcClasses, dstClasses]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const filtered = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter((w) => w);
    return (all ?? []).filter((r) => words.every((w) => `${r.label} ${r.id}`.toLowerCase().includes(w))).slice(0, 40);
  }, [all, filter]);

  const pick = (r: RelationFit) => onChoose({ kind: "relation", name: r.label, curie: r.id, words: wordsFor(r.id, r.label), own: false });
  const pickOwn = (r: OwnRelation) => onChoose({ kind: "relation", name: r.curie ? r.name : r.words, curie: r.curie, words: r.words, own: true });

  // Own relations that can be used here: not linked (always), or whose parent fits.
  const ownHere = quick === null ? [] : own.filter((r) => !r.curie || fitting(quick, r.curie));
  const common = (quick ?? []).filter((r) => COMMON_RELATIONS.some((c) => c.id === r.id));

  const makeOwn = () => {
    const words = ownName.trim();
    if (!words) return;
    const relation: OwnRelation = { words, curie: parent?.id ?? "", name: parent?.label ?? words };
    if (remember) onRemember(relation);
    pickOwn(relation);
  };

  return (
    <div className="menu" style={{ left: x, top: y, maxHeight: `calc(100% - ${y + 8}px)` }} onMouseDown={(e) => e.stopPropagation()}>
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
                  onClick={() => onChoose({ kind: "relation", name: field.trim(), curie: "", words: field.trim(), own: true })}>
            Connect
          </button>
        </div>
      ) : mode === "own" ? (
        <div className="menu-section own-form">
          <label className="field">
            Name of your relation
            <input autoFocus value={ownName} placeholder="e.g. heated in" onChange={(e) => setOwnName(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter") makeOwn(); }} />
          </label>
          <div className="field">
            It is a more specific kind of
            {parent ? (
              <div className="parent-chosen">
                <span><b>{parent.label}</b> <span className="menu-id">{parent.id}</span></span>
                <button type="button" className="link" onClick={() => setParent(null)}>change</button>
              </div>
            ) : (
              <>
                <input placeholder="Search relations that fit these two boxes" value={filter} onChange={(e) => setFilter(e.target.value)} />
                <div className="menu-scroll">
                  {all === null && <div className="muted">Loading...</div>}
                  {filtered.map((r) => (
                    <button type="button" key={r.id} className="menu-item small" onClick={() => { setParent(r); setFilter(""); }}>
                      <span>{wordsFor(r.id, r.label) !== r.label ? `${r.label} (${wordsFor(r.id, r.label)})` : r.label}</span>
                      <span className="menu-id">{r.id}{r.constrained ? "" : " · no domain or range"}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <span className="muted-inline">
              {parent
                ? "Your relation is checked like this one: it must fit the same kinds of boxes."
                : "Optional. Without it, your relation is not linked to the ontology and is not checked."}
            </span>
          </div>
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Keep it in my relations, to use it again
          </label>
          <div className="row">
            <button type="button" className="primary" disabled={!ownName.trim()} onClick={makeOwn}>Add arrow</button>
            <button type="button" className="secondary" onClick={() => { setMode("menu"); setParent(null); }}>Back</button>
          </div>
        </div>
      ) : (
        <>
          <div className="menu-section">
            {quick === null && <div className="muted">Finding relations that fit...</div>}
            {ownHere.length > 0 && <div className="menu-label">My relations</div>}
            {ownHere.map((r) => (
              <button type="button" key={`${r.words}|${r.curie}`} className="menu-item" onClick={() => pickOwn(r)}>
                <span>{r.words}</span>
                <span className="menu-id">{r.curie ? `a kind of ${r.name} · ${r.curie}` : "not linked to the ontology"}</span>
              </button>
            ))}
            {ownHere.length > 0 && common.length > 0 && <div className="menu-label">Common</div>}
            {common.map((r) => (
              <button type="button" key={r.id} className="menu-item" onClick={() => pick(r)}>
                <span>{wordsFor(r.id, r.label)}</span>
                <span className="menu-id">{r.label} · {r.id}{r.fit === "unknown" ? " · not sure it fits" : ""}</span>
              </button>
            ))}
            {quick !== null && common.length === 0 && <div className="muted">None of the common relations fit these two boxes.</div>}
            <button type="button" className="menu-item" onClick={() => onChoose({ kind: "inherit", name: "", curie: "", words: "is a kind of", own: false })}>
              <span>is a kind of</span>
              <span className="menu-id">{srcName} is a more specific kind of {dstName}</span>
            </button>
          </div>
          <div className="menu-section">
            {mode === "menu" ? (
              <>
                <button type="button" className="link" onClick={() => setMode("own")}>Make your own relation...</button>
                <button type="button" className="link" onClick={() => setMode("all")}>Other relation from the ontology...</button>
              </>
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
