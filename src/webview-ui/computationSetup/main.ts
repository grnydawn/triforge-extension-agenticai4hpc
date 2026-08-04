import { WebviewController } from '../toolkit/WebviewController';


interface ComputationSetupState {
    projectName: string;
    executable_target_mode: 'source' | 'executable' | 'docker';
    triton_target: string;
    // Paths
    defaultBuildPath?: string;
    executablePath?: string;
    source_dir?: string;
    build_dir?: string;
    // Simulation Config
    simulationStart?: string;
    timezone?: string;
    sim_start_time: number;
    sim_duration: number;
    time_increment_fixed: number;
    time_step: number;
    courant: number;
    gpu_direct_flag: number;
    domain_decomposition: string;
    factor_interval_domain_decomposition: number;
    open_boundaries: number;
    print_option: string;
    print_interval: number;
}

declare const initialData: any;

class ComputationSetupController extends WebviewController<ComputationSetupState> {

    private lastSuccessfulBuildPath: string = '';

    constructor() {
        super(initialData);
    }

    protected onInit(): void {
        console.log('Computation Setup: Initializing...');

        // Restore State to Inputs
        this.restoreState();

        // Bind Radios (Execution Mode)
        const radios = document.getElementsByName('execMode');
        Array.from(radios).forEach(r => {
            r.addEventListener('change', () => this.updateVisibility());
        });

        // Bind Visibility Toggles
        const timeIncrementSelect = this.getElement('time_increment_fixed');
        if (timeIncrementSelect) {
            timeIncrementSelect.addEventListener('change', () => this.updateTimeStepState());
        }

        const domainDecompSelect = this.getElement('domain_decomposition');
        if (domainDecompSelect) {
            domainDecompSelect.addEventListener('change', () => this.updateFactorIntervalState());
        }

        // Bind Buttons
        this.bindButton('browseSourceBtn', () => this.postMessage({ type: 'browseSource' }));
        this.bindButton('browseBuildDirBtn', () => this.postMessage({ type: 'browseBuildDir' }));
        this.bindButton('browseExecBtn', () => this.postMessage({ type: 'browseExecutable' }));
        this.bindButton('cancelBtn', () => this.postMessage({ type: 'cancel' }));

        const buildNowBtn = this.getElement('buildNowBtn');
        if (buildNowBtn) {
            buildNowBtn.addEventListener('click', () => this.handleBuildNow());
        }

        const downloadDockerBtn = this.getElement('downloadDockerBtn');
        if (downloadDockerBtn) {
            downloadDockerBtn.addEventListener('click', () => this.handleDownloadDocker());
        }

        const okBtn = this.getElement('okBtn');
        if (okBtn) {
            okBtn.addEventListener('click', () => this.handleSave());
        }

        // Auto-update build command
        const triforgeSourceInput = this.getInput('triforgeSource');
        if (triforgeSourceInput) {
            triforgeSourceInput.addEventListener('input', () => this.updateBuildCommand());
        }

        // Initial Updates
        this.updateVisibility();
        this.updateTimeStepState();
        this.updateFactorIntervalState();

        // Default Date
        const dateInput = this.getInput('startDate');
        if (dateInput && !dateInput.value) {
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            dateInput.value = yyyy + '-' + mm + '-' + dd;
        }
    }

    private restoreState() {
        const buildDirInput = this.getInput('buildDir');
        if (buildDirInput && this.state.defaultBuildPath) {
            buildDirInput.value = this.state.defaultBuildPath;
        }

        const triforgeSourceInput = this.getInput('triforgeSource');
        if (triforgeSourceInput && this.state.source_dir) {
            triforgeSourceInput.value = this.state.source_dir;
            this.updateBuildCommand();
        }

        const triforgeExecInput = this.getInput('triforgeExec');
        if (triforgeExecInput) {
            if (this.state.executablePath) {
                triforgeExecInput.value = this.state.executablePath;
            }
        }

        // Restore Start Date & Time
        const dateInput = this.getInput('startDate');
        const timeInput = this.getInput('startTime');
        if (dateInput && timeInput && this.state.simulationStart) {
            const parts = this.state.simulationStart.split('T');
            if (parts.length === 2) {
                dateInput.value = parts[0];
                timeInput.value = parts[1];
            }
        }

        // Time Inputs
        const simStartHrInput = this.getInput('sim_start_hr');
        const simStartMinInput = this.getInput('sim_start_min');
        if (simStartHrInput && simStartMinInput) {
            const totalSeconds = this.state.sim_start_time || 0;
            simStartHrInput.value = Math.floor(totalSeconds / 3600).toString();
            simStartMinInput.value = Math.floor((totalSeconds % 3600) / 60).toString();
        }

        const simDurationHrInput = this.getInput('sim_duration_hr');
        const simDurationMinInput = this.getInput('sim_duration_min');
        if (simDurationHrInput && simDurationMinInput) {
            const totalSeconds = this.state.sim_duration || 0;
            simDurationHrInput.value = Math.floor(totalSeconds / 3600).toString();
            simDurationMinInput.value = Math.floor((totalSeconds % 3600) / 60).toString();
        }
    }

