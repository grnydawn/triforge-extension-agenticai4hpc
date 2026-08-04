#!/usr/bin/env bash
#
# Build the SC26 reviewer artifact bundle: everything a reviewer needs to check
# the paper's claims, in one archive suitable for a Zenodo deposit.
#
# Deliberately EXCLUDES eval/diagnose-corpus/build/ — that is a 20 MB compiled
# TRITON tree specific to one machine. The bundle ships the build *provenance*
# (upstream commit, backend/compiler env, build+run scripts) instead, so a
# reviewer rebuilds rather than trusts our binary.
#
# Usage:  scripts/eval/build-artifact-bundle.sh [output.zip]
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CORPUS="$REPO_ROOT/eval/diagnose-corpus"
OUT="${1:-$REPO_ROOT/sc26-artifact-bundle.zip}"
STAGE="$(mktemp -d)"
BUNDLE="$STAGE/sc26-artifact-bundle"
trap 'rm -rf "$STAGE"' EXIT

echo "==> staging in $BUNDLE"
mkdir -p "$BUNDLE"

# Copy a tree from git's INDEX rather than from disk, so nothing untracked can ride
# along. `cp -r` here would ship editor swap files, .DS_Store, and stale build output;
# a vim swap file is the worst of those, because it holds buffer text and the operator's
# home path in `~user/...` form, which the account-redaction pass below does not match.
# Tracked content is also what makes the bundle reproducible from a fresh clone.
#   copy_tracked <repo-relative-src-dir> <dest-dir>
copy_tracked() {
  local src="$1" dest="$2" rel
  mkdir -p "$dest"
  git -C "$REPO_ROOT" ls-files -z "$src" | while IFS= read -r -d '' rel; do
    local out="$dest/${rel#"$src"/}"
    mkdir -p "$(dirname "$out")"
    cp "$REPO_ROOT/$rel" "$out"
  done
}

# --- evidence -------------------------------------------------------------
echo "--> corpus fixtures, run records, reports, reviewer artifacts"
copy_tracked "eval/diagnose-corpus/artifacts" "$BUNDLE/artifacts"

# Same rule as runs/ below: copy from git's index, not from disk. The corpus
# carries per-fixture oracle.json records that the Layer-2 harness regenerates;
# they are untracked, and their content is already in the tracked
# oracle-report.json, three-tier-report.json, and level2 artifact page.
echo "--> corpus fixtures (tracked content only)"
mkdir -p "$BUNDLE/fixtures"
git -C "$REPO_ROOT" ls-files -z "eval/diagnose-corpus/fixtures" | while IFS= read -r -d '' rel; do
  dest="$BUNDLE/fixtures/${rel#eval/diagnose-corpus/fixtures/}"
  mkdir -p "$(dirname "$dest")"
  cp "$REPO_ROOT/$rel" "$dest"
done
echo "    $(find "$BUNDLE/fixtures" -type f | wc -l) fixture files"

# `runs/` is copied from git's index, not from disk. The raw agent transcripts
# (2,225 files, 21 MB) are deliberately untracked: they are verbatim terminal
# capture, they carry the operator's account name and -- for sessions predating
# the bwrap isolation -- site tokens, and every claim they support is already
# published in tracked form. The per-cell agent answers, arms, trials, and gold
# labels for all 248 ablation runs are embedded in
# artifacts/human-judge-evaluation.html; the aggregates are in reports/.
#
# Driving the copy from `git ls-files` means the deposit is reproducible from a
# fresh clone rather than only on the machine that ran the study -- and it still
# honours the escape hatch in runs/.gitignore: anything deliberately committed
# with `git add -f` is tracked, so it ships.
echo "--> run records (tracked content only)"
mkdir -p "$BUNDLE/runs"
git -C "$REPO_ROOT" ls-files -z "eval/diagnose-corpus/runs" | while IFS= read -r -d '' rel; do
  dest="$BUNDLE/runs/${rel#eval/diagnose-corpus/runs/}"
  mkdir -p "$(dirname "$dest")"
  cp "$REPO_ROOT/$rel" "$dest"
done
echo "    $(find "$BUNDLE/runs" -type f | wc -l) tracked run records"
mkdir -p "$BUNDLE/reports"
cp "$CORPUS"/manifest.json "$CORPUS"/report.json \
   "$CORPUS"/oracle-report.json "$CORPUS"/three-tier-report.json "$BUNDLE/reports/"

