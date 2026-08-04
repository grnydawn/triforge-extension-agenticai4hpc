import * as vscode from 'vscode';
import { EventBus } from '../state/EventBus';
import { Logger } from '../utils/Logger';
import { DemData } from '../parsers/DemParser';
import { ProjectManager } from '../state/ProjectManager';
import * as fs from 'fs';
import * as path from 'path';
import { getMapEditorHtml } from './templates/MapEditorHtml';
import { GifEncoderService } from '../services/GifEncoderService';
import { MapDataManager } from '../services/MapDataManager';
import { ToWebviewMessage } from '../webview-ui/types/WebviewProtocol';
import { AsciiParser } from '../parsers/AsciiParser';
import { UtmConverter } from '../webview-ui/map/utils/UtmConverter';

export class MapEditor {
    // Map of project ID to MapEditor instance
    public static currentPanels: Map<string, MapEditor> = new Map();
    private readonly _panel: vscode.WebviewPanel;
    private _project: any; // Keep reference to project
    private _disposables: vscode.Disposable[] = [];

    // Cache current DEM data for registration/shifting
    private _currentDemData: DemData | undefined;

    public get currentDemData() {
        return this._currentDemData;
    }

    public constructor(panel: vscode.WebviewPanel, private readonly _extensionUri: vscode.Uri, project: any) {
        this._panel = panel;
        // BUG-9: keep a mutable working copy; project may arrive as a frozen
        // clone from ProjectManager.getProjects() and we mutate it in place.
        this._project = project ? structuredClone(project) : project;

        // Set the webview's initial html content
        this._panel.webview.html = this._getHtmlForWebview();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            null,
            this._disposables
        );

        // Listen to EventBus for updates FROM extension -> Webview
        EventBus.instance.on('map:updateCoordinates', (data) => {
            this.postMessage({ command: 'setCoordinates', data });
        }, this, this._disposables);

        // Listen for visibility changes from TreeView
        EventBus.instance.on('project:demVisibilityChanged', (data: any) => {
            if (this._project && this._project.id === data.projectId) {
                this.postMessage({
                    command: 'toggleDem',
                    data: { visible: data.visible }
                });
            }
        }, this, this._disposables);

