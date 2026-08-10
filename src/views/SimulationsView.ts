import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ProjectManager } from '../state/ProjectManager';
import { EventBus } from '../state/EventBus';
import { DemParser } from '../parsers/DemParser';


import { Inspectable, PropertyItem } from './Inspectable';

// Node Interfaces
export interface ExplorerNode extends Inspectable {
    getTreeItem(): vscode.TreeItem | Promise<vscode.TreeItem>;
    getChildren(): Promise<ExplorerNode[]>;
}

interface FolderState {
    sortBy: 'name' | 'type' | 'modified';
    sortOrder: 'asc' | 'desc';
    filter?: string;
}

export class SimulationsView implements vscode.TreeDataProvider<ExplorerNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<ExplorerNode | undefined | void> = new vscode.EventEmitter<ExplorerNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ExplorerNode | undefined | void> = this._onDidChangeTreeData.event;

    // Selection tracking for robust access from webview-triggered commands
    public static currentSelection: readonly ExplorerNode[] = [];

    // Persist folder state by absolute path
    private _folderStates: Map<string, FolderState> = new Map();

    public static extensionUri: vscode.Uri | undefined;

    constructor(disposables?: vscode.Disposable[]) {
        // STATE-1: capture the EventBus subscriptions into the provided
        // disposables array (context.subscriptions) so the listeners do not
        // outlive the extension and fire refresh() on a dead provider.
        EventBus.instance.on('project:activeChanged', () => {
            SimulationsView.currentSelection = [];
            this.refresh();
        }, undefined, disposables);
        EventBus.instance.on('project:listChanged', () => this.refresh(), undefined, disposables);
    }

    refresh(element?: ExplorerNode): void {
        this._onDidChangeTreeData.fire(element);
    }

    getTreeItem(element: ExplorerNode): vscode.TreeItem | Promise<vscode.TreeItem> {
        return element.getTreeItem();
    }

    async getChildren(element?: ExplorerNode): Promise<ExplorerNode[]> {
        const activeProject = ProjectManager.instance.activeProject;

        if (!element) {
            if (!activeProject) {
                return [new MessageNode("No Active Project")];
            }
            // Root: Input Group + Output Group
            const nodes: ExplorerNode[] = [];
            nodes.push(new InputsGroupNode());
            nodes.push(new ComputationGroupNode());
            nodes.push(new OutputGroupNode(this));

            return nodes;
        }

        return element.getChildren();
    }

    // Required for TreeView.reveal() / expansion-state restoration to work.
    // Only RecursiveFileNodes form a deep, reveal-able hierarchy; their parent
    // is the directory node at the parent path.
    getParent(element: ExplorerNode): ExplorerNode | undefined {
        if (element instanceof RecursiveFileNode) {
            const parentPath = path.dirname(element.fullPath);
            if (parentPath && parentPath !== element.fullPath) {
                return new RecursiveFileNode(parentPath, true, this);
            }
        }
        return undefined;
    }

    // Public API to update state from commands
    public setFolderSort(node: RecursiveFileNode, sortBy: 'name' | 'type' | 'modified', sortOrder: 'asc' | 'desc') {
        const currentCheck = this._folderStates.get(node.fullPath) || { sortBy: 'name', sortOrder: 'asc' };
        currentCheck.sortBy = sortBy;
        currentCheck.sortOrder = sortOrder;
        this._folderStates.set(node.fullPath, currentCheck);
        this.refresh(node); // Refresh specific node
    }

    public setFolderFilter(node: RecursiveFileNode, filter: string | undefined) {
        const currentCheck = this._folderStates.get(node.fullPath) || { sortBy: 'name', sortOrder: 'asc' };
        currentCheck.filter = filter;
        this._folderStates.set(node.fullPath, currentCheck);
        this.refresh(node);
    }

    public getFolderState(path: string): FolderState {
        return this._folderStates.get(path) || { sortBy: 'name', sortOrder: 'asc' };
    }
}