# Drop any restored-backup directories that are not part of the record.
rm -rf "$BUNDLE"/runs/.backup-* 2>/dev/null || true

# --- apparatus ------------------------------------------------------------
echo "--> eval scripts"
copy_tracked "scripts/eval" "$BUNDLE/scripts"

# Build provenance, so a reviewer can rebuild the solver rather than trust a binary.
# Read from the tracked triton-build/ directory, NOT from the compiled build/ tree:
# build/ is git-ignored and absent from a clone, which silently shipped an empty
# triton-build/ while the appendix claimed the recorded environment was included.
echo "--> TRITON build provenance (not the binary)"
copy_tracked "eval/diagnose-corpus/triton-build" "$BUNDLE/triton-build"
N_PROV=$(find "$BUNDLE/triton-build" -type f | wc -l)
if [ "$N_PROV" -eq 0 ]; then
  echo "!! no build provenance under eval/diagnose-corpus/triton-build/ — the bundle" >&2
  echo "!! would claim a recorded environment it does not carry. Refusing to build." >&2
  exit 1
fi
# head -1: git-state.txt records the submodule pins and the verification note below the
# first line, and this is a one-line summary.
echo "    $N_PROV provenance files ($(head -1 "$BUNDLE/triton-build/git-state.txt" 2>/dev/null || echo 'upstream commit ?'))"

# --- paper ----------------------------------------------------------------
echo "--> paper sources"
mkdir -p "$BUNDLE/paper"
cp "$REPO_ROOT/paper/main.tex" "$REPO_ROOT/paper/references.bib" "$BUNDLE/paper/"
copy_tracked "paper/figures" "$BUNDLE/paper/figures"
cp "$REPO_ROOT/LICENSE.txt" "$BUNDLE/LICENSE.txt"
cp "$REPO_ROOT/LICENSE-data.txt" "$BUNDLE/LICENSE-data.txt"

# --- OPSEC redaction + gate ----------------------------------------------
# The repository is public and the operational deployment is named nowhere in
# it. Agent transcripts are a special case: they captured whatever scrolled past
# during a run, including test names from before the scrub, so they can carry a
# token even though every tracked file is clean. A Zenodo deposit is IMMUTABLE,
# so redaction and verification both happen here, before the archive exists.
#
# Two token classes, matched differently:
#   site words  - real place/system names; matched case-insensitively, since
#                 casing varies freely in prose and log output.
#   id tokens   - mixed-case identifiers (a directory name, a field name);
#                 matched case-SENSITIVELY, because their lowercase forms are
#                 ordinary upstream TRITON names (triton_run.sh, triton_run.rst)
#                 that carry no site information.
#
# The list itself lives OUTSIDE the repository. This script is copied into the bundle,
# so a list embedded here — even base64-encoded, which stops grep and code search but
# not a reader with `base64 -d` — would ship the very identifiers the redaction exists
# to remove, into a deposit that cannot be amended. Keeping it external means the
# deposit carries no copy at all.
#
# Format, one per line: `site=a|b|c` and `id=A|B`. Comments and blank lines ignored.
echo "==> OPSEC redaction and scan"
TOKENS_FILE="${OPSEC_TOKENS_FILE:-$HOME/.config/triforge/opsec-tokens}"
if [ ! -r "$TOKENS_FILE" ]; then
  {
    echo "!! no OPSEC token list at: $TOKENS_FILE"
    echo "   Redaction cannot run, so this refuses to build rather than ship unredacted."
    echo "   Create it (chmod 600) with two lines, or point OPSEC_TOKENS_FILE at it:"
    echo "     site=<lowercase|alternation|of|site|words>"
    echo "     id=<MixedCase|Identifiers>"
    echo "   test/helpers/bannedTokens.ts carries the same tokens for the unit guards;"
    echo "   keep the two in agreement."
  } >&2
  exit 1
fi
SITE_WORDS="$(sed -n 's/^site=//p' "$TOKENS_FILE" | head -1)"
ID_TOKENS="$(sed -n 's/^id=//p' "$TOKENS_FILE" | head -1)"
if [ -z "$SITE_WORDS" ] || [ -z "$ID_TOKENS" ]; then
  echo "!! $TOKENS_FILE is missing a site= or id= line — refusing to build" >&2
  exit 1
fi

