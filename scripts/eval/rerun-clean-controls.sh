#!/usr/bin/env bash
# Re-run the A-vs-C ablation for ONLY the two corrected clean controls after commit e5911a6:
#   - clean-asc-wide     (NEW — replaced the invalid clean-gtiff)
#   - clean-bin-sidecar  (CHANGED — dropped the malformed init_h.out)
# and drop the orphaned clean-gtiff cells (that fixture no longer exists).
#
# Scope: 8 cells = {clean-asc-wide, clean-bin-sidecar} x {claude, codex} x {arm A, arm C} x 1 trial.
# Everything else in the corpus is left exactly as committed — including its judged verdicts: a full
# re-judge would drift unrelated cells via LLM-judge noise, so this splices the untouched cells'
# verdicts back from the backup and keeps only the 8 re-run cells fresh.
#
# Needs Claude + Codex API and unprivileged user namespaces for bwrap. Backs up first; reversible.
# Run from the repo root:  bash scripts/eval/rerun-clean-controls.sh
set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"; cd "$REPO"
RUNS="eval/diagnose-corpus/runs"; TR="$RUNS/transcripts"
FIXES=(clean-asc-wide clean-bin-sidecar)   # cells to re-run fresh
ORPHAN=clean-gtiff                          # removed fixture — drop its stale cells
STAMP="$(date +%Y%m%d-%H%M%S)"; BK="$RUNS/.backup-rerun-$STAMP"
RE='(clean-asc-wide|clean-bin-sidecar|clean-gtiff)'   # rows this script rewrites/removes

echo "== preflight =="
for t in bwrap claude codex jq; do command -v "$t" >/dev/null || { echo "MISSING: $t"; exit 1; }; done
uns="$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)"
[ "$uns" = "0" ] || { echo "unprivileged userns restricted (=$uns); enable it (see run-arm.sh preflight)"; exit 1; }
echo "  ok"

echo "== backup runs/ CSVs + affected transcripts -> $BK =="
mkdir -p "$BK/transcripts"; cp "$RUNS"/results-*.csv "$BK"/
for fx in "${FIXES[@]}" "$ORPHAN"; do for c in claude codex; do for a in A C; do
  cp "$TR/${c}_${a}_${fx}_t1".* "$BK/transcripts/" 2>/dev/null || true
done; done; done
echo "  backed up $(ls "$BK/transcripts" | wc -l) transcript files + $(ls "$BK"/*.csv | wc -l) CSVs"

echo "== drop orphaned clean-gtiff transcripts + remove re-run/orphan rows from raw CSVs =="
for fx in "${FIXES[@]}" "$ORPHAN"; do for c in claude codex; do for a in A C; do
  rm -f "$TR/${c}_${a}_${fx}_t1".*
done; done; done
for c in claude codex; do
  f="$RUNS/results-$c.csv"; grep -vE ",$RE," "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done

echo "== run the 4 arms (restricted to the two fixtures) =="
for c in claude codex; do
  case "$c" in claude) M="${MODEL_CLAUDE:-sonnet}";; codex) M="${MODEL_CODEX:-gpt-5.6-sol}";; esac
  for a in A C; do echo ">> $c arm $a :: ${FIXES[*]}"; MODEL="$M" scripts/eval/run-arm.sh "$c" "$a" "${FIXES[@]}"; done
done

echo "== re-judge, then splice untouched cells back from backup (only the 8 change) =="
for c in claude codex; do
  JUDGE_MODEL="${JUDGE_MODEL:-sonnet}" scripts/eval/judge-results.sh "$c"
  awk -F, -v OFS=, '
    NR==FNR { if(FNR>1) bk[$2"_"$3"_"$5]=$13 SUBSEP $14; next }   # backup judged: key -> found,stage
    FNR==1 { print; next }
    { if($3=="clean-asc-wide" || $3=="clean-bin-sidecar") { print; next }   # keep fresh
      key=$2"_"$3"_"$5; if(key in bk){ split(bk[key],v,SUBSEP); $13=v[1]; $14=v[2] } print }
  ' "$BK/results-$c-judged.csv" "$RUNS/results-$c-judged.csv" > "$RUNS/results-$c-judged.csv.tmp" \
    && mv "$RUNS/results-$c-judged.csv.tmp" "$RUNS/results-$c-judged.csv"
done

echo "== A-vs-C summary (post-fix) =="
for c in claude codex; do echo "--- $c ---"; scripts/eval/summarize-results.sh "$RUNS/results-$c-judged.csv" || true; done

echo
echo "DONE. Next:"
echo "  1. Spot-check the 8 re-run cells' new transcripts in $TR."
echo "  2. Diff judged CSVs vs $BK — ONLY the 8 clean-asc-wide/clean-bin-sidecar cells should differ."
echo "  3. Update paper clean-precision numbers; regenerate the human-audit page's changed cells."
