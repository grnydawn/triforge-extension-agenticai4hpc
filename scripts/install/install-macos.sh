#!/usr/bin/env bash
#
# install-macos.sh — check the toolchain, build the Triforge VS Code extension
# (triforge.vsix), and install it into VS Code, on macOS. bash-3.2 compatible.
#
# Usage:
#   bash scripts/install/install-macos.sh [--check-only] [--yes|-y] [--skip-deps] [--help]
#
set -euo pipefail

EXT_ID="triton-team.triforge"
VSIX="triforge.vsix"
# The extension builds and runs on any modern Node (>= v20); VS Code bundles its
# own Node at runtime, and the test suite runs on current lines too (incl. 25/26).
# This project pins an LTS via .nvmrc (22) for a reproducible toolchain; auto-
# installs steer to that LTS, and a soft advisory points newer-than-LTS users at
# `nvm use`. Nothing here is fatal.
NODE_MIN_MAJOR=20
NODE_LTS_MAX_MAJOR=24
NODE_LTS_PIN=22

ASSUME_YES=0
CHECK_ONLY=0
SKIP_DEPS=0

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
install-macos.sh — build & install the Triforge VS Code extension on macOS.

Options:
  --check-only   Report environment + prerequisites, then stop (no changes).
  --yes, -y      Assume "yes" to every install prompt (unattended).
  --skip-deps    Do not auto-install prerequisites; only warn, then build+install.
  --help, -h     Show this help.
EOF
}

have() { command -v "$1" >/dev/null 2>&1; }

confirm() {
  if [ "$ASSUME_YES" -eq 1 ]; then return 0; fi
  printf '%s [y/N] ' "$1"
  read -r reply || true
  case "$reply" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

node_major() {
  local v
  v="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
  printf '%s\n' "${v:-0}"
}

ensure_brew() {
  if have brew; then ok "Homebrew $(brew --version | head -n1 | awk '{print $2}')"; return 0; fi
  bad "Homebrew not found (needed to auto-install Node.js / VS Code)."
  if [ "$CHECK_ONLY" -eq 1 ] || [ "$SKIP_DEPS" -eq 1 ]; then return 0; fi
  if confirm "Install Homebrew from https://brew.sh?"; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
    if [ -x /usr/local/bin/brew ]; then eval "$(/usr/local/bin/brew shellenv)"; fi
    have brew && ok "Homebrew installed." || warn "Homebrew still not on PATH; open a new terminal and re-run."
  else warn "Skipping Homebrew install; Node/VS Code auto-install will be unavailable."; fi
}

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
  if confirm "Install Node.js (LTS v$NODE_LTS_PIN) via Homebrew?"; then
    if have brew; then
      # Pin the LTS line rather than 'node' (latest) for a reproducible toolchain.
      # node@N is keg-only, so put it on PATH for this build session.
      brew install "node@$NODE_LTS_PIN" || warn "brew install node@$NODE_LTS_PIN failed."
      export PATH="$(brew --prefix)/opt/node@$NODE_LTS_PIN/bin:$PATH"
    else warn "Homebrew is required; install it (offered above) and re-run."; fi
    if have node && [ "$(node_major)" -ge "$NODE_MIN_MAJOR" ]; then ok "Node.js $(node -v) installed."
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
  if confirm "Install VS Code via Homebrew?"; then
    if have brew; then brew install --cask visual-studio-code || warn "brew cask install failed."
    else warn "Homebrew is required; install it (offered above) and re-run."; fi
  else warn "Skipping VS Code install."; fi
  if ! have code; then
    warn "'code' not on PATH. In VS Code run: Cmd+Shift+P → 'Shell Command: Install code command in PATH', then re-run."
  fi
}

runtime_report() {
  echo "-- runtime readiness (informational; not installed) --"
  if have python3; then ok "python3 $(python3 --version 2>&1 | awk '{print $2}') — DEM download available"
  else warn "python3 not found — needed for DEM download; install via 'brew install python' or Xcode CLT."; fi
  if have docker; then ok "docker present — Docker execution mode available"
  else warn "docker not found — needed only for Docker execution mode (Docker Desktop for Mac)."; fi
  if have mpirun; then ok "mpirun present — multi-process runs available"
  else warn "mpirun not found — needed for MPI runs; install with 'brew install open-mpi'."; fi
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

for arg in "$@"; do
  case "$arg" in
    --check-only) CHECK_ONLY=1 ;;
    -y|--yes)     ASSUME_YES=1 ;;
    --skip-deps)  SKIP_DEPS=1 ;;
    -h|--help)    usage; exit 0 ;;
    *) echo "unknown option: $arg" >&2; usage; exit 2 ;;
  esac
done

if [ "$(uname -s)" != "Darwin" ]; then
  die "This script is for macOS. On Linux use install-linux.sh; on Windows use install-windows.ps1."
fi

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

echo "== Triforge extension installer (macOS) =="
info "repo:  $REPO_ROOT"
info "os:    $(uname -s) $(uname -m)"
info "shell: ${SHELL:-unknown}"
if have node; then info "node:  $(node -v)"; else info "node:  (absent)"; fi
if have npm;  then info "npm:   $(npm -v)"; else info "npm:   (absent)"; fi
if have code; then info "code:  $(code --version | head -n1)"; else info "code:  (absent)"; fi

echo "== toolchain =="
ensure_brew
ensure_node
ensure_npm
ensure_code

runtime_report

if [ "$CHECK_ONLY" -eq 1 ]; then
  echo "== check-only: no changes made =="
  exit 0
fi

if ! have node || [ "$(node_major)" -lt "$NODE_MIN_MAJOR" ]; then
  die "Node.js >= v$NODE_MIN_MAJOR is required to build. Install it and re-run."
fi
have npm  || die "npm is required to build. Install Node.js (includes npm) and re-run."
have code || die "The VS Code 'code' CLI is required to install the extension. Install VS Code and re-run."

build_and_install
echo "== done =="
