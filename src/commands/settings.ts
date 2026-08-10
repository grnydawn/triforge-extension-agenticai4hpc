import * as vscode from 'vscode';
import { SettingsEditor } from '../panels/SettingsEditor';


export function registerSettingsCommands(context: vscode.ExtensionContext) {
    const openSettingsDisposable = vscode.commands.registerCommand('triforge.openSettings', () => {
        const { Logger } = require('../utils/Logger');
        Logger.info('[Command] triforge.openSettings invoked');
        SettingsEditor.createOrShow(context.extensionUri);
    });



    const resetSettingsDisposable = vscode.commands.registerCommand('triforge.resetSettings', async () => {
        const yes = 'Yes';
        const answer = await vscode.window.showWarningMessage('Are you sure you want to reset all Global Settings?', { modal: true }, yes);
        if (answer === yes) {
            const { GlobalSettingsManager } = require('../state/GlobalSettingsManager');
            GlobalSettingsManager.instance.resetSettings();
            vscode.window.showInformationMessage('Global settings have been reset. Reload the window to test auto-open.');
        }
    });

    context.subscriptions.push(openSettingsDisposable, resetSettingsDisposable);
}
