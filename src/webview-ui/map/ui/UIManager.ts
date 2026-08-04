
import { LegendRenderer } from './LegendRenderer';
import { MapController } from '../MapController';

export class UIManager {
    private controller: MapController;

    constructor(controller: MapController) {
        this.controller = controller;
        this.setupEventListeners();
    }

    private setupEventListeners() {
        // Transparency Slider
        const slider = document.getElementById('transparency-slider');
        if (slider) {
            slider.addEventListener('input', (e: any) => {
                this.controller.demLayer.setOpacity(parseFloat(e.target.value) / 100);
            });
        }

        // DEM Checkbox
        const demCheckbox = document.getElementById('dem-checkbox');
        if (demCheckbox) {
            demCheckbox.addEventListener('change', (e: any) => {
                const checked = e.target.checked;
                this.controller.demLayer.toggle(checked);
                this.controller.postMessage({ command: 'toggleDem', data: { visible: checked } });
            });
        }

        // Streamflow Checkbox
        const streamflowCheckbox = document.getElementById('streamflow-checkbox');
        if (streamflowCheckbox) {
            streamflowCheckbox.addEventListener('change', (e: any) => {
                const checked = e.target.checked;
                this.controller.streamflowLayer.toggle(checked);
                this.controller.postMessage({ command: 'toggleStreamflow', data: { visible: checked } });
            });
        }

        // Min/Max Inputs
        this.setupMinMaxListeners('dem-min-input', 'dem-max-input', (min, max) => {
            if (min !== null) this.controller.demMin = min;
            if (max !== null) this.controller.demMax = max;
            this.controller.updateDemRender();
        });

        this.setupMinMaxListeners('anim-min-input', 'anim-max-input', (min, max) => {
            if (min !== null) this.controller.animMin = min;
            if (max !== null) this.controller.animMax = max;
            this.controller.renderAnimationFrame();
        });

        // Animation Control
        const animPlayBtn = document.getElementById('animation-play-btn');
        if (animPlayBtn) {
            animPlayBtn.addEventListener('click', () => this.controller.togglePlay());
        }

        const animSlider = document.getElementById('animation-slider');
        if (animSlider) {
            animSlider.addEventListener('input', (e: any) => {
                this.controller.currentFrameIndex = parseInt(e.target.value);
                this.controller.renderAnimationFrame();
            });
        }

        // Hillshade
        const hillshadeCheckbox = document.getElementById('hillshade-checkbox');
        if (hillshadeCheckbox) {
            hillshadeCheckbox.addEventListener('change', (e: any) => {
                this.controller.demLayer.setOptions({ hillshade: e.target.checked });
            });
        }

        // Colormap Select (DEM)
        const colorMapSelect = document.getElementById('color-map-select');
        if (colorMapSelect) {
            colorMapSelect.addEventListener('change', (e: any) => {
                const mapType = e.target.value;
                this.controller.demLayer.setOptions({ mapType: mapType });
                LegendRenderer.draw('dem-legend-canvas', mapType);
            });
            // Initial Draw
            LegendRenderer.draw('dem-legend-canvas', 'Terrain');
        }

        // Colormap Select (Animation)
        const animColorMapSelect = document.getElementById('anim-colormap-select');
        if (animColorMapSelect) {
            animColorMapSelect.addEventListener('change', (e: any) => {
                const mapType = e.target.value;
                this.controller.animLayer.setOptions({ mapType });
                LegendRenderer.draw('anim-legend-canvas', mapType);
                this.controller.renderAnimationFrame();
            });
            // Initial Draw
            LegendRenderer.draw('anim-legend-canvas', 'Rainbow');
        }

        // Animation Transparency
        const animTransparencySlider = document.getElementById('animation-transparency-slider');
        if (animTransparencySlider) {
            animTransparencySlider.addEventListener('input', (e: any) => {
                this.controller.animLayer.setOpacity(parseFloat(e.target.value) / 100);
            });
        }

        // DEM Reset
        const demReset = document.getElementById('dem-reset-btn');
        if (demReset) {
            demReset.addEventListener('click', () => {
                this.controller.demMin = 'Auto';
                this.controller.demMax = 'Auto';

                const minIn = document.getElementById('dem-min-input') as HTMLInputElement;
                const maxIn = document.getElementById('dem-max-input') as HTMLInputElement;
                if (minIn) minIn.value = 'Auto';
                if (maxIn) maxIn.value = 'Auto';

                this.controller.updateDemRender();
            });
        }

        // Animation Checkbox
        const animCheckbox = document.getElementById('animation-checkbox');
        if (animCheckbox) {
            animCheckbox.addEventListener('change', (e: any) => {
                const checked = e.target.checked;
                this.controller.animLayer.toggle(checked);
            });
        }

        // Init Checkbox
        const initCheckbox = document.getElementById('init-checkbox');
        if (initCheckbox) {
            initCheckbox.addEventListener('change', (e: any) => {
                const checked = e.target.checked;
                this.controller.initLayer.toggle(checked);
            });
        }

        // Init Transparency
        const initTransparencySlider = document.getElementById('init-transparency-slider');
        if (initTransparencySlider) {
            initTransparencySlider.addEventListener('input', (e: any) => {
                this.controller.initLayer.setOpacity(parseFloat(e.target.value) / 100);
            });
        }

        // Init Colormap Select
        const initColorMapSelect = document.getElementById('init-color-map-select');
        if (initColorMapSelect) {
            initColorMapSelect.addEventListener('change', (e: any) => {
                const mapType = e.target.value;
                this.controller.initLayer.setOptions({ mapType: mapType });
                LegendRenderer.draw('init-legend-canvas', mapType);
            });
            // Initial Draw
            LegendRenderer.draw('init-legend-canvas', 'Blues');
        }

        // Init Min/Max
        this.setupMinMaxListeners('init-min-input', 'init-max-input', (min, max) => {
            if (min !== null) this.controller.initMin = min;
            if (max !== null) this.controller.initMax = max;
            this.controller.updateInitRender();
        });

        // Init Reset
        const initReset = document.getElementById('init-reset-btn');
        if (initReset) {
            initReset.addEventListener('click', () => {
                this.controller.initMin = 'Auto';
                this.controller.initMax = 'Auto';

                const minIn = document.getElementById('init-min-input') as HTMLInputElement;
                const maxIn = document.getElementById('init-max-input') as HTMLInputElement;
                if (minIn) minIn.value = 'Auto';
                if (maxIn) maxIn.value = 'Auto';

                this.controller.updateInitRender();
            });
        }

        // Animation Reset
        const animReset = document.getElementById('anim-reset-btn');
        if (animReset) {
            animReset.addEventListener('click', () => {
                this.controller.animMin = 'Auto';
                this.controller.animMax = 'Auto';

                const minIn = document.getElementById('anim-min-input') as HTMLInputElement;
                const maxIn = document.getElementById('anim-max-input') as HTMLInputElement;
                if (minIn) minIn.value = 'Auto';
                if (maxIn) maxIn.value = 'Auto';

                this.controller.renderAnimationFrame();
            });
        }

        // Animation Load/Save Icons
        const loadAnimBtn = document.getElementById('load-anim');
        if (loadAnimBtn) {
            loadAnimBtn.addEventListener('click', () => {
                this.controller.postMessage({ command: 'triggerLoadAnimation' });
            });
            // Hide initially as pane is folded
            loadAnimBtn.style.display = 'none';
        }

        const saveGifBtn = document.getElementById('save-gif');
        if (saveGifBtn) {
            saveGifBtn.style.display = 'none';
            saveGifBtn.addEventListener('click', () => {
                if (this.controller.animationFrames.length === 0) {
                    return;
                }
                if (this.controller.isPlaying) this.controller.togglePlay(); // Pause
                this.controller.setMapInteraction(false);
                this.controller.cropManager.start();
            });

            // Custom Layer Switcher Logic
            const layerOptions = document.querySelectorAll('.layer-option');
            layerOptions.forEach(opt => {
                opt.addEventListener('click', (e) => {
                    const target = e.currentTarget as HTMLElement;
                    const layerName = target.dataset.layer;
                    if (layerName) {
                        // Update Map
                        this.controller.setBaseLayer(layerName);

                        // Update UI Active State
                        layerOptions.forEach(o => o.classList.remove('active'));
                        target.classList.add('active');
                    }
                });
            });


            this.setupPaneToggle('dem-toggle-icon', 'controls-content');
            this.setupPaneToggle('init-toggle-icon', 'init-controls-content');
            this.setupPaneToggle('animation-toggle-icon', 'animation-controls-content');

            // Initial trigger to replace "Auto" text with numbers if needed
            this.controller.updateDemRender();
            this.controller.renderAnimationFrame();
        }
    }

