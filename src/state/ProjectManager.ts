import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EventBus } from './EventBus';

import { Logger } from '../utils/Logger';

export interface TriforgeProject {
    id: string;
    name: string;
    path: string;
    demPath?: string;
    utmZone?: string;
    datum?: string;
    utmHeader?: {
        ncols: number;
        nrows: number;
        xllcorner: number;
        yllcorner: number;
        cellsize: number;
        NODATA_value: number;
    };
    simulationStart?: string;
    timezone?: string;
    demVisible?: boolean; // Default true
    initialInputPath?: string;
    qx_infile?: string;
    qy_infile?: string;
    num_sources?: number;
    src_loc_file?: string;
    hydrograph_filename?: string;
    outputs?: {
        output_directory?: string;
        geotiff?: string[];
        binary?: string[];
        ascii?: string[];
    };
    apiKeys?: {
        openTopography?: string;
        [key: string]: string | undefined;
    };
    epsg?: string | number;
    is_docker_target?: boolean;
    triton_target?: string;
    executable_target_mode?: 'source' | 'executable' | 'docker';
    source_dir?: string;
    build_dir?: string;

    execution_type?: 'interactive' | 'batch';

    // Execution Configuration
    run_directory?: string;
    run_command?: string;
    env_variables?: string;

    // Batch Configuration
    batch_header?: string;
    batch_submit_command?: string;
    step_launch_command?: string;

    // Output Generation
    print_option?: string;
    print_interval?: number;
    print_observation?: number;
    // output_format?: string; // Moved to Settings/Top-level
    projection?: string;
    output_option?: string;
    outfile_pattern?: string;
    it_print?: number;


    // Simulation Parameters
    sim_start_time?: number;
    sim_duration?: number;
    checkpoint_id?: number;
    time_increment_fixed?: number; // 0 or 1
    time_step?: number;
    it_count?: number;
    courant?: number;
    gpu_direct_flag?: number;
    domain_decomposition?: string;
    factor_interval_domain_decomposition?: number;
    open_boundaries?: number;

    createdAt: number;
    lastModified: number;
    input_format?: 'ASC' | 'BIN';
    output_format?: 'ASC' | 'BIN' | 'GTIFF';
}

export class ProjectManager {
    private static _instance: ProjectManager;
    private _activeProject: TriforgeProject | undefined;
    private _projects: TriforgeProject[] = [];

    // SEC-2: the OpenTopography API key is a secret. It must NOT be persisted in
    // plaintext config.json; instead it lives in VS Code SecretStorage, keyed per
    // project. The reference is threaded in from activate() via initialize().
    private _secrets: vscode.SecretStorage | undefined;

    private constructor() { }

    public static get instance(): ProjectManager {
        if (!this._instance) {
            this._instance = new ProjectManager();
        }
        return this._instance;
    }

    public async initialize(context?: vscode.ExtensionContext): Promise<void> {
        if (context) {
            this._secrets = context.secrets;
        }

        // Skip migration for now as we are strictly switching to new system
        this._loadProjects();

        // SEC-2: hydrate in-memory apiKeys from SecretStorage and migrate any
        // pre-existing plaintext keys that _loadProjects scrubbed from config.json.
        await this._hydrateApiKeysFromSecrets();
    }

    // ---- SEC-2: OpenTopography API key in SecretStorage ---------------------

    private _apiKeySecretId(projectId: string): string {
        return `triforge.opentopography.apiKey.${projectId}`;
    }

    /** Read the OpenTopography API key for a project from SecretStorage. */
    public async getOpenTopographyApiKey(projectId: string): Promise<string | undefined> {
        if (!this._secrets || !projectId) return undefined;
        try {
            return await this._secrets.get(this._apiKeySecretId(projectId));
        } catch (err) {
            // Never log the key value; only that a read failed.
            Logger.error('[ProjectManager] Failed to read API key from SecretStorage', err);
            return undefined;
        }
    }

