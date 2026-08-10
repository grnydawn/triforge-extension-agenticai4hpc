// src/commands/projectArchive.ts
// vscode adapter for the portable `.tfp` archive: dialogs, fflate zip
// I/O and filesystem work. All path/manifest/merge decisions live in the pure
// src/services/projectArchive.ts (unit-tested); the cfg renderer in
// src/services/tritonConfig.ts is shared with the run path.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { ProjectManager, TriforgeProject } from '../state/ProjectManager';
import {
    absolutizeForImport,
    buildManifest,
    entryEscapes,
    exportFileReads,
    mergeOutputLists,
    relativizeForExport,
    validateManifest,
} from '../services/projectArchive';
import { renderTritonExecutionCfg } from '../services/tritonConfig';
import { getTriforgeWorkspaceRoot } from './project';
import { Logger } from '../utils/Logger';

const ARCHIVE_FILTER = { 'Triforge Project Archive': ['tfp'] };
const MANIFEST_ENTRY = 'triforge.export.json';
const CONFIG_ENTRY = 'config.json';

/** Buffer → plain Uint8Array view (no copy). TS 5.9's generic Uint8Array lib
 *  types reject Buffer where fflate expects a Uint8Array. */
function asU8(buf: Buffer): Uint8Array {
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function exportProjectCommand(arg: any): Promise<void> {
    // Tree invocations pass a ProjectNode ({ project }), same unwrap as removeProject.
    const project: TriforgeProject | undefined = arg?.project ?? arg;
    if (!project?.path || !project?.id || !project?.name) {
        vscode.window.showErrorMessage('Export Project: invalid project selection.');
        return;
    }
    const configFile = path.join(project.path, 'config.json');
    if (!fs.existsSync(configFile)) {
        vscode.window.showErrorMessage(`Export Project: no config.json found in ${project.path}.`);
        return;
    }

    // 1. What should the archive include? (inputs + config always ship)
    const choice = await vscode.window.showQuickPick(
        [
            { label: 'Inputs only', description: 'Project configuration + input data', includeOutputs: false },
            { label: 'Inputs + outputs', description: 'Also include computed simulation outputs', includeOutputs: true },
        ],
        { title: `Export Project '${project.name}'`, placeHolder: 'What should the archive include?' },
    );
    if (!choice) return;

    // 2. Portable config (+ input files referenced from outside the project).
    let configJson: any;
    try {
        configJson = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    } catch (err: any) {
        vscode.window.showErrorMessage(`Export Project: cannot read config.json (${err.message}).`);
        return;
    }
    const { portableConfig, externalInputs, skippedOutputs } =
        relativizeForExport(configJson, project.path, { includeOutputs: choice.includeOutputs });

    // 3. Assemble the zip fully in memory. Per-file read failures are isolated:
    //    the file is skipped and reported, the export continues.
    const entries: Record<string, Uint8Array> = {};
    const skippedFiles: string[] = [];
    entries[MANIFEST_ENTRY] = strToU8(JSON.stringify(
        buildManifest(project, { includesOutputs: choice.includeOutputs }), null, 2));
    entries[CONFIG_ENTRY] = strToU8(JSON.stringify(portableConfig, null, 2));

    const addFile = (archivePath: string, absPath: string): void => {
        if (archivePath in entries) return;
        try {
            entries[archivePath] = asU8(fs.readFileSync(absPath));
        } catch {
            skippedFiles.push(absPath);
            Logger.warn(`[exportProject] Skipped unreadable file: ${absPath}`);
        }
    };
    const addDirRecursive = (absDir: string, archiveDir: string): void => {
        if (!fs.existsSync(absDir)) return;
        for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
            const abs = path.join(absDir, entry.name);
            const arc = `${archiveDir}/${entry.name}`;
            if (entry.isDirectory()) addDirRecursive(abs, arc);
            else if (entry.isFile()) addFile(arc, abs);
        }
    };

    // Every file the config references: staged external inputs FIRST (their
    // config fields already point at archive paths, so reading those paths
    // from the project would skip-report or ship stale local bytes — see
    // exportFileReads), then in-project referenced files (inputs anywhere in
    // the project AND outputs under e.g. build/output)…
    for (const { archivePath, sourcePath } of exportFileReads(portableConfig, externalInputs, project.path)) {
        addFile(archivePath, sourcePath);
    }
    // …everything in input/ (present-but-unreferenced input files travel too)…
    addDirRecursive(path.join(project.path, 'input'), 'input');
    // …and the canonical output/ dir when outputs are included.
    if (choice.includeOutputs) {
        addDirRecursive(path.join(project.path, 'output'), 'output');
    }

    // 4. Where to save.
    const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(os.homedir(), `${project.name}.tfp`)),
        filters: ARCHIVE_FILTER,
        title: `Export Project '${project.name}'`,
    });
    if (!saveUri) return;

    try {
        fs.writeFileSync(saveUri.fsPath, zipSync(entries, { level: 6 }));
    } catch (err: any) {
        vscode.window.showErrorMessage(`Export Project failed: ${err.message}`);
        return;
    }

    // 5. Report (skips are non-fatal but never silent).
    if (skippedOutputs.length) {
        Logger.warn(`[exportProject] Output entries outside the project were not exported: ${skippedOutputs.join(', ')}`);
    }
    const skipped = skippedFiles.length + skippedOutputs.length;
    const suffix = skipped > 0
        ? ` (${skipped} file(s) skipped — unreadable or outside the project; see the Triforge log)`
        : '';
    vscode.window.showInformationMessage(`Exported '${project.name}' to ${saveUri.fsPath}${suffix}`);
}

