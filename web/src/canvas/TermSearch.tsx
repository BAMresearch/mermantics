import { useEffect, useState } from "react";

import type { Term } from "../core/terms.js";
import { search } from "./checker.js";

/** Search the ontology for a class, by words or ID. */
const CLASS_KINDS = ["class"];

export function TermSearch({ onPick, placeholder, kinds = CLASS_KINDS }: {
  onPick: (term: Term) => void;
  placeholder: string;
  kinds?: string[];
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Term[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      setTotal(0);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      search(query, kinds, 12).then((r) => {
        if (!live) return;
        setHits(r.terms.filter((t) => t.id));
        setTotal(r.total);
      }).catch(() => {});
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, kinds.join(" ")]);

  return (
    <div className="term-search">
      <input value={query} placeholder={placeholder} onChange={(e) => setQuery(e.target.value)} />
      {hits.length > 0 && (
        <ul className="term-hits">
          {hits.map((t) => (
            <li key={t.iri}>
              <button type="button" onClick={() => { onPick(t); setQuery(""); }} className={t.deprecated ? "deprecated" : ""}>
                <span className="term-label">{t.label}</span>
                <span className="term-id">{t.id}{t.deprecated ? " (deprecated)" : ""}</span>
                {t.definition && <span className="term-def">{t.definition}</span>}
              </button>
            </li>
          ))}
          {total > hits.length && <li className="term-more">{total - hits.length} more, type more words to narrow down</li>}
        </ul>
      )}
    </div>
  );
}
