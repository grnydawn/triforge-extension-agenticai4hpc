#!/usr/bin/env bash
# Ground the whole diagnose-corpus with the three-tier pipeline (see
# docs/agentic-mcp/three-tier-fixture-groundtruth.md): run every fixture through Tier-1
# (solver run/reject) + Tier-2 (output-sanity scan), collect the combined ground-truth
# label, and RECONCILE it against the manifest's declared category. The load-bearing
# assertion is that NO fixture labelled "clean" is a solver-FAULT (that was the
# whitespace-hyg mislabel). Writes eval/diagnose-corpus/three-tier-report.json.
#
# Usage: three-tier-corpus.sh [per-fixture-timeout-seconds]
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CORPUS="$REPO/eval/diagnose-corpus"
WRAP="$HERE/scan-fixture-output.sh"
TIMEOUT="${1:-60}"
REPORT="$CORPUS/three-tier-report.json"
command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }
# Ask here rather than 32 rows later: without a solver every fixture grounds as ERROR.
# The wrapper inherits the resolved $TRITON_EXE, so the question is asked once.
. "$HERE/resolve-triton.sh" || exit 1

tmp="$(mktemp)"; echo '[]' > "$tmp"
echo "grounding $(jq '.fixtures|length' "$CORPUS/manifest.json") fixtures (timeout ${TIMEOUT}s each)..."

for dir in $(jq -r '.fixtures[].dir' "$CORPUS/manifest.json"); do
  fixdir="$CORPUS/fixtures/$dir"
  line="$(timeout $((TIMEOUT + 30)) "$WRAP" "$fixdir" "$TIMEOUT" 2>/dev/null | tail -1)"
  if ! echo "$line" | jq -e . >/dev/null 2>&1; then
    echo "  $dir -> (no verdict / error)"
    line="{\"fixture\":\"$dir\",\"tier1\":\"error\",\"tier2\":\"error\",\"ground\":\"ERROR\",\"runDir\":\"\"}"
  fi
  run="$(echo "$line" | jq -r '.runDir // ""')"
  [ -n "$run" ] && case "$run" in /tmp/*) rm -rf "$run";; esac   # clean the preserved run dir
  t1="$(echo "$line" | jq -r '.tier1')"; t2="$(echo "$line" | jq -r '.tier2')"; g="$(echo "$line" | jq -r '.ground')"
  printf '  %-24s tier1=%-16s tier2=%-6s -> %s\n' "$dir" "$t1" "$t2" "$g"
  # A Tier-2 that never ran is a broken run, not a verdict — say why, since the wrapper's
  # stderr is suppressed above and the reason would otherwise be lost with the run dir.
  [ "$t2" = "error" ] && echo "      tier-2 scan did not run: $(echo "$line" | jq -r '.tier2Error // "reason unavailable"')"
  jq --argjson e "$(echo "$line" | jq -c '{fixture,tier1,tier2,ground}')" '. + [$e]' "$tmp" > "$tmp.2" && mv "$tmp.2" "$tmp"
done

mv "$tmp" "$REPORT"
echo "wrote $REPORT"
echo
echo "=== reconciliation vs manifest ==="
node -e '
const fs=require("fs");
const corpus=process.argv[1];
const man=JSON.parse(fs.readFileSync(corpus+"/manifest.json","utf8")).fixtures;
const rep=JSON.parse(fs.readFileSync(corpus+"/three-tier-report.json","utf8"));
const groundOf=Object.fromEntries(rep.map(r=>[r.fixture,r.ground]));
const catOf=e=> e.expect==="clean"?"clean": e.expect.startsWith("expectation-")?"expectation":"fault";
let mislabels=0, toolOnly=0, ungrounded=0;
for(const e of man){
  const cat=catOf(e), g=groundOf[e.dir]||"?";
  let verdict;
  // No ground truth at all. Every branch below tests g==="FAULT", so an ungrounded
  // fixture would otherwise fall through to "ok" and a run that grounded nothing
  // would report clean.
  if(g==="ERROR"||g==="?"){
    verdict = "ERROR: not grounded (no Tier-1 or Tier-2 verdict)";
    ungrounded++;
  } else if(cat==="clean"){
    verdict = (g==="FAULT") ? "MISLABEL: clean deck the solver REJECTS" : "ok (solver-consistent clean)";
    if(g==="FAULT") mislabels++;
  } else if(cat==="expectation"){
    verdict = (g==="FAULT") ? "FLAG: expectation deck the solver rejects (unexpected)" : "ok (solver blind to intent — tool-only)";
    if(g==="FAULT") mislabels++;
  } else { // fault
    if(g==="FAULT"){ verdict="ok (solver catches it)"; }
    else { verdict="tool-only fault (solver tolerates; static tool catches)"; toolOnly++; }
  }
  const bad = verdict.startsWith("MISLABEL")||verdict.startsWith("FLAG")||verdict.startsWith("ERROR");
  console.log(`${bad?"XX":"  "} ${e.dir.padEnd(24)} cat=${cat.padEnd(11)} ground=${String(g).padEnd(16)} ${verdict}`);
}
console.log(`\nmislabels/flags: ${mislabels}   tool-only faults (solver-tolerant, tool-caught): ${toolOnly}   ungrounded: ${ungrounded}`);
if(ungrounded) console.log(`${ungrounded} of ${man.length} fixtures were never grounded — this run proves nothing.`);
process.exit(mislabels>0||ungrounded>0?1:0);
' "$CORPUS"
