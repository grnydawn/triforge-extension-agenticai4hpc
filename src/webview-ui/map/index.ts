import { MapController } from './MapController';

// Declare global function
declare function acquireVsCodeApi(): any;

declare global {
    interface Window {
        vscode: ReturnType<typeof acquireVsCodeApi>;
        mapController?: MapController;
    }
}

// Acquire API instance
const vscode = acquireVsCodeApi();

// Initialize the controller when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    try {
        // Expose controller globally for debugging if needed
        window.mapController = new MapController(vscode);
        window.vscode = vscode;
        vscode.postMessage({ command: 'webviewReady' });
    } catch (e: any) {
        const errorDiv = document.createElement('div');
        errorDiv.style.color = 'red';
        errorDiv.style.padding = '20px';
        errorDiv.style.backgroundColor = 'white';
        errorDiv.style.zIndex = '99999';
        errorDiv.style.position = 'absolute';
        errorDiv.innerHTML = `<h3>Map Init Error</h3><pre>${e}\n${e.stack}</pre>`;
        document.body.appendChild(errorDiv);
        vscode.postMessage({ command: 'error', data: `Init Error: ${e.toString()}` });
    }
});
