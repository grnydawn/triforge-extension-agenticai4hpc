import * as vscode from 'vscode';

interface ProjectSchemaV1 {
    id: string;
    name: string;
    path: string;
    createdAt: number;
}

// Example V2 schema with description
interface ProjectSchemaV2 extends ProjectSchemaV1 {
    description?: string;
    lastOpened?: number;
}

export class MigrationManager {
    static readonly CURRENT_VERSION = 2;
    static readonly KEY_VERSION = 'triforge.version';
    static readonly KEY_PROJECTS = 'triforge.projects';

    static async migrate(context: vscode.ExtensionContext): Promise<void> {
        const storedVersion = context.globalState.get<number>(this.KEY_VERSION, 0);

        if (storedVersion < this.CURRENT_VERSION) {
            // Perform migrations
            if (storedVersion < 1) {
                // Initial setup or migration from v0
                // no-op for now unless we had legacy data
            }

            if (storedVersion < 2) {
                // Migrate V1 to V2
                const projects = context.globalState.get<ProjectSchemaV1[]>(this.KEY_PROJECTS, []);
                const migratedProjects: ProjectSchemaV2[] = projects.map(p => ({
                    ...p,
                    description: '',
                    lastOpened: Date.now()
                }));
                await context.globalState.update(this.KEY_PROJECTS, migratedProjects);
            }

            // Update version
            await context.globalState.update(this.KEY_VERSION, this.CURRENT_VERSION);
        }
    }
}
