import type * as vscode from 'vscode'; // type-only: erased at compile, no runtime require

export class Logger {
    private static _outputChannel: vscode.OutputChannel | undefined;

    public static initialize(context: vscode.ExtensionContext) {
        // Lazy runtime require so importing Logger outside the extension host (the
        // headless MCP bundle) never pulls a hard 'vscode' dependency. initialize()
        // is only ever called from extension.ts, which runs inside the host.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const runtime = require('vscode') as typeof import('vscode');
        this._outputChannel = runtime.window.createOutputChannel('Triforge Output');
        context.subscriptions.push(this._outputChannel);
        this.info('Triforge Logger initialized (User Version)');
    }

    public static info(message: string) {
        this._log('INFO', message);
    }

    public static warn(message: string) {
        this._log('WARN', message);
    }

    public static error(message: string, error?: any) {
        this._log('ERROR', message);
        if (error) {
            const detail = error instanceof Error ? (error.stack ?? error.message) : safeStringify(error);
            if (this._outputChannel) {
                this._outputChannel.appendLine(detail);
            } else {
                console.error(detail);
            }
        }
    }

    private static _log(level: string, message: string) {
        const timestamp = new Date().toLocaleTimeString();
        const formattedMessage = `[${timestamp}] [${level}] ${message}`;

        if (this._outputChannel) {
            this._outputChannel.appendLine(formattedMessage);
        } else {
            console.log(formattedMessage);
        }
    }

    public static show() {
        this._outputChannel?.show(true);
    }
}

/**
 * Serialize a non-Error value for logging. Falls back to String(value) when
 * JSON.stringify throws (e.g. circular references or BigInt).
 */
function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}
