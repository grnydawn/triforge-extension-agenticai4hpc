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

**Layer 2 — adds the real solver, still no AI service.** Build TRITON from the upstream
commit recorded in the artifact check-list, then:

```bash
scripts/eval/run-triton-oracle-corpus.sh
scripts/eval/three-tier-corpus.sh
```

**Layer 3 — the with-versus-without comparison.** Needs both AI clients and network
access to their services, and is the only layer that costs money:
`scripts/eval/run-study.sh`.

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
  — an interactive tool for re-grading all 248 runs by hand

## Artifact bundle

`scripts/eval/build-artifact-bundle.sh` assembles the deposit archive. It excludes the
compiled solver tree — machine-specific, and reviewers should rebuild from the recorded
commit rather than trust a binary — and runs an OPSEC redaction and verification pass
before writing anything.

## Licence

Code under MIT (`LICENSE.txt`). The corpus, run records, and reports — the data
generated for this paper — are under CC BY 4.0 (`LICENSE-data.txt`): reuse freely, cite
the paper.
