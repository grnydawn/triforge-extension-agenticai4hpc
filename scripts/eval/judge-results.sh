#!/usr/bin/env bash
# LLM-as-judge: score found_fault/right_stage for each recorded cell by comparing the agent's
# saved answer to the gold (prompts.json). The judge is BLIND to arm/client. Writes
# results-<client>-judged.csv. Keep the raw transcripts and spot-check a sample of the judge's
# calls, overriding in the CSV where you disagree (report the human-agreement rate in the paper).
#
# Usage: scripts/eval/judge-results.sh <client>
#   env: JUDGE_MODEL (default: sonnet)
set -euo pipefail
CLIENT="${1:?client (claude|codex)}"
REPO="$(git rev-parse --show-toplevel)"
RUNS="$REPO/eval/diagnose-corpus/runs"
IN="$RUNS/results-$CLIENT.csv"
OUT="$RUNS/results-$CLIENT-judged.csv"
PROMPTS="$RUNS/prompts.json"
JUDGE_MODEL="${JUDGE_MODEL:-sonnet}"
cd "$REPO"
command -v jq >/dev/null || { echo "jq is required"; exit 1; }
[ -f "$IN" ] || { echo "missing $IN"; exit 1; }

head -1 "$IN" > "$OUT"
tail -n +2 "$IN" | while IFS=, read -r client arm fixture cat trial turns wall tin tout tcached ovh called ff rs transcript; do
  gold=$(jq -c --arg d "$fixture" '.[] | select(.dir==$d)' "$PROMPTS")
  gf=$(jq -r '.goldFinding' <<<"$gold"); ge=$(jq -r '.goldEvidence' <<<"$gold"); gs=$(jq -r '.goldStage' <<<"$gold")
  answer=$(cat "$RUNS/transcripts/${client}_${arm}_${fixture}_t${trial}.answer.txt" 2>/dev/null || echo "")
  # Two grading rubrics. A clean deck and a faulted deck are graded by different questions:
  # phrasing "found_fault=Y means there is NO fault" as one rubric confused the judge (it
  # occasionally scored a clear "correctly configured" answer as N). Branch instead, and ask
  # each question in its own natural direction. The `why` field is a one-line rationale saved
  # to a .judge.txt sidecar so the human audit can spot-check without re-reading transcripts.
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
  # stdin from /dev/null: `claude -p` reads stdin, which here is the `tail | while read` CSV
  # stream — without this it swallows the remaining rows and the loop stops after the first cell.
  raw=$(claude -p "$jp" --model "$JUDGE_MODEL" --output-format json </dev/null 2>/dev/null | jq -r '.result // ""' 2>/dev/null || echo "")
  raw=$(printf '%s' "$raw" | tr -d '`' | sed -n 's/.*\({.*}\).*/\1/p' | head -1)
  fj=$(jq -r '.found_fault // ""' <<<"$raw" 2>/dev/null || echo "")
  rj=$(jq -r '.right_stage // ""' <<<"$raw" 2>/dev/null || echo "")
  wj=$(jq -r '.why // ""' <<<"$raw" 2>/dev/null || echo "")
  printf 'found=%s stage=%s gold=%s\nwhy=%s\n' "$fj" "$rj" "$gf" "$wj" \
    > "$RUNS/transcripts/${client}_${arm}_${fixture}_t${trial}.judge.txt" 2>/dev/null || true
  echo "${client},${arm},${fixture},${cat},${trial},${turns},${wall},${tin},${tout},${tcached},${ovh},${called},${fj},${rj},${transcript}"
  echo "  judged ${arm}/${fixture}/t${trial}: found=${fj} stage=${rj} why=${wj}" >&2
done >> "$OUT"
echo "judged -> ${OUT#$REPO/}" >&2
