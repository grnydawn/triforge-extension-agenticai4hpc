import * as vscode from 'vscode';
import { ProjectManager } from '../state/ProjectManager';
import { MapEditor } from '../panels/MapEditor';
import { Logger } from '../utils/Logger';

export function registerMapCommands(context: vscode.ExtensionContext) {
    const openMapDisposable = vscode.commands.registerCommand('triforge.openMap', (project: any, options?: any) => {
        if (!project) return;
        MapEditor.revealAndUnfold(context.extensionUri, project, options);
    });

    const selectDemDisposable = vscode.commands.registerCommand('triforge.selectDem', (project: any, bounds?: any) => {
        Logger.info('[Command] triforge.selectDem triggered');
        if (!project) {
            project = ProjectManager.instance.activeProject;
        }
        if (project) {
            MapEditor.revealAndUnfold(context.extensionUri, project, bounds);
        } else {
            vscode.window.showErrorMessage('No active project found.');
        }
    });

    const generateDemDisposable = vscode.commands.registerCommand('triforge.generateDem', async () => {
        const project = ProjectManager.instance.activeProject;
        if (!project || !project.utmHeader) {
            vscode.window.showErrorMessage("Active project with defined UTM Header is required.", { modal: true });
            return;
        }

        // 1. Select API Source
        const sourceOptions = [
            { label: 'SRTMGL1', description: 'Global ~30m (Most reliable baseline)', detail: 'OpenTopography' },
            { label: 'SRTMGL3', description: 'Global ~90m (Smaller file size)', detail: 'OpenTopography' },
            { label: 'AW3D30', description: 'Global ~30m (ALOS World 3D - JAXA)', detail: 'OpenTopography' },
            { label: 'COP30', description: 'Global ~30m (Copernicus - ESA)', detail: 'OpenTopography' },
            { label: 'NASADEM', description: 'Global ~30m (Reprocessed SRTM)', detail: 'OpenTopography' }
        ];

        const selectedSource = await vscode.window.showQuickPick(sourceOptions, {
            placeHolder: 'Select Elevation Data Source',
            ignoreFocusOut: true
        });

        if (!selectedSource) return;

        // 2. Check/Prompt for API Key
        // SEC-2: the key lives in SecretStorage, not plaintext config.json.
        let apiKey = await ProjectManager.instance.getOpenTopographyApiKey(project.id)
            ?? project.apiKeys?.openTopography;
        if (!apiKey) {
            apiKey = await vscode.window.showInputBox({
                prompt: 'Enter OpenTopography API Key (Required)',
                placeHolder: 'Get free key from opentopography.org',
                ignoreFocusOut: true,
                password: true
            });

            if (!apiKey) return;

            // SEC-2: persist the key to SecretStorage (never to config.json).
            await ProjectManager.instance.setOpenTopographyApiKey(project.id, apiKey);
        }

        // 3. Determine EPSG/CRS
        // We need an EPSG code to perform the warp. If not saved, ask user.
        let epsgCode = project.epsg;
        if (!epsgCode) {
            // infer zone?
            // Ask user for now to be safe
            const input = await vscode.window.showInputBox({
                prompt: 'Enter UTM EPSG Code (e.g., 32616 for Zone 16N)',
                placeHolder: 'e.g., 32616',
                ignoreFocusOut: true,
                validateInput: (val) => {
                    return (val && !isNaN(Number(val))) ? null : 'Must be a valid integer EPSG code';
                }
            });
            if (!input) return;
            epsgCode = parseInt(input);

            // Save EPSG to Project
            const updatedProject = { ...ProjectManager.instance.activeProject! }; // Refresh needed? Instance singleton handles it.
            updatedProject.epsg = epsgCode;
            ProjectManager.instance.updateProject(updatedProject);
        }

        // 4. Run Script
        const width = project.utmHeader.ncols;
        const height = project.utmHeader.nrows;
        const xmin = project.utmHeader.xllcorner;
        const ymin = project.utmHeader.yllcorner;
        const cellsize = project.utmHeader.cellsize;
        const xmax = xmin + (width * cellsize);
        const ymax = ymin + (height * cellsize);

        // Output path in 'Input' folder
        const path = require('path');
        const fs = require('fs');
        const inputDir = path.join(project.path, 'Input');
        if (!fs.existsSync(inputDir)) fs.mkdirSync(inputDir, { recursive: true });

        const outputFilename = `generated_dem_${selectedSource.label}.tif`;
        const outputPath = path.join(inputDir, outputFilename);

        const config = {
            utm_bbox: [xmin, ymin, xmax, ymax],
            target_epsg: Number(epsgCode),
            width: width,
            height: height,
            api_source: selectedSource.label,
            api_key: apiKey,
            output_path: outputPath
        };

        // BUG-1: the fetch script ships in dist/ (copied by copy-webpack-plugin),
        // not src/ (which .vscodeignore strips from the VSIX). Resolve it from dist
        // and fail loudly if it is missing instead of letting spawn hang the spinner.
        const scriptPath = path.join(context.extensionPath, 'dist', 'fetch_dem.py');
        if (!fs.existsSync(scriptPath)) {
            vscode.window.showErrorMessage(
                `DEM fetch script not found at ${scriptPath}. Reinstall the extension or rebuild (npm run compile).`,
                { modal: true }
            );
            return;
        }

        // BUG-1: the python interpreter is configurable (default python3) so a
        // build without python3 on PATH can point at a working interpreter.
        const pythonCmd =
            vscode.workspace.getConfiguration('triforge.python').get<string>('interpreterPath')?.trim() || 'python3';

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Fetching DEM from ${selectedSource.label}...`,
            cancellable: true
        }, async (_progress, token) => {
            return new Promise<void>((resolve, _reject) => {
                const cp = require('child_process');

                // SEC-2 follow-up (transport hardening, out of scope for the
                // storage fix guarded by SET-3): the config carries api_key via
                // argv, which is visible in the OS process table. A future change
                // should pass `config` to fetch_dem.py over stdin instead.
                const childProcess = cp.spawn(pythonCmd, [scriptPath, JSON.stringify(config)]);

                let settled = false;
                const settle = () => {
                    if (settled) return;
                    settled = true;
                    resolve();
                };

                // BUG-1: a cancelled progress kills the child and settles, so the
                // spinner can never hang indefinitely.
                const cancelSub = token.onCancellationRequested(() => {
                    try {
                        childProcess.kill();
                    } catch {
                        /* child may already be gone */
                    }
                    vscode.window.showWarningMessage('DEM generation cancelled.');
                    settle();
                });

                let errorOutput = '';
                childProcess.stderr.on('data', (data: any) => {
                    errorOutput += data.toString();
                });

                childProcess.stdout.on('data', (data: any) => {
                    Logger.info(`[DEM Gen] ${data.toString()}`);
                });

                // BUG-1: a missing/unavailable interpreter (ENOENT) previously left
                // the wrapping Promise unsettled and the spinner spinning forever.
                // Surface a clear error and settle.
                childProcess.on('error', (err: any) => {
                    cancelSub.dispose();
                    Logger.error('[DEM Gen] Failed to start python interpreter', err);
                    vscode.window.showErrorMessage(
                        `Failed to run DEM generation with "${pythonCmd}": ${err?.message ?? err}. ` +
                        'Set "triforge.python.interpreterPath" to a valid Python interpreter.',
                        { modal: true }
                    );
                    settle();
                });

                childProcess.on('close', (code: number) => {
                    cancelSub.dispose();
                    if (settled) return;
                    if (code === 0) {
                        // Success
                        vscode.window.showInformationMessage(`DEM Generated Successfully: ${outputFilename}`);

                        // Update Project to use this DEM
                        const p = { ...ProjectManager.instance.activeProject! };
                        p.demPath = inputDir; // Set to folder? Or file?
                        // Current logic seems to point demPath to FOLDER containing .dem/.asc
                        // But ExplorerProvider logic looks for .dem/.asc in that folder.
                        // .tif might not be auto-picked by ExplorerProvider if it only looks for .dem/.asc (Need to check this)
                        p.demPath = inputDir;
                        ProjectManager.instance.updateProject(p);
                        settle();
                    } else {
                        vscode.window.showErrorMessage(`DEM Generation Failed: ${errorOutput}`, { modal: true });
                        settle(); // Settle to close progress, but error shown
                    }
                });
            });
        });
    });

    context.subscriptions.push(openMapDisposable, selectDemDisposable, generateDemDisposable);
}
