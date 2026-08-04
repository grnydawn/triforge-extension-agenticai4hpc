import * as vscode from 'vscode';
import { ProjectManager, TriforgeProject } from '../state/ProjectManager';

import * as fs from 'fs';
import * as path from 'path';
import { DemManager } from '../parsers/DemManager';

import { getProjectCreatorHtml } from './templates/ProjectCreatorHtml';
import { MapSelector } from './MapSelector';
import { GlobalSettingsManager } from '../state/GlobalSettingsManager';
import { workspaceRootFromPath } from '../services/agentContext/controlRoot';

export class ProjectCreator {
    public static currentPanel: ProjectCreator | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    // State for pending conversion
    private _pendingConversion: { shouldConvert: boolean, sourcePath: string, targetFormat: 'ASC' | 'BIN' } | undefined;

    private constructor(panel: vscode.WebviewPanel, private readonly _extensionUri: vscode.Uri) {
        this._panel = panel;
        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'alert':
                        vscode.window.showErrorMessage(message.text, { modal: true });
                        return;
                    case 'browseLocation':
                        this._handleBrowseLocation();
                        return;

                    case 'generateFromMap':
                        this._handleGenerateFromMap(message);
                        return;
                    case 'createProject':
                        this._handleCreateProject(message.data);
                        return;
                    case 'browseDemFile':
                        this._handleBrowseDemFile(message.inputFormat);
                        return;
                    case 'cancel':
                        this.dispose();
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    private async _handleGenerateFromMap(message: any) {
        // Use cellsize from message, fallback to default if missing (though frontend validates)
        const cellSize = message.cellsize || 30.0;

        MapSelector.createOrShow(this._extensionUri, cellSize, (data: any) => {
            // Data received from MapSelector (e.g., { type: 'grid', ncols, nrows, xll, yll, ... })
            if (data && data.header) {
                this._panel.webview.postMessage({
                    command: 'applyDemHeader',
                    header: data.header,
                    utmZone: data.utmZone,
                    datum: data.datum // Pass datum
                });
            }
        });
    }

    private async _handleBrowseLocation() {
        const options: vscode.OpenDialogOptions = {
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Project Location'
        };

        const uri = await vscode.window.showOpenDialog(options);
        if (uri && uri[0]) {
            this._panel.webview.postMessage({ command: 'updateLocation', path: uri[0].fsPath });
        }
    }



    private async _handleBrowseDemFile(inputFormat: 'ASC' | 'BIN' = 'ASC') {
        const options: vscode.OpenDialogOptions = {
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: 'Select DEM File'
        };

        const uri = await vscode.window.showOpenDialog(options);
        if (uri && uri[0]) {
            const fsPath = uri[0].fsPath;

            try {
                // 1. Detect File Type
                const { FileTypeDetector } = await import('../utils/FileTypeDetector');
                const detectedType = FileTypeDetector.detect(fsPath);

                let warningMsg = '';
                let needsConversion = false;

                if (inputFormat === 'BIN' && detectedType === 'ascii') {
                    warningMsg = `Selected file is ASCII, but Input Format is BINARY. Do you want to convert it?`;
                    needsConversion = true;
                } else if (inputFormat === 'ASC' && detectedType === 'binary') {
                    warningMsg = `Selected file is BINARY, but Input Format is ASCII. Do you want to convert it?`;
                    needsConversion = true;
                }

                // Reset pending state
                this._pendingConversion = undefined;

                if (needsConversion) {
                    const selection = await vscode.window.showWarningMessage(warningMsg, { modal: true }, 'Convert', 'Cancel', 'Use as is');
                    if (selection === 'Convert') {
                        this._pendingConversion = {
                            shouldConvert: true,
                            sourcePath: fsPath,
                            targetFormat: inputFormat
                        };
                    } else if (selection === 'Cancel') {
                        return;
                    }
                }

                try {
                    const data = await DemManager.load(fsPath);
                    const header = data.header;

                    if (detectedType === 'binary' && header.cellsize === 0) {
                        vscode.window.showWarningMessage("Binary DEM loaded. Cellsize and Coordinates must be entered manually.");
                    }

                    // Attempt Zone detection
                    const { DemParser } = await import('../parsers/DemParser');
                    const zone = DemParser._detectUtmZoneFromPrj(fsPath, '');

                    this._panel.webview.postMessage({
                        command: 'applyDemHeader',
                        header: header,
                        utmZone: zone,
                        path: fsPath
                    });

                } catch (err: any) {
                    vscode.window.showErrorMessage(`Failed to parse DEM: ${err.message}`);
                }
            } catch (outerErr: any) {
                vscode.window.showErrorMessage(`Error processing DEM selection: ${outerErr.message}`);
            }
        }
    }

    private async _handleCreateProject(data: {
        projectName: string;
        projectLocation: string;
        demPath?: string;
        utmZone?: string;
        datum?: string;
        utmHeader?: TriforgeProject['utmHeader'];
        simulationStart?: string;
        timezone?: string;
        inputFormat?: 'ASC' | 'BIN';
        outputFormat?: 'ASC' | 'BIN' | 'GTIFF';
    }) {
        let { projectName, projectLocation, demPath, utmZone, datum, utmHeader, simulationStart, timezone, inputFormat, outputFormat } = data;

        if (!projectName) {
            vscode.window.showErrorMessage('Project Name is required.');
            return;
        }
        if (!projectLocation) {
            vscode.window.showErrorMessage('Project Location is required.');
            return;
        }

        // Project Location sent from frontend is the FULL path
        const fullProjectPath = projectLocation;

        try {
            fs.mkdirSync(fullProjectPath, { recursive: true });
            fs.mkdirSync(path.join(fullProjectPath, 'input'), { recursive: true });
            fs.mkdirSync(path.join(fullProjectPath, 'output'), { recursive: true });
            fs.mkdirSync(path.join(fullProjectPath, 'build'), { recursive: true });

            // CONVERSION LOGIC
            // Check if we have a pending conversion matching this DEM
            if (this._pendingConversion && this._pendingConversion.sourcePath === demPath && this._pendingConversion.targetFormat === inputFormat) {
                try {
                    const inputDir = path.join(fullProjectPath, 'input');
                    const targetExt = inputFormat === 'BIN' ? '.bin' : '.asc';
                    const targetFile = path.join(inputDir, `dem${targetExt}`);

                    // Centralized conversion
                    // We pass utmHeader from UI because source binary might need it
                    await DemManager.convert(demPath!, targetFile, utmHeader);

                    demPath = targetFile; // Update path to the new converted file

                } catch (cErr) {
                    vscode.window.showErrorMessage(`Conversion failed: ${cErr}`);
                    return;
                }
            }

        } catch (err) {
            vscode.window.showErrorMessage(`Failed to create directory: ${fullProjectPath}`);
            return;
        }

        try {
            // Pass name, full path, demPath
            const newProject = ProjectManager.instance.addProject(
                projectName,
                fullProjectPath,
                demPath,
                utmZone,
                datum,
                utmHeader,
                simulationStart,
                timezone,
                inputFormat,
                outputFormat
            );
            vscode.window.showInformationMessage(`Project '${projectName}' created successfully.`);

            // Auto-open/activate the project (triggering map check)
            vscode.commands.executeCommand('triforge.openProject', newProject);

            this.dispose();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to create project: ${err}`);
        }
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.ViewColumn.Active;

        if (ProjectCreator.currentPanel) {
            ProjectCreator.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'triforgeProjectCreator',
            'Create New Project',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        ProjectCreator.currentPanel = new ProjectCreator(panel, extensionUri);
    }

    public dispose() {
        ProjectCreator.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview() {
        // Use a nonce to whitelist which scripts can be run
        const nonce = getNonce();

        // Default new projects into the configured project folder (the workspace
        // root the user chose in Triforge Global Settings), so created and imported
        // projects always land together. Fall back to ~/triforge-projects only when
        // no workspace is configured yet.
        const os = require('os');
        const workspacePath = GlobalSettingsManager.instance.getSettings().workspacePath;
        const defaultPath = workspacePath
            ? workspaceRootFromPath(workspacePath)
            : path.join(os.homedir(), 'triforge-projects');

        return getProjectCreatorHtml(this._panel.webview.cspSource, nonce, defaultPath);
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

