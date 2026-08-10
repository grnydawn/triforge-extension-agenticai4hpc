import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * E2E seed-project helper.
 *
 * Most Group D scenarios need a *ready* Triforge project to already exist on disk
 * and be registered with the extension, without re-driving the whole creation
 * UI. This module materializes such a project from the baked golden fixture
 * (`test/e2e/fixtures/golden/exe/`), registers it in a temp workspace's
 * `.triforge/projects.json`, and points the extension's persisted workspace path
 * at that workspace via the SAME file the extension reads at startup
 * (`<globalStorage>/global_settings.json`, written by `GlobalSettingsManager`).
 *
 * After seeding, a suite reloads the VS Code window so the extension's
 * `activate()` -> `ProjectManager.initialize()` -> `_loadProjects()` picks the
 * seeded workspace up. `withTempWorkspace` itself only touches the filesystem so
 * the reload timing stays explicit in the test.
 */

/**
 * Repo-root-relative roots. The E2E harness always runs from the repo root
 * (npm scripts), so we resolve fixtures from `process.cwd()` — matching the
 * existing `test/helpers/gen-golden-baseline.ts` pattern and staying ESM-safe
 * (no `__dirname` / `import.meta` needed regardless of module mode).
 */
const E2E_ROOT = path.resolve(process.cwd(), 'test', 'e2e');
const GOLDEN_EXE_DIR = path.join(E2E_ROOT, 'fixtures', 'golden', 'exe');
const DEM_FIXTURE = path.join(E2E_ROOT, 'fixtures', 'dems', 'HawRidgePark.asc');
const FAKE_TRITON = path.join(E2E_ROOT, 'fakes', 'fake-triton.sh');
const GOLDEN_OUTPUT_DIR = path.join(GOLDEN_EXE_DIR, 'output');

/** Publisher.name from package.json — identifies the extension's globalStorage. */
const EXTENSION_ID = 'triton-team.triforge';

/** Harmless placeholder for the `__TRITON_SRC__` token (no real source needed). */
const TRITON_SRC_PLACEHOLDER = '/nonexistent/triton-src';

/** Context handed to the body of {@link withTempWorkspace}. */
export interface SeededWorkspace {
  /** Absolute path of the temp workspace dir (its `.triforge/` holds projects.json). */
  workspacePath: string;
  /** Absolute path of the seeded project dir (contains config.json + input/build). */
  projectPath: string;
  /** The seeded project's name, as registered in config.json (`HawRidgePark`). */
  projectName: string;
  /** The seeded project's id (the golden fixture's stable UUID). */
  projectId: string;
}

/**
 * Absolute path to the extension's persisted global settings file, located in
 * the ExTester user-data dir's globalStorage. ExTester launches VS Code with
 * `--user-data-dir=<storage>/settings`, so `globalStorageUri` for the extension
 * resolves to `<storage>/settings/User/globalStorage/<publisher>.<name>`.
 *
 * `<storage>` defaults to `os.tmpdir()/test-resources` unless `TEST_RESOURCES`
 * overrides it (matching vscode-extension-tester's DEFAULT_STORAGE_FOLDER).
 */
export function globalSettingsFile(): string {
  const storage = process.env.TEST_RESOURCES
    ? process.env.TEST_RESOURCES
    : path.join(os.tmpdir(), 'test-resources');
  return path.join(
    storage,
    'settings',
    'User',
    'globalStorage',
    EXTENSION_ID,
    'global_settings.json',
  );
}

/** Recursively copy a directory tree (files + dirs), creating dest as needed. */
function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

/** Replace every `__PROJECT__` / `__TRITON_SRC__` token in a string. */
function detokenize(text: string, projectPath: string): string {
  return text
    .split('__PROJECT__')
    .join(projectPath)
    .split('__TRITON_SRC__')
    .join(TRITON_SRC_PLACEHOLDER);
}

/** Options for {@link materializeProject} / {@link seedProjectInto}. */
export interface SeedProjectOptions {
  /**
   * Override the project's `settings.name` in the materialized config.json.
   * Used by PRJ-2 (HTML/script-payload name) and multi-project scenarios that
   * need distinct names. Defaults to the golden fixture's name (`HawRidgePark`).
   */
  name?: string;
  /** Override the project's `settings.id`. Defaults to a fresh UUID per seed. */
  id?: string;
  /**
   * Override the materialized config's `execution.run_command` verbatim instead
   * of wiring it to the fake binary. Used by PRJ-4 to plant a sentinel command
   * (e.g. `touch <marker>`) and prove opening the project does NOT execute it.
   */
  runCommand?: string;
  /**
   * Mutate the fully-built config object just before it is written, for
   * scenarios that need to deviate from the golden shape (e.g. corrupt it).
   */
  mutateConfig?: (config: any) => void;
  /**
   * Make the project's computation target VALIDATE in *executable* mode so the
   * Execution Setup panel opens (`ExecutionSetupEditor.createOrShow` requires a
   * resolvable target: executable mode needs `triton_target` to exist on disk).
   *
   * When `true`, {@link materializeProject} writes a dummy executable file at
   * `<projectPath>/triton.exe`, then sets `compsetup.executable_target_mode =
   * 'executable'` and `compsetup.triton_target` to that file. This is the
   * easiest validation seam for the execution (EXE-*) scenarios — it avoids the
   * seam-less source build path while still exercising the real open-gate.
   */
  executableTarget?: boolean;
}

