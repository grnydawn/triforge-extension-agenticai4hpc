#!/usr/bin/env bash
# Summarize A vs C from a judged results CSV. Detection = found_fault "Y" (for clean fixtures,
# "Y" means the agent correctly reported no fault). Prints per-arm rates + mean turns.
#
# Usage: scripts/eval/summarize-results.sh eval/diagnose-corpus/runs/results-claude-judged.csv
set -euo pipefail
CSV="${1:?judged csv path}"
[ -f "$CSV" ] || { echo "missing $CSV"; exit 1; }
# columns: 6=turns 7=wall_s 8=tokens_in 9=tokens_out 10=tokens_cached 11=mcp_overhead_tokens
#          12=called_tool 13=found_fault 14=right_stage
awk -F, 'NR>1 && $13!="" {
  a=$2; tot[a]++;
  if ($13=="Y") found[a]++;
  if ($14=="Y") stage[a]++;
  if ($12=="yes") called[a]++;
  if ($6  ~ /^[0-9]+$/)            { tsum[a]+=$6;  tn[a]++ }
  if ($7  ~ /^[0-9]+(\.[0-9]+)?$/) { wsum[a]+=$7;  wn[a]++ }
  if ($8  ~ /^[0-9]+$/)            { isum[a]+=$8;  in_n[a]++ }
  if ($9  ~ /^[0-9]+$/)            { osum[a]+=$9;  on[a]++ }
  if ($11 ~ /^[0-9]+$/)            { vsum[a]+=$11; vn[a]++ }   # mcp overhead (Arm A only; "na" skipped)
}
END {
  printf "%-4s %4s %8s %8s %12s %10s %9s %9s %9s %9s\n",
    "arm","n","found%","stage%","calledTool%","meanTurns","meanWall_s","meanTokIn","meanTokOut","meanMcpOvh";
  for (a in tot) printf "%-4s %4d %7.0f%% %7.0f%% %11.0f%% %10.1f %9.1f %9.0f %9.0f %9.0f\n",
    a, tot[a], 100*found[a]/tot[a], 100*(stage[a]+0)/tot[a], (called[a]+0)*100/tot[a],
    (tn[a]? tsum[a]/tn[a] : 0), (wn[a]? wsum[a]/wn[a] : 0),
    (in_n[a]? isum[a]/in_n[a] : 0), (on[a]? osum[a]/on[a] : 0), (vn[a]? vsum[a]/vn[a] : 0);
}' "$CSV"
