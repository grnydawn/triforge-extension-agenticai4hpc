import * as vscode from 'vscode';

export function getPropertiesHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const iconSvg = `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M4 2L2 4v9l2 2h8l2-2V4l-2-2H4zm0 2h8v9H4V4zm2 2v1h4V6H6zm0 2v1h4V8H6zm0 2v1h4v-1H6z"/></svg>`; // Generic document/property icon

    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Properties</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-sideBar-background);
                    padding: 0;
                    margin: 0;
                }
                #filter-container {
                    /* Input box area, styled if visible */
                    padding: 10px;
                    background-color: var(--vscode-sideBarSectionHeader-background);
                    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
                    display: none; /* Hidden by default until content added */
                }
                #filter-container:not(:empty) {
                    display: block;
                }
                input {
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    padding: 4px;
                    width: 100%;
                    box-sizing: border-box;
                    font-family: inherit;
                }
                input:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                    border-color: var(--vscode-focusBorder);
                }
                .tree-list {
                    padding-top: 5px;
                }
                .tree-item {
                    display: flex;
                    align-items: center;
                    height: 22px;
                    padding-left: 10px;
                    padding-right: 10px;
                    cursor: default;
                    user-select: none;
                }
                .tree-item:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                .icon {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 16px;
                    height: 16px;
                    margin-right: 6px;
                    flex-shrink: 0;
                    color: var(--vscode-symbolIcon-propertyForeground, var(--vscode-symbolIcon-classForeground));
                }
                .content-wrapper {
                    display: flex;
                    min-width: 0;
                    flex: 1;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    align-items: baseline;
                }
                .key {
                    color: var(--vscode-foreground);
                    white-space: nowrap;
                }
                .separator {
                    color: var(--vscode-descriptionForeground);
                    margin: 0 4px;
                    flex-shrink: 0;
                }
                .value {
                    color: var(--vscode-descriptionForeground);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    flex: 1;
                }
                .group-header {
                    font-weight: bold;
                    padding: 4px 10px;
                    color: var(--vscode-sideBarSectionHeader-foreground);
                    background-color: var(--vscode-sideBarSectionHeader-background);
                    font-size: 0.85em;
                    text-transform: uppercase;
                    margin-top: 5px;
                }
                .group-header:first-child {
                    margin-top: 0;
                }
                .no-data {
                     padding: 20px;
                     text-align: center;
                     color: var(--vscode-descriptionForeground);
                }
            </style>
        </head>
        <body>
            <div id="filter-container"></div>
            <div id="content" class="tree-list"></div>

            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                const container = document.getElementById('filter-container');
                const content = document.getElementById('content');
                const iconSvg = \`${iconSvg}\`;

                // SEC-3: escape user-/file-derived values (project name, output-file
                // basename, DEM header fields) before building innerHTML so an HTML
                // payload renders as inert literal text instead of live markup.
                function escapeHtml(value) {
                    return String(value == null ? '' : value)
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#39;');
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'updateProperties':
                            renderProperties(message.properties);
                            break;
                        case 'showFilterInput':
                            showInput(message.value);
                            break;
                    }
                });

                function renderProperties(properties) {
                    if (!properties || properties.length === 0) {
                        content.innerHTML = '<div class="no-data">No properties selected</div>';
                        return;
                    }

                    let html = '';
                    let currentGroup = null;

                    properties.forEach(p => {
                        if (p.group !== currentGroup) {
                            currentGroup = p.group;
                            if (currentGroup) {
                                 html += \`<div class="group-header">\${escapeHtml(currentGroup)}</div>\`;
                            }
                        }

                        const key = escapeHtml(p.key);
                        const value = escapeHtml(p.value);
                        // Native tree item structure: Indent (virtual here) -> Icon -> Text
                        html += \`<div class="tree-item" title="\${key}: \${value}">
                                    <div class="icon">\${iconSvg}</div>
                                    <div class="content-wrapper">
                                        <span class="key">\${key}</span>
                                        <span class="separator">:</span>
                                        <span class="value">\${value}</span>
                                    </div>
                                 </div>\`;
                    });

                    content.innerHTML = html;
                }

                function showInput(value) {
                    container.innerHTML = \`<input type="text" id="filterInput" placeholder="Filter..." value="\${escapeHtml(value)}">\`;
                    const input = document.getElementById('filterInput');
                    input.focus();
                    input.select();

                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            vscode.postMessage({ type: 'applyFilter', value: input.value });
                            container.innerHTML = '';
                        } else if (e.key === 'Escape') {
                            vscode.postMessage({ type: 'cancelFilter' });
                            container.innerHTML = '';
                        }
                    });
                    
                    input.addEventListener('blur', () => {
                         // Optional: Cancel on blur if needed
                    });
                }

                // Signal that the webview is ready to receive messages
                vscode.postMessage({ type: 'ready' });
            </script>
        </body>
        </html>`;
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