        // Listen for Project Updates (outputs added/removed)
        EventBus.instance.on('project:listChanged', () => {
            if (this._project) {
                const updated = ProjectManager.instance.getProjects().find(p => p.id === this._project.id);
                if (updated) {
                    this.updateProjectState(updated);
                }
            }
        }, this, this._disposables);
    }

    public static createOrShow(extensionUri: vscode.Uri, project?: any): MapEditor | undefined {
        // We require a project to open a specific map.
        // If no project provided (legacy call?), maybe fallback or error.
        // For now, if no project, just return (or handle gracefully).
        if (!project) {
            console.error('[MapEditor] createOrShow called without project');
            return undefined;
        }
        console.log('[MapEditor] createOrShow called', project.id);

        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel for this project, show it.
        const existingPanel = MapEditor.currentPanels.get(project.id);
        if (existingPanel) {
            existingPanel.updateProjectState(project);
            existingPanel.loadDemIfAvailable();
            existingPanel.loadInitialInputIfAvailable();
            existingPanel._panel.reveal(column);
            return existingPanel;
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            'triforgeMap',
            project.name || 'Triforge Map', // Use Project Name as Title
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true, // Per user requirement
                // SEC-4: scope local resources to the bundled assets (Leaflet lives
                // under media/leaflet; the map bundle under dist/webview).
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'dist', 'webview')
                ]
            }
        );

        // Explicitly set the icon path using the provided extensionUri
        const iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'triforge-icon.svg');
        panel.iconPath = iconPath;

        const newEditor = new MapEditor(panel, extensionUri, project);
        MapEditor.currentPanels.set(project.id, newEditor);

        // Defer loading until webviewReady message is received
        // newEditor.loadDemIfAvailable(); 
        // ...

        return newEditor;
    }

    private loadAllData() {
        console.log('[MapEditor] Webview Ready. Loading all data.');
        this.loadDemIfAvailable();
        this.loadInitialInputIfAvailable();
        this.loadQxQyIfAvailable();
        this.loadStreamflowIfAvailable();
        this.updateProjectConfig();
    }

    public static revealAndUnfold(extensionUri: vscode.Uri, project: any, options?: any): MapEditor | undefined {
        const instance = this.createOrShow(extensionUri, project);
        // Map is now open or revealed. Find instance and unfold.
        if (instance) {
            instance.unfoldControls();

            // Send Project Config (UTM Header)
            instance.updateProjectConfig();

            // Ensure DEM is visible when explicitly selected from tree
            instance.ensureDemVisible();

            // Update Animation Pane Visibility based on outputs
            instance.updateOutputStatus();

            // Reload Streamflow if it was requested specifically (though updatedProjectState might handle it)
            if (options && options.layer === 'streamflow') {
                instance.loadStreamflowIfAvailable();
            }


            // Handle Zoom / Bounds
            // Let's assume options is EITHER bounds (legacy/selectDem) OR { layer, bounds } object.
            let targetBounds = null;
            if (options) {
                if (options.south !== undefined || (Array.isArray(options) && options.length === 2)) {
                    // Check if it looks like bounds
                    targetBounds = options;
                } else if (options.bounds) {
                    targetBounds = options.bounds;
                }
            }

            if (targetBounds || (options && options.layer)) {
                setTimeout(() => {
                    if (options && options.layer) {
                        instance.activateLayer(options.layer);
                    }
                    if (targetBounds) {
                        instance.postMessage({ command: 'zoomToExtent', data: targetBounds });
                    }
                }, 500);
            }
        }
        return instance;
    }

    public activateLayer(layerName: string) {
        // Send command to webview to bring pane to front and ensure visibility
        this.postMessage({
            command: 'activateLayer',
            data: { layer: layerName }
        });

        // Also ensure project state is updated if needed (e.g. visibility)
        if (layerName === 'dem') {
            this.ensureDemVisible();
        } else if (layerName === 'init') {
            // ensure init visible?
            // Helper for init?
        }
    }

    public updateProjectConfig() {
        if (this._project && this._project.utmHeader) {
            console.log(`[MapEditor] Sending Project Config. SimStart='${this._project.simulationStart}', Timezone='${this._project.timezone}'`);
            this.postMessage({
                command: 'setProjectHeader',
                data: {
                    header: this._project.utmHeader,
                    utmZone: this._project.utmZone,
                    datum: this._project.datum || 'WGS84',
                    // Time config for animation display
                    simStartTime: this._project.simulationStart, // This is the STRING "YYYY-MM-DD HH:mm"
                    timezone: this._project.timezone || 'UTC',
                    printInterval: this._project.print_interval || 3600 // default 1h if missing
                }
            });
        }
    }

    public clearDem() {
        this.postMessage({ command: 'clearDem' });
        // Update local object state
        if (this._project) {
            this._project.demVisible = false; // implied?
        }
        this._currentDemData = undefined; // Clear cache!
    }



    public unfoldControls() {
        this.postMessage({ command: 'unfoldControls' });
    }

    public updateOutputStatus() {
        if (!this._project) return;
        const outputs = this._project.outputs || {};
        const hasGeotiff = outputs.geotiff && outputs.geotiff.length > 0;
        const hasBinary = outputs.binary && outputs.binary.length > 0;
        const hasAscii = outputs.ascii && outputs.ascii.length > 0;
        const hasOutputs = hasGeotiff || hasBinary || hasAscii;

        this.postMessage({
            command: 'toggleAnimationPane',
            visible: hasOutputs
        });
    }

    public updateProjectState(project: any) {
        // Check if DEM path changed OR project was modified (e.g. new DEM generation)
        if (this._project && (this._project.demPath !== project.demPath || (project.lastModified && project.lastModified !== this._project.lastModified))) {
            this._currentDemData = undefined; // Invalidate cache to force reload
        }

        const initialInputChanged = this._project && (this._project.initialInputPath !== project.initialInputPath);
        const qxChanged = this._project && (this._project.qx_infile !== project.qx_infile);
        const qyChanged = this._project && (this._project.qy_infile !== project.qy_infile);

        // Check for Streamflow changes
        const streamflowLocChanged = this._project && (this._project.src_loc_file !== project.src_loc_file);
        const streamflowDynChanged = this._project && (this._project.hydrograph_filename !== project.hydrograph_filename);
        const projectModified = this._project && (project.lastModified !== this._project.lastModified);

        // BUG-9: getProjects() now hands back frozen clones, so keep our own
        // mutable working copy here — MapEditor mutates this._project.demVisible
        // directly (see loadDemIfAvailable) and a frozen reference would throw.
        this._project = structuredClone(project);
        this.updateOutputStatus();

        if (initialInputChanged || projectModified) {
            this.loadInitialInputIfAvailable();
        }

        if (qxChanged || qyChanged || projectModified) {
            this.loadQxQyIfAvailable();
        }

        if (streamflowLocChanged || streamflowDynChanged || projectModified) {
            this.loadStreamflowIfAvailable();
        }

        // Always update config to ensure time/date settings are synced
        console.log('[MapEditor] updateProjectState calling updateProjectConfig');
        this.updateProjectConfig();
    }

    public ensureDemVisible() {
        // 1. Update webview checkbox and layer
        this.postMessage({
            command: 'toggleDem',
            data: { visible: true }
        });

        // 2. Update and persist project state
        if (this._project) {
            this._project.demVisible = true;

            // getProjects() returns frozen deep clones (BUG-9), so build a
            // mutable copy from this._project (the working copy) and persist it.
            const p = structuredClone(this._project);
            p.demVisible = true;
            ProjectManager.instance.updateProject(p);
        }
    }

    private _gifService: GifEncoderService = new GifEncoderService();
    private _currentGifPath: string = '';

    private async _handleMessage(message: any) {
        switch (message.command) {
            case 'alert':
                vscode.window.showErrorMessage(message.text);
                return;
            case 'webviewReady':
                this.loadAllData();
                return;
            case 'updateCoordinates':
                // Relayed from Webview to EventBus
                EventBus.instance.fire('map:updateCoordinates', message.data);
                return;
            case 'updateUtmZone':
                this.loadDemIfAvailable(message.data.zone);
                return;
            case 'triggerLoadAnimation':
                vscode.commands.executeCommand('triforge.loadAnimation');
                return;
            case 'toggleDem':
                EventBus.instance.fire('project:demVisibilityChanged', {
                    projectId: this._project.id,
                    visible: message.data.visible
                });
                if (this._project) {
                    // getProjects() returns frozen deep clones (BUG-9); build a
                    // mutable copy from this._project (the working copy).
                    const p = structuredClone(this._project);
                    p.demVisible = message.data.visible;
                    ProjectManager.instance.updateProject(p);
                }
                break;
            case 'toggleQxQy':
                // Handled client-side for now
                break;
            case 'toggleStreamflow':
                // Can add persist logic if needed
                break;
            case 'triggerGifExport':
                await this._initGifExport(message.data);
                break;
            case 'gifFrameData':
                await this._processGifFrame(message.data);
                break;
            case 'error':
                vscode.window.showErrorMessage(`[Map] ${message.data}`);
                break;
        }
    }

    private async _initGifExport(data: { width: number, height: number, totalFrames: number, delay: number }) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let defaultUri = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri : undefined;
        let projectName = 'animation';

        if (this._project) {
            projectName = this._project.name || path.basename(this._project.path);
            if (this._project.path && fs.existsSync(this._project.path)) {
                try {
                    defaultUri = vscode.Uri.file(path.dirname(this._project.path));
                } catch (e) { }
            }
        }

        const defaultName = projectName + '.gif';

        const fileUri = await vscode.window.showSaveDialog({
            defaultUri: defaultUri ? vscode.Uri.joinPath(defaultUri, defaultName) : undefined,
            filters: { 'GIF Images': ['gif'] },
            saveLabel: 'Export GIF'
        });

        if (fileUri) {
            this._currentGifPath = fileUri.fsPath;

            try {
                this._gifService.start(data.width, data.height, data.delay, this._currentGifPath, data.totalFrames);

                // Request first frame
                this.postMessage({
                    command: 'requestGifFrame',
                    data: { index: 0 }
                });

                vscode.window.showInformationMessage(`Exporting GIF (${data.totalFrames} frames)...`);
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to start GIF export: ${e}`);
            }
        }
    }

    private async _processGifFrame(data: { index: number, pixels: number[] }) {
        try {
            this._gifService.addFrame(data.pixels);

            if (!this._gifService.isFinished()) {
                const progress = this._gifService.getProgress();
                // Request Next
                this.postMessage({
                    command: 'requestGifFrame',
                    data: { index: progress.current }
                });
            } else {
                // Finish
                await this._gifService.finish();
                vscode.window.showInformationMessage(`GIF Exported Successfully: ${this._currentGifPath}`);
            }
        } catch (e) {
            Logger.error(`GIF Encoding Error: ${e}`);
            vscode.window.showErrorMessage("Failed to encode GIF frame.");
            this._gifService.cancel();
        }
    }

    public zoomTo(bounds: any) {
        this.postMessage({ command: 'zoomToExtent', data: bounds });
    }

    private _mapDataManager: MapDataManager = new MapDataManager();

    private postMessage(message: ToWebviewMessage) {
        this._panel.webview.postMessage(message);
    }

    public async loadDemIfAvailable(overrideZone?: string, overrideDatum?: string, force: boolean = false) {
        if (!this._project || !this._project.demPath) {
            Logger.info('[MapEditor] No DEM path in project.');
            return;
        }

        // Cache logic: reuse the cached DEM (no re-parse / no re-post) when nothing
        // that would change the rendered grid has changed. overrideDatum has no
        // default, so an unchanged reveal (no zone/datum override, not forced) and
        // a same-datum reveal both short-circuit here.
        if (
            this._currentDemData &&
            !force &&
            !overrideZone &&
            (!overrideDatum || overrideDatum === this._currentDemData.datum)
        ) {
            Logger.info('[MapEditor] Using cached DEM data.');
            return;
        }

        try {
            const demDir = this._project.demPath;
            const zoneToUse = overrideZone || (this._currentDemData ? this._currentDemData.utmZone : this._project.utmZone) || this._project.utmZone;

            if (!zoneToUse) {
                vscode.window.showErrorMessage("Cannot load DEM: No UTM Zone defined in project.");
                return;
            }

            // Resolve the datum to use: an explicit override, else the previously
            // cached datum, else the project default. Keeps the cached DemData.datum
            // stable so a subsequent no-override reveal short-circuits the cache.
            const datumToUse = overrideDatum || (this._currentDemData ? this._currentDemData.datum : undefined) || this._project.datum || 'WGS84';

            vscode.window.showInformationMessage(`Loading DEM... Zone: ${zoneToUse}, Datum: ${datumToUse}`);
            Logger.info(`[MapEditor] Calling MapDataManager.loadDem with: ${demDir}, ${zoneToUse}, ${datumToUse}`);

            // Use project header if available (critical for binary files which lack internal georeferencing)
            const projectHeader = this._project.utmHeader;
            const demData = await this._mapDataManager.loadDem(demDir, zoneToUse, datumToUse, projectHeader);

            if (demData) {
                this._currentDemData = demData;
                Logger.info(`[MapEditor] DEM Loaded. Min: ${demData.min}, Max: ${demData.max}, Values: ${demData.values.length}x${demData.values[0]?.length}`);

                this.postMessage({
                    command: 'renderDem',
                    data: {
                        header: demData.header,
                        bounds: demData.bounds,
                        min: demData.min,
                        max: demData.max,
                        values: demData.values,
                        noData: demData.header.NODATA_value,
                        utmZone: demData.utmZone,
                        visible: this._project.demVisible !== false
                    }
                });

                this.zoomTo(demData.bounds);
            } else {
                Logger.warn('[MapEditor] MapDataManager returned null for DEM.');
            }
        } catch (error) {
            Logger.error(`[MapEditor] Failed to load DEM: ${error}`);
            vscode.window.showErrorMessage(`Failed to load DEM: ${error}`);
        }
    }

    public async loadStreamflowIfAvailable() {
        console.log('[MapEditor] loadStreamflowIfAvailable called');
        if (!this._project) {
            console.log('[MapEditor] No project, skipping streamflow');
            return;
        }

        // 1. Get Paths
        const locFile = this._project.src_loc_file;
        const hydroFile = this._project.hydrograph_filename;
        console.log(`[MapEditor] Streamflow Config: LocFile='${locFile}', HydroFile='${hydroFile}'`);

        if (!locFile) {
            console.log('[MapEditor] No locFile defined, clearing streamflow');
            this.postMessage({ command: 'clearStreamflow' });
            return;
        }

        // 2. Validate existence
        if (!fs.existsSync(locFile)) {
            const msg = `Streamflow config exists, but file not found: ${locFile}`;
            console.warn(`[MapEditor] ${msg}`);
            return;
        }

        try {
            // 3. Parse Source Locations
            // Format Assumption: "x y" or "x,y". One line per source.
            const locContent = fs.readFileSync(locFile, 'utf8');
            const locLines = locContent.split(/\r?\n/)
                .map(l => l.trim())
                .filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('%'));

            const sources: { x: number, y: number, values: number[], id: string }[] = [];
            const utmZone = this._project.utmZone;
            const datum = this._project.datum || 'WGS84';

            // Pre-parse hydrograph if available
            const hydroData: number[][] = [];
            if (hydroFile && fs.existsSync(hydroFile)) {
                const hydroContent = fs.readFileSync(hydroFile, 'utf8');
                const hydroLines = hydroContent.split(/\r?\n/)
                    .map(l => l.trim())
                    .filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('%'));

                hydroLines.forEach(line => {
                    const parts = line.split(/[,\s]+/).map(Number).filter(n => !isNaN(n));
                    if (parts.length > 0) {
                        hydroData.push(parts);
                    }
                });
            }

            locLines.forEach((line, index) => {
                const parts = line.split(/[,\s]+/).map(Number);

                if (parts.length >= 2) {
                    const utmX = parts[0];
                    const utmY = parts[1];

                    if (isNaN(utmX) || isNaN(utmY)) {
                        return;
                    }

                    // Convert to LatLon
                    const { lat, lng } = UtmConverter.utmToLatLon(utmX, utmY, utmZone, datum);

                    // Get values for this source
                    // hydroData is [time][all_sources]
                    // We need [time] val for this source index.
                    // Assuming column index matches source index.
                    // Also: Is time included in hydrograph file as first column?
                    // If so, source 0 is at column 1.
                    // Without specs, hard to know. Assuming just data columns for now.
                    // OR: If parts.length == num_sources + 1, then col 0 is time.
                    const numSources = locLines.length;
                    const timeValues: number[] = [];

                    hydroData.forEach(row => {
                        // Heuristic: if row length > numSources, maybe first col is time
                        // Let's just take index-th element if available
                        const colIdx = (row.length === numSources + 1) ? index + 1 : index;

                        if (colIdx < row.length) {
                            timeValues.push(row[colIdx]);
                        }
                    });

                    sources.push({
                        x: lat,
                        y: lng,
                        values: timeValues,
                        id: `Source ${index + 1}`
                    });
                }
            });

            if (sources.length > 0) {
                this.postMessage({
                    command: 'renderStreamflow',
                    data: sources
                });
                console.log(`[MapEditor] Loaded ${sources.length} Streamflow sources.`);
            } else {
                console.warn('[MapEditor] No sources found.');
            }

        } catch (e) {
            console.error('[MapEditor] Error loading streamflow data:', e);
            // vscode.window.showErrorMessage(`Failed to load streamflow data: ${e}`);
        }
    }

    public async loadInitialInputIfAvailable() {
        if (!this._project || !this._project.initialInputPath) {
            this.postMessage({ command: 'clearInitialInput' });
            return;
        }

        // Require DEM/Project Header to parse
        if (!this._project.utmHeader) {
            return;
        }

        try {
            const filePath = this._project.initialInputPath;
            if (!fs.existsSync(filePath)) return;

            const header = this._project.utmHeader;
            const utmZone = this._project.utmZone;
            const datum = this._project.datum || 'WGS84';

            // Helper to ensure numeric
            const safeHeader = {
                ncols: Number(header.ncols),
                nrows: Number(header.nrows),
                xllcorner: Number(header.xllcorner),
                yllcorner: Number(header.yllcorner),
                cellsize: Number(header.cellsize),
                NODATA_value: Number(header.NODATA_value)
            };

            const data = await AsciiParser.parseRawWithHeader(filePath, safeHeader, utmZone, datum);

            this.postMessage({
                command: 'renderInitialInput',
                data: {
                    header: data.header,
                    bounds: data.bounds,
                    min: data.min,
                    max: data.max,
                    values: data.values,
                    noData: data.header.NODATA_value,
                    visible: true // Default visible when loaded
                }
            });

        } catch (e) {
            vscode.window.showErrorMessage(`Failed to load Initial Input: ${e}`);
        }
    }


    public async loadQxQyIfAvailable() {
        if (!this._project || !this._project.qx_infile || !this._project.qy_infile) {
            this.postMessage({ command: 'clearQxQy' });
            return;
        }

        // Require DEM/Project Header to parse
        if (!this._project.utmHeader) {
            return;
        }

        try {
            const qxPath = this._project.qx_infile;
            const qyPath = this._project.qy_infile;

            if (!fs.existsSync(qxPath) || !fs.existsSync(qyPath)) return;

            const header = this._project.utmHeader;
            const utmZone = this._project.utmZone;
            const datum = this._project.datum || 'WGS84';

            // Helper to ensure numeric
            const safeHeader = {
                ncols: Number(header.ncols),
                nrows: Number(header.nrows),
                xllcorner: Number(header.xllcorner),
                yllcorner: Number(header.yllcorner),
                cellsize: Number(header.cellsize),
                NODATA_value: Number(header.NODATA_value)
            };

            const qxData = await AsciiParser.parseRawWithHeader(qxPath, safeHeader, utmZone, datum);
            const qyData = await AsciiParser.parseRawWithHeader(qyPath, safeHeader, utmZone, datum);

            this.postMessage({
                command: 'renderQxQy',
                data: {
                    qx: qxData.values,
                    qy: qyData.values,
                    bounds: qxData.bounds,
                    noData: qxData.header.NODATA_value,
                    visible: true
                }
            });

        } catch (e) {
            vscode.window.showErrorMessage(`Failed to load QX/QY Inputs: ${e}`);
        }
    }

    public async startAnimationLoad() {
        this.postMessage({
            command: 'startAnimationLoad'
        });
    }

    public async appendFrame(frame: Float32Array, name: string, index: number, total: number) {
        this.postMessage({
            command: 'appendAnimationFrame',
            data: {
                frame: frame,
                name: name,
                index: index,
                totalFrames: total
            }
        });
    }

    public async endAnimationLoad() {
        this.postMessage({
            command: 'endAnimationLoad'
        });
    }




    public clearInitialInput() {
        this.postMessage({ command: 'clearInitialInput' });
    }

    public clearQxQy() {
        this.postMessage({ command: 'clearQxQy' });
    }

    public clearStreamflow() {
        this.postMessage({ command: 'clearStreamflow' });
    }

    public static close(projectId: string) {
        const panel = MapEditor.currentPanels.get(projectId);
        if (panel) {
            panel.dispose();
        }
    }

    public dispose() {
        if (this._project && this._project.id) {
            MapEditor.currentPanels.delete(this._project.id);
        }

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _getHtmlForWebview() {
        // Local path to main script run in the webview
        const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'map.bundle.js');
        const scriptUri = this._panel.webview.asWebviewUri(scriptPathOnDisk);

        // Local path to css styles
        const stylePathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'media', 'map.css');
        const styleUri = this._panel.webview.asWebviewUri(stylePathOnDisk);

        // SEC-4: Leaflet is bundled locally under media/leaflet (no unpkg CDN).
        const leafletJsUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'leaflet', 'leaflet.js'));
        const leafletCssUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'leaflet', 'leaflet.css'));

        // Use a nonce to whitelist which scripts can be run
        const nonce = getNonce();

        return getMapEditorHtml(this._panel.webview.cspSource, scriptUri.toString(), styleUri.toString(), nonce, leafletJsUri.toString(), leafletCssUri.toString());
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
