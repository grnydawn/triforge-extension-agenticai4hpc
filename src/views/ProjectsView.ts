import * as vscode from 'vscode';
import { ProjectManager, TriforgeProject } from '../state/ProjectManager';
import { EventBus } from '../state/EventBus';
import { Inspectable, PropertyItem } from './Inspectable';

// Define our Tree Item Types
export class ProjectNode implements Inspectable {
    constructor(public readonly project: TriforgeProject) { }

    getTreeItem(): vscode.TreeItem {
        const item = new vscode.TreeItem(this.project.name, vscode.TreeItemCollapsibleState.None);
        item.contextValue = 'triforgeProject';

        // Check if active
        if (ProjectManager.instance.activeProject?.id === this.project.id) {
            item.description = '(Active)';
            item.iconPath = new vscode.ThemeIcon('check');
        } else {
            item.iconPath = new vscode.ThemeIcon('repo');
        }

        item.command = {
            command: 'triforge.openProject',
            title: 'Open Project',
            arguments: [this.project]
        };
        return item;
    }

    getLabel(): string { return this.project.name; }

    async getProperties(): Promise<PropertyItem[]> {
        const props: PropertyItem[] = [
            { key: 'Project Name', value: this.project.name, group: 'Project' },
            { key: 'Project Path', value: this.project.path, group: 'Project' }
        ];

        if (this.project.demPath) {
            props.push({ key: 'DEM Path', value: this.project.demPath, group: 'Project' });
        }


        props.push({ key: 'Created', value: new Date(this.project.createdAt).toLocaleString(), group: 'Metadata' });
        props.push({ key: 'Modified', value: new Date(this.project.lastModified).toLocaleString(), group: 'Metadata' });

        return props;
    }
}

export type TreeItemNode = ProjectNode;

export class ProjectsView implements vscode.TreeDataProvider<TreeItemNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItemNode | undefined | void> = new vscode.EventEmitter<TreeItemNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeItemNode | undefined | void> = this._onDidChangeTreeData.event;

    constructor(disposables?: vscode.Disposable[]) {
        // STATE-1: capture the EventBus subscriptions into the provided
        // disposables array (context.subscriptions) so the listeners do not
        // outlive the extension and fire refresh() on a dead provider.
        EventBus.instance.on('project:activeChanged', () => this.refresh(), undefined, disposables);
        EventBus.instance.on('project:listChanged', () => this.refresh(), undefined, disposables);
        // Listen for internal state changes that require UI refresh
        EventBus.instance.on('project:demVisibilityChanged', () => this.refresh(), undefined, disposables);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeItemNode): vscode.TreeItem {
        return element.getTreeItem();
    }

    getChildren(element?: TreeItemNode): vscode.ProviderResult<TreeItemNode[]> {
        if (!element) {
            // Root: List of Projects
            const projects = ProjectManager.instance.getProjects();
            const { Logger } = require('../utils/Logger');
            Logger.info(`[ProjectsView] Rendering ${projects.length} projects.`);
            return projects.map(p => new ProjectNode(p));
        }
        // No children for projects
        return [];
    }
}
