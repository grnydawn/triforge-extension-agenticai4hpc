#!/usr/bin/env bash
# Run one diagnose-corpus fixture through the real TRITON solver and classify the outcome.
# Usage: run-triton-oracle.sh <fixture-dir> [timeout-seconds]
# Emits <fixture-dir>/oracle.json and prints the outcome. Never mutates the fixture.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORPUS="$(cd "$HERE/../../eval/diagnose-corpus" && pwd)"
TRITON_EXE="$CORPUS/build/triton.exe"
FIX="${1:?fixture dir required}"; TIMEOUT="${2:-120}"
FIXDIR="$(cd "$FIX" && pwd)"; NAME="$(basename "$FIXDIR")"

RUN="$(mktemp -d)" || { echo "mktemp failed" >&2; exit 1; }
case "$RUN" in /*) ;; *) echo "bad rundir: $RUN" >&2; exit 1;; esac
trap 'rm -rf "$RUN"' EXIT
cp -r "$FIXDIR/." "$RUN/"
mkdir -p "$RUN/output"   # decks that write rasters need the output tree present

LOG="$RUN/triton.stdout.txt"
( cd "$RUN" && timeout "$TIMEOUT" mpirun -n 1 "$TRITON_EXE" run.cfg ) >"$LOG" 2>&1
CODE=$?

# Primary divergence signal: TRITON's own stdout, where it prints nan/inf stats.
# -w so 'inf' does not match TRITON's own [INFO] log line.
nan=0; grep -qiwE 'nan|inf' "$LOG" && nan=1
# Secondary, ASCII-only scan of output rasters: -I skips binary files, since NaN
# in binary rasters is raw IEEE-754 bytes (not the text "nan") and would false-positive.
grep -qRIiwE 'nan|inf' "$RUN/output" 2>/dev/null && nan=1
ends=0; grep -q 'Simulation ends' "$LOG" && ends=1
# 'Simulation starts' marks the solver entering the timestepping loop. A failure
# AFTER this point is a mid-run blow-up/crash (diverged); a failure BEFORE it is a
# load-time reject. Distinguishing them is what keeps a SIGSEGV/NaN mid-run out of
# the startup-reject bucket.
starts=0; grep -q 'Simulation starts' "$LOG" && starts=1

if [ "$nan" -eq 1 ]; then
  OUTCOME="ran-but-diverged"                        # NaN/Inf in stdout or ASCII output
elif [ "$ends" -eq 1 ]; then
  OUTCOME="ran-to-completion"
elif [ "$CODE" -ne 0 ] && [ "$starts" -eq 1 ]; then
  OUTCOME="ran-but-diverged"                        # started timestepping, then failed mid-run
elif [ "$CODE" -ne 0 ]; then
  OUTCOME="startup-reject"                           # failed before Simulation starts (load-time)
else
  OUTCOME="startup-reject"                           # exited without completing and without a NaN signal
fi
[ "$CODE" -eq 124 ] && OUTCOME="ran-but-diverged"   # timeout while running

printf '{"fixture":"%s","outcome":"%s","exitCode":%d,"timedOut":%s,"nan":%s}\n' \
  "$NAME" "$OUTCOME" "$CODE" "$([ "$CODE" -eq 124 ] && echo true || echo false)" \
  "$([ "$nan" -eq 1 ] && echo true || echo false)" > "$FIXDIR/oracle.json"
echo "$NAME -> $OUTCOME (exit $CODE)"
