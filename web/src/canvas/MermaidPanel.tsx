import { useEffect, useMemo, useState } from "react";

/**
 * The diagram as Mermaid text, read-only, to see or copy what the canvas writes. The
 * mermantics comment lines (box positions, use case, patterns) are left out, so the text is
 * short enough to paste into a README; "Export → Mermaid diagram" keeps them.
 */
export function MermaidPanel({ text, onClose }: { text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const shown = useMemo(
    () => text.split("\n").filter((l) => !l.trim().startsWith("%% mermantics-")).join("\n").trimEnd() + "\n",
    [text],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => setCopied(false), [shown]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
    } catch { /* clipboard can be off; the text can still be selected */ }
  };

  return (
    <div className="mermaid-panel" role="dialog" aria-label="The diagram as Mermaid">
      <div className="mermaid-head">
        <b>Mermaid</b>
        <span className="bar-spacer" />
        <button type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>
      <pre className="mermaid-text">{shown}</pre>
      <p className="muted-inline mermaid-foot">What the canvas saves, updated as you draw. Box positions and other mermantics notes are left out here; Export → Mermaid diagram keeps them.</p>
    </div>
  );
}
