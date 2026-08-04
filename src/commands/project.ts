import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ProjectManager } from '../state/ProjectManager';
import { ProjectCreator } from '../panels/ProjectCreator';
import { GlobalSettingsManager } from '../state/GlobalSettingsManager';
import { workspaceRootFromPath } from '../services/agentContext/controlRoot';

import { MapEditor } from '../panels/MapEditor';
import { Logger } from '../utils/Logger';
import { registerProjectArchiveCommands } from './projectArchive';

/**
 * Resolve the configured Triforge workspace root. Projects live as direct
 * subdirectories of this root; its `.triforge` dir holds the project registry.
 * Mirrors ProjectManager's derivation: if the persisted `workspacePath`
 * already points at a `.triforge` dir, the workspace root is its parent.
 */
export function getTriforgeWorkspaceRoot(): string | undefined {
    const workspacePath = GlobalSettingsManager.instance.getSettings().workspacePath;
    if (!workspacePath || typeof workspacePath !== 'string') {
        return undefined;
    }
    return path.resolve(workspaceRootFromPath(workspacePath));
}

/**
 * Returns whether `target` is contained within `root` (or is `root` itself),
 * guarding against path-traversal escapes via a relative-path check.
 */
function isInside(root: string, target: string): boolean {
    const rel = path.relative(root, target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Validate a project path before an irreversible recursive delete (SEC-5):
 * it must be a non-empty string, absolute, resolve inside the configured
 * Triforge workspace root, and contain the `config.json` project marker.
 * Returns the resolved absolute path on success, or an error reason.
 */
function validateProjectPathForDelete(rawPath: unknown):
    { ok: true; resolved: string } | { ok: false; reason: string } {
    if (typeof rawPath !== 'string' || rawPath.trim() === '') {
        return { ok: false, reason: 'project path is missing or not a string' };
    }
    if (!path.isAbsolute(rawPath)) {
        return { ok: false, reason: `project path is not absolute: ${rawPath}` };
    }
    const resolved = path.resolve(rawPath);
    const root = getTriforgeWorkspaceRoot();
    if (!root) {
        return { ok: false, reason: 'no Triforge workspace root is configured' };
    }
    if (!isInside(root, resolved)) {
        return { ok: false, reason: `path is outside the Triforge workspace (${root}): ${resolved}` };
    }
    if (!fs.existsSync(path.join(resolved, 'config.json'))) {
        return { ok: false, reason: `no config.json marker found in: ${resolved}` };
    }
    return { ok: true, resolved };
}

export function registerProjectCommands(context: vscode.ExtensionContext) {
    const createProjectDisposable = vscode.commands.registerCommand('triforge.createProject', () => {
        ProjectCreator.createOrShow(context.extensionUri);
    });

    const openProjectDisposable = vscode.commands.registerCommand('triforge.openProject', async (project: any) => {
        Logger.info(`[Command] Opening project: ${project.name}`);
        ProjectManager.instance.setActiveProject(project);

        // Always open the map when project is selected
        MapEditor.revealAndUnfold(context.extensionUri, project);
    });

    const openExistingProjectDisposable = vscode.commands.registerCommand('triforge.openExistingProject', async () => {
        const options: vscode.OpenDialogOptions = {
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Open Project Folder'
        };
        const uri = await vscode.window.showOpenDialog(options);
        if (uri && uri[0]) {
            const folderPath = uri[0].fsPath;
            try {
                const projectName = path.basename(folderPath);
                ProjectManager.instance.addProject(projectName, folderPath);
                vscode.window.showInformationMessage(`Project '${projectName}' opened successfully.`);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to open project: ${err}`);
            }
        }
    });

    const removeProjectDisposable = vscode.commands.registerCommand('triforge.removeProject', async (arg: any) => {
        if (!arg) { return; }

        // Unwrap if it causes from Tree View (ProjectNode)
        const project = arg.project ? arg.project : arg;

        if (!project || !project.path) {
            vscode.window.showErrorMessage("Invalid project selection.");
            return;
        }

        // Resolve the absolute path up front so the confirmation modal always
        // shows exactly what would be deleted (no relative/edited surprises).
        const resolvedPath = typeof project.path === 'string' && project.path.trim() !== ''
            ? path.resolve(project.path)
            : String(project.path);
        const name = path.basename(resolvedPath);
        const confirm = await vscode.window.showWarningMessage(
            `Delete project “${name}”?\n\nMove any files you want to keep from ${resolvedPath} before continuing.`,
            { modal: true },
            'Delete'
        );

        if (confirm === 'Delete') {
            try {
                // Close editors
                MapEditor.close(project.id);
                MapEditor.close(project.id);

                // Remove from state
                ProjectManager.instance.removeProject(project.id);

                // Delete from disk — but only after validating the path is safe.
                // A malformed/edited registry entry (e.g. "/" or $HOME) must never
                // trigger an irreversible recursive delete (SEC-5).
                const validation = validateProjectPathForDelete(project.path);
                if (!validation.ok) {
                    Logger.warn(`[removeProject] Refusing to delete folder: ${validation.reason}`);
                    vscode.window.showErrorMessage(
                        `Removed project '${name}' from the list, but did not delete its folder: ${validation.reason}.`
                    );
                    return;
                }

                if (fs.existsSync(validation.resolved)) {
                    fs.rmSync(validation.resolved, { recursive: true, force: true });
                    Logger.info(`Deleted project folder: ${validation.resolved}`);
                }

                vscode.window.showInformationMessage(`Project '${name}' deleted.`);

            } catch (err) {
                vscode.window.showErrorMessage(`Failed to delete project folder: ${err}`);
            }
        }
    });

    registerProjectArchiveCommands(context);

    context.subscriptions.push(createProjectDisposable, openProjectDisposable, openExistingProjectDisposable, removeProjectDisposable);
}
