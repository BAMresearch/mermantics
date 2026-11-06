"""Write options/: the design options of the PMD Hackathon - Computations section.

Each option gets three diagrams: terms.mmd, dft.mmd and fem.mmd. Every ID's label is looked
up in PMDco 3.1.2, so the diagrams carry the labels the checker expects, and a wrong ID stops
the script. Run it from web/ after changing the options here:

    npm run fetch-pmdco                 # once, for .cache/pmdco-full-3.1.2.ttl
    python3 scripts/gen-options.py      # or: gen-options.py <pmdco-full.ttl> <options dir>

Needs rdflib (pip install rdflib, or the mermantics package). When the diagrams change, raise
BUILT_IN_VERSION in src/canvas/options.ts, so browsers that kept the old ones pick up the new.
The Terms views are laid out here (indented trees in columns); the example views are laid
out by the canvas.
"""

import json
import sys
from pathlib import Path

from rdflib import Graph, Literal, RDFS, URIRef

WEB = Path(__file__).resolve().parent.parent
PMDCO = Path(sys.argv[1]) if len(sys.argv) > 1 else WEB / ".cache" / "pmdco-full-3.1.2.ttl"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else WEB / "options"
if not PMDCO.exists():
    raise SystemExit(f"{PMDCO} not found; run npm run fetch-pmdco first")
g = Graph()
g.parse(PMDCO, format="turtle")


def iri(cid):
    if cid.startswith("PMD_"):
        return URIRef("https://w3id.org/pmd/co/" + cid)
    return URIRef("http://purl.obolibrary.org/obo/" + cid)


def label(cid):
    for l in g.objects(iri(cid), RDFS.label):
        if isinstance(l, Literal) and l.language in (None, "en"):
            return str(l)
    raise SystemExit(f"no label for {cid}")


KIND = {
    "PMD_0000583": "process", "PMD_0000933": "process", "COB_0000035": "process",
    "IAO_0000030": "information", "PMD_0025035": "data", "IAO_0000027": "data",
    "IAO_0000104": "plan", "IAO_0000005": "plan", "PMD_0000931": "plan", "IAO_0000033": "plan",
    "IAO_0000010": "software", "PMD_0000582": "device", "PMD_0000932": "device",
    # the simulation method specifications are plan specifications
    "PMD_0000585": "plan", "PMD_0000613": "plan", "PMD_0000601": "plan", "PMD_0000951": "plan",
    "PMD_0000786": "plan", "PMD_0000884": "plan",
}
CLASS_DEFS = {
    "local": "classDef local fill:#dbeafe,stroke:#1d4ed8,stroke-width:2px,color:#0f172a",
    "base": "classDef base fill:#e5e7eb,stroke:#6b7280,stroke-width:2px,color:#111827",
    "note": "classDef note fill:#fffbeb,stroke:#d97706,color:#374151",
    "proposed": "classDef proposed fill:#ecfdf5,stroke:#059669,stroke-width:2px,stroke-dasharray:6 3,color:#0f172a",
    "changed": "classDef changed fill:#fff7ed,stroke:#ea580c,stroke-width:2px,color:#0f172a",
    "deprecated": "classDef deprecated fill:#f1f5f9,stroke:#94a3b8,stroke-dasharray:2 2,color:#64748b",
}


