# Local install scripts

Build the Triforge VS Code extension (`triforge.vsix`) and install it into VS Code,
with a per-OS script that first checks (and, with your OK, installs) the build
toolchain. Run the one for your OS from anywhere in a checkout:

| OS | Command |
|----|---------|
| macOS | `bash scripts/install/install-macos.sh` |
| Linux | `bash scripts/install/install-linux.sh` |
| Windows | `powershell -ExecutionPolicy Bypass -File scripts\install\install-windows.ps1` |

## Flags

| bash | PowerShell | Effect |
|------|------------|--------|
| `--check-only` | `-CheckOnly` | Report environment + prerequisites, then stop. No changes. |
| `--yes`, `-y` | `-Yes` | Assume "yes" to every install prompt (unattended). |
| `--skip-deps` | `-SkipDeps` | Don't auto-install prerequisites; only warn, then build + install. |
| `--help`, `-h` | `-Help` | Usage. |

## What each script does

1. Locate the repo root and print an environment report (OS, arch, Node, npm, VS Code).
2. Check the build toolchain: **Node.js ≥ 18**, **npm**, **VS Code + the `code` CLI**.
   Missing items are offered for install (prompted) via the OS package manager —
   Homebrew (macOS), apt/dnf/pacman/zypper (Linux), or winget→Chocolatey (Windows).
3. Report **runtime readiness** — `python3`, `docker`, `mpirun` — informational only;
   these are what *running* simulations needs and are never auto-installed.
4. Build the VSIX (`npm ci` → `npm run vscode:prepublish` → `vsce package --no-dependencies`).
5. Install it (`code --install-extension triforge.vsix --force`) and verify.

The scripts only install the **extension**. Building TRITON itself (source/executable/
docker) is separate — see the project README.
