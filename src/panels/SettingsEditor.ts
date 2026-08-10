import * as vscode from 'vscode';
import { GlobalSettingsManager } from '../state/GlobalSettingsManager';
import { escapeHtml } from '../utils/escape';

export class SettingsEditor {
    public static currentPanel: SettingsEditor | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, _extensionUri: vscode.Uri) {
        this._panel = panel;
        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'alert':
                        vscode.window.showErrorMessage(message.text, { modal: true });
                        return;
                    case 'browseWorkspace':
                        this._handleBrowseWorkspace();
                        return;
                    case 'saveSettings':
                        const newSettings = message.data;
                        const fs = require('fs');


                        const wsPath = newSettings.workspacePath;

                        // Reuse an existing folder (e.g. a prior ~/.triforge after reinstall):
                        // if it already exists, keep it as-is and pick up its projects.json
                        // on load; only create it when it does not exist.
                        if (!fs.existsSync(wsPath)) {
                            try {
                                fs.mkdirSync(wsPath, { recursive: true });
                            } catch (e) {
                                vscode.window.showErrorMessage(`Failed to create workspace: ${e}`, { modal: true });
                                return;
                            }
                        } else {
                            // Reuse only a genuine directory — a regular file at this path
                            // cannot hold `.triforge/projects.json` and would fail with ENOTDIR
                            // on the next load.
                            let isDir = false;
                            try {
                                isDir = fs.statSync(wsPath).isDirectory();
                            } catch {
                                isDir = false;
                            }
                            if (!isDir) {
                                vscode.window.showErrorMessage(`The path '${wsPath}' is not a folder. Choose a directory for the Triforge workspace.`, { modal: true });
                                return;
                            }
                        }



                        GlobalSettingsManager.instance.updateSettings(newSettings);
                        vscode.window.showInformationMessage('Triforge settings saved.');
                        this.dispose();
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

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.ViewColumn.Active;

        // If we already have a panel, show it.
        if (SettingsEditor.currentPanel) {
            SettingsEditor.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            'triforgeSettings',
            'Triforge Global Settings',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        SettingsEditor.currentPanel = new SettingsEditor(panel, extensionUri);
    }

    public dispose() {
        SettingsEditor.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async _handleBrowseWorkspace() {
        const options: vscode.OpenDialogOptions = {
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Workspace Folder'
        };

        const uri = await vscode.window.showOpenDialog(options);
        if (uri && uri[0]) {
            this._panel.webview.postMessage({ command: 'updateWorkspacePath', path: uri[0].fsPath });
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview() {
        const settings = GlobalSettingsManager.instance.getSettings();
        // Default the workspace to ~/triforge-projects if not set. Projects live as
        // direct children of this folder and the `.triforge` control dir (registry +
        // AI catalog) is created inside it. Must NOT default to the `.triforge` dir
        // itself: getTriforgeWorkspaceRoot() strips a trailing `.triforge` to its
        // parent, so a `~/.triforge` default would scatter imported projects straight
        // into the home directory. Kept consistent with ProjectCreator's default.
        if (!settings.workspacePath) {
            const os = require('os');
            const path = require('path');
            settings.workspacePath = path.join(os.homedir(), 'triforge-projects');
        }
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Triforge Settings</title>
    <style>
        body { 
            font-family: var(--vscode-font-family); 
            color: var(--vscode-editor-foreground); 
            background-color: var(--vscode-editor-background); 
            padding: 40px; 
            max-width: 800px;
            margin: 0 auto;
        }
        h2 { 
            font-weight: 500; 
            font-size: 1.5em; 
            margin-bottom: 30px; 
            border-bottom: 1px solid var(--vscode-settings-headerBorder);
            padding-bottom: 10px;
        }
        .form-group.row {
            display: flex;
            align-items: center;
            margin-bottom: 5px; 
        }
        label { 
            font-weight: 600; 
            font-size: 1.1em;
            width: 150px; 
            flex-shrink: 0;
            margin-bottom: 0;
            margin-right: 15px;
        }
        .row-content {
            flex-grow: 1;
            display: flex;
            gap: 10px;
        }
        input[type="text"] { 
            width: 100%; 
            padding: 6px 8px; 
            box-sizing: border-box; 
            background-color: var(--vscode-input-background); 
            color: var(--vscode-input-foreground); 
            border: 1px solid #808080 !important; /* Force visible border */
            border-radius: 2px;
            font-size: 1em;
            flex-grow: 1;
        }
        input[type="text"]:focus {
            outline: 1px solid var(--vscode-focusBorder);
            border-color: var(--vscode-focusBorder) !important;
        }
        .description-row {
            margin-top: 0;
            margin-bottom: 25px;
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
            line-height: 1.4;
            margin-left: 165px; 
        }
        .buttons { 
            margin-top: 40px; 
            display: flex; 
            gap: 12px; 
            border-top: 1px solid var(--vscode-settings-headerBorder);
            padding-top: 20px;
        }
        button { 
            padding: 6px 18px; 
            cursor: pointer; 
            background-color: var(--vscode-button-background); 
            color: var(--vscode-button-foreground); 
            border: none; 
            border-radius: 2px;
            font-size: 1em;
        }
        button:hover { 
            background-color: var(--vscode-button-hoverBackground); 
        }
        button.secondary { 
            background-color: var(--vscode-button-secondaryBackground); 
            color: var(--vscode-button-secondaryForeground); 
        }
        button.secondary:hover { 
            background-color: var(--vscode-button-secondaryHoverBackground); 
        }
    </style>
</head>
<body>
    <h2>Global Settings</h2>
    
    <div class="form-group row">
        <label for="userName">User Name</label>
        <div class="row-content">
            <input type="text" id="userName" value="${escapeHtml(settings.userName)}" placeholder="Enter your name">
        </div>
    </div>
    <div class="description-row">Your display name used for identifying contributions or session data within Triforge projects.</div>
    
    <div class="form-group row">
        <label for="userEmail">Email</label>
        <div class="row-content">
            <input type="text" id="userEmail" value="${escapeHtml(settings.email)}" placeholder="name@example.com">
        </div>
    </div>
    <div class="description-row">The email address associated with your user identity.</div>

    <div class="form-group row">
        <label for="workspacePath">Project Folder</label>
        <div class="row-content">
            <input type="text" id="workspacePath" value="${escapeHtml(settings.workspacePath)}" placeholder="/path/to/triforge-projects">
            <button id="browseWorkspaceBtn" class="secondary">Choose Folder...</button>
        </div>
    </div>
    <div class="description-row">The folder that holds all your Triforge projects. New and imported projects are created as subfolders here, and Triforge keeps its project registry and AI-tool catalog in a <code>.triforge</code> directory inside it. Defaults to <code>~/triforge-projects</code>.</div>

    <div class="buttons">
        <button id="saveBtn">Save Settings</button>
        <button id="cancelBtn" class="secondary">Cancel</button>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        function setFieldStatus(inputId, isValid) {
            const input = document.getElementById(inputId);
            if (!input) return;
            const parent = input.closest('.form-group');
            if (parent) {
                const label = parent.querySelector('label');
                if (label) {
                    label.style.color = isValid ? 'var(--vscode-foreground)' : 'red';
                }
            }
        }

        ['userName', 'userEmail', 'workspacePath'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => {
                setFieldStatus(id, true);
            });
        });
        
        document.getElementById('browseWorkspaceBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'browseWorkspace' });
        });

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateWorkspacePath') {
                document.getElementById('workspacePath').value = message.path;
                setFieldStatus('workspacePath', true);
            }
        });
        
        document.getElementById('saveBtn').addEventListener('click', () => {
            const userNameInput = document.getElementById('userName');
            const userEmailInput = document.getElementById('userEmail');
            const workspacePathInput = document.getElementById('workspacePath');
            
            const userName = userNameInput.value.trim();
            const userEmail = userEmailInput.value.trim();
            const workspacePath = workspacePathInput.value.trim();

            let isValid = true;

            if (!userName) {
                setFieldStatus('userName', false);
                isValid = false;
            }

            if (!userEmail) {
                setFieldStatus('userEmail', false);
                isValid = false;
            }

            if (!workspacePath) {
                setFieldStatus('workspacePath', false);
                isValid = false;
            }
            
            if (!isValid) {
                 vscode.postMessage({ 
                    command: 'alert', 
                    text: 'Please fill in all required fields.' 
                });
                return;
            }

            vscode.postMessage({
                command: 'saveSettings',
                data: {
                    userName,
                    email: userEmail,
                    workspacePath
                    // defaultDemPath removed
                }
            });
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });
    </script>
</body>
</html>`;
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
