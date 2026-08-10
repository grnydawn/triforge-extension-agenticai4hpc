import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DemResampler } from '../services/DemResampler';
import { DemManager } from '../parsers/DemManager';
import { UtmConverter } from '../webview-ui/map/utils/UtmConverter';

import { ProjectManager } from '../state/ProjectManager';
import { Logger } from '../utils/Logger';
import { getInputGeneratorHtml } from './templates/InputGeneratorHtml';
import { OpenTopographyService } from '../services/OpenTopographyService';
import { serializeSourceLocations, serializeHydrograph } from '../services/streamflow';

export class InputGeneratorEditor {
    // Map to store panels by mode ('static' | 'dynamic')
    private static _panels: Map<string, InputGeneratorEditor> = new Map();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _mode: 'static' | 'dynamic';
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, mode: 'static' | 'dynamic') {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._mode = mode;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.type) {
                    case 'log':
                        Logger.info(`[InputGen] ${message.text}`);
                        return;
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;
                    case 'getDemOnline':
                        if (message.source === 'OpenTopography') {
                            await this._handleGetDemFromOpenTopography(message);
                        } else {
                            vscode.window.showInformationMessage(`Online source '${message.source}' is not yet implemented.`);
                        }
                        return;
                    case 'browseDemFile':
                        await this._handleBrowseDemFile();
                        return;
                    case 'applyDemFile':
                        await this._handleApplyDemFile(message.path);
                        return;

                    case 'browseInitialInputFile':
                        await this._handleBrowseInitialInputFile();
                        return;
                    case 'applyInitialInputFile':
                        await this._handleApplyInitialInputFile(message.path);
                        return;

                    case 'browseQxInputFile':
                        await this._handleBrowseQxInputFile();
                        return;
                    case 'applyQxInputFile':
                        await this._handleApplyQxInputFile(message.paths);
                        return;

                    case 'browseStreamflowLocFile':
                        await this._handleBrowseStreamflowLocFile();
                        return;
                    case 'browseStreamflowDynFile':
                        await this._handleBrowseStreamflowDynFile();
                        return;
                    case 'applyStreamflowFile':
                        await this._handleApplyStreamflowFile(message.numSources, message.locPath, message.dynPath);
                        return;
                    case 'saveStreamflowData':
                        await this._handleSaveStreamflowData(message.locations, message.hydrographs);
                        return;

                    case 'close':
                        this.dispose();
                        return;

                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri, mode: 'static' | 'dynamic') {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        const activeProject = ProjectManager.instance.activeProject;
        const titleType = mode === 'static' ? 'Static' : 'Dynamic';
        const panelTitle = activeProject ? `Generate ${titleType} Input (${activeProject.name})` : `Generate ${titleType} Input`;

        const existingPanel = InputGeneratorEditor._panels.get(mode);

        if (existingPanel) {
            existingPanel._panel.title = panelTitle;
            existingPanel._panel.reveal(column);

            // Force refresh simulation params
            if (activeProject) {
                existingPanel._panel.webview.postMessage({
                    type: 'updateSimulationParams',
                    data: {
                        sim_start_time: activeProject.sim_start_time,
                        sim_duration: activeProject.sim_duration,
                        print_interval: activeProject.print_interval
                    }
                });
            }
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            `triforgeInputGenerator_${mode}`,
            panelTitle,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(extensionUri.fsPath, 'media'))
                ]
            }
        );

        InputGeneratorEditor._panels.set(mode, new InputGeneratorEditor(panel, extensionUri, mode));
    }

    public dispose() {
        InputGeneratorEditor._panels.delete(this._mode);
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async _handleGetDemFromOpenTopography(message: any) {
        const { apiKey, header, utmZone, datum } = message;

        // Validation
        if (!apiKey || !header || !utmZone) {
            vscode.window.showErrorMessage('Missing parameters for DEM download.');
            return;
        }

        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject || !activeProject.path) {
            vscode.window.showErrorMessage('No active project found to save DEM to.');
            return;
        }

        // Use a temporary folder for the initial download
        const tempDir = path.dirname(activeProject.path);

        // Save API Key if requested.
        // SEC-2: the key is a secret — store it in SecretStorage, never in the
        // plaintext config.json that ProjectManager.updateProject would write.
        if (message.saveApiKey) {
            await ProjectManager.instance.setOpenTopographyApiKey(activeProject.id, apiKey);
        }

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Processing DEM from OpenTopography...",
            cancellable: true
        }, async (_progress, _token) => {
            let tempWgs84Path = '';
            const tempUtmPath = '';

            try {
                Logger.info('[InputGen] Starting DEM Process...');

                _progress.report({ message: "Downloading WGS84 DEM..." });
                Logger.info('[InputGen] Step 1: Downloading WGS84 DEM...');
                // 1. Download as WGS84 (Source)
                tempWgs84Path = await OpenTopographyService.downloadDem(
                    apiKey, 'SRTMGL1', header, utmZone, datum, tempDir,
                    (abort) => { _token.onCancellationRequested(abort); }
                );

                _progress.report({ message: "Parsing downloaded DEM..." });
                Logger.info('[InputGen] Step 2: Parsing DEM...');
                // 2. Parse the Downloaded DEM
                // Use DemManager to load. 
                const wgs84Data = await DemManager.load(tempWgs84Path);
                Logger.info(`[InputGen] Parsed WGS84 Data: ${wgs84Data.header.ncols}x${wgs84Data.header.nrows}`);

                // 3. Define Target Header from Project Settings (Simulation Area)
                // Ensure numeric types
                const targetHeader = {
                    ncols: parseInt(header.ncols),
                    nrows: parseInt(header.nrows),
                    xllcorner: parseFloat(header.xllcorner),
                    yllcorner: parseFloat(header.yllcorner),
                    cellsize: parseFloat(header.cellsize),
                    NODATA_value: parseInt(header.NODATA_value) || -9999
                };

                _progress.report({ message: `Resampling to UTM Zone ${utmZone}...` });
                Logger.info('[InputGen] Step 3: Resampling...');
                // 4. Resample to Project Grid
                const utmData = await DemResampler.resample(wgs84Data, targetHeader, utmZone, datum);
                Logger.info('[InputGen] Resampling Done.');

                // 5. Determine Save Format and Location
                const projectFormat = activeProject.input_format || 'ASC';
                const defaultExt = projectFormat === 'BIN' ? 'bin' : 'asc';
                const defaultUri = vscode.Uri.file(path.join(activeProject.path, 'input', `${activeProject.name}.${defaultExt}`));

                const filters: { [key: string]: string[] } = {};
                if (projectFormat === 'BIN') {
                    filters['TRITON Binary DEM'] = ['bin'];
                } else {
                    filters['TRITON ASCII DEM'] = ['asc', 'dem'];
                }

                const saveUri = await vscode.window.showSaveDialog({
                    defaultUri: defaultUri,
                    filters: filters,
                    title: 'Save DEM As'
                });

                if (saveUri) {
                    const finalPath = saveUri.fsPath;

                    // Save based on format
                    await DemManager.save(finalPath, utmData);

                    // Refresh Active Project to ensure we have latest state (e.g. API Keys)
                    const latestProject = ProjectManager.instance.activeProject;
                    if (!latestProject) return;

                    // Update Project Config
                    const updatedProject = {
                        ...latestProject,
                        demPath: finalPath,
                        utmZone: utmZone,
                        datum: datum,
                        utmHeader: targetHeader,
                        demVisible: true,
                        lastModified: Date.now() // Force update timestamp to trigger cache invalidation
                    };
                    ProjectManager.instance.updateProject(updatedProject);

                    vscode.window.showInformationMessage(`DEM saved and resampled to: ${path.basename(finalPath)}`);

                    // Trigger map update
                    vscode.commands.executeCommand('triforge.openProject', updatedProject);
                }

            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to process DEM: ${err.message}`);
                Logger.error(`[InputGen] Process Error: ${err}`);
            } finally {
                // Cleanup temp files
                if (tempWgs84Path && fs.existsSync(tempWgs84Path)) fs.unlinkSync(tempWgs84Path);
                if (tempUtmPath && fs.existsSync(tempUtmPath)) fs.unlinkSync(tempUtmPath);
            }
        });
    }




    private async _handleBrowseDemFile() {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject || !activeProject.path) return;

        const defaultUri = vscode.Uri.file(path.join(activeProject.path, 'input'));

        const files = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: defaultUri,
            openLabel: 'Select DEM File'
        });

        if (files && files.length > 0) {
            const selectedPath = files[0].fsPath;
            // Notify Webview to update Input
            this._panel.webview.postMessage({ type: 'updateDemPath', path: selectedPath });
        }
    }

    private async _handleApplyDemFile(selectedPath: string) {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject || !selectedPath) return;

        try {
            // Check for Format Mismatch
            const { FileTypeDetector } = await import('../utils/FileTypeDetector');
            const detectedType = FileTypeDetector.detect(selectedPath);

            // -------------------------------------------------------------------------
            // 2. Validate Header Against Project Config
            // -------------------------------------------------------------------------
            const projectHeader = activeProject.utmHeader;
            if (projectHeader) {
                let errorDetails = '';

                if (detectedType === 'ascii') {
                    // Check ASCII Header
                    const { DemParser } = await import('../parsers/DemParser');
                    try {
                        // Parse header only for speed
                        const fileHeader = await DemParser.parseHeaderOnly(selectedPath);

                        // Check Dimensions
                        if (fileHeader.ncols !== projectHeader.ncols || fileHeader.nrows !== projectHeader.nrows) {
                            errorDetails += `Dimensions differ: Project [${projectHeader.ncols}x${projectHeader.nrows}], File [${fileHeader.ncols}x${fileHeader.nrows}].\n`;
                        }

                        // Check Cellsize (Allow small epsilon)
                        if (Math.abs(fileHeader.cellsize - projectHeader.cellsize) > 0.001) {
                            errorDetails += `Cellsize differs: Project [${projectHeader.cellsize}], File [${fileHeader.cellsize}].\n`;
                        }

                        // Check Origin (Allow small epsilon)
                        // Note: DemParser normalizes to corner, project uses corner.
                        if (Math.abs(fileHeader.xllcorner - projectHeader.xllcorner) > 0.001) {
                            errorDetails += `XLL Corner differs: Project [${projectHeader.xllcorner}], File [${fileHeader.xllcorner}].\n`;
                        }
                        if (Math.abs(fileHeader.yllcorner - projectHeader.yllcorner) > 0.001) {
                            errorDetails += `YLL Corner differs: Project [${projectHeader.yllcorner}], File [${fileHeader.yllcorner}].\n`;
                        }

                    } catch (e: any) {
                        vscode.window.showWarningMessage(`Could not parse ASCII header for validation: ${e.message}.`, { modal: true });
                        return;
                    }
                } else {
                    // Check Binary Header
                    const { BinaryParser } = await import('../parsers/BinaryParser');
                    const dims = await BinaryParser.getDimensions(selectedPath);
                    if (dims) {
                        if (dims.cols !== projectHeader.ncols || dims.rows !== projectHeader.nrows) {
                            errorDetails += `Dimensions differ: Project [${projectHeader.ncols}x${projectHeader.nrows}], File [${dims.cols}x${dims.rows}].\n`;
                        }
                    }
                }

                if (errorDetails) {
                    vscode.window.showWarningMessage(`Header Mismatch Detected:\n${errorDetails}\nThe file does not match the project configuration.`, { modal: true });
                    return; // Abort loading
                }
            }

            const projectFormat = activeProject.input_format || 'ASC'; // Default to ASC if not set
            let warningMsg = '';
            let needsConversion = false;

            if (projectFormat === 'BIN' && detectedType === 'ascii') {
                warningMsg = `Project expects BINARY format, but selected file is ASCII. Do you want to convert it?`;
                needsConversion = true;
            } else if (projectFormat === 'ASC' && detectedType === 'binary') {
                warningMsg = `Project expects ASCII format, but selected file is BINARY. Do you want to convert it?`;
                needsConversion = true;
            }

            if (needsConversion) {
                const selection = await vscode.window.showWarningMessage(warningMsg, { modal: true }, 'Convert', 'Cancel', 'Use as is');

                // Determine Target Path
                const inputDir = path.join(activeProject.path, 'input');
                let targetFile = '';
                if (projectFormat === 'BIN') {
                    targetFile = path.join(inputDir, 'dem.bin');
                } else {
                    targetFile = path.join(inputDir, 'dem.asc');
                }

                if (selection === 'Convert') {
                    // Use DemManager to convert
                    // We pass project header in case reading binary requires it
                    await DemManager.convert(selectedPath, targetFile, activeProject.utmHeader);

                    selectedPath = targetFile;
                    vscode.window.showInformationMessage(`File converted and saved to: ${path.basename(selectedPath)}`);
                } else if (selection === 'Cancel') {
                    return; // Abort
                }
                // 'Use as is' -> selectedPath remains same
            }
            // 'Use as is' -> selectedPath remains same

            // Update Project
            const updatedProject = {
                ...activeProject,
                demPath: selectedPath,
                lastModified: Date.now()
            };
            ProjectManager.instance.updateProject(updatedProject);

            // Open Map
            vscode.commands.executeCommand('triforge.openMap', updatedProject);

            // Close Panel on Success
            this.dispose();

        } catch (err: any) {
            vscode.window.showErrorMessage(`Error processing DEM file: ${err.message}`);
            Logger.error(`[InputGen] DEM Selection Error: ${err}`);
        }
    }

    private async _handleBrowseInitialInputFile() {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject || !activeProject.path) return;

        const defaultUri = vscode.Uri.file(path.join(activeProject.path, 'input'));

        const files = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: defaultUri,
            openLabel: 'Select Initial Input'
        });

        if (files && files.length > 0) {
            const selectedPath = files[0].fsPath;
            // Notify Webview
            this._panel.webview.postMessage({ type: 'updateInitialInputPath', path: selectedPath });
        }
    }

    private async _handleApplyInitialInputFile(selectedPath: string) {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject || !selectedPath) return;

        // Update Project
        const updatedProject = {
            ...activeProject,
            initialInputPath: selectedPath,
            lastModified: Date.now()
        };
        ProjectManager.instance.updateProject(updatedProject);

        // Open Map
        vscode.commands.executeCommand('triforge.openMap', updatedProject);

        // Close Panel
        this.dispose();
    }

    private async _handleBrowseQxInputFile() {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject || !activeProject.path) return;

        const defaultUri = vscode.Uri.file(path.join(activeProject.path, 'input'));

        const files = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true, // Multiselect for QX/QY
            defaultUri: defaultUri,
            openLabel: 'Select QX & QY Files'
        });

        if (files) {
            if (files.length !== 2) {
                vscode.window.showWarningMessage("Please select exactly two files (one for QX, one for QY).");
                return;
            }
            const paths = files.map(f => f.fsPath);
            // Notify Webview - send both paths
            this._panel.webview.postMessage({ type: 'updateQxQyInputPaths', paths: paths });
        }
    }

    private async _handleApplyQxInputFile(paths: string[]) {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject || !paths || paths.length < 2) return;

        // Heuristic to determine which is QX vs QY
        paths.sort();

        let qxPath = paths[0];
        let qyPath = paths[1];

        const p0Base = path.basename(paths[0]).toLowerCase();
        const p1Base = path.basename(paths[1]).toLowerCase();

        // Check if one has 'x' and other has 'y'
        const p0HasX = p0Base.includes('x');
        const p0HasY = p0Base.includes('y');
        const p1HasX = p1Base.includes('x');
        const p1HasY = p1Base.includes('y');

        if (p0HasX && !p0HasY && p1HasY && !p1HasX) {
            // p0 is X, p1 is Y (Default)
        } else if (p0HasY && !p0HasX && p1HasX && !p1HasY) {
            // p0 is Y, p1 is X
            qxPath = paths[1];
            qyPath = paths[0];
        }

        // Update Project
        const updatedProject = {
            ...activeProject,
            qx_infile: qxPath,
            qy_infile: qyPath,
            lastModified: Date.now()
        };
        ProjectManager.instance.updateProject(updatedProject);

        // Open Map
        vscode.commands.executeCommand('triforge.openMap', updatedProject);

        // Close Panel
        this.dispose();
    }

    private async _handleBrowseStreamflowLocFile() {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject || !activeProject.path) return;

        const defaultUri = vscode.Uri.file(path.join(activeProject.path, 'input'));

        const files = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: defaultUri,
            openLabel: 'Select Streamflow Location File'
        });

        if (files && files.length > 0) {
            const selectedPath = files[0].fsPath;
            this._panel.webview.postMessage({ type: 'updateStreamflowLocPath', path: selectedPath });
        }
    }

    private async _handleBrowseStreamflowDynFile() {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject || !activeProject.path) return;

        const defaultUri = vscode.Uri.file(path.join(activeProject.path, 'input'));

        const files = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: defaultUri,
            openLabel: 'Select Streamflow Dynamic File'
        });

        if (files && files.length > 0) {
            const selectedPath = files[0].fsPath;
            this._panel.webview.postMessage({ type: 'updateStreamflowDynPath', path: selectedPath });
        }
    }

    private async _handleApplyStreamflowFile(numSources: string, locPath: string, dynPath: string) {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject) return;

        // Update Project
        const updatedProject = {
            ...activeProject,
            num_sources: numSources ? parseInt(numSources) : undefined,
            src_loc_file: locPath,
            hydrograph_filename: dynPath,
            lastModified: Date.now()
        };
        ProjectManager.instance.updateProject(updatedProject);

        // Open Map (if needed, or just close)
        // vscode.commands.executeCommand('triforge.openMap', updatedProject);

        // Close Panel
        this.dispose();
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const stylePathOnDisk = vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'inputGenerator.css'));

        const styleUri = webview.asWebviewUri(stylePathOnDisk);

        // SEC-4: Leaflet is bundled locally under media/leaflet (no unpkg CDN).
        const leafletJsUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'leaflet', 'leaflet.js')));
        const leafletCssUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'leaflet', 'leaflet.css')));

        const nonce = getNonce();

        // Get Active Project Info
        const activeProject = ProjectManager.instance.activeProject;
        const initialData = {
            header: activeProject?.utmHeader || {},
            utmZone: activeProject?.utmZone || '',
            datum: activeProject?.datum || 'WGS84',
            projectName: activeProject ? activeProject.name : '',
            demPath: activeProject?.demPath || '',
            // SEC-2: apiKeys are hydrated from SecretStorage at load time (see
            // ProjectManager._hydrateApiKeysFromSecrets); never read from config.
            openTopographyApiKey: activeProject?.apiKeys?.openTopography || '',
            initialInputPath: activeProject?.initialInputPath || '',
            qxInitialInputPath: activeProject?.qx_infile || '',
            qyInitialInputPath: activeProject?.qy_infile || '',
            num_sources: activeProject?.num_sources || '',
            src_loc_file: activeProject?.src_loc_file || '',
            hydrograph_filename: activeProject?.hydrograph_filename || '',
            mode: this._mode,
            projectBoundary: this._getProjectBoundary(activeProject),
            streamflowLocations: this._getStreamflowLocations(activeProject),
            hydrographData: this._getHydrographData(activeProject),
            // Graph Params
            sim_start_time: activeProject?.sim_start_time ?? 0,
            sim_duration: activeProject?.sim_duration ?? 86400,
            print_interval: activeProject?.print_interval ?? 900
        };

        return getInputGeneratorHtml(webview.cspSource, styleUri.toString(), nonce, leafletJsUri.toString(), leafletCssUri.toString(), initialData);
    }

    private _getProjectBoundary(project: any): { lat: number, lng: number }[] | null {
        if (!project || !project.utmHeader || !project.utmZone) return null;

        const header = project.utmHeader;
        const zone = project.utmZone;
        const datum = project.datum || 'WGS84';

        try {
            // Calculate 4 corners
            const bl = UtmConverter.utmToLatLon(header.xllcorner, header.yllcorner, zone, datum);
            const br = UtmConverter.utmToLatLon(header.xllcorner + (header.ncols * header.cellsize), header.yllcorner, zone, datum);
            const tr = UtmConverter.utmToLatLon(header.xllcorner + (header.ncols * header.cellsize), header.yllcorner + (header.nrows * header.cellsize), zone, datum);
            const tl = UtmConverter.utmToLatLon(header.xllcorner, header.yllcorner + (header.nrows * header.cellsize), zone, datum);

            if (bl && br && tr && tl) {
                return [
                    { lat: bl.lat, lng: bl.lng },
                    { lat: br.lat, lng: br.lng },
                    { lat: tr.lat, lng: tr.lng },
                    { lat: tl.lat, lng: tl.lng }
                ];
            }
        } catch (e) {
            Logger.warn(`[InputGen] Failed to calculate boundary: ${e}`);
        }
        return null;
    }



    private _getStreamflowLocations(project: any): { lat: number, lng: number, id: string, index: number }[] {
        if (!project || !project.src_loc_file || !project.utmHeader || !project.utmZone) return [];

        const locFile = project.src_loc_file;
        if (!fs.existsSync(locFile)) return [];

        const locations: { lat: number, lng: number, id: string, index: number }[] = [];
        const zone = project.utmZone;
        const datum = project.datum || 'WGS84';

        try {
            const content = fs.readFileSync(locFile, 'utf8');
            const lines = content.split(/\r?\n/)
                .map(l => l.trim())
                .filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('%'));

            lines.forEach((line, index) => {
                const parts = line.split(',').map(Number);
                if (parts.length >= 2) {
                    const utmX = parts[0];
                    const utmY = parts[1];
                    if (!isNaN(utmX) && !isNaN(utmY)) {
                        const { lat, lng } = UtmConverter.utmToLatLon(utmX, utmY, zone, datum);
                        locations.push({ lat, lng, id: `Source ${index + 1}`, index: index });
                    }
                }
            });
        } catch (e) {
            Logger.warn(`[InputGen] Failed to read streamflow locations: ${e}`);
        }
        return locations;
    }
    private _getHydrographData(project: any): number[][] {
        if (!project || !project.hydrograph_filename) return [];
        const hygFile = project.hydrograph_filename;
        if (!fs.existsSync(hygFile)) return [];

        try {
            const content = fs.readFileSync(hygFile, 'utf8');
            const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0 && !l.startsWith('#') && !l.startsWith('%'));

            const rows = lines.map(l => l.trim().split(',').map(Number));
            if (rows.length === 0) return [];

            const numCols = rows[0].length;
            if (numCols < 2) return [];

            const hydrographs: number[][] = [];
            for (let col = 1; col < numCols; col++) {
                const columnData = rows.map(r => r[col]);
                hydrographs.push(columnData);
            }
            return hydrographs;

        } catch (e) {
            Logger.warn(`[InputGen] Failed to read hydrograph file: ${e}`);
            return [];
        }
    }

    private async _handleSaveStreamflowData(locations: { lat: number, lng: number }[], hydrographs: number[][]) {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject || !activeProject.path) return;

        try {
            const baseName = activeProject.name || 'streamflow';
            const srcFile = path.join(activeProject.path, 'input', `${baseName}.src`);
            const hygFile = path.join(activeProject.path, 'input', `${baseName}.hyg`);

            const zone = activeProject.utmZone;
            if (!zone) throw new Error('UTM Zone is not defined for this project.');
            fs.writeFileSync(srcFile, serializeSourceLocations(locations, zone));
            fs.writeFileSync(hygFile, serializeHydrograph(hydrographs, {
                simStart: activeProject.sim_start_time || 0,
                printInterval: activeProject.print_interval || 900,
                simDuration: activeProject.sim_duration || 86400,
            }));

            const updatedProject = {
                ...activeProject,
                src_loc_file: srcFile,
                hydrograph_filename: hygFile,
                num_sources: locations.length,
                lastModified: Date.now()
            };
            ProjectManager.instance.updateProject(updatedProject);

            vscode.window.showInformationMessage(`Streamflow saved: ${path.basename(srcFile)} & ${path.basename(hygFile)}`);

        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to save streamflow data: ${e.message}`);
            Logger.error(`[InputGen] Save Streamflow Error: ${e}`);
        }
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
