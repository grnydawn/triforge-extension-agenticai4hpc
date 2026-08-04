# Testing

This repository ships a tiered test suite. Every tier is manually invokable via
the root `Makefile` (self-documenting — run `make help`) and via the underlying
npm scripts in `package.json`. The same tiers map 1:1 to the CI jobs in
`.github/workflows/ci.yml`.

## Tiers at a glance

| Tier | What it covers | make target | npm script |
| --- | --- | --- | --- |
| Tier-0 static | TypeScript type gate (`tsc --noEmit`) + ESLint over `src` | `make typecheck`, `make lint` | `npm run typecheck`, `npm run lint` |
| Tier-1 unit | Mocha + ts-node + chai unit tests against a `vscode` stub — fast, no display | `make test-unit` | `npm run test:unit` |
| Tier-2 E2E | Full-UI scenario tests driving a real VS Code via ExTester | `make test-e2e` | `npm run test:e2e` |
| Packaging | Build production bundles, `vsce package`, assert no dev files leak into the VSIX | `make package` | (see below) |

### Tier-0 — static (typecheck + lint)

```
make typecheck     # tsc --noEmit -p .
make lint          # eslint src --ext ts
```

`lint` currently exits 0 with a backlog of tracked warnings (no errors).

### Tier-1 — unit tests

```
make test-unit     # npm run test:unit
```

Runs Mocha (`cross-env TS_NODE_TRANSPILE_ONLY=true TS_NODE_PROJECT=tsconfig.test.json mocha`)
with a `vscode` stub (`test/helpers/register-vscode-stub.js`). Fast and headless —
no VS Code instance and no display required.

### Tier-2 — Full-UI scenario E2E (ExTester)

```
make test-e2e        # runs under xvfb-run -a when available, else directly
```

