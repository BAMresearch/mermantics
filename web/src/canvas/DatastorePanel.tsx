/**
 * The side panel parts of the BAM Data Store section: the object or dataset type of a box, where
 * the object lives (Space > Project > Collection), and an overview of where everything goes.
 */

import { useEffect, useMemo, useState } from "react";

import { BAM_DATASET_TYPES, BAM_OBJECT_TYPES, BAM_TYPES_SOURCE, type BamType } from "./bamTypes.js";
import type { Box, BoxData } from "./model.js";
import { AREAS, DATASTORE_KINDS, IS_ATTACHED_TO, IS_CHILD_OF, IS_PARENT_OF, kindForType, openbisFor, spaceAfterMove, spacesFor,
         type OpenbisInfo,
         type ShapeKind } from "./palette.js";

const MAX_HITS = 25;

function findType(code: string, dataset: boolean): BamType | undefined {
  return (dataset ? BAM_DATASET_TYPES : BAM_OBJECT_TYPES).find((t) => t.code === code);
}

/** Types matching every word of the query, in code or description; closer matches first. */
function searchTypes(query: string, dataset: boolean): BamType[] {
  const words = query.toLowerCase().split(/[\s_.]+/).filter((w) => w);
  const list = dataset ? BAM_DATASET_TYPES : BAM_OBJECT_TYPES;
  if (!words.length) return [];
  const hay = (t: BamType) => `${t.code.replace(/[_.]/g, " ")} ${t.description}`.toLowerCase();
  const score = (t: BamType) => {
    const last = t.code.split(".").pop()!.toLowerCase().replace(/_/g, " ");
    return (last === words.join(" ") ? 0 : last.startsWith(words[0]!) ? 1 : 2) * 1000 + t.code.length;
  };
  return list.filter((t) => words.every((w) => hay(t).includes(w))).sort((a, b) => score(a) - score(b));
}

/** The type of a box: one of BAM's, a new one the group proposes, or not decided yet. */
function TypePicker({ value, dataset, onPick }: { value: string; dataset: boolean; onPick: (code: string) => void }) {
  const [changing, setChanging] = useState(false);
  const [query, setQuery] = useState("");
  const known = value ? findType(value, dataset) : undefined;
  const hits = useMemo(() => searchTypes(query, dataset), [query, dataset]);
  // Before anything is typed: the more specific BAM types of the current one, e.g. EXPERIMENTAL_STEP.SEM.
  const family = useMemo(() => {
    if (query.trim() || !value) return [];
    const top = value.split(".")[0];
    return (dataset ? BAM_DATASET_TYPES : BAM_OBJECT_TYPES).filter((t) => t.code.startsWith(`${top}.`) && t.code !== value);
  }, [query, value, dataset]);
  const proposed = query.trim().toUpperCase().replace(/[^A-Z0-9_.]+/g, "_").replace(/^_+|_+$/g, "");
  const pick = (code: string) => { onPick(code); setQuery(""); setChanging(false); };
  const shown = query.trim() ? hits : family;

  return (
    <>
      {value ? (
        <div className="class-card">
          <div className="class-label">{value}</div>
          {known ? (known.description && <p className="class-def">{known.description}</p>)
            : <p className="class-def new-type">Not a BAM type yet: a new type to propose for the Data Store.</p>}
          {!changing && <button type="button" className="link" onClick={() => setChanging(true)}>Choose another type...</button>}
        </div>
      ) : (
        <p className="muted">{dataset ? "Pick the kind of files, or leave it open for now."
          : "Not decided yet. That is fine: the guide says to leave the type open if an object does not clearly belong to a group."}</p>
      )}
      {(changing || !value) && (
        <div className="term-search">
          <input value={query} autoFocus={changing}
                 placeholder={dataset ? "Search dataset types, e.g. raw data" : "Search BAM object types, e.g. microscopy, SOP"}
                 onChange={(e) => setQuery(e.target.value)} />
          {shown.length > 0 && (
            <ul className="term-hits ds-hits">
              {!query.trim() && <li className="term-more">More specific kinds of {value.split(".")[0]}:</li>}
              {shown.slice(0, MAX_HITS).map((t) => (
                <li key={t.code}>
                  <button type="button" onClick={() => pick(t.code)}>
                    <span className="term-label">{t.code}</span>
                    {t.description && <span className="term-def">{t.description}</span>}
                  </button>
                </li>
              ))}
              {shown.length > MAX_HITS && <li className="term-more">{shown.length - MAX_HITS} more, type more words to narrow down</li>}
            </ul>
          )}
          {proposed && !findType(proposed, dataset) && (
            <button type="button" className="link" onClick={() => pick(proposed)}>Use {proposed} as a new type</button>
          )}
          <div className="type-actions">
            {value && <button type="button" className="link" onClick={() => pick("")}>Not decided yet</button>}
            {changing && <button type="button" className="link" onClick={() => { setChanging(false); setQuery(""); }}>Cancel</button>}
          </div>
        </div>
      )}
    </>
  );
}

