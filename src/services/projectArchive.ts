// src/services/projectArchive.ts
// Pure path + manifest logic for the portable `.tfp` archive
// (export/import). No vscode/fs imports — unit-tested under plain mocha,
// mirroring the outputNormalize.ts pure/adapter pattern. The vscode adapter
// (src/commands/projectArchive.ts) does all dialog/zip/file I/O.
import * as path from 'path';

/** The subset of node's path module the transforms need — injectable so unit
 *  tests exercise BOTH path.win32 and path.posix (archives are POSIX inside;
 *  configs are native to the machine that wrote them). */
export type PathImpl = Pick<
  typeof path,
  'relative' | 'isAbsolute' | 'join' | 'resolve' | 'sep' | 'basename' | 'extname'
>;

/** Archive schema version. Bump the MAJOR on breaking layout changes;
 *  validateManifest refuses archives with a newer major. */
export const SCHEMA_VERSION = '1.0.0';

/** Config fields (dot-paths into the nested config.json) that hold paths
 *  inside the project folder and must be relativized/re-absolutized. */
export const INSIDE_PROJECT_PATH_FIELDS = {
  /** Input scalars: relativized on export; files outside the project are
   *  staged into the archive's input/ and the field rewritten. */
  inputScalars: [
    'input.dem',
    'input.initialInput',
    'input.qx_infile',
    'input.qy_infile',
    'input.src_loc_file',
    'input.hydrograph_filename',
  ],
  /** Machine-local dirs pinned to their canonical in-project location on both
   *  export (relative) and import (absolute under the destination root). */
  canonicalDirs: {
    'compsetup.build_dir': 'build',
    'execution.run_directory': 'build',
    'output.output_directory': 'output',
  } as Record<string, string>,
  /** Output path arrays: inside entries relativized; outside entries dropped
   *  (and reported) — only INPUTS are staged into the archive. */
  outputArrays: ['output.geotiff', 'output.binary', 'output.ascii'],
};

/**
 * Free-form command/env strings that can embed the EXPORTER's absolute project
 * paths. Unlike the discrete path fields these are opaque strings a user (or
 * the default-run-command builder) fills in — the interactive run command
 * appends the absolute `triton_execution.cfg` path, batch headers may hardcode
 * `--output=/path`, env vars may point at absolute data dirs. We rewrite the
 * project-root PREFIX inside them via a sentinel token so import re-localizes
 * it. Anything NOT under the project root (a machine-local TRITON binary, an
 * unrelated `/scratch` path) is left untouched — the same rule the discrete
 * fields follow.
 */
export const FREEFORM_COMMAND_FIELDS = [
  'execution.run_command',
  'execution.step_launch_command',
  'execution.batch_header',
  'execution.batch_submit_command',
  'execution.env_variables',
];

/**
 * The command fields that INVOKE the TRITON binary. When import resets the
 * machine-local compute target (source/executable mode), an invocation command
 * that hardcodes the now-cleared absolute binary/source path (typically OUTSIDE
 * the project, so project-root tokenization did not touch it) is blanked, so it
 * regenerates from the new local target + cfg instead of pointing at the
 * exporter's binary.
 */
export const COMPUTE_INVOCATION_FIELDS = [
  'execution.run_command',
  'execution.step_launch_command',
];

/**
 * Sentinel standing in for the project root inside archived command/env
 * strings. Deliberately shell-inert (plain `A-Z_`, no `$`/`{}`) so that if a
 * token ever leaked to run time (e.g. a partial import) it could not be
 * expanded by a shell in the batch-script path — it would be an obvious literal
 * wrong path, not silent expansion.
 */
export const PROJECT_ROOT_TOKEN = '__TRITON_PROJECT_ROOT__';