async function importProjectCommand(extensionUri: vscode.Uri): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: ARCHIVE_FILTER,
        openLabel: 'Import',
        title: 'Import Triforge Project',
    });
    if (!picked?.[0]) return;

    // 1. Unpack in memory; validate manifest + config BEFORE touching disk.
    let entries: Record<string, Uint8Array>;
    let manifest: ReturnType<typeof validateManifest>;
    let portableConfig: any;
    try {
        entries = unzipSync(asU8(fs.readFileSync(picked[0].fsPath)));
        const manifestRaw = entries[MANIFEST_ENTRY];
        if (!manifestRaw) throw new Error('missing triforge.export.json — not a Triforge project archive');
        if (!entries[CONFIG_ENTRY]) throw new Error('missing config.json in the archive');
        manifest = validateManifest(JSON.parse(strFromU8(manifestRaw)));
        portableConfig = JSON.parse(strFromU8(entries[CONFIG_ENTRY]));
        if (!portableConfig?.settings?.id || !portableConfig?.settings?.name) {
            throw new Error('archive config.json has no settings.id / settings.name');
        }
    } catch (err: any) {
        vscode.window.showErrorMessage(`Import Project failed: ${err.message}`);
        return;
    }

    // 2. Destination: merge into the same-id project, else a fresh folder
    //    under the Triforge workspace root (deduped), like a locally created one.
    const existing = ProjectManager.instance.getProjects()
        .find(p => p.id === portableConfig.settings.id);
    let destRoot: string;
    if (existing) {
        const confirm = await vscode.window.showWarningMessage(
            `Project '${existing.name}' already exists (same project id).\n\n` +
            `Merge the archive into ${existing.path}? Files are updated from the archive, ` +
            `output lists are combined, and local TRITON build settings are reset.`,
            { modal: true },
            'Merge',
        );
        if (confirm !== 'Merge') return;
        destRoot = existing.path;
    } else {
        const root = getTriforgeWorkspaceRoot();
        if (!root) {
            vscode.window.showErrorMessage('Import Project: no Triforge workspace is configured (set it in Triforge Global Settings).');
            return;
        }
        destRoot = claimProjectFolder(root, manifest.projectName);
    }

    // 3. SECURITY (zip-slip): refuse the WHOLE archive if any entry escapes.
    for (const entryPath of Object.keys(entries)) {
        if (entryPath === MANIFEST_ENTRY || entryPath === CONFIG_ENTRY) continue;
        if (entryEscapes(entryPath, destRoot)) {
            vscode.window.showErrorMessage(
                `Import Project refused: archive entry escapes the destination folder (${entryPath}).`);
            return;
        }
    }

    try {
        // 4. Materialize the payload files (manifest/config handled separately).
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

        // 5. Local config: re-absolutize under destRoot; on merge, union the
        //    output lists so an inputs-only archive can't wipe local outputs.
        let localConfig = absolutizeForImport(portableConfig, destRoot);
        if (existing) {
            const existingConfigFile = path.join(destRoot, 'config.json');
            if (fs.existsSync(existingConfigFile)) {
                try {
                    localConfig = mergeOutputLists(
                        JSON.parse(fs.readFileSync(existingConfigFile, 'utf8')), localConfig);
                } catch {
                    Logger.warn('[importProject] Existing config.json unreadable — importing archive config as-is.');
                }
            }
        }
        writeFileAtomic(path.join(destRoot, 'config.json'), JSON.stringify(localConfig, null, 2));

        // 6. Register through the startup loader (single source of truth).
        const loaded = ProjectManager.instance.registerImportedProject(destRoot);
        if (!loaded) {
            vscode.window.showErrorMessage('Import Project: the imported config.json failed validation.');
            return;
        }

        // 7. TRITON-ready build folder: build/triton_execution.cfg from the
        //    SAME renderer the run path uses, pointing at the LOCAL inputs.
        const buildDir = path.join(destRoot, 'build');
        fs.mkdirSync(buildDir, { recursive: true });
        const templatePath = path.join(extensionUri.fsPath, 'resources', 'triton_execution.cfg.template');
        fs.writeFileSync(
            path.join(buildDir, 'triton_execution.cfg'),
            renderTritonExecutionCfg(loaded, fs.readFileSync(templatePath, 'utf8')));

        // 8. Behave like a locally created project: become active.
        ProjectManager.instance.setActiveProject(loaded);
        vscode.window.showInformationMessage(existing
            ? `Merged archive into project '${loaded.name}'.`
            : `Imported project '${loaded.name}' to ${destRoot}.`);
        Logger.info(`[importProject] ${existing ? 'Merged' : 'Imported'} '${loaded.name}' at ${destRoot}`);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Import Project failed: ${err.message}`);
        Logger.error('[importProject] Failed', err);
    }
}

/** First free `<root>/<name>` folder: `<name>`, `<name>-2`, … (fs-safe name). */
function claimProjectFolder(root: string, name: string): string {
    const safe = name.replace(/[\\/:*?"<>|\0]/g, '_').trim() || 'imported-project';
    let candidate = path.join(root, safe);
    for (let n = 2; fs.existsSync(candidate); n++) {
        candidate = path.join(root, `${safe}-${n}`);
    }
    return candidate;
}

// Same atomic-write discipline as ProjectManager (BUG-10): temp + rename so a
// crash can never leave a truncated config.json.
function writeFileAtomic(filePath: string, contents: string): void {
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, contents);
    fs.renameSync(tmpPath, filePath);
}

export function registerProjectArchiveCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('triforge.exportProject', (arg: any) => exportProjectCommand(arg)),
        vscode.commands.registerCommand('triforge.importProject', () => importProjectCommand(context.extensionUri)),
    );
}