    /**
     * Persist the OpenTopography API key for a project into SecretStorage (and
     * mirror it onto the in-memory project so synchronous readers keep working).
     * Never written to config.json. Passing an empty/undefined key deletes it.
     */
    public async setOpenTopographyApiKey(projectId: string, apiKey: string | undefined): Promise<void> {
        if (!projectId) return;
        const project = this._projects.find(p => p.id === projectId)
            ?? (this._activeProject?.id === projectId ? this._activeProject : undefined);
        if (project) {
            if (!project.apiKeys) project.apiKeys = {};
            project.apiKeys.openTopography = apiKey || undefined;
        }
        if (!this._secrets) return;
        try {
            if (apiKey) {
                await this._secrets.store(this._apiKeySecretId(projectId), apiKey);
            } else {
                await this._secrets.delete(this._apiKeySecretId(projectId));
            }
        } catch (err) {
            // Never log the key value; only that a write failed.
            Logger.error('[ProjectManager] Failed to persist API key to SecretStorage', err);
        }
    }

    /**
     * Move a plaintext OpenTopography key found in a loaded config.json into
     * SecretStorage and scrub it from the file. The config strip is synchronous
     * so the secret leaves the shared workspace file immediately on load; the
     * SecretStorage write is fire-and-forget (errors are logged, never the key).
     */
    private _migratePlaintextApiKey(
        projectPath: string,
        projectId: string,
        plaintextKey: string,
        loadedJson: any,
    ): void {
        // Strip the plaintext key from the on-disk config (synchronous).
        try {
            const configFile = path.join(projectPath, 'config.json');
            if (loadedJson?.input?.apiKeys) {
                delete loadedJson.input.apiKeys;
            }
            this._writeFileAtomic(configFile, JSON.stringify(loadedJson, null, 2));
            Logger.info(`[ProjectManager] Migrated OpenTopography API key to SecretStorage for project ${projectId} (scrubbed from config.json)`);
        } catch (err) {
            Logger.error(`[ProjectManager] Failed to scrub plaintext API key from ${projectPath}`, err);
        }

        // Persist into SecretStorage + mirror onto the in-memory project.
        void this.setOpenTopographyApiKey(projectId, plaintextKey);
    }

    /** Populate each loaded project's in-memory apiKeys from SecretStorage. */
    private async _hydrateApiKeysFromSecrets(): Promise<void> {
        if (!this._secrets) return;
        for (const project of this._projects) {
            const key = await this.getOpenTopographyApiKey(project.id);
            if (key) {
                if (!project.apiKeys) project.apiKeys = {};
                project.apiKeys.openTopography = key;
            }
        }
    }

    public get activeProject(): TriforgeProject | undefined {
        return this._activeProject;
    }

    public setActiveProject(project: TriforgeProject | undefined): void {
        if (this._activeProject?.id !== project?.id) {
            this._activeProject = project;
            vscode.commands.executeCommand('setContext', 'triforge:hasActiveProject', !!project);
            EventBus.instance.fire('project:activeChanged', { projectId: project?.id });
        }
    }

    public removeProject(projectId: string): void {
        const index = this._projects.findIndex(p => p.id === projectId);
        if (index !== -1) {

            this._projects.splice(index, 1);

            // Validate workspace path before saving
            const { GlobalSettingsManager } = require('./GlobalSettingsManager');
            const settings = GlobalSettingsManager.instance.getSettings();
            if (settings.workspacePath) {
                this._saveProjectsList(settings.workspacePath);
            }

            if (this._activeProject?.id === projectId) {
                this.setActiveProject(undefined);
            }

            EventBus.instance.fire('project:listChanged', undefined);
        }
    }

