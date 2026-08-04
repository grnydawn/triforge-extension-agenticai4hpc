import { escapeHtml, safeJsonForScript } from '../../utils/escape';

export function getInputGeneratorHtml(cspSource: string, styleUri: string, nonce: string, leafletJsUri: string, leafletCssUri: string, initialData: any = {}): string {
    // SEC-3: escape the serialized data so a `</script>`/markup payload (e.g. in
    // the project name) cannot break out of the inline <script> below.
    const dataJson = safeJsonForScript(initialData);

    return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <!-- CSP: SEC-4 — Leaflet is bundled locally under the extension; no third-party CDN. -->
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data: https:; script-src 'nonce-${nonce}'; connect-src https:;">
                <link href="${styleUri}" rel="stylesheet">
                <!-- Leaflet CSS (local) -->
                <link rel="stylesheet" href="${leafletCssUri}" />
                <style>
                    /* Force default cursor on the DEM polygon */
                    .dem-area-cursor {
                        cursor: default !important;
                    }
                    /* Ensure streamflow popup stands out if needed */
                    .streamflow-popup {
                        font-size: 12px;
                    }
                    /* Custom DivIcon for Streamflow Markers */
                    .streamflow-marker-icon {
                        background-color: #007bff;
                        border: 2px solid #fff;
                        border-radius: 50%;
                        box-shadow: 0 0 4px rgba(0,0,0,0.5);
                    }
                    /* Context Menu Styles */
                    /* Context Menu Styles (Shared / Extended) */
                    #map-context-menu, #marker-context-menu {
                        position: absolute;
                        z-index: 10000; /* Above map */
                        background: #333;
                        border: 1px solid #555;
                        border-radius: 4px;
                        padding: 5px 0;
                        min-width: 150px;
                        display: none;
                        box-shadow: 2px 2px 5px rgba(0,0,0,0.4);
                        font-family: inherit;
                        color: #ccc;
                    }
                    .context-menu-item {
                        padding: 8px 12px;
                        cursor: pointer;
                        font-size: 13px;
                    }
                    .context-menu-item:hover {
                        background-color: #444;
                        color: #fff;
                    }
                    #marker-context-menu-remove:hover {
                        background-color: #d9534f; /* Bootstrap Danger Red */
                        color: #fff;
                    }
                    /* Streamflow Config UI */
                    .sf-config-container {
                        margin-top: 10px;
                        padding: 0;
                        /* border: 1px solid #444; */ /* Removed */
                        /* background: #252526; */ /* Removed */
                    }
                    /* Graph UI */
                    #sf-graph-container {
                        margin-top: 15px;
                        height: 250px;
                        overflow-x: auto;
                        overflow-y: hidden;
                        border: 1px solid #ccc;
                        background: #ffffff;
                        position: relative;
                    }