    private bindButton(id: string, handler: () => void) {
        const btn = this.getElement(id);
        if (btn) btn.addEventListener('click', handler);
    }

    protected handleMessage(message: any): void {
        switch (message.command) {
            case 'updateSourcePath':
                const srcInput = this.getInput('triforgeSource');
                if (srcInput) {
                    srcInput.value = message.path;
                    this.updateBuildCommand();
                }
                break;
            case 'updateBuildDirPath':
                const buildInput = this.getInput('buildDir');
                if (buildInput) buildInput.value = message.path;
                break;
            case 'updateExecutablePath':
                const execInput = this.getInput('triforgeExec');
                if (execInput) execInput.value = message.path;
                break;
            case 'appendBuildLog':
                this.updateLog('buildLog', message.text);
                break;
            case 'buildComplete':
                this.handleBuildComplete(message);
                break;
        }
    }

    private updateLog(id: string, text: string) {
        const logEl = this.getElement(id);
        const container = this.getElement(id + 'Container') as HTMLDetailsElement;
        if (logEl) {
            logEl.style.display = 'block';
            logEl.textContent += text;
            logEl.scrollTop = logEl.scrollHeight;
        }
        if (container) {
            container.style.display = 'block';
            container.open = true;
        }
    }

    private handleBuildComplete(message: any) {
        const logEl = this.getElement('buildLog');
        if (logEl) {
            logEl.style.display = 'block';
            const resultSpan = document.createElement('div');
            resultSpan.style.marginTop = '10px';
            resultSpan.style.fontWeight = 'bold';
            if (message.success) {
                resultSpan.className = 'success';
                resultSpan.textContent = 'Build Success! triton.exe found.';
            } else {
                resultSpan.className = 'error';
                resultSpan.textContent = 'Build Failed! triton.exe not found.';
            }
            logEl.appendChild(resultSpan);
            logEl.scrollTop = logEl.scrollHeight;
        }

        const container = this.getElement('buildLogContainer') as HTMLDetailsElement;
        if (container) {
            container.style.display = 'block';
            container.open = true;
        }

        if (message.success && message.path) {
            this.lastSuccessfulBuildPath = message.path;
        }
    }

    private updateBuildCommand() {
        const triforgeSourceInput = this.getInput('triforgeSource');
        const buildCommandInput = this.getInput('buildCommand');
        if (triforgeSourceInput && buildCommandInput) {
            const sourcePath = triforgeSourceInput.value;
            if (sourcePath) {
                buildCommandInput.value = 'cmake ' + sourcePath + ' && triton_build.sh';
            }
        }
    }

    private handleBuildNow() {
        const buildCommandInput = this.getInput('buildCommand');
        const buildDirInput = this.getInput('buildDir');

        const cmd = buildCommandInput ? buildCommandInput.value : '';
        const dir = buildDirInput ? buildDirInput.value : '';

        if (cmd && dir) {
            this.postMessage({ type: 'buildNow', text: cmd, dir: dir });
        } else {
            this.postMessage({ type: 'alert', text: 'Please specify both Build Directory and Build Command.' });
        }
    }

    private handleDownloadDocker() {
        const dockerImageInput = this.getInput('dockerImage');
        const image = dockerImageInput ? dockerImageInput.value : '';
        if (image) {
            this.postMessage({ type: 'downloadDocker', image: image });
        } else {
            this.postMessage({ type: 'alert', text: 'Please specify a Docker Image.' });
        }
    }