/**
 * Materialize a ready project from the golden fixture into `projectPath`:
 *  - config.json with tokens substituted and `run_command` rewritten to invoke
 *    the deterministic fake-triton.sh (with GOLDEN_OUTPUT_DIR exported) so run
 *    scenarios replay the golden output instead of a real binary,
 *  - input/  (golden input files + the DEM fixture),
 *  - build/output/  (golden depth/flux frames, for run scenarios).
 *
 * `opts` lets callers override the name/id/run_command or mutate the final
 * config (see {@link SeedProjectOptions}); by default the golden values are kept
 * except for a fresh project id, so multiple seeds register as distinct projects.
 */
function materializeProject(
  projectPath: string,
  opts: SeedProjectOptions = {},
): {
  projectName: string;
  projectId: string;
} {
  fs.mkdirSync(projectPath, { recursive: true });

  // config.json — detokenize, then wire the run command to the fake binary so
  // Group D run scenarios replay golden output deterministically.
  const rawConfig = fs.readFileSync(path.join(GOLDEN_EXE_DIR, 'config.json'), 'utf8');
  const config = JSON.parse(detokenize(rawConfig, projectPath));
  config.settings = config.settings || {};
  if (opts.name !== undefined) config.settings.name = opts.name;
  // Fresh id per seed unless pinned, so two seeds are distinct projects.
  config.settings.id = opts.id ?? randomId();
  config.execution = config.execution || {};
  if (opts.runCommand !== undefined) {
    // Verbatim command (e.g. a sentinel) — do NOT wire env to the fake binary.
    config.execution.run_command = opts.runCommand;
  } else {
    // Invoke the fake binary; it copies $GOLDEN_OUTPUT_DIR into the run dir (cwd).
    config.execution.run_command = `bash ${FAKE_TRITON}`;
    const existingEnv: string = config.execution.env_variables || '';
    config.execution.env_variables = existingEnv
      ? `${existingEnv}\nGOLDEN_OUTPUT_DIR=${GOLDEN_OUTPUT_DIR}`
      : `GOLDEN_OUTPUT_DIR=${GOLDEN_OUTPUT_DIR}`;
  }
  // Make the computation target validate in *executable* mode (so Execution
  // Setup opens) by writing a dummy executable and pointing triton_target at it.
  if (opts.executableTarget) {
    config.compsetup = config.compsetup || {};
    const exePath = path.join(projectPath, 'triton.exe');
    fs.writeFileSync(exePath, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    config.compsetup.executable_target_mode = 'executable';
    config.compsetup.triton_target = exePath;
  }
  if (opts.mutateConfig) opts.mutateConfig(config);
  fs.writeFileSync(
    path.join(projectPath, 'config.json'),
    JSON.stringify(config, null, 2),
  );

  // input/ — golden input files, then the DEM fixture alongside them.
  const inputDir = path.join(projectPath, 'input');
  copyDir(path.join(GOLDEN_EXE_DIR, 'input'), inputDir);
  fs.copyFileSync(DEM_FIXTURE, path.join(inputDir, path.basename(DEM_FIXTURE)));

  // build/output/ — golden output frames, for run scenarios.
  copyDir(
    path.join(GOLDEN_EXE_DIR, 'output'),
    path.join(projectPath, 'build', 'output'),
  );

  return {
    projectName: config.settings.name,
    projectId: config.settings.id,
  };
}

/** A short, file-name-safe random id (no `crypto.randomUUID` dependency needed). */
function randomId(): string {
  return `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Materialize a golden project into `<workspacePath>/<dirName>` and return its
 * on-disk facts. Building block for multi-project suites (PRJ-5/6/9): they seed
 * several of these, register the dirs, then reload the window once.
 */
export function seedProjectInto(
  workspacePath: string,
  dirName: string,
  opts: SeedProjectOptions = {},
): SeededProject {
  const projectPath = path.join(workspacePath, dirName);
  const { projectName, projectId } = materializeProject(projectPath, opts);
  return { projectPath, projectName, projectId };
}

/** Facts about a single seeded project on disk. */
export interface SeededProject {
  /** Absolute path of the seeded project dir (contains config.json + input/build). */
  projectPath: string;
  /** The seeded project's name, as written into config.json `settings.name`. */
  projectName: string;
  /** The seeded project's id (config.json `settings.id`). */
  projectId: string;
}

/**
 * Write `<workspace>/.triforge/projects.json` registering one or more project
 * dirs (in order), matching the exact shape the extension reads at startup.
 */
export function writeProjectsRegistry(
  workspacePath: string,
  projectPaths: string | string[],
): void {
  const triforgeDir = path.join(workspacePath, '.triforge');
  fs.mkdirSync(triforgeDir, { recursive: true });
  const paths = Array.isArray(projectPaths) ? projectPaths : [projectPaths];
  const data = { triforge: { projectpaths: paths } };
  fs.writeFileSync(
    path.join(triforgeDir, 'projects.json'),
    JSON.stringify(data, null, 2),
  );
}

/**
 * Point the extension's persisted workspace path at `workspacePath` by writing
 * the very `global_settings.json` that `GlobalSettingsManager` reads at startup.
 * Returns the previous file contents (or `undefined`) so the caller can restore.
 */
export function setExtensionWorkspacePath(workspacePath: string): string | undefined {
  const file = globalSettingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
  const settings = {
    userName: 'E2E Tester',
    email: 'e2e@triforge.test',
    workspacePath,
    // E2E launches an empty VS Code window. Leaving AI project-focus at its
    // 'prompt' default would pop the consent modal on the first project open
    // (and 'enabled' would seat the control root → reload), either of which
    // breaks the driven session. Disable it by default; suites that test the
    // catalog write it explicitly (writes still happen when disabled).
    aiProjectFocus: 'disabled',
  };
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  return previous;
}

/**
 * Merge `partial` into the extension's persisted `global_settings.json` (the file
 * GlobalSettingsManager reads at startup). Used by the catalog E2E to force
 * `aiProjectFocus: 'disabled'` so no control-root seat/reload fires mid-test.
 */
export function setExtensionGlobalSettings(partial: Record<string, unknown>): void {
  const file = globalSettingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, JSON.stringify({ ...current, ...partial }, null, 2));
}

/** Restore (or remove) the global settings file to its pre-seed state. */
export function restoreExtensionWorkspacePath(previous: string | undefined): void {
  const file = globalSettingsFile();
  try {
    if (previous === undefined) {
      if (fs.existsSync(file)) fs.rmSync(file);
    } else {
      fs.writeFileSync(file, previous);
    }
  } catch {
    /* best-effort cleanup */
  }
}

/**
 * Seed a ready golden project into a fresh temp workspace, point the extension
 * at it, run `fn`, then clean everything up (even if `fn` throws).
 *
 * The body should reload the VS Code window before asserting, so the extension
 * reloads projects from the seeded workspace (see module doc).
 */
export async function withTempWorkspace(
  fn: (ctx: SeededWorkspace) => Promise<void>,
  opts: SeedProjectOptions = {},
): Promise<void> {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'triforge-e2e-ws-'));
  const projectPath = path.join(workspacePath, 'HawRidgePark');

  const { projectName, projectId } = materializeProject(projectPath, opts);
  writeProjectsRegistry(workspacePath, projectPath);
  const previousSettings = setExtensionWorkspacePath(workspacePath);

  try {
    await fn({ workspacePath, projectPath, projectName, projectId });
  } finally {
    restoreExtensionWorkspacePath(previousSettings);
    try {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

/** Context handed to the body of {@link withTempMultiWorkspace}. */
export interface MultiSeededWorkspace {
  /** Absolute path of the temp workspace dir (its `.triforge` holds projects.json). */
  workspacePath: string;
  /**
   * Materialize a golden project at `<workspace>/<dirName>` and return its
   * on-disk facts. Call this for each project BEFORE {@link register}; it only
   * touches the filesystem (no registry / settings side effects).
   */
  seed: (dirName: string, opts?: SeedProjectOptions) => SeededProject;
  /**
   * Write `<workspace>/.triforge/projects.json` with the given absolute project
   * dirs (in order) and point the extension's persisted workspace path here.
   * The body should call this, then reload the window, before asserting.
   */
  register: (projectPaths: string[]) => void;
}

/**
 * Like {@link withTempWorkspace} but lets the body seed an arbitrary number of
 * projects (with custom names / configs) and control registry + reload timing
 * itself — needed by the switch / corrupt-config / path-validation scenarios.
 *
 * The extension's persisted workspace path is set to this temp workspace as soon
 * as the body calls `register`, and restored on teardown. The temp workspace is
 * always removed afterwards (even if `fn` throws).
 */
export async function withTempMultiWorkspace(
  fn: (ctx: MultiSeededWorkspace) => Promise<void>,
): Promise<void> {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'triforge-e2e-mws-'));
  let previousSettings: string | undefined;
  let settingsTouched = false;

  const ctx: MultiSeededWorkspace = {
    workspacePath,
    seed: (dirName, opts) => seedProjectInto(workspacePath, dirName, opts),
    register: (projectPaths) => {
      writeProjectsRegistry(workspacePath, projectPaths);
      // Capture the pre-seed settings exactly once, on first register.
      if (!settingsTouched) {
        previousSettings = setExtensionWorkspacePath(workspacePath);
        settingsTouched = true;
      } else {
        setExtensionWorkspacePath(workspacePath);
      }
    },
  };

  try {
    await fn(ctx);
  } finally {
    if (settingsTouched) restoreExtensionWorkspacePath(previousSettings);
    try {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}