function getAt(obj: any, dotPath: string): any {
  return dotPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setAt(obj: any, dotPath: string, value: any): void {
  const keys = dotPath.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

/** Native relative path → POSIX (`/`) for storage inside the archive. */
function toPosix(relPath: string, p: PathImpl): string {
  return relPath.split(p.sep).join('/');
}

/** Relative path of `target` inside `root`, or undefined when outside. */
function relInside(root: string, target: string, p: PathImpl): string | undefined {
  if (typeof target !== 'string' || target.trim() === '') return undefined;
  const rel = p.relative(root, target);
  if (rel === '' || rel.startsWith('..') || p.isAbsolute(rel)) return undefined;
  return rel;
}

/** Escape a string for literal use inside a RegExp (folder names may contain
 *  `.`, `(`, `+`, `\`, … which are regex metacharacters). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Export side: replace the exporter's project-root prefix inside a free-form
 * command/env string with PROJECT_ROOT_TOKEN, and normalize the token-adjacent
 * path suffix to POSIX `/` so a Windows-exported command imports cleanly on a
 * POSIX machine. Occurrences that are NOT the project root are left verbatim.
 * A no-op on strings that never mention the project root.
 */
function portabilizeCommandString(value: string, projectRoot: string): string {
  if (typeof value !== 'string' || value === '' || !projectRoot) return value;
  // Match the root with either separator convention (a Windows exporter's
  // backslash paths tokenize too), with any trailing separators stripped so the
  // separator that FOLLOWS the root in the command is preserved (a root stored
  // as `<root>/` must not eat the `/` of `<root>/build`).
  const stripTrailing = (r: string) => r.replace(/[\\/]+$/, '');
  const variants = [...new Set([
    stripTrailing(projectRoot),
    stripTrailing(projectRoot.split('\\').join('/')),
    stripTrailing(projectRoot.split('/').join('\\')),
  ])].filter((v) => v !== '');
  let out = value;
  for (const variant of variants) {
    // Tokenize ONLY at a path-segment boundary: the root must be followed by a
    // separator, quote, whitespace, or end-of-string — never mid-segment, so a
    // sibling project like `<root>Ridge` (root `<root>`) is left alone.
    const re = new RegExp(`${escapeRegExp(variant)}(?=[\\\\/"'\\s]|$)`, 'g');
    out = out.replace(re, PROJECT_ROOT_TOKEN);
  }
  // Force the path run that immediately follows the token (up to the next
  // whitespace or quote) to forward slashes, so a `__TOKEN__\build\cfg` from a
  // Windows exporter becomes `__TOKEN__/build/cfg` — OS-neutral in the archive.
  const suffix = new RegExp(`${PROJECT_ROOT_TOKEN}([^\\s"']*)`, 'g');
  return out.replace(suffix, (_m, tail: string) => PROJECT_ROOT_TOKEN + tail.split('\\').join('/'));
}

/**
 * True when `command` references `target` as a whole path argument: `target`
 * is an ABSOLUTE path (not a bare name like `triton`) and appears at a path
 * boundary. Guards the compute-target blank rule against over-matching a short
 * or common target that is merely a substring of an unrelated path (e.g. the
 * bare binary name `triton` inside `triton_execution.cfg`).
 */
function commandReferencesTarget(command: string, target: string): boolean {
  if (typeof command !== 'string' || command === '' || target === '') return false;
  const isAbsolute =
    target.startsWith('/') || target.startsWith('\\') || /^[A-Za-z]:/.test(target);
  if (!isAbsolute) return false;
  const idx = command.indexOf(target);
  if (idx === -1) return false;
  const after = command[idx + target.length];
  return after === undefined || /[\\/"'\s]/.test(after);
}

/**
 * Import side: replace PROJECT_ROOT_TOKEN with the local destination root,
 * forward-slashed so the whole path stays `/`-separated (accepted on every OS;
 * the archived suffix is already `/`-separated). A no-op on strings without the
 * token.
 */
function localizeCommandString(value: string, destRoot: string, pathImpl: PathImpl): string {
  if (typeof value !== 'string' || value === '') return value;
  const destPosix = destRoot.split(pathImpl.sep).join('/');
  return value.split(PROJECT_ROOT_TOKEN).join(destPosix);
}

/** An input file referenced from OUTSIDE the project: the exporter must copy
 *  `sourcePath` into the archive at `archivePath` (the portable config is
 *  already rewritten to `archivePath`). */
export interface ExternalInput {
  field: string;
  sourcePath: string;
  archivePath: string;
}

export interface ExportPlan {
  /** Deep copy of the config with POSIX-relative inside paths; no secrets,
   *  no machine-local project path. */
  portableConfig: any;
  externalInputs: ExternalInput[];
  /** Output entries dropped because they live outside the project root. */
  skippedOutputs: string[];
}

export function relativizeForExport(
  config: any,
  projectRoot: string,
  opts: { includeOutputs: boolean },
  pathImpl: PathImpl = path,
): ExportPlan {
  const portable = JSON.parse(JSON.stringify(config ?? {}));
  const externalInputs: ExternalInput[] = [];
  const skippedOutputs: string[] = [];

  // Never export secrets or the machine-local project location. `input.apiKeys`
  // is the legacy plaintext location (SEC-2) — strip defensively everywhere.
  if (portable.settings) delete portable.settings.path;
  if (portable.input) delete portable.input.apiKeys;
  delete portable.apiKeys;

  // Pass 1 — inside-project inputs claim their archive paths first, so a
  // staged external file can never shadow a real in-project file.
  const taken = new Set<string>();
  const externalFields: Array<{ field: string; value: string }> = [];
  for (const field of INSIDE_PROJECT_PATH_FIELDS.inputScalars) {
    const value = getAt(portable, field);
    if (typeof value !== 'string' || value.trim() === '') continue;
    const rel = relInside(projectRoot, value, pathImpl);
    if (rel !== undefined) {
      const posix = toPosix(rel, pathImpl);
      setAt(portable, field, posix);
      taken.add(posix);
    } else {
      externalFields.push({ field, value });
    }
  }
  // Pass 2 — stage external inputs under input/ with basename dedupe.
  for (const { field, value } of externalFields) {
    const archivePath = claimArchivePath(pathImpl.basename(value), taken, pathImpl);
    externalInputs.push({ field, sourcePath: value, archivePath });
    setAt(portable, field, archivePath);
  }

  // Machine-local dirs → canonical relative locations (import re-absolutizes).
  for (const [field, canonical] of Object.entries(INSIDE_PROJECT_PATH_FIELDS.canonicalDirs)) {
    if (getAt(portable, field) !== undefined) setAt(portable, field, canonical);
  }

  // Output lists: inside entries → POSIX-relative; outside entries dropped +
  // reported. Excluded outputs empty the lists so the archive never references
  // files it does not carry.
  for (const field of INSIDE_PROJECT_PATH_FIELDS.outputArrays) {
    const list = getAt(portable, field);
    if (!Array.isArray(list)) continue;
    if (!opts.includeOutputs) {
      setAt(portable, field, []);
      continue;
    }
    const kept: string[] = [];
    for (const entry of list) {
      const rel = typeof entry === 'string' ? relInside(projectRoot, entry, pathImpl) : undefined;
      if (rel !== undefined) kept.push(toPosix(rel, pathImpl));
      else skippedOutputs.push(String(entry));
    }
    setAt(portable, field, kept);
  }

  // Free-form command/env strings can embed the exporter's absolute project
  // paths (the interactive run command appends the absolute cfg path). Tokenize
  // the project-root prefix so import re-localizes it to the new machine.
  for (const field of FREEFORM_COMMAND_FIELDS) {
    const value = getAt(portable, field);
    if (typeof value === 'string' && value !== '') {
      setAt(portable, field, portabilizeCommandString(value, projectRoot));
    }
  }

  return { portableConfig: portable, externalInputs, skippedOutputs };
}

/** First free `input/<name>` slot: `input/x.asc`, `input/x-2.asc`, … */
function claimArchivePath(baseName: string, taken: Set<string>, p: PathImpl): string {
  const ext = p.extname(baseName);
  const stem = baseName.slice(0, baseName.length - ext.length);
  let candidate = `input/${baseName}`;
  for (let n = 2; taken.has(candidate); n++) {
    candidate = `input/${stem}-${n}${ext}`;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * Re-absolutize a portable config under `destRoot` with the LOCAL separator,
 * and reset the machine-specific compute target: TRITON is built/run per
 * machine, so `source_dir` is always cleared and `triton_target` is cleared
 * UNLESS the mode is docker (image references are portable). The mode and
 * `is_docker_target` are preserved. Secrets never survive.
 *
 * SECURITY: every portable path value is ARCHIVE-CONTROLLED. A crafted
 * archive could carry `../../.ssh/id_rsa` or an absolute path, which
 * `pathImpl.join` would happily normalize to a file OUTSIDE the project —
 * and a later re-export would then classify that file as an external input
 * and stage the pointed-at secret into the new archive (exfiltration).
 * So every value is contained here, at the tested seam: absolute values are
 * rejected outright and joined results must land inside `destRoot`
 * (verified with `relInside`). Escaping input scalars are cleared to '';
 * escaping output entries are dropped.
 */
export function absolutizeForImport(
  portableConfig: any,
  destRoot: string,
  pathImpl: PathImpl = path,
): any {
  const local = JSON.parse(JSON.stringify(portableConfig ?? {}));
  /** Archive value → local absolute path, or undefined when the value is
   *  absolute (either OS convention) or escapes `destRoot` after joining. */
  const toLocalInside = (portableRel: string): string | undefined => {
    if (
      portableRel.startsWith('/') ||
      portableRel.startsWith('\\') ||
      /^[A-Za-z]:/.test(portableRel) ||
      pathImpl.isAbsolute(portableRel)
    ) {
      return undefined;
    }
    const joined = pathImpl.join(destRoot, ...portableRel.split('/'));
    return relInside(destRoot, joined, pathImpl) === undefined ? undefined : joined;
  };

  if (!local.settings) local.settings = {};
  local.settings.path = destRoot;

  for (const field of INSIDE_PROJECT_PATH_FIELDS.inputScalars) {
    const value = getAt(local, field);
    if (typeof value === 'string' && value.trim() !== '') {
      setAt(local, field, toLocalInside(value) ?? '');
    }
  }
  // Canonical dirs are forced unconditionally: an imported project is always
  // laid out as <dest>/build + <dest>/output, like a locally created one.
  // (These are trusted module constants, never archive values.)
  for (const [field, canonical] of Object.entries(INSIDE_PROJECT_PATH_FIELDS.canonicalDirs)) {
    setAt(local, field, pathImpl.join(destRoot, canonical));
  }
  for (const field of INSIDE_PROJECT_PATH_FIELDS.outputArrays) {
    const list = getAt(local, field);
    if (Array.isArray(list)) {
      setAt(local, field, list
        .filter((e: any) => typeof e === 'string' && e.trim() !== '')
        .map((e: string) => toLocalInside(e))
        .filter((e: string | undefined): e is string => e !== undefined));
    }
  }

  // Free-form command/env strings: re-localize the tokenized project root to
  // destRoot (fixes the exporter's absolute cfg path in the run command, etc.).
  for (const field of FREEFORM_COMMAND_FIELDS) {
    const value = getAt(local, field);
    if (typeof value === 'string' && value !== '') {
      setAt(local, field, localizeCommandString(value, destRoot, pathImpl));
    }
  }

  if (!local.compsetup) local.compsetup = {};
  // Capture the exporter's machine-local compute paths BEFORE clearing them, so
  // an invocation command that hardcodes them can be detected below.
  const mode = local.compsetup.executable_target_mode;
  const oldTarget = typeof local.compsetup.triton_target === 'string'
    ? local.compsetup.triton_target.trim() : '';
  const oldSourceDir = typeof local.compsetup.source_dir === 'string'
    ? local.compsetup.source_dir.trim() : '';
  local.compsetup.source_dir = '';
  if (mode !== 'docker') {
    local.compsetup.triton_target = '';
    // The compute target was just cleared. An invocation command that still
    // hardcodes the exporter's absolute binary/source path (typically OUTSIDE
    // the project, so project-root tokenization left it verbatim) would invoke
    // the WRONG machine's binary — blank it so it regenerates from the new
    // local target + cfg when the user reconfigures compute on this machine.
    for (const field of COMPUTE_INVOCATION_FIELDS) {
      const value = getAt(local, field);
      if (typeof value === 'string' && value !== ''
        && (commandReferencesTarget(value, oldTarget)
          || commandReferencesTarget(value, oldSourceDir))) {
        setAt(local, field, '');
      }
    }
  }

  if (local.input) delete local.input.apiKeys;
  delete local.apiKeys;

  return local;
}

/**
 * Merge an incoming (already-absolutized) config into the existing local
 * config of the SAME project: incoming wins field-by-field, EXCEPT the output
 * lists, which become the union (existing first, incoming appended, exact
 * dedupe). An inputs-only archive must never wipe outputs the local machine
 * already has — that would break the compute round-trip.
 */
export function mergeOutputLists(existingConfig: any, incomingConfig: any): any {
  const merged = JSON.parse(JSON.stringify(incomingConfig ?? {}));
  for (const field of INSIDE_PROJECT_PATH_FIELDS.outputArrays) {
    const existing = getAt(existingConfig, field);
    const incoming = getAt(merged, field);
    if (!Array.isArray(existing) && !Array.isArray(incoming)) continue;
    const union = Array.isArray(existing) ? [...existing] : [];
    for (const entry of Array.isArray(incoming) ? incoming : []) {
      if (!union.includes(entry)) union.push(entry);
    }
    setAt(merged, field, union);
  }
  return merged;
}

export interface TriforgeExportManifest {
  schemaVersion: string;
  exportedAt: string;
  projectName: string;
  projectId: string;
  includesOutputs: boolean;
  sourceOS: string;
}

export function buildManifest(
  project: { name: string; id: string },
  opts: { includesOutputs: boolean; sourceOS?: string; exportedAt?: string },
): TriforgeExportManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: opts.exportedAt ?? new Date().toISOString(),
    projectName: project.name,
    projectId: project.id,
    includesOutputs: opts.includesOutputs,
    sourceOS: opts.sourceOS ?? process.platform,
  };
}

/** Throws with a user-facing message when the manifest is malformed or from a
 *  NEWER schema major than this extension supports. Returns it typed on ok. */
export function validateManifest(manifest: any): TriforgeExportManifest {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('not a Triforge project archive (missing triforge.export.json manifest)');
  }
  const { schemaVersion, projectName, projectId } = manifest;
  if (typeof schemaVersion !== 'string' || schemaVersion === ''
    || typeof projectName !== 'string' || projectName === ''
    || typeof projectId !== 'string' || projectId === '') {
    throw new Error('invalid archive manifest: schemaVersion, projectName and projectId are required');
  }
  const major = Number(schemaVersion.split('.')[0]);
  const supportedMajor = Number(SCHEMA_VERSION.split('.')[0]);
  if (!Number.isInteger(major) || major > supportedMajor) {
    throw new Error(
      `archive schema ${schemaVersion} is newer than the supported ${SCHEMA_VERSION} — update the Triforge extension to import it`);
  }
  return manifest as TriforgeExportManifest;
}

/**
 * Zip-slip guard: true when writing `entryPath` under `destRoot` would land
 * outside `destRoot` (or on it). Rejects absolute paths, drive letters, NULs,
 * and any traversal that leaves the root at ANY point, treating `\` and `/`
 * both as separators (zip entries are attacker-controlled strings).
 */
export function entryEscapes(
  entryPath: string,
  destRoot: string,
  pathImpl: PathImpl = path,
): boolean {
  if (typeof entryPath !== 'string' || entryPath === '' || entryPath.includes('\0')) return true;
  const slashed = entryPath.replace(/\\/g, '/');
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) return true;
  let depth = 0;
  for (const seg of slashed.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      depth -= 1;
      if (depth < 0) return true;
    } else {
      depth += 1;
    }
  }
  // Belt and braces: the resolved target must stay strictly inside destRoot.
  const segments = slashed.split('/').filter((s) => s !== '');
  const resolved = pathImpl.resolve(destRoot, ...segments);
  const rel = pathImpl.relative(pathImpl.resolve(destRoot), resolved);
  return rel === '' || rel.startsWith('..') || pathImpl.isAbsolute(rel);
}

