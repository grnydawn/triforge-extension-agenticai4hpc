#!/usr/bin/env bash
# Multi-judge robustness re-grade. Same BLIND rubrics as scripts/eval/judge-results.sh;
# the ONLY thing that changes is the judge model. Writes judged CSVs + .judge sidecars into
# a per-judge output dir (runs/robustness/<judge>/) so the sonnet originals are never touched.
# Then recompute the ablation rows with:  node scripts/eval/tabulate-ablation.mjs runs/robustness/<judge>
#
# Answers the reviewer question "would a stronger judge change the result?": re-grade with Opus
# (stronger, same family as the primary judge) and with codex/gpt-5.6-sol (a different family, so
# no shared self-preference with the Claude agent). See runs/robustness/README.md for the finding.
#
# Usage: judge-multi.sh <client> <judge>       client in {claude, codex}; judge in {opus, codex}
#   opus  -> claude -p --model opus         (Claude Opus)
#   codex -> codex exec                     (OpenAI gpt-5.6-sol)
set -uo pipefail
CLIENT="${1:?client}"; JUDGE="${2:?judge (opus|codex)}"
REPO="$(git rev-parse --show-toplevel)"
RUNS="$REPO/eval/diagnose-corpus/runs"
IN="$RUNS/results-$CLIENT.csv"
OUTDIR="$RUNS/robustness/$JUDGE"
mkdir -p "$OUTDIR"
OUT="$OUTDIR/results-$CLIENT-judged.csv"
PROMPTS="$RUNS/prompts.json"
[ -f "$IN" ] || { echo "missing $IN" >&2; exit 1; }

# Extract the verdict JSON object, anchored on "found_fault", tolerant of fences/prose.
extract() { tr -d '`' | grep -oE '\{"found_fault"[^{}]*\}' | tail -1; }

ask() {  # $1 = prompt ; echoes one JSON line
  local jp="$1" raw
  if [ "$JUDGE" = "opus" ]; then
    raw=$(timeout 180 claude -p "$jp" --model opus --output-format json </dev/null 2>/dev/null | jq -r '.result // ""' 2>/dev/null || echo "")
  else
    raw=$(timeout 240 codex exec "$jp" </dev/null 2>/dev/null || echo "")
  fi
  printf '%s' "$raw" | extract
}

head -1 "$IN" > "$OUT"
n=0
tail -n +2 "$IN" | while IFS=, read -r client arm fixture cat trial turns wall tin tout tcached ovh called ff rs transcript; do
  n=$((n+1))
  gold=$(jq -c --arg d "$fixture" '.[] | select(.dir==$d)' "$PROMPTS")
  gf=$(jq -r '.goldFinding' <<<"$gold"); ge=$(jq -r '.goldEvidence' <<<"$gold"); gs=$(jq -r '.goldStage' <<<"$gold")
  answer=$(cat "$RUNS/transcripts/${client}_${arm}_${fixture}_t${trial}.answer.txt" 2>/dev/null || echo "")
  if [ "$gf" = "clean" ]; then
    read -r -d '' jp <<EOF || true
You are grading one diagnosis of a TRITON simulation project. Grade strictly and literally: judge only what the agent actually concluded, not what it could have meant.
GROUND TRUTH: this project is correctly configured. It has NO structural configuration or input fault. The ONLY correct diagnosis is that the project is fine.
The agent was asked to find configuration/input problems or confirm there are none. Its answer:
<<<
${answer}
>>>
Decide the agent's conclusion:
- found_fault "Y": the agent concluded the project is correctly set up / found no structural fault. Non-structural caveats are still "Y" (e.g. "this tool does not check physical or numerical plausibility", or a hedge like "n may be unstable") as long as the agent did NOT assert an actual configuration or input fault.
- found_fault "N": the agent asserted a concrete structural configuration or input fault (phrases like "fault found", "the project is not correctly configured", "X is missing / mismatched / malformed / out of range"), even if it hedged afterward.
right_stage is always "na" for a clean deck.
Reply with ONLY one line of compact JSON, no prose, no code fences, and NO braces inside the strings:
{"found_fault":"Y|N","right_stage":"na","why":"one short sentence quoting the agent's actual conclusion"}
EOF
  else
    read -r -d '' jp <<EOF || true
You are grading one diagnosis of a TRITON simulation project. Grade strictly and literally: judge only what the agent actually concluded, not what it could have meant.
GROUND TRUTH — the project has exactly one intended fault:
  fault: ${gf}
  evidence: ${ge}
  correct artifact/stage: ${gs}
The agent was asked to find the configuration/input problem. Its answer:
<<<
${answer}
>>>
Decide:
- found_fault "Y": the agent identified THIS fault by meaning (wording may differ) as its primary diagnosis. "N": it missed it, or named a different/wrong fault as the main problem.
- right_stage "Y": it pointed at the correct artifact/stage (${gs}). "N": wrong location. "na": only when found_fault is N.
Reply with ONLY one line of compact JSON, no prose, no code fences, and NO braces inside the strings:
{"found_fault":"Y|N","right_stage":"Y|N|na","why":"one short sentence naming what the agent diagnosed"}
EOF
  fi
  raw=$(ask "$jp")
  fj=$(jq -r '.found_fault // ""' <<<"$raw" 2>/dev/null || echo "")
  rj=$(jq -r '.right_stage // ""' <<<"$raw" 2>/dev/null || echo "")
  wj=$(jq -r '.why // ""' <<<"$raw" 2>/dev/null || echo "")
  printf 'found=%s stage=%s gold=%s\nwhy=%s\n' "$fj" "$rj" "$gf" "$wj" \
    > "$OUTDIR/${client}_${arm}_${fixture}_t${trial}.judge.txt" 2>/dev/null || true
  echo "${client},${arm},${fixture},${cat},${trial},${turns},${wall},${tin},${tout},${tcached},${ovh},${called},${fj},${rj},${transcript}"
  echo "[$JUDGE/$CLIENT #$n] ${arm}/${fixture}/t${trial}: found=${fj} stage=${rj}" >&2
done >> "$OUT"
echo "[$JUDGE/$CLIENT] done -> ${OUT#$REPO/}" >&2
