#!/usr/bin/env bash
#
# install-linux.sh — check the toolchain, build the Triforge VS Code extension
# (triforge.vsix), and install it into VS Code, on Linux.
#
# Usage:
#   bash scripts/install/install-linux.sh [--check-only] [--yes|-y] [--skip-deps] [--help]
#
set -euo pipefail

EXT_ID="triton-team.triforge"
VSIX="triforge.vsix"
# The extension builds and runs on any modern Node (>= v20); VS Code bundles its
# own Node at runtime, and the test suite runs on current lines too (incl. 25/26).
# This project pins an LTS via .nvmrc (22) for a reproducible toolchain; a soft
# advisory points newer-than-LTS users at `nvm use`. Nothing here is fatal.
NODE_MIN_MAJOR=20
NODE_LTS_MAX_MAJOR=24
NODE_LTS_PIN=22

ASSUME_YES=0
CHECK_ONLY=0
SKIP_DEPS=0

# ---- UI helpers ------------------------------------------------------------
if [ -t 1 ]; then
  C_GREEN='\033[0;32m'; C_YELLOW='\033[0;33m'; C_RED='\033[0;31m'; C_DIM='\033[2m'; C_OFF='\033[0m'
else
  C_GREEN=''; C_YELLOW=''; C_RED=''; C_DIM=''; C_OFF=''
fi
ok()   { printf '%b✓%b %s\n' "$C_GREEN" "$C_OFF" "$1"; }
warn() { printf '%b•%b %s\n' "$C_YELLOW" "$C_OFF" "$1"; }
bad()  { printf '%b✗%b %s\n' "$C_RED" "$C_OFF" "$1"; }
info() { printf '%b%s%b\n' "$C_DIM" "$1" "$C_OFF"; }
die()  { bad "$1"; exit "${2:-1}"; }

usage() {
  cat <<'EOF'
install-linux.sh — build & install the Triforge VS Code extension on Linux.

Options:
  --check-only   Report environment + prerequisites, then stop (no changes).
  --yes, -y      Assume "yes" to every install prompt (unattended).
  --skip-deps    Do not auto-install prerequisites; only warn, then build+install.
  --help, -h     Show this help.
EOF
}

have() { command -v "$1" >/dev/null 2>&1; }

confirm() {
  # confirm "Question?" -> 0 (yes) / 1 (no). Honors --yes.
  if [ "$ASSUME_YES" -eq 1 ]; then return 0; fi
  printf '%s [y/N] ' "$1"
  read -r reply || true
  case "$reply" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

download() { # download <url> <out>
  if have curl; then curl -fsSL "$1" -o "$2";
  elif have wget; then wget -qO "$2" "$1";
  else return 1; fi
}

node_major() {
  local v
  v="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
  printf '%s\n' "${v:-0}"
}

detect_pkg_mgr() {
  local m
  for m in apt-get dnf pacman zypper; do
    if have "$m"; then printf '%s\n' "$m"; return 0; fi
  done
  return 1
}

SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

pkg_install() {
  local mgr
  mgr="$(detect_pkg_mgr)" || return 1
  case "$mgr" in
    apt-get) $SUDO apt-get update && $SUDO apt-get install -y "$@" ;;
    dnf)     $SUDO dnf install -y "$@" ;;
    pacman)  $SUDO pacman -S --noconfirm "$@" ;;
    zypper)  $SUDO zypper install -y "$@" ;;
  esac
}

install_vscode() {
  if have snap; then
    $SUDO snap install --classic code && return 0
  fi
  local mgr tmp
  mgr="$(detect_pkg_mgr || true)"
  case "$mgr" in
    apt-get)
      tmp="$(mktemp)"; mv "$tmp" "$tmp.deb"; tmp="$tmp.deb"
      download "https://code.visualstudio.com/sha/download?build=stable&os=linux-deb-x64" "$tmp" \
        && $SUDO apt-get install -y "$tmp"; rm -f "$tmp" ;;
    dnf)
      tmp="$(mktemp)"; mv "$tmp" "$tmp.rpm"; tmp="$tmp.rpm"
      download "https://code.visualstudio.com/sha/download?build=stable&os=linux-rpm-x64" "$tmp" \
        && $SUDO dnf install -y "$tmp"; rm -f "$tmp" ;;
    *)
      warn "No supported automatic VS Code install path (need snap, apt, or dnf)."
      info "Install from https://code.visualstudio.com/download, then re-run."
      return 1 ;;
  esac
}

# ---- prerequisite stages ---------------------------------------------------
# Non-fatal advisory when the running Node is newer than the current LTS lines.
# Everything (build, extension, tests) works; this only points at the pinned LTS.
node_range_advisory() {
  if [ "$(node_major)" -gt "$NODE_LTS_MAX_MAJOR" ]; then
    warn "Node.js $(node -v) is newer than the current LTS lines (v${NODE_MIN_MAJOR}-v${NODE_LTS_MAX_MAJOR})."
    info "  Everything works on it; this project just pins an LTS for a reproducible"
    info "  toolchain. With nvm installed, 'nvm use' in the repo selects it from .nvmrc."
  fi
}