# Redact, recording every file touched. \b guards both sides: the site words are
# substrings of innocent English ("Notably" contains one), and an unanchored
# replace would corrupt clean text.
export REDACTION_LOG="$STAGE/redactions.txt"
python3 - "$BUNDLE" "$SITE_WORDS" "$ID_TOKENS" <<'PY'
import os, re, sys
root, site_words, id_tokens = sys.argv[1:4]
pats = [re.compile(rf"\b({site_words})\b", re.I), re.compile(rf"\b({id_tokens})\b")]
touched = []
for dirpath, _, names in os.walk(root):
    for n in names:
        p = os.path.join(dirpath, n)
        try:
            src = open(p, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue  # binary fixture data — tokens are a text concern
        out, hits = src, 0
        for pat in pats:
            out, k = pat.subn("[REDACTED-SITE]", out)
            hits += k
        if hits:
            open(p, "w", encoding="utf-8").write(out)
            touched.append((os.path.relpath(p, root), hits))
for rel, k in sorted(touched):
    print(f"    redacted {k}x  {rel}")
print(f"    {len(touched)} file(s) redacted" if touched else "    nothing to redact")
with open(os.environ["REDACTION_LOG"], "w", encoding="utf-8") as fh:
    for rel, k in sorted(touched):
        fh.write(f"`{rel}` ({k} occurrence{'s' if k != 1 else ''})\n")
PY

# --- local-account redaction ---------------------------------------------
# Agent transcripts are verbatim terminal capture, so they carry the operator's
# account name two different ways: in absolute paths (/home/<user>/...) and in the
# owner/group columns of any `ls -l` the agent happened to run. The site-token pass
# above sees neither, and the second shape is by far the larger one. Account names
# are DISCOVERED from the staged paths rather than read from $USER, so a bundle
# built by a co-author still scrubs the names baked into the transcripts.
echo "==> local-account redaction"
python3 - "$BUNDLE" <<'PY'
import os, re, sys
root = sys.argv[1]
MARK = "[REDACTED-USER]"
PATH_RE = re.compile(r'(/(?:home|Users)/)([A-Za-z0-9._-]+)')

# `paper/` is hand-authored LaTeX where the author's own name is the byline and MUST
# survive; everywhere else the same string is incidental terminal capture. Scope the
# name pass by directory rather than trying to tell the two apart by pattern.
AUTHORED = {"paper"}

files, users = [], set()
for dirpath, _, names in os.walk(root):
    for n in names:
        p = os.path.join(dirpath, n)
        try:
            src = open(p, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue  # binary fixture data — account names are a text concern
        files.append((p, src))
        users.update(u for _, u in PATH_RE.findall(src))

# A 1-2 character match is far more likely to be noise than an account name.
users = {u for u in users if len(u) >= 3}
# Deliberately NOT \b-anchored: transcripts also carry path-encoded forms such as
# `zShomezS<user>zSrepos`, where the separator is escaped and no word boundary exists.
# An unanchored match is safe here only because this pass never touches AUTHORED/.
name_re = re.compile('|'.join(re.escape(u) for u in sorted(users))) if users else None

def authored(p):
    return os.path.relpath(p, root).split(os.sep)[0] in AUTHORED

touched = 0
for p, src in files:
    out = PATH_RE.sub(lambda m: m.group(1) + MARK, src)
    if name_re and not authored(p):
        out = name_re.sub(MARK, out)          # `ls -l` owner/group + encoded paths
    if out != src:
        open(p, "w", encoding="utf-8").write(out)
        touched += 1

if not users:
    print("    no local account paths found")
    sys.exit(0)
print(f"    {len(users)} account name(s) scrubbed from {touched} file(s)")

# Self-verify: a deposit is immutable, so refuse rather than ship a survivor.
survivors = []
for p, _ in files:
    if authored(p):
        continue
    try:
        t = open(p, encoding="utf-8").read()
    except (UnicodeDecodeError, OSError):
        continue
    if name_re and name_re.search(t):
        survivors.append(os.path.relpath(p, root))
if survivors:
    print("!! account names SURVIVED redaction — refusing to build:", file=sys.stderr)
    for s in sorted(survivors)[:20]:
        print("   " + s, file=sys.stderr)
    sys.exit(1)
print("    accounts verified clean")
PY

# Verify: nothing may survive into an immutable deposit.
HITS="$( { grep -rEIlw -e "($SITE_WORDS)" -i "$BUNDLE" 2>/dev/null || true; \
           grep -rEIlw -e "($ID_TOKENS)"     "$BUNDLE" 2>/dev/null || true; \
           grep -rEIl  -e '/(home|Users)/[A-Za-z0-9._-]' "$BUNDLE" 2>/dev/null || true; } )"
if [ -n "$HITS" ]; then
  echo "!! site or account identifiers SURVIVED redaction — refusing to build:" >&2
  echo "$HITS" >&2
  exit 1
fi
echo "    verified clean"

# --- manifest -------------------------------------------------------------
# README is written BEFORE the checksums so SHA256SUMS covers it; only SHA256SUMS
# itself is necessarily uncovered. FILES is the true archive count -- everything
# staged so far, plus the README and SHA256SUMS still to be written.
FILES=$(( $(find "$BUNDLE" -type f | wc -l) + 2 ))

cat > "$BUNDLE/README.md" <<EOF
# Reviewer artifact bundle

Companion to *"Works but Wrong: Static Diagnosis of HPC Simulation Setup Errors
for AI Agents"* (AgenticAI4HPC'26). Built by
\`scripts/eval/build-artifact-bundle.sh\`; $FILES files.

| Path | What it is |
|---|---|
| \`fixtures/\` | The 32-project test corpus, one directory per project |
| \`reports/\` | Machine-readable verdicts: tool findings, solver oracle, three-tier ground truth |
| \`runs/\` | Harness inputs and the human audits: prompts, answer key, scoring sheet, judge-agreement CSVs |
| \`artifacts/\` | The four reviewer artifact pages, self-contained (open in any browser) |
| \`scripts/\` | The evaluation harness that produced everything above |
| \`triton-build/\` | Provenance for the solver build — upstream commit, backend, compiler, build/run scripts |
| \`paper/\` | LaTeX source and figures |
| \`SHA256SUMS\` | Checksum of every file in this bundle |

The compiled TRITON tree is **not** included: it is machine-specific, and
reviewers should rebuild from the recorded upstream commit rather than trust a
binary. See \`triton-build/\` and the paper's Artifact Description appendix.

## What is not here, and why

The raw agent transcripts are **not** shipped. They are verbatim terminal capture
— 2,225 files, 21 MB — and everything they support is already here in tracked
form: \`artifacts/human-judge-evaluation.html\` carries the answer, arm, trial,
and gold label for each of the 248 ablation runs, and \`reports/\` carries the
aggregates. Excluding them is also what lets this bundle be built from the
repository's tracked content alone, so it rebuilds byte-for-byte from a fresh
clone rather than only on the machine that ran the study.

## Redaction

Every file is passed through two redaction passes before the archive is written:
site identifiers from the operational deployment that motivates Section II become
\`[REDACTED-SITE]\`, and the operator's local account name becomes
\`[REDACTED-USER]\` — in absolute paths and in the owner/group columns of any
captured \`ls -l\` output. The build refuses rather than ship a survivor. Both are
visible wherever they occur; nothing else is altered, and no finding, verdict,
metric, or agent answer is affected. $(if [ -s "$STAGE/redactions.txt" ]; then echo "Files touched:"; sed 's/^/- /' "$STAGE/redactions.txt"; else echo "No redaction was needed in this build."; fi)

Code is MIT-licensed (\`LICENSE.txt\`). The corpus, run records, and reports are
data generated for this paper, licensed CC BY 4.0 (\`LICENSE-data.txt\`) — reuse
freely, cite the paper.
EOF

echo "==> checksums"
( cd "$BUNDLE" && find . -type f ! -name SHA256SUMS -print0 \
    | sort -z | xargs -0 sha256sum > SHA256SUMS )
COVERED="$(wc -l < "$BUNDLE/SHA256SUMS")"
ACTUAL="$(find "$BUNDLE" -type f | wc -l)"
if [ "$ACTUAL" -ne "$FILES" ] || [ "$COVERED" -ne $((FILES - 1)) ]; then
  echo "!! file accounting is off (staged=$ACTUAL predicted=$FILES covered=$COVERED)" >&2
  exit 1
fi

echo "==> writing $OUT"
rm -f "$OUT"
( cd "$STAGE" && zip -qr "$OUT" sc26-artifact-bundle )

echo
echo "    $(du -h "$OUT" | cut -f1)  $OUT"
echo "    $FILES files; $COVERED checksummed in SHA256SUMS (all but SHA256SUMS itself)"
