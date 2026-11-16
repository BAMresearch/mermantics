# mermantics web

The web version of mermantics: the same checks as the Python tool, ported to TypeScript,
running entirely in the browser. It is published at **https://bamresearch.github.io/mermantics/**.

For now it runs the fast checks (IDs, labels, domain and range, vocabularies), the same as
`mermantics --fast`. The reasoner checks (schema and example data) are not ported yet.

## Run it

Needs Node 22.12 or newer.

```bash
cd web
npm install
npm run dev        # http://localhost:5173/
```

`npm run dev` and `npm run build` first download PMDco 3.1.2 into `.cache/` (once) and copy
it to `public/ontology/`, so the page can load it. Neither copy is committed.

## Test

```bash
npm ci
npm run typecheck
npm run fetch-pmdco   # download before running the PMDco tests
npm run test:pmdco    # all web tests, including PMDco
npm run build        # production build
```

These are the web checks run by `.github/workflows/validate.yml` on relevant pull requests
and pushes. For a quick run without PMDco, use `npm test`; that skips the PMDco tests.
`PMDCO_FILE=/path/to/pmdco-full.ttl npm run test:pmdco` uses an existing ontology file.

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
| `options/` | The design options of the computations section: one folder per option, with `terms.mmd`, `dft.mmd` and `fem.mmd`. Written by `scripts/gen-options.py`; change the script, not the files. |
| `scripts/` | Downloading PMDco, making the golden files, `bam-types.py`, which writes the BAM Data Store object and dataset types (`src/canvas/bamTypes.ts`) from a bam-masterdata checkout, and `gen-options.py`, which writes the design options in `options/` with their labels looked up in PMDco. |
| `tests/` | vitest tests. |

The canvas keeps the boxes and arrows in memory and writes them as Mermaid after each
change; that Mermaid text is what is checked, saved and downloaded. Box positions, box kinds
(the shape a box is drawn as), use case notes and patterns go into `%% mermantics-...`
comment lines, which Mermaid and the checker ignore.

Click a box to edit its full details in the side panel, or double-click it to rename it
on the canvas. Enter or clicking away saves the name; Esc cancels. Saved edits update
the Mermaid source and rerun checks in sections that support checking.

The canvas has four sections, set up in `src/canvas/mode.ts`: process modelling (plain
shapes and relations, no ontology, no checks), materials science and engineering (PMDco,
checked as you draw), BAM Data Store (openBIS object types, no ontology) and PMD Hackathon -
Computations (PMDco, with design options). The start page picks one; `?mode=process`,
`?mode=mse`, `?mode=datastore` or `?mode=comp` in the URL opens a section directly. Each
section keeps its own diagram in the browser tab (`src/canvas/saved.ts`): reloading or going
back to the page keeps it, a new tab starts from the current examples, and nothing is kept
until something is changed. Closing a tab that holds work asks first.

The computations section works with design options instead of one diagram: each option in
`options/` has three diagrams (its terms, a DFT geometry optimization and a static FEM
analysis), and the section shows them one at a time or side by side (`src/canvas/options.ts`,
`Options.tsx`). Boxes have the style class `proposed`, `changed` or `deprecated` when an option
adds, changes or removes a term; `termsTree.ts` places them in the PMDco class tree. The
group's notes and the use case are kept with the options in the browser tab, and "Export → Workshop results"
writes all of it as one Markdown file.

Document replacement and layout are coordinated in `src/canvas/document.ts` and `App.tsx`.
Every open (including New, Import, Examples and option resets) invalidates work for the
previous document before asynchronous work starts. Only the latest load or layout may
commit; deferred viewport fitting and failures obey the same ownership checks. Unmount
invalidates outstanding work too. Pending edits are flushed to the view actually on the
canvas before switching, and its save destination stays attached until the replacement commits.

Layout merges positions into the current boxes rather than restoring a snapshot. Renames,
kind changes, additions and deletions survive; a box moved since layout started, or still
being dragged, keeps its position. The opening baseline is committed with the document,
so measurement updates cannot leave autosaving disabled. `tests/app-lifecycle.test.ts`
exercises the editor with controlled promises and timers in happy-dom; `document.test.ts`
covers layout merging. These tests do not exercise React Flow's browser rendering.

Connection menus carry the document identity and are revoked when closed, replaced, or
interrupted by a document or view change. Both relation choices and Data Store links check
that their endpoints still exist when committed; replacement choices also require the
original arrow. Connections cannot start while a replacement document is loading.
The lifecycle tests retain old menu callbacks to verify that interrupted choices cannot
create dangling arrows or phantom boxes after saving and reopening.

Pattern insertion prepares classification and layout on a copy with pattern-local IDs before
changing the diagram. On success, `remapInsertion` in `patterns.ts`, the only place insertion IDs
are chosen, picks free box, arrow and pattern-use IDs against the current diagram and moves arrow
endpoints and each part's box reference along. The canvas publishes these IDs to its refs at once,
so overlapping completions are safe even within one React batch, and places clicked copies at
commit time so they do not overlap. Document replacement discards pending insertions; failures
leave the graph and metadata intact. The lifecycle tests control completion order and verify the
saved Mermaid round trip.
