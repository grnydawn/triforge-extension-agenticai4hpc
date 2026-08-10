#!/usr/bin/env bash
# One-shot driver for the full Arm A vs C diagnosis study.
# Builds the MCP server, generates prompts, runs each client × arm (isolated, headless),
# scores with the LLM judge, and prints the A-vs-C summary per client.
#
# Usage:
#   scripts/eval/run-study.sh [fixture ...]
#     [fixture ...]  optional: restrict to named fixtures — pass ONE to smoke the whole
#                    pipeline end-to-end first, e.g.  scripts/eval/run-study.sh fault-value-range
#   env:
#     CLIENTS       (default "claude codex")   space-separated clients to run
#     MODEL_CLAUDE  (default "sonnet")
#     MODEL_CODEX   (default "gpt-5.6-sol")
#     JUDGE_MODEL   (default "sonnet")
#     DECK_TRIALS   (default 3)                deck-fault trials per cell
#     SKIP_BUILD=1  skip `npm run mcp:build`
#
# Resumable: cells whose transcripts already exist are skipped, so re-invoking continues.
set -euo pipefail
REPO="$(git rev-parse --show-toplevel)"; cd "$REPO"
HERE="scripts/eval"
CLIENTS="${CLIENTS:-claude codex}"
JUDGE_MODEL="${JUDGE_MODEL:-sonnet}"
export DECK_TRIALS="${DECK_TRIALS:-3}"
FIXTURES=("$@")

log(){ printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

# 1. prerequisites
for t in jq bwrap node npx; do command -v "$t" >/dev/null || { echo "missing required tool: $t"; exit 1; }; done
for c in $CLIENTS; do command -v "$c" >/dev/null || { echo "client '$c' not installed"; exit 1; }; done

# 2. build the MCP server (Arm A connects it)
if [ "${SKIP_BUILD:-0}" != 1 ]; then log "build MCP server"; npm run mcp:build; fi

# 3. (re)generate the prompt/gold sheet
log "generate prompts.json"
TS_NODE_TRANSPILE_ONLY=true TS_NODE_PROJECT=tsconfig.test.json npx ts-node "$HERE/run-harness.ts"

# 4. run each client × arm
for c in $CLIENTS; do
  case "$c" in
    claude) M="${MODEL_CLAUDE:-sonnet}";;
    codex)  M="${MODEL_CODEX:-gpt-5.6-sol}";;
    *)      M="${MODEL:-}";;
  esac
  for arm in A C; do
    log "run $c · arm $arm · model ${M:-default}"
    MODEL="$M" "$HERE/run-arm.sh" "$c" "$arm" ${FIXTURES[@]+"${FIXTURES[@]}"}
  done
done

# 5. judge + summarize each client
for c in $CLIENTS; do
  log "judge $c (blind LLM-as-judge, model $JUDGE_MODEL)"
  JUDGE_MODEL="$JUDGE_MODEL" "$HERE/judge-results.sh" "$c"
  log "summary — $c (Arm A vs Arm C)"
  "$HERE/summarize-results.sh" "eval/diagnose-corpus/runs/results-$c-judged.csv"
done

log "DONE"
echo "judged results : eval/diagnose-corpus/runs/results-<client>-judged.csv"
echo "transcripts (AE): eval/diagnose-corpus/runs/transcripts/"
echo "Next: spot-check a sample of judged rows against their transcripts and override in the CSV where you disagree."