// Node Implementations
class MessageNode implements ExplorerNode {
    constructor(private msg: string) { }
    getTreeItem() {
        const item = new vscode.TreeItem(this.msg, vscode.TreeItemCollapsibleState.None);
        item.contextValue = 'info';
        return item;
    }
    getLabel(): string { return this.msg; }
    async getChildren() { return []; }
    async getProperties(): Promise<PropertyItem[]> { return []; }
}

class InputsGroupNode implements ExplorerNode {
    getTreeItem() {
        const item = new vscode.TreeItem("Inputs", vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon('inbox');
        item.contextValue = 'inputsGroup'; // fresh id, no menu bindings (distinct from the dead 'inputGroup')
        const activeProject = ProjectManager.instance.activeProject;
        if (activeProject) {
            item.id = `inputs_${activeProject.id}`;
        }
        return item;
    }

    getLabel(): string { return "Inputs"; }

    async getChildren() {
        return [
            new StaticInputGroupNode(),
            new DynamicInputsNode()
        ];
    }

    async getProperties(): Promise<PropertyItem[]> {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject) return [];
        return [
            { key: 'Group', value: 'Inputs' },
            { key: 'Project', value: path.basename(activeProject.path) }
        ];
    }
}

class StaticInputGroupNode implements ExplorerNode {
    async getTreeItem() {
        const item = new vscode.TreeItem("Static Inputs", vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon('file-submodule'); // Use a distinct icon, not a folder
        item.contextValue = 'staticInputNode'; // Remove 'inputGroup' context to remove plus icon
        item.command = {
            command: 'triforge.generateInput',
            title: 'Open Static Input Generator',
            arguments: []
        };
        const activeProject = ProjectManager.instance.activeProject;
        if (activeProject) {
            item.id = `static_input_${activeProject.id}`;
        }
        return item;
    }

    getLabel(): string { return "Static Inputs"; }

    async getChildren() {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject) return [];

        const nodes: ExplorerNode[] = [];

        // DEM
        if (activeProject.demPath) {
            nodes.push(new DemNode(activeProject.demPath));
        }

        // Water Depth (Init H)
        if (activeProject.initialInputPath) {
            nodes.push(new InitHNode(activeProject.initialInputPath));
        }

        // Water Discharge (QX QY)
        // Check if both exist
        if (activeProject.qx_infile && activeProject.qy_infile) {
            nodes.push(new InitQxQyNode(activeProject.qx_infile, activeProject.qy_infile));
        }

        return nodes;
    }

    async getProperties(): Promise<PropertyItem[]> {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject) return [];
        return [
            { key: 'Group', value: 'Input' },
            { key: 'Project', value: path.basename(activeProject.path) }
        ];
    }
}


class ComputationGroupNode implements ExplorerNode {
    constructor() { }

    getTreeItem() {
        const item = new vscode.TreeItem("Computation", vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon('server-process');
        item.contextValue = 'groupRecursive';
        const activeProject = ProjectManager.instance.activeProject;
        if (activeProject) {
            item.id = `computation_${activeProject.id}`;
        }
        return item;
    }

    getLabel(): string { return "Computation"; }

    async getChildren() {
        return [
            new SetupNode(),
            new ExecutionNode()
        ];
    }

    async getProperties(): Promise<PropertyItem[]> {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject) return [];
        const compPath = path.join(activeProject.path, 'computation');
        return [
            { key: 'Group', value: 'Computation' },
            { key: 'Path', value: compPath }
        ];
    }
}

