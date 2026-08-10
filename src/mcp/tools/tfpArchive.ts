// src/mcp/tools/tfpArchive.ts
// Headless glue for the portable `.tfp` archive: fflate zip bytes + fs I/O
// around the pure transforms in services/projectArchive. No vscode, no
// ProjectManager — usable from the MCP server on a laptop or an HPC login node.
import * as fs from 'fs';
import * as path from 'path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  relativizeForExport,
  exportFileReads,
  buildManifest,
  validateManifest,
  absolutizeForImport,
  entryEscapes,
  TriforgeExportManifest,
} from '../../services/projectArchive';

export const MANIFEST_ENTRY = 'triforge.export.json';
export const CONFIG_ENTRY = 'config.json';

const asU8 = (b: Buffer): Uint8Array => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

export interface AssembleResult {
  data: Uint8Array;
  fileCount: number;
  skippedFiles: string[];
  skippedOutputs: string[];
  /** Absolute source paths of input files that live OUTSIDE the project folder and
   *  were read + staged into the archive. Surfaced so the caller can see that the
   *  export read files beyond the project root (the config drives these paths). */
  externalInputs: string[];
}

/** Read a project folder and produce the .tfp bytes. Throws on missing/invalid config. */
export function assembleTfp(projectDir: string, includeOutputs: boolean): AssembleResult {
  const configPath = path.join(projectDir, CONFIG_ENTRY);
  if (!fs.existsSync(configPath)) {
    throw new Error(`no config.json in ${projectDir}`);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const name = config?.settings?.name;
  const id = config?.settings?.id;
  if (typeof name !== 'string' || !name || typeof id !== 'string' || !id) {
    throw new Error('config.json has no settings.name / settings.id');
  }
  const { portableConfig, externalInputs, skippedOutputs } = relativizeForExport(
    config, projectDir, { includeOutputs });

  const entries: Record<string, Uint8Array> = {};
  entries[MANIFEST_ENTRY] = strToU8(
    JSON.stringify(buildManifest({ name, id }, { includesOutputs: includeOutputs }), null, 2));
  entries[CONFIG_ENTRY] = strToU8(JSON.stringify(portableConfig, null, 2));

  const skippedFiles: string[] = [];
  const addFile = (archivePath: string, absPath: string): void => {
    if (archivePath in entries) return;
    try {
      entries[archivePath] = asU8(fs.readFileSync(absPath));
    } catch {
      skippedFiles.push(absPath);
    }
  };
  const addDirRecursive = (absDir: string, archiveDir: string): void => {
    if (!fs.existsSync(absDir)) return;
    for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, e.name);
      const arc = `${archiveDir}/${e.name}`;
      if (e.isDirectory()) addDirRecursive(abs, arc);
      else if (e.isFile()) addFile(arc, abs);
    }
  };

  for (const { archivePath, sourcePath } of exportFileReads(portableConfig, externalInputs, projectDir)) {
    addFile(archivePath, sourcePath);
  }
  addDirRecursive(path.join(projectDir, 'input'), 'input');
  if (includeOutputs) addDirRecursive(path.join(projectDir, 'output'), 'output');

  const data = zipSync(entries, { level: 6 });
  return {
    data,
    fileCount: Object.keys(entries).length,
    skippedFiles,
    skippedOutputs,
    externalInputs: externalInputs.map((e) => e.sourcePath),
  };
}

export interface ExtractResult {
  manifest: TriforgeExportManifest;
  destRoot: string;
  fileCount: number;
}

/** Unzip a .tfp into destRoot: validate, refuse any zip-slip entry, materialize
 *  files, then re-absolutize config.json under destRoot. Throws on bad archive. */
export function extractTfp(archiveBytes: Uint8Array, destRoot: string): ExtractResult {
  const entries = unzipSync(archiveBytes);
  const manifestRaw = entries[MANIFEST_ENTRY];
  if (!manifestRaw) throw new Error(`missing ${MANIFEST_ENTRY} — not a Triforge project archive`);
  if (!entries[CONFIG_ENTRY]) throw new Error(`missing ${CONFIG_ENTRY} in the archive`);
  const manifest = validateManifest(JSON.parse(strFromU8(manifestRaw)));
  const portableConfig = JSON.parse(strFromU8(entries[CONFIG_ENTRY]));
  if (!portableConfig?.settings?.id || !portableConfig?.settings?.name) {
    throw new Error('archive config.json has no settings.id / settings.name');
  }

  // SECURITY (zip-slip): refuse the WHOLE archive if any payload entry escapes.
  for (const entryPath of Object.keys(entries)) {
    if (entryPath === MANIFEST_ENTRY || entryPath === CONFIG_ENTRY) continue;
    if (entryEscapes(entryPath, destRoot)) {
      throw new Error(`archive entry escapes the destination folder: ${entryPath}`);
    }
  }

  fs.mkdirSync(destRoot, { recursive: true });
  for (const [entryPath, data] of Object.entries(entries)) {
    if (entryPath === MANIFEST_ENTRY || entryPath === CONFIG_ENTRY) continue;
    const target = path.join(destRoot, ...entryPath.split('/'));
    if (entryPath.endsWith('/')) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }

  // Atomic config write (temp + rename) so a crash mid-write can't leave a
  // truncated config.json — same discipline as ProjectManager / the VS Code importer.
  const localConfig = absolutizeForImport(portableConfig, destRoot);
  const configTarget = path.join(destRoot, CONFIG_ENTRY);
  const configTmp = `${configTarget}.tmp`;
  fs.writeFileSync(configTmp, JSON.stringify(localConfig, null, 2));
  fs.renameSync(configTmp, configTarget);

  return { manifest, destRoot, fileCount: Object.keys(entries).length };
}
