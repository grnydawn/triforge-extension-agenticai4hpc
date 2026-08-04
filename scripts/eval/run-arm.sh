#!/usr/bin/env bash
# Automated Arm A / Arm C data collection for the diagnose_project study.
# Runs each corpus fixture through a HEADLESS agent (fresh session per cell), saves the
# transcript + the agent's final answer, and records turns + called_tool into a results CSV.
# The judgment columns (found_fault/right_stage) are filled afterwards by judge-results.sh.
#
# ISOLATION (bwrap allowlist): each cell copies the fixture into a throwaway temp dir and runs the
# agent inside a mount namespace where ALL of $HOME is blanked (empty tmpfs) EXCEPT the agent
# toolchain + auth. The agent keeps a full shell (realistic bare agent) but physically cannot
# reach the diagnosis source, the ground-truth manifest, sibling fixtures, the paper memory, or
# other TRITON decks on the machine — only run.cfg + input/ and its own tools. Needs unprivileged
# user namespaces (the preflight prints the one-line sysctl if they are disabled).
#
# Usage:
#   scripts/eval/run-arm.sh <client> <arm> [fixture ...]
#     client  : claude | codex
#     arm     : A | C
#     fixture : optional fixture names to restrict the run (default: every fixture)
#   env: MODEL (default per client), DECK_TRIALS (default: 3)
#
# Reads eval/diagnose-corpus/runs/prompts.json (generate with run-harness.ts first).
# Resumable: a cell whose transcript already exists is skipped.
set -euo pipefail

CLIENT="${1:?client (claude|codex)}"; ARM="${2:?arm (A|C)}"; shift 2 || true
FILTER=("$@")
REPO="$(git rev-parse --show-toplevel)"
RUNS="$REPO/eval/diagnose-corpus/runs"
FIXTURES="$REPO/eval/diagnose-corpus/fixtures"
PROMPTS="$RUNS/prompts.json"
TDIR="$RUNS/transcripts"
CSV="$RUNS/results-$CLIENT.csv"
DECK_TRIALS="${DECK_TRIALS:-3}"
SERVER="$REPO/dist/mcp/server.cjs"
cd "$REPO"
command -v jq >/dev/null || { echo "jq is required"; exit 1; }
command -v bwrap >/dev/null || { echo "bwrap is required (sudo apt install bubblewrap)"; exit 1; }
[ -f "$PROMPTS" ] || { echo "missing $PROMPTS — run: npx ts-node scripts/eval/run-harness.ts"; exit 1; }

# Bind back ONLY the toolchain + auth into the blanked $HOME (each entry bound if it exists).
SBX_KEEP=("$HOME/.nvm" "$HOME/.local" "$HOME/.codex" "$HOME/.cache/node" "$HOME/.npm")
SBX_KEEP_RO=("$HOME/.claude.json" "$HOME/.claude/.credentials.json" "$HOME/.claude/settings.json")
build_binds () {
  BINDS=(--dev-bind / / --tmpfs "$HOME")
  local p
  for p in "${SBX_KEEP[@]}";    do [ -e "$p" ] && BINDS+=(--dev-bind "$p" "$p"); done
  for p in "${SBX_KEEP_RO[@]}"; do [ -e "$p" ] && BINDS+=(--ro-bind "$p" "$p"); done
  BINDS+=(--setenv HOME "$HOME" --die-with-parent)
}
build_binds

# preflight: the sandbox must actually start (needs unprivileged user namespaces)
if ! bwrap "${BINDS[@]}" -- true 2>/dev/null; then
  echo "ERROR: bwrap cannot create a user namespace on this kernel."
  echo "Enable it once (sudo — also fixes /browse), then re-run:"
  echo "  echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/60-userns.conf && sudo sysctl --system"
  exit 1
fi

mkdir -p "$TDIR"
[ -f "$CSV" ] || echo "client,arm,fixture,category,trial,turns,wall_s,tokens_in,tokens_out,tokens_cached,mcp_overhead_tokens,called_tool,found_fault,right_stage,transcript" > "$CSV"

# For Arm A the MCP server lives in the (now-hidden) repo — copy it out to a visible temp path.
SBX_SERVER=""
if [ "$ARM" = A ]; then
  [ -f "$SERVER" ] || { echo "missing $SERVER — run: npm run mcp:build"; exit 1; }
  SBX_SERVER=$(mktemp "${TMPDIR:-/tmp}/triforge-mcp-XXXXXX.cjs"); cp "$SERVER" "$SBX_SERVER"
  trap 'rm -f "$SBX_SERVER"' EXIT
fi

