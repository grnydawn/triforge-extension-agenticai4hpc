#!/usr/bin/env bash
#
# fake-sbatch.sh — deterministic stand-in for the SLURM `sbatch` submit command.
#
# The real batch path (ExecutionSetupEditor _runBatch) invokes `sbatch <script>`
# and parses the "Submitted batch job <id>" line from stdout. This fake prints
# exactly that line with a fixed job id and exits 0.

set -euo pipefail

echo "Submitted batch job 1"
exit 0
