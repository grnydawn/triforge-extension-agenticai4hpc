import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EventBus } from './EventBus';
import { Logger } from '../utils/Logger';

export interface GlobalSettings {
    userName: string;
    email: string;
    workspacePath: string;
    /** AI project-awareness consent: 'prompt' (ask once), 'enabled', 'disabled'. */
    aiProjectFocus?: 'prompt' | 'enabled' | 'disabled';
    [key: string]: any;
}

export class GlobalSettingsManager {
    private static _instance: GlobalSettingsManager;
    private _settingsFile: string | undefined;
    private _settings: GlobalSettings = {
        userName: '',
        email: '',
        workspacePath: ''
    };

    private constructor() { }

    public static get instance(): GlobalSettingsManager {
        if (!this._instance) {
            this._instance = new GlobalSettingsManager();
        }
        return this._instance;
    }

    public initialize(context: vscode.ExtensionContext) {
        // Use globalStorageUri for persistence
        if (context.globalStorageUri) {
            const storagePath = context.globalStorageUri.fsPath;
            if (!fs.existsSync(storagePath)) {
                fs.mkdirSync(storagePath, { recursive: true });
            }
            this._settingsFile = path.join(storagePath, 'global_settings.json');
            this._loadSettings();
        }
    }

    public getSettings(): GlobalSettings {
        return { ...this._settings };
    }

    public updateSettings(newSettings: Partial<GlobalSettings>) {
        this._settings = { ...this._settings, ...newSettings };
        this._saveSettings();
        EventBus.instance.fire('settings:changed', this._settings);
    }

    private _loadSettings() {
        if (this._settingsFile && fs.existsSync(this._settingsFile)) {
            try {
                const data = fs.readFileSync(this._settingsFile, 'utf8');
                const loaded = JSON.parse(data);
                this._settings = { ...this._settings, ...loaded };
            } catch (err) {
                Logger.error('Failed to load global settings', err);
            }
        }
    }

    private _saveSettings() {
        if (this._settingsFile) {
            try {
                // BUG-10: persist atomically (temp file + rename) so a crash or
                // interleaved write can never leave settings.json truncated and
                // unparseable. rename is atomic on the same filesystem.
                const tmpPath = `${this._settingsFile}.tmp`;
                fs.writeFileSync(tmpPath, JSON.stringify(this._settings, null, 2));
                fs.renameSync(tmpPath, this._settingsFile);
            } catch (err) {
                Logger.error('Failed to save global settings', err);
            }
        }
    } public resetSettings() {
        if (this._settingsFile && fs.existsSync(this._settingsFile)) {
            try {
                fs.unlinkSync(this._settingsFile);
            } catch (err) {
                Logger.error('Failed to delete global settings file', err);
            }
        }
        // Reset in-memory
        this._settings = {
            userName: '',
            email: '',
            workspacePath: ''
        };
        EventBus.instance.fire('settings:changed', this._settings);
    }
}