/** Values already used in the model for one field, offered while typing so names stay the same. */
function used(boxes: Box[], key: keyof OpenbisInfo): string[] {
  return [...new Set(boxes.map((b) => b.data.openbis?.[key] ?? "").filter((v) => v))].sort();
}

/**
 * The Data Store part of a box's panel. Changing the type can change the shape: an
 * EXPERIMENTAL_STEP.SEM is drawn as an experimental step. Where the object lives follows the new
 * shape too, unless the group already changed it.
 */
export function DatastoreBoxSection({ data, boxes, onChange }: {
  data: BoxData;
  boxes: Box[];
  onChange: (patch: Partial<BoxData>) => void;
}) {
  const o = data.openbis ?? openbisFor(data.kind);
  const dataset = data.kind === "dataset";
  const set = (patch: Partial<OpenbisInfo>) => onChange({ openbis: { ...o, ...patch } });

  const pickType = (code: string) => {
    if (dataset) return set({ type: code });
    const kind: ShapeKind = code ? kindForType(code) : data.kind;
    if (kind === data.kind) return set({ type: code });
    const before = openbisFor(data.kind);
    const after = openbisFor(kind);
    const place = (k: keyof OpenbisInfo) => (o[k] === before[k] ? after[k] : o[k]);
    onChange({ kind, openbis: { type: code, area: place("area"), space: place("space"), project: place("project"),
                                collection: place("collection") } });
  };

  const field = (key: keyof OpenbisInfo, label: string, placeholder: string) => (
    <label className="field">
      {label}
      <input value={o[key]} placeholder={placeholder} list={`ds-${key}`} onChange={(e) => set({ [key]: e.target.value })} />
      <datalist id={`ds-${key}`}>{used(boxes, key).map((v) => <option key={v} value={v} />)}</datalist>
    </label>
  );

  return (
    <>
      <section className="panel-section">
        <h3>{dataset ? "Dataset type" : "Object type"}</h3>
        <TypePicker value={o.type} dataset={dataset} onPick={pickType} />
      </section>
      {dataset ? (
        <section className="panel-section">
          <p className="muted">A dataset holds the files of the object it is attached to, usually the experimental step that
            made them. Draw an arrow between the two.</p>
        </section>
      ) : (
        <section className="panel-section">
          <h3>Where it lives</h3>
          <label className="field">
            Lab Notebook or Inventory
            <select value={o.area} onChange={(e) => set({ area: e.target.value, space: spaceAfterMove(o.space, e.target.value) })}>
              <option value="">not decided yet</option>
              {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
              {o.area && !AREAS.includes(o.area) && <option value={o.area}>{o.area}</option>}
            </select>
          </label>
          <label className="field">
            Space
            {/* The Spaces are given by the Data Store; a name from an older file is kept, but marked. */}
            <select value={o.space} disabled={!o.area} onChange={(e) => set({ space: e.target.value })}>
              <option value="">{o.area ? "not decided yet" : "choose Lab Notebook or Inventory first"}</option>
              {spacesFor(o.area).map((sp) => <option key={sp} value={sp}>{sp}</option>)}
              {o.space && !spacesFor(o.area).includes(o.space) && <option value={o.space}>{o.space} (not a Data Store Space)</option>}
            </select>
          </label>
          {field("project", "Project", "e.g. CONSUMABLES")}
          {field("collection", "Collection", "e.g. Chemicals")}
          <p className="muted-inline">Things you do go in the Lab Notebook; things you have or use go in an Inventory
            (BAM-Inventory: shared across divisions; FB-Inventory: within your division, where FB stands for your division's
            code). The Spaces are given by the Data Store; agree on the Project and Collection names with your group.</p>
        </section>
      )}
    </>
  );
}

/** The sentence for an arrow of the Data Store section, and ways to turn it around. */
export function DatastoreArrowSection({ srcName, dstName, name, onFlip, onSwap }: {
  srcName: string;
  dstName: string;
  name: string; // is parent of, is child of, is attached to
  onFlip: () => void; // the same link, read from the other end
  onSwap: () => void; // the other one becomes the parent
}) {
  if (name === IS_ATTACHED_TO) {
    return (
      <section className="panel-section">
        <p className="sentence">The dataset <b>{srcName}</b> is attached to <b>{dstName}</b>.</p>
        <p className="muted-inline">A dataset holds the files of one object, usually the experimental step that made them.</p>
      </section>
    );
  }
  const parentOf = name === IS_PARENT_OF;
  const [parent, child] = parentOf ? [srcName, dstName] : [dstName, srcName];
  return (
    <section className="panel-section">
      <p className="sentence"><b>{srcName}</b> {name} <b>{dstName}</b>.</p>
      <p className="muted-inline">In openBIS: <b>{parent}</b> is the parent, <b>{child}</b> the child. An object can have many
        parents and many children.</p>
      <button type="button" className="link" onClick={onFlip}>Write it as "{child} {parentOf ? IS_CHILD_OF : IS_PARENT_OF} {parent}"</button>
      <button type="button" className="link" onClick={onSwap}>Swap: make {child} the parent</button>
    </section>
  );
}

/** Asked when two objects are linked: which one is the parent? */
export function DatastoreLinkMenu({ x, y, srcName, dstName, onChoose, onCancel }: {
  x: number;
  y: number;
  srcName: string;
  dstName: string;
  onChoose: (name: string) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="menu ds-link-menu" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="menu-head">How are they linked?</div>
      <div className="menu-section">
        {[IS_PARENT_OF, IS_CHILD_OF].map((name, i) => (
          <button type="button" key={name} className="menu-item" autoFocus={i === 0} onClick={() => onChoose(name)}>
            <span><b>{srcName}</b> {name} <b>{dstName}</b></span>
            <span className="menu-id">{i === 0 ? `${srcName} is the parent` : `${dstName} is the parent`}</span>
          </button>
        ))}
      </div>
      <div className="menu-section">
        <button type="button" className="menu-item small" onClick={onCancel}><span>Cancel</span></button>
      </div>
    </div>
  );
}

/** Space > Project > Collection, with the objects in each, like step 3 of the guide. */
export function WhereThingsGo({ boxes, onSelect }: { boxes: Box[]; onSelect: (id: string) => void }) {
  const objects = boxes.filter((b) => DATASTORE_KINDS.has(b.data.kind) && b.data.kind !== "dataset");
  if (!objects.length) return null;
  const tree = new Map<string, Map<string, Box[]>>();
  const open: Box[] = [];
  for (const b of objects) {
    const o = b.data.openbis;
    if (!o || (!o.space && !o.project && !o.collection)) {
      open.push(b);
      continue;
    }
    const top = [o.area, o.space || "?"].filter((x) => x).join(" · ");
    const rest = `${o.project || "?"} › ${o.collection || "?"}`;
    const inner = tree.get(top) ?? new Map<string, Box[]>();
    inner.set(rest, [...(inner.get(rest) ?? []), b]);
    tree.set(top, inner);
  }
  const datasets = boxes.filter((b) => b.data.kind === "dataset").length;
  const link = (b: Box) => (
    <button type="button" key={b.id} className={`ds-chip kind-${b.data.kind}`} onClick={() => onSelect(b.id)}>{b.data.name || b.id}</button>
  );
  return (
    <section className="panel-section">
      <h3>Where things go</h3>
      <ul className="ds-tree">
        {[...tree.entries()].sort().map(([top, inner]) => (
          <li key={top}>
            <div className="ds-space">{top}</div>
            <ul>
              {[...inner.entries()].sort().map(([rest, bs]) => (
                <li key={rest}><div className="ds-coll">{rest}</div><div className="ds-chips">{bs.map(link)}</div></li>
              ))}
            </ul>
          </li>
        ))}
        {open.length > 0 && (
          <li><div className="ds-space muted-inline">Not placed yet</div><div className="ds-chips">{open.map(link)}</div></li>
        )}
      </ul>
      {datasets > 0 && <p className="muted-inline">{datasets} dataset{datasets === 1 ? "" : "s"}, stored with their objects.</p>}
      <p className="muted-inline">Object types from {BAM_TYPES_SOURCE}.</p>
    </section>
  );
}
