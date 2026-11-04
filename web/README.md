# mermantics web

The web version of mermantics: the same checks as the Python tool, ported to TypeScript,
running entirely in the browser. It is published at **https://ebb2675.github.io/mermantics/**.

For now it runs the fast checks (IDs, labels, domain and range, vocabularies), the same as
`mermantics --fast`. The reasoner checks (schema and example data) are not ported yet.

## Run it

Needs Node 22.12 or newer.

```bash
cd web
npm install
npm run dev        # http://localhost:5173/
```

`npm run dev` and `npm run build` first download PMDco 3.1.1 into `.cache/` (once) and copy
it to `public/ontology/`, so the page can load it. Neither copy is committed.

## Test

```bash
npm test             # fast tests
PMDCO=1 npm test     # also the tests that load PMDco (from .cache/, or PMDCO_FILE=...)
npm run typecheck
```

The parity tests compare the TypeScript checks with JSON output of the Python CLI, saved in
`tests/golden/`. `npm run golden:fast` makes those files again (it needs the Python package
installed in `web/.venv`, see `scripts/make-golden-fast.sh`).

## Build

```bash
npm run build      # into dist/, for the path /mermantics/
npm run preview    # serve dist/ locally to try the build
```

`dist/` is a plain static site: no server code and no special headers. Pushing to `main`
builds and deploys it with `.github/workflows/pages.yml` (only when `web/`, `assets/` or the
workflow change).

## Layout

| Folder | What is in it |
|---|---|
| `src/core/` | The checker, ported module by module from `src/mermantics/`. Pure TypeScript with no DOM, so it runs in Node (tests) and in the browser. Also `edit.ts` (text edits for the forms) and `terms.ts` (ontology term search). |
| `src/worker/` | A Web Worker that holds the ontology and runs the checks and term searches, so the page never freezes. |
| `src/canvas/` | The page: a canvas editor (React and React Flow) that writes the diagram as Mermaid and checks it in the worker. |
| `examples/` | The example diagrams in the page's Examples menu. |
| `patterns/` | The built-in patterns in the canvas palette. |
| `scripts/` | Downloading PMDco and making the golden files. |
| `tests/` | vitest tests. |

The canvas keeps the boxes and arrows in memory and writes them as Mermaid after each
change; that Mermaid text is what is checked, saved and downloaded. Box positions, box kinds
(the shape a box is drawn as), use case notes and patterns go into `%% mermantics-...`
comment lines, which Mermaid and the checker ignore.

The canvas has two sections, set up in `src/canvas/mode.ts`: process modelling (plain
shapes and relations, no ontology, no checks) and materials science and engineering
(PMDco, checked as you draw). The start page picks one; `?mode=process` or `?mode=mse` in
the URL opens a section directly. Each section keeps its own diagram in the browser.
