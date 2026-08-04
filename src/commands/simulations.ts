import * as vscode from 'vscode';
import * as path from 'path';
import { InputGeneratorEditor } from '../panels/InputGeneratorEditor';
import { ProjectManager } from '../state/ProjectManager';
import { DemParser } from '../parsers/DemParser';
import { EventBus } from '../state/EventBus';
import { MapEditor } from '../panels/MapEditor';
import { SimulationsView, RecursiveFileNode, DemNode, InitHNode, InitQxQyNode, StreamflowNode } from '../views/SimulationsView';
import { PropertiesView } from '../views/PropertiesView';

export function registerSimulationsCommands(context: vscode.ExtensionContext, simulationsView: SimulationsView, simulationsTreeView: vscode.TreeView<RecursiveFileNode>, propertiesView: PropertiesView) {

    const updatePropertiesSelection = async (selection: readonly RecursiveFileNode[]) => {
        if (!selection || selection.length === 0) {
            EventBus.instance.fire('properties:update', []);
            return;
        }
        EventBus.instance.fire('properties:update', [...selection]);
    };

    // Helper to get unique key for state
    const getStateKey = (node: any): string => {
        if (node.category) return `category:${node.category}`;
        return node.fullPath;
    };

    const filterFolderDisposable = vscode.commands.registerCommand('triforge.simulations.filter', async (node: any) => {
        if (!node) return;

        const stateKey = getStateKey(node);
        const currentFilter = simulationsView.getFolderState(stateKey).filter || '';

        // Use Properties View Input Box
        const filter = await new Promise<string | undefined>((resolve) => {
            propertiesView.showFilterInput(currentFilter, resolve);
        });

        // Allow empty string to clear
        if (filter !== undefined) {
            const duckNode = node.category ? { fullPath: `category:${node.category}` } : node;

            simulationsView.setFolderFilter(duckNode, filter);
            simulationsView.refresh(node); // Ensure view updates

            // Update properties if the filtered node is selected
            //updatePropertiesSelection(simulationsTreeView.selection as unknown as RecursiveFileNode[]);
            updatePropertiesSelection(simulationsTreeView.selection as unknown as RecursiveFileNode[]);
        }
    });

    const sortFolderDisposable = vscode.commands.registerCommand('triforge.simulations.sort', async (node: any) => {
        if (!node) return;

        // Use Modal Dialog with Buttons
        const selection = await vscode.window.showInformationMessage(
            'Select Sort Order',
            { modal: true },
            'Name (A-Z)',
            'Name (Z-A)',
            'Date (Newest)',
            'Date (Oldest)',
            'Type (A-Z)',
            'Type (Z-A)'
        );

        if (selection) {
            let field: 'name' | 'type' | 'modified' = 'name';
            let order: 'asc' | 'desc' = 'asc';

            switch (selection) {
                case 'Name (A-Z)': field = 'name'; order = 'asc'; break;
                case 'Name (Z-A)': field = 'name'; order = 'desc'; break;
                case 'Date (Newest)': field = 'modified'; order = 'desc'; break;
                case 'Date (Oldest)': field = 'modified'; order = 'asc'; break;
                case 'Type (A-Z)': field = 'type'; order = 'asc'; break;
                case 'Type (Z-A)': field = 'type'; order = 'desc'; break;
            }

            const duckNode = node.category ? { fullPath: `category:${node.category}` } : node;
            simulationsView.setFolderSort(duckNode, field, order);
            simulationsView.refresh(node);
            updatePropertiesSelection(simulationsTreeView.selection as unknown as RecursiveFileNode[]);
        }
    });

    // Pseudo-double-click logic state
    let lastClickTime = 0;
    let lastClickedPath = '';

    const clickDisposable = vscode.commands.registerCommand('triforge.simulations.click', async (node: RecursiveFileNode) => {
        const now = Date.now();
        if (node.fullPath === lastClickedPath && (now - lastClickTime) < 500) {
            // Double Click Detected -> Open File
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(node.fullPath));
            lastClickTime = 0; // Reset
            lastClickedPath = '';
        } else {
            // Single Click -> Update State (Selection is handled by TreeView automatically)
            lastClickTime = now;
            lastClickedPath = node.fullPath;
        }
    });

    const addInputDisposable = vscode.commands.registerCommand('triforge.addInput', async () => {
        // Forward to the new Input Generator Editor
        InputGeneratorEditor.createOrShow(context.extensionUri, 'static');
    });

    const generateInputDisposable = vscode.commands.registerCommand('triforge.generateInput', () => {
        InputGeneratorEditor.createOrShow(context.extensionUri, 'static');
    });

    const removeInputDisposable = vscode.commands.registerCommand('triforge.removeInput', async (node: any) => {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject || !node) return;

        let inputType = '';
        if (node instanceof DemNode) inputType = 'DEM';
        else if (node instanceof InitHNode) inputType = 'Water Depth';
        else if (node instanceof InitQxQyNode) inputType = 'Water Discharge';
        else if (node instanceof StreamflowNode) inputType = 'Streamflow';
        else return;

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to remove ${inputType} from project '${activeProject.name}'?`,
            { modal: true },
            'Remove'
        );

        if (confirm === 'Remove') {
            const updatedProject = { ...activeProject };

            if (node instanceof DemNode) {
                updatedProject.demPath = undefined;
                // Manual clear for DEM to match existing pattern
                const mapEditor = MapEditor.currentPanels.get(activeProject.id);
                if (mapEditor) mapEditor.clearDem();
            } else if (node instanceof InitHNode) {
                updatedProject.initialInputPath = undefined;
                const mapEditor = MapEditor.currentPanels.get(activeProject.id);
                if (mapEditor) mapEditor.clearInitialInput();
            } else if (node instanceof InitQxQyNode) {
                updatedProject.qx_infile = undefined;
                updatedProject.qy_infile = undefined;
                const mapEditor = MapEditor.currentPanels.get(activeProject.id);
                if (mapEditor) mapEditor.clearQxQy();
            } else if (node instanceof StreamflowNode) {
                updatedProject.num_sources = undefined;
                updatedProject.src_loc_file = undefined;
                updatedProject.hydrograph_filename = undefined;
                const mapEditor = MapEditor.currentPanels.get(activeProject.id);
                if (mapEditor) mapEditor.clearStreamflow();
            }

            ProjectManager.instance.updateProject(updatedProject);
            vscode.window.showInformationMessage(`${inputType} removed.`);
        }
    });

    const openInputFolderDisposable = vscode.commands.registerCommand('triforge.openInputFolder', async () => {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject) {
            vscode.window.showErrorMessage("No active project selected.");
            return;
        }

        const options: vscode.OpenDialogOptions = {
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: 'Select DEM File',
            filters: {
                'DEM Files': ['dem', 'asc', 'tif']
            }
        };

        const uri = await vscode.window.showOpenDialog(options);
        if (uri && uri[0]) {
            const filePath = uri[0].fsPath;
            try {
                const header = await DemParser.parseHeaderOnly(filePath);

                // Validation: Check against existing Project UTM Header
                if (activeProject.utmHeader) {
                    const func = activeProject.utmHeader;
                    const isMismatch =
                        header.ncols !== func.ncols ||
                        header.nrows !== func.nrows ||
                        Math.abs(header.xllcorner - func.xllcorner) > 0.001 ||
                        Math.abs(header.yllcorner - func.yllcorner) > 0.001 ||
                        Math.abs(header.cellsize - func.cellsize) > 0.001;

                    if (isMismatch) {
                        const msg = `DEM Header mismatch!\n` +
                            `Expected: ${func.ncols}x${func.nrows}, Cell: ${func.cellsize}\n` +
                            `Got: ${header.ncols}x${header.nrows}, Cell: ${header.cellsize}\n` +
                            `Corners do not match or grid size is different.`;
                        vscode.window.showWarningMessage(msg, { modal: true });
                        return; // Stop loading
                    }
                }

                // Update Project
                const updatedProject = { ...activeProject };
                updatedProject.demPath = path.dirname(filePath);
                // If it matched (or didn't exist), we can just set/update it.
                // If it didn't exist, we set it now.
                updatedProject.utmHeader = {
                    ncols: header.ncols,
                    nrows: header.nrows,
                    xllcorner: header.xllcorner,
                    yllcorner: header.yllcorner,
                    cellsize: header.cellsize,
                    NODATA_value: header.NODATA_value
                };

                ProjectManager.instance.updateProject(updatedProject);

                // Trigger Map Update
                const mapEditor = MapEditor.currentPanels.get(updatedProject.id);
                if (mapEditor) {
                    mapEditor.updateProjectState(updatedProject);
                    mapEditor.loadDemIfAvailable(undefined, undefined, true);
                }

                vscode.window.showInformationMessage(`DEM loaded: ${path.basename(filePath)}`);

            } catch (err) {
                vscode.window.showErrorMessage(`Failed to parse DEM: ${err}`);
            }
        }
    });

    const deleteDemDisposable = vscode.commands.registerCommand('triforge.deleteDem', async () => {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject) return;

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to remove the DEM from project '${activeProject.name}'?`,
            { modal: true },
            'Delete'
        );

        if (confirm === 'Delete') {
            const updatedProject = { ...activeProject };
            updatedProject.demPath = undefined;
            // NOTE: We keep utmHeader as requested

            ProjectManager.instance.updateProject(updatedProject);

            // Clear map rendering
            const mapEditor = MapEditor.currentPanels.get(activeProject.id);
            if (mapEditor) {
                mapEditor.clearDem();
            }

            vscode.window.showInformationMessage('DEM removed from project.');
        }
    });

    // Helper for categorization. VIEW-2: read the first bytes of a `.out` file
    // asynchronously (off the host thread) instead of openSync/readSync.
    const categorize = async (filePath: string): Promise<'geotiff' | 'binary' | 'ascii' | null> => {
        const ext = path.extname(filePath).toLowerCase();

        // Strict Geotiff
        if (ext === '.vrt') {
            return 'geotiff';
        }

        // Strict Binary/Ascii (.out only, plus smart detection)
        if (ext === '.out') {
            const fsp = (require('fs') as typeof import('fs')).promises;
            let handle: import('fs').promises.FileHandle | undefined;
            try {
                handle = await fsp.open(filePath, 'r');
                const buffer = new Uint8Array(1024);
                const { bytesRead } = await handle.read(buffer, 0, 1024, 0);

                // If contains null byte, assume binary
                for (let i = 0; i < bytesRead; i++) {
                    if (buffer[i] === 0) return 'binary';
                }
                return 'ascii';
            } catch (e) {
                return 'binary'; // default fallback
            } finally {
                await handle?.close().catch(() => { });
            }
        }

        return null;
    };

    const addToOutput = (project: any, type: 'geotiff' | 'binary' | 'ascii', filePath: string) => {
        if (!project.outputs) project.outputs = { geotiff: [], binary: [], ascii: [] };
        if (!project.outputs[type]) project.outputs[type] = [];

        const list = project.outputs[type];
        if (!list.includes(filePath)) {
            list.push(filePath);
        }
    };

    const addOutputDisposable = vscode.commands.registerCommand('triforge.addOutput', async () => {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject) return;

        const uris = await vscode.window.showOpenDialog({
            defaultUri: (activeProject.outputs && activeProject.outputs.output_directory) ? vscode.Uri.file(activeProject.outputs.output_directory) : undefined,
            canSelectFiles: true,
            canSelectFolders: true, // Now fully supported recursively
            canSelectMany: true,
            openLabel: 'Select Files or Folders',
            filters: {
                'TRITON Output': ['vrt', 'out']
            }
        });

        if (!uris || uris.length === 0) return;

        const fs = require('fs') as typeof import('fs');
        const updatedProject = { ...activeProject };

        // VIEW-2: one shared async walker — recurse via fs.promises.readdir
        // ({ withFileTypes: true }) so the recursive output collection never
        // blocks the extension-host thread (no readdirSync/statSync per entry).
        const collectFiles = async (dir: string, fileList: string[]): Promise<void> => {
            let items: import('fs').Dirent[];
            try {
                items = await fs.promises.readdir(dir, { withFileTypes: true });
            } catch (e) {
                console.warn(`Skipping directory ${dir}:`, e);
                return;
            }
            for (const item of items) {
                const fullPath = path.join(dir, item.name);
                try {
                    if (item.isDirectory()) {
                        await collectFiles(fullPath, fileList);
                    } else if (item.isFile()) {
                        // Pre-filter by extension to avoid unnecessary checks later
                        const ext = path.extname(fullPath).toLowerCase();
                        if (ext === '.vrt' || ext === '.out') {
                            fileList.push(fullPath);
                        }
                    }
                } catch (ign) { }
            }
        };

        const filesToProcess: string[] = [];

        for (const uri of uris) {
            const p = uri.fsPath;
            try {
                const stat = await fs.promises.stat(p);
                if (stat.isDirectory()) {
                    await collectFiles(p, filesToProcess);
                } else if (stat.isFile()) {
                    filesToProcess.push(p);
                }
            } catch (e) {
                console.error(`Error processing path ${p}:`, e);
            }
        }

        let changeCount = 0;
        for (const filePath of filesToProcess) {
            try {
                const type = await categorize(filePath);
                if (type) {
                    addToOutput(updatedProject, type, filePath);
                    changeCount++;
                }
            } catch (e) { }
        }

        if (changeCount > 0) {
            ProjectManager.instance.updateProject(updatedProject);
            vscode.window.showInformationMessage(`Added ${changeCount} output files.`);
        } else {
            vscode.window.showInformationMessage('No compatible output files found.');
        }
    });

    const addOutputToCategoryDisposable = vscode.commands.registerCommand('triforge.addOutputToCategory', async (node: any) => {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject || !node || !node.category) return;

        const category = node.category.toLowerCase() as 'geotiff' | 'binary' | 'ascii';
        const filters: { [name: string]: string[] } = {};

        if (category === 'geotiff') filters['Geotiff'] = ['vrt'];
        else filters[node.category] = ['out'];

        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false, // User said "select data files", implying files primarily, but let's stick to files for specific category add
            canSelectMany: true,
            openLabel: `Add to ${node.category}`,
            filters: filters
        });

        if (!uris || uris.length === 0) return;

        const updatedProject = { ...activeProject };
        // Ensure structure exists
        if (!updatedProject.outputs) updatedProject.outputs = {};
        if (!updatedProject.outputs[category]) updatedProject.outputs[category] = [];

        uris.forEach(uri => {
            const p = uri.fsPath;
            if (updatedProject.outputs && updatedProject.outputs[category]) {
                if (!updatedProject.outputs[category]!.includes(p)) {
                    updatedProject.outputs[category]!.push(p);
                }
            }
        });

        ProjectManager.instance.updateProject(updatedProject);
    });

    const removeOutputCategoryDisposable = vscode.commands.registerCommand('triforge.removeOutputCategory', async (node: any) => {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject || !node || !node.category) return;

        const answer = await vscode.window.showWarningMessage(
            `Are you sure you want to remove all ${node.category} outputs from the project?`,
            { modal: true },
            'Remove'
        );

        if (answer === 'Remove') {
            const updatedProject = { ...activeProject };
            const category = node.category.toLowerCase() as 'geotiff' | 'binary' | 'ascii';

            if (updatedProject.outputs && updatedProject.outputs[category]) {
                updatedProject.outputs[category] = [];
                ProjectManager.instance.updateProject(updatedProject);
            }
        }
    });

    const removeOutputItemDisposable = vscode.commands.registerCommand('triforge.removeOutputItem', async (node: RecursiveFileNode, selectedNodes?: RecursiveFileNode[]) => {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject || (!node && (!selectedNodes || selectedNodes.length === 0))) return;

        // If multiple nodes selected, use them. Otherwise use the single node.
        const nodesToRemove = (selectedNodes && selectedNodes.length > 0) ? selectedNodes : [node];

        if (nodesToRemove.length === 0) return;

        const confirmMessage = nodesToRemove.length === 1
            ? `Remove '${path.basename(nodesToRemove[0].fullPath)}' from outputs?`
            : `Remove ${nodesToRemove.length} items from outputs?`;

        const confirm = await vscode.window.showWarningMessage(
            confirmMessage,
            { modal: true },
            'Remove'
        );

        if (confirm === 'Remove') {
            const updatedProject = { ...activeProject };
            // Ensure outputs object exists
            if (!updatedProject.outputs) updatedProject.outputs = {};
            const outputs = updatedProject.outputs;

            let changed = false;

            for (const n of nodesToRemove) {
                const pathToRemove = n.fullPath;

                // Check each category
                if (outputs.geotiff?.includes(pathToRemove)) {
                    outputs.geotiff = outputs.geotiff.filter(p => p !== pathToRemove);
                    changed = true;
                }
                if (outputs.binary?.includes(pathToRemove)) {
                    outputs.binary = outputs.binary.filter(p => p !== pathToRemove);
                    changed = true;
                }
                if (outputs.ascii?.includes(pathToRemove)) {
                    outputs.ascii = outputs.ascii.filter(p => p !== pathToRemove);
                    changed = true;
                }
            }

            if (changed) {
                ProjectManager.instance.updateProject(updatedProject);
            }
        }
    });

    context.subscriptions.push(filterFolderDisposable, sortFolderDisposable, clickDisposable, addInputDisposable, generateInputDisposable, removeInputDisposable, openInputFolderDisposable, deleteDemDisposable, addOutputDisposable, addOutputToCategoryDisposable, removeOutputCategoryDisposable, removeOutputItemDisposable);
}