def est_height(name, lines):
    """About how tall the canvas draws a box (BoxNode), to lay out the Terms views."""
    h = 30 + 19 * -(-len(name) // 24) + 18
    if lines:
        h += 10
        for line in lines:
            h += 32 if line.startswith("Definition: ") else 16 * -(-len(line) // 34)
    return h


class Diagram:
    def __init__(self, title, intro):
        self.title, self.intro = title, intro
        self.boxes, self.arrows, self.kinds = [], [], {}
        self.children, self.heights, self.positions = {}, {}, None

    def tree_layout(self, columns, col_width=330, indent=26, gap=16):
        """Lay the boxes out as indented trees, one column per list of roots; the rest in a last column."""
        placed, pos = set(), {}
        ids = [b[0] for b in self.boxes]
        extra = [i for i in ids if i not in self._reachable(columns)]
        cols = [c for c in columns] + ([extra] if extra else [])
        x0 = 0
        for col in cols:
            y, width = 0, 0
            stack = [(r, 0) for r in reversed(col)]
            while stack:
                bid, depth = stack.pop()
                if bid in placed:
                    continue
                placed.add(bid)
                pos[bid] = [x0 + depth * indent, y]
                width = max(width, depth * indent + 260)
                y += self.heights[bid] + gap
                for c in reversed(self.children.get(bid, [])):
                    if c not in placed and c not in self._roots(cols):
                        stack.append((c, depth + 1))
            x0 += max(width, col_width - 40) + 70
        self.positions = pos

    def _roots(self, cols):
        return {r for c in cols for r in c}

    def _reachable(self, columns):
        seen, stack = set(), [r for c in columns for r in c]
        while stack:
            b = stack.pop()
            if b in seen:
                continue
            seen.add(b)
            stack.extend(self.children.get(b, []))
        return seen

    def box(self, bid, name, cid, status="", kind=None, lines=()):
        assert all(b[0] != bid for b in self.boxes), bid
        parts = [f"<b>{name}</b>", f"{cid} {label(cid)}"]
        self.heights[bid] = est_height(name, lines)
        if lines:
            parts += [""] + list(lines)
        css = status or "local"
        self.boxes.append((bid, "<br>".join(parts), css))
        k = kind or KIND.get(cid)
        if not k:
            # a process class under computing process, or another kind of thing
            k = "process" if cid in PROCESS_IDS else "other"
        self.kinds[bid] = k
        return bid

    def note(self, bid, name, lines):
        self.boxes.append((bid, "<br>".join([f"<b>{name}</b>"] + list(lines)), "note"))
        self.heights[bid] = 40 + sum(16 * -(-len(line) // 34) for line in lines)

    def isa(self, parent, child):
        self.arrows.append(f"    {parent} --> {child}")
        self.children.setdefault(parent, []).append(child)

    def rel(self, src, cid, dst):
        self.arrows.append(f'    {src} -. "{label(cid)}<br>{cid}" .-> {dst}')

    def text(self):
        ids = {b[0] for b in self.boxes}
        for a in self.arrows:
            for end in (a.split()[0], a.split()[-1]):
                assert end in ids, (self.title, end)
        out = ["flowchart TB", "", f"%% {self.title}"]
        out += [f"%% {line}" for line in self.intro]
        out.append("")
        out += [f'    {bid}["{lab}"]:::{css}' for bid, lab, css in self.boxes]
        out.append("")
        out += self.arrows
        used = {b[2] for b in self.boxes}
        out.append("")
        out += [f"    {d}" for c, d in CLASS_DEFS.items() if c in used]
        out.append("")
        if self.positions:
            out.append("%% mermantics-layout " + json.dumps(self.positions, separators=(",", ":")))
        out.append("%% mermantics-kinds " + json.dumps(self.kinds, separators=(",", ":")))
        out.append("")
        return "\n".join(out)


PROCESS_IDS = {
    "PMD_0025012", "PMD_0000504", "PMD_0000594", "PMD_0000660", "PMD_0000865", "PMD_0000913", "PMD_0000631",
    "PMD_0000783", "PMD_0000821", "PMD_0000964", "PMD_0001003", "PMD_0000862", "PMD_0000527", "PMD_0000866",
    "PMD_0000562", "PMD_0000956", "PMD_0000016", "PMD_0000011",
}

# Relations
INPUT, OUTPUT, PARTICIPANT = "OBI_0000293", "OBI_0000299", "RO_0000057"
EXECUTES, CONCRETIZES, HAS_PART, ABOUT = "STATO_0000102", "RO_0000059", "BFO_0000051", "IAO_0000136"

# Definitions quoted from the proposal (option E, F)
DEF = {
    "computing process": "A planned process in which one or more computing devices execute software to derive "
                         "information content entities (the specified outputs) from information content entities (the specified inputs).",
    "simulation process": "A computing process that answers a computational task by solving one or more models, "
                          "and post-processing the results where needed.",
    "model solution process": "A computing process that applies a solver to a model with given conditions and produces the model's raw results.",
    "post-processing": "A computing process that derives results from raw results without changing the state of the modelled system.",
    "multi-model simulation": "A simulation process that solves two or more models, or one model made of coupled models.",
    "computational task specification": "An objective specification that states what a computation is to determine: "
                                        "which quantities of a modelled system are to be computed, and under which conditions.",
    "simulation specification": "A plan specification that describes a simulation: its computational task, the models "
                                "and solvers to use, and how they are combined.",
    "mathematical model": "An information content entity that represents a system by relations between quantities, "
                          "so that values of some quantities can be derived from others.",
    "physics-based model": "A mathematical model made of one physics equation and one or more materials relations, "
                           "together with the initial and boundary conditions needed to solve it.",
    "data-based model": "A mathematical model whose relation between inputs and outputs is obtained by fitting a general functional form to data.",
    "physics equation": "An information content entity that states a general relation between physics quantities of one "
                        "kind of entity, derived from fundamental physics and valid for all materials.",
    "materials relation": "An information content entity that supplies the values or functions for the parameters of a "
                          "physics equation, valid for the class of materials for which it was made or tested.",
    "interatomic potential": "A materials relation that gives the potential energy of a system of atoms as a function of their positions.",
    "solver specification": "A plan specification that describes the analytical or numerical technique used to solve a model.",
    "analytical solution method": "A solver specification that obtains the solution from closed-form expressions.",
    "numerical method": "A solver specification that approximates the solution by discretization or iteration.",
    "Monte Carlo method": "A numerical method that estimates results from random samples.",
}
TASKS = [
    ("PropertyTask", "property evaluation task", "compute quantities of a modelled system at one given state"),
    ("EquilibriumTask", "equilibrium task", "find a state in which the modelled system is in equilibrium or steady state"),
    ("TimeTask", "time evolution task", "compute how the state of a modelled system changes over time"),
    ("SamplingTask", "sampling task", "compute averages or distributions over many states, drawn from an ensemble"),
    ("ParameterTask", "parameter estimation task", "find values of a model's parameters that agree with given data"),
    ("OptimizationTask", "optimization task", "find design variables that best meet an objective under constraints"),
]
LEVELS = [("Electronic", "electronic", "electrons"), ("Atomistic", "atomistic", "atoms"),
          ("Mesoscopic", "mesoscopic", "grains or groups of atoms"), ("Continuum", "continuum", "continuum volumes")]


def d(text):
    return f"Definition: {text}"


def write(folder, view, diagram):
    path = OUT / folder / f"{view}.mmd"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(diagram.text())


# ---- shared example parts ------------------------------------------------------------------

def dft_common(dg, run, software_rel=EXECUTES):
    dg.box("Structure", "Starting crystal structure", "IAO_0000030")
    dg.box("Relaxed", "Relaxed structure and total energy", "PMD_0025035")
    dg.box("Code", "DFT code", "IAO_0000010", lines=["name, version"])
    dg.box("Node", "Cluster node", "PMD_0000582")
    dg.rel(run, INPUT, "Structure")
    dg.rel(run, OUTPUT, "Relaxed")
    dg.rel(run, software_rel, "Code")
    dg.rel(run, PARTICIPANT, "Node")


def fem_common(dg, run, software_rel=EXECUTES):
    dg.box("Mesh", "Mesh of the bracket, loads and supports", "IAO_0000030")
    dg.box("Stress", "Stress and displacement fields", "PMD_0025035")
    dg.box("Code", "FE solver", "IAO_0000010", lines=["name, version"])
    dg.box("Node", "Workstation", "PMD_0000582")
    dg.rel(run, INPUT, "Mesh")
    dg.rel(run, OUTPUT, "Stress")
    dg.rel(run, software_rel, "Code")
    dg.rel(run, PARTICIPANT, "Node")


DFT_INTRO = ["Materials science: a DFT geometry optimization (relaxation) of a crystal structure."]
FEM_INTRO = ["Engineering: a static finite element analysis of a loaded steel bracket."]

# =============================================================================================
# A. PMDco 3.1.2 today
# =============================================================================================
A = "a-pmdco-3-1-2"
t = Diagram("Option A. PMDco 3.1.2 today: terms", [
    "The computing terms as they are in PMDco 3.1.2. 'axis' says what each subclass is split by."])
t.box("Computing", "computing process", "PMD_0000583")
t.box("Analytical", "analytical calculation", "PMD_0025012", lines=["axis: solver"])
t.box("Simulation", "simulation process", "PMD_0000933")
t.isa("Computing", "Analytical")
t.isa("Computing", "Simulation")
for bid, cid, axis in [
    ("AIMD", "PMD_0000504", "method"), ("EmpiricalMD", "PMD_0000631", "method"), ("MonteCarlo", "PMD_0000862", "method"),
    ("Multiscale", "PMD_0000866", "scale"), ("StructuralOpt", "PMD_0000956", "purpose"),
    ("HighThroughput", "PMD_0000783", "throughput"), ("MachineLearning", "PMD_0000821", "data-driven method"),
    ("DeepLearning", "PMD_0000594", "data-driven method"),
]:
    t.box(bid, label(cid), cid, lines=[f"axis: {axis}"])
    t.isa("Simulation", bid)
t.box("AtomisticMC", "atomistic monte carlo simulation", "PMD_0000527", lines=["axis: scale"])
t.isa("MonteCarlo", "AtomisticMC")
t.box("CoarseGrained", "coarse grained simulation", "PMD_0000562", lines=["axis: scale"])
t.isa("Multiscale", "CoarseGrained")
t.box("MethodSpec", "simulation method specification", "PMD_0000931")
for bid, cid, axis in [("Continuous", "PMD_0000585", "time handling"), ("DiscreteEvent", "PMD_0000613", "time handling"),
                       ("Deterministic", "PMD_0000601", "randomness"), ("Stochastic", "PMD_0000951", "randomness"),
                       ("Hybrid", "PMD_0000786", "mix"), ("Physical", "PMD_0000884", "physical or computational")]:
    t.box(bid, label(cid), cid, lines=[f"axis: {axis}"])
    t.isa("MethodSpec", bid)
t.note("Note", "What to look at", [
    "Siblings under simulation process are split by method, scale, purpose, throughput and learning.",
    "There is no plain molecular dynamics, and no class for continuum or FEM calculations.",
    "The method specifications are plan specifications, but their labels read like processes.",
])
t.tree_layout([["Computing"], ["MethodSpec"], ["Note"]])
write(A, "terms", t)

x = Diagram("Option A. PMDco 3.1.2 today: DFT geometry optimization", DFT_INTRO)
x.box("Relaxation", "DFT relaxation", "PMD_0000956")
x.box("Settings", "PBE, plane waves, BFGS", "PMD_0000931", lines=["functional, cutoff, k-points, force threshold"])
x.rel("Relaxation", CONCRETIZES, "Settings")
dft_common(x, "Relaxation", software_rel=CONCRETIZES)
x.note("Note", "What to look at", [
    "The class says the purpose: structural optimization.",
    "Nothing says that this is DFT, or which level of model is used; that is only in the settings text.",
])
write(A, "dft", x)

x = Diagram("Option A. PMDco 3.1.2 today: static FEM analysis", FEM_INTRO)
x.box("Analysis", "Static analysis of a bracket", "PMD_0000933")
x.box("Settings", "Linear static FE settings", "PMD_0000585", lines=["also: deterministic simulation"])
x.rel("Analysis", CONCRETIZES, "Settings")
fem_common(x, "Analysis", software_rel=CONCRETIZES)
x.note("Note", "What to look at", [
    "No class for continuum, FEM or structural analysis: only simulation process.",
    "The closest terms are plan specifications (continuous, deterministic).",
])
write(A, "fem", x)

# =============================================================================================
# B. Method tree
# =============================================================================================
B = "b-method-tree"
t = Diagram("Option B. Method tree: terms", [
    "simulation process split by method, as ASMO does for atomistic methods. New methods and",
    "purposes become new classes. Added for comparison."])
t.box("Computing", "computing process", "PMD_0000583")
t.box("Simulation", "simulation process", "PMD_0000933")
t.isa("Computing", "Simulation")
methods = [("DFT", "DFT calculation"), ("MD", "molecular dynamics simulation"), ("FEM", "finite element simulation"),
           ("CFD", "computational fluid dynamics simulation"), ("PhaseField", "phase field simulation")]
for bid, name in methods:
    t.box(bid, name, "PMD_0000933", "proposed", "process")
    t.isa("Simulation", bid)
t.box("MonteCarlo", "monte carlo simulation", "PMD_0000862")
t.isa("Simulation", "MonteCarlo")
t.box("AtomisticMC", "atomistic monte carlo simulation", "PMD_0000527")
t.isa("MonteCarlo", "AtomisticMC")
t.box("MachineLearning", "machine learning", "PMD_0000821")
t.isa("Simulation", "MachineLearning")
t.box("AIMD", "ab initio molecular dynamics simulation", "PMD_0000504", "changed", lines=["now under DFT and MD"])
t.isa("DFT", "AIMD")
t.isa("MD", "AIMD")
t.box("EmpiricalMD", "empirical potential molecular dynamics simulation", "PMD_0000631", "changed", lines=["now under MD"])
t.isa("MD", "EmpiricalMD")
t.box("DFTOpt", "DFT geometry optimization", "PMD_0000933", "proposed", "process", lines=["method and purpose combined"])
t.isa("DFT", "DFTOpt")
t.box("FEMStatic", "FEM static analysis", "PMD_0000933", "proposed", "process", lines=["method and purpose combined"])
t.isa("FEM", "FEMStatic")
t.note("Note", "What to look at", [
    "Every new method needs a class here, and every method with a purpose needs another one.",
    "Purpose and scale classes (structural optimization, multiscale, high throughput) do not fit this axis.",
    "Methods that combine others (ab initio MD) need two parents.",
])
t.tree_layout([["Computing"], ["Note"]])
write(B, "terms", t)

x = Diagram("Option B. Method tree: DFT geometry optimization", DFT_INTRO)
x.box("Relaxation", "DFT relaxation", "PMD_0000933", "proposed", "process", lines=["is a: DFT geometry optimization"])
x.box("Settings", "PBE, plane waves, BFGS", "IAO_0000104", lines=["functional, cutoff, k-points, force threshold"])
x.rel("Relaxation", EXECUTES, "Settings")
dft_common(x, "Relaxation")
x.note("Note", "What to look at", [
    "The class says both method and purpose, so it is easy to find.",
    "The model (Kohn-Sham with PBE) and the solver are only settings text.",
])
write(B, "dft", x)

x = Diagram("Option B. Method tree: static FEM analysis", FEM_INTRO)
x.box("Analysis", "Static analysis of a bracket", "PMD_0000933", "proposed", "process", lines=["is a: FEM static analysis"])
x.box("Settings", "Linear static FE settings", "IAO_0000104", lines=["element type, material law, load case"])
x.rel("Analysis", EXECUTES, "Settings")
fem_common(x, "Analysis")
x.note("Note", "What to look at", [
    "Works the same way as DFT, but needs its own pair of classes.",
    "The material law (Hooke) is only settings text.",
])
write(B, "fem", x)

# =============================================================================================
# C. One axis: model level
# =============================================================================================
C = "c-model-level"
t = Diagram("Option C. One axis, model level: terms", [
    "simulation process split by the level of the model's physics equation (CWA 17284).",
    "Task and solver are linked, not subclasses. Added for comparison."])
t.box("Computing", "computing process", "PMD_0000583")
t.box("Simulation", "simulation process", "PMD_0000933")
t.isa("Computing", "Simulation")
for bid, lvl, ent in LEVELS:
    t.box(bid, f"{lvl} simulation" if lvl != "electronic" else "electronic structure simulation", "PMD_0000933", "proposed",
          "process", lines=[f"model describes {ent}"])
    t.isa("Simulation", bid)
t.box("DataBased", "data-based simulation", "PMD_0000933", "proposed", "process", lines=["model fitted to data"])
t.isa("Simulation", "DataBased")
t.box("AIMD", "ab initio molecular dynamics simulation", "PMD_0000504", "changed", lines=["now under electronic and atomistic"])
t.isa("Electronic", "AIMD")
t.isa("Atomistic", "AIMD")
t.box("EmpiricalMD", "empirical potential molecular dynamics simulation", "PMD_0000631", "changed")
t.isa("Atomistic", "EmpiricalMD")
t.box("AtomisticMC", "atomistic Monte Carlo simulation", "PMD_0000527", "changed")
t.isa("Atomistic", "AtomisticMC")
t.box("CoarseGrained", "coarse-grained simulation", "PMD_0000562", "changed")
t.isa("Mesoscopic", "CoarseGrained")
t.box("MachineLearning", "machine learning", "PMD_0000821", "changed")
t.isa("DataBased", "MachineLearning")
t.box("Multiscale", "multiscale simulation", "PMD_0000866")
t.isa("Simulation", "Multiscale")
t.box("MonteCarlo", "monte carlo simulation", "PMD_0000862", "deprecated", lines=["becomes a solver: Monte Carlo method"])
t.box("StructuralOpt", "structural optimization simulation", "PMD_0000956", "deprecated", lines=["becomes a task: equilibrium"])
t.box("Task", "computational task specification", "IAO_0000005", "proposed")
for bid, name, what in TASKS:
    t.box(bid, name, "IAO_0000005", "proposed", lines=[f"to {what}"])
    t.isa("Task", bid)
t.box("Solver", "simulation method specification", "PMD_0000931")
t.box("MCMethod", "Monte Carlo method", "PMD_0000931", "proposed")
t.isa("Solver", "MCMethod")
t.rel("Simulation", EXECUTES, "Task")
t.rel("Simulation", EXECUTES, "Solver")
t.note("Note", "What to look at", [
    "One clear rule for the tree: the level of the model. Methods go to domain ontologies.",
    "Ab initio MD and QM/MM need two parents. Multiscale does not fit one level.",
    "Task and solver are there, but not used to classify.",
])
t.tree_layout([["Computing"], ["Task"], ["Solver", "MonteCarlo", "StructuralOpt"], ["Note"]])
write(C, "terms", t)

x = Diagram("Option C. One axis, model level: DFT geometry optimization", DFT_INTRO)
x.box("Relaxation", "DFT relaxation", "PMD_0000933", "proposed", "process", lines=["is a: electronic structure simulation"])
x.box("Task", "Find the lowest-energy structure", "IAO_0000005", "proposed", lines=["is a: equilibrium task"])
x.box("Solver", "SCF and BFGS", "PMD_0000931", lines=["functional, cutoff, k-points in the settings"])
x.rel("Relaxation", EXECUTES, "Task")
x.rel("Relaxation", EXECUTES, "Solver")
dft_common(x, "Relaxation")
x.note("Note", "What to look at", [
    "The class says the level, the task is a link. Geometry optimization is a query: this class plus an equilibrium task.",
    "The functional is still settings text.",
])
write(C, "dft", x)

x = Diagram("Option C. One axis, model level: static FEM analysis", FEM_INTRO)
x.box("Analysis", "Static analysis of a bracket", "PMD_0000933", "proposed", "process", lines=["is a: continuum simulation"])
x.box("Task", "Find the stresses under load", "IAO_0000005", "proposed", lines=["is a: equilibrium task"])
x.box("Solver", "Finite element method", "PMD_0000931", lines=["element type, material law in the settings"])
x.rel("Analysis", EXECUTES, "Task")
x.rel("Analysis", EXECUTES, "Solver")
fem_common(x, "Analysis")
x.note("Note", "What to look at", [
    "Same shape as the DFT case, with another level class.",
])
write(C, "fem", x)

# =============================================================================================
# D. Several axes, asserted
# =============================================================================================
D = "d-asserted-facets"
t = Diagram("Option D. Several axes, asserted: terms", [
    "Two parallel asserted trees under simulation process: by model level and by task. A specific kind",
    "is asserted under one class of each. Added for comparison."])
t.box("Computing", "computing process", "PMD_0000583")
t.box("Simulation", "simulation process", "PMD_0000933")
t.isa("Computing", "Simulation")
t.box("ByLevel", "simulation by model level", "PMD_0000933", "proposed", "process", lines=["grouping class"])
t.box("ByTask", "simulation by task", "PMD_0000933", "proposed", "process", lines=["grouping class"])
t.isa("Simulation", "ByLevel")
t.isa("Simulation", "ByTask")
for bid, lvl, ent in LEVELS:
    t.box(bid, f"{lvl} simulation" if lvl != "electronic" else "electronic structure simulation", "PMD_0000933", "proposed", "process")
    t.isa("ByLevel", bid)
t.box("DataBased", "data-based simulation", "PMD_0000933", "proposed", "process")
t.isa("ByLevel", "DataBased")
for bid, name in [("EquilibriumSim", "equilibrium simulation"), ("TimeSim", "time evolution simulation"),
                  ("SamplingSim", "sampling simulation"), ("PropertySim", "property evaluation"),
                  ("ParameterEst", "parameter estimation"), ("OptimizationSim", "design optimization")]:
    t.box(bid, name, "PMD_0000933", "proposed", "process")
    t.isa("ByTask", bid)
t.box("GeometryOpt", "geometry optimization", "PMD_0000956", "changed", lines=["relabelled; under equilibrium"])
t.isa("EquilibriumSim", "GeometryOpt")
t.box("AIMD", "ab initio molecular dynamics simulation", "PMD_0000504", "changed", lines=["three parents"])
t.isa("Electronic", "AIMD")
t.isa("Atomistic", "AIMD")
t.isa("TimeSim", "AIMD")
t.box("EmpiricalMD", "empirical potential molecular dynamics simulation", "PMD_0000631", "changed")
t.isa("Atomistic", "EmpiricalMD")
t.isa("TimeSim", "EmpiricalMD")
t.box("AtomisticMC", "atomistic Monte Carlo simulation", "PMD_0000527", "changed")
t.isa("Atomistic", "AtomisticMC")
t.isa("SamplingSim", "AtomisticMC")
t.box("MachineLearning", "machine learning model training", "PMD_0000821", "changed")
t.isa("DataBased", "MachineLearning")
t.isa("ParameterEst", "MachineLearning")
t.box("CoarseGrained", "coarse-grained simulation", "PMD_0000562", "changed")
t.isa("Mesoscopic", "CoarseGrained")
t.note("Note", "What to look at", [
    "Each kind is asserted by hand under one class per axis.",
    "With two axes of 5 and 6 classes, up to 30 combined classes; a third axis multiplies again.",
    "Nothing checks that a computation's model and task match the classes asserted.",
])
t.tree_layout([["Computing"], ["ByTask"], ["Note"]])
write(D, "terms", t)

x = Diagram("Option D. Several axes, asserted: DFT geometry optimization", DFT_INTRO)
x.box("Relaxation", "DFT relaxation", "PMD_0000956", "changed", "process",
      lines=["is a: geometry optimization", "is a: electronic structure simulation"])
x.box("Settings", "PBE, plane waves, BFGS", "IAO_0000104", lines=["functional, cutoff, k-points, force threshold"])
x.rel("Relaxation", EXECUTES, "Settings")
dft_common(x, "Relaxation")
x.note("Note", "What to look at", [
    "Two asserted types, both written by hand.",
    "If someone asserts continuum simulation here instead, nothing notices.",
])
write(D, "dft", x)

x = Diagram("Option D. Several axes, asserted: static FEM analysis", FEM_INTRO)
x.box("Analysis", "Static analysis of a bracket", "PMD_0000933", "proposed", "process",
      lines=["is a: continuum simulation", "is a: equilibrium simulation"])
x.box("Settings", "Linear static FE settings", "IAO_0000104", lines=["element type, material law, load case"])
x.rel("Analysis", EXECUTES, "Settings")
fem_common(x, "Analysis")
x.note("Note", "What to look at", [
    "Same two asserted types as in the DFT case, one from each tree.",
])
write(D, "fem", x)

# =============================================================================================
# E. Task, model and solver as parts (the proposal) and F. Parts only
# =============================================================================================

def parts_terms(dg, defined):
    """The task, model and solver parts, shared by E and F. `defined`: add E's defined kinds."""
    dg.box("Computing", "computing process", "PMD_0000583", "changed", lines=[d(DEF["computing process"])])
    dg.box("Simulation", "simulation process", "PMD_0000933", "changed", lines=[d(DEF["simulation process"])])
    dg.isa("Computing", "Simulation")
    dg.box("ModelSolution", "model solution process", "PMD_0000583", "proposed", "process", lines=[d(DEF["model solution process"])])
    dg.box("PostProcessing", "post-processing", "PMD_0000583", "proposed", "process", lines=[d(DEF["post-processing"])])
    dg.isa("Computing", "ModelSolution")
    dg.isa("Computing", "PostProcessing")
    dg.box("WorkflowRun", "workflow run", "PMD_0000016", "changed", "process")
    dg.isa("Computing", "WorkflowRun")
    dg.box("HighThroughput", "high throughput simulation", "PMD_0000783", "changed", "process",
           lines=["a workflow run with many simulations as parts"])
    dg.isa("WorkflowRun", "HighThroughput")
    # task
    dg.box("SimSpec", "simulation specification", "IAO_0000104", "proposed", lines=[d(DEF["simulation specification"])])
    dg.box("Task", "computational task specification", "IAO_0000005", "proposed", lines=[d(DEF["computational task specification"])])
    for bid, name, what in TASKS:
        dg.box(bid, name, "IAO_0000005", "proposed", lines=[f"to {what}"])
        dg.isa("Task", bid)
    dg.rel("SimSpec", HAS_PART, "Task")
    # model
    dg.box("Model", "mathematical model", "IAO_0000030", "proposed", lines=[d(DEF["mathematical model"])])
    dg.box("PhysicsModel", "physics-based model", "IAO_0000030", "proposed", lines=[d(DEF["physics-based model"])])
    dg.box("DataModel", "data-based model", "IAO_0000030", "proposed", lines=[d(DEF["data-based model"])])
    dg.isa("Model", "PhysicsModel")
    dg.isa("Model", "DataModel")
    dg.box("Equation", "physics equation", "IAO_0000030", "proposed", lines=[d(DEF["physics equation"])])
    for bid, lvl, ent in LEVELS:
        dg.box(f"{bid}Eq", f"{lvl} physics equation", "IAO_0000030", "proposed", lines=[f"about {ent}"])
        dg.isa("Equation", f"{bid}Eq")
    dg.box("MaterialsRelation", "materials relation", "IAO_0000030", "proposed", lines=[d(DEF["materials relation"])])
    dg.box("Potential", "interatomic potential", "IAO_0000030", "proposed", lines=[d(DEF["interatomic potential"])])
    dg.isa("MaterialsRelation", "Potential")
    dg.rel("PhysicsModel", HAS_PART, "Equation")
    dg.rel("PhysicsModel", HAS_PART, "MaterialsRelation")
    # solver
    dg.box("Solver", "solver specification", "PMD_0000931", "changed", lines=["relabelled", d(DEF["solver specification"])])
    dg.box("AnalyticalMethod", "analytical solution method", "PMD_0000931", "proposed", lines=[d(DEF["analytical solution method"])])
    dg.box("NumericalMethod", "numerical method", "PMD_0000931", "proposed", lines=[d(DEF["numerical method"])])
    dg.box("MCMethod", "Monte Carlo method", "PMD_0000931", "proposed", lines=[d(DEF["Monte Carlo method"])])
    dg.box("Stochastic", "stochastic simulation", "PMD_0000951")
    dg.isa("Solver", "AnalyticalMethod")
    dg.isa("Solver", "NumericalMethod")
    dg.isa("NumericalMethod", "MCMethod")
    dg.isa("Stochastic", "MCMethod")
    dg.box("Physical", "physical simulation", "PMD_0000884", "deprecated", lines=["a lab process (Gleeble), not a computation"])
    # how a simulation is put together
    dg.rel("Simulation", EXECUTES, "SimSpec")
    dg.rel("Simulation", HAS_PART, "ModelSolution")
    dg.rel("ModelSolution", INPUT, "Model")
    dg.rel("ModelSolution", EXECUTES, "Solver")
    # execution
    dg.box("Device", "computing device", "PMD_0000582", "changed", lines=["Definition: A device that executes software."])
    dg.box("Software", "software", "IAO_0000010")
    dg.box("Image", "execution environment image", "IAO_0000010", "proposed", lines=["a container or virtual machine image"])
    dg.isa("Software", "Image")
    dg.rel("Computing", PARTICIPANT, "Device")
    dg.rel("Computing", EXECUTES, "Software")
    dg.box("SimDevice", "simulation device", "PMD_0000932", "deprecated", lines=["replaced by computing device"])
    dg.box("SimRole", "simulation entity role", "PMD_0000051", "deprecated", "other",
           lines=["a model can be about a specimen (is about) instead"])
    if defined:
        dg.box("MultiModel", "multi-model simulation", "PMD_0000933", "proposed", "process", lines=[d(DEF["multi-model simulation"])])
        dg.isa("Simulation", "MultiModel")
        dg.box("Multiscale", "multiscale simulation", "PMD_0000866", "changed", "process")
        dg.isa("MultiModel", "Multiscale")
        for bid, name, cid, status, rule in [
            ("ElectronicCalc", "electronic structure calculation", "PMD_0000933", "proposed",
             "a simulation whose model has an electronic physics equation"),
            ("ContinuumSim", "continuum simulation", "PMD_0000933", "proposed",
             "a simulation whose model has a continuum physics equation"),
            ("GeometryOpt", "geometry optimization", "PMD_0000956", "changed",
             "an equilibrium task, and a model with an electronic or atomistic equation"),
            ("AIMD", "ab initio molecular dynamics simulation", "PMD_0000504", "changed",
             "a time evolution task, and a model with an electronic and an atomistic equation"),
            ("EmpiricalMD", "empirical potential molecular dynamics simulation", "PMD_0000631", "changed",
             "a time evolution task, and a model with an atomistic equation and an interatomic potential"),
            ("CoarseGrained", "coarse-grained simulation", "PMD_0000562", "changed",
             "a model with a mesoscopic equation (subclass, not defined)"),
        ]:
            dg.box(bid, name, cid, status, "process", lines=[f"Defined: {rule}"])
            dg.isa("Simulation", bid)
        for bid, name, cid, status, rule in [
            ("MonteCarlo", "Monte Carlo simulation", "PMD_0000862", "changed", "a computing process that executes a Monte Carlo method"),
            ("Analytical", "analytical calculation", "PMD_0025012", "changed",
             "a computing process that executes an analytical solution method"),
            ("ParameterEst", "parameter estimation", "PMD_0000583", "proposed", "a computing process that addresses a parameter estimation task"),
        ]:
            dg.box(bid, name, cid, status, "process", lines=[f"Defined: {rule}"])
            dg.isa("Computing", bid)
        dg.box("AtomisticMC", "atomistic Monte Carlo simulation", "PMD_0000527", "changed", "process",
               lines=["Defined: a Monte Carlo simulation whose model has an atomistic equation"])
        dg.isa("MonteCarlo", "AtomisticMC")
        dg.box("MachineLearning", "machine learning model training", "PMD_0000821", "changed", "process",
               lines=["Defined: a parameter estimation with a data-based model as input"])
        dg.isa("ParameterEst", "MachineLearning")
        dg.box("DeepLearning", "deep learning", "PMD_0000594", "changed", "process")
        dg.box("Reinforcement", "reinforcement learning", "PMD_0000913", "changed", "process")
        dg.isa("MachineLearning", "DeepLearning")
        dg.isa("MachineLearning", "Reinforcement")
    else:
        for bid, cid in [("Multiscale", "PMD_0000866"), ("CoarseGrained", "PMD_0000562"), ("StructuralOpt", "PMD_0000956"),
                         ("AIMD", "PMD_0000504"), ("EmpiricalMD", "PMD_0000631"), ("MonteCarlo", "PMD_0000862"),
                         ("AtomisticMC", "PMD_0000527"), ("Analytical", "PMD_0025012"), ("MachineLearning", "PMD_0000821"),
                         ("DeepLearning", "PMD_0000594")]:
            dg.box(bid, label(cid), cid, "deprecated", "process", lines=["moves to a domain ontology or a vocabulary"])


def parts_dft(dg):
    dg.box("Relaxation", "DFT relaxation", "PMD_0000933")
    dg.box("Spec", "Relaxation settings", "IAO_0000104", "proposed", lines=["is a: simulation specification"])
    dg.box("Task", "Find the lowest-energy structure", "IAO_0000005", "proposed", lines=["is a: equilibrium task"])
    dg.box("Solve", "Solve the Kohn-Sham equations", "PMD_0000583", "proposed", "process", lines=["is a: model solution process"])
    dg.box("DFTModel", "DFT model", "IAO_0000030", "proposed", lines=["is a: physics-based model"])
    dg.box("KS", "Kohn-Sham equations", "IAO_0000030", "proposed", lines=["is a: electronic physics equation"])
    dg.box("PBE", "PBE functional", "IAO_0000030", "proposed", lines=["is a: materials relation"])
    dg.box("SCF", "SCF and BFGS", "PMD_0000931", "proposed", lines=["is a: numerical method", "cutoff, k-points, force threshold"])
    dg.rel("Relaxation", EXECUTES, "Spec")
    dg.rel("Spec", HAS_PART, "Task")
    dg.rel("Relaxation", HAS_PART, "Solve")
    dg.rel("Solve", INPUT, "DFTModel")
    dg.rel("Solve", EXECUTES, "SCF")
    dg.rel("DFTModel", HAS_PART, "KS")
    dg.rel("DFTModel", HAS_PART, "PBE")
    dft_common(dg, "Relaxation")


def parts_fem(dg):
    dg.box("Analysis", "Static analysis of a bracket", "PMD_0000933")
    dg.box("Spec", "Load case settings", "IAO_0000104", "proposed", lines=["is a: simulation specification"])
    dg.box("Task", "Find the stresses under load", "IAO_0000005", "proposed", lines=["is a: equilibrium task"])
    dg.box("Solve", "Solve the elasticity problem", "PMD_0000583", "proposed", "process", lines=["is a: model solution process"])
    dg.box("ElasticModel", "Linear elastic model", "IAO_0000030", "proposed", lines=["is a: physics-based model"])
    dg.box("Balance", "Momentum balance", "IAO_0000030", "proposed", lines=["is a: continuum physics equation"])
    dg.box("Hooke", "Hooke's law for the steel", "IAO_0000030", "proposed", lines=["is a: materials relation"])
    dg.box("FEMethod", "Finite element method", "PMD_0000931", "proposed", lines=["is a: numerical method", "element type, mesh size"])
    dg.rel("Analysis", EXECUTES, "Spec")
    dg.rel("Spec", HAS_PART, "Task")
    dg.rel("Analysis", HAS_PART, "Solve")
    dg.rel("Solve", INPUT, "ElasticModel")
    dg.rel("Solve", EXECUTES, "FEMethod")
    dg.rel("ElasticModel", HAS_PART, "Balance")
    dg.rel("ElasticModel", HAS_PART, "Hooke")
    fem_common(dg, "Analysis")


E = "e-task-model-solver"
t = Diagram("Option E. Task, model and solver as parts: terms", [
    "A simulation executes a specification with its task, and has a model solution process with a model",
    "as input and a solver. Kinds of simulation are defined classes that a reasoner assigns from these parts.",
    "Draft proposal, not reviewed. Workflow nodes, assignments and parameters are left out of this view."])
parts_terms(t, defined=True)
t.tree_layout([["Computing"], ["Simulation"], ["SimSpec", "Task"], ["Model", "Equation", "MaterialsRelation"],
               ["Solver", "Stochastic", "Physical"], ["Device", "Software", "SimDevice", "SimRole"]])
write(E, "terms", t)

x = Diagram("Option E. Task, model and solver as parts: DFT geometry optimization", DFT_INTRO)
parts_dft(x)
x.note("Note", "What to look at", [
    "Asserted only as simulation process, with its task, model and solver.",
    "A reasoner infers: electronic structure calculation (the model has an electronic equation)",
    "and geometry optimization (equilibrium task).",
])
write(E, "dft", x)

x = Diagram("Option E. Task, model and solver as parts: static FEM analysis", FEM_INTRO)
parts_fem(x)
x.note("Note", "What to look at", [
    "Same pattern as the DFT case.",
    "A reasoner infers: continuum simulation. Not geometry optimization: the task is equilibrium,",
    "but the model has no electronic or atomistic equation.",
])
write(E, "fem", x)

F = "f-parts-only"
t = Diagram("Option F. Parts only: terms", [
    "The same parts as option E, but the core names no kinds of computation. Domain ontologies or a",
    "vocabulary name them. Added for comparison."])
parts_terms(t, defined=False)
t.tree_layout([["Computing"], ["Simulation", "Multiscale", "CoarseGrained", "StructuralOpt", "AIMD", "EmpiricalMD", "MonteCarlo",
                "AtomisticMC", "Analytical", "MachineLearning", "DeepLearning"], ["SimSpec", "Task"],
               ["Model", "Equation", "MaterialsRelation"], ["Solver", "Stochastic", "Physical"],
               ["Device", "Software", "SimDevice", "SimRole"]])
write(F, "terms", t)

x = Diagram("Option F. Parts only: DFT geometry optimization", DFT_INTRO)
parts_dft(x)
x.note("Note", "What to look at", [
    "The same data as in option E.",
    "Nothing is inferred in the core. Geometry optimization is a query (equilibrium task, and a model",
    "with an electronic or atomistic equation), or a class in a domain ontology.",
])
write(F, "dft", x)

x = Diagram("Option F. Parts only: static FEM analysis", FEM_INTRO)
parts_fem(x)
x.note("Note", "What to look at", [
    "The same data as in option E. Continuum simulation is a query, or a class in a domain ontology.",
])
write(F, "fem", x)

print("written to", OUT)
