# Computation modeling decisions (PR #70)

The diagrams target [PMDco 3.1.2](https://raw.githubusercontent.com/materialdigital/core-ontology/v3.1.2/pmdco-full.ttl), including its imported OBI, IAO, RO and STATO axioms. The local test copy is `web/.cache/pmdco-full-3.1.2.ttl`. This review covers all 18 option views and the computation-task-model-solver and workflow-step-assignments patterns. The quick checker validates references, labels and asserted domain/range compatibility; it does not prove scientific correctness or run an OWL reasoner.

## Intention, completion and achievement

Confirmed in that release:

- `IAO_0000005` (objective specification) describes an intended endpoint. `IAO_0000104` (plan specification) has objective and action specifications as parts (`BFO_0000051`). Trying to achieve an objective is distinct from achieving it.
- `OBI_0000417` (achieves_planned_objective) requires the endpoint criteria to have been met. Its domain is `COB_0000035` (completely executed planned process), and its range is objective specification. Do not use it as a generic intention link.
- `PMD_0000583` (computing process) is explicitly under `COB_0000035`; `PMD_0000933` (simulation process) inherits that restriction. Both specified-input/output properties (`OBI_0000293`, `OBI_0000299`) also have that domain. Removing only the achievement arrow would therefore still imply completion.

Option C now shows the intended task through `process —concretizes→ plan specification —has part→ objective specification`. This is a workshop modeling choice combining IAO's part structure with PMDco's process concretization convention, not an asserted PMDco simulation axiom. No new class or property identifier is introduced. Action specifications remain implicit, as in the existing E/F pattern.

C's DFT/FEM runs use `COB_0000082` (planned process), whose definition requires initiation and intention, not completion. Their physics level is descriptive; they are not asserted to be PMDco simulation processes or members of its completed-process level tree. C's terms view retains that tree below computing process and adds its existing planned-process ancestor. The plan/task path also applies to completed computations through this ancestor.

C links the input information with `RO_0000057` (has participant), following PMDco's allowance for information participants; the box label identifies its input purpose, while the relation itself is deliberately less specific. `RO_0002233` (has input) was rejected because its textual definition requires a material entity modified during the process, despite lacking an explicit range axiom. Produced data use `RO_0002234` (has output), whose definition requires presence at the end and a changed state, not full execution of the plan. Neither chosen property imposes complete execution. The output boxes describe produced data, not necessarily converged results. Omit output boxes/arrows if nothing was produced. A successful, failed, interrupted or unconverged attempt can retain the same intended task. An attempt never initiated is not a planned process instance: represent just its plan. Record `achieves_planned_objective` separately only with evidence that the objective was met; absence of that assertion does not prove failure.

A, B, D, E and F and the computation pattern retain PMDco types and specified I/O: these are completed-computation examples, not universal failed-run templates. PMDco's workflow classes also inherit completion. This restriction comes from the published ontology and is not silently removed from option A or the workflow pattern. Their completion does not itself establish convergence or task achievement.

## Relation audit

`RO_0000059` in PMDco 3.1.2 has domain **process OR specifically dependent continuant** and range **generically dependent continuant**. The release contains both older continuant-only prose and newer process-inclusive prose. The process-inclusive axiom and workflow restrictions support the convention used here; it should not be assumed portable to every older RO/BFO import.

`STATO_0000102` describes a planned process carrying out a plan specification. Its chain is `BFO_0000055` (realizes) followed by `RO_0000059` (concretizes). PMDco declares no direct domain/range for it. A chain axiom is an implication, not an OWL equivalence between the two properties. Neither lack of domain/range warnings nor similarity of English wording makes executes and concretizes interchangeable.

Every concretization target in the options and the two reviewed patterns was checked by category:

| Edges | Target and decision |
| --- | --- |
| A/B/D run → Settings; C run → Spec; E/F run → Spec/SimSpec; computation pattern → Specification | Plan specifications or simulation method specifications. Retain concretizes as the explicit process embodiment convention. For C this does not assert completion or achievement. |
| C run → Solver; E/F Solve → SCF/FEMethod; E/F terms ModelSolution → Solver; computation pattern ModelSolution → Solver | `PMD_0000931` is a subclass of plan specification. These boxes denote method instructions, not software or the numerical solution process itself. Retain concretizes; do not concretize the input mathematical model. |
| All option run → Code; E/F Computing → Software; computation pattern → Software | `IAO_0000010` is explicitly a plan specification in this release. The running process concretizes the program; the computing device participates. This is not a claim that the device concretizes the program. |
| Workflow Run → Definition and Step → Function | Directly supported by PMDco's workflow class restrictions using concretizes. Retain both. |
| Model, equation, mesh, initial structure, result, task | No generic concretization substitution. Models/data remain inputs/outputs, equations and tasks remain parts of their respective information entities. Intended task is not an achieved objective. |

Although executes can describe carrying out plan specifications, adding it here would introduce a second convention without additional execution/realizable-plan structure. Retaining concretizes is a deliberate minimal PMDco-aligned choice, not a declaration that the two properties are equivalent. Descriptions now use concretizes for these arrows. “A device that executes software” remains ordinary explanatory language, not a STATO property assertion.

The published [simulation input/output pattern](https://github.com/materialdigital/core-ontology/blob/v3.1.2/patterns/simulation%20inout%20simple/pattern.md) concerns information assignments and does not establish simulation-to-specification arrows. We do not cite it as evidence for those arrows. The workflow extension uses the actual workflow axioms: both `PMD_0000011` and `PMD_0000016` have subclass intersection expressions containing computing process; node concretizes workflow function, run concretizes workflow definition. Option A's subclass arrows are therefore retained.

## Scientific and proposal boundaries

General AIMD is not a subclass of DFT. Electronic forces can come from other electronic-structure methods; see the [CP2K methods paper](https://arxiv.org/abs/2003.03868) and [AIMD review](https://doi.org/10.1155/2018/9839641). B retains its proposed MD parent, removes the DFT parent, and explicitly labels the reclassification as a proposal. No extra DFT-based AIMD class is needed for these examples.

[ASMO's published definitions](https://ocdo.github.io/asmo/) place AIMD, DFT and MD under Computational Method and connect activities to methods with has computational method. They do not assert B's proposed process hierarchy. PMDco defines AIMD using quantum-mechanical calculations and asserts only simulation process as its named parent. C/D's electronic/atomistic placements are proposed level classifications, not new PMDco entailments.

The DFT relaxation objective is a local energy minimum, not a guaranteed global minimum. Equilibrium alone is insufficient to identify geometry optimization: E/F descriptions now require a geometry-relaxation objective. E's class criteria are proposals; they are not implemented OWL definitions, and absence of an inferred type is not its negation. A full formalization of these proposed classes remains workshop work.

The existing PMDco simulation-process definition mentions evolution over time, whereas these alternatives include static calculations. That broadening, and reuse of simulation method specification as the base for generic solver proposals, are proposal-level choices, not confirmed PMDco definitions. Option A preserves the published classes; E/F's changed/proposed markings distinguish the alternatives. No equivalence between a method, mathematical model, program and executing process is asserted by these diagrams.

Storage behavior is unchanged: saved workshop diagrams override built-in templates. Existing sessions need a deliberate reset/import to adopt corrected templates; this PR adds no migration or automatic replacement.