class SetupNode implements ExplorerNode {
    getTreeItem() {
        const item = new vscode.TreeItem("Setup", vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("settings-gear");
        item.contextValue = 'setupNode';
        item.command = {
            command: 'triforge.openComputationSetup',
            title: 'Open Computation Setup',
            arguments: []
        };
        return item;
    }
    getLabel(): string { return "Setup"; }
    async getChildren() { return []; }
    async getProperties() { return []; }
}

class DynamicInputsNode implements ExplorerNode {
    getTreeItem() {
        const item = new vscode.TreeItem("Dynamic Inputs", vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon("pulse");
        item.contextValue = 'dynamicInputsNode';
        item.command = {
            command: 'triforge.openDynamicInputGenerator',
            title: 'Open Dynamic Input Generator',
            arguments: []
        };
        return item;
    }
    getLabel(): string { return "Dynamic Inputs"; }
    async getChildren() {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject) return [];
        const nodes: ExplorerNode[] = [];

        // Streamflow
        if (activeProject.num_sources || activeProject.src_loc_file || activeProject.hydrograph_filename) {
            nodes.push(new StreamflowNode(activeProject));
        }

        return nodes;
    }
    async getProperties() { return []; }
}

export class StreamflowNode implements ExplorerNode {
    constructor(public readonly project: any) { }

    getTreeItem() {
        const item = new vscode.TreeItem("Streamflow", vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("graph");
        item.contextValue = 'streamflowNode';
        item.command = {
            command: 'triforge.openMap',
            title: 'Open Map (Streamflow)',
            arguments: [ProjectManager.instance.activeProject, { layer: 'streamflow' }]
        };
        return item;
    }

    getLabel(): string { return "Streamflow"; }

    async getChildren() { return []; }

    async getProperties(): Promise<PropertyItem[]> {
        const p = this.project;
        return [
            { key: 'Type', value: 'Streamflow Hydrograph' },
            { key: 'Num Sources', value: p.num_sources ? p.num_sources.toString() : 'N/A' },
            { key: 'Location File', value: p.src_loc_file ? path.basename(p.src_loc_file) : 'N/A' },
            { key: 'Dynamic File', value: p.hydrograph_filename ? path.basename(p.hydrograph_filename) : 'N/A' }
        ];
    }
}

class ExecutionNode implements ExplorerNode {
    getTreeItem() {
        const item = new vscode.TreeItem("Execution", vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("run");
        item.contextValue = 'executionNode';
        item.command = {
            command: 'triforge.openExecutionSetup',
            title: 'Open Execution Setup',
            arguments: []
        };
        return item;
    }
    getLabel(): string { return "Execution"; }
    async getChildren() { return []; }
    async getProperties() { return []; }
}

class OutputGroupNode implements ExplorerNode {
    constructor(private provider: SimulationsView) { }

    getTreeItem() {
        const item = new vscode.TreeItem("Output", vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = vscode.ThemeIcon.Folder;
        item.contextValue = 'outputGroup';
        const activeProject = ProjectManager.instance.activeProject;
        if (activeProject) {
            item.id = `output_${activeProject.id}`;
        }
        return item;
    }

    getLabel(): string { return "Output"; }

    async getChildren() {
        const activeProject = ProjectManager.instance.activeProject;
        if (!activeProject) return [new MessageNode("No active project")];

        const outputs = activeProject.outputs || {};
        const nodes: ExplorerNode[] = [];

        if (outputs.geotiff && outputs.geotiff.length > 0) {
            nodes.push(new OutputCategoryNode('Geotiff', outputs.geotiff, this.provider));
        }
        if (outputs.binary && outputs.binary.length > 0) {
            nodes.push(new OutputCategoryNode('Binary', outputs.binary, this.provider));
        }
        if (outputs.ascii && outputs.ascii.length > 0) {
            nodes.push(new OutputCategoryNode('Ascii', outputs.ascii, this.provider));
        }

        if (nodes.length === 0) {
            return [new MessageNode("No outputs configured")];
        }

        return nodes;
    }

    async getProperties(): Promise<PropertyItem[]> {
        return [
            { key: 'Group', value: 'Output' }
        ];
    }
}

class OutputCategoryNode implements ExplorerNode {
    constructor(
        public readonly category: 'Geotiff' | 'Binary' | 'Ascii',
        public readonly paths: string[],
        private provider: SimulationsView
    ) { }