    public addProject(
        name: string,
        projectPath: string,
        demPath?: string,
        utmZone?: string,
        datum?: string,
        utmHeader?: TriforgeProject['utmHeader'],
        simulationStart?: string,
        timezone?: string,
        inputFormat: 'ASC' | 'BIN' = 'ASC',
        outputFormat: 'ASC' | 'BIN' | 'GTIFF' = 'ASC'
    ): TriforgeProject {
        // Reuse-in-place when a project is already registered at this path (the
        // ProjectCreator now allows targeting an existing folder). Minting a fresh
        // UUID here and skipping the registry update would clobber config.json with
        // a new id while the in-memory list + projects.json kept the old one —
        // permanently diverging disk from memory. Preserve the existing id and
        // createdAt, and update the list entry in place.
        const existing = this._projects.find(p => p.path === projectPath);
        const id = existing?.id ?? crypto.randomUUID();

        const newProject: TriforgeProject = {
            id,
            name,
            path: projectPath,
            demPath,
            utmZone,
            datum,
            utmHeader,
            simulationStart,
            timezone,
            input_format: inputFormat,
            output_format: outputFormat,
            demVisible: true,
            outputs: {
                output_directory: path.join(projectPath, 'output')
            },
            createdAt: existing?.createdAt ?? Date.now(),
            lastModified: Date.now()
        };

        try {
            // Write config.json
            Logger.info(`[ProjectManager] ${existing ? 'Updating' : 'Adding'} project: ${name}`);
            this._writeProjectConfig(newProject);

            // Register a new project, or replace the existing entry in place, so the
            // in-memory list + projects.json never diverge from the config we wrote.
            if (existing) {
                this._projects[this._projects.indexOf(existing)] = newProject;
            } else {
                this._projects.push(newProject);
            }

            const { GlobalSettingsManager } = require('./GlobalSettingsManager');
            const settings = GlobalSettingsManager.instance.getSettings();
            if (settings.workspacePath) {
                this._saveProjectsList(settings.workspacePath);
            } else {
                vscode.window.showErrorMessage("Global Workspace Path is not set. Cannot save project list.", { modal: true });
            }

            EventBus.instance.fire('project:listChanged', undefined);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to create project: ${err.message}`, { modal: true });
            throw err;
        }

        return newProject;
    }

    public updateProject(updatedProject: TriforgeProject): void {
        const index = this._projects.findIndex(p => p.id === updatedProject.id);
        if (index !== -1) {
            // BUG-9: the passed-in project is the source of truth. Persist it
            // FIRST and only mutate internal state after the write succeeds, so
            // a failed write cannot leave disk and memory diverged. We also take
            // our own internal copy so a later caller-side mutation of the same
            // object reference cannot retroactively alter stored state.
            const internalCopy = structuredClone(updatedProject);
            try {
                this._writeProjectConfig(internalCopy);

                this._projects[index] = internalCopy;
                if (this._activeProject?.id === internalCopy.id) {
                    this._activeProject = internalCopy;
                }
                EventBus.instance.fire('project:listChanged', undefined);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to update project config: ${err.message}`, { modal: true });
            }
        }
    }

    /**
     * Register (or refresh) a project the archive import just materialized on
     * disk — `<projectPath>/config.json` is the source of truth and is parsed
     * by the SAME strict loader as startup (_loadProjectFromPath). A project
     * with the same id (or path) is replaced in place (merge); otherwise the
     * project is appended. Persists projects.json and fires
     * project:listChanged. apiKeys are untouched (SecretStorage only).
     */
    public registerImportedProject(projectPath: string): TriforgeProject | undefined {
        const loaded = this._loadProjectFromPath(projectPath);
        if (!loaded) return undefined;

        const index = this._projects.findIndex(
            p => p.id === loaded.id || path.resolve(p.path) === path.resolve(projectPath),
        );
        if (index !== -1) {
            this._projects[index] = loaded;
        } else {
            this._projects.push(loaded);
        }
        if (this._activeProject?.id === loaded.id) {
            this._activeProject = loaded;
        }

        const { GlobalSettingsManager } = require('./GlobalSettingsManager');
        const settings = GlobalSettingsManager.instance.getSettings();
        if (settings.workspacePath) {
            this._saveProjectsList(settings.workspacePath);
        } else {
            vscode.window.showErrorMessage('Global Workspace Path is not set. Cannot save project list.', { modal: true });
        }

        EventBus.instance.fire('project:listChanged', undefined);
        return loaded;
    }

    // BUG-10: persist full-file JSON atomically. Writing straight to the
    // destination lets a crash/interleave mid-write leave a truncated file that
    // then fails JSON.parse and triggers the "invalid configuration" loss path.
    // We write to a sibling temp file and rename it into place: rename is atomic
    // on the same filesystem, so the destination is only ever the complete old
    // payload or the complete new one — never a partial write.
    private _writeFileAtomic(filePath: string, contents: string): void {
        const tmpPath = `${filePath}.tmp`;
        fs.writeFileSync(tmpPath, contents);
        fs.renameSync(tmpPath, filePath);
    }

    private _writeProjectConfig(project: TriforgeProject) {
        try {
            if (!fs.existsSync(project.path)) {
                fs.mkdirSync(project.path, { recursive: true });
            }
            const configFile = path.join(project.path, 'config.json');

            const data = {
                version: '1.0.0',
                settings: {
                    id: project.id,
                    name: project.name,
                    path: project.path,
                    utmZone: project.utmZone,
                    datum: project.datum,
                    utmHeader: project.utmHeader,
                    simulationStart: project.simulationStart,
                    timezone: project.timezone,
                    demVisible: project.demVisible,
                    input_format: project.input_format,
                    output_format: project.output_format,
                    createdAt: project.createdAt,
                    lastModified: project.lastModified
                },
                input: {
                    dem: project.demPath,
                    initialInput: project.initialInputPath,
                    qx_infile: project.qx_infile,
                    qy_infile: project.qy_infile,
                    // input_format mapped to settings now
                    // If we had others they would go here.
                    // SEC-2: apiKeys are NEVER written here — the OpenTopography
                    // key is a secret and lives in VS Code SecretStorage (see
                    // setOpenTopographyApiKey). Persisting it in plaintext
                    // config.json exposed it on disk / in shared workspaces.
                    num_sources: project.num_sources,
                    src_loc_file: project.src_loc_file,
                    hydrograph_filename: project.hydrograph_filename
                },
                output: project.outputs, // Output node (unchanged)
                compsetup: {
                    is_docker_target: project.is_docker_target,
                    triton_target: project.triton_target,
                    executable_target_mode: project.executable_target_mode,
                    source_dir: project.source_dir,
                    build_dir: project.build_dir,
                    sim_start_time: project.sim_start_time,
                    sim_duration: project.sim_duration,
                    checkpoint_id: project.checkpoint_id,
                    time_increment_fixed: project.time_increment_fixed,
                    time_step: project.time_step,
                    it_count: project.it_count,
                    courant: project.courant,
                    gpu_direct_flag: project.gpu_direct_flag,
                    domain_decomposition: project.domain_decomposition,
                    factor_interval_domain_decomposition: project.factor_interval_domain_decomposition,
                    open_boundaries: project.open_boundaries
                },
                execution: {
                    execution_type: project.execution_type,
                    run_directory: project.run_directory,
                    run_command: project.run_command,
                    env_variables: project.env_variables,
                    batch_header: project.batch_header,
                    batch_submit_command: project.batch_submit_command,
                    step_launch_command: project.step_launch_command,

                    // Output Generation
                    print_option: project.print_option,
                    print_interval: project.print_interval,
                    print_observation: project.print_observation,
                    // output_format mapped to settings now
                    projection: project.projection,
                    output_option: project.output_option,
                    outfile_pattern: project.outfile_pattern,
                    it_print: project.it_print
                }
            };
            this._writeFileAtomic(configFile, JSON.stringify(data, null, 2));
        } catch (err) {
            Logger.error(`[ProjectManager] Failed to write config.json for ${project.path}`, err);
            throw err;
        }
    }

    public getProjects(): TriforgeProject[] {
        // BUG-9: return frozen deep clones so a mutation of a returned project
        // (e.g. MapEditor's `p.demVisible = true`) cannot leak into internal
        // state before/instead of a successful persist. Callers must route any
        // change back through updateProject(), which is the source of truth.
        return this._projects.map(p => Object.freeze(structuredClone(p)));
    }

    private _loadProjects(): void {
        const { GlobalSettingsManager } = require('./GlobalSettingsManager');
        const settings = GlobalSettingsManager.instance.getSettings();
        const workspacePath = settings.workspacePath;

        this._projects = [];

        if (!workspacePath) {
            // No workspace path set, nothing to load.
            Logger.warn("[ProjectManager] No workspace path configured.");
            return;
        }

        const isTriforgeDir = path.basename(workspacePath) === '.triforge';
        const triforgeDir = isTriforgeDir ? workspacePath : path.join(workspacePath, '.triforge');
        const projectsJsonPath = path.join(triforgeDir, 'projects.json');

        Logger.info(`[ProjectManager] Loading projects from: ${projectsJsonPath} `);

        try {
            // Ensure .triforge dir exists
            if (!fs.existsSync(triforgeDir)) {
                Logger.info(`[ProjectManager].triforge directory not found at ${triforgeDir}. Creating...`);
                fs.mkdirSync(triforgeDir, { recursive: true });
            }

            // Read or Create projects.json
            if (!fs.existsSync(projectsJsonPath)) {
                Logger.info(`[ProjectManager] projects.json not found.Creating new empty list.`);
                const initialData = { triforge: { projectpaths: [] } };
                this._writeFileAtomic(projectsJsonPath, JSON.stringify(initialData, null, 2));
            }

            const projectsContent = fs.readFileSync(projectsJsonPath, 'utf8');
            Logger.info(`[ProjectManager] projects.json content: ${projectsContent} `);

            let projectsData;
            try {
                projectsData = JSON.parse(projectsContent);
            } catch (e) {
                Logger.error(`[ProjectManager] Failed to JSON parse projects.json`, e);
                return;
            }

            const paths: string[] = projectsData.triforge?.projectpaths || [];
            Logger.info(`[ProjectManager] Found ${paths.length} project paths.`);

            for (const pPath of paths) {
                const loaded = this._loadProjectFromPath(pPath);
                if (loaded) {
                    this._projects.push(loaded);
                }
            }
            Logger.info(`[ProjectManager] Loaded ${this._projects.length} projects total.`);

        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to load projects list: ${err.message} `, { modal: true });
            Logger.error(`[ProjectManager] Fatal error in _loadProjects`, err);
        }
    }

    /**
     * Load ONE project from `<pPath>/config.json` with the same strict
     * parsing, validation, messaging and SEC-2 plaintext-key migration as
     * startup loading (extracted from the _loadProjects loop; also used by
     * registerImportedProject so the archive import goes through the single
     * source-of-truth loader). Returns undefined when missing/invalid.
     */
    private _loadProjectFromPath(pPath: string): TriforgeProject | undefined {
        try {
            const configFile = path.join(pPath, 'config.json');
            if (!fs.existsSync(configFile)) {
                // Project path exists in list but config is missing.
                vscode.window.showErrorMessage(`Project config missing at: ${pPath} `, { modal: true });
                Logger.warn(`[ProjectManager] Config missing for path: ${pPath} `);
                return undefined;
            }
            const content = fs.readFileSync(configFile, 'utf8');
            const json = JSON.parse(content);
            const data = json.settings;

            if (!data) {
                Logger.warn(`[ProjectManager] Skipped ${pPath}: missing 'settings' node in config.json`);
                return undefined;
            }

            // Validate minimal fields
            if (!(data && data.id && data.name)) {
                Logger.warn(`[ProjectManager] Skipped ${pPath}: missing id or name in settings`);
                return undefined;
            }
            Logger.info(`[ProjectManager] Successfully loaded project '${data.name}' from ${pPath} `);

            // Strict Loading - New Structure Only
            if (!json.input || !json.compsetup || !json.execution) {
                Logger.warn(`[ProjectManager] Skipped ${pPath}: invalid config structure (missing input, compsetup, or execution sections). Please remove and recreate project.`);
                vscode.window.showErrorMessage(`Project '${data.name}' has an outdated or invalid configuration structure. Please remove this project and recreate it.`, { modal: true });
                return undefined;
            }

            const comp = json.compsetup;
            const exec = json.execution;

            const project: TriforgeProject = {
                id: data.id,
                name: data.name,
                path: pPath,
                demPath: json.input.dem,
                initialInputPath: json.input.initialInput,
                qx_infile: json.input.qx_infile,
                qy_infile: json.input.qy_infile,
                num_sources: json.input.num_sources,
                src_loc_file: json.input.src_loc_file,
                hydrograph_filename: json.input.hydrograph_filename,
                input_format: data.input_format || json.input.input_format || 'ASC', // Fallback to old location for compat if needed, or default
                utmZone: data.utmZone,
                datum: data.datum,
                utmHeader: data.utmHeader,
                simulationStart: data.simulationStart,
                timezone: data.timezone,
                demVisible: data.demVisible !== undefined ? data.demVisible : true,
                outputs: json.output,
                // SEC-2: apiKeys are hydrated from SecretStorage
                // (see _hydrateApiKeysFromSecrets), never trusted
                // from plaintext config.json. Any plaintext key
                // still on disk is migrated + scrubbed below.
                apiKeys: undefined,
                epsg: data.epsg,

                is_docker_target: comp.is_docker_target,
                triton_target: comp.triton_target,
                executable_target_mode: comp.executable_target_mode,
                source_dir: comp.source_dir,
                build_dir: comp.build_dir,

                sim_start_time: comp.sim_start_time,
                sim_duration: comp.sim_duration,
                checkpoint_id: comp.checkpoint_id,
                time_increment_fixed: comp.time_increment_fixed,
                time_step: comp.time_step,
                it_count: comp.it_count,
                courant: comp.courant,
                gpu_direct_flag: comp.gpu_direct_flag,
                domain_decomposition: comp.domain_decomposition,
                factor_interval_domain_decomposition: comp.factor_interval_domain_decomposition,
                open_boundaries: comp.open_boundaries,

                execution_type: exec.execution_type,
                run_directory: exec.run_directory,
                run_command: exec.run_command,
                env_variables: exec.env_variables,
                batch_header: exec.batch_header,
                batch_submit_command: exec.batch_submit_command,
                step_launch_command: exec.step_launch_command,

                // Output Generation
                print_option: exec.print_option,
                print_interval: exec.print_interval,
                print_observation: exec.print_observation,
                output_format: data.output_format || exec.output_format || 'ASC', // Fallback to old loc
                projection: exec.projection,
                output_option: exec.output_option,
                outfile_pattern: exec.outfile_pattern,
                it_print: exec.it_print,

                createdAt: data.createdAt || Date.now(),
                lastModified: data.lastModified || Date.now()
            };

            // SEC-2: migrate any pre-existing PLAINTEXT API key out
            // of config.json into SecretStorage, then strip it from
            // the on-disk config so the secret no longer sits in a
            // shared workspace file. Never log the key value.
            const plaintextKey = json.input?.apiKeys?.openTopography;
            if (plaintextKey) {
                this._migratePlaintextApiKey(pPath, data.id, plaintextKey, json);
                // Pre-extraction, the project was already pushed into
                // _projects when migration ran, so setOpenTopographyApiKey's
                // synchronous in-memory mirror found it there. Here migration
                // runs BEFORE the caller registers the returned project, so
                // mirror the key onto the object we return — otherwise, when
                // SecretStorage is unavailable, the key would be scrubbed
                // from disk AND absent from memory (lost for the session).
                if (!project.apiKeys) project.apiKeys = {};
                project.apiKeys.openTopography = plaintextKey;
            }

            return project;
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to load project at ${pPath}: ${err.message} `, { modal: true });
            Logger.error(`[ProjectManager] Exception loading project at ${pPath} `, err);
            return undefined;
        }
    }

    private _saveProjectsList(workspacePath: string): void {
        try {
            const isTriforgeDir = path.basename(workspacePath) === '.triforge';
            const triforgeDir = isTriforgeDir ? workspacePath : path.join(workspacePath, '.triforge');
            if (!fs.existsSync(triforgeDir)) {
                fs.mkdirSync(triforgeDir, { recursive: true });
            }
            const projectsJsonPath = path.join(triforgeDir, 'projects.json');

            const projectPaths = this._projects.map(p => p.path);
            const data = {
                triforge: {
                    projectpaths: projectPaths
                }
            };

            this._writeFileAtomic(projectsJsonPath, JSON.stringify(data, null, 2));
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to save projects list: ${err.message} `, { modal: true });
        }
    }

    public async scanAndAddOutputs(directory: string): Promise<number> {
        if (!this._activeProject) return 0;
        if (!fs.existsSync(directory)) return 0;

        const updatedProject = { ...this._activeProject };
        if (!updatedProject.outputs) updatedProject.outputs = {};
        if (!updatedProject.outputs.geotiff) updatedProject.outputs.geotiff = [];
        if (!updatedProject.outputs.binary) updatedProject.outputs.binary = [];
        if (!updatedProject.outputs.ascii) updatedProject.outputs.ascii = [];

        // Helper: Categorize. VIEW-2: read the first bytes of a `.out` file
        // asynchronously (off the host thread) instead of openSync/readSync.
        const categorize = async (filePath: string): Promise<'geotiff' | 'binary' | 'ascii' | null> => {
            const ext = path.extname(filePath).toLowerCase();
            if (ext === '.vrt') return 'geotiff';
            if (ext === '.out') {
                let handle: fs.promises.FileHandle | undefined;
                try {
                    handle = await fs.promises.open(filePath, 'r');
                    const buffer = new Uint8Array(1024);
                    const { bytesRead } = await handle.read(buffer, 0, 1024, 0);
                    for (let i = 0; i < bytesRead; i++) {
                        if (buffer[i] === 0) return 'binary';
                    }
                    return 'ascii';
                } catch (e) {
                    return 'binary';
                } finally {
                    await handle?.close().catch(() => { });
                }
            }
            return null;
        };

        // VIEW-2: one shared async walker — recurse via fs.promises.readdir
        // ({ withFileTypes: true }) so the scan never blocks the extension-host
        // thread (no readdirSync/statSync per entry).
        const collectFiles = async (dir: string, fileList: string[]): Promise<void> => {
            let items: fs.Dirent[];
            try {
                items = await fs.promises.readdir(dir, { withFileTypes: true });
            } catch (e) {
                Logger.warn(`[ProjectManager] Skipping directory scan: ${dir}`);
                return;
            }
            for (const item of items) {
                const fullPath = path.join(dir, item.name);
                try {
                    if (item.isDirectory()) {
                        await collectFiles(fullPath, fileList);
                    } else if (item.isFile()) {
                        const ext = path.extname(fullPath).toLowerCase();
                        if (ext === '.vrt' || ext === '.out') {
                            fileList.push(fullPath);
                        }
                    }
                } catch (ign) { }
            }
        };

        const foundFiles: string[] = [];
        await collectFiles(directory, foundFiles);

        let addedCount = 0;
        for (const file of foundFiles) {
            const type = await categorize(file);
            if (type) {
                const list = updatedProject.outputs[type]!;
                if (!list.includes(file)) {
                    list.push(file);
                    addedCount++;
                }
            }
        }

        // Keep output_directory consistent with where the registered files actually
        // live. The caller (ExecutionSetupEditor._updateOutputPaths) relocates outputs
        // to the canonical <project>/output and passes that as `directory` on the happy
        // path, so output_directory becomes canonical there; if relocation failed it
        // points at the real (non-canonical) location instead of lying about it.
        const dirChanged = updatedProject.outputs.output_directory !== directory;
        if (dirChanged) {
            updatedProject.outputs.output_directory = directory;
        }

        if (addedCount > 0 || dirChanged) {
            this.updateProject(updatedProject);
        }

        return addedCount;
    }
}
