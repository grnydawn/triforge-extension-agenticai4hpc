export function getProjectCreatorHtml(cspSource: string, nonce: string, defaultPath: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Create New Project</title>
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
        .version-info {
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground);
            float: right;
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
        .form-group.row {
            display: flex;
            align-items: center;
            margin-bottom: 8px; 
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
        input[type="text"], input[type="number"], input[type="date"], input[type="time"], select { 
            width: 100%; 
            padding: 6px 8px; 
            box-sizing: border-box; 
            background-color: var(--vscode-input-background); 
            color: var(--vscode-input-foreground); 
            border: 1px solid #808080 !important; /* Force visible border */
            border-radius: 2px;
            font-size: 1em;
        }
        input:focus, select:focus {
            outline: 1px solid var(--vscode-focusBorder);
            border-color: var(--vscode-focusBorder) !important;
        }
        .description-row {
            margin-top: 0;
            margin-bottom: 20px;
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            line-height: 1.4;
            margin-left: 235px; 
        }
        .utm-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin-left: 0;
            margin-bottom: 20px;
        }
        .utm-item {
            display: flex;
            align-items: center;
        }
        .utm-item label {
            width: 120px;
            font-size: 0.9em;
        }
        .buttons { 
            margin-top: 40px; 
            display: flex; 
            gap: 12px; 
            border-top: 1px solid var(--vscode-settings-headerBorder);
            padding-top: 20px;
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
        button.secondary { 
            background-color: var(--vscode-button-secondaryBackground); 
            color: var(--vscode-button-secondaryForeground); 
        }
        button.secondary:hover { 
            background-color: var(--vscode-button-secondaryHoverBackground); 
        }
    </style>
</head>

<body>
    <h2>Create New Project <span class="version-info">v0.1.0</span></h2>
    
    <div class="section-header">General</div>

    <div class="form-group row">
        <label for="projectName">Project Name</label>
        <div class="row-content">
            <input type="text" id="projectName" placeholder="MyFloodProject" autofocus>
        </div>
    </div>
    <div class="description-row">The name of your new Triforge project. This will be the folder name.</div>
    
    <div class="form-group row">
        <label for="projectPath">Project Location</label>
        <div class="row-content">
            <input type="text" id="projectPath" value="${defaultPath}" placeholder="/path/to/project">
            <button id="browseBtn" class="secondary">Browse...</button>
        </div>
    </div>
    <div class="description-row">The directory where your project will be created.</div>

    <div class="section-header">TRITON Data File Format</div>

    <div class="form-group row">
        <label for="inputFormat">Input Format</label>
        <div class="row-content">
            <select id="inputFormat">
                <option value="ASC" selected>Ascii</option>
                <option value="BIN">Binary</option>
            </select>
        </div>
    </div>
    <div class="description-row">Format for input raster files (DEM, Initial Input, etc.)</div>

    <div class="form-group row">
        <label for="outputFormat">Output Format</label>
        <div class="row-content">
            <select id="outputFormat">
                <option value="ASC" selected>Ascii</option>
                <option value="BIN">Binary</option>
                <option value="GTIFF">GeoTIFF</option>
            </select>
        </div>
    </div>
    <div class="description-row">Format for generated output files.</div>

    <div class="section-header">Simulation Area in UTM (Universal Transverse Mercator)</div>

    <div style="margin-bottom: 10px; display: flex; gap: 10px; align-items: center;">
        <button id="loadDemFileBtn" class="secondary">Load from DEM File...</button>
        <span style="font-size: 0.9em; color: var(--vscode-descriptionForeground);">Auto-fill UTM parameters from a .dem or .asc file.</span>
    </div>

    <div style="margin-bottom: 20px; display: flex; gap: 10px; align-items: center;">
        <button id="generateFromMapBtn" type="button" class="secondary">Generate from Map...</button>
        <span style="font-size: 0.9em; color: var(--vscode-descriptionForeground);">Define simulation area bounds using an interactive map.</span>
    </div>

    <div class="utm-grid">
        <div class="utm-item">
            <label for="ncols">Ncols</label>
            <input type="number" id="ncols" placeholder="0">
        </div>
        <div class="utm-item">
            <label for="nrows">Nrows</label>
            <input type="number" id="nrows" placeholder="0">
        </div>
        <div class="utm-item">
            <label for="xllcorner">Xllcorner</label>
            <input type="number" step="any" id="xllcorner" placeholder="0.0">
        </div>
        <div class="utm-item">
            <label for="yllcorner">Yllcorner</label>
            <input type="number" step="any" id="yllcorner" placeholder="0.0">
        </div>
        <div class="utm-item">
            <label for="cellsize">Cellsize</label>
            <input type="number" step="any" id="cellsize" placeholder="0.0">
        </div>
        <div class="utm-item">
            <label for="nodata">NoData Value</label>
            <input type="number" step="any" id="nodata" value="-9999">
        </div>
        <div class="utm-item">
            <label for="utmZone">UTM Zone</label>
            <input type="text" id="utmZone" placeholder="e.g. 16N">
        </div>
        <div class="utm-item">
            <label for="datum">Datum</label>
            <select id="datum">
                <option value="WGS84">WGS84 (EPSG:4326)</option>
                <option value="NAD83">NAD83 (EPSG:4269)</option>
            </select>
        </div>
    </div>



    <div class="buttons">
        <button id="createBtn">Create Project</button>
        <button id="cancelBtn" class="secondary">Cancel</button>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        console.log('ProjectCreator v0.0.416+ loaded');
        console.log('Default Path provided:', '${defaultPath.replace(/\\/g, '\\\\')}');
        
        const nameInput = document.getElementById('projectName');
        const pathInput = document.getElementById('projectPath');


        // UTM fields
        const utmZoneInput = document.getElementById('utmZone');

        const ncolsInput = document.getElementById('ncols');
        const nrowsInput = document.getElementById('nrows');
        const xllInput = document.getElementById('xllcorner');
        const yllInput = document.getElementById('yllcorner');
        const cellsizeInput = document.getElementById('cellsize');
        const nodataInput = document.getElementById('nodata');



        // State for parent path
        let parentPath = '${defaultPath.replace(/\\/g, '\\\\')}';

        function updateFullPath() {
             const name = nameInput.value.trim();
             const separator = parentPath.includes('/') ? '/' : '\\\\';
             
             // Clean trailing separator from parent
             const cleanParent = (parentPath.endsWith('/') || parentPath.endsWith('\\\\')) 
                    ? parentPath.slice(0, -1) 
                    : parentPath;

             if (name) {
                 pathInput.value = cleanParent + separator + name;
             } else {
                 pathInput.value = cleanParent;
             }
        }
        
        // Initialize
        updateFullPath();

        nameInput.addEventListener('input', () => {
            updateFullPath();
        });

        document.getElementById('browseBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'browseLocation' });
        });

        document.getElementById('loadDemFileBtn').addEventListener('click', () => {
            const inputFormatSelect = document.getElementById('inputFormat');
            const fmt = inputFormatSelect ? inputFormatSelect.value : 'ASC';
            vscode.postMessage({ command: 'browseDemFile', inputFormat: fmt });
        });

        document.getElementById('generateFromMapBtn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const cellVal = parseFloat(cellsizeInput.value);
            if (!cellsizeInput.value || isNaN(cellVal) || cellVal <= 0) {
                // Show modal warning
                vscode.postMessage({ 
                    command: 'alert', 
                    text: 'Please enter a valid Cellsize (> 0) before generating from map.' 
                });
                // Highlight border red
                cellsizeInput.style.borderColor = 'red';
                return;
            }

            // Reset border color if valid (optional, but good practice)
            cellsizeInput.style.borderColor = ''; // or existing default logic

            vscode.postMessage({ 
                command: 'generateFromMap',
                cellsize: cellVal
            });
        });

        // Improve UX: Prevent Enter key from triggering unintended actions (like submitting form)
        // Require explicit button clicks.
        const formInputs = document.querySelectorAll('input, select');
        formInputs.forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                }
            });
        });

        // State for loaded DEM path
        let loadedDemPath = '';

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateLocation':
                    parentPath = message.path;
                    updateFullPath();
                    break;

                case 'applyDemHeader':
                    const h = message.header;
                    if (message.path) {
                        loadedDemPath = message.path;
                    }
                    if (message.utmZone) utmZoneInput.value = message.utmZone;
                    
                    const datumSelect = document.getElementById('datum');
                    if (message.datum && datumSelect) {
                        const val = message.datum;
                        // Check if option exists
                        let exists = false;
                        for (let i = 0; i < datumSelect.options.length; i++) {
                            if (datumSelect.options[i].value === val) {
                                exists = true;
                                break;
                            }
                        }
                        
                        if (!exists) {
                            // Add new option
                            const opt = document.createElement('option');
                            opt.value = val;
                            opt.text = val + ' (Custom)';
                            datumSelect.add(opt);
                        }
                        datumSelect.value = val;
                    } else if (datumSelect) {
                         // Default logic
                    }

                    ncolsInput.value = h.ncols;
                    nrowsInput.value = h.nrows;
                    xllInput.value = h.xllcorner;
                    yllInput.value = h.yllcorner;
                    cellsizeInput.value = h.cellsize;
                    nodataInput.value = h.NODATA_value;
                    break;
            }
        });

        // Helper to mark field as valid/invalid
        function setFieldStatus(inputId, isValid) {
            const input = document.getElementById(inputId);
            if (!input) return;
            let label = null;
            const parent = input.closest('.form-group') || input.closest('.utm-item');
            if (parent) {
                label = parent.querySelector('label');
            }

            if (label) {
                label.style.color = isValid ? 'var(--vscode-foreground)' : 'red';
            }
        }

        // Add clear-error listeners
        const allInputs = [nameInput, pathInput, utmZoneInput, ncolsInput, nrowsInput, xllInput, yllInput, cellsizeInput, nodataInput];
        allInputs.forEach(input => {
            if(input) {
                input.addEventListener('input', () => {
                   setFieldStatus(input.id, true);
                });
            }
        });

        // Helper to detect UTM Zone from geolocation
        function detectUtmZone() {
            return new Promise((resolve) => {
                if (!navigator.geolocation) {
                    resolve(null);
                    return;
                }
                const timeoutId = setTimeout(() => resolve(null), 3000); // 3s timeout

                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        clearTimeout(timeoutId);
                        try {
                            const lat = position.coords.latitude;
                            const lon = position.coords.longitude;
                            const zoneNumber = Math.floor((lon + 180) / 6) + 1;
                            const hemisphere = lat >= 0 ? 'N' : 'S';
                            resolve(zoneNumber + hemisphere);
                        } catch (e) {
                            resolve(null);
                        }
                    },
                    (err) => {
                        clearTimeout(timeoutId);
                        resolve(null);
                    },
                    { enableHighAccuracy: false, timeout: 3000 }
                );
            });
        }

        document.getElementById('createBtn').addEventListener('click', async () => {
            const projectName = nameInput.value.trim();
            const projectLocation = pathInput.value.trim();
            const outputPath = ''; 

            let isValid = true;
            let invalidFields = [];

            // 1. Check Project Name
            if (!projectName) {
                setFieldStatus('projectName', false);
                isValid = false;
                invalidFields.push('Project Name');
            }

            // 2. Check Project Location
            if (!projectLocation || projectLocation.includes('<Location>') || projectLocation.includes('<Name>')) {
                setFieldStatus('projectPath', false);
                isValid = false;
                invalidFields.push('Project Location');
            }

            // Logic: If UTM Zone is missing, try to detect or default to 16N
            if (!utmZoneInput.value) {
                 // Show a temporary loading state if needed, or just wait
                 const zones = await detectUtmZone();
                 utmZoneInput.value = zones || '16N';
                 // Clear potential error status
                 setFieldStatus('utmZone', true);
            }

            // 4. Check UTM Fields (basic check for empty)
            if (!utmZoneInput.value) { setFieldStatus('utmZone', false); isValid = false; }
            if (!ncolsInput.value) { setFieldStatus('ncols', false); isValid = false; }
            if (!nrowsInput.value) { setFieldStatus('nrows', false); isValid = false; }
            
            // Validate Cellsize
            const cellSizeVal = parseFloat(cellsizeInput.value);
            if (!cellsizeInput.value || isNaN(cellSizeVal) || cellSizeVal <= 0) {
                 setFieldStatus('cellsize', false); 
                 isValid = false; 
                 invalidFields.push('Cellsize (>0)');
            }
            



            if (!isValid) {
                vscode.postMessage({ 
                    command: 'alert', 
                    text: 'Please check the highlighted fields. Note: Default placeholders must be replaced.' 
                });
                return;
            }

            const utmZone = utmZoneInput.value.trim();
            const utmHeader = {
                ncols: parseInt(ncolsInput.value) || 0,
                nrows: parseInt(nrowsInput.value) || 0,
                xllcorner: parseFloat(xllInput.value) || 0,
                yllcorner: parseFloat(yllInput.value) || 0,
                cellsize: parseFloat(cellsizeInput.value) || 0,
                NODATA_value: parseFloat(nodataInput.value) || -9999
            };


            
            // Also include datum selection
            const datumSelect = document.getElementById('datum');
            const datum = datumSelect ? datumSelect.value : 'WGS84';

            // Format Selection
            const inputFormatSelect = document.getElementById('inputFormat');
            const outputFormatSelect = document.getElementById('outputFormat');
            const inputFormat = inputFormatSelect ? inputFormatSelect.value : 'ASC';
            const outputFormat = outputFormatSelect ? outputFormatSelect.value : 'ASC';

            vscode.postMessage({
                command: 'createProject',
                data: {
                    projectName,
                    projectLocation, 
                    utmZone,
                    utmHeader,

                    datum,
                    demPath: loadedDemPath,
                    inputFormat,
                    outputFormat
                }
            });
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });
    </script>
</body>
</html>`;
}
