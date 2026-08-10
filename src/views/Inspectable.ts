import * as vscode from 'vscode';

/**
 * A single row in the Properties View.
 */
export interface PropertyItem {
    key: string;
    value: string;
    group?: string; // Optional grouping (e.g., 'File Info', 'Project Meta')
    command?: vscode.Command; // Optional action (e.g., clicking 'Project Path' opens it)
}

/**
 * Protocol for items that can display properties.
 */
export interface Inspectable {
    getProperties(): Promise<PropertyItem[]>;
    getLabel(): string;
}

/**
 * Helper to check if an object implements Inspectable.
 */
export function isInspectable(obj: any): obj is Inspectable {
    return obj && typeof obj.getProperties === 'function';
}
