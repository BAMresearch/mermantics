/**
 * How the result of the checks that run in the browser is worded. They are the fast checks of
 * the Python tool (mermantics --fast): no reasoner. The word "quick check" and the hint below
 * say so wherever the result is shown, so "no problems" is not read as "the model is correct".
 */

export const QUICK_CHECK = "Quick check";

export const QUICK_CHECK_HINT = "The quick check compares the diagram with PMDco 3.1.2: every ID exists and is not "
  + "deprecated, the labels match, each arrow fits the kinds of things its relation connects, and the options in a "
  + "list are kinds of their class. It does not run a reasoner, so it cannot find contradictions that only follow "
  + "from the ontology's axioms.";

/** The result in a few words: "no problems", "2 errors, 1 note", or "empty" for an empty diagram. */
export function resultLine(findings: { level: string }[], empty: boolean): string {
  const counts = (["error", "warning", "note"] as const)
    .map((l) => [l, findings.filter((f) => f.level === l).length] as const).filter(([, n]) => n);
  if (counts.length) return counts.map(([l, n]) => `${n} ${l}${n === 1 ? "" : "s"}`).join(", ");
  return empty ? "empty" : "no problems";
}