    private handleSave() {
        const radios = document.getElementsByName('execMode') as NodeListOf<HTMLInputElement>;
        let selectedMode = 'source';
        Array.from(radios).forEach(r => {
            if (r.checked) selectedMode = r.value;
        });

        let is_docker_target = false;
        let triton_target = '';

        const dockerImageInput = this.getInput('dockerImage');
        const triforgeExecInput = this.getInput('triforgeExec');
        const triforgeSourceInput = this.getInput('triforgeSource');
        const buildDirInput = this.getInput('buildDir');

        if (selectedMode === 'docker') {
            is_docker_target = true;
            triton_target = dockerImageInput ? dockerImageInput.value : '';
        } else if (selectedMode === 'executable') {
            is_docker_target = false;
            triton_target = triforgeExecInput ? triforgeExecInput.value : '';
        } else if (selectedMode === 'source') {
            is_docker_target = false;
            // Always try to set triton_target, let backend validate existence
            if (this.lastSuccessfulBuildPath) {
                triton_target = this.lastSuccessfulBuildPath;
            } else {
                // If we haven't built in this session, assume standard path
                const buildDir = buildDirInput ? buildDirInput.value : '';
                /* 
                   We can't easily join paths here in browser environment without 'path' module, 
                   but we can send empty and let backend reconstruct/validate it based on build_dir.
                   Or we can try a simple string concat assuming forward slashes (since we're likely on unix-like for triton usually, 
                   but windows validation handles separators).
                   Let's just send empty string if logic requires, but backend has build_dir.
                   Actually, let's try to construct it simply.
                */
                if (buildDir) {
                    // Simple heuristic join
                    const sep = buildDir.includes('\\') ? '\\' : '/';
                    triton_target = buildDir.endsWith(sep) ? buildDir + 'triton.exe' : buildDir + sep + 'triton.exe';
                }
            }
        }

        // Gather Sim Data
        const dateInput = this.getInput('startDate');
        const timeInput = this.getInput('startTime');
        const timezoneInput = this.getInput('timezone') as unknown as HTMLSelectElement;

        const simStartHr = parseFloat(this.getInput('sim_start_hr')?.value || '0');
        const simStartMin = parseFloat(this.getInput('sim_start_min')?.value || '0');
        const simDurationHr = parseFloat(this.getInput('sim_duration_hr')?.value || '0');
        const simDurationMin = parseFloat(this.getInput('sim_duration_min')?.value || '0');


        const timeIncrementSelect = this.getElement('time_increment_fixed') as HTMLSelectElement;
        const timeStep = parseFloat(this.getInput('time_step')?.value || '0');

        const courant = parseFloat(this.getInput('courant')?.value || '0');
        const gpuDirectSelect = this.getElement('gpu_direct_flag') as HTMLSelectElement;
        const domainDecompSelect = this.getElement('domain_decomposition') as HTMLSelectElement;
        const factorInterval = parseInt(this.getInput('factor_interval_domain_decomposition')?.value || '0');
        const openBoundariesSelect = this.getElement('open_boundaries') as HTMLSelectElement;

        const printOptionSelect = this.getElement('print_option') as HTMLSelectElement;
        const printInterval = parseInt(this.getInput('print_interval')?.value || '0');

        const data = {
            type: 'saveSettings',
            is_docker_target,
            triton_target,
            executable_target_mode: selectedMode,
            source_dir: triforgeSourceInput ? triforgeSourceInput.value : '',
            build_dir: buildDirInput ? buildDirInput.value : '',
            simulationStart: dateInput && timeInput ? dateInput.value + 'T' + timeInput.value : undefined,
            timezone: timezoneInput ? timezoneInput.value : undefined,
            sim_start_time: simStartHr * 3600 + simStartMin * 60,
            sim_duration: simDurationHr * 3600 + simDurationMin * 60,
            time_increment_fixed: timeIncrementSelect ? parseInt(timeIncrementSelect.value) : 0,
            time_step: timeStep,
            courant: courant,
            gpu_direct_flag: gpuDirectSelect ? parseInt(gpuDirectSelect.value) : 0,
            domain_decomposition: domainDecompSelect ? domainDecompSelect.value : 'static',
            factor_interval_domain_decomposition: factorInterval,
            open_boundaries: openBoundariesSelect ? parseInt(openBoundariesSelect.value) : 0,
            print_option: printOptionSelect ? printOptionSelect.value : 'huv',
            print_interval: printInterval
        };

        this.postMessage(data);
    }

    private updateVisibility() {
        const radios = document.getElementsByName('execMode') as NodeListOf<HTMLInputElement>;
        let selected = 'source';
        Array.from(radios).forEach(r => {
            if (r.checked) selected = r.value;
        });

        const sourceConfig = this.getElement('sourceConfig');
        const execConfig = this.getElement('execConfig');
        const dockerConfig = this.getElement('dockerConfig');

        if (sourceConfig) sourceConfig.style.display = 'none';
        if (execConfig) execConfig.style.display = 'none';
        if (dockerConfig) dockerConfig.style.display = 'none';

        if (selected === 'source') {
            if (sourceConfig) sourceConfig.style.display = 'block';
        } else {
            const logContainer = this.getElement('buildLogContainer');
            if (logContainer) logContainer.style.display = 'none';
        }

        if (selected === 'executable' && execConfig) execConfig.style.display = 'block';
        else if (selected === 'docker' && dockerConfig) dockerConfig.style.display = 'block';
    }

    private updateTimeStepState() {
        const timeIncrementSelect = this.getElement('time_increment_fixed') as HTMLSelectElement;
        const timeStepInput = this.getInput('time_step');
        if (timeIncrementSelect && timeStepInput) {
            const row = timeStepInput.closest('.form-group') as HTMLElement;
            if (row) {
                row.style.display = timeIncrementSelect.value === '1' ? '' : 'none';
            }
        }
    }

    private updateFactorIntervalState() {
        const domainDecompSelect = this.getElement('domain_decomposition') as HTMLSelectElement;
        const factorIntervalInput = this.getInput('factor_interval_domain_decomposition');
        if (domainDecompSelect && factorIntervalInput) {
            const row = factorIntervalInput.closest('.form-group') as HTMLElement;
            if (row) {
                row.style.display = domainDecompSelect.value === 'dynamic' ? '' : 'none';
            }
        }
    }
}

new ComputationSetupController();