ensure_node() {
  if have node && [ "$(node_major)" -ge "$NODE_MIN_MAJOR" ]; then
    ok "Node.js $(node -v) (>= v$NODE_MIN_MAJOR)"; node_range_advisory; return 0
  fi
  if have node; then bad "Node.js $(node -v) is older than the required v$NODE_MIN_MAJOR."
  else bad "Node.js not found (need >= v$NODE_MIN_MAJOR)."; fi
  if [ "$CHECK_ONLY" -eq 1 ] || [ "$SKIP_DEPS" -eq 1 ]; then return 0; fi
  if confirm "Install Node.js + npm via the system package manager?"; then
    pkg_install nodejs npm || warn "Package-manager install failed."
    if have node && [ "$(node_major)" -ge "$NODE_MIN_MAJOR" ]; then ok "Node.js $(node -v) installed."; node_range_advisory
    else warn "Node is still < v$NODE_MIN_MAJOR. Install Node LTS v$NODE_LTS_PIN from https://nodejs.org or via nvm, then re-run."; fi
  else warn "Skipping Node.js install."; fi
}

ensure_npm() {
  if have npm; then ok "npm $(npm -v)"; else bad "npm not found (ships with Node.js)."; fi
}

ensure_code() {
  if have code; then ok "VS Code CLI $(code --version | head -n1)"; return 0; fi
  bad "VS Code 'code' CLI not found on PATH."
  if [ "$CHECK_ONLY" -eq 1 ] || [ "$SKIP_DEPS" -eq 1 ]; then return 0; fi
  if confirm "Install VS Code now?"; then
    install_vscode || warn "VS Code install did not complete; see https://code.visualstudio.com/download."
  else warn "Skipping VS Code install."; fi
  have code || warn "'code' still not on PATH — open a new terminal (or add VS Code's bin to PATH), then re-run."
}

runtime_report() {
  echo "-- runtime readiness (informational; not installed) --"
  if have python3; then ok "python3 $(python3 --version 2>&1 | awk '{print $2}') — DEM download available"
  else warn "python3 not found — needed for DEM download (Static Input → Elevation)."; fi
  if have docker; then ok "docker present — Docker execution mode available"
  else warn "docker not found — needed only for Docker execution mode (https://docs.docker.com/engine/install/)."; fi
  if have mpirun; then ok "mpirun present — multi-process runs available"
  else warn "mpirun not found — needed for MPI (mpirun) runs; install an MPI runtime (e.g. openmpi)."; fi
}

build_and_install() {
  echo "-- build --"
  if [ -f package-lock.json ]; then
    npm ci || { warn "npm ci failed (lockfile out of sync?); retrying with npm install"; npm install; }
  else
    npm install
  fi
  npm run vscode:prepublish
  npx --yes @vscode/vsce package --no-dependencies -o "$VSIX"
  ok "Packaged $VSIX"

  echo "-- install --"
  code --install-extension "$VSIX" --force

  echo "-- verify --"
  if code --list-extensions --show-versions | grep -q "^${EXT_ID}@"; then
    ok "Installed: $(code --list-extensions --show-versions | grep "^${EXT_ID}@")"
    info "Reload or restart VS Code to activate the extension."
  else
    die "Verification failed: $EXT_ID is not listed by 'code --list-extensions'."
  fi
}

# ---- main ------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --check-only) CHECK_ONLY=1 ;;
    -y|--yes)     ASSUME_YES=1 ;;
    --skip-deps)  SKIP_DEPS=1 ;;
    -h|--help)    usage; exit 0 ;;
    *) echo "unknown option: $arg" >&2; usage; exit 2 ;;
  esac
done

if [ "$(uname -s)" != "Linux" ]; then
  die "This script is for Linux. On macOS use install-macos.sh; on Windows use install-windows.ps1."
fi

# Locate the repo root (walk up to package.json with the expected name).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT=""
_d="$SCRIPT_DIR"
while [ "$_d" != "/" ]; do
  if [ -f "$_d/package.json" ] && grep -q '"name": *"triforge"' "$_d/package.json"; then
    REPO_ROOT="$_d"; break
  fi
  _d="$(dirname "$_d")"
done
[ -n "$REPO_ROOT" ] || die "Could not locate the triforge repo root above $SCRIPT_DIR."
cd "$REPO_ROOT"

echo "== Triforge extension installer (Linux) =="
info "repo:  $REPO_ROOT"
info "os:    $(uname -s) $(uname -m)"
info "shell: ${SHELL:-unknown}"
if have node; then info "node:  $(node -v)"; else info "node:  (absent)"; fi
if have npm;  then info "npm:   $(npm -v)"; else info "npm:   (absent)"; fi
if have code; then info "code:  $(code --version | head -n1)"; else info "code:  (absent)"; fi

echo "== toolchain =="
ensure_node
ensure_npm
ensure_code

runtime_report

if [ "$CHECK_ONLY" -eq 1 ]; then
  echo "== check-only: no changes made =="
  exit 0
fi

# Hard gate before building.
if ! have node || [ "$(node_major)" -lt "$NODE_MIN_MAJOR" ]; then
  die "Node.js >= v$NODE_MIN_MAJOR is required to build. Install it and re-run."
fi
have npm  || die "npm is required to build. Install Node.js (includes npm) and re-run."
have code || die "The VS Code 'code' CLI is required to install the extension. Install VS Code and re-run."

build_and_install
echo "== done =="