    getTreeItem() {
        // [DEBUG] Log context value creation
        const item = new vscode.TreeItem(this.category, vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = 'outputCategory';
        // Icons?

        // Show active filter in description based on state
        const stateKey = `category:${this.category}`;
        const state = this.provider.getFolderState(stateKey);
        if (state.filter) {
            item.description = `(Filter: ${state.filter})`;
        }

        return item;
    }

    getLabel(): string { return this.category; }

    async getChildren() {
        // Use a unique key for the category state
        const stateKey = `category:${this.category}`;
        const state = this.provider.getFolderState(stateKey);

        let filteredPaths = [...this.paths];

        // Filter
        if (state.filter) {
            const filter = state.filter.toLowerCase();
            if (filter.includes('*')) {
                const regex = new RegExp('^' + filter.split('*').map(s => escapeRegExp(s)).join('.*') + '$', 'i');
                filteredPaths = filteredPaths.filter(p => regex.test(path.basename(p).toLowerCase()));
            } else {
                filteredPaths = filteredPaths.filter(p => path.basename(p).toLowerCase().includes(filter));
            }
        }

        // VIEW-2: when sorting by modified time, PRE-COMPUTE each path's mtime ONCE
        // (async stat, off the host thread) before sorting — never statSync twice
        // per comparison inside Array.sort.
        const mtimes = new Map<string, number>();
        if (state.sortBy === 'modified') {
            await Promise.all(filteredPaths.map(async p => {
                try {
                    const s = await fs.promises.stat(p);
                    mtimes.set(p, s.mtimeMs);
                } catch {
                    mtimes.set(p, 0);
                }
            }));
        }

        // Sort
        filteredPaths.sort((a, b) => {
            const nameA = path.basename(a);
            const nameB = path.basename(b);

            let comparison = 0;

            if (state.sortBy === 'name') {
                comparison = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
            } else if (state.sortBy === 'type') {
                const extA = path.extname(nameA);
                const extB = path.extname(nameB);
                comparison = extA.localeCompare(extB);
            } else if (state.sortBy === 'modified') {
                comparison = (mtimes.get(a) ?? 0) - (mtimes.get(b) ?? 0);
            } else {
                // Default natural sort
                comparison = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
            }

            return state.sortOrder === 'asc' ? comparison : -comparison;
        });

        // VIEW-2: resolve folder-vs-file kinds asynchronously (off the host thread)
        // rather than a synchronous existsSync + statSync per path.
        return await Promise.all(filteredPaths.map(async p => {
            let isDir = false;
            try {
                const s = await fs.promises.stat(p);
                isDir = s.isDirectory();
            } catch (e) { }
            return new RecursiveFileNode(p, isDir, this.provider, 'outputConfigItem');
        }));
    }

    async getProperties(): Promise<PropertyItem[]> {
        return [
            { key: 'Category', value: this.category },
            { key: 'Items', value: `${this.paths.length}` }
        ];
    }
}

export class RecursiveFileNode implements ExplorerNode {
    constructor(
        public readonly fullPath: string,
        public readonly isDirectory: boolean,
        private readonly provider: SimulationsView,
        private readonly contextValueOverride?: string
    ) { }