# set by extract_<client>; WALL is measured in the loop (Codex reports no duration, so wall-clock
# is the client-agnostic timing). Token semantics are normalized across clients: tokens_in =
# NON-cached input processed, tokens_cached = cache-read input, tokens_out = generated (Codex
# reasoning tokens included). Cross-client token counts aren't identical (different tokenizers /
# cache accounting) — use them for A-vs-C WITHIN a client; note the caveat when comparing clients.
TURNS="?"; CALLED="na"; WALL=""; TOK_IN=""; TOK_OUT=""; TOK_CACHED=""; TOK_OVH="na"
sbx () { local work=$1; shift; bwrap "${BINDS[@]}" --chdir "$work" -- "$@"; }

# ---- Claude (full shell; bwrap is the isolation boundary) ----
run_claude () { # $1=arm $2=prompt $3=out $4=base $5=work
  local arm=$1 prompt=$2 out=$3 work=$5 model="${MODEL:-sonnet}"
  if [ "$arm" = A ]; then
    local mcpcfg; mcpcfg=$(mktemp)
    printf '{"mcpServers":{"triforge":{"command":"node","args":["%s"]}}}' "$SBX_SERVER" > "$mcpcfg"
    sbx "$work" claude -p "$prompt" --model "$model" --output-format stream-json --verbose \
      --mcp-config "$mcpcfg" --strict-mcp-config \
      --allowedTools mcp__triforge__diagnose_project Read Grep Glob Bash > "$out" 2> "$out.err" || true
    rm -f "$mcpcfg"
  else
    sbx "$work" claude -p "$prompt" --model "$model" --output-format stream-json --verbose \
      --strict-mcp-config --allowedTools Read Grep Glob Bash > "$out" 2> "$out.err" || true
  fi
}
extract_claude () { # $1=arm $2=out $3=base $4=work
  local resline; resline=$(grep '"type":"result"' "$2" | tail -1 || true)
  TURNS=$(jq -r '.num_turns // "?"' <<<"$resline" 2>/dev/null || echo "?")
  # non-cached input = input_tokens + cache_creation; cached = cache_read; out = output_tokens
  TOK_IN=$(jq -r '((.usage.input_tokens // 0) + (.usage.cache_creation_input_tokens // 0)) | floor' <<<"$resline" 2>/dev/null || echo "")
  TOK_OUT=$(jq -r '.usage.output_tokens // 0' <<<"$resline" 2>/dev/null || echo "")
  TOK_CACHED=$(jq -r '.usage.cache_read_input_tokens // 0' <<<"$resline" 2>/dev/null || echo "")
  jq -r '.result // ""' <<<"$resline" 2>/dev/null > "$TDIR/$3.answer.txt" || : > "$TDIR/$3.answer.txt"
  if [ "$1" = A ]; then grep -q '"name":"mcp__triforge__diagnose_project"' "$2" && CALLED=yes || CALLED=no; else CALLED=na; fi
  # MCP round-trip overhead (call args + diagnosis read back), ~tokens; na for the tool-free arm
  [ "$1" = A ] && TOK_OVH=$(python3 "$REPO/scripts/eval/mcp-overhead.py" claude "$2" 2>/dev/null || echo "") || TOK_OVH="na"
}

# ---- Codex (full shell; bwrap is the isolation boundary, so codex's own sandbox is bypassed) ----
# Arm A registers the MCP server with two -c overrides (verified: this registers + initializes
# triforge-mcp — the earlier "-c doesn't register" suspicion was wrong). The real blocker was the
# ToolSearchAlwaysDeferMcpTools feature: by default Codex hides MCP tools behind a tool-search step,
# so the model never sees diagnose_project and reports it has no such tool. `--disable
# tool_search_always_defer_mcp_tools` surfaces the tool directly — parity with how Claude gets it via
# --allowedTools mcp__triforge__diagnose_project. Arm C registers nothing, so it stays tool-free.
run_codex () { # $1=arm $2=prompt $3=out $4=base $5=work
  local arm=$1 prompt=$2 out=$3 work=$5 model="${MODEL:-gpt-5.6-sol}" ans="$work/.codex-answer.txt"
  local common=(exec --json -C "$work" -m "$model" -o "$ans" --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox)
  if [ "$arm" = A ]; then
    sbx "$work" codex "${common[@]}" --disable tool_search_always_defer_mcp_tools \
      -c 'mcp_servers.triforge.command="node"' -c "mcp_servers.triforge.args=[\"$SBX_SERVER\"]" "$prompt" > "$out" 2> "$out.err" || true
  else
    sbx "$work" codex "${common[@]}" "$prompt" > "$out" 2> "$out.err" || true
  fi
}
extract_codex () { # $1=arm $2=out $3=base $4=work
  cp "$4/.codex-answer.txt" "$TDIR/$3.answer.txt" 2>/dev/null || : > "$TDIR/$3.answer.txt"
  TURNS=$(grep -c '"type":"item.completed"' "$2" 2>/dev/null || echo "?")   # one completed item per agent step
  # sum usage across every turn.completed; normalize to match Claude (non-cached in / cached / out+reasoning)
  local u; u=$(grep '"type":"turn.completed"' "$2" 2>/dev/null || true)
  TOK_IN=$(jq -s 'map((.usage.input_tokens // 0) - (.usage.cached_input_tokens // 0)) | add // 0' <<<"$u" 2>/dev/null || echo "")
  TOK_OUT=$(jq -s 'map((.usage.output_tokens // 0) + (.usage.reasoning_output_tokens // 0)) | add // 0' <<<"$u" 2>/dev/null || echo "")
  TOK_CACHED=$(jq -s 'map(.usage.cached_input_tokens // 0) | add // 0' <<<"$u" 2>/dev/null || echo "")
  # A real call emits an mcp_tool_call item for the tool (not just a prose mention of the name).
  if [ "$1" = A ]; then
    { grep -q '"type":"mcp_tool_call"' "$2" && grep -q '"tool":"diagnose_project"' "$2"; } && CALLED=yes || CALLED=no
  else CALLED=na; fi
  # MCP round-trip overhead (call args + diagnosis read back), ~tokens; na for the tool-free arm
  [ "$1" = A ] && TOK_OVH=$(python3 "$REPO/scripts/eval/mcp-overhead.py" codex "$2" 2>/dev/null || echo "") || TOK_OVH="na"
}

