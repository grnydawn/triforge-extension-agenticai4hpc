#!/usr/bin/env bash
#
# fake-triton.sh — deterministic stand-in for the real Triton flood-sim binary.
#
# Used by the E2E harness in place of the actual `triton` executable. The real
# binary is launched with cwd set to the run directory (see ExecutionSetupEditor
# _runInteractive). This fake mirrors that contract:
#   1. prints a few canned startup + timestep progress lines to stdout,
#   2. copies the pre-baked golden outputs into the run directory,
#   3. exits 0.
#
# Run directory resolution (matching how the real run invokes the binary):
#   - if the first non-flag argument is an existing directory, use it,
#   - otherwise fall back to the current working directory (the run dir the
#     extension sets via cwd).
#
# Golden outputs are read from $GOLDEN_OUTPUT_DIR, defaulting to the in-repo
# fixture at test/e2e/fixtures/golden/exe/output relative to this script.

set -euo pipefail

# --- Resolve the run directory -------------------------------------------------
RUN_DIR="$(pwd)"
for arg in "$@"; do
    case "$arg" in
        -*)
            # skip flags / option values like "-c config.cfg"
            ;;
        *)
            if [ -d "$arg" ]; then
                RUN_DIR="$arg"
                break
            fi
            ;;
    esac
done

# --- Resolve the golden output directory --------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_GOLDEN_DIR="$SCRIPT_DIR/../fixtures/golden/exe/output"
GOLDEN_OUTPUT_DIR="${GOLDEN_OUTPUT_DIR:-$DEFAULT_GOLDEN_DIR}"

# --- Canned progress output ---------------------------------------------------
echo "TRITON v0.0-fake starting up"
echo "Reading configuration..."
echo "Initializing domain and DEM grid"
echo "Beginning simulation"
echo "Timestep 1  t=0.0s    completed"
echo "Timestep 2  t=60.0s   completed"
echo "Timestep 3  t=120.0s  completed"
echo "Simulation finished"

# --- Copy golden outputs into the run directory -------------------------------
if [ -d "$GOLDEN_OUTPUT_DIR" ]; then
    mkdir -p "$RUN_DIR"
    # Copy the contents (not the directory itself) into the run dir.
    cp -R "$GOLDEN_OUTPUT_DIR/." "$RUN_DIR/"
    echo "Outputs written to $RUN_DIR"
else
    echo "WARNING: GOLDEN_OUTPUT_DIR not found: $GOLDEN_OUTPUT_DIR" >&2
fi

exit 0
