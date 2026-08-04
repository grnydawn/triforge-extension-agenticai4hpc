# Works but Wrong — paper, code, and artifacts

Source and evidence for *"Works but Wrong: Static Diagnosis of HPC Simulation Setup
Errors for AI Agents"* (AgenticAI4HPC'26, SC26 workshop).

`diagnose_project` is a read-only tool that reads a TRITON flood-simulation project's
configuration and input files — exactly what the solver reads — and reports what is wrong
before any compute is spent. It reaches AI agents over the Model Context Protocol and as
a VS Code language-model tool, and it never launches a process.

The tool ships inside the **Triforge Visual Studio Code Extension** — the Triforge
extension for short — which builds, runs, and visualizes
[TRITON](https://triton-ornl.readthedocs.io/) flood simulations. For the extension
itself, see the [documentation](https://triforge-ornl.readthedocs.io/).

## Contents

| Path | What it is |
|---|---|
| `paper/` | LaTeX source, bibliography, and figures |
| `src/` | The extension and the pure diagnosis core |
| `test/` | Unit and integration tests |
| `eval/diagnose-corpus/` | The 32-project test corpus, verdict reports, run records, and four self-contained reviewer artifact pages |
| `scripts/eval/` | The evaluation harness |

## Reproducing the results

The evidence is layered so a reviewer can stop at any depth. The paper's Artifact
Description appendix carries the full check-list.

**Layer 1 — no AI service, finishes in seconds.**

```bash
npm ci
npm run test:unit
npx tsx scripts/eval/diagnose-report.ts
```

Prints *detection 100% · isolation 100% · clean precision 100%* and rewrites
`eval/diagnose-corpus/report.json`; compare it against the committed copy.

**Layer 2 — adds the real solver, still no AI service.** Build TRITON as the artifact
check-list describes (`eval/diagnose-corpus/triton-build/` carries the CMake settings and
the recorded submodule pins), then:

```bash
export TRITON_EXE=/path/to/your/triton.exe
scripts/eval/run-triton-oracle-corpus.sh
scripts/eval/three-tier-corpus.sh
```

The solver is not shipped — a machine-specific binary is not evidence, and
`eval/diagnose-corpus/build/` is git-ignored. Both scripts find it in this order:
`$TRITON_EXE`, a path remembered from a previous run, then
`eval/diagnose-corpus/build/triton.exe`. If none of those hold an executable and you are
at a terminal, they ask where TRITON is and remember the answer in
`eval/diagnose-corpus/.triton-exe`; with no terminal (CI) they fail and name these
options. They never run without a solver: a failed launch is indistinguishable from a
deck the solver rejects at load time, so an unguarded run would report all 32 fixtures
as `startup-reject` in about two seconds and overwrite `oracle-report.json` with it.

A real run of `three-tier-corpus.sh` prints `mislabels/flags: 0` and `ungrounded: 0` and
exits 0, and reproduces the committed `three-tier-report.json` exactly.

**Layer 3 — the with-versus-without comparison.** Needs both AI clients and network
access to their services, and is the only layer that costs money — 248 agent runs.

Prerequisites: the `claude` and `codex` CLIs installed and signed in, plus `jq`, `bwrap`,
`node`, and `npx`. Each cell runs headless inside a bubblewrap mount namespace that blanks
`$HOME` except the agent toolchain and its auth, so the agent cannot reach the diagnosis
source, the manifest, or sibling fixtures — that needs unprivileged user namespaces, and
the preflight prints the `sysctl` line if they are turned off.

Smoke the whole pipeline on one fixture before committing to the full run:

```bash
scripts/eval/run-study.sh fault-value-range
scripts/eval/run-study.sh                    # all 32 fixtures, both clients, both arms
```

It builds the MCP server, regenerates `runs/prompts.json`, runs each client × arm, grades
every transcript with the blind judge, and prints the Arm A vs Arm C summary per client.
It is resumable: a cell whose transcript already exists is skipped, so re-invoking
continues rather than restarting, and interrupting it is safe.

| Variable | Default | |
|---|---|---|
| `CLIENTS` | `claude codex` | space-separated clients to run |
| `MODEL_CLAUDE` | `sonnet` | |
| `MODEL_CODEX` | `gpt-5.6-sol` | |
| `JUDGE_MODEL` | `sonnet` | the blind judge |
| `DECK_TRIALS` | `3` | deck-fault trials per cell |
| `SKIP_BUILD` | unset | set to `1` to skip `npm run mcp:build` |

Results land in `eval/diagnose-corpus/runs/results-<client>-judged.csv`, with the
transcripts under `runs/transcripts/`. The judge writes a one-line reason per run, so
disagreements can be spot-checked against the transcript and overridden in the CSV.
`scripts/eval/mcp-overhead.py` measures the tool's communication cost separately.

Those outputs are deliberately untracked (see `runs/.gitignore`) — a clone carries the
harness *inputs* (`prompts.json`, `answer-key.md`, `scoring-sheet.csv`) but not the graded
CSVs or transcripts, so this layer produces its own. The graded run records behind the
paper's numbers are published in the Level 3 reviewer artifact page linked below.

**Layer 4 — the judge itself, audited.** Validates the grader rather than reproducing the
result. `scripts/eval/judge-multi.sh <client> <judge>` re-grades the same saved answers
under a stronger judge (`opus`) and one from another family (`codex`), writing to
`runs/robustness/<judge>/` so the originals are untouched; recompute the ablation rows with
`node scripts/eval/tabulate-ablation.mjs eval/diagnose-corpus/runs/robustness/<judge>` (the
path is read relative to the working directory, so give it in full from the repo root), and
see `runs/robustness/README.md` for the finding, which is committed — the per-judge CSVs it
tabulates are not, so re-deriving the table means re-running the re-grade. The human pass is a record rather than a
script — `runs/human-judge-evaluation.csv`, and the browsable page above to re-grade by
hand.

## Reviewer artifacts

`eval/diagnose-corpus/artifacts/` holds four self-contained pages — open any of them in a
browser, no server required. The same four are published at
<https://grnydawn.github.io/triforge-extension-agenticai4hpc/>, so a reviewer can read them
without cloning:

- [`level1-tool-accuracy.html`](https://grnydawn.github.io/triforge-extension-agenticai4hpc/level1-tool-accuracy.html)
  — per-fixture tool accuracy over the 32-project corpus
- [`level2-solver-oracle.html`](https://grnydawn.github.io/triforge-extension-agenticai4hpc/level2-solver-oracle.html)
  — every fixture crossed against the real solver's outcome
- [`level3-ablation.html`](https://grnydawn.github.io/triforge-extension-agenticai4hpc/level3-ablation.html)
  — the ±tool agent-level ablation
- [`human-judge-evaluation.html`](https://grnydawn.github.io/triforge-extension-agenticai4hpc/human-judge-evaluation.html)
  — asks whether to show the expert's judgment on all 248 runs or start blank, then lets you
  re-grade them by hand

## Artifact bundle

`scripts/eval/build-artifact-bundle.sh` assembles the deposit archive. It excludes the
compiled solver tree — machine-specific, and reviewers should rebuild from the recorded
commit rather than trust a binary — and runs an OPSEC redaction and verification pass
before writing anything.

## Licence

Code under MIT (`LICENSE.txt`). The corpus, run records, and reports — the data
generated for this paper — are under CC BY 4.0 (`LICENSE-data.txt`): reuse freely, cite
the paper.