declare -f "run_$CLIENT" >/dev/null && declare -f "extract_$CLIENT" >/dev/null \
  || { echo "no runner for client '$CLIENT' (claude|codex)"; exit 1; }

want () { # $1=fixture — matches when no filter is given, else must be listed
  [ ${#FILTER[@]} -eq 0 ] && return 0
  local f; for f in "${FILTER[@]}"; do [ "$f" = "$1" ] && return 0; done; return 1
}

# Arm A appends an identical tool-awareness line for BOTH clients so differing tool-discovery
# priors (Claude calls diagnose_project organically; Codex does not on a neutral prompt) don't
# confound the cross-client comparison. Arm C never sees it — the A-vs-C contrast stays "tool
# available & known" vs "no tool". Organic-adoption is still visible in the transcripts.
ARM_HINT=""
[ "$ARM" = A ] && ARM_HINT=" A diagnose_project tool is available; use it if helpful."

n=0
while read -r row; do
  dir=$(jq -r '.dir' <<<"$row")
  cat=$(jq -r '.category' <<<"$row")
  exp=$(jq -r '.expectationText // ""' <<<"$row")
  want "$dir" || continue
  trials=1; [ "$cat" = "deck-fault" ] && trials=$DECK_TRIALS
  for t in $(seq 1 "$trials"); do
    base="${CLIENT}_${ARM}_${dir}_t${t}"
    out="$TDIR/$base.jsonl"
    if [ -s "$out" ]; then echo "skip (exists): $base"; continue; fi
    work=$(mktemp -d "${TMPDIR:-/tmp}/diag-XXXXXX")
    cp -R "$FIXTURES/$dir/." "$work/"
    # NEUTRAL prompt (does not presuppose breakage): a leading "it's broken, find what's wrong"
    # prompt primes the agent to invent faults on a valid deck, which invalidates the clean
    # "don't cry wolf" control. This wording lets a genuinely-correct deck be reported as correct
    # while still eliciting the fault on a broken one. Identical across arms/clients (+$exp for
    # expectation fixtures, +$ARM_HINT for Arm A tool awareness).
    prompt="Review the TRITON project at \`$work\` for configuration or input problems. If it is correctly set up, say so; otherwise name the fault and tell me where it is.$exp$ARM_HINT"
    echo ">> $CLIENT arm $ARM :: $dir trial $t  (isolated: $work; \$HOME blanked)"
    # stdin from /dev/null: the agent must NOT read this loop's stdin (the jq prompts stream) —
    # codex exec reads stdin, which would feed it every fixture's gold and break the iteration.
    WALL=""; TOK_IN=""; TOK_OUT=""; TOK_CACHED=""; TOK_OVH="na"   # reset per cell
    _t0=$(date +%s.%N)
    "run_$CLIENT" "$ARM" "$prompt" "$out" "$base" "$work" < /dev/null
    WALL=$(awk -v a="$_t0" -v b="$(date +%s.%N)" 'BEGIN{printf "%.1f", b-a}')
    "extract_$CLIENT" "$ARM" "$out" "$base" "$work"
    rm -rf "$work"
    echo "${CLIENT},${ARM},${dir},${cat},${t},${TURNS},${WALL},${TOK_IN},${TOK_OUT},${TOK_CACHED},${TOK_OVH},${CALLED},,,${out#$REPO/}" >> "$CSV"
  done
  n=$((n+1))
done < <(jq -c '.[]' "$PROMPTS")
echo "done: $n fixtures -> ${CSV#$REPO/}"
