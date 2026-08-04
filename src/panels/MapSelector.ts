import * as vscode from 'vscode';


export class MapSelector {
    public static currentPanel: MapSelector | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    // Callback to return data to ProjectCreator
    // Callback to return data to ProjectCreator
    private _onSelectionComplete?: (data: any) => void;
    private _cellSize: number = 30.0;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, cellSize: number, onSelectionComplete?: (data: any) => void) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._cellSize = cellSize;
        this._onSelectionComplete = onSelectionComplete;

        this._panel.webview.html = this._getHtmlForWebview();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;
                    case 'selectionComplete':
                        if (this._onSelectionComplete) {
                            this._onSelectionComplete(message.data);
                        }
                        this.dispose();
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri, cellSize: number, onSelectionComplete?: (data: any) => void) {
        const column = vscode.ViewColumn.Beside;

        if (MapSelector.currentPanel) {
            MapSelector.currentPanel._panel.reveal(column);
            MapSelector.currentPanel._cellSize = cellSize; // Update cell size
            MapSelector.currentPanel._onSelectionComplete = onSelectionComplete; // Update callback
            // Re-update HTML or just reload? 
            // Better to reload to ensure initSelectionMode sends new cell size
            MapSelector.currentPanel._panel.webview.html = MapSelector.currentPanel._getHtmlForWebview();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'triforgeMapSelector',
            'Pick Simulation Area',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'dist', 'webview')
                ]
            }
        );

        MapSelector.currentPanel = new MapSelector(panel, extensionUri, cellSize, onSelectionComplete);
    }

    public dispose() {
        MapSelector.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _getHtmlForWebview() {
        // Reuse the main map webview bundle, initialized in 'selection' mode.
        // Load the SAME fresh bundle MapEditor uses (dist/webview, emitted by
        // `build:webview`) so the picker never runs a stale copy (PKG-2). The
        // map controller handles the 'initSelectionMode' message posted below.
        const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'map.bundle.js');
        const scriptUri = this._panel.webview.asWebviewUri(scriptPathOnDisk);

        const stylePathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'media', 'map.css');
        const styleUri = this._panel.webview.asWebviewUri(stylePathOnDisk);

        // SEC-4: Leaflet is bundled locally under media/leaflet (no unpkg CDN).
        const leafletJsUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'leaflet', 'leaflet.js'));
        const leafletCssUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'leaflet', 'leaflet.css'));

        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${this._panel.webview.cspSource} https: data:; connect-src https:;">
                <link rel="stylesheet" href="${leafletCssUri}" />
                <link href="${styleUri}" rel="stylesheet">
                <title>Select Simulation Area</title>
                <style>
                    /* Selection-specific styles */
                    #map { position: absolute; top: 0; bottom: 0; left: 0; right: 0; }
                    .selection-overlay {
                        pointer-events: none;
                        background: rgba(0,0,0,0.5); /* Dimmed outer */
                    }
                    /* Add more styles for the crop box here or in map.css */
                </style>
            </head>
            <body>
                <div id="map"></div>
                <script nonce="${nonce}" src="${leafletJsUri}"></script>
                <script nonce="${nonce}" src="${scriptUri}"></script>
                <script nonce="${nonce}">
                    // Initialize map in selection mode
                    // const vscode = acquireVsCodeApi(); // Already acquired in map.bundle.js
                    
                    window.addEventListener('load', () => {
                        // Wait for map.js to be ready, then send mode
                        setTimeout(() => {
                           window.postMessage({ type: 'initSelectionMode', cellSize: ${this._cellSize} }, '*');
                        }, 500); 
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
