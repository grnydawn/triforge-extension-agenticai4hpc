import * as vscode from 'vscode';
import { EventBus } from '../state/EventBus';
import { Inspectable, PropertyItem, isInspectable } from './Inspectable';
import { getPropertiesHtml } from './PropertiesHtml';

export class PropertiesView implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _properties: PropertyItem[] = [];
    private _selectedItems: Inspectable[] = [];
    private _onFilterCallback?: (value: string | undefined) => void;

    constructor(private readonly _extensionUri: vscode.Uri, disposables?: vscode.Disposable[]) {
        // STATE-1: capture the EventBus subscriptions into the provided
        // disposables array (context.subscriptions) so the listeners do not
        // outlive the extension and fire refresh() on a dead provider.
        EventBus.instance.on('project:activeChanged', () => this.refresh(), undefined, disposables);
        EventBus.instance.on('project:listChanged', () => this.refresh(), undefined, disposables);

        EventBus.instance.on('properties:update', (items: Inspectable[]) => {
            this._selectedItems = items;
            this.refresh();
        }, undefined, disposables);

        // STATE-1: the editor-switch full property recompute is dropped — the
        // Properties view is driven by EventBus selection events, not by the
        // active text editor, so a recompute on every editor switch was an
        // un-captured leak with no functional benefit.
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'applyFilter':
                    if (this._onFilterCallback) {
                        this._onFilterCallback(data.value);
                        this._onFilterCallback = undefined;
                    }
                    break;
                case 'cancelFilter':
                    if (this._onFilterCallback) {
                        this._onFilterCallback(undefined);
                        this._onFilterCallback = undefined;
                    }
                    break;
                case 'ready':
                    this.refresh();
                    break;
            }
        });

        this.refresh();
    }

    public showFilterInput(currentValue: string, callback: (value: string | undefined) => void) {
        this._onFilterCallback = callback;
        if (this._view) {
            this._view.show?.(true);
            this._view.webview.postMessage({ type: 'showFilterInput', value: currentValue });
        }
    }

    async refresh(): Promise<void> {
        await this._computeProperties();
        if (this._view) {
            this._view.webview.postMessage({ type: 'updateProperties', properties: this._properties });
        }
    }

    private async _computeProperties() {
        this._properties = [];

        if (this._selectedItems.length === 0) {
            return;
        }

        if (this._selectedItems.length === 1) {
            const item = this._selectedItems[0];
            if (isInspectable(item)) {
                try {
                    this._properties = await item.getProperties();
                } catch {
                    // A node whose backing file was deleted/moved/regenerated may
                    // still throw while computing properties. Degrade to a sensible
                    // row instead of letting the error stop the pane from updating
                    // for the rest of the session.
                    this._properties = [
                        { key: 'Name', value: item.getLabel() },
                        { key: 'Status', value: 'Properties unavailable' }
                    ];
                }
            }
        } else {
            // MULTI-SELECTION logic (same as before)
            this._properties.push({
                key: 'Selection',
                value: `Multiple items (${this._selectedItems.length})`,
                group: 'Selection Info'
            });

            for (const item of this._selectedItems) {
                if (isInspectable(item)) {
                    this._properties.push({
                        key: 'Item',
                        value: item.getLabel(),
                        group: 'Selected Items'
                    });
                }
            }

            let commonProps: PropertyItem[] | undefined = undefined;

            for (const item of this._selectedItems) {
                if (isInspectable(item)) {
                    let itemProps: PropertyItem[];
                    try {
                        itemProps = await item.getProperties();
                    } catch {
                        // A node whose backing file is missing should not abort the
                        // whole multi-selection computation; treat it as having no
                        // common properties to contribute.
                        itemProps = [];
                    }
                    if (commonProps === undefined) {
                        commonProps = [...itemProps];
                    } else {
                        commonProps = commonProps.filter(cp =>
                            itemProps.some(ip => ip.key === cp.key && ip.value === cp.value && ip.group === cp.group)
                        );
                    }
                }
            }

            if (commonProps && commonProps.length > 0) {
                this._properties.push(...commonProps.map(p => ({
                    ...p,
                    group: p.group ? `Common: ${p.group}` : 'Common Properties'
                })));
            }
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return getPropertiesHtml(webview);
    }
}
