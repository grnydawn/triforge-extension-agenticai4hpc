import { Uri } from 'vscode';
import { escapeHtml, safeJsonForScript } from '../../utils/escape';

export function getComputationSetupHtml(cspSource: string, nonce: string, initialData: any = {}, scriptUri: Uri): string {
    const dataJson = safeJsonForScript(initialData);

    return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Computation Setup</title>
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <style>
                    body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); padding: 20px; max-width: 800px; margin: 0 auto; }
                    h2 { border-bottom: 1px solid var(--vscode-settings-headerBorder); padding-bottom: 10px; margin-bottom: 20px; }
                    .section { margin-bottom: 30px; border: 1px solid var(--vscode-settings-headerBorder); padding: 15px; border-radius: 4px; }
                    .section-title { font-weight: bold; margin-bottom: 15px; display: block; border-bottom: 1px solid var(--vscode-settings-headerBorder); padding-bottom: 5px; }
                    .form-group { margin-bottom: 15px; }
                    .form-group.row { display: flex; align-items: center; }
                    label { display: block; margin-bottom: 5px; font-weight: 600; }
                    .row label { width: 220px; margin-bottom: 0; flex-shrink: 0; }
                    .row .row-content { flex-grow: 1; display:flex; gap:10px; align-items: center;}
                    input[type="text"], input[type="number"], input[type="date"], input[type="time"], select { width: 100%; padding: 6px; box-sizing: border-box; background-color: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 2px; }
                    input:focus, select:focus { border-color: var(--vscode-focusBorder); outline: 1px solid var(--vscode-focusBorder); }
                    button { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; cursor: pointer; border-radius: 2px; }
                    button:hover { background-color: var(--vscode-button-hoverBackground); }
                    button.secondary { background-color: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
                    button.secondary:hover { background-color: var(--vscode-button-secondaryHoverBackground); }
                    .buttons { margin-top: 20px; text-align: right; }
                    .log-output { margin-top: 10px; padding: 10px; background-color: var(--vscode-editor-background); border: 1px solid var(--vscode-input-border); max-height: 150px; overflow-y: auto; font-family: monospace; white-space: pre-wrap; font-size: 0.9em; display: none; }
                    details { margin-top: 10px; border: 1px solid var(--vscode-input-border); border-radius: 2px; display: none; }
                    summary { background-color: var(--vscode-editor-background); padding: 5px; cursor: pointer; font-weight: bold; }
                    .success { color: var(--vscode-testing-iconPassed); }
                    .error { color: var(--vscode-testing-iconFailed); }
                    .browse-group { display: flex; gap: 8px; width: 100%; }
                </style>
            </head>
            <body>
                <h2>Computation Setup: ${escapeHtml(initialData.projectName)}</h2>

                <!-- Execution Mode -->
                <div class="section">
                    <span class="section-title">TRITON Executable Target</span>
                    <div class="form-group">
                        <label><input type="radio" name="execMode" value="source" ${!initialData.executable_target_mode || initialData.executable_target_mode === 'source' ? 'checked' : ''}> Build from Source</label>
                        <div id="sourceConfig" style="margin-left: 20px; margin-top: 10px; border-left: 2px solid var(--vscode-focusBorder); padding-left: 10px;">
                            <div class="form-group">
                                <label>TRITON Source Directory</label>
                                <div class="browse-group">
                                    <input type="text" id="triforgeSource" placeholder="/path/to/triton/source">
                                    <button id="browseSourceBtn">Browse...</button>
                                </div>
                            </div>
                            <div class="form-group">
                                <label>Build Directory</label>
                                <div class="browse-group">
                                    <input type="text" id="buildDir" placeholder="/path/to/build">
                                    <button id="browseBuildDirBtn">Browse...</button>
                                </div>
                            </div>
                            <div class="form-group">
                                <label>Build Command</label>
                                <div class="browse-group">
                                    <input type="text" id="buildCommand" placeholder="cmake .. && make">
                                    <button id="buildNowBtn">Build Now</button>
                                </div>
                            </div>
                             <details id="buildLogContainer">
                                <summary>Build Log</summary>
                                <div id="buildLog" class="log-output"></div>
                            </details>
                        </div>
                    </div>

                    <div class="form-group" style="margin-top: 15px;">
                        <label><input type="radio" name="execMode" value="executable" ${initialData.executable_target_mode === 'executable' ? 'checked' : ''}> Use Existing Executable</label>
                        <div id="execConfig" style="display: none; margin-left: 20px; margin-top: 10px; border-left: 2px solid var(--vscode-focusBorder); padding-left: 10px;">
                             <div class="form-group">
                                <label>Executable Path</label>
                                <div class="browse-group">
                                    <input type="text" id="triforgeExec" placeholder="/path/to/triton.exe">
                                    <button id="browseExecBtn">Browse...</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="form-group" style="margin-top: 15px;">
                        <label><input type="radio" name="execMode" value="docker" ${initialData.executable_target_mode === 'docker' ? 'checked' : ''}> Use Docker Image</label>
                        <div id="dockerConfig" style="display: none; margin-left: 20px; margin-top: 10px; border-left: 2px solid var(--vscode-focusBorder); padding-left: 10px;">
                            <div class="form-group">
                                <label>Docker Image Name</label>
                                <div class="browse-group">
                                    <input type="text" id="dockerImage" placeholder="e.g. triton:latest">
                                    <button id="downloadDockerBtn">Download/Pull</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <span class="section-title">Simulation Parameters</span>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div>
                             <div class="form-group row">
                                <label>Start Date</label>
                                <div class="row-content">
                                    <input type="date" id="startDate">
                                </div>
                            </div>
                             <div class="form-group row">
                                <label>Start Time</label>
                                <div class="row-content">
                                    <input type="time" id="startTime" value="12:00">
                                </div>
                            </div>
                            <div class="form-group row">
                                <label>Timezone</label>
                                <div class="row-content">
                                    <select id="timezone">
                                        <option value="UTC" ${initialData.timezone === 'UTC' ? 'selected' : ''}>UTC</option>
                                        <option value="Local" ${initialData.timezone === 'Local' ? 'selected' : ''}>Local</option>
                                    </select>
                                </div>
                            </div>
                             <div class="form-group row">
                                <label>Sim Start (HH:MM)</label>
                                <div class="row-content">
                                    <input type="number" id="sim_start_hr" placeholder="HH" min="0" style="width: 60px;"> : 
                                    <input type="number" id="sim_start_min" placeholder="MM" min="0" max="59" style="width: 60px;">
                                </div>
                            </div>
                             <div class="form-group row">
                                <label>Duration (HH:MM)</label>
                                <div class="row-content">
                                    <input type="number" id="sim_duration_hr" placeholder="HH" min="0" style="width: 60px;"> : 
                                    <input type="number" id="sim_duration_min" placeholder="MM" min="0" max="59" style="width: 60px;">
                                </div>
                            </div>
                            <div class="form-group row">
                                <label for="print_option">Print Option</label>
                                <div class="row-content">
                                    <select id="print_option">
                                        <option value="huv" ${initialData.print_option === 'huv' ? 'selected' : ''}>huv</option>
                                        <option value="hu" ${initialData.print_option === 'hu' ? 'selected' : ''}>hu</option>
                                        <option value="hv" ${initialData.print_option === 'hv' ? 'selected' : ''}>hv</option>
                                        <option value="uv" ${initialData.print_option === 'uv' ? 'selected' : ''}>uv</option>
                                        <option value="h" ${initialData.print_option === 'h' ? 'selected' : ''}>h</option>
                                        <option value="u" ${initialData.print_option === 'u' ? 'selected' : ''}>u</option>
                                        <option value="v" ${initialData.print_option === 'v' ? 'selected' : ''}>v</option>
                                    </select>
                                </div>
                            </div>
                            <div class="form-group row">
                                <label for="print_interval">Print Interval (s)</label>
                                <div class="row-content">
                                    <input type="number" id="print_interval" value="${initialData.print_interval}">
                                </div>
                            </div>
                        </div>
                        <div>
                            <div class="form-group row">
                                <label for="time_increment_fixed">Time Increment Fixed</label>
                                <div class="row-content">
                                    <select id="time_increment_fixed">
                                        <option value="0" ${initialData.time_increment_fixed === 0 ? 'selected' : ''}>0 (Variable)</option>
                                        <option value="1" ${initialData.time_increment_fixed === 1 ? 'selected' : ''}>1 (Constant)</option>
                                    </select>
                                </div>
                            </div>
                            <div class="form-group row">
                                <label for="time_step">Time Step</label>
                                <div class="row-content">
                                    <input type="number" step="any" id="time_step" value="${initialData.time_step}">
                                </div>
                            </div>
                            <div class="form-group row">
                                <label for="courant">Courant</label>
                                <div class="row-content">
                                    <input type="number" step="any" id="courant" value="${initialData.courant}">
                                </div>
                            </div>
                             <div class="form-group row">
                                <label for="gpu_direct_flag">GPU Direct Flag</label>
                                <div class="row-content">
                                    <select id="gpu_direct_flag">
                                        <option value="0" ${initialData.gpu_direct_flag === 0 ? 'selected' : ''}>0</option>
                                        <option value="1" ${initialData.gpu_direct_flag === 1 ? 'selected' : ''}>1</option>
                                    </select>
                                </div>
                            </div>
                            <div class="form-group row">
                                <label for="domain_decomposition">Domain Decomp</label>
                                <div class="row-content">
                                    <select id="domain_decomposition">
                                        <option value="static" ${initialData.domain_decomposition === 'static' ? 'selected' : ''}>Static</option>
                                        <option value="dynamic" ${initialData.domain_decomposition === 'dynamic' ? 'selected' : ''}>Dynamic</option>
                                    </select>
                                </div>
                            </div>
                            <div class="form-group row">
                                <label for="factor_interval_domain_decomposition">Factor Interval DD</label>
                                <div class="row-content">
                                    <input type="number" id="factor_interval_domain_decomposition" value="${initialData.factor_interval_domain_decomposition}">
                                </div>
                            </div>
                             <div class="form-group row">
                                <label for="open_boundaries">Open Boundaries</label>
                                <div class="row-content">
                                    <select id="open_boundaries">
                                        <option value="0" ${initialData.open_boundaries === 0 ? 'selected' : ''}>0</option>
                                        <option value="1" ${initialData.open_boundaries === 1 ? 'selected' : ''}>1</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="buttons">
                    <button id="okBtn">Ok</button>
                    <button id="cancelBtn" class="secondary">Cancel</button>
                </div>

                <script nonce="${nonce}">
                    const initialData = ${dataJson};
                </script>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
}
