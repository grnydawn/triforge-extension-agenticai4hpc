.DEFAULT_GOAL := help

.PHONY: help deps build typecheck lint lint-scripts \
	test-unit test-hpc test-e2e test-fast test-all gate \
	package install-vsix run-installer clean \
	install-hooks uninstall-hooks \
	package-pre-release publish-login publish-pre-release publish-ovsx \
	rawdiff docs docs-clean

# Null device that works whether make's shell is cmd.exe (Windows) or sh.
ifeq ($(OS),Windows_NT)
DEVNULL := NUL
else
DEVNULL := /dev/null
endif

# Publisher id from package.json (the registry account that must own this).
# Assigned lazily (=) so it only runs `node` when a publish-* target actually
# references it — never for build/install/test/run-installer. This also keeps a
# plain `make run-installer` from spawning node (and, on Windows cmd, from
# printing a stray "The system cannot find the path specified.").
PUBLISHER = $(shell node -p "require('./package.json').publisher" 2>$(DEVNULL))

help: ## list available targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Dev pipeline
# ---------------------------------------------------------------------------
deps: ## install dependencies (npm ci)
	npm ci

build: ## compile extension + webview bundles
	npm run compile && npm run build:webview

# ---------------------------------------------------------------------------
# Documentation (Sphinx / Read the Docs)
# ---------------------------------------------------------------------------
DOCS_SRC  := docs
DOCS_OUT  := docs/_build/html
DOCS_VENV := .venv-docs

# DOCS_OPEN=false skips opening the built docs in a browser (CI / the -W gate).
# Exported so `make docs DOCS_OPEN=false` reaches scripts/docs-build.js as an env var.
export DOCS_OPEN

# The build is a plain `node` call so it runs under Windows cmd.exe too (the old
# POSIX recipe crashed there with "-v was unexpected at this time"). All the
# uv/venv/sphinx logic lives in scripts/docs-build.js — see it for details.
docs: ## build the online docs (Sphinx) and open them (cross-platform; DOCS_OPEN=false to skip)
	@node scripts/docs-build.js

docs-clean: ## remove the built docs and the docs virtualenv
	@node scripts/docs-build.js --clean

# ---------------------------------------------------------------------------
# Quality gates
# ---------------------------------------------------------------------------
typecheck: ## static type gate (tsc --noEmit)
	npm run typecheck

lint: ## eslint src
	npm run lint

lint-scripts: ## lint the install scripts (shellcheck + PSScriptAnalyzer when present)
	@bash -n scripts/install/install-linux.sh && bash -n scripts/install/install-macos.sh && echo "bash syntax OK"
	@if command -v shellcheck >/dev/null 2>&1; then shellcheck scripts/install/install-linux.sh scripts/install/install-macos.sh; else echo "shellcheck not installed — skipping bash lint"; fi
	@if command -v pwsh >/dev/null 2>&1; then pwsh -NoProfile -Command "if (Get-Module -ListAvailable PSScriptAnalyzer) { Invoke-ScriptAnalyzer -Path scripts/install/install-windows.ps1 -EnableExit } else { Write-Host 'PSScriptAnalyzer not installed — skipping' }"; else echo "pwsh not installed — skipping PowerShell lint"; fi

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
test-unit: ## Tier-1 unit tests (fast, no display)
	npm run test:unit

test-hpc: ## HPC companion CLI tests (scripts/hpc, pure Python 3 stdlib)
	npm run test:hpc

# Narrow the E2E run: `make test-e2e CAT=ai` (a category dir) or
# `make test-e2e SUITE=agentContext` (a single suite anywhere). No arg = all.
ifdef CAT
E2E_GLOB := test/e2e/suites/$(CAT)/*.e2e.test.ts
endif
ifdef SUITE
E2E_GLOB := test/e2e/suites/**/$(SUITE).e2e.test.ts
endif

test-e2e: ## Tier-2 E2E (all; or CAT=<core|data|run|viz|ai> / SUITE=<name>; needs a display)
	@if command -v xvfb-run >/dev/null 2>&1; then \
		xvfb-run -a env $(if $(E2E_GLOB),E2E_GLOB="$(E2E_GLOB)",) npm run test:e2e:run; \
	else \
		env $(if $(E2E_GLOB),E2E_GLOB="$(E2E_GLOB)",) npm run test:e2e:run; \
	fi

test-fast: typecheck lint test-unit ## commit-time fast gate (typecheck + lint + unit)