    getTreeItem() {
        const name = path.basename(this.fullPath);
        const item = new vscode.TreeItem(name, this.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

        // Stable, collision-free identity: the node's absolute path. Without it
        // VS Code falls back to label-based identity, which loses folder
        // expansion across refreshes and collides duplicate basenames.
        item.id = this.fullPath;

        if (this.isDirectory) {
            item.iconPath = vscode.ThemeIcon.Folder;
            const ctx = this.contextValueOverride || 'folderRecursive';
            item.contextValue = ctx;

            // Add description for active filter/sort?
            const state = this.provider.getFolderState(this.fullPath);
            const infos: string[] = [];
            if (state.filter) infos.push(`Filter: ${state.filter}`);
            if (state.sortBy !== 'name') infos.push(`Sort: ${state.sortBy}`);
            if (infos.length > 0) {
                item.description = infos.join(', ');
            }

        } else {
            item.iconPath = vscode.ThemeIcon.File;
            const ext = path.extname(this.fullPath).toLowerCase();
            const defaultContext = ext === '.vrt' ? 'vrtFile' : 'file';
            const ctx = this.contextValueOverride || defaultContext;
            item.contextValue = ctx;
            item.command = {
                command: 'triforge.simulations.click',
                title: 'Select / Open File',
                arguments: [this] // Pass the RecursiveFileNode itself
            };
        }

        return item;
    }

    getLabel(): string { return path.basename(this.fullPath); }

    async getChildren() {
        if (!this.isDirectory) return [];
        return await RecursiveFileNode.getDirectoryChildren(this.fullPath, this.provider);
    }

    async getProperties(): Promise<PropertyItem[]> {
        const name = path.basename(this.fullPath);
        const properties: PropertyItem[] = [
            { key: 'Name', value: name },
            { key: 'Path', value: this.fullPath },
            { key: 'Type', value: this.isDirectory ? 'Folder' : (path.extname(name) || 'File') }
        ];

        let stats: fs.Stats;
        try {
            stats = fs.statSync(this.fullPath);
        } catch {
            // The file may have been deleted, moved, or not yet regenerated
            // (common for simulation outputs). Degrade gracefully to the
            // Name/Path/Type we already know rather than throwing and stalling
            // the Properties pane for the rest of the session.
            properties.push({ key: 'Status', value: 'File not found' });
            return properties;
        }

        if (!this.isDirectory) {
            const sizeKB = (stats.size / 1024).toFixed(2);
            properties.push({ key: 'Size', value: `${sizeKB} KB` });
        }

        properties.push({ key: 'Modified', value: stats.mtime.toLocaleString() });

        return properties;
    }

    static async getDirectoryChildren(dirPath: string, provider: SimulationsView): Promise<ExplorerNode[]> {
        try {
            // VIEW-2: async, non-blocking directory scan. `withFileTypes` gives the
            // file/dir kind without a per-entry stat, so the whole listing costs one
            // readdir off the host thread instead of N synchronous statSync calls.
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

            const state = provider.getFolderState(dirPath);

            let nodes = entries.map(entry => {
                const fullPath = path.join(dirPath, entry.name);
                return new RecursiveFileNode(fullPath, entry.isDirectory(), provider);
            });

            // Filter
            if (state.filter) {
                const filter = state.filter.toLowerCase();
                if (filter.includes('*')) {
                    const regex = new RegExp('^' + filter.split('*').map(s => escapeRegExp(s)).join('.*') + '$', 'i');
                    nodes = nodes.filter(n => regex.test(path.basename(n.fullPath).toLowerCase()));
                } else {
                    nodes = nodes.filter(n => path.basename(n.fullPath).toLowerCase().includes(filter));
                }
            }

            // VIEW-2: when sorting by modified time, PRE-COMPUTE each entry's mtime
            // ONCE into a map (async stat, off the host thread) before sorting —
            // instead of calling statSync TWICE per comparison inside Array.sort.
            const mtimes = new Map<string, number>();
            if (state.sortBy === 'modified') {
                await Promise.all(nodes.map(async n => {
                    try {
                        const s = await fs.promises.stat(n.fullPath);
                        mtimes.set(n.fullPath, s.mtimeMs);
                    } catch {
                        mtimes.set(n.fullPath, 0);
                    }
                }));
            }

            // Sort
            nodes.sort((a, b) => {
                const aName = path.basename(a.fullPath);
                const bName = path.basename(b.fullPath);

                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;

                let comparison = 0;

                if (state.sortBy === 'name') {
                    comparison = aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
                } else if (state.sortBy === 'type') {
                    const extA = path.extname(aName);
                    const extB = path.extname(bName);
                    comparison = extA.localeCompare(extB);
                } else if (state.sortBy === 'modified') {
                    comparison = (mtimes.get(a.fullPath) ?? 0) - (mtimes.get(b.fullPath) ?? 0);
                }

                return state.sortOrder === 'asc' ? comparison : -comparison;
            });

            return nodes;

        } catch (e) {
            return [new MessageNode("Error reading directory")];
        }
    }
}

// --- Static Input Nodes ---

export class DemNode implements ExplorerNode {
    constructor(public readonly path: string) { }

