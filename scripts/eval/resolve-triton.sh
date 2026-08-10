#!/usr/bin/env bash
# Resolve the TRITON solver into $TRITON_EXE. Sourced, never executed:
#
#   . "$HERE/resolve-triton.sh" || exit 1
#
# The artifact does not ship the solver (eval/diagnose-corpus/build/ is gitignored, and a
# machine-specific binary is not evidence), so a fresh clone has nothing to run. Rather
# than fail on that, ask where TRITON lives and remember the answer.
#
# Order: an explicit $TRITON_EXE, the remembered path, then the build tree the Artifact
# Description appendix tells reviewers to create. If none of those hold an executable and
# there is a terminal to ask on, ask; otherwise fail with the ways to fix it.

__triton_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
__triton_corpus="$(cd "$__triton_here/../../eval/diagnose-corpus" && pwd)"
__triton_saved="$__triton_corpus/.triton-exe"
__triton_default="$__triton_corpus/build/triton.exe"

# Find the solver under a path the user named: the file itself, then the layouts a CMake
# build leaves behind, then a bounded search for anything named like it.
__triton_find() {
  local p="$1" c
  [ -n "$p" ] || return 1
  p="${p/#\~/$HOME}"
  if [ -f "$p" ] && [ -x "$p" ]; then printf '%s\n' "$p"; return 0; fi
  [ -d "$p" ] || return 1
  for c in "$p/triton.exe" "$p/build/triton.exe" "$p/bin/triton.exe" "$p/build/bin/triton.exe"; do
    [ -x "$c" ] && [ -f "$c" ] && { printf '%s\n' "$c"; return 0; }
  done
  c="$(find "$p" -maxdepth 4 -type f -name 'triton*.exe' -perm -u+x 2>/dev/null | head -1)"
  [ -n "$c" ] && { printf '%s\n' "$c"; return 0; }
  return 1
}

__triton_resolve() {
  local c
  [ -n "${TRITON_EXE:-}" ] && [ -x "${TRITON_EXE:-}" ] && return 0
  if [ -f "$__triton_saved" ]; then
    c="$(__triton_find "$(cat "$__triton_saved" 2>/dev/null)")" && { TRITON_EXE="$c"; return 0; }
  fi
  [ -x "$__triton_default" ] && { TRITON_EXE="$__triton_default"; return 0; }
  return 1
}

if ! __triton_resolve; then
  # Talk to /dev/tty, not stdin: run-triton-oracle.sh is called inside $( ), where stdin
  # is not the user's terminal and stdout is being captured. Probe it by opening it —
  # the device node exists even in a cron job or a container with no controlling
  # terminal, where the open fails with ENXIO. No terminal means no prompt, which is
  # what the failure below is for.
  if { exec 3<>/dev/tty; } 2>/dev/null; then
    {
      echo "No TRITON solver found."
      echo "  expected at: $__triton_default"
      echo "  The artifact does not ship it. Build settings and the upstream commit are"
      echo "  recorded in $__triton_corpus/triton-build/ (see the Artifact Description appendix)."
      echo
    } >&3
    for __triton_try in 1 2 3; do
      printf 'Path to your TRITON repository or build directory (blank to give up): ' >&3
      IFS= read -r __triton_ans <&3 || __triton_ans=""
      [ -n "$__triton_ans" ] || break
      if __triton_hit="$(__triton_find "$__triton_ans")"; then
        TRITON_EXE="$__triton_hit"
        printf '%s\n' "$TRITON_EXE" > "$__triton_saved" 2>/dev/null \
          && echo "Using $TRITON_EXE — remembered in $__triton_saved, delete it to be asked again." >&3 \
          || echo "Using $TRITON_EXE (could not write $__triton_saved, so this will be asked again)." >&3
        break
      fi
      echo "No executable triton.exe under: $__triton_ans" >&3
    done
    exec 3>&-
  fi
fi

if [ -z "${TRITON_EXE:-}" ] || [ ! -x "${TRITON_EXE:-}" ]; then
  {
    echo "missing solver: no TRITON binary found."
    echo "  Fix it in any of these ways:"
    echo "    export TRITON_EXE=/path/to/triton.exe"
    echo "    echo /path/to/triton.exe > $__triton_saved"
    echo "    build it at $__triton_default (see $__triton_corpus/triton-build/)"
    echo "  Run this from a terminal and it will ask for the path instead."
  } >&2
  return 1 2>/dev/null || exit 1
fi

export TRITON_EXE
