import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { expect } from 'chai';

// Repo root. Mocha (per .mocharc.json) is invoked from the repo root, so cwd is
// the project root; `mapSelectorBundle.test.ts` relies on the same invariant.
const ROOT = process.cwd();

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

/**
 * PKG-CI-3 (CODE_REVIEW PKG-3) — the published VSIX must NOT ship developer-only
 * files. PKG-3 catalogued the leak: `.claude/settings.local.json`,
 * `debug_inputgen.js`, and a top-level `Makefile` shipped because `.vscodeignore`
 * excluded `src/**`/`*.ts` but none of those. T0 added the exclusions; the CI
 * `package` job greps `vsce ls` for the same leak class and fails the build on a
 * hit. This mirrors that gate.
 *
 * The extension vendors the upstream TRITON simulator as a git submodule under
 * `externals/triton/` (~2k C++/CMake/doc files) purely for golden-run reference
 * and fixture harvesting — it is NEVER runtime content (the extension shells out
 * to the user's own triton binary). It must therefore be excluded from the VSIX
 * via `.vscodeignore` `externals/**`; this gate asserts it does not leak (a missing
 * exclusion shipped all 1996 submodule files in the VSIX and turned the `package`
 * gate red). The dev-only D4.5 tooling artifacts (`TESTING.md`, `scripts/`) are
 * likewise excluded and guarded here.
 */
