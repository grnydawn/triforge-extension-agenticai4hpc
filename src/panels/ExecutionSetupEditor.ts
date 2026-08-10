import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as os from 'os';
import { getExecutionSetupHtml } from './templates/ExecutionSetupHtml';
import { ProjectManager } from '../state/ProjectManager';
import { resolveOutputNormalization } from '../services/outputNormalize';
import { renderTritonExecutionCfg } from '../services/tritonConfig';


export class ExecutionSetupEditor {
    public static currentPanel: ExecutionSetupEditor | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private readonly _extensionUri: vscode.Uri;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.type) {
                    case 'runSimulation':
                        this._handleRunSimulation(message);
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
        const panelTitle = activeProject ? `Execution Setup (${activeProject.name})` : 'Execution Setup';

        if (ExecutionSetupEditor.currentPanel) {
            ExecutionSetupEditor.currentPanel._panel.title = panelTitle;
            ExecutionSetupEditor.currentPanel._panel.reveal(column);

            // Push new content if project changed
            if (activeProject) {
                ExecutionSetupEditor.currentPanel.updateContent(activeProject);
            }
            return;
        }

        // Validation Logic
        if (activeProject) {
            const mode = activeProject.executable_target_mode || 'source';

            if (mode === 'source') {
                const buildDir = activeProject.build_dir || path.join(activeProject.path, 'build');
                if (!buildDir || !fs.existsSync(path.join(buildDir, 'triton.exe'))) {
                    vscode.window.showWarningMessage('triton.exe not found in Build directory. Please build the project in Computation Setup first.', { modal: true });
                    return;
                }
            } else if (mode === 'executable') {
                const exePath = activeProject.triton_target;
                if (!exePath || !fs.existsSync(exePath)) {
                    vscode.window.showWarningMessage('Selected TRITON executable not found. Please select a valid executable in Computation Setup.', { modal: true });
                    return;
                }
            } else if (mode === 'docker') {
                // For Docker, we check if image name is provided
                const image = activeProject.triton_target;
                if (!image) {
                    vscode.window.showWarningMessage('Docker image not specified. Please specify a docker image in Computation Setup.', { modal: true });
                    return;
                }
            } else {
                // Fallback if no mode is selected? Assuming source or check triton_target
                if (!activeProject.executable_target_mode) {
                    vscode.window.showWarningMessage('Execution mode not selected. Please configure Computation Setup first.', { modal: true });
                    return;
                }
            }
        } else {
            vscode.window.showErrorMessage('No active project found.');
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'triforgeExecutionSetup',
            panelTitle,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(extensionUri.fsPath, 'media')),
                    vscode.Uri.file(path.join(extensionUri.fsPath, 'dist'))
                ]
            }
        );

        ExecutionSetupEditor.currentPanel = new ExecutionSetupEditor(panel, extensionUri);
    }

    public updateContent(project: any) {
        const data = ExecutionSetupEditor._getInitialData(project);
        this._panel.webview.postMessage({ command: 'updateState', ...data });
    }

    private async _handleRunSimulation(message: any) {
        // Run-in-progress guard: reject a second run while one is still active so
        // we never orphan or stack concurrent simulation children. The flag is set
        // SYNCHRONOUSLY (before any await) because the spawn happens several
        // seconds later; checking only the spawned `_runningChild` would let two
        // near-simultaneous run requests both pass the guard and both spawn.
        if (this._runInProgress) {
            this._panel.webview.postMessage({ command: 'appendLog', text: '> A simulation is already running. Please wait for it to finish before starting another.\n' });
            // Non-modal: a modal here would block the panel from closing (and thus
            // block dispose() from killing the active child).
            vscode.window.showWarningMessage('A simulation is already running. Please wait for it to finish before starting another.');
            return;
        }
        this._runInProgress = true;

        // Save parameters first
        const activeProject = ProjectManager.instance.activeProject;
        if (activeProject) {
            const updatedProject = { ...activeProject };
            updatedProject.checkpoint_id = message.checkpoint_id;
            updatedProject.it_count = message.it_count;
            updatedProject.execution_type = message.execution_type;
            updatedProject.run_directory = message.run_directory;
            if (updatedProject.execution_type === 'batch') {
                updatedProject.batch_header = message.batch_header;
                updatedProject.batch_submit_command = message.batch_submit_command;
                updatedProject.step_launch_command = message.step_launch_command;
            } else {
                updatedProject.run_command = message.run_command;
            }
            updatedProject.it_count = message.it_count;
            updatedProject.checkpoint_id = message.checkpoint_id;
            updatedProject.env_variables = message.env_variables;

            // Save Output Generation Params
            updatedProject.print_observation = message.print_observation;
            // print_option and print_interval moved to Computation Layout.
            // Do not update them here to avoid overwriting with undefined/stale values if not passed.
            // output_format is now managed in Project Settings, not here.
            updatedProject.projection = message.projection;
            updatedProject.output_option = message.output_option;
            updatedProject.outfile_pattern = message.outfile_pattern;
            updatedProject.it_print = message.it_print;

            // This will trigger a file write
            ProjectManager.instance.updateProject(updatedProject);

            // Create Run Directory if not exists
            if (updatedProject.run_directory && !fs.existsSync(updatedProject.run_directory)) {
                try {
                    fs.mkdirSync(updatedProject.run_directory, { recursive: true });
                } catch (e: any) {
                    this._panel.webview.postMessage({ command: 'appendLog', text: `Error creating run directory: ${e.message}\n` });
                    this._runInProgress = false;
                    return;
                }
            }

            const runDir = updatedProject.run_directory || updatedProject.path;

            // Generate Configuration File
            try {
                this._writeTritonConfig(updatedProject, runDir);
                this._panel.webview.postMessage({ command: 'appendLog', text: `> Generated triton_execution.cfg in ${runDir}\n` });

                // Wait to ensure filesystem stability before execution
                await new Promise(resolve => setTimeout(resolve, 1000));

                const configPath = path.join(runDir, 'triton_execution.cfg');
                if (!fs.existsSync(configPath)) {
                    throw new Error('Verification failed: Config file not found after generation.');
                }
            } catch (e: any) {
                this._panel.webview.postMessage({ command: 'appendLog', text: `Error generating config: ${e.message}\n` });
                this._runInProgress = false;
                return;
            }

            // Clear the persisted log on a new run start so a reopened panel
            // replays only the current run's tail, not stale history.
            ExecutionSetupEditor._executionLogs = '';

            this._panel.webview.postMessage({ command: 'appendLog', text: `> Starting ${updatedProject.execution_type} simulation...\n` });

            if (updatedProject.execution_type === 'interactive') {
                this._runInteractive(updatedProject, runDir);
            } else {
                this._runBatch(updatedProject, runDir);
            }
        } else {
            // No active project: nothing was spawned, so release the guard.
            this._runInProgress = false;
        }
    }

    private _writeTritonConfig(project: any, runDir: string) {
        const configPath = path.join(runDir, 'triton_execution.cfg');
        const templatePath = path.join(this._extensionUri.fsPath, 'resources', 'triton_execution.cfg.template');

        if (!fs.existsSync(templatePath)) {
            throw new Error(`Template not found at ${templatePath}`);
        }

        const templateContent = fs.readFileSync(templatePath, 'utf8');
        fs.writeFileSync(configPath, renderTritonExecutionCfg(project, templateContent));
    }

    private static _outputChannel: vscode.OutputChannel;
    private static _executionLogs: string = ''; // Persistent logs (rolling tail)
    // Cap the host-side persisted buffer to a rolling tail so a long run does not
    // accumulate megabytes for the host lifetime nor replay the full history into
    // every reopened panel via `initialLogs`. Keep only the last ~48 KB.
    private static readonly _executionLogsCap: number = 48 * 1024;
    private _processOutputBuffer: string[] = [];
    private _processOutputTimer: NodeJS.Timeout | undefined;
    // The currently-running simulation child, stored so dispose() can kill it.
    // Cleared on exit.
    private _runningChild: cp.ChildProcess | undefined;
    // Set SYNCHRONOUSLY when a run starts (before the async config/spawn delays)
    // so a second run request is rejected even before the child exists. Cleared
    // on every non-spawn early-return and when the spawned child exits/errors.
    private _runInProgress: boolean = false;
    // Set in dispose(). The run path has multi-second artificial delays before it
    // actually spawns, so the panel can be disposed BEFORE the child exists; if
    // the spawn lands after disposal we must kill it immediately rather than
    // orphan it.
    private _disposed: boolean = false;

    public static get outputChannel(): vscode.OutputChannel {
        if (!ExecutionSetupEditor._outputChannel) {
            ExecutionSetupEditor._outputChannel = vscode.window.createOutputChannel('TRITON Execution');
        }
        return ExecutionSetupEditor._outputChannel;
    }

    // Append to the persisted log, dropping from the front so the buffer never
    // exceeds the rolling-tail cap. This bounds host memory across long runs and
    // bounds the `initialLogs` replayed into each reopened panel.
    private static _appendExecutionLog(text: string): void {
        ExecutionSetupEditor._executionLogs += text;
        const cap = ExecutionSetupEditor._executionLogsCap;
        if (ExecutionSetupEditor._executionLogs.length > cap) {
            ExecutionSetupEditor._executionLogs =
                ExecutionSetupEditor._executionLogs.slice(-cap);
        }
    }

    // Kill a spawned child and its whole process group. The child is spawned
    // detached (its own group), so kill the group (negative pid) to reap any
    // grandchildren (the real `triton`/`sleep` under the `sh -c` wrapper),
    // falling back to a direct kill.
    private static _killChildTree(child: cp.ChildProcess): void {
        try {
            if (typeof child.pid === 'number') {
                process.kill(-child.pid, 'SIGKILL');
            } else {
                child.kill('SIGKILL');
            }
        } catch (e) {
            try { child.kill('SIGKILL'); } catch (e2) { /* ignore */ }
        }
    }

    private _attachChildProcessListeners(child: cp.ChildProcess, project: any) {
        // ExecutionSetupEditor.outputChannel.show(true);

        // If the panel was already disposed while we were inside the multi-second
        // pre-spawn delay, the child would otherwise be orphaned — kill it now.
        if (this._disposed) {
            ExecutionSetupEditor._killChildTree(child);
            this._runInProgress = false;
            return;
        }

        // Track the live child so dispose() can kill it. The run-in-progress
        // guard (`_runInProgress`) was already set synchronously by the caller.
        this._runningChild = child;

        const handleOutput = (data: any) => {
            const text = data.toString();
            ExecutionSetupEditor.outputChannel.append(text);
            ExecutionSetupEditor._appendExecutionLog(text); // Persist (rolling tail)

            // Buffer for Webview (Throttled)
            this._processOutputBuffer.push(text);
            this._scheduleWebviewUpdate();
        };

        if (child.stdout) {
            child.stdout.on('data', handleOutput);
        }
        if (child.stderr) {
            child.stderr.on('data', handleOutput);
        }

        child.on('error', (err) => {
            const msg = `\nProcess Error: ${err.message}\n`;
            ExecutionSetupEditor.outputChannel.appendLine(msg);
            this._panel.webview.postMessage({ command: 'appendLog', text: msg });
            // The child failed to start / errored out; clear the run-in-progress
            // state so a subsequent run is allowed.
            if (this._runningChild === child) {
                this._runningChild = undefined;
                this._runInProgress = false;
            }
        });

        child.on('close', (code) => {
            const msg = `\n> Process exited with code ${code}\n`;
            ExecutionSetupEditor.outputChannel.appendLine(msg);

            // The run is finished; clear the run-in-progress state.
            if (this._runningChild === child) {
                this._runningChild = undefined;
                this._runInProgress = false;
            }

            // Flush remaining buffer
            if (this._processOutputBuffer.length > 0) {
                this._panel.webview.postMessage({ command: 'appendLog', text: this._processOutputBuffer.join('') });
                this._processOutputBuffer = [];
                if (this._processOutputTimer) clearTimeout(this._processOutputTimer);
            }
            this._panel.webview.postMessage({ command: 'appendLog', text: msg });

            if (code === 0) {
                this._updateOutputPaths(project);
            }
        });
    }

    private _scheduleWebviewUpdate() {
        if (this._processOutputTimer) return;

        this._processOutputTimer = setTimeout(() => {
            if (this._processOutputBuffer.length > 0) {
                // Join and send
                const fullText = this._processOutputBuffer.join('');
                // ExecutionSetupEditor._executionLogs += fullText; // Already added in handleOutput
                this._panel.webview.postMessage({ command: 'appendLog', text: fullText });

                // Clear
                this._processOutputBuffer = [];
            }
            this._processOutputTimer = undefined;
            this._processOutputTimer = undefined;
        }, 500); // 500ms throttle to reduce IPC overhead
    }

    // --- Command parsing / quoting (SEC-6) ---

    // Tokenize a command string into an argv array the way a POSIX shell would
    // split it, honouring single/double quotes and backslash escapes but WITHOUT
    // ever interpreting metacharacters ($(), `, ;, &&, |, redirections, …). The
    // result is fed to spawn(file, args, { shell:false }) so a payload such as
    // `$(touch x)` becomes a literal argv token instead of a shell substitution.
    private static _tokenizeCommand(command: string): string[] {
        const tokens: string[] = [];
        let current = '';
        let inSingle = false;
        let inDouble = false;
        let hasToken = false;

        for (let i = 0; i < command.length; i++) {
            const ch = command[i];
            if (inSingle) {
                if (ch === "'") { inSingle = false; } else { current += ch; }
                continue;
            }
            if (inDouble) {
                if (ch === '"') {
                    inDouble = false;
                } else if (ch === '\\' && i + 1 < command.length &&
                           (command[i + 1] === '"' || command[i + 1] === '\\')) {
                    current += command[++i];
                } else {
                    current += ch;
                }
                continue;
            }
            if (ch === "'") { inSingle = true; hasToken = true; continue; }
            if (ch === '"') { inDouble = true; hasToken = true; continue; }
            if (ch === '\\' && i + 1 < command.length) { current += command[++i]; hasToken = true; continue; }
            if (ch === ' ' || ch === '\t' || ch === '\n') {
                if (hasToken) { tokens.push(current); current = ''; hasToken = false; }
                continue;
            }
            current += ch;
            hasToken = true;
        }
        if (hasToken) { tokens.push(current); }
        return tokens;
    }

    // POSIX single-quote a value so it can be safely interpolated into a
    // generated shell script (the batch path). A single quote inside the value
    // is closed, escaped, and reopened: ' -> '\''.
    private static _shellQuote(value: string): string {
        return `'${String(value).replace(/'/g, `'\\''`)}'`;
    }

    // --- Run Handlers with Delays ---

    private async _runInteractive(project: any, runDir: string) {
        const runCommand = project.run_command || 'echo "No run command specified"';
        const envVars = this._parseEnvVars(project.env_variables);

        // Add Run Directory to PATH
        const currentPath = process.env.PATH || '';
        envVars['PATH'] = `${runDir}${path.delimiter}${currentPath}`;

        await new Promise(resolve => setTimeout(resolve, 2000)); // JS-side delay (replaces the old shell-side `sleep 2;`)

        // ExecutionSetupEditor.outputChannel.appendLine(`> Executing: ${runCommand}`);

        // SEC-6: spawn via argv with shell:false so metacharacters in the
        // run_command (e.g. `$(touch x)`) are NEVER evaluated by /bin/sh.
        const argv = ExecutionSetupEditor._tokenizeCommand(runCommand);
        if (argv.length === 0) {
            this._panel.webview.postMessage({ command: 'appendLog', text: `Error: empty run command\n` });
            this._runInProgress = false;
            return;
        }
        const [file, ...args] = argv;

        const child = cp.spawn(file, args, {
            cwd: runDir,
            shell: false,
            // Run the child in its own process group so dispose() can kill the
            // whole tree (the shell AND its grandchildren), not just the shell.
            detached: true,
            env: { ...process.env, ...envVars }
        });

        this._attachChildProcessListeners(child, project);
    }

    private async _runBatch(project: any, runDir: string) {
        const batchHeader = project.batch_header || '#!/bin/bash';
        const stepLaunch = project.step_launch_command || 'srun triton';
        const submitCmd = project.batch_submit_command || 'sbatch';
        const envVars = this._parseEnvVars(project.env_variables);

        // Generate Batch Script
        const scriptPath = path.join(runDir, 'triton_batch.sh');
        let scriptContent = `${batchHeader}\n\n`;

        // Add Env Vars to script (SEC-6: shell-quote each interpolated value so a
        // payload like `$(touch x)` cannot break out of the assignment).
        for (const [key, val] of Object.entries(envVars)) {
            scriptContent += `export ${key}=${ExecutionSetupEditor._shellQuote(val)}\n`;
        }

        // Add PATH extension in script (SEC-6: quote runDir too).
        scriptContent += `export PATH=$PATH:${ExecutionSetupEditor._shellQuote(runDir)}\n\n`;

        // Add shell-side delay inside script? Or before submit?
        // User asked "launching command in the subprocess". 
        // For batch, the subprocess launches 'sbatch'. We can delay that.
        // Or delay inside the script? Usually sbatch returns immediately.
        // I'll add sleep to the submit command invocation.

        scriptContent += `${stepLaunch}\n`;

        try {
            fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });
            this._panel.webview.postMessage({ command: 'appendLog', text: `> Created batch script: ${scriptPath}\n` });
        } catch (e: any) {
            this._panel.webview.postMessage({ command: 'appendLog', text: `Error writing batch script: ${e.message}\n` });
            this._runInProgress = false;
            return;
        }

        // Run Submit Command with Delay.
        // SEC-6: tokenize the submit command and append the script path as a
        // literal argv element, then spawn via shell:false so metacharacters in
        // the submit command are never evaluated by /bin/sh.
        const submitArgv = ExecutionSetupEditor._tokenizeCommand(submitCmd);
        if (submitArgv.length === 0) {
            this._panel.webview.postMessage({ command: 'appendLog', text: `Error: empty batch submit command\n` });
            this._runInProgress = false;
            return;
        }
        const [submitFile, ...submitArgs] = submitArgv;
        submitArgs.push(scriptPath);

        this._panel.webview.postMessage({ command: 'appendLog', text: `> Submitting (with delay): ${submitFile} ${submitArgs.join(' ')}\n` });

        await new Promise(resolve => setTimeout(resolve, 2000)); // JS-side delay (replaces the old shell-side `sleep 2;`)

        const child = cp.spawn(submitFile, submitArgs, {
            cwd: runDir,
            shell: false,
            // Run the child in its own process group so dispose() can kill the
            // whole tree (the shell AND its grandchildren), not just the shell.
            detached: true,
            env: { ...process.env, ...envVars } // Still pass env vars to submitter just in case
        });

        this._attachChildProcessListeners(child, project);
    }

    private _parseEnvVars(envStr?: string): { [key: string]: string } {
        const envs: { [key: string]: string } = {};
        if (!envStr) return envs;

        envStr.split('\n').forEach(line => {
            const parts = line.split('=');
            if (parts.length >= 2) {
                const key = parts[0].trim();
                const val = parts.slice(1).join('=').trim();
                if (key) envs[key] = val;
            }
        });
        return envs;
    }

    // Move everything triton wrote (e.g. build/output/*) into the canonical
    // <project>/output. Top-level entries (asc/, bin/, gtiff/, …) are replaced
    // wholesale — last run wins per output subdir, which matches a re-run replacing
    // its prior results. Same-filesystem rename is instant; EXDEV falls back to copy.
    private _relocateOutputs(sourceDir: string, canonicalDir: string): void {
        // Safety: if sourceDir and canonicalDir resolve to the SAME real path (e.g. one
        // is a symlink to the other), relocating would move a directory into itself and
        // could destroy data — skip. When canonicalDir does not exist yet (first run)
        // there is no self-relocation risk, so we skip the realpath check and proceed.
        try {
            if (
                fs.existsSync(canonicalDir) &&
                fs.realpathSync(sourceDir) === fs.realpathSync(canonicalDir)
            ) {
                return;
            }
        } catch {
            /* realpath can throw if a path is missing; fall through to normal handling */
        }
        fs.mkdirSync(canonicalDir, { recursive: true });
        for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
            const from = path.join(sourceDir, entry.name);
            const to = path.join(canonicalDir, entry.name);
            try {
                fs.rmSync(to, { recursive: true, force: true });
                fs.renameSync(from, to);
            } catch (e: any) {
                if (e && e.code === 'EXDEV') {
                    fs.cpSync(from, to, { recursive: true });
                    fs.rmSync(from, { recursive: true, force: true });
                } else {
                    throw e;
                }
            }
        }
    }

    private async _updateOutputPaths(project: any) {
        const checks: string[] = [];

        // 1. Configured Output Directory (if set in config.json)
        // ProjectManager loads this into project.outputs.output_directory
        if (project.outputs && project.outputs.output_directory) {
            checks.push(project.outputs.output_directory);
        }

        // 2. Run Directory / output
        const runDir = project.run_directory || project.path;
        checks.push(path.join(runDir, 'output'));

        // 3. Executable Directory / output
        if (project.triton_target && project.executable_target_mode === 'executable') {
            try {
                const exeDir = path.dirname(project.triton_target);
                checks.push(path.join(exeDir, 'output'));
            } catch (e) { }
        }

        // Additional source checking if needed, usually build_dir/output
        if (project.executable_target_mode === 'source' && project.build_dir) {
            checks.push(path.join(project.build_dir, 'output'));
        }

        // Iterate and check
        for (const dir of checks) {
            if (this._isValidOutputDirectory(dir)) {
                const plan = resolveOutputNormalization(project, dir);
                let scanDir = dir;
                if (plan.needsRelocation) {
                    try {
                        this._relocateOutputs(plan.sourceDir, plan.canonicalDir);
                        scanDir = plan.canonicalDir;
                        this._panel.webview.postMessage({ command: 'appendLog', text: `> Normalized outputs to ${plan.canonicalDir}\n` });
                    } catch (e: any) {
                        this._panel.webview.postMessage({ command: 'appendLog', text: `> Could not relocate outputs (${e.message}); using ${dir}\n` });
                    }
                }

                this._panel.webview.postMessage({ command: 'appendLog', text: `> Found valid output directory: ${scanDir}\n` });
                const count = await ProjectManager.instance.scanAndAddOutputs(scanDir);
                this._panel.webview.postMessage({ command: 'appendLog', text: `> Successfully added ${count} output files to project.\n` });
                return;
            }
        }

        // If we reach here, no valid output directory was found
        this._panel.webview.postMessage({ command: 'appendLog', text: `> Warning: Generated output folder not found.\n` });
        vscode.window.showWarningMessage("Simulation finished, but no generated output folder was found.", { modal: true });
    }

    private _isValidOutputDirectory(dir: string): boolean {
        try {
            if (!fs.existsSync(dir)) return false;

            // Check for subfolders: bin, asc, gtiff
            const bin = path.join(dir, 'bin');
            const asc = path.join(dir, 'asc');
            const gtiff = path.join(dir, 'gtiff');

            const hasOut = (d: string) => fs.existsSync(d) && fs.readdirSync(d).some(f => f.endsWith('.out'));
            const hasVrt = (d: string) => fs.existsSync(d) && fs.readdirSync(d).some(f => f.endsWith('.vrt'));

            if (hasOut(bin)) return true;
            if (hasOut(asc)) return true;
            if (hasVrt(gtiff)) return true;

            return false;
        } catch (e) {
            return false;
        }
    }

    public dispose() {
        // Mark disposed first so a child that spawns AFTER this point (the run
        // path has multi-second pre-spawn delays) is killed on arrival rather
        // than orphaned (see _attachChildProcessListeners).
        this._disposed = true;

        ExecutionSetupEditor.currentPanel = undefined;

        // Kill any already-spawned simulation child so closing the panel mid-run
        // does not orphan a long-running process, and clear the throttle timer.
        if (this._runningChild) {
            ExecutionSetupEditor._killChildTree(this._runningChild);
            this._runningChild = undefined;
        }
        this._runInProgress = false;
        if (this._processOutputTimer) {
            clearTimeout(this._processOutputTimer);
            this._processOutputTimer = undefined;
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
        const nonce = getNonce();
        const activeProject = ProjectManager.instance.activeProject;
        const initialData = ExecutionSetupEditor._getInitialData(activeProject);

        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'executionSetup.bundle.js'));

        return getExecutionSetupHtml(webview.cspSource, nonce, initialData, scriptUri);
    }

    private static _getInitialData(activeProject: any): any {
        const buildDir = activeProject?.build_dir || (activeProject ? path.join(activeProject.path, 'build') : '');
        const runDir = activeProject?.run_directory || buildDir || activeProject?.path || '';
        const configPath = runDir ? path.join(runDir, 'triton_execution.cfg') : '';


        return {
            projectName: activeProject ? activeProject.name : '',
            triton_config_path: configPath,

            executable_target_mode: activeProject?.executable_target_mode || 'source',
            execution_type: activeProject?.execution_type || 'interactive',
            build_dir: buildDir,
            triton_target: activeProject?.triton_target || '',
            run_directory: activeProject?.run_directory || '',
            run_command: activeProject?.run_command || '',
            env_variables: activeProject?.env_variables || '',
            batch_header: activeProject?.batch_header || '',
            batch_submit_command: activeProject?.batch_submit_command || '',
            step_launch_command: activeProject?.step_launch_command || '',
            it_count: activeProject?.it_count || 0,
            checkpoint_id: activeProject?.checkpoint_id || 0,

            // Output Generation w/ Defaults
            // print_option and print_interval moved to Computation Layout
            print_observation: activeProject?.print_observation ?? 900,
            // output_format: activeProject?.output_format ?? 'ASC', // Not needed in UI
            projection: activeProject?.projection ?? 'EPSG:32616',
            output_option: activeProject?.output_option ?? 'PAR',
            outfile_pattern: activeProject?.outfile_pattern ?? '%s/%s/%s_%02d_%02d',
            it_print: activeProject?.it_print ?? 3600,
            initialLogs: ExecutionSetupEditor._executionLogs,
            // Default to Total CPUs - 1 to leave room for UI/OS, but at least 1
            cpu_count: Math.max(1, os.cpus().length - 1)
        };
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