    getTreeItem() {
        // Use basename or "Elevation"
        const label = "Elevation";
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.description = path.basename(this.path);

        if (SimulationsView.extensionUri) {
            item.iconPath = vscode.Uri.joinPath(SimulationsView.extensionUri, 'media', 'elevation.svg');
        } else {
            item.iconPath = new vscode.ThemeIcon('mountain');
        }

        item.contextValue = 'demNode';
        item.command = {
            command: 'triforge.openMap',
            title: 'Open Map (Elevation)',
            arguments: [ProjectManager.instance.activeProject, { layer: 'dem' }]
        };
        return item;
    }

    getLabel(): string { return "Elevation"; }

    async getChildren() { return []; }

    async getProperties(): Promise<PropertyItem[]> {
        const stats = await fs.promises.stat(this.path);
        const props: PropertyItem[] = [
            { key: 'Type', value: 'Elevation (DEM)' },
            { key: 'File', value: path.basename(this.path) },
            { key: 'Size', value: `${(stats.size / 1024).toFixed(2)} KB` },
            { key: 'Path', value: this.path }
        ];

        try {
            const header = await DemParser.parseHeaderOnly(this.path);
            props.push(
                { key: 'Dimensions', value: `${header.ncols} x ${header.nrows}`, group: 'DEM Header' },
                { key: 'Cell Size', value: header.cellsize.toString(), group: 'DEM Header' },
                { key: 'NoData', value: header.NODATA_value.toString(), group: 'DEM Header' },
                { key: 'XLL Corner', value: header.xllcorner.toFixed(6), group: 'DEM Header' },
                { key: 'YLL Corner', value: header.yllcorner.toFixed(6), group: 'DEM Header' }
            );
        } catch (e) {
            props.push({ key: 'Header Error', value: 'Could not parse header', group: 'DEM Header' });
        }

        return props;
    }
}

export class InitHNode implements ExplorerNode {
    constructor(public readonly path: string) { }

    getTreeItem() {
        const label = "Water Depth";
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.description = path.basename(this.path);
        item.iconPath = new vscode.ThemeIcon('symbol-ruler');
        item.contextValue = 'initHNode';
        item.command = {
            command: 'triforge.openMap',
            title: 'Open Map (Water Depth)',
            arguments: [ProjectManager.instance.activeProject, { layer: 'init' }]
        };
        return item;
    }

    getLabel(): string { return "Water Depth"; }

    async getChildren() { return []; }

    async getProperties(): Promise<PropertyItem[]> {
        const stats = await fs.promises.stat(this.path);
        return [
            { key: 'Type', value: 'Water Depth' },
            { key: 'File', value: path.basename(this.path) },
            { key: 'Size', value: `${(stats.size / 1024).toFixed(2)} KB` },
            { key: 'Path', value: this.path }
        ];
    }
}

export class InitQxQyNode implements ExplorerNode {
    constructor(public readonly qxPath: string, public readonly qyPath: string) { }

    getTreeItem() {
        const label = "Water Discharge";
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        // Show both basenames?
        const qxName = path.basename(this.qxPath);
        const qyName = path.basename(this.qyPath);
        item.description = `${qxName}, ${qyName}`;
        item.iconPath = new vscode.ThemeIcon('symbol-event');
        item.contextValue = 'initQxQyNode';
        item.command = {
            command: 'triforge.openMap',
            title: 'Open Map (Water Discharge)',
            arguments: [ProjectManager.instance.activeProject, { layer: 'qxqy' }]
        };
        return item;
    }

    getLabel(): string { return "Water Discharge"; }

    async getChildren() { return []; }

    async getProperties(): Promise<PropertyItem[]> {
        return [
            { key: 'Type', value: 'Water Discharge' },
            { key: 'QX File', value: path.basename(this.qxPath) },
            { key: 'QY File', value: path.basename(this.qyPath) }
        ];
    }
}

function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