describe('PKG-CI-3 — VSIX excludes developer-only files', function () {
  // `vsce ls` shells out (and may resolve @vscode/vsce on first run); give it room.
  this.timeout(120000);

  // The dev-file leak classes PKG-3 / the CI package job care about. Mirrors the
  // CI grep `\.claude/|debug_inputgen|^src/|\.ts$|docs/|test/|CODE_REVIEW` plus the
  // top-level `Makefile` PKG-3 names explicitly.
  const FORBIDDEN: Array<{ label: string; test: (p: string) => boolean }> = [
    { label: '.claude/ internal config', test: (p) => p.startsWith('.claude/') },
    { label: 'debug_inputgen.* scratch', test: (p) => /(^|\/)debug_inputgen\./.test(p) },
    { label: 'top-level src/ (TypeScript sources)', test: (p) => p.startsWith('src/') },
    { label: '*.ts source files', test: (p) => p.endsWith('.ts') },
    { label: 'docs/ developer docs', test: (p) => p.startsWith('docs/') },
    { label: 'test/ test suites', test: (p) => p.startsWith('test/') },
    { label: 'CODE_REVIEW review doc', test: (p) => p.includes('CODE_REVIEW') },
    { label: 'top-level Makefile', test: (p) => p === 'Makefile' },
    { label: 'externals/ vendored submodule (dev-only)', test: (p) => p.startsWith('externals/') },
    { label: 'media/triforge.png raw 1.6MB source', test: (p) => p === 'media/triforge.png' },
    { label: 'TESTING.md dev doc', test: (p) => p === 'TESTING.md' },
    { label: 'PUBLISHING.md dev doc', test: (p) => p === 'PUBLISHING.md' },
    { label: 'scripts/ dev tooling', test: (p) => p.startsWith('scripts/') },
    { label: '.venv-docs/ docs build virtualenv (~140MB)', test: (p) => p.startsWith('.venv-docs/') },
    { label: '.venv/ virtualenv', test: (p) => p.startsWith('.venv/') },
    { label: '.gstack/ skill workspace', test: (p) => p.startsWith('.gstack/') },
    { label: 'dist/mcp/ MCP server (dev tooling, not the extension)', test: (p) => p.startsWith('dist/mcp/') },
    { label: '*.jsonl transcripts (e.g. MCP call transcript)', test: (p) => p.endsWith('.jsonl') },
    { label: 'tsconfig.mcp.json MCP build config', test: (p) => p === 'tsconfig.mcp.json' },
    { label: '.readthedocs.yaml docs CI config', test: (p) => p === '.readthedocs.yaml' },
  ];

  // Required `.vscodeignore` patterns the fallback asserts when `vsce ls` cannot run.
  const REQUIRED_IGNORE_PATTERNS = [
    '.claude/**',
    'debug_inputgen.*',
    'Makefile',
    'src/**',
    '*.ts',
    'docs/**',
    'test/**',
    'CODE_REVIEW.md',
    'externals/**',
    'media/triforge.png',
    '.venv-docs/**',
    'dist/mcp/**',
    '*.jsonl',
    'tsconfig.mcp.json',
    '.readthedocs.yaml',
    '.gstack/**',
  ];

  function tryVsceLs(): string[] | undefined {
    try {
      // `--no-dependencies` keeps it fast (no npm production-dep walk). Run from the
      // repo root so vsce reads this project's package.json / .vscodeignore.
      const out = execFileSync(
        'npx',
        ['--yes', '@vscode/vsce', 'ls', '--no-dependencies'],
        { cwd: ROOT, encoding: 'utf-8', timeout: 100000, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      return out
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    } catch {
      // vsce unavailable / offline / too slow in this runner — caller falls back.
      return undefined;
    }
  }

  it('ships no developer-only files (real `vsce ls` signal, with .vscodeignore fallback)', () => {
    const listing = tryVsceLs();
    const bundleBuilt = fs.existsSync(path.join(ROOT, 'dist', 'extension.js'));

    if (listing && listing.length > 0) {
      // PREFERRED PATH: assert against the real package contents — the whole
      // listing, including the externals/ submodule which must not ship.
      for (const rule of FORBIDDEN) {
        const leaked = listing.filter((p) => rule.test(p));
        expect(
          leaked,
          `VSIX must not ship ${rule.label}; leaked: ${JSON.stringify(leaked)}`,
        ).to.deep.equal([]);
      }
      // Sanity guard against a vacuous listing — but only when the runtime bundle
      // has actually been built. The CI `unit` job runs without a webpack build,
      // so `vsce ls` legitimately omits dist/extension.js; in that case fall
      // through to the .vscodeignore assertion below instead of failing spuriously
      // (the forbidden-leak checks above have already run against the real listing).
      if (bundleBuilt) {
        expect(
          listing.some((p) => p === 'dist/extension.js'),
          'expected the runtime bundle dist/extension.js to be present in `vsce ls`',
        ).to.be.true;
        return;
      }
    }

    // FALLBACK PATH: `vsce ls` unavailable — assert the exclusion patterns are
    // declared in .vscodeignore (the source of the fix for PKG-3).
    const ignoreFile = path.join(ROOT, '.vscodeignore');
    expect(fs.existsSync(ignoreFile), '.vscodeignore must exist').to.be.true;
    const ignoreLines = fs
      .readFileSync(ignoreFile, 'utf-8')
      .split('\n')
      .map((l) => l.trim());
    for (const pattern of REQUIRED_IGNORE_PATTERNS) {
      expect(
        ignoreLines,
        `.vscodeignore must exclude "${pattern}" (PKG-3 dev-file leak)`,
      ).to.include(pattern);
    }
  });
});

/**
 * TOOL-4 (CODE_REVIEW TOOL-4) — the production webpack build must type-check.
 * `ts-loader` runs with `transpileOnly: true` (for speed) and therefore never
 * type-checks, so type errors slipped silently into `dist/` (the review surfaced
 * two real ones). The prescribed fix wires `fork-ts-checker-webpack-plugin` into
 * the EXTENSION webpack config, which runs `tsc --noEmit` in a side process and
 * fails the build on any type error. This born-green source-property guard asserts
 * (a) `webpack.config.js` wires `ForkTsCheckerWebpackPlugin`, and (b) `package.json`
 * lists `fork-ts-checker-webpack-plugin` in `devDependencies`.
 */
describe('TOOL-4 — webpack build type-checks via fork-ts-checker', () => {
  it('webpack.config.js requires and instantiates ForkTsCheckerWebpackPlugin', () => {
    const cfg = fs.readFileSync(path.join(ROOT, 'webpack.config.js'), 'utf-8');
    expect(
      /require\(\s*['"]fork-ts-checker-webpack-plugin['"]\s*\)/.test(cfg),
      'webpack.config.js must require fork-ts-checker-webpack-plugin',
    ).to.be.true;
    expect(
      /new\s+ForkTsCheckerWebpackPlugin\s*\(/.test(cfg),
      'webpack.config.js must add `new ForkTsCheckerWebpackPlugin()` to plugins',
    ).to.be.true;
  });

  it('package.json lists fork-ts-checker-webpack-plugin in devDependencies', () => {
    const pkg = readJson(path.join(ROOT, 'package.json')) as {
      devDependencies?: Record<string, string>;
    };
    expect(
      pkg.devDependencies && pkg.devDependencies['fork-ts-checker-webpack-plugin'],
      'fork-ts-checker-webpack-plugin must be a devDependency',
    ).to.be.a('string').and.not.be.empty;
  });
});

/**
 * PKG-CI-4 (CODE_REVIEW PKG-1 / PKG-4 / PKG-5) — manifest hygiene.
 * PKG-1: missing `publisher` blocks Marketplace publish. PKG-4: missing SPDX
 * `license`. PKG-5: duplicate command ids and commands referenced in menus but
 * never declared. T0 fixed all of these; this guards them green.
 */
describe('PKG-CI-4 — package.json manifest hygiene', () => {
  let pkg: Record<string, any>;

  before(() => {
    pkg = readJson(path.join(ROOT, 'package.json'));
  });

  it('declares a publisher (PKG-1) and an SPDX license (PKG-4)', () => {
    expect(pkg.publisher, 'publisher must be set (PKG-1)').to.equal('triton-team');
    expect(pkg.license, 'license must be set (PKG-4)').to.equal('MIT');
  });

  it('references an icon file that exists on disk', () => {
    expect(pkg.icon, 'package.json "icon" must be set').to.be.a('string').and.not.be.empty;
    expect(
      fs.existsSync(path.join(ROOT, pkg.icon)),
      `package.json "icon" (${pkg.icon}) must exist on disk`,
    ).to.be.true;
  });

  it('declares main entrypoint and activationEvents', () => {
    expect(pkg.main, 'main entrypoint must be set').to.be.a('string').and.not.be.empty;
    expect(pkg.activationEvents, 'activationEvents must be present').to.be.an('array').that.is
      .not.empty;
  });

  it('has no duplicate command ids in contributes.commands (PKG-5)', () => {
    const commands: Array<{ command: string }> = pkg.contributes.commands;
    expect(commands, 'contributes.commands must be an array').to.be.an('array').that.is.not
      .empty;
    const ids = commands.map((c) => c.command);
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const id of ids) {
      if (seen.has(id)) {
        dupes.push(id);
      }
      seen.add(id);
    }
    expect(dupes, `duplicate command ids: ${JSON.stringify(dupes)}`).to.deep.equal([]);
  });

  it('declares every command referenced in contributes.menus (PKG-5)', () => {
    const declared = new Set<string>(
      (pkg.contributes.commands as Array<{ command: string }>).map((c) => c.command),
    );

    const menus: Record<string, Array<{ command?: string }>> = pkg.contributes.menus;
    const undeclared: string[] = [];
    for (const [menuId, entries] of Object.entries(menus)) {
      for (const entry of entries) {
        // Some menu entries are submenu refs without a `command`; skip those.
        if (entry.command && !declared.has(entry.command)) {
          undeclared.push(`${menuId} -> ${entry.command}`);
        }
      }
    }
    expect(
      undeclared,
      `menu entries reference undeclared commands: ${JSON.stringify(undeclared)}`,
    ).to.deep.equal([]);
  });
});
