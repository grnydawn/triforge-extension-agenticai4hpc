#!/usr/bin/env bash
# Three-tier ground-truth for ONE corpus fixture:
#   Tier-1  run the real TRITON solver (reject/crash => authoritative FAULT)
#   Tier-2  if it ran to completion, scan the output rasters (output-sanity.ts):
#             insane => silent-corruption FAULT; review => escalate; sane => candidate-clean
#   Tier-3  is a human's job — this script never emits "clean", only "candidate-clean".
#
# Unlike run-triton-oracle.sh, this PRESERVES the run's output/ so Tier-2 can read it.
# Usage: scan-fixture-output.sh <fixture-dir> [timeout-seconds]
# Prints a combined JSON verdict; leaves the run dir under $KEEP for inspection.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORPUS="$(cd "$HERE/../../eval/diagnose-corpus" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
FIX="${1:?fixture dir required}"; TIMEOUT="${2:-120}"
FIXDIR="$(cd "$FIX" && pwd)"; NAME="$(basename "$FIXDIR")"
. "$HERE/resolve-triton.sh" || exit 1

KEEP="$(mktemp -d)" || { echo "mktemp failed" >&2; exit 1; }
case "$KEEP" in /*) ;; *) echo "bad rundir: $KEEP" >&2; exit 1;; esac
cp -r "$FIXDIR/." "$KEEP/"
mkdir -p "$KEEP/output"

# Probe the run's PHYSICS without touching the committed fixture: the corpus decks don't
# configure output, so enable it ONLY in this throwaway copy. Output settings are orthogonal
# to the injected fault (grid mismatch, OOB zone, etc.), so this stays faithful to the label
# while giving Tier-2 rasters to scan. Only appended when absent (corpus decks have none).
if ! grep -qiE '^\s*max_value_print_option' "$KEEP/run.cfg"; then
  {
    echo ''
    echo 'output_format=ASC'
    echo 'max_value_print_option=h'   # MAX water depth (MH) — the peak field
    echo 'output_option=SEQ'
    # Scan MAX-depth, not instantaneous h: these minimal synthetic decks let the SWE solver
    # drift the instantaneous field to NaN late in the run (it tolerates NaN and still exits
    # 0), whereas MAX-depth captures the real pre-drift peak — and MH is exactly the field
    # where the operational out-of-bounds corruption showed up. No outfile_pattern: with one unset,
    # TRITON writes a single raster to the run root (a per-variable/timestep layout needs a
    # writable output/ tree, which depends on the finicky project_dir derivation).
  } >> "$KEEP/run.cfg"
fi

LOG="$KEEP/triton.stdout.txt"
( cd "$KEEP" && timeout "$TIMEOUT" mpirun -n 1 "$TRITON_EXE" run.cfg ) >"$LOG" 2>&1
CODE=$?

# --- Tier-1: run/reject/diverge (same classifier as run-triton-oracle.sh) ---
ends=0;   grep -q 'Simulation ends'   "$LOG" && ends=1
starts=0; grep -q 'Simulation starts' "$LOG" && starts=1
nanlog=0; grep -qiwE 'nan|inf' "$LOG" && nanlog=1
if   [ "$CODE" -eq 124 ];                         then TIER1="ran-but-diverged"
elif [ "$nanlog" -eq 1 ];                         then TIER1="ran-but-diverged"
elif [ "$ends" -eq 1 ];                           then TIER1="ran-to-completion"
elif [ "$CODE" -ne 0 ] && [ "$starts" -eq 1 ];    then TIER1="ran-but-diverged"
else                                                   TIER1="startup-reject"
fi

# --- Tier-2: output-sanity scan (only meaningful when it completed) ---
TIER2="n/a"; TIER2_JSON='null'; TIER2_ERR=''
if [ "$TIER1" = "ran-to-completion" ]; then
  # scan the whole run dir: TRITON writes output/{asc,bin}/<var>_<id>.out with an
  # outfile_pattern, or a bare .out at the run root without one.
  TIER2_RAW="$(cd "$REPO" && npx ts-node scripts/eval/output-sanity.ts "$KEEP" 2>"$KEEP/tier2.stderr")"
  TIER2_CODE=$?
  # compact to one line so the combined verdict below stays single-line (parseable by callers)
  # jq exits 0 on empty input and prints nothing, so a bare `||` fallback never fires and the
  # printf below would emit `"tier2Detail":` with no value — a malformed line that the caller
  # can only read as "no verdict". Check the result is non-empty, not just that jq passed.
  TIER2_JSON="$(printf '%s' "$TIER2_RAW" | jq -c . 2>/dev/null)"
  [ -n "$TIER2_JSON" ] || TIER2_JSON='null'
  # Take the verdict from the scan's own JSON, not from its exit code. output-sanity.ts
  # exits 1 for "review", and npx/ts-node exit 1 for their own reasons (dependency not
  # installed, compile error) — reading the code alone files a scan that never ran as a
  # scan that asked for a human. A verdict here means it ran; no verdict means it did not.
  TIER2="$(printf '%s' "$TIER2_JSON" | jq -r '.verdict // empty' 2>/dev/null)"
  case "$TIER2" in
    sane|review|insane) ;;
    *) TIER2="error"
       # Node leads with a source excerpt and trails with a stack, so neither the head nor
       # the tail of stderr is the message. Take the first Error: line, which is.
       TIER2_ERR="$(grep -m1 -E '^[A-Za-z.]*Error' "$KEEP/tier2.stderr" 2>/dev/null)"
       [ -n "$TIER2_ERR" ] || TIER2_ERR="$(tr '\n' ' ' <"$KEEP/tier2.stderr" 2>/dev/null)"
       [ -n "$TIER2_ERR" ] || TIER2_ERR="output-sanity.ts exited $TIER2_CODE without a verdict"
       TIER2_ERR="$(printf '%s' "$TIER2_ERR" | head -c 200)"
       ;;
  esac
fi
if [ -n "$TIER2_ERR" ]; then TIER2_ERR_JSON="$(printf '%s' "$TIER2_ERR" | jq -Rs . 2>/dev/null || echo '""')"
else TIER2_ERR_JSON='null'; fi

# --- combine into the three-tier ground-truth label ---
case "$TIER1" in
  startup-reject|ran-but-diverged) GROUND="FAULT" ;;      # Tier-1 authoritative
  ran-to-completion)
    case "$TIER2" in
      insane)  GROUND="FAULT" ;;                          # silent corruption
      review)  GROUND="REVIEW" ;;                         # -> Tier-3 human
      sane)    GROUND="CANDIDATE-CLEAN" ;;                # -> Tier-3 sign-off
      # The scan never ran, so this fixture has no Tier-2 evidence either way. That is
      # not a question for Tier-3, it is a broken run: ground it as ERROR so the caller
      # counts it ungrounded rather than filing it behind a human review that would
      # never arrive.
      *)       GROUND="ERROR" ;;
    esac ;;
esac

printf '{"fixture":"%s","tier1":"%s","tier2":"%s","exitCode":%d,"ground":"%s","runDir":"%s","tier2Error":%s,"tier2Detail":%s}\n' \
  "$NAME" "$TIER1" "$TIER2" "$CODE" "$GROUND" "$KEEP" "$TIER2_ERR_JSON" "$TIER2_JSON"