These drive a **real VS Code** instance (downloaded at **version 1.90.0**, stable)
via [ExTester](https://github.com/redhat-developer/vscode-extension-tester) over
`test/e2e/suites/**/*.e2e.test.ts`. Under the hood:

```
extest setup-and-run "test/e2e/suites/**/*.e2e.test.ts" \
  --code_version 1.90.0 --type stable \
  --mocha_config test/.mocharc-e2e.js -i \
  --code_settings test/extester-settings.json
```

This tier is **slow (~25 min)** and **needs a display**. On a headless machine
run it under Xvfb — the `make test-e2e` target does this automatically:

```make
@if command -v xvfb-run >/dev/null 2>&1; then xvfb-run -a env $(if $(E2E_GLOB),E2E_GLOB="$(E2E_GLOB)",) npm run test:e2e:run; else env ... npm run test:e2e:run; fi
```

`make test-e2e` routes through the `test:e2e:run` script, passing an optional
`E2E_GLOB` (see "E2E categories" below); with no `CAT`/`SUITE` it defaults to all
suites. The `pretest:e2e:run` script (`npm run compile && npm run build:webview`)
builds the extension and webview bundles before the suite runs.

### Packaging gate

```
make package
```

Mirrors the CI `package` job: it packages a VSIX with
`npx --yes @vscode/vsce package --no-dependencies -o triforge.vsix` (vsce runs the
`vscode:prepublish` webpack build itself), then fails if
`npx --yes @vscode/vsce ls` lists any developer-only files
(`.claude/`, `debug_inputgen`, `src/`, `*.ts`, `docs/`, `test/`, `CODE_REVIEW`,
`Makefile`).

> `make package` never changes the version. To build **and** install the VSIX
> into VS Code in one step, use `make install-vsix`.

## Composite tiers

| make target | What it runs |
| --- | --- |
| `make test-fast` | typecheck + lint + test-unit — the **commit-time** fast gate (same as `npm run test:fast`) |
| `make test-all` / `make gate` | typecheck + lint + test-unit + test-e2e + package — the full G0/G1 gate |

```
make test-fast     # fast pre-commit gate (no display, no VS Code download)
make test-all      # full gate including the ~25min E2E suite
```

## Commit-time hook

A git `pre-commit` hook lives at `scripts/hooks/pre-commit` (committed and
executable). It runs the **fast tier only** — `npm run typecheck`,
`npm run lint`, `npm run test:unit` — and exits non-zero if any step fails. It
**deliberately skips the Tier-2 E2E suite** (too slow, needs a display).

Enable it (sets `git config core.hooksPath scripts/hooks`):

```
make install-hooks      # or: npm run hooks:install
```

Disable it:

```
make uninstall-hooks    # git config --unset core.hooksPath
```

Bypass it for a single commit:

```
git commit --no-verify
```

The hook is installed via `core.hooksPath`, so it needs **no husky and no extra
npm dependency**.

## CI ↔ tier mapping

`.github/workflows/ci.yml` defines four jobs, one per tier:

| CI job | Tier | Commands |
| --- | --- | --- |
| `lint-type` | Tier-0 static | `npm run typecheck`, `npm run lint` |
| `unit` | Tier-1 unit | `npm run test:unit` |
| `e2e` | Tier-2 E2E | `xvfb-run -a npm run test:e2e` (installs Xvfb, caches VS Code + chromedriver) |
| `package` | Packaging | `npm run vscode:prepublish` + `vsce package` + dev-file leak grep |

## xfail red→green gate

Known, unfixed findings from the code review are guarded by `xfail()` wrappers
(`test/helpers/xfail.ts`) and tracked in `test/XFAIL.md`. The mechanism:

- While the bug exists, the post-fix assertion throws, `xfail()` swallows it, and
  the test **passes** (red, expected).
- When the fix lands, the post-fix assertion no longer throws, so `xfail()`
  **throws** to fail the test loudly — signalling "remove the `xfail()` wrapper
  so the bare assertion guards the fix, and delete the row from `test/XFAIL.md`"
  (green).

See `test/XFAIL.md` for the current backlog and `test/helpers/xfail.ts` for the
wrapper implementation.

## E2E categories

The Tier-2 suite is organized into five category directories under
`test/e2e/suites/`:

| Category | Contents |
| --- | --- |
| `core` | Extension activation, settings, project lifecycle |
| `data` | DEM fetch, GeoTIFF loading, data I/O |
| `run` | Simulation execution and job management |
| `viz` | Map webview, animation, output visualization |
| `ai` | Agentic-AI access: per-project context files, control-root project catalog (@-reference), output normalization |

Pass `CAT=<category>` or `SUITE=<name>` to `make test-e2e` to run only the
matching subset — useful for fast feedback during targeted development.

```bash
make test-e2e                  # run all E2E suites (~25min)
make test-e2e CAT=core         # run only suites in test/e2e/suites/core/
make test-e2e CAT=ai           # run only suites in test/e2e/suites/ai/
make test-e2e SUITE=activation # run only activation.e2e.test.ts (any category)
```

If both `CAT` and `SUITE` are supplied, `SUITE` takes precedence.

`test-all` / `gate` always run all suites (no `CAT`/`SUITE` passed).

## Quick reference

```
make help            # list all targets with descriptions
make deps            # npm ci
make build           # compile extension + webview bundles
make typecheck       # Tier-0: tsc --noEmit
make lint            # Tier-0: eslint src
make test-unit       # Tier-1 unit tests
make test-e2e        # Tier-2 Full-UI E2E (xvfb-guarded; ~25min; VS Code 1.90.0)
make test-e2e CAT=core   # run only the core category
make test-e2e SUITE=activation  # run only activation.e2e.test.ts
make test-fast       # commit-time fast gate (typecheck + lint + unit)
make test-all        # full G0/G1 gate (fast tiers + e2e + package)
make package         # CI-style package + dev-file leak check
make install-hooks   # enable the commit-time fast gate
make uninstall-hooks # disable the commit-time fast gate
make clean           # remove dist/ and *.vsix
```
