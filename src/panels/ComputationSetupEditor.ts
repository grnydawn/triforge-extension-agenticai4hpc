import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { Logger } from '../utils/Logger';
import { getComputationSetupHtml } from './templates/ComputationSetupHtml';
import { ProjectManager } from '../state/ProjectManager';

export class ComputationSetupEditor {
    public static currentPanel: ComputationSetupEditor | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    // The currently-running build child, stored so dispose() can kill it and so a
    // second build can be rejected while one is active. Cleared on exit.
    private _runningChild: cp.ChildProcess | undefined;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.type) {
                    case 'log':
                        Logger.info(`[ComputationSetup] ${message.text}`);
                        return;
                    case 'alert':
                        vscode.window.showWarningMessage(message.text, { modal: true });
                        return;
                    case 'browseExecutable':
                        this._handleBrowseExecutable();
                        return;
                    case 'browseSource':
                        this._handleBrowseSource();
                        return;
                    case 'browseBuildDir':
                        this._handleBrowseBuildDir();
                        return;
                    case 'buildNow':
                        this._handleBuildNow(message);
                        return;
                    case 'downloadDocker':
                        this._handleDownloadDocker(message);
                        return;
                    case 'saveSettings':
                        if (ProjectManager.instance.activeProject) {
                            // Validation Logic
                            const mode = message.executable_target_mode;
                            let isValid = true;
                            let error = '';

                            if (mode === 'source') {
                                const buildDir = message.build_dir || '';
                                if (!buildDir) {
                                    isValid = false;
                                    error = 'Build directory is not specified.';
                                } else {
                                    const tritonExe = path.join(buildDir, 'triton.exe');
                                    if (!fs.existsSync(tritonExe)) {
                                        isValid = false;
                                        error = `TRITON executable not found in build directory: ${tritonExe}. Please build the project successfully.`;
                                    }
                                }
                            } else if (mode === 'executable') {
                                const exePath = message.triton_target || '';
                                if (!exePath || !fs.existsSync(exePath)) {
                                    isValid = false;
                                    error = `TRITON executable not found at: ${exePath}. Please select a valid executable.`;
                                }
                            } else if (mode === 'docker') {
                                const image = message.triton_target || '';
                                if (!image) {
                                    isValid = false;
                                    error = 'Docker image name is missing.';
                                }
                            }

                            if (!isValid) {
                                vscode.window.showWarningMessage(error, { modal: true });
                                return;
                            }

                            const updatedProject = { ...ProjectManager.instance.activeProject };

                            // Map incoming message data to project fields
                            if (message.is_docker_target !== undefined) updatedProject.is_docker_target = message.is_docker_target;
                            if (message.triton_target !== undefined) updatedProject.triton_target = message.triton_target;
                            if (message.executable_target_mode) updatedProject.executable_target_mode = message.executable_target_mode;
                            if (message.source_dir !== undefined) updatedProject.source_dir = message.source_dir;
                            if (message.build_dir !== undefined) updatedProject.build_dir = message.build_dir;

                            if (message.simulationStart) updatedProject.simulationStart = message.simulationStart;
                            if (message.timezone) updatedProject.timezone = message.timezone;

                            // Save new parameters
                            updatedProject.sim_start_time = message.sim_start_time;
                            updatedProject.sim_duration = message.sim_duration;
                            updatedProject.time_increment_fixed = message.time_increment_fixed;
                            updatedProject.time_step = message.time_step;
                            // it_count & checkpoint_id moved to Execution Setup
                            updatedProject.print_option = message.print_option;
                            updatedProject.print_interval = message.print_interval;
                            updatedProject.courant = message.courant;
                            updatedProject.gpu_direct_flag = message.gpu_direct_flag;
                            updatedProject.domain_decomposition = message.domain_decomposition;
                            updatedProject.factor_interval_domain_decomposition = message.factor_interval_domain_decomposition;
                            updatedProject.open_boundaries = message.open_boundaries;

                            ProjectManager.instance.updateProject(updatedProject);
                            vscode.window.showInformationMessage('Settings saved.');
                        }
                        this.dispose();
                        return;
                    case 'cancel':
                        this.dispose();
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        const activeProject = ProjectManager.instance.activeProject;
        const panelTitle = activeProject ? `Computation Setup (${activeProject.name})` : 'Computation Setup';

        if (ComputationSetupEditor.currentPanel) {
            ComputationSetupEditor.currentPanel._panel.title = panelTitle;
            ComputationSetupEditor.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'triforgeComputationSetup',
            panelTitle,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(extensionUri.fsPath, 'media')),
                    vscode.Uri.file(path.join(extensionUri.fsPath, 'dist'))
                ]
            }
        );

        ComputationSetupEditor.currentPanel = new ComputationSetupEditor(panel, extensionUri);
    }

    private async _handleBrowseExecutable() {
        const activeProject = ProjectManager.instance.activeProject;
        const options: vscode.OpenDialogOptions = {
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: 'Select TRITON Executable'
        };

        if (activeProject && activeProject.path) {
            const defaultBuild = path.join(activeProject.path, 'build');
            if (fs.existsSync(defaultBuild)) {
                options.defaultUri = vscode.Uri.file(defaultBuild);
            } else {
                options.defaultUri = vscode.Uri.file(activeProject.path);
            }
        }

        const uri = await vscode.window.showOpenDialog(options);
        if (uri && uri[0]) {
            this._panel.webview.postMessage({ command: 'updateExecutablePath', path: uri[0].fsPath });
        }
    }

    private async _handleBrowseSource() {
        const activeProject = ProjectManager.instance.activeProject;
        const options: vscode.OpenDialogOptions = {
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select TRITON Source Directory'
        };

        if (activeProject && activeProject.path) {
            options.defaultUri = vscode.Uri.file(activeProject.path);
        }

        const uri = await vscode.window.showOpenDialog(options);
        if (uri && uri[0]) {
            this._panel.webview.postMessage({ command: 'updateSourcePath', path: uri[0].fsPath });
        }
    }

    private async _handleBrowseBuildDir() {
        const activeProject = ProjectManager.instance.activeProject;
        const options: vscode.OpenDialogOptions = {
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Build Directory'
        };

        if (activeProject && activeProject.path) {
            options.defaultUri = vscode.Uri.file(activeProject.path);
            if (fs.existsSync(path.join(activeProject.path, 'build'))) {
                options.defaultUri = vscode.Uri.file(path.join(activeProject.path, 'build'));
            }
        }

        const uri = await vscode.window.showOpenDialog(options);
        if (uri && uri[0]) {
            this._panel.webview.postMessage({ command: 'updateBuildDirPath', path: uri[0].fsPath });
        }
    }

    private _handleBuildNow(message: any) {
        const { text, dir } = message;
        if (!text || !dir) {
            vscode.window.showErrorMessage('Build command or directory missing.');
            return;
        }

        // Build-in-progress guard: reject a second build while one is still active
        // so we never orphan or stack concurrent build children.
        if (this._runningChild) {
            this._panel.webview.postMessage({ command: 'appendBuildLog', text: '\n> A build is already running. Please wait for it to finish before starting another.\n' });
            // Non-modal: a modal here would block the panel from closing (and thus
            // block dispose() from killing the active child).
            vscode.window.showWarningMessage('A build is already running. Please wait for it to finish before starting another.');
            return;
        }

        this._panel.webview.postMessage({ command: 'appendBuildLog', text: `\n> Executing: ${text}\n> Directory: ${dir}\n\n` });

        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
                this._panel.webview.postMessage({ command: 'appendBuildLog', text: `> Created directory: ${dir}\n` });
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to create build directory: ${error.message}`);
                this._panel.webview.postMessage({ command: 'appendBuildLog', text: `\nError: Failed to create build directory ${dir}\n` });
                return;
            }
        }

        const env = { ...process.env };
        // Add build directory to PATH
        // Platform specific path separator? Node handles it usually but for env var:
        const pathSeparator = process.platform === 'win32' ? ';' : ':';
        env.PATH = `${dir}${pathSeparator}${env.PATH}`;

        const child = cp.spawn(text, {
            cwd: dir,
            shell: true,
            // Own process group so dispose() can kill the whole build tree.
            detached: true,
            env: env
        });

        // Track the live build child so dispose() can kill it and the guard can
        // reject concurrent builds.
        this._runningChild = child;

        child.stdout.on('data', (data) => {
            this._panel.webview.postMessage({ command: 'appendBuildLog', text: data.toString() });
        });

        child.stderr.on('data', (data) => {
            this._panel.webview.postMessage({ command: 'appendBuildLog', text: data.toString() });
        });

        child.on('error', (error) => {
            this._panel.webview.postMessage({ command: 'appendBuildLog', text: `\nError: ${error.message}\n` });
            this._panel.webview.postMessage({ command: 'buildComplete', success: false });
            if (this._runningChild === child) {
                this._runningChild = undefined;
            }
        });

        child.on('close', (code) => {
            this._panel.webview.postMessage({ command: 'appendBuildLog', text: `\nProcess exited with code ${code}\n` });

            if (this._runningChild === child) {
                this._runningChild = undefined;
            }

            // Check for triton.exe
            const exePath = path.join(dir, 'triton.exe');
            if (fs.existsSync(exePath)) {
                this._panel.webview.postMessage({ command: 'buildComplete', success: true });
                // Optionally update the executable path input if it was empty?
                this._panel.webview.postMessage({ command: 'updateExecutablePath', path: exePath });
            } else {
                this._panel.webview.postMessage({ command: 'buildComplete', success: false });
            }
        });
    }

    private _handleDownloadDocker(message: any) {
        const { image } = message;
        if (!image) {
            vscode.window.showErrorMessage('Docker image name missing.');
            return;
        }

        // SEC-6: validate the image against the legal docker reference charset
        // BEFORE interpolating it into a shell command. A metacharacter payload
        // such as `$(touch x)` is rejected here so no side-effect command runs.
        if (!/^[A-Za-z0-9._/:@-]+$/.test(image)) {
            vscode.window.showErrorMessage('Invalid docker image name. Allowed characters: letters, digits, and . _ / : @ -');
            return;
        }

        const terminalName = 'TRITON Docker';
        let terminal = vscode.window.terminals.find(t => t.name === terminalName);
        if (!terminal) {
            terminal = vscode.window.createTerminal(terminalName);
        }

        terminal.show();
        terminal.sendText(`docker pull ${image}`);
    }

    public dispose() {
        ComputationSetupEditor.currentPanel = undefined;

        // Kill any spawned build child so closing the panel mid-build does not
        // orphan a long-running process. The child is detached (its own process
        // group), so kill the whole group (negative pid) to reap grandchildren,
        // falling back to a direct kill.
        if (this._runningChild) {
            const child = this._runningChild;
            try {
                if (typeof child.pid === 'number') {
                    process.kill(-child.pid, 'SIGKILL');
                } else {
                    child.kill('SIGKILL');
                }
            } catch (e) {
                try { child.kill('SIGKILL'); } catch (e2) { /* ignore */ }
            }
            this._runningChild = undefined;
        }

        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        // const scriptPathOnDisk = vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'inputGenerator.js'));
        // const stylePathOnDisk = vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'inputGenerator.css'));

        // const scriptUri = webview.asWebviewUri(scriptPathOnDisk);
        // const styleUri = webview.asWebviewUri(stylePathOnDisk);

        const nonce = getNonce();

        const activeProject = ProjectManager.instance.activeProject;
        let defaultBuildPath = '';
        let executablePath = '';

        if (activeProject && activeProject.path) {
            defaultBuildPath = path.join(activeProject.path, 'build');
            const potentialExec = path.join(defaultBuildPath, 'triton.exe');
            if (fs.existsSync(potentialExec)) {
                executablePath = potentialExec;
            }
        }

        const initialData = {
            projectName: activeProject ? activeProject.name : '',
            defaultBuildPath: defaultBuildPath,

            executablePath: executablePath,
            source_dir: activeProject?.source_dir || '',
            executable_target_mode: activeProject?.executable_target_mode,
            simulationStart: activeProject?.simulationStart,
            timezone: activeProject?.timezone,

            sim_start_time: activeProject?.sim_start_time ?? 0,
            sim_duration: activeProject?.sim_duration ?? 86400,
            time_increment_fixed: activeProject?.time_increment_fixed ?? 0,
            time_step: activeProject?.time_step ?? 0.01,
            // Output Generation moved from Execution Setup
            print_option: activeProject?.print_option ?? 'huv',
            print_interval: activeProject?.print_interval ?? 900,
            courant: activeProject?.courant ?? 0.5,
            gpu_direct_flag: activeProject?.gpu_direct_flag ?? 0,
            domain_decomposition: activeProject?.domain_decomposition ?? 'static',
            factor_interval_domain_decomposition: activeProject?.factor_interval_domain_decomposition ?? 2,
            open_boundaries: activeProject?.open_boundaries ?? 0
        };

        const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'computationSetup.bundle.js');
        const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

        return getComputationSetupHtml(webview.cspSource, nonce, initialData, scriptUri);
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
