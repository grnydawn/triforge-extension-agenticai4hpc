import * as vscode from 'vscode';
import * as fs from 'fs';
import { ProjectManager } from './state/ProjectManager';
import { EventBus } from './state/EventBus';
import { ProjectsView } from './views/ProjectsView';
import { SimulationsView, ExplorerNode, RecursiveFileNode } from './views/SimulationsView';
import { PropertiesView } from './views/PropertiesView';
import { MapEditor } from './panels/MapEditor';
import { MapSelector } from './panels/MapSelector';
import { GlobalSettingsManager } from './state/GlobalSettingsManager';
import { AgentContextManager } from './state/AgentContextManager';
import { registerProjectReferenceCompletion } from './providers/ProjectReferenceCompletionProvider';
import { Logger } from './utils/Logger';
import { needsGlobalSetup } from './services/globalSetup';
import { registerLmTools } from './lm/registerLmTools';

// Command Modules
import { registerProjectCommands } from './commands/project';
import { registerMapCommands } from './commands/map';
import { registerSettingsCommands } from './commands/settings';
import { registerSimulationsCommands } from './commands/simulations';
import { registerAnimationCommands } from './commands/animation';
import { InputGeneratorEditor } from './panels/InputGeneratorEditor';

import { ComputationSetupEditor } from './panels/ComputationSetupEditor';
import { ExecutionSetupEditor } from './panels/ExecutionSetupEditor';

export function activate(context: vscode.ExtensionContext) {
    Logger.initialize(context);
    Logger.info('Triforge extension is now active!');

    // In-editor agent tools (Copilot agent mode) over the same pure handlers.
    registerLmTools(context);

    // Register Views
    // STATE-1: thread context.subscriptions into each view so the EventBus
    // listeners they register are captured (disposed on deactivate) instead of
    // leaking past the view's lifetime.
    const projectsView = new ProjectsView(context.subscriptions);
    const simulationsView = new SimulationsView(context.subscriptions);
    SimulationsView.extensionUri = context.extensionUri;
    const propertiesProvider = new PropertiesView(context.extensionUri, context.subscriptions);

    const projectsTreeView = vscode.window.createTreeView('triforge-projects', { treeDataProvider: projectsView });

    // API-1: capture the tree onDidChange* Disposables.
    context.subscriptions.push(projectsTreeView.onDidChangeVisibility(e => {
        if (!e.visible) return;
        // Engaging Triforge (clicking the activity-bar icon reveals this view) seats
        // the .triforge home — consent-gated — so users rarely need the home button.
        void AgentContextManager.instance.ensureSeatedFromEngagement();
        if (ProjectManager.instance.activeProject) {
            MapEditor.revealAndUnfold(context.extensionUri, ProjectManager.instance.activeProject);
        }
    }));

    context.subscriptions.push(projectsTreeView.onDidChangeSelection(e => {
        const selection = e.selection as unknown as any[];
        EventBus.instance.fire('properties:update', selection);
    }));

    context.subscriptions.push(projectsTreeView);

    // Create Simulations View with Multi-Select enabled
    const simulationsTreeView = vscode.window.createTreeView('triforge-simulations', {
        treeDataProvider: simulationsView,
        canSelectMany: true
    });
    context.subscriptions.push(simulationsTreeView);

    const updatePropertiesSelection = async (selection: readonly any[]) => { // Typed as any to avoid import loop issues if needed, or keep RecursiveFileNode
        if (!selection || selection.length === 0) {
            EventBus.instance.fire('properties:update', []);
            return;
        }
        EventBus.instance.fire('properties:update', [...selection]);
    };

    // Selection Listener for Properties View
    // API-1: capture the tree onDidChangeSelection Disposable.
    context.subscriptions.push(simulationsTreeView.onDidChangeSelection(async e => {
        const selection = e.selection;
        SimulationsView.currentSelection = selection as unknown as ExplorerNode[];
        await updatePropertiesSelection(selection);
    }));

    // API-1: capture the registerWebviewViewProvider Disposable.
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('triforge-properties', propertiesProvider));

    // Register Commands via Modules
    context.subscriptions.push(vscode.commands.registerCommand('triforge.pickSimulationArea', async () => {
        const cellSizeStr = await vscode.window.showInputBox({
            prompt: 'Enter Cell Size (meters)',
            value: '30.0',
            validateInput: (text) => {
                const val = parseFloat(text);
                return (isNaN(val) || val <= 0) ? 'Please enter a valid positive number' : null;
            }
        });
        if (!cellSizeStr) return;

        MapSelector.createOrShow(context.extensionUri, parseFloat(cellSizeStr), (data) => {
            if (data && data.header) {
                vscode.window.showInformationMessage(`Selected Area: ${JSON.stringify(data.header)}`);
            }
        });
    }));

    registerProjectCommands(context);
    registerMapCommands(context);
    registerSettingsCommands(context);
    registerSimulationsCommands(context, simulationsView, simulationsTreeView as unknown as vscode.TreeView<RecursiveFileNode>, propertiesProvider);
    registerAnimationCommands(context, simulationsTreeView as unknown as vscode.TreeView<RecursiveFileNode>);

    context.subscriptions.push(vscode.commands.registerCommand('triforge.openDynamicInputGenerator', () => {
        // Redirect to Unified Input Generator with Dynamic Mode
        InputGeneratorEditor.createOrShow(context.extensionUri, 'dynamic');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('triforge.openExecutionSetup', () => {
        ExecutionSetupEditor.createOrShow(context.extensionUri);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('triforge.openComputationSetup', () => {
        ComputationSetupEditor.createOrShow(context.extensionUri);
    }));

    // Initialize State Managers
    GlobalSettingsManager.instance.initialize(context);
    // SEC-2: pass the ExtensionContext so ProjectManager can read/write the
    // OpenTopography API key via SecretStorage instead of plaintext config.json.
    ProjectManager.instance.initialize(context);
    // Make projects reachable + intelligible to agentic AI (workspace folder + AGENTS.md).
    AgentContextManager.instance.initialize(context.subscriptions);

    // @project autocomplete in markdown/plaintext editors.
    registerProjectReferenceCompletion(context.subscriptions);

    // Auto-open Global Settings when setup is missing, STALE, or incomplete.
    // VS Code keeps the globalStorage folder across uninstall/reinstall (same on
    // every OS), so a leftover global_settings.json used to suppress this page
    // forever after a reinstall. needsGlobalSetup() re-arms it when the saved
    // workspacePath no longer exists on disk or identity fields are blank; a
    // still-valid setup is left alone. See services/globalSetup for the rationale.
    const settings = GlobalSettingsManager.instance.getSettings();
    // A usable workspace is an existing DIRECTORY (mirrors the save-side guard in
    // SettingsEditor); a missing path or a stray file at that path re-arms setup.
    let workspaceExists = false;
    try {
        workspaceExists = !!settings.workspacePath && fs.statSync(settings.workspacePath).isDirectory();
    } catch {
        workspaceExists = false;
    }
    if (needsGlobalSetup(settings, workspaceExists)) {
        Logger.info('[Extension] Global settings missing/stale. Triggering triforge.openSettings...');
        vscode.commands.executeCommand('triforge.openSettings').then(
            () => Logger.info('[Extension] triforge.openSettings executed successfully'),
            (err) => Logger.error('[Extension] triforge.openSettings failed', err)
        );
    }

    context.subscriptions.push(vscode.Disposable.from({ dispose: () => EventBus.instance.dispose() }));
}


export function deactivate() {
    EventBus.instance.dispose();
}