test-all: typecheck lint test-unit test-e2e package ## full G0/G1 gate (fast tiers + e2e + package)

gate: test-all ## alias for the full G0/G1 gate

# ---------------------------------------------------------------------------
# Package & install
# `vsce package` runs `vscode:prepublish` (webpack production) itself, so the
# recipes below never build separately.
# ---------------------------------------------------------------------------
package: ## build triforge.vsix (CI-style) + dev-file leak check
	npx --yes @vscode/vsce package --no-dependencies -o triforge.vsix
	@if npx --yes @vscode/vsce ls | grep -E "\.claude/|debug_inputgen|^src/|\.ts$$|docs/|test/|CODE_REVIEW|Makefile"; then \
		echo "::error::VSIX contains developer-only files"; exit 1; \
	fi

install-vsix: package ## build then install the extension into VS Code
	code --install-extension triforge.vsix --force

# Pick the OS-native installer script. Windows sets OS=Windows_NT (true even
# under Git Bash), so it wins before uname is consulted; forward slashes work in
# PowerShell's -File and stay safe across cmd / Git Bash.
ifeq ($(OS),Windows_NT)
INSTALLER := powershell -ExecutionPolicy Bypass -File scripts/install/install-windows.ps1
else ifeq ($(shell uname -s),Darwin)
INSTALLER := bash scripts/install/install-macos.sh
else
INSTALLER := bash scripts/install/install-linux.sh
endif

run-installer: ## detect OS + run the matching scripts/install script (pass flags via ARGS=...)
	$(INSTALLER) $(ARGS)

clean: ## remove dist/ and *.vsix (keeps node_modules + test-resources)
	rm -rf dist
	rm -f *.vsix

# ---------------------------------------------------------------------------
# Git hooks
# ---------------------------------------------------------------------------
install-hooks: ## enable the commit-time fast gate
	git config core.hooksPath scripts/hooks

uninstall-hooks: ## disable the commit-time fast gate
	git config --unset core.hooksPath || true

# ---------------------------------------------------------------------------
# Publishing (PRE-RELEASE) — full directions in PUBLISHING.md.
# Pushes to PUBLIC registries under $(PUBLISHER); CI never runs these. Bump the
# version first (`npm version prerelease --no-git-tag-version`, then commit) —
# a registry rejects a duplicate version.
# ---------------------------------------------------------------------------
package-pre-release: ## build a versioned pre-release .vsix locally (no upload)
	npx --yes @vscode/vsce package --pre-release --no-dependencies

publish-login: ## one-time: log in to the VS Code Marketplace publisher (stores a PAT)
	@echo ">> Logging in as publisher '$(PUBLISHER)' — paste a Marketplace 'Manage' PAT (see PUBLISHING.md)."
	npx --yes @vscode/vsce login $(PUBLISHER)

publish-pre-release: ## build + PUBLISH a pre-release to the VS Code Marketplace (needs VSCE_PAT or publish-login)
	@if [ -z "$$VSCE_PAT" ]; then echo ">> VSCE_PAT not set; relying on a prior 'make publish-login'. See PUBLISHING.md if this fails."; fi
	@echo ">> Publishing '$(PUBLISHER).$(shell node -p "require('./package.json').name")' v$(shell node -p "require('./package.json').version") as PRE-RELEASE to the VS Code Marketplace."
	npx --yes @vscode/vsce publish --pre-release --no-dependencies

publish-ovsx: ## build + PUBLISH a pre-release to Open VSX (needs OVSX_PAT)
	@if [ -z "$$OVSX_PAT" ]; then echo "ERROR: set OVSX_PAT (https://open-vsx.org access token). See PUBLISHING.md."; exit 1; fi
	npm run vscode:prepublish
	npx --yes ovsx publish --pre-release -p $$OVSX_PAT

# ---------------------------------------------------------------------------
# Maintainer scratch (hardcoded paths; not part of any gate)
# ---------------------------------------------------------------------------
rawdiff: ## compare .out vs .tif output fixtures (maintainer scratch)
	npx ts-node src/scripts/compare_data.ts /path/to/allatoona/output/bin/H_01_00.out /path/to/allatoona/output/gtiff/H_01_00.tif
	npx ts-node src/scripts/compare_data.ts /path/to/allatoona/output/bin/H_10_00.out /path/to/allatoona/output/gtiff/H_10_00.tif
	npx ts-node src/scripts/compare_data.ts /path/to/allatoona/output/bin/H_240_00.out /path/to/allatoona/output/gtiff/H_240_00.tif
