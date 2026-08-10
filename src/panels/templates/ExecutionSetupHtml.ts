import { Uri } from 'vscode';
import { escapeHtml, safeJsonForScript } from '../../utils/escape';

export function getExecutionSetupHtml(cspSource: string, nonce: string, initialData: any = {}, scriptUri: Uri): string {
    // Sanitized JSON data to prevent HTML injection
    const dataJson = safeJsonForScript(initialData);

    return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <title>Execution Setup</title>
                <style>
                    body { 
                        font-family: var(--vscode-font-family); 
                        color: var(--vscode-editor-foreground); 
                        background-color: var(--vscode-editor-background); 
                        padding: 40px; 
                        max-width: 900px;
                        margin: 0 auto;
                    }
                    h2 { 
                        font-weight: 500; 
                        font-size: 1.5em; 
                        margin-bottom: 20px; 
                    }
                    .section-header {
                        font-size: 1.2em;
                        font-weight: 600;
                        margin-top: 30px;
                        margin-bottom: 15px;
                        padding-bottom: 8px;
                        border-bottom: 1px solid var(--vscode-settings-headerBorder);
                        color: var(--vscode-foreground);
                    }
                    .placeholder-text {
                        font-style: italic;
                        color: var(--vscode-descriptionForeground);
                    }
                    /* Form Styles */
                    .form-group.row {
                        display: flex;
                        align-items: center;
                        margin-bottom: 12px; 
                    }
                    label { 
                        font-weight: 600; 
                        font-size: 1em;
                        width: 220px; 
                        flex-shrink: 0;
                        margin-bottom: 0;
                        margin-right: 15px;
                    }
                    .row-content {
                        flex-grow: 1;
                        display: flex;
                        gap: 10px;
                    }
                    input[type="text"], input[type="number"] { 
                        width: 100%; 
                        padding: 6px 8px; 
                        box-sizing: border-box; 
                        background-color: var(--vscode-input-background); 
                        color: var(--vscode-input-foreground); 
                        border: 1px solid #808080; 
                        border-radius: 2px;
                        font-size: 1em;
                    }
                    input:focus {
                        outline: 1px solid var(--vscode-focusBorder);
                        border-color: var(--vscode-focusBorder);
                    }
                    textarea {
                        width: 100%;
                        padding: 6px 8px;
                        box-sizing: border-box;
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid #808080; 
                        border-radius: 2px;
                        font-size: 1em;
                        font-family: inherit;
                        resize: vertical;
                    }
                    textarea:focus {
                        outline: 1px solid var(--vscode-focusBorder);
                        border-color: var(--vscode-focusBorder);
                    }
                    button { 
                        padding: 6px 18px; 
                        cursor: pointer; 
                        background-color: var(--vscode-button-background); 
                        color: var(--vscode-button-foreground); 
                        border: none; 
                        border-radius: 2px;
                        font-size: 1em;
                        white-space: nowrap;
                    }
                    button:hover { 
                        background-color: var(--vscode-button-hoverBackground); 
                    }
                    .buttons { 
                        margin-top: 40px; 
                        display: flex; 
                        gap: 12px; 
                        border-top: 1px solid var(--vscode-settings-headerBorder);
                        padding-top: 20px;
                        justify-content: flex-end;
                    }
                    details {
                        margin-top: 15px;
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 2px;
                        display: none;
                    }
                    summary {
                        background-color: var(--vscode-editor-background);
                        padding: 8px;
                        cursor: pointer;
                        font-weight: 600;
                        user-select: none;
                        border-bottom: 1px solid var(--vscode-input-border);
                    }
                    pre {
                        padding: 10px;
                        margin: 0;
                        white-space: pre-wrap;
                        max-height: 200px;
                        overflow-y: auto;
                        font-family: monospace;
                        font-size: 0.9em;
                        border: none;
                    }
                </style>
            </head>
            <body>
                <h2>Execution Setup (${escapeHtml(initialData.projectName)})</h2>

                <div class="section-header">Execution Config</div>

                <!-- Execution Type (Interactive vs Batch) -->
                <div class="form-group row">
                    <label>Execution Type:</label>
                    <div style="display: flex; gap: 15px;">
                        <div>
                            <input type="radio" id="typeInteractive" name="execution_type" value="interactive" checked>
                            <label for="typeInteractive" style="width: auto; font-weight: normal;">Interactive</label>
                        </div>
                        <div>
                            <input type="radio" id="typeBatch" name="execution_type" value="batch">
                            <label for="typeBatch" style="width: auto; font-weight: normal;">Batch</label>
                        </div>
                    </div>
                </div>

                <div class="section-header">System Configuration</div>

                <div class="form-group row">
                    <label for="run_directory">Run Directory</label>
                    <div class="row-content">
                        <input type="text" id="run_directory" placeholder="/path/to/run_dir">
                    </div>
                </div>

                <!-- Batch Header (Visible only in Batch mode) -->
                <div class="form-group row" id="batch_header_group" style="display: none; align-items: flex-start;">
                    <label for="batch_header">Batch Script Header</label>
                    <div class="row-content">
                         <textarea id="batch_header" rows="5" placeholder="#!/bin/bash\n#SBATCH ..."></textarea>
                    </div>
                </div>

                <div class="form-group row">
                    <label for="run_command" id="run_command_label">Run Command</label>
                    <div class="row-content">
                        <input type="text" id="run_command" placeholder="e.g. mpirun -np 4 ./triton">
                    </div>
                </div>

                <!-- Step Launch Command (Visible only in Batch mode) -->
                <div class="form-group row" id="step_launch_group" style="display: none;">
                    <label for="step_launch_command">Step Launch Command</label>
                    <div class="row-content">
                        <input type="text" id="step_launch_command" placeholder="e.g. srun <triton_target>">
                    </div>
                </div>

                <div class="form-group row" style="align-items: flex-start;">
                    <label for="env_variables">Environment Variables</label>
                    <div class="row-content">
                         <textarea id="env_variables" rows="3" placeholder="VAR1=value1\nVAR2=value2"></textarea>
                    </div>
                </div>

                <!-- Hidden inputs for logic -->
                <div class="section-header">Output Generation</div>
                <!-- Moved Print Option and Interval to Computation Setup -->
                <div class="form-group row">
                    <label for="print_observation">Print Observation (s)</label>
                    <div class="row-content">
                        <input type="number" id="print_observation" value="${initialData.print_observation}" style="width: 150px;">
                    </div>
                </div>
                <div class="form-group row" id="projection_group">
                    <label for="projection">Projection (EPSG/WKT)</label>
                    <div class="row-content">
                        <input type="text" id="projection" value="${initialData.projection}">
                    </div>
                </div>
                <div class="form-group row">
                    <label for="output_option">Output Option</label>
                    <div class="row-content">
                        <select id="output_option" style="width: 150px;">
                            <option value="PAR" ${initialData.output_option === 'PAR' ? 'selected' : ''}>PAR (Parallel)</option>
                            <option value="SEQ" ${initialData.output_option === 'SEQ' ? 'selected' : ''}>SEQ (Single)</option>
                        </select>
                    </div>
                </div>
                <div class="form-group row">
                    <label for="outfile_pattern">Output Filename Pattern</label>
                    <div class="row-content">
                        <input type="text" id="outfile_pattern" value="${initialData.outfile_pattern}">
                    </div>
                </div>
                <div class="form-group row">
                    <label for="it_print">Iteration Print Interval</label>
                    <div class="row-content">
                        <input type="number" id="it_print" value="${initialData.it_print}" style="width: 150px;">
                    </div>
                </div>
                <div class="form-group row">
                    <label for="it_count">IT Count</label>
                    <div class="row-content">
                        <input type="number" id="it_count" value="${initialData.it_count}" style="width: 150px;">
                    </div>
                </div>
                <div class="form-group row">
                    <label for="checkpoint_id">Checkpoint ID</label>
                    <div class="row-content">
                        <input type="number" id="checkpoint_id" value="${initialData.checkpoint_id}" style="width: 150px;">
                    </div>
                </div>

                <div class="buttons">
                    <button id="runBtn">Run Simulation</button>
                </div>

                <details id="logDetails" style="display:none;">
                    <summary>Execution Output</summary>
                    <pre id="executionLog"></pre>
                </details>

                <script nonce="${nonce}">
                    const initialData = ${dataJson};
                </script>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
}
