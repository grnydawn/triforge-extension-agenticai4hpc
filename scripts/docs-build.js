#!/usr/bin/env node
// Cross-platform docs build (Sphinx). Replaces the POSIX-only Makefile recipe so
// it also works in Windows cmd.exe / PowerShell, where `make docs` used to fail
// with "-v was unexpected at this time" (cmd.exe cannot parse `command -v uv`).
//
// Usage:
//   node scripts/docs-build.js            build the docs, then open them
//   node scripts/docs-build.js --clean    remove the built docs + docs venv
//   DOCS_OPEN=false node scripts/...      build but do NOT open a browser (CI/gate)
//
// Prefers `uv` (fast) and falls back to the stdlib `venv` + `pip`. Both `make docs`
// and `npm run docs` call this file, so the behavior is identical on every OS.
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

// Repo-relative, space-free args (cwd is ROOT) so Windows shell resolution is safe.
const DOCS_SRC = 'docs';
const DOCS_OUT = path.join('docs', '_build', 'html');
const DOCS_VENV = '.venv-docs';
const REQS = path.join('docs', 'requirements.txt');
const VENV_PY = isWin
  ? path.join(DOCS_VENV, 'Scripts', 'python.exe')
  : path.join(DOCS_VENV, 'bin', 'python');

// Windows: spawn via the shell so PATHEXT resolves uv.exe / python.exe. Args are
// repo-relative and contain no spaces, so shell quoting is not a concern.
function run(cmd, args, extraEnv) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: ROOT,
    shell: isWin,
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });
  if (r.error) {
    console.error(`Failed to run ${cmd}: ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status || 1);
}

function have(cmd) {
  const r = spawnSync(cmd, ['--version'], { stdio: 'ignore', cwd: ROOT, shell: isWin });
  return !r.error && r.status === 0;
}

if (process.argv.includes('--clean')) {
  for (const p of [DOCS_OUT, DOCS_VENV]) {
    fs.rmSync(path.join(ROOT, p), { recursive: true, force: true });
  }
  console.log(`Removed ${DOCS_OUT} and ${DOCS_VENV}`);
  process.exit(0);
}

const useUv = have('uv');
const venvExists = fs.existsSync(path.join(ROOT, VENV_PY));

if (!venvExists) {
  if (useUv) run('uv', ['venv', DOCS_VENV]);
  else run(isWin ? 'python' : 'python3', ['-m', 'venv', DOCS_VENV]);
}

if (useUv) run('uv', ['pip', 'install', '-q', '-r', REQS], { VIRTUAL_ENV: DOCS_VENV });
else run(VENV_PY, ['-m', 'pip', 'install', '-q', '-r', REQS]);

run(VENV_PY, ['-m', 'sphinx', '-b', 'html', DOCS_SRC, DOCS_OUT]);

const index = path.join(DOCS_OUT, 'index.html');
console.log(`Docs built at ${index}`);

if (process.env.DOCS_OPEN === 'false') process.exit(0);

// Open in the default browser (best-effort; never fail the build over this).
const indexAbs = path.join(ROOT, index);
if (isWin) spawnSync('cmd', ['/c', 'start', '', indexAbs], { stdio: 'ignore' });
else if (process.platform === 'darwin') spawnSync('open', [indexAbs], { stdio: 'ignore' });
else spawnSync('xdg-open', [indexAbs], { stdio: 'ignore' });
