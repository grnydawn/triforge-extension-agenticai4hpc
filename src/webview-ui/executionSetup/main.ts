import { WebviewController } from '../toolkit/WebviewController';

interface ExecutionSetupState {
    execution_type: 'interactive' | 'batch';
    executable_target_mode: 'source' | 'executable' | 'docker';
    triton_target: string;
    batch_submit_command: string;
    batch_header: string;
    step_launch_command: string;
    run_directory: string;
    build_dir: string;
    env_variables: string;
    checkpoint_id: number;
    it_count: number;
    run_command?: string;
    triton_config_path?: string;
    // Output Params
    print_option: string;
    print_interval: number;
    print_observation: number;
    output_format: string;
    projection: string;
    output_option: string;
    outfile_pattern: string;
    it_print: number;
    initialLogs?: string;
    cpu_count?: number;
}

declare const initialData: any;

class ExecutionSetupController extends WebviewController<ExecutionSetupState> {

    constructor() {
        super(initialData);
    }

    protected onInit(): void {
        console.log('ExecutionSetup: Initializing...');

        // Initial Visibility
        this.updateVisibility();

        // Bind Radio Buttons
        const interactiveRadio = document.querySelector('input[name="execution_type"][value="interactive"]');
        const batchRadio = document.querySelector('input[name="execution_type"][value="batch"]');

        if (interactiveRadio) {
            interactiveRadio.addEventListener('change', () => this.updateVisibility());
        }
        if (batchRadio) {
            batchRadio.addEventListener('change', () => this.updateVisibility());
        }

        // Set Initial Radio State
        if (this.state.execution_type === 'batch' && batchRadio) {
            (batchRadio as HTMLInputElement).checked = true;
        } else if (interactiveRadio) {
            (interactiveRadio as HTMLInputElement).checked = true;
            // Force update to hide batch items if they were shown by default HTML
            this.updateVisibility();
        }

        // Bind Run Button
        const runBtn = this.getElement('runBtn');
        if (runBtn) {
            runBtn.addEventListener('click', () => this.handleRunClick());
        }

        // Initialize Inputs
        this.initializeInputs();

        // Bind Output Format for Projection toggling
        // Bind Output Format for Projection toggling
        const outputFormatSelect = this.getElement('output_format') as HTMLSelectElement;
        if (outputFormatSelect) {
            outputFormatSelect.addEventListener('change', () => this.updateVisibility());
        }

        // Restore Logs
        if (this.state.initialLogs) {
            this.handleMessage({ command: 'appendLog', text: this.state.initialLogs });
        }
    }

    protected handleMessage(message: any): void {
        switch (message.command) {
            case 'updateState':
                // Merge new state
                console.log('ExecutionSetup: Received updateState', message);
                this.state = { ...this.state, ...message }; // message contains the data fields
                // Re-initialize inputs with new state
                this.initializeInputs();
                this.updateVisibility();
                break;
            case 'appendLog':
                const logEl = this.getElement('executionLog');
                const logDetails = this.getElement('logDetails');
                if (logEl) {
                    // Optimized appending
                    logEl.insertAdjacentText('beforeend', message.text);

                    // Truncate if too long (prevent memory issues/hanging)
                    const maxLength = 500000; // ~500KB
                    if (logEl.textContent && logEl.textContent.length > maxLength) {
                        logEl.textContent = logEl.textContent.substring(logEl.textContent.length - maxLength * 0.8);
                        logEl.insertAdjacentText('afterbegin', '[...Logs truncated due to length...]\n');
                    }

                    logEl.scrollTop = logEl.scrollHeight;
                }
                if (logDetails) {
                    logDetails.style.display = 'block';
                    (logDetails as HTMLDetailsElement).open = true;
                }
                break;
            case 'clearLog':
                const logElClean = this.getElement('executionLog');
                if (logElClean) {
                    logElClean.textContent = '';
                }
                break;
        }
    }

    private initializeInputs() {
        const runDirInput = this.getInput('run_directory');
        // const envVarInput = this.getTextArea('env_variables'); 
        const envVarInput = this.getTextArea('env_variables');

        if (runDirInput) {
            if (this.state.run_directory) {
                runDirInput.value = this.state.run_directory;
            } else if (this.state.build_dir) {
                runDirInput.value = this.state.build_dir;
            }
        }

        if (envVarInput) {
            envVarInput.value = this.state.env_variables || '';
        }

        const runCmdInput = this.getInput('run_command');
        if (runCmdInput && this.state.run_command) {
            runCmdInput.value = this.state.run_command;
        }

        const itCountInput = this.getInput('it_count');
        if (itCountInput) {
            itCountInput.value = (this.state.it_count || 0).toString();
        }

        const checkpointIdInput = this.getInput('checkpoint_id');
        if (checkpointIdInput) {
            checkpointIdInput.value = (this.state.checkpoint_id || 0).toString();
        }

        // Initialize Output Params if State Exists (though HTML initialData handles this primarily)
        // We rely on initialData embedded in HTML for default values, but we can sync here if needed.

    }

