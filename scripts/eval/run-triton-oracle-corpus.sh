#!/usr/bin/env bash
# Run every manifest fixture through the oracle; aggregate oracle-report.json + a tally.
# Usage: run-triton-oracle-corpus.sh [timeout-seconds]
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORPUS="$(cd "$HERE/../../eval/diagnose-corpus" && pwd)"
TIMEOUT="${1:-120}"
# Checked here as well as in run-triton-oracle.sh: this script overwrites the committed
# oracle-report.json, so it must not get as far as writing anything without a solver.
[ -x "$CORPUS/build/triton.exe" ] || { echo "missing solver: $CORPUS/build/triton.exe" >&2; exit 1; }
mapfile -t DIRS < <(node -e "JSON.parse(require('fs').readFileSync('$CORPUS/manifest.json')).fixtures.forEach(f=>console.log(f.dir))")
START=$(date +%s); ROWS=()
for d in "${DIRS[@]}"; do
  line="$("$HERE/run-triton-oracle.sh" "$CORPUS/fixtures/$d" "$TIMEOUT")"
  echo "$line"
  ROWS+=("$(cat "$CORPUS/fixtures/$d/oracle.json")")
done
printf '[%s]\n' "$(IFS=,; echo "${ROWS[*]}")" > "$CORPUS/oracle-report.json"
END=$(date +%s)
echo "--- oracle tally (wall $((END-START))s) ---"
node -e "const r=require('$CORPUS/oracle-report.json');const t={};r.forEach(x=>t[x.outcome]=(t[x.outcome]||0)+1);console.log(t)"
