

/**
 * Base class for Webview Controllers.
 * Handles VS Code API acquisition, message passing, and state management.
 */
export abstract class WebviewController<State = any> {
    protected vscode: any;
    protected state: State;

    constructor(initialState: State) {
        this.vscode = acquireVsCodeApi();
        this.state = initialState;

        window.addEventListener('message', event => {
            const message = event.data;
            this.handleMessage(message);
        });

        // Initialize UI
        this.onInit();
    }

    /**
     * Called after constructor. Override to set up event listeners and initial UI.
     */
    protected abstract onInit(): void;

    /**
     * Handle incoming messages from the extension.
     */
    protected abstract handleMessage(message: any): void;

    /**
     * Post a message to the extension.
     */
    protected postMessage(message: any) {
        this.vscode.postMessage(message);
    }

    /**
     * Update state and trigger UI updates if needed.
     */
    protected setState(partialState: Partial<State>) {
        this.state = { ...this.state, ...partialState };
        this.onStateUpdate(this.state);
    }

    /**
     * Called when state is updated. Override to update UI.
     */
    protected onStateUpdate(_newState: State) { }

    /**
     * Helper to get an element by ID, typed as HTMLElement.
     */
    protected getElement<T extends HTMLElement>(id: string): T | null {
        return document.getElementById(id) as T | null;
    }

    /**
     * Helper to get an input element by ID.
     */
    protected getInput(id: string): HTMLInputElement | null {
        return document.getElementById(id) as HTMLInputElement | null;
    }

    /**
     * Helper to get a textarea element by ID.
     */
    protected getTextArea(id: string): HTMLTextAreaElement | null {
        return document.getElementById(id) as HTMLTextAreaElement | null;
    }
}

// Declaration for acquireVsCodeApi
declare function acquireVsCodeApi(): any;
