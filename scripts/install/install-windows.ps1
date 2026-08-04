#Requires -Version 5.1
<#
  install-windows.ps1 -- check the toolchain, build the Triforge VS Code extension
  (triforge.vsix), and install it into VS Code, on Windows.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts\install\install-windows.ps1 `
      [-CheckOnly] [-Yes] [-SkipDeps] [-Help]
#>
[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [switch]$Yes,
  [switch]$SkipDeps,
  [switch]$Help
)

$ErrorActionPreference = 'Stop'
$ExtId = 'triton-team.triforge'
$Vsix  = 'triforge.vsix'
# The extension builds/runs on any modern Node (>= v20); VS Code bundles its own at
# runtime, and the test suite runs on current lines too (incl. 25/26). This project
# pins an LTS via .nvmrc (22) for a reproducible toolchain; winget/choco install the
# LTS, and a soft advisory points newer-than-LTS users at nvm. Nothing here is fatal.
$NodeMinMajor = 20
$NodeLtsMaxMajor = 24

function Write-Ok   ($m) { Write-Host "[ ok ] $m" -ForegroundColor Green }
function Write-Warn ($m) { Write-Host "[ .. ] $m" -ForegroundColor Yellow }
function Write-Bad  ($m) { Write-Host "[fail] $m" -ForegroundColor Red }
function Write-Dim  ($m) { Write-Host $m -ForegroundColor DarkGray }

function Show-Usage {
  @'
install-windows.ps1 -- build & install the Triforge VS Code extension on Windows.

Options:
  -CheckOnly   Report environment + prerequisites, then stop (no changes).
  -Yes         Assume "yes" to every install prompt (unattended).
  -SkipDeps    Do not auto-install prerequisites; only warn, then build+install.
  -Help        Show this help.
'@ | Write-Host
}

function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

function Confirm-Install($msg) {
  if ($Yes) { return $true }
  $r = Read-Host "$msg [y/N]"
  return ($r -match '^(y|yes)$')
}

function Get-NodeMajor {
  if (-not (Have node)) { return 0 }
  $v = (node -v) -replace '^v',''
  return [int]($v.Split('.')[0])
}

function Install-Pkg($wingetId, $chocoId) {
  if (Have winget) {
    winget install -e --id $wingetId --accept-source-agreements --accept-package-agreements
    return
  }
  if (Have choco) {
    choco install $chocoId -y
    return
  }
  Write-Warn 'Neither winget nor Chocolatey is available.'
  if (Confirm-Install 'Install Chocolatey (https://chocolatey.org)?') {
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    choco install $chocoId -y
  } else {
    throw "No package manager available to install $wingetId."
  }
}

function Node-RangeAdvisory {
  # Non-fatal: everything works on newer Node; this just points at the pinned LTS.
  if ((Get-NodeMajor) -gt $NodeLtsMaxMajor) {
    Write-Warn "Node.js $(node -v) is newer than the current LTS lines (v$NodeMinMajor-v$NodeLtsMaxMajor)."
    Write-Dim "  Everything works on it; this project just pins an LTS for a reproducible"
    Write-Dim "  toolchain. With nvm-windows, 'nvm use' in the repo selects it from .nvmrc."
  }
}

function Ensure-Node {
  if ((Have node) -and ((Get-NodeMajor) -ge $NodeMinMajor)) {
    Write-Ok "Node.js $(node -v) (>= v$NodeMinMajor)"; Node-RangeAdvisory; return
  }
  if (Have node) { Write-Bad "Node.js $(node -v) is older than the required v$NodeMinMajor." }
  else { Write-Bad "Node.js not found (need >= v$NodeMinMajor)." }
  if ($CheckOnly -or $SkipDeps) { return }
  if (Confirm-Install 'Install Node.js LTS?') {
    Install-Pkg 'OpenJS.NodeJS.LTS' 'nodejs-lts'
    if ((Have node) -and ((Get-NodeMajor) -ge $NodeMinMajor)) { Write-Ok "Node.js $(node -v) installed." }
    else { Write-Warn "Node still < v$NodeMinMajor or not on PATH. Open a NEW PowerShell and re-run, or install from https://nodejs.org." }
  } else { Write-Warn 'Skipping Node.js install.' }
}

function Ensure-Npm {
  if (Have npm) { Write-Ok "npm $(npm -v)" } else { Write-Bad 'npm not found (ships with Node.js).' }
}

function Ensure-Code {
  if (Have code) { Write-Ok "VS Code CLI $((code --version)[0])"; return }
  Write-Bad "VS Code 'code' CLI not found on PATH."
  if ($CheckOnly -or $SkipDeps) { return }
  if (Confirm-Install 'Install VS Code?') {
    Install-Pkg 'Microsoft.VisualStudioCode' 'vscode'
  } else { Write-Warn 'Skipping VS Code install.' }
  if (-not (Have code)) {
    Write-Warn "'code' not on PATH yet -- open a NEW PowerShell window (winget updates PATH for new sessions) and re-run."
  }
}

function Report-Runtime {
  Write-Host '-- runtime readiness (informational; not installed) --'
  if (Have python)  { Write-Ok  'python present -- DEM download available' }
  elseif (Have python3) { Write-Ok 'python3 present -- DEM download available' }
  else { Write-Warn 'python not found -- needed for DEM download; install Python 3 (winget install Python.Python.3.12).' }
  if (Have docker) { Write-Ok 'docker present -- Docker execution mode available' }
  else { Write-Warn 'docker not found -- needed only for Docker execution mode (Docker Desktop for Windows).' }
  if (Have mpiexec) { Write-Ok 'mpiexec present -- multi-process runs available' }
  else { Write-Warn 'mpiexec not found -- needed for MPI runs (e.g. Microsoft MPI).' }
}

function Build-And-Install {
  Write-Host '-- build --'
  if (Test-Path 'package-lock.json') {
    try { npm ci } catch { Write-Warn 'npm ci failed; retrying with npm install'; npm install }
  } else { npm install }
  npm run vscode:prepublish
  npx --yes @vscode/vsce package --no-dependencies -o $Vsix
  Write-Ok "Packaged $Vsix"

  Write-Host '-- install --'
  code --install-extension $Vsix --force

  Write-Host '-- verify --'
  $listed = (code --list-extensions --show-versions) | Select-String "^$([regex]::Escape($ExtId))@"
  if ($listed) {
    Write-Ok "Installed: $listed"
    Write-Dim 'Reload or restart VS Code to activate the extension.'
  } else {
    throw "Verification failed: $ExtId is not listed by 'code --list-extensions'."
  }
}

# ---- main ------------------------------------------------------------------
if ($Help) { Show-Usage; exit 0 }

if (($PSVersionTable.PSVersion.Major -ge 6) -and (-not $IsWindows)) {
  Write-Bad 'This script is for Windows. On macOS/Linux use the .sh scripts.'
  exit 1
}

# Locate the repo root (walk up to package.json with the expected name).
$dir = Split-Path -Parent $PSCommandPath
$repoRoot = $null
while ($dir -and (Test-Path $dir)) {
  $pj = Join-Path $dir 'package.json'
  if ((Test-Path $pj) -and (Select-String -Path $pj -Pattern '"name":\s*"triforge"' -Quiet)) {
    $repoRoot = $dir; break
  }
  $parent = Split-Path -Parent $dir
  if ($parent -eq $dir) { break }
  $dir = $parent
}
if (-not $repoRoot) { Write-Bad "Could not locate the triforge repo root above $PSCommandPath."; exit 1 }
Set-Location $repoRoot

Write-Host '== Triforge extension installer (Windows) =='
Write-Dim "repo: $repoRoot"
Write-Dim "ps:   $($PSVersionTable.PSVersion)"
if (Have node) { Write-Dim "node: $(node -v)" } else { Write-Dim 'node: (absent)' }
if (Have npm)  { Write-Dim "npm:  $(npm -v)" } else { Write-Dim 'npm:  (absent)' }
if (Have code) { Write-Dim "code: $((code --version)[0])" } else { Write-Dim 'code: (absent)' }

Write-Host '== toolchain =='
Ensure-Node
Ensure-Npm
Ensure-Code

Report-Runtime

if ($CheckOnly) { Write-Host '== check-only: no changes made =='; exit 0 }

if (-not (Have node) -or ((Get-NodeMajor) -lt $NodeMinMajor)) { Write-Bad "Node.js >= v$NodeMinMajor is required to build."; exit 1 }
if (-not (Have npm))  { Write-Bad 'npm is required to build.'; exit 1 }
if (-not (Have code)) { Write-Bad "The VS Code 'code' CLI is required to install the extension."; exit 1 }

Build-And-Install
Write-Host '== done =='
