import * as vscode from 'vscode';

/**
 * Event definitions for the Triforge extension.
 * Defines the payload types for each event.
 */
export interface TriforgeEvents {
    'project:activeChanged': { projectId: string | undefined };
    'project:selectionChanged': { selection: any[] };
    'project:listChanged': void;
    'map:updateCoordinates': { lat: number; lng: number; zoom: number };
    'project:demVisibilityChanged': { projectId: string; visible: boolean };
    'settings:changed': any;
    'project:vrtSelectionChanged': { name: string; info?: string }[];
    'properties:update': any[]; // Use any[] for Inspectable instances to avoid circular imports in some cases, or import properly.
}

/**
 * A type-safe Event Bus using vscode.EventEmitter.
 * strictly implements the Singleton pattern.
 */
export class EventBus {
    private static _instance: EventBus;
    private _emitters: Map<keyof TriforgeEvents, vscode.EventEmitter<any>>;

    private constructor() {
        this._emitters = new Map();
    }

    public static get instance(): EventBus {
        if (!this._instance) {
            this._instance = new EventBus();
        }
        return this._instance;
    }

    /**
     * fire an event with the given payload.
     */
    public fire<K extends keyof TriforgeEvents>(event: K, data: TriforgeEvents[K]): void {
        if (!this._emitters.has(event)) {
            this._emitters.set(event, new vscode.EventEmitter<TriforgeEvents[K]>());
        }
        this._emitters.get(event)!.fire(data);
    }

    /**
     * Subscribe to an event. Returns a Disposable to unsubscribe.
     */
    public on<K extends keyof TriforgeEvents>(event: K, listener: (e: TriforgeEvents[K]) => any, thisArgs?: any, disposables?: vscode.Disposable[]): vscode.Disposable {
        if (!this._emitters.has(event)) {
            this._emitters.set(event, new vscode.EventEmitter<TriforgeEvents[K]>());
        }
        return this._emitters.get(event)!.event(listener, thisArgs, disposables);
    }

    /**
     * Dispose all emitters.
     */
    public dispose(): void {
        for (const emitter of this._emitters.values()) {
            emitter.dispose();
        }
        this._emitters.clear();
    }
}