/* ... Lines 69-388 omitted in thought but replace will target specific blocks ... */
/* Wait, I can't skip lines in replace_file_content easily without multiple chunks or big block. 
I will target the CSS block (lines 30-51) and the HTML block (lines 389-391).
Let's do CSS first.
*/
                    /* Streamflow Config UI */
                    .sf-config-container {
                        margin-top: 10px;
                        padding: 0;
                        /* border: 1px solid #444; */ /* Removed */
                        /* background: #252526; */ /* Removed */
                    }
                    /* Graph UI */
                    #sf-graph-container {
                        margin-top: 15px;
                        height: 250px;
                        overflow-x: auto;
                        overflow-y: hidden;
                        border: 1px solid #ccc;
                        background: #ffffff;
                        position: relative;
                    }
                    #sf-graph-svg {
                        display: block;
                        background: transparent;
                        cursor: crosshair;
                    }
                    .bar-rect {
                        fill: #007bff;
                        transition: fill 0.1s;
                    }
                    .bar-rect:hover {
                        fill: #4da3ff;
                        cursor: ns-resize;
                    }
                    .axis-line {
                        stroke: #333;
                        stroke-width: 1;
                    }
                    .axis-text {
                        fill: #333;
                        font-size: 10px;
                        user-select: none;
                    }
                    .grid-line {
                        stroke: #eee;
                        stroke-width: 0.5;
                        stroke-dasharray: 2,2;
                    }
                    .sf-config-row {
                        display: flex;
                        align-items: center;
                        gap: 15px;
                        margin-bottom: 5px;
                    }
                    .sf-config-row label {
                        min-width: 120px;
                        font-weight: 600;
                    }
                    .sf-hidden {
                        display: none !important;
                    }
                </style>
                <title>Generate Static Input (${escapeHtml(initialData.projectName)})</title>
            </head>
            <body>
                <div class="container">
                    <div class="sidebar">
                    <div class="sidebar-header">Input Types</div>
                        <ul class="nav-list" id="static-list">
                            <li class="nav-item active" data-target="dem">Elevation</li>
                            <li class="nav-item" data-target="h-initial">Water Depth</li>
                            <li class="nav-item" data-target="qxqy-initial">Water Discharge</li>
                            <li class="nav-item" data-target="manning">Surface Roughness</li>
                            <li class="nav-item" data-target="runoff-map">Runoff</li>
                            <li class="nav-item" data-target="boundaries">External boundaries</li>
                            <li class="nav-item" data-target="observation">Observation locations</li>
                        </ul>
                        <div class="sidebar-header" id="dynamic-header" style="margin-top: 20px;">Dynamic Inputs</div>
                        <ul class="nav-list" id="dynamic-list">
                            <li class="nav-item" data-target="streamflow">Streamflow hydrograph</li>
                            <li class="nav-item" data-target="runoff-hydro">Runoff hydrograph</li>
                        </ul>
                    </div>
                    <div class="content">
                        <div id="sidebar-toggle" class="sidebar-toggle" title="Toggle Sidebar">&#9776;</div>
                        
                        <!-- DEM Page -->
                        <div id="dem" class="page active">
                            <h2>Elevation</h2>
                            <div class="tab-bar">
                                <div class="tab active" data-target="dem-tab-file">Load from File(s)</div>
                                <div class="tab" data-target="dem-tab-online">Generate from Online Resources</div>
                                <div class="tab" data-target="dem-tab-create">Create/Edit</div>
                            </div>
                            <div class="tab-content">
                                <div id="dem-tab-file" class="tab-pane active">
                                    <div class="form-group">
                                        <label>Elevation File Path</label>
                                        <div class="flex-gap-10">
                                            <input type="text" id="demFilePath" readonly placeholder="No file selected">
                                            <button id="btnSelectDemFile" type="button">Browse...</button>
                                        </div>
                                        <p class="description-text">
                                            Select a local Elevation file (.dem, .asc, .tif). The Simulation Area will be updated automatically.
                                        </p>
                                    </div>
                                </div>
                                <div id="dem-tab-online" class="tab-pane">
                                    <div class="form-group">
                                        <label for="demSource">Elevation Online Resource</label>
                                        <select id="demSource">
                                            <option value="" disabled selected>Select a source...</option>
                                            <option value="OpenTopography">OpenTopography (Global)</option>
                                        </select>
                                    </div>
                                    <div id="opentopography-config" class="hidden ot-config-container">
                                        <div class="form-group">
                                            <label for="otApiKey">OpenTopography API Key</label>
                                            <input type="password" id="otApiKey" placeholder="Enter your API Key">
                                            <div class="flex-align-center-margin-top-12">
                                                <input type="checkbox" id="saveApiKey" class="checkbox-config">
                                                <label for="saveApiKey" class="label-config">Save API key</label>
                                            </div>
                                            <p class="ot-description-text">
                                                An API Key is required. <a href="https://opentopography.org/developers">Get one here</a>.
                                            </p>
                                        </div>
                                    </div>
                                    <div id="dem-tab-create" class="tab-pane">
                                        <p class="placeholder-text">Create new Elevation manually (Coming Soon).</p>
                                    </div>
                                </div>
                            </div>
                            <div class="page-footer">
                                <button type="button" class="secondary" id="btnCancelDemFooter">Cancel</button>
                                <button type="button" id="btnOkDemFooter">Ok</button>
                            </div>
                        </div>

                        <!-- H Initial Input Page -->
                        <div id="h-initial" class="page">
                            <h2>Water Depth</h2>
                            
                                <div class="tab-bar">
                                    <div class="tab active" data-target="ii-tab-file">Load from File(s)</div>
                                    <div class="tab" data-target="ii-tab-online">Generate from Online Resources</div>
                                    <div class="tab" data-target="ii-tab-create">Create/Edit</div>
                                </div>

                                <div class="tab-content">
                                    <div id="ii-tab-file" class="tab-pane active">
                                        <div class="form-group">
                                            <label>Water Depth File</label>
                                            <div class="flex-gap-10">
                                                <input type="text" id="ii_filePath" readonly placeholder="No file selected">
                                                <button id="ii_btnSelectFile" type="button">Browse...</button>
                                            </div>
                                        </div>
                                    </div>
                                    <div id="ii-tab-online" class="tab-pane">
                                        <p class="placeholder-text">Online generation not supported for Water Depth yet.</p>
                                    </div>
                                    <div id="ii-tab-create" class="tab-pane">
                                        <p class="placeholder-text">Create new Water Depth (Coming Soon).</p>
                                    </div>
                                </div>
                            
                            <div class="page-footer">
                                <button type="button" class="secondary" id="btnCancelHFooter">Cancel</button>
                                <button type="button" id="btnOkHFooter">Ok</button>
                            </div>
                        </div>

                        <!-- QX QY Initial Input Page -->
                         <div id="qxqy-initial" class="page">
                            <h2>Water Discharge</h2>
                            
                                <div class="tab-bar">
                                    <div class="tab active" data-target="qxqy-tab-file">Load from File(s)</div>
                                    <div class="tab" data-target="qxqy-tab-online">Generate from Online Resources</div>
                                    <div class="tab" data-target="qxqy-tab-create">Create/Edit</div>
                                </div>

                                <div class="tab-content">
                                    <div id="qxqy-tab-file" class="tab-pane active">
                                        <div class="form-group">
                                            <label for="qx_filePath">Water Discharge Files</label>
                                            <div class="flex-gap-10">
                                                <input type="text" id="qx_filePath" readonly placeholder="No files selected">
                                                <button id="btnSelectQxFile" type="button">Browse Files...</button>
                                            </div>
                                            <p class="description-text">
                                                Select both QX and QY files (multiselect).
                                            </p>
                                        </div>
                                    </div>
                                    <div id="qxqy-tab-online" class="tab-pane">
                                        <p class="placeholder-text">Online generation not supported for Water Discharge yet.</p>
                                    </div>
                                    <div id="qxqy-tab-create" class="tab-pane">
                                        <p class="placeholder-text">Create Water Discharge manually (Coming Soon).</p>
                                    </div>
                                </div>
                            
                            <div class="page-footer">
                                <button type="button" class="secondary" id="btnCancelQxQyFooter">Cancel</button>
                                <button type="button" id="btnOkQxQyFooter">Ok</button>
                            </div>
                        </div>

                        <!-- Other Pages -->
                        <div id="manning" class="page">
                            <h2>Surface Roughness</h2>
                            <div class="tab-bar">
                                <div class="tab active" data-target="manning-tab-file">Load from File(s)</div>
                                <div class="tab" data-target="manning-tab-online">Generate from Online Resources</div>
                                <div class="tab" data-target="manning-tab-create">Create/Edit</div>
                            </div>
                            <div class="tab-content">
                                <div id="manning-tab-file" class="tab-pane active">
                                    <p class="placeholder-text">Settings for Surface Roughness.</p>
                                </div>
                                <div id="manning-tab-online" class="tab-pane">
                                    <p class="placeholder-text">Online generation not supported for Surface Roughness yet.</p>
                                </div>
                                <div id="manning-tab-create" class="tab-pane">
                                    <p class="placeholder-text">Create Surface Roughness manually (Coming Soon).</p>
                                </div>
                            </div>
                            <div class="page-footer">
                                <button type="button" class="secondary other-page-close">Cancel</button>
                                <button type="button" class="other-page-close">Ok</button>
                            </div>
                        </div>
                        <div id="runoff-map" class="page">
                             <h2>Runoff</h2>
                             <div class="tab-bar">
                                <div class="tab active" data-target="runoff-tab-file">Load from File(s)</div>
                                <div class="tab" data-target="runoff-tab-online">Generate from Online Resources</div>
                                <div class="tab" data-target="runoff-tab-create">Create/Edit</div>
                            </div>
                            <div class="tab-content">
                                <div id="runoff-tab-file" class="tab-pane active">
                                    <p class="placeholder-text">Settings for Runoff.</p>
                                </div>
                                <div id="runoff-tab-online" class="tab-pane">
                                    <p class="placeholder-text">Online generation not supported for Runoff yet.</p>
                                </div>
                                <div id="runoff-tab-create" class="tab-pane">
                                    <p class="placeholder-text">Create Runoff manually (Coming Soon).</p>
                                </div>
                            </div>
                             <div class="page-footer">
                                <button type="button" class="secondary other-page-close">Cancel</button>
                                <button type="button" class="other-page-close">Ok</button>
                            </div>
                        </div>
                        <div id="boundaries" class="page">
                            <h2>External boundaries</h2>
                            <div class="tab-bar">
                                <div class="tab active" data-target="boundaries-tab-file">Load from File(s)</div>
                                <div class="tab" data-target="boundaries-tab-online">Generate from Online Resources</div>
                                <div class="tab" data-target="boundaries-tab-create">Create/Edit</div>
                            </div>
                            <div class="tab-content">
                                <div id="boundaries-tab-file" class="tab-pane active">
                                    <p class="placeholder-text">Settings for External boundaries.</p>
                                </div>
                                <div id="boundaries-tab-online" class="tab-pane">
                                    <p class="placeholder-text">Online generation not supported for External boundaries yet.</p>
                                </div>
                                <div id="boundaries-tab-create" class="tab-pane">
                                    <p class="placeholder-text">Create External boundaries manually (Coming Soon).</p>
                                </div>
                            </div>
                             <div class="page-footer">
                                <button type="button" class="secondary other-page-close">Cancel</button>
                                <button type="button" class="other-page-close">Ok</button>
                            </div>
                        </div>
                        <div id="observation" class="page">
                            <h2>Observation locations</h2>
                            <div class="tab-bar">
                                <div class="tab active" data-target="observation-tab-file">Load from File(s)</div>
                                <div class="tab" data-target="observation-tab-online">Generate from Online Resources</div>
                                <div class="tab" data-target="observation-tab-create">Create/Edit</div>
                            </div>
                            <div class="tab-content">
                                <div id="observation-tab-file" class="tab-pane active">
                                    <p class="placeholder-text">Settings for Observation locations.</p>
                                </div>
                                <div id="observation-tab-online" class="tab-pane">
                                    <p class="placeholder-text">Online generation not supported for Observation locations yet.</p>
                                </div>
                                <div id="observation-tab-create" class="tab-pane">
                                    <p class="placeholder-text">Create Observation locations manually (Coming Soon).</p>
                                </div>
                            </div>
                             <div class="page-footer">
                                <button type="button" class="secondary other-page-close">Cancel</button>
                                <button type="button" class="other-page-close">Ok</button>
                            </div>
                        </div>

                        <!-- Dynamic Inputs -->
                        <div id="streamflow" class="page">
                            <h2>Streamflow hydrograph</h2>
                            <div class="tab-bar">
                                <div class="tab active" data-target="flow-tab-file">Load from File(s)</div>
                                <div class="tab" data-target="flow-tab-online">Generate from Online Resources</div>
                                <div class="tab" data-target="flow-tab-create">Create/Edit</div>
                            </div>
                            <div class="tab-content">
                                <div id="flow-tab-file" class="tab-pane active">
                                    <div class="form-group">
                                        <label>Number of Stream Sources</label>
                                        <input type="number" id="streamflowNumSources" placeholder="Enter number of sources">
                                    </div>
                                    <div class="form-group">
                                        <label>Streamflow Location File</label>
                                        <div style="display: flex; gap: 10px;">
                                            <input type="text" id="streamflowLocPath" readonly placeholder="No file selected">
                                            <button type="button" id="btnSelectStreamflowLoc">Browse...</button>
                                        </div>
                                    </div>
                                    <div class="form-group">
                                        <label>Streamflow Dynamic File</label>
                                        <div style="display: flex; gap: 10px;">
                                            <input type="text" id="streamflowDynPath" readonly placeholder="No file selected">
                                            <button type="button" id="btnSelectStreamflowDyn">Browse...</button>
                                        </div>
                                    </div>
                                </div>
                                <div id="flow-tab-online" class="tab-pane">
                                    <p class="placeholder-text">Online resources for Streamflow (Coming Soon).</p>
                                </div>
                                <div id="flow-tab-create" class="tab-pane">
                                    <div id="streamflow-map" style="height: 400px; width: 100%; margin-bottom: 10px; border: 1px solid #444; position: relative;">
                                        <!-- Custom Context Menu -->
                                        <div id="map-context-menu">
                                            <div id="map-context-menu-item" class="context-menu-item">Move Map</div>
                                        </div>
                                        <div id="marker-context-menu">
                                            <div id="marker-context-menu-remove" class="context-menu-item">Remove Marker</div>
                                        </div>
                                    </div>
                                    <p class="description-text">
                                        Use the map to define stream locations. 
                                        Currently showing project boundary and existing sources.
                                        Right-click inside the boundary to toggle mode.
                                    </p>
                                    
                                    <!-- Streamflow Value Configuration -->
                                    <div class="sf-config-container">
                                        <div class="sf-config-row">
                                            <label for="streamflow-dist-type">Distribution Type:</label>
                                            <select id="streamflow-dist-type" style="width: 150px;">
                                                <option value="constant" selected>Constant</option>
                                                <option value="random">Random</option>
                                            </select>
                                        </div>
                                        
                                        <!-- Constant Input -->
                                        <div id="config-constant" class="sf-config-row">
                                            <label>Value:</label>
                                            <input type="number" id="sf-val-constant" value="1" step="any" style="width: 100px;">
                                        </div>
                                        
                                        <!-- Random Input -->
                                        <div id="config-random" class="sf-config-row sf-hidden">
                                            <label>Range (Min/Max):</label>
                                            <input type="number" id="sf-val-min" placeholder="Min" step="any" style="width: 80px;">
                                            <span>-</span>
                                            <input type="number" id="sf-val-max" placeholder="Max" step="any" style="width: 80px;">
                                        </div>
                                    </div>

                                    <!-- Streamflow Graph -->
                                    <h3 style="margin-top: 15px; margin-bottom: 5px; font-size: 13px;">Hydrograph Preview (Drag bars to edit)</h3>
                                    <div id="sf-graph-container">
                                        <svg id="sf-graph-svg"></svg>
                                    </div>
                                </div>
                            </div>
                            <div class="page-footer">
                                <button type="button" class="secondary" id="btnCancelStreamflow">Cancel</button>
                                <button type="button" id="btnOkStreamflow">Ok</button>
                            </div>
                        </div>

                        <div id="runoff-hydro" class="page">
                            <h2>Runoff hydrograph</h2>
                             <div class="tab-bar">
                                <div class="tab active" data-target="runoff-hydro-tab-file">Load from File(s)</div>
                                <div class="tab" data-target="runoff-hydro-tab-online">Generate from Online Resources</div>
                                <div class="tab" data-target="runoff-hydro-tab-create">Create/Edit</div>
                            </div>
                             <div class="tab-content">
                                <div id="runoff-hydro-tab-file" class="tab-pane active">
                                    <p class="placeholder-text">Load Runoff file settings.</p>
                                </div>
                                <div id="runoff-hydro-tab-online" class="tab-pane">
                                    <p class="placeholder-text">Online Runoff generation.</p>
                                </div>
                                <div id="runoff-hydro-tab-create" class="tab-pane">
                                    <p class="placeholder-text">Create Runoff manually.</p>
                                </div>
                            </div>
                            <div class="page-footer">
                                <button type="button" class="secondary" id="btnCancelRunoff">Cancel</button>
                                <button type="button" id="btnOkRunoff">Ok</button>
                            </div>
                        </div>
                    </div>
                </div>
                <script nonce="${nonce}">
                    const initialData = ${dataJson};
                    const vscode = acquireVsCodeApi();

                    // --- Visibility Logic based on Mode ---
                    const staticList = document.getElementById('static-list');
                    const dynamicList = document.getElementById('dynamic-list');
                    const dynamicHeader = document.getElementById('dynamic-header');
                    
                    if (initialData.mode === 'dynamic') {
                        // Hide Static, Show Dynamic
                        if (staticList) staticList.style.display = 'none';
                        if (dynamicHeader) dynamicHeader.style.display = 'block'; // Or 'none' if we want to hide header too since it's the only thing
                        if (dynamicList) dynamicList.style.display = 'block';
                        
                        // Activate first dynamic item
                        const firstDynamic = dynamicList.querySelector('.nav-item');
                        if (firstDynamic) {
                            // Deactivate all
                            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                            
                            // Activate
                            firstDynamic.classList.add('active');
                            const target = firstDynamic.getAttribute('data-target');
                            document.getElementById(target)?.classList.add('active');
                        }
                    } else {
                        // Default (Static): Show Static, Hide Dynamic
                        // Assuming Static is default in HTML structure, so we just hide dynamic parts
                        if (dynamicHeader) dynamicHeader.style.display = 'none';
                        if (dynamicList) dynamicList.style.display = 'none';
                    }


                    // Sidebar Toggle
                    const sidebarToggle = document.getElementById('sidebar-toggle');
                    const container = document.querySelector('.container');
                    if (sidebarToggle) {
                        sidebarToggle.addEventListener('click', () => {
                            container.classList.toggle('collapsed');
                        });
                    }

                    // --- Tab Logic ---
                    function setupTabs(pageElement) {
                        const tabs = pageElement.querySelectorAll('.tab');
                        const panes = pageElement.querySelectorAll('.tab-pane');

                        tabs.forEach(tab => {
                            tab.addEventListener('click', () => {
                                const targetId = tab.getAttribute('data-target');
                                if (!targetId) return;
                                tabs.forEach(t => t.classList.remove('active'));
                                panes.forEach(p => p.classList.remove('active'));
                                tab.classList.add('active');
                                const targetPane = document.getElementById(targetId);
                                if (targetPane) targetPane.classList.add('active');
                            });
                        });
                    }
                    document.querySelectorAll('.page').forEach(page => setupTabs(page));

                    // --- Navigation Logic ---
                    const navItems = document.querySelectorAll('.nav-item');
                    const pages = document.querySelectorAll('.page');
                    navItems.forEach(item => {
                        item.addEventListener('click', () => {
                            navItems.forEach(n => n.classList.remove('active'));
                            pages.forEach(p => p.classList.remove('active'));
                            item.classList.add('active');
                            const targetId = item.getAttribute('data-target');
                            const targetPage = document.getElementById(targetId);
                            if (targetPage) targetPage.classList.add('active');
                        });
                    });

                    // --- Global Close Helper ---
                    function closePanel(action = 'close', data = null) {
                        vscode.postMessage({ type: action, data: data });
                    }
                    window.closePanel = () => vscode.postMessage({ type: 'close' });

                    // ARCH-1 (option B): wire the "Other Pages" footer buttons (manning/
                    // runoff-map/boundaries/observation) via addEventListener inside this
                    // nonce-gated script. They previously used inline onclick="closePanel()",
                    // which the page CSP (script-src 'nonce-…', no 'unsafe-inline') blocked,
                    // making them dead no-ops. (Full inline-JS extraction is deferred debt.)
                    document.querySelectorAll('.other-page-close').forEach(b => b.addEventListener('click', () => closePanel()));

                    // --- Data Population (from initialData) ---
                    if (initialData.demPath) {
                        document.getElementById('demFilePath').value = initialData.demPath;
                    }
                    if (initialData.initialInputPath) {
                        document.getElementById('ii_filePath').value = initialData.initialInputPath;
                    }
                    if (initialData.qxInitialInputPath || initialData.qyInitialInputPath) {
                        const qx = initialData.qxInitialInputPath ? initialData.qxInitialInputPath.split(/[\\/]/).pop() : '';
                        const qy = initialData.qyInitialInputPath ? initialData.qyInitialInputPath.split(/[\\/]/).pop() : '';
                        // Note: If we have full paths in initialData, we might want to show them fully to match new logic.
                        // But initialData usually comes from Project Config which stores full paths.
                        // The previous logic split them.
                        // To be consistent with "Apply" logic which expects full paths in input, we should show full paths if available?
                        // However, inputGeneratorEditor.ts sends full paths now.
                        // Let's fallback to showing full paths if available, or just join them.
                        // The original code split them. If I change it to full path, it's safer for "Apply".
                        const qxFull = initialData.qxInitialInputPath || '';
                        const qyFull = initialData.qyInitialInputPath || '';
                        // If both exist
                        if (qxFull && qyFull) {
                             document.getElementById('qx_filePath').value = qxFull + ', ' + qyFull;
                        } else if (qxFull || qyFull) {
                             document.getElementById('qx_filePath').value = qxFull + qyFull;
                        }
                    } else {
                         // Fallback to split usage if needed? No, let's stick to full paths as per Refactor.
                    }

                    // Streamflow Population
                    if (initialData.num_sources) {
                        document.getElementById('streamflowNumSources').value = initialData.num_sources;
                    }
                    if (initialData.src_loc_file) {
                        document.getElementById('streamflowLocPath').value = initialData.src_loc_file;
                    }
                    if (initialData.hydrograph_filename) {
                        document.getElementById('streamflowDynPath').value = initialData.hydrograph_filename;
                    }

                     // Respond to messages
                    window.addEventListener('message', event => {
                         const message = event.data;
                         switch(message.type) {
                             case 'updateDemPath':
                                 document.getElementById('demFilePath').value = message.path;
                                 break;
                             case 'updateInitialInputPath':
                                 document.getElementById('ii_filePath').value = message.path;
                                 break;
                             case 'updateQxQyInputPaths':
                                 const paths = message.paths || [];
                                 // Display full paths so we can retrieve them for Apply
                                 document.getElementById('qx_filePath').value = paths.join(', ');
                                 break;
                             case 'updateStreamflowLocPath':
                                 document.getElementById('streamflowLocPath').value = message.path;
                                 break;
                             case 'updateStreamflowDynPath':
                                 document.getElementById('streamflowDynPath').value = message.path;
                                 break;
                             case 'updateSimulationParams':
                                 if (message.data) {
                                     simStart = message.data.sim_start_time ?? simStart;
                                     simDuration = message.data.sim_duration ?? simDuration;
                                     printInterval = message.data.print_interval ?? printInterval;
                                     numSteps = Math.ceil(simDuration / printInterval) + 1;
                                     
                                     // If we need to resize current data, do it here?
                                     // Ideally we re-generate or pad.
                                     // For now, let's just re-render graph if active.
                                     if (selectedMarkerIndex !== -1 && currentHydrographs[selectedMarkerIndex]) {
                                         // Pad or truncate graphData to match numSteps
                                         const oldData = currentHydrographs[selectedMarkerIndex];
                                         const newData = [];
                                         for(let i=0; i<numSteps; i++) {
                                             newData.push(oldData[i] !== undefined ? oldData[i] : 0);
                                         }
                                         currentHydrographs[selectedMarkerIndex] = newData;
                                         graphData = [...newData];
                                         renderGraph();
                                     } else {
                                         // Just preview
                                         // graphData = getGeneratedGraphData(); // resets to random/constant
                                          // Or just pad current preview
                                         const newData = [];
                                         for(let i=0; i<numSteps; i++) {
                                             newData.push(graphData[i] !== undefined ? graphData[i] : 0);
                                         }
                                         graphData = newData;
                                         renderGraph();
                                     }
                                 }
                                 break;
                         }
                    });

                    // --- Event Listeners ---

                    // DEM
                    const btnSelectDemFile = document.getElementById('btnSelectDemFile');
                    if (btnSelectDemFile) {
                        btnSelectDemFile.addEventListener('click', () => {
                            vscode.postMessage({ type: 'browseDemFile' });
                        });
                    }

                    document.getElementById('btnOkDemFooter')?.addEventListener('click', () => {
                         const fileTab = document.getElementById('dem-tab-file');
                         const onlineTab = document.getElementById('dem-tab-online');

                         console.log('Ok clicked. File Active:', fileTab?.classList.contains('active'), 'Online Active:', onlineTab?.classList.contains('active'));

                         if (fileTab && fileTab.classList.contains('active')) {
                             const path = document.getElementById('demFilePath').value;
                             if(path && path.trim() !== "") {
                                vscode.postMessage({ type: 'applyDemFile', path: path.trim() });
                             } else {
                                 vscode.postMessage({ type: 'alert', text: 'Please select a Elevation file first.' });
                             }
                         } else if (onlineTab && onlineTab.classList.contains('active')) {
                             const source = document.getElementById('demSource').value;
                             const apiKey = document.getElementById('otApiKey').value;
                             const saveKey = document.getElementById('saveApiKey').checked;
                             
                             console.log('Online OK. Source:', source, 'HasKey:', !!apiKey);

                             if (!source) {
                                 vscode.postMessage({ type: 'alert', text: 'Please select a source.' });
                                 return;
                             }
                             if (source === 'OpenTopography' && !apiKey) {
                                 vscode.postMessage({ type: 'alert', text: 'OpenTopography requires an API Key.' });
                                 return;
                             }
 
                             vscode.postMessage({ 
                                 type: 'getDemOnline', 
                                 source: source,
                                 apiKey: apiKey,
                                 saveKey: saveKey,
                                 header: initialData.header,
                                 utmZone: initialData.utmZone,
                                 datum: initialData.datum
                             });
                         } else {
                             console.log('Closing panel');
                             closePanel('close');
                         }
                    });
                    document.getElementById('btnCancelDemFooter')?.addEventListener('click', () => closePanel('close'));

                    // DEM Source Toggle
                    const demSource = document.getElementById('demSource');
                    if (demSource) {
                        demSource.addEventListener('change', (e) => {
                            const val = e.target.value;
                            const otConfig = document.getElementById('opentopography-config');
                            if (otConfig) {
                                if (val === 'OpenTopography') {
                                    otConfig.classList.remove('hidden');
                                } else {
                                    otConfig.classList.add('hidden');
                                }
                            }
                        });
                    }


                    // H Initial (Water Depth)
                    const iiBtnSelectFile = document.getElementById('ii_btnSelectFile');
                    if (iiBtnSelectFile) {
                        iiBtnSelectFile.addEventListener('click', () => {
                            vscode.postMessage({ type: 'browseInitialInputFile' });
                        });
                    }
                    document.getElementById('btnOkHFooter')?.addEventListener('click', () => {
                         const fileTab = document.getElementById('ii-tab-file');

                         if (fileTab && fileTab.classList.contains('active')) {
                             const path = document.getElementById('ii_filePath').value;
                             if(path && path.trim() !== "") {
                                vscode.postMessage({ type: 'applyInitialInputFile', path: path.trim() });
                             } else {
                                 vscode.postMessage({ type: 'alert', text: 'Please select a Water Depth file.' });
                             }
                        } else {
                            closePanel('close');
                        }
                    });
                    document.getElementById('btnCancelHFooter')?.addEventListener('click', () => closePanel('close'));


                    // QX QY (Water Discharge)
                    const btnSelectQxFile = document.getElementById('btnSelectQxFile');
                    if (btnSelectQxFile) {
                        btnSelectQxFile.addEventListener('click', () => {
                            vscode.postMessage({ type: 'browseQxInputFile' });
                        });
                    }
                    document.getElementById('btnOkQxQyFooter')?.addEventListener('click', () => {
                         const fileTab = document.getElementById('qxqy-tab-file');
                         if (fileTab && fileTab.classList.contains('active')) {
                             const val = document.getElementById('qx_filePath').value;
                             if (val) {
                                 // Split by comma and trim
                                 const paths = val.split(',').map(p => p.trim()).filter(p => p !== "");
                                 if (paths.length === 2) {
                                      vscode.postMessage({ type: 'applyQxInputFile', paths: paths });
                                 } else {
                                      vscode.postMessage({ type: 'alert', text: 'Please select exactly two files for Water Discharge (QX & QY).' });
                                 }
                             } else {
                                vscode.postMessage({ type: 'alert', text: 'Please select Water Discharge files.' });
                             }
                        } else {
                            closePanel('close');
                        }
                    });
                    document.getElementById('btnCancelQxQyFooter')?.addEventListener('click', () => closePanel('close'));

                    // Streamflow
                    const btnSelectStreamflowLoc = document.getElementById('btnSelectStreamflowLoc');
                    if (btnSelectStreamflowLoc) {
                        btnSelectStreamflowLoc.addEventListener('click', () => {
                            vscode.postMessage({ type: 'browseStreamflowLocFile' });
                        });
                    }
                    const btnSelectStreamflowDyn = document.getElementById('btnSelectStreamflowDyn');
                    if (btnSelectStreamflowDyn) {
                        btnSelectStreamflowDyn.addEventListener('click', () => {
                            vscode.postMessage({ type: 'browseStreamflowDynFile' });
                        });
                    }

                    // State State
                    let currentLocations = initialData.streamflowLocations || [];
                    // Ensure currentHydrographs matches locations length
                    let currentHydrographs = initialData.hydrographData || [];
                    
                    // If mismatch (e.g. locations > hydrographs), fill with defaults?
                    // For now assume sync or handled gracefully by checks.

                    let selectedMarkerIndex = -1;

                    document.getElementById('btnOkStreamflow')?.addEventListener('click', () => {
                        // Gather Data
                        // We use the in-memory state: currentLocations, currentHydrographs
                        
                        // Validation
                        if (currentLocations.length === 0) {
                            vscode.postMessage({ type: 'alert', text: 'No streamflow sources defined.' });
                            return;
                        }

                        vscode.postMessage({ 
                            type: 'saveStreamflowData', 
                            locations: currentLocations,
                            hydrographs: currentHydrographs
                        });
                        
                        // Close after save? Or wait for confirmation?
                        // User said "generate file when clicked Ok". Usually OK implies close.
                        // But saving might take a moment.
                        // Let's assume it closes or we receive a message back.
                        // For now, let's close panel after sending.
                        closePanel('close');
                    });
                    document.getElementById('btnCancelStreamflow')?.addEventListener('click', () => closePanel('close'));

                    // Streamflow Configuration Logic
                    const sfDistType = document.getElementById('streamflow-dist-type');
                    const configConstant = document.getElementById('config-constant');
                    const configRandom = document.getElementById('config-random');

                    const sfValConstant = document.getElementById('sf-val-constant');
                    const sfValMin = document.getElementById('sf-val-min');
                    const sfValMax = document.getElementById('sf-val-max');

                    // Graph Variables
                    const graphContainer = document.getElementById('sf-graph-container');
                    const svg = document.getElementById('sf-graph-svg');
                    let graphData = [];
                    let dragIndex = -1;
                    
                    // Simulation Params - mutable
                    let simStart = initialData.sim_start_time || 0;
                    let simDuration = initialData.sim_duration || 86400;
                    let printInterval = initialData.print_interval || 900;
                    let numSteps = Math.ceil(simDuration / printInterval) + 1;

                    function getGeneratedGraphData() {
                        const data = [];
                        const type = sfDistType.value;
                        
                        if (type === 'constant') {
                            const val = parseFloat(sfValConstant.value) || 0;
                            for(let i=0; i<numSteps; i++) data.push(val);
                        } else {
                            const min = parseFloat(sfValMin.value) || 0;
                            const max = parseFloat(sfValMax.value) || 1;
                            for(let i=0; i<numSteps; i++) {
                                data.push(Math.random() * (max - min) + min);
                            }
                        }
                        return data;
                    }
                    
                    function generateGraphData() {
                        // User clicked "Generate" button (implicit in UI changes)
                        // Only update if we have a selection?
                        // Or does changing UI update the current selection?
                        // Yes, if I change inputs, I expect the graph to update.
                        // And thus existing marker data to update.
                        
                        if (selectedMarkerIndex === -1) {
                            // No marker selected. Maybe just preview?
                            // Or default to first one?
                            // Let's just update graphData global for preview.
                            graphData = getGeneratedGraphData();
                            renderGraph();
                        } else {
                            // Update selected marker
                            const newData = getGeneratedGraphData();
                            currentHydrographs[selectedMarkerIndex] = newData;
                            graphData = newData; // Update view
                            renderGraph();
                        }
                    }

                    function renderGraph() {
                        if (!graphContainer || !svg) return;

                        // Dimensions
                        const margin = { top: 20, right: 20, bottom: 45, left: 45 }; 
                        const minBarWidth = 20;
                        const gap = 2;
                        const totalWidth = Math.max(graphContainer.clientWidth, numSteps * (minBarWidth + gap) + margin.left + margin.right);
                        const height = 250;
                        const width = totalWidth - margin.left - margin.right;
                        const drawHeight = height - margin.top - margin.bottom;

                        svg.setAttribute('width', totalWidth);
                        svg.setAttribute('height', height);
                        svg.innerHTML = ''; // Clear

                        // Scales
                        const dataMax = Math.max(...graphData, 0.1);
                        // Simplified Y-Axis Tick Logic
                        // Round up to nearest 0.5 or 1.0 based on magnitude
                        let maxY;
                        if (dataMax <= 5) {
                            maxY = Math.ceil(dataMax * 2) / 2; // Nearest 0.5
                            if (maxY < dataMax) maxY += 0.5; // Ensure coverage
                        } else {
                            maxY = Math.ceil(dataMax);
                        }
                        if (maxY === 0) maxY = 1;

                        const yScale = (val) => drawHeight - (val / maxY) * drawHeight;

                        // Grid
                        const numTicks = 5;
                        for (let i = 0; i <= numTicks; i++) {
                            const val = (maxY / numTicks) * i;
                            const y = yScale(val);
                            
                            // Line
                            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                            line.setAttribute('x1', margin.left);
                            line.setAttribute('x2', totalWidth - margin.right);
                            line.setAttribute('y1', margin.top + y);
                            line.setAttribute('y2', margin.top + y);
                            line.setAttribute('class', 'grid-line');
                            svg.appendChild(line);

                            // Text
                            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                            text.setAttribute('x', margin.left - 5);
                            text.setAttribute('y', margin.top + y + 3);
                            text.setAttribute('text-anchor', 'end');
                            text.setAttribute('class', 'axis-text');
                            // Simplified format: Remove decimals if int, else 1 decimal place generally enough for 0.5 steps
                            text.textContent = Number.isInteger(val) ? val.toString() : val.toFixed(1);
                            svg.appendChild(text);
                        }

                        // Tooltip Text Element (Center Overlay)
                        const tooltipText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                        tooltipText.setAttribute('x', totalWidth / 2); // default, will update
                        tooltipText.setAttribute('y', height / 2);
                        tooltipText.setAttribute('text-anchor', 'middle');
                        tooltipText.setAttribute('class', 'axis-text');
                        tooltipText.style.fontSize = '14px';
                        tooltipText.style.fontWeight = 'bold';
                        tooltipText.style.fontWeight = 'bold';
                        tooltipText.style.fill = '#000'; // Dark text for white background
                        tooltipText.style.pointerEvents = 'none'; // click through
                        tooltipText.style.opacity = '0'; // Hidden by default
                        tooltipText.textContent = '';
                        // Append later to be on top

                        // Helper to format seconds to HH:MM
                        const formatTime = (seconds) => {
                            const h = Math.floor(seconds / 3600);
                            const m = Math.floor((seconds % 3600) / 60);
                            return h.toString().padStart(2, '0') + ':' + m.toString().padStart(2, '0');
                        };

                        // Bars
                        graphData.forEach((val, i) => {
                            const x = margin.left + i * (minBarWidth + gap);
                            const barHeight = drawHeight - yScale(val);
                            
                            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                            rect.setAttribute('x', x);
                            rect.setAttribute('y', margin.top + yScale(val));
                            rect.setAttribute('width', minBarWidth);
                            rect.setAttribute('height', barHeight);
                            rect.setAttribute('class', 'bar-rect');
                            rect.dataset.index = i;
                            rect.dataset.value = val;
                            rect.dataset.time = ((i * printInterval) + simStart);
                            
                            // Hover Events for Tooltip
                            rect.addEventListener('mouseenter', () => {
                                const timeVal = parseInt(rect.dataset.time);
                                const dataVal = parseFloat(rect.dataset.value);
                                tooltipText.textContent = dataVal.toFixed(2) + ' @ ' + formatTime(timeVal); // <Y> @ <X>
                                tooltipText.setAttribute('x', x + minBarWidth / 2); // Center on bar
                                tooltipText.setAttribute('y', margin.top + yScale(dataVal) - 10); // Above bar
                                // If bar is too high, put it inside/below? sticking to fixed position might be better or dynamic.
                                // User asked: "center of the bar"
                                // Center Y: margin.top + yScale(dataVal) + barHeight / 2
                                tooltipText.setAttribute('y', margin.top + yScale(dataVal) + barHeight / 2 + 5); 
                                tooltipText.style.opacity = '1';
                            });
                            rect.addEventListener('mouseleave', () => {
                                if (dragIndex === -1) tooltipText.style.opacity = '0';
                            });

                            svg.appendChild(rect);

                            // X Axis Label (Interval)
                            if (i % 5 === 0) { 
                                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                                text.setAttribute('x', x + minBarWidth / 2);
                                text.setAttribute('y', height - margin.bottom + 15);
                                text.setAttribute('text-anchor', 'middle');
                                text.setAttribute('class', 'axis-text');
                                text.textContent = formatTime((i * printInterval) + simStart);
                                svg.appendChild(text);
                            }
                        });


                        // Axis Lines
                        const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                        yAxis.setAttribute('x1', margin.left);
                        yAxis.setAttribute('x2', margin.left);
                        yAxis.setAttribute('y1', margin.top);
                        yAxis.setAttribute('y2', height - margin.bottom);
                        yAxis.setAttribute('class', 'axis-line');
                        svg.appendChild(yAxis);

                        const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                        xAxis.setAttribute('x1', margin.left);
                        xAxis.setAttribute('x2', totalWidth - margin.right);
                        xAxis.setAttribute('y1', height - margin.bottom);
                        xAxis.setAttribute('y2', height - margin.bottom);
                        xAxis.setAttribute('class', 'axis-line');
                        svg.appendChild(xAxis);
                        
                        // Append Tooltip last so it's on top
                        svg.appendChild(tooltipText);
                    }

                    // Events
                    if (sfDistType) {
                        sfDistType.addEventListener('change', (e) => {
                            const val = e.target.value;
                            if (val === 'random') {
                                configConstant?.classList.add('sf-hidden');
                                configRandom?.classList.remove('sf-hidden');
                            } else {
                                configConstant?.classList.remove('sf-hidden');
                                configRandom?.classList.add('sf-hidden');
                            }
                            generateGraphData();
                        });
                    }

                    [sfValConstant, sfValMin, sfValMax].forEach(el => {
                       el?.addEventListener('change', generateGraphData); 
                    });

                    // Initial Generation
                    if (graphContainer) {
                        generateGraphData();
                        
                        // Interaction
                        svg.addEventListener('mousedown', (e) => {
                            if (selectedMarkerIndex === -1) return; // Read-only if no marker? Or allow editing "preview"?
                            // Let's allow editing, but if no marker, it's just ephemeral.
                            if (e.target.classList.contains('bar-rect')) {
                                dragIndex = parseInt(e.target.dataset.index);
                            }
                        });

                        svg.addEventListener('mousemove', (e) => {
                            if (dragIndex >= 0) {
                                const rect = svg.getBoundingClientRect();
                                const margin = { top: 20, bottom: 30 };
                                const drawHeight = 250 - margin.top - margin.bottom;
                                const relY = e.clientY - rect.top - margin.top;
                                
                                // Calculate Value from Y
                                let maxY = Math.max(...graphData, 0.1) * 1.2;
                                let newVal = maxY * (1 - (relY / drawHeight));
                                if (newVal < 0) newVal = 0;
                                
                                // Update Data
                                graphData[dragIndex] = newVal;
                                
                                // Update State if selected
                                if (selectedMarkerIndex !== -1) {
                                    currentHydrographs[selectedMarkerIndex][dragIndex] = newVal;
                                }

                                // Check Auto Scale
                                if (newVal > maxY * 0.95) { // Near top, scale up
                                    renderGraph();
                                } else {
                                    renderGraph(); // Re-render to update bar
                                }
                            }
                        });

                        svg.addEventListener('mouseup', () => dragIndex = -1);
                        svg.addEventListener('mouseleave', () => dragIndex = -1);
                    }

                    // Runoff
                    document.getElementById('btnOkRunoff')?.addEventListener('click', () => closePanel('close'));
                    document.getElementById('btnCancelRunoff')?.addEventListener('click', () => closePanel('close'));

                    // --- Global Close Helper ---
                    function closePanel(action = 'close', data = null) {
                        vscode.postMessage({ type: action, data: data });
                    }
                    window.closePanel = () => vscode.postMessage({ type: 'close' });

                    // --- Leaflet Map Logic ---
                    let map = null;
                    let mapInitialized = false;
                    let markerLayerGroup = null;

                    function initStreamflowMap() {
                        if (mapInitialized) return;

                    function updateMapMarkers() {
                        if (!map || !markerLayerGroup) return;
                        markerLayerGroup.clearLayers();

                        currentLocations.forEach((loc, index) => {
                            // Determine Icon color/style based on selection
                            const isSelected = (index === selectedMarkerIndex);
                            const color = isSelected ? '#ff3300' : '#3388ff'; // Orange for selected, Blue default

                            // Custom HTML Icon for simple coloring
                            const iconHtml = '<div style="background-color: ' + color + '; width: 12px; height: 12px; border-radius: 50%; border: 1px solid #fff; box-shadow: 0 0 3px rgba(0,0,0,0.5);"></div>';
                            const icon = L.divIcon({
                                className: 'streamflow-marker-icon-custom', // Avoid conflict
                                html: iconHtml,
                                iconSize: [12, 12],
                                iconAnchor: [6, 6],
                                popupAnchor: [0, -6]
                            });

                            const marker = L.marker([loc.lat, loc.lng], {
                                icon: icon,
                                draggable: true
                            });

                            marker.bindPopup('<b>' + (loc.id || 'Source ' + (index + 1)) + '</b>');

                            // Marker Context Menu
                            marker.on('contextmenu', (e) => {
                                L.DomEvent.stopPropagation(e);
                                e.originalEvent.preventDefault();
                                
                                markerToRemoveIndex = index;
                                
                                if (markerContextMenu) {
                                    markerContextMenu.style.display = 'block';
                                    markerContextMenu.style.left = e.containerPoint.x + 'px';
                                    markerContextMenu.style.top = e.containerPoint.y + 'px';
                                }
                                if (contextMenu) contextMenu.style.display = 'none';
                            });

    // Click to Select
    marker.on('click', () => {
        selectedMarkerIndex = index;
        // Update Graph
        if (currentHydrographs[index]) {
            graphData = [...currentHydrographs[index]]; // Copy to view
            renderGraph();
        }
        // Update Map (Highlight selection)
        updateMapMarkers();
        marker.openPopup();
    });

    // Drag to Update Location
    marker.on('dragend', function (e) {
        const newPos = marker.getLatLng();
        currentLocations[index].lat = newPos.lat;
        currentLocations[index].lng = newPos.lng;
    });

    markerLayerGroup.addLayer(marker);

    // Open popup if selected
    if (isSelected) {
        setTimeout(() => marker.openPopup(), 100);
    }
});
                    }


if (mapInitialized) return;
if (!document.getElementById('streamflow-map')) return;

if (typeof L === 'undefined') {
    console.error('Leaflet not loaded');
    return;
}

map = L.map('streamflow-map').setView([0, 0], 2);
map.doubleClickZoom.disable(); // We use dblclick for adding markers

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// Layers
markerLayerGroup = L.layerGroup().addTo(map);

// Draw Project Boundary
if (initialData.projectBoundary && initialData.projectBoundary.length === 4) {
    const bounds = initialData.projectBoundary;
    const latLngs = bounds.map(b => [b.lat, b.lng]);

    const polygon = L.polygon(latLngs, {
        color: '#ff7800',
        weight: 2,
        fill: true,
        fillOpacity: 0.0,
        dashArray: '5, 5',
        className: 'dem-area-cursor'
    }).addTo(map);

    // Context Menu Logic
    let editMode = true;
    const contextMenu = document.getElementById('map-context-menu');
    const contextMenuItem = document.getElementById('map-context-menu-item');
    const updateEditMode = () => {
        if (editMode) {
             map.dragging.disable();
             polygon.getElement()?.classList.add('dem-area-cursor'); // Use CSS class for pointer
             if(contextMenuItem) contextMenuItem.innerText = "Move Map";
        } else {
             map.dragging.enable();
             polygon.getElement()?.classList.remove('dem-area-cursor');
             if(contextMenuItem) contextMenuItem.innerText = "Edit Mode";
        }
    };
    
    // Initial State
    updateEditMode();

    if (contextMenuItem) {
        contextMenuItem.addEventListener('click', () => {
            editMode = !editMode;
            updateEditMode();
            contextMenu.style.display = 'none';
        });
    }

    // Marker Context Menu Logic
    const markerContextMenu = document.getElementById('marker-context-menu');
    const btnRemoveMarker = document.getElementById('marker-context-menu-remove');
    let markerToRemoveIndex = -1;

    if (btnRemoveMarker) {
        btnRemoveMarker.addEventListener('click', () => {
             if (markerToRemoveIndex !== -1) {
                 // Remove
                 currentLocations.splice(markerToRemoveIndex, 1);
                 currentHydrographs.splice(markerToRemoveIndex, 1);
                 
                 // Fix Selection
                 if (selectedMarkerIndex === markerToRemoveIndex) {
                     selectedMarkerIndex = -1;
                     graphData = []; // Clear view
                 } else if (selectedMarkerIndex > markerToRemoveIndex) {
                     selectedMarkerIndex--;
                 }
                 
                 markerToRemoveIndex = -1;
                 if(markerContextMenu) markerContextMenu.style.display = 'none';
                 
                 updateMapMarkers();
                 renderGraph();
             }
        });
    }

    // Polygon Events
    polygon.on('contextmenu', (e) => {
        L.DomEvent.stopPropagation(e);
        e.originalEvent.preventDefault();
        
        if (contextMenu) {
            contextMenu.style.display = 'block';
            contextMenu.style.left = e.containerPoint.x + 'px';
            contextMenu.style.top = e.containerPoint.y + 'px';
        }
        if (markerContextMenu) markerContextMenu.style.display = 'none';
    });

    polygon.on('mouseover', () => {
        if (editMode) map.dragging.disable();
    });
    polygon.on('mouseout', () => {
        map.dragging.enable();
    });

    // Hide context menu on map click
    map.on('click', () => {
        if(contextMenu) contextMenu.style.display = 'none';
        if(markerContextMenu) markerContextMenu.style.display = 'none';
    });

    // Fit bounds
    const lBounds = L.latLngBounds(latLngs);
    map.fitBounds(lBounds);
} else {
    map.setView([0, 0], 2);
}

// Map Double Click -> Add Marker
map.on('dblclick', (e) => {
    // Check if inside boundary
    let inside = false;
    if (initialData.projectBoundary && initialData.projectBoundary.length === 4) {
        const bounds = initialData.projectBoundary;
        const latLngs = bounds.map(b => [b.lat, b.lng]);
        const lBounds = L.latLngBounds(latLngs);
        if (lBounds.contains(e.latlng)) {
            inside = true;
        }
    } else {
        // If no bounds defined, allow anywhere? Or maybe nowhere.
        // Assuming bounds is required for this to make sense.
        inside = true; 
    }

    if (!inside) {
        vscode.postMessage({ type: 'alert', text: 'Please double-click inside the Project Boundary.' });
        return;
    }

    const lat = e.latlng.lat;
    const lng = e.latlng.lng;

    // Add Location
    const newIndex = currentLocations.length;
    currentLocations.push({
        lat: lat,
        lng: lng,
        id: 'Source ' + (newIndex + 1),
        index: newIndex // Keep legacy index if needed
    });

    // Generate Data
    const newData = getGeneratedGraphData(); // Uses current UI settings (Constant/Random)
    currentHydrographs.push(newData);

    // Select New Marker
    selectedMarkerIndex = newIndex;
    graphData = [...newData]; // Update view
    renderGraph();

    // Update Map
    updateMapMarkers();
});

// Initial Render of Markers
updateMapMarkers();

// Select first marker if exists?
    // Auto-select first marker if exists
    if (currentLocations.length > 0 && selectedMarkerIndex === -1) {
        selectedMarkerIndex = 0;
        if (currentHydrographs[0]) {
            graphData = [...currentHydrographs[0]];
            renderGraph();
        }
        updateMapMarkers();
    }

mapInitialized = true;
}

// Observe tab changes
const flowCreateTab = document.querySelector('.tab[data-target="flow-tab-create"]');
if (flowCreateTab) {
    flowCreateTab.addEventListener('click', () => {
        setTimeout(() => {
            if (!mapInitialized) {
                initStreamflowMap();
            }
            if (map) {
                map.invalidateSize();
            }
        }, 100);
    });
}
</script>
    <!-- Leaflet JS (local, nonce-gated) -->
    <script nonce="${nonce}" src="${leafletJsUri}"></script>
</body>
</html>`;
}