    private updateVisibility() {
        const type = (document.querySelector('input[name="execution_type"]:checked') as HTMLInputElement)?.value || 'interactive';

        const batchHeaderGroup = this.getElement('batch_header_group');
        const stepLaunchGroup = this.getElement('step_launch_group');
        const runCommandLabel = this.getElement('run_command_label');
        const runCmdInput = this.getInput('run_command');
        const batchHeaderInput = this.getTextArea('batch_header');
        const stepLaunchInput = this.getInput('step_launch_command');

        if (type === 'interactive') {
            if (batchHeaderGroup) batchHeaderGroup.style.display = 'none';
            if (stepLaunchGroup) stepLaunchGroup.style.display = 'none';

            if (runCommandLabel) runCommandLabel.innerText = 'Run Command';

            if (runCmdInput) {
                const current = runCmdInput.value;
                // Don't overwrite if we have a state value, unless current is empty
                if ((!current || current === 'sbatch') && !this.state.run_command) {
                    runCmdInput.value = this.getDefaultRunCommand();
                }
            }
        } else {
            if (batchHeaderGroup) batchHeaderGroup.style.display = 'flex';
            if (stepLaunchGroup) stepLaunchGroup.style.display = 'flex';

            if (runCommandLabel) runCommandLabel.innerText = 'Batch Submission Command';

            if (runCmdInput) {
                if (this.state.batch_submit_command && this.state.execution_type === 'batch') {
                    if (!runCmdInput.value || runCmdInput.value === this.getDefaultRunCommand()) {
                        runCmdInput.value = this.state.batch_submit_command || 'sbatch';
                    }
                } else if (!runCmdInput.value || runCmdInput.value !== 'sbatch') {
                    runCmdInput.value = this.state.batch_submit_command || 'sbatch';
                }
            }

            if (batchHeaderInput && !batchHeaderInput.value) {
                batchHeaderInput.value = this.state.batch_header || '#!/bin/bash\n#SBATCH --job-name=triton\n#SBATCH --output=triton.out\n#SBATCH --error=triton.err\n#SBATCH --ntasks=1';
            }

            if (stepLaunchInput && !stepLaunchInput.value) {
                stepLaunchInput.value = this.state.step_launch_command || 'srun ' + this.getDefaultRunCommand();
            }
        }

        // Toggle Projection Visibility based on Output Format
        const outputFormatSelect = this.getElement('output_format') as HTMLSelectElement;
        const projectionGroup = this.getElement('projection_group');
        if (outputFormatSelect && projectionGroup) {
            if (outputFormatSelect.value === 'GTIFF') {
                projectionGroup.style.display = 'flex';
            } else {
                projectionGroup.style.display = 'none';
            }
        }
    }

    private getDefaultRunCommand(): string {
        const mode = this.state.executable_target_mode;
        let cmd = '';

        if (mode === 'source') cmd = 'triton_run.sh';
        else if (mode === 'executable') {
            const exePath = this.state.triton_target || 'triton';
            const numProcs = this.state.cpu_count || 4; // Default to 4 if unknown
            cmd = `mpirun -n ${numProcs} ${exePath}`;
        }
        else if (mode === 'docker') cmd = 'docker run triton';

        // Append Config Path if available
        if (cmd && this.state.triton_config_path) {
            cmd += ' ' + this.state.triton_config_path;
        }

        return cmd;
    }

    private handleRunClick() {
        const runDirInput = this.getInput('run_directory');
        const envVarInput = this.getTextArea('env_variables');
        const runCmdInput = this.getInput('run_command');
        const batchHeaderInput = this.getTextArea('batch_header');
        const stepLaunchInput = this.getInput('step_launch_command');

        const checkpointIdInput = this.getInput('checkpoint_id');
        const itCountInput = this.getInput('it_count');

        const printOptionInput = this.getElement('print_option') as HTMLSelectElement;
        const printIntervalInput = this.getInput('print_interval');
        const printObservationInput = this.getInput('print_observation');
        const outputFormatInput = this.getElement('output_format') as HTMLSelectElement;
        const projectionInput = this.getInput('projection');
        const outputOptionInput = this.getElement('output_option') as HTMLSelectElement;
        const outfilePatternInput = this.getInput('outfile_pattern');
        const itPrintInput = this.getInput('it_print');

        const type = (document.querySelector('input[name="execution_type"]:checked') as HTMLInputElement)?.value || 'interactive';

        let run_command = '';
        let batch_header = '';
        let batch_submit_command = '';
        let step_launch_command = '';

        if (type === 'interactive') {
            run_command = runCmdInput ? runCmdInput.value : '';
        } else {
            batch_submit_command = runCmdInput ? runCmdInput.value : '';
            batch_header = batchHeaderInput ? batchHeaderInput.value : '';
            step_launch_command = stepLaunchInput ? stepLaunchInput.value : '';
        }

        this.postMessage({
            type: 'runSimulation',
            checkpoint_id: parseInt(checkpointIdInput?.value || '0'),
            it_count: parseInt(itCountInput?.value || '0'),
            run_directory: runDirInput?.value || '',
            run_command,
            env_variables: envVarInput?.value || '',
            execution_type: type,
            batch_header,
            batch_submit_command,
            step_launch_command,
            // Output Generation
            print_option: printOptionInput ? printOptionInput.value : 'huv',
            print_interval: parseFloat(printIntervalInput?.value || '900'),
            print_observation: parseFloat(printObservationInput?.value || '900'),
            output_format: outputFormatInput ? outputFormatInput.value : 'ASC',
            projection: projectionInput?.value || '',
            output_option: outputOptionInput ? outputOptionInput.value : 'PAR',
            outfile_pattern: outfilePatternInput?.value || '',
            it_print: parseFloat(itPrintInput?.value || '3600')
        });

        const logDetails = this.getElement('logDetails');
        if (logDetails) {
            logDetails.style.display = 'block';
            (logDetails as HTMLDetailsElement).open = true;
        }
    }
}

// Instantiate
new ExecutionSetupController();