/** Every file the portable config references inside the archive (POSIX
 *  relative, deduped) — the exporter reads each from the project and the
 *  importer can expect each to exist. */
export function configReferencedRelPaths(portableConfig: any): string[] {
  const out: string[] = [];
  for (const field of INSIDE_PROJECT_PATH_FIELDS.inputScalars) {
    const v = getAt(portableConfig, field);
    if (typeof v === 'string' && v.trim() !== '') out.push(v);
  }
  for (const field of INSIDE_PROJECT_PATH_FIELDS.outputArrays) {
    const list = getAt(portableConfig, field);
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      if (typeof e === 'string' && e.trim() !== '') out.push(e);
    }
  }
  return [...new Set(out)];
}

/**
 * Ordered read plan for the export zip: which absolute file lands at which
 * archive path. External inputs come FIRST and their archive paths are
 * excluded from the config-referenced pass: `relativizeForExport` has already
 * rewritten their config fields to archive paths (e.g. `input/dem.asc`), so a
 * config-referenced read of that path would resolve INSIDE the project — a
 * spurious "skipped file" when nothing is there, or, worse, a stale
 * same-named local file silently shipped in place of the real external one.
 */
export function exportFileReads(
  portableConfig: any,
  externalInputs: ExternalInput[],
  projectRoot: string,
  pathImpl: PathImpl = path,
): Array<{ archivePath: string; sourcePath: string }> {
  const reads: Array<{ archivePath: string; sourcePath: string }> = [];
  const externalArchivePaths = new Set<string>();
  for (const ext of externalInputs) {
    externalArchivePaths.add(ext.archivePath);
    reads.push({ archivePath: ext.archivePath, sourcePath: ext.sourcePath });
  }
  for (const rel of configReferencedRelPaths(portableConfig)) {
    if (externalArchivePaths.has(rel)) continue; // staged above from its true source
    reads.push({ archivePath: rel, sourcePath: pathImpl.join(projectRoot, ...rel.split('/')) });
  }
  return reads;
}