    private setupMinMaxListeners(minId: string, maxId: string, callback: (min: number | 'Auto' | null, max: number | 'Auto' | null) => void) {
        const minInput = document.getElementById(minId) as HTMLInputElement;
        const maxInput = document.getElementById(maxId) as HTMLInputElement;

        const parseVal = (val: string): number | 'Auto' => {
            if (val.toLowerCase() === 'auto' || val.trim() === '') return 'Auto';
            const n = parseFloat(val);
            return isNaN(n) ? 'Auto' : n;
        };

        if (minInput) {
            minInput.addEventListener('change', () => {
                const val = parseVal(minInput.value);
                if (val === 'Auto') minInput.value = 'Auto';
                callback(val, null);
            });
        }

        if (maxInput) {
            maxInput.addEventListener('change', () => {
                const val = parseVal(maxInput.value);
                if (val === 'Auto') maxInput.value = 'Auto';
                callback(null, val);
            });
        }
    }

    private setupPaneToggle(iconId: string, contentId: string) {
        const icon = document.getElementById(iconId);
        const content = document.getElementById(contentId);
        if (icon && content) {
            icon.addEventListener('click', (e) => {
                e.stopPropagation();
                const currentDisplay = content.style.display;
                const isHidden = currentDisplay === 'none' || currentDisplay === '';

                content.style.display = isHidden ? 'block' : 'none';
                icon.innerHTML = isHidden ? '&#9660;' : '&#9650;';

                // Specific logic for animation pane extra icons
                if (iconId === 'animation-toggle-icon') {
                    const loadBtn = document.getElementById('load-anim');
                    const saveBtn = document.getElementById('save-gif');
                    if (loadBtn) loadBtn.style.display = isHidden ? 'flex' : 'none';
                    if (saveBtn) saveBtn.style.display = isHidden ? 'flex' : 'none';
                }
            });
            icon.style.cursor = 'pointer';
        }
    }
}
