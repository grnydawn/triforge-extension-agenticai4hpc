export function getMapEditorHtml(cspSource: string, scriptUri: string, styleUri: string, nonce: string, leafletJsUri: string, leafletCssUri: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <!-- CSP: SEC-4 — Leaflet is bundled locally under the extension; no third-party CDN. -->
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource} data: https:; connect-src https:;">
    <title>Triforge Map</title>
    <!-- Leaflet CSS (local) -->
    <link rel="stylesheet" href="${leafletCssUri}" />
    <!-- Local CSS -->
    <link href="${styleUri}" rel="stylesheet">
</head>
<body>
    <div id="map"></div>
    
    <!-- Floating Control Panel Container -->
    <div class="controls-container" id="controls-container">
    
        <!-- Maps / DEM Pane -->
        <div class="floating-controls" id="pane-dem" draggable="true" data-layer="dem" style="display: none;">
            <div class="header-row">
                <div class="header-left">
                    <input type="checkbox" id="dem-checkbox" checked>
                    <label for="dem-checkbox">Elevation</label>
                </div>
                <div id="dem-toggle-icon" class="icon-btn" title="Toggle Options">
                    &#9650; <!-- Up Triangle (Expand) -->
                </div>
            </div>
            
            <div id="controls-content" class="controls-content">
                <div class="control-group">
                    <label>Color Map</label>
                    <select id="color-map-select">
                        <option value="Rainbow">Rainbow</option>
                        <option value="Viridis">Viridis</option>
                        <option value="Terrain" selected>Terrain</option>
                        <option value="Grayscale">Grayscale</option>
                    </select>
                </div>

                <!-- DEM Range Controls -->
                <div class="control-group" style="display: flex; gap: 5px; align-items: center; margin-top: 5px;">
                    <!-- Min Input -->
                    <input type="text" id="dem-min-input" style="width: 50px; font-size: 0.8em;" value="Auto" placeholder="Min">
                    <span>m</span>
                    
                    <!-- Color Legend Bar -->
                    <canvas id="dem-legend-canvas" width="150" height="15" style="flex-grow: 1; border: 1px solid #444; border-radius: 2px;"></canvas>
                    
                    <!-- Max Input -->
                    <input type="text" id="dem-max-input" style="width: 50px; font-size: 0.8em;" value="Auto" placeholder="Max">
                    <span>m</span>
                    <div id="dem-reset-btn" class="icon-btn" title="Reset to Auto" style="margin-left: 5px; cursor: pointer; font-size: 1.2em;">&#x21bb;</div>
                </div>
                
                <div class="control-group">
                    <label>Hillshade</label>
                    <input type="checkbox" id="hillshade-checkbox">
                </div>

                <div class="control-group">
                    <label>Transparency</label>
                    <input type="range" id="transparency-slider" min="0" max="100" value="100">
                </div>
                

            </div>
        </div>

        <!-- Initial Input (INIT) Pane -->
        <div class="floating-controls" id="pane-init" draggable="true" data-layer="init" style="display: none;">
            <div class="header-row">
                <div class="header-left">
                    <input type="checkbox" id="init-checkbox" checked>
                    <label for="init-checkbox">Water Depth</label>
                </div>
                <div id="init-toggle-icon" class="icon-btn" title="Toggle Options">
                    &#9650; <!-- Up Triangle (Expand) -->
                </div>
            </div>
            
            <div id="init-controls-content" class="controls-content">
                <div class="control-group">
                    <label>Color Map</label>
                    <select id="init-color-map-select">
                        <option value="Rainbow">Rainbow</option>
                        <option value="Viridis">Viridis</option>
                        <option value="Terrain">Terrain</option>
                        <option value="Grayscale">Grayscale</option>
                        <option value="Blues" selected>Blues</option>
                    </select>
                </div>

                <!-- Init Range Controls -->
                <div class="control-group" style="display: flex; gap: 5px; align-items: center; margin-top: 5px;">
                    <!-- Min Input -->
                    <input type="text" id="init-min-input" style="width: 50px; font-size: 0.8em;" value="Auto" placeholder="Min">
                    <span>m</span>
                    
                    <!-- Color Legend Bar -->
                    <canvas id="init-legend-canvas" width="150" height="15" style="flex-grow: 1; border: 1px solid #444; border-radius: 2px;"></canvas>
                    
                    <!-- Max Input -->
                    <input type="text" id="init-max-input" style="width: 50px; font-size: 0.8em;" value="Auto" placeholder="Max">
                    <span>m</span>
                    <div id="init-reset-btn" class="icon-btn" title="Reset to Auto" style="margin-left: 5px; cursor: pointer; font-size: 1.2em;">&#x21bb;</div>
                </div>
                
                <div class="control-group">
                    <label>Transparency</label>
                    <input type="range" id="init-transparency-slider" min="0" max="100" value="70">
                </div>
            </div>
        </div>

        <!-- QX QY Pane -->
        <div class="floating-controls" id="pane-qxqy" draggable="true" data-layer="qxqy" style="display: none;">
            <div class="header-row">
                <div class="header-left">
                    <input type="checkbox" id="qxqy-checkbox" checked>
                    <label for="qxqy-checkbox">Water Discharge</label>
                </div>
                <div id="qxqy-toggle-icon" class="icon-btn" title="Toggle Options">
                    &#9650; <!-- Up Triangle (Expand) -->
                </div>
            </div>
            
            <div id="qxqy-controls-content" class="controls-content">
                <div class="control-group">
                    <label>Scale</label>
                    <input type="number" id="qxqy-scale-input" value="1.0" step="0.1" style="width: 50px;">
                </div>
                <div class="control-group">
                    <label>Stride (px)</label>
                    <input type="number" id="qxqy-stride-input" value="10" step="1" min="1" style="width: 50px;">
                </div>
                <div class="control-group">
                    <label>Color</label>
                    <input type="color" id="qxqy-color-picker" value="#000000" style="border: none; width: 40px; height: 25px; padding: 0;">
                </div>
            </div>
        </div>

        <!-- Streamflow Pane -->
        <div class="floating-controls" id="pane-streamflow" draggable="true" data-layer="streamflow" style="display: none;">
            <div class="header-row">
                <div class="header-left">
                    <input type="checkbox" id="streamflow-checkbox" checked>
                    <label for="streamflow-checkbox">Streamflow</label>
                </div>
                <!-- Optional toggle icon if we add more controls later -->
            </div>
            
            <div id="streamflow-controls-content" class="controls-content" style="padding: 5px;">
                <div style="font-size: 0.8em; color: #ccc;">
                    Markers indicate source locations.<br>
                    Hover to view hydrograph values.
                </div>
            </div>
        </div>

        <!-- Animation Pane -->
        <div class="floating-controls" id="pane-animation" draggable="true" data-layer="animation">
            <div class="header-row">
                <div class="header-left">
                    <input type="checkbox" id="animation-checkbox">
                    <label for="animation-checkbox">Animation</label>
                </div>
                <!-- Right side controls -->
                <div style="display: flex; align-items: center; gap: 5px;">
                     <div id="animation-play-btn" class="icon-btn" title="Play/Pause">
                        &#9658; 
                    </div>

                     <div id="load-anim" class="icon-btn" title="Load Animation" style="margin-left: 5px; cursor: pointer; display: none; align-items: center;">
                            <!-- Load Icon (Folder) -->
                            <svg id="load-anim-svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            </svg>
                    </div>

                     <div id="save-gif" class="icon-btn" title="Download GIF" style="margin-left: 5px; margin-right: 5px; cursor: pointer; display: none; align-items: center;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                    </div>
                    <div id="animation-toggle-icon" class="icon-btn" title="Toggle Options">
                        &#9650; <!-- Up Triangle (Expand) -->
                    </div>
                </div>
            </div>
            
            <div id="animation-controls-content" class="controls-content">
                <div class="control-group">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <!-- Frame Counter -->
                        <span id="anim-frame-label" style="font-size: 0.9em; font-family: monospace; min-width: 60px; text-align: center;">0 / 0</span>
                        
                        <!-- Date/Time Display -->
                        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 110px;">
                            <span id="anim-date-label" style="font-size: 0.75em; color: #ccc;">-</span>
                            <span id="anim-time-label" style="font-size: 0.8em; font-weight: bold;">-</span>
                        </div>

                        <!-- Slide Control -->
                        <input type="range" id="animation-slider" min="0" max="100" value="0" style="flex-grow: 1;">
                    </div>
                </div>
                
                <!-- Shared Datalist -->
                <datalist id="range-options">
                    <option value="Auto">
                </datalist>

                <!-- Colormap Control -->
                <div class="control-group">
                    <label>Colormap</label>
                    <select id="anim-colormap-select">
                        <option value="Blues">Blues</option>
                        <option value="Teal">Teal</option>
                        <option value="Water">Water</option>
                        <option value="Magma">Magma</option>
                        <option value="Viridis">Viridis</option>
                        <option value="Rainbow" selected>Rainbow</option>
                        <option value="Grayscale">Grayscale</option>
                    </select>
                </div>

                <!-- Range Controls -->
                <!-- Compact Range & Legend Control -->
                <div class="control-group" style="display: flex; gap: 5px; align-items: center; margin-top: 5px;">
                    <!-- Min Input -->
                    <input type="text" id="anim-min-input" style="width: 50px; font-size: 0.8em;" value="Auto" placeholder="Min">
                    <span>m</span>
                    
                    <!-- Color Legend Bar -->
                    <canvas id="anim-legend-canvas" width="150" height="15" style="flex-grow: 1; border: 1px solid #444; border-radius: 2px;"></canvas>
                    
                    <!-- Max Input -->
                    <input type="text" id="anim-max-input" style="width: 50px; font-size: 0.8em;" value="Auto" placeholder="Max">
                    <span>m</span>
                    <div id="anim-reset-btn" class="icon-btn" title="Reset to Auto" style="margin-left: 5px; cursor: pointer; font-size: 1.2em;">&#x21bb;</div>
                </div>

                <div class="control-group">
                    <label>Transparency</label>
                    <input type="range" id="animation-transparency-slider" min="0" max="100" value="80">
                </div>


            </div>
        </div>

    </div>

    <!-- Custom Layer Switcher (Bottom Right) -->
    <div id="layer-switcher" class="layer-switcher">
        <div id="layer-toggle-btn" class="icon-btn" title="Change Base Layer">
            <!-- Layers Icon -->
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                <polyline points="2 17 12 22 22 17"></polyline>
                <polyline points="2 12 12 17 22 12"></polyline>
            </svg>
        </div>
        <div id="layer-menu" class="layer-menu">
            <div class="layer-option active" data-layer="OpenStreetMap">OpenStreetMap</div>
            <div class="layer-option" data-layer="OpenTopoMap">OpenTopoMap</div>
            <div class="layer-option" data-layer="Satellite">Satellite</div>
            <div class="layer-option" data-layer="None">None</div>
        </div>
    </div>

    <!-- Leaflet JS (local, nonce-gated) -->
    <script nonce="${nonce}" src="${leafletJsUri}"></script>

    <!-- Local JS -->
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
