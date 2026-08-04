import { DemLayer } from './layers/DemLayer';
import { AnimationLayer } from './layers/AnimationLayer';
import { InitialInputLayer } from './layers/InitialInputLayer';
import { VectorLayer } from './layers/VectorLayer';
import { StreamflowLayer } from './layers/StreamflowLayer';
import { Tooltip } from './ui/Tooltip';
import { DraggablePanes } from './ui/DraggablePanes';
import { CropManager } from './ui/CropManager';

import { UIManager } from './ui/UIManager';
import { VectorControl } from './ui/VectorControl';
import { GifCapture } from './export/GifCapture';
import { UtmConverter } from './utils/UtmConverter';
import { ToWebviewMessage, FromWebviewMessage } from '../types/WebviewProtocol';

declare const L: any;

export class MapController {
    public map: any;
    public demLayer: DemLayer;
    public initLayer: InitialInputLayer;
    public vectorLayer: VectorLayer;
    public streamflowLayer: StreamflowLayer;
    public animLayer: AnimationLayer;
    private tooltip: Tooltip;
    public cropManager: CropManager;
    private _selectionCellSize: number = 30.0;
    private draggablePanes: DraggablePanes;
    private activeCropRect: { x: number, y: number, w: number, h: number } | null = null;
    public gifCapture: GifCapture = new GifCapture();

    // API
    private vscode: any;

    // State
    private currentDemData: any = null;
    private currentInitData: any = null;
    private currentQxQyData: any = null;
    public animationFrames: number[][] = [];
    public currentFrameIndex: number = 0;
    public isPlaying: boolean = false;
    private animInterval: any = null;
    public isMapVisible: boolean = true;
    public activeBaseLayer: any = null;
    public baseMaps: { [key: string]: any } = {};

    // Min/Max Handling
    public demMin: number | 'Auto' = 'Auto';
    public demMax: number | 'Auto' = 'Auto';
    public initMin: number | 'Auto' = 'Auto';
    public initMax: number | 'Auto' = 'Auto';
    public animMin: number | 'Auto' = 'Auto';
    public animMax: number | 'Auto' = 'Auto';

    // Global stats for animation
    private animGlobalMax: number = -Infinity;
    private animGlobalMin: number = Infinity;

    // Project Config
    private projectUtmZone: string = '';
    private simStartTime: number | null = null;
    private simTimezone: string = 'UTC';
    private printInterval: number = 3600;

    // Mode
    private mode: 'editor' | 'selection' = 'editor';
    private dimOverlay: HTMLElement | null = null;

    constructor(vscodeApi: any) {
        this.vscode = vscodeApi;
        this.initMap();
        this.demLayer = new DemLayer(this.map);
        this.initLayer = new InitialInputLayer(this.map);
        this.vectorLayer = new VectorLayer(this.map);
        this.streamflowLayer = new StreamflowLayer(this.map);
        this.animLayer = new AnimationLayer(this.map);
        this.tooltip = new Tooltip(this.map);

        this.draggablePanes = new DraggablePanes();
        this.cropManager = new CropManager(
            document.getElementById('map')!,
            (rect) => {
                this.setMapInteraction(true);
                this.handleFinishCrop(rect);
            },
            () => {
                this.setMapInteraction(true);
            }
        );
        this.updateLayerOrder();

        new UIManager(this);
        new VectorControl(this);

        this.setupEventListeners();
    }

    public postMessage(message: FromWebviewMessage) {
        this.vscode.postMessage(message);
    }

    public setMapInteraction(enabled: boolean) {
        if (!this.map) return;
        if (enabled) {
            this.map.dragging.enable();
            this.map.touchZoom.enable();
            this.map.doubleClickZoom.enable();
            this.map.scrollWheelZoom.enable();
            this.map.boxZoom.enable();
            this.map.keyboard.enable();
        } else {
            this.map.dragging.disable();
            this.map.touchZoom.disable();
            this.map.doubleClickZoom.disable();
            this.map.scrollWheelZoom.disable();
            this.map.boxZoom.disable();
            this.map.keyboard.disable();
        }
    }

    private getRange(minState: number | 'Auto', maxState: number | 'Auto', dataMax: number, dataMin: number = 0, usePercent: boolean = false): { min: number, max: number } {
        let max = dataMax;
        if (typeof maxState === 'number') {
            max = maxState;
        }

        let min = dataMin;
        if (typeof minState === 'number') {
            min = minState;
        } else if (minState === 'Auto' && usePercent) {
            min = 0.01 * max;
        }

        return { min, max };
    }

    private updateInputIfAuto(state: number | 'Auto', inputId: string, value: number) {
        if (state === 'Auto') {
            const input = document.getElementById(inputId) as HTMLInputElement;
            if (input && (input.value.toLowerCase() === 'auto' || document.activeElement !== input)) {
                input.value = value.toFixed(2);
            }
        }
    }

    public updateDemRender() {
        if (!this.currentDemData) return;
        const dataMin = this.currentDemData.min !== undefined ? this.currentDemData.min : 0;
        const { min, max } = this.getRange(this.demMin, this.demMax, this.currentDemData.max, dataMin);

        this.updateInputIfAuto(this.demMin, 'dem-min-input', min);
        this.updateInputIfAuto(this.demMax, 'dem-max-input', max);

        this.demLayer.setOptions({ min, max });
    }

    public updateInitRender() {
        if (!this.currentInitData) return;
        const dataMin = this.currentInitData.min !== undefined ? this.currentInitData.min : 0;
        const { min, max } = this.getRange(this.initMin, this.initMax, this.currentInitData.max, dataMin);

        this.updateInputIfAuto(this.initMin, 'init-min-input', min);
        this.updateInputIfAuto(this.initMax, 'init-max-input', max);

        this.initLayer.setOptions({ min, max });
    }

    // Project State
    private projectHeader: any = null;
    private projectZone: string = '';
    private projectDatum: string = 'WGS84';

    private handleUpdateDem(data: any) {
        this.currentDemData = data;
        console.log('[MapController] Received DEM:', data.min, data.max, data.bounds);
        this.demLayer.setData(data);
        this.updateDemRender();

        this.handleActivateLayer('dem');

        const cb = document.getElementById('dem-checkbox') as HTMLInputElement;
        if (typeof data.visible !== 'undefined') {
            this.demLayer.toggle(data.visible);
            if (cb) cb.checked = data.visible;
        } else {
            this.demLayer.toggle(true);
        }

        // Hide project boundary when DEM is loaded
        this.removeProjectBoundary();
    }

    private handleUpdateInitialInput(data: any) {
        this.currentInitData = data;
        console.log('[MapController] Received Init Input:', data.min, data.max);
        this.initLayer.setData(data);
        this.updateInitRender();

        this.handleActivateLayer('init');
        const cb = document.getElementById('init-checkbox') as HTMLInputElement;

        if (cb) cb.checked = true;

        if (typeof data.visible !== 'undefined') {
            this.initLayer.toggle(data.visible);
            if (cb) cb.checked = data.visible;
        } else {
            this.initLayer.toggle(true);
        }
    }

    private handleUpdateQxQy(data: any) {
        console.log('[MapController] Received QX QY Data');
        this.currentQxQyData = data;

        // Auto-calc Stride and Scale
        let stride = 10;
        let scale = 1.0;

        if (data && data.qx && data.qx.length > 0) {
            const rows = data.qx.length;
            const cols = data.qx[0].length;
            // Reduce density: formerly cols / 50, now cols / 25 (fewer arrows)
            stride = Math.max(1, Math.floor(cols / 25));

            // Estimate max magnitude to set scale
            // Scan a subset of points for performance
            let maxMag = 0;
            const qx = data.qx;
            const qy = data.qy;
            const noData = data.noData || -9999;
            const step = Math.max(1, Math.floor(cols / 20)); // Only check ~400 points

            for (let r = 0; r < rows; r += step) {
                for (let c = 0; c < cols; c += step) {
                    const valX = qx[r][c];
                    const valY = qy[r][c];
                    if (valX !== noData && valY !== noData) {
                        const mag = Math.sqrt(valX * valX + valY * valY);
                        if (mag > maxMag) maxMag = mag;
                    }
                }
            }

            if (maxMag > 0) {
                // We want the longest arrow to be roughly equal to the stride spacing
                // so they "touch" but don't overlap too much.
                scale = (stride * 0.8) / maxMag;
            }
            console.log(`[MapController] Auto-Scale: MaxMag=${maxMag}, Stride=${stride}, Scale=${scale}`);
        }

        this.vectorLayer.setData(data);
        this.vectorLayer.setOptions({ stride, scale });


        // Update UI Controls
        const strideInput = document.getElementById('qxqy-stride-input') as HTMLInputElement;
        if (strideInput) strideInput.value = stride.toString();

        const scaleInput = document.getElementById('qxqy-scale-input') as HTMLInputElement;
        if (scaleInput) scaleInput.value = scale.toFixed(2);

        this.handleActivateLayer('qxqy');
        this.vectorLayer.toggle(true);
    }

    private handleClearDem() {
        this.currentDemData = null;
        this.demLayer.clear();
        this.demMin = 'Auto';
        this.demMax = 'Auto';
        this.updateInputIfAuto('Auto', 'dem-min-input', 0);
        this.updateInputIfAuto('Auto', 'dem-max-input', 10);

        this.setDemPaneVisibility(false);

        const cb = document.getElementById('dem-checkbox') as HTMLInputElement;
        if (cb) cb.checked = false;

        // Restore project boundary if available
        this.drawProjectBoundary();
    }

    private handleClearInitialInput() {
        this.currentInitData = null;
        this.initLayer.clear();
        this.initMin = 'Auto';
        this.initMax = 'Auto';
        this.updateInputIfAuto('Auto', 'init-min-input', 0);
        this.updateInputIfAuto('Auto', 'init-max-input', 10);

        this.setInitPaneVisibility(false);
        const cb = document.getElementById('init-checkbox') as HTMLInputElement;
        if (cb) cb.checked = false;
    }

    private handleClearQxQy() {
        this.currentQxQyData = null;
        this.vectorLayer.setData({ qx: [], qy: [], noData: -9999, bounds: null }); // Clear data
        this.vectorLayer.toggle(false);

        const pane = document.getElementById('pane-qxqy');
        if (pane) pane.style.display = 'none';

        const cb = document.getElementById('qxqy-checkbox') as HTMLInputElement;
        if (cb) cb.checked = false;
    }



    public setAnimationPaneVisibility(visible: boolean) {
        const pane = document.getElementById('pane-animation');
        if (pane) {
            pane.style.display = visible ? 'block' : 'none';
        }
    }

    private handleStartAnimationLoad() {
        this.animationFrames = [];
        this.currentFrameIndex = 0;
        this.animGlobalMax = -Infinity;
        this.animGlobalMin = Infinity;

        const svg = document.getElementById('load-anim-svg');
        if (svg) svg.setAttribute('fill', 'currentColor');
    }

    private handleAppendAnimationFrame(data: any) {
        let frameData = data.frame;
        if (frameData && typeof frameData === 'object' && !Array.isArray(frameData) && !(frameData instanceof Float32Array)) {
            frameData = Object.values(frameData);
        }

        let frameMax = -Infinity;
        let frameMin = Infinity;
        for (let i = 0; i < frameData.length; i++) {
            const val = frameData[i];
            if (val > frameMax) frameMax = val;
            if (val < frameMin) frameMin = val;
        }

        let statsChanged = false;
        if (frameMax > this.animGlobalMax) {
            this.animGlobalMax = frameMax;
            statsChanged = true;
        }

        if (frameMin < this.animGlobalMin) {
            this.animGlobalMin = frameMin;
            statsChanged = true;
        }

        if (statsChanged) {
            if (this.animMax === 'Auto' || this.animMin === 'Auto') {
                this.renderAnimationFrame();
            }
        }

        this.animationFrames.push(frameData);
        const label = document.getElementById('anim-frame-label');
        if (label) label.innerText = `Loading: ${data.index + 1} / ${data.totalFrames}`;
    }

    public renderAnimationFrame() {
        const currentDataMax = this.animGlobalMax > -Infinity ? this.animGlobalMax : 10;
        const currentDataMin = this.animGlobalMin < Infinity ? this.animGlobalMin : 0;

        const { min, max } = this.getRange(this.animMin, this.animMax, currentDataMax, currentDataMin, true);

        this.updateInputIfAuto(this.animMin, 'anim-min-input', min);
        this.updateInputIfAuto(this.animMax, 'anim-max-input', max);

        if (this.animationFrames.length === 0) return;

        this.animLayer.renderFrame(this.currentFrameIndex, min, max);
        this.updateLabel();
        this.updateDateTimeLabel();
    }

    private initMap() {
        const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors',
            crossOrigin: true
        });

        const OpenTopoMap = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            maxZoom: 17,
            attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)',
            crossOrigin: true
        });

        const Esri_WorldImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri...',
            crossOrigin: true
        });

        this.map = L.map('map', {
            layers: [osm]
        }).setView([0, 0], 2);

        const baseMaps = {
            "OpenStreetMap": osm,
            "OpenTopoMap": OpenTopoMap,
            "Satellite": Esri_WorldImagery
        };
        // Store baseMaps for access by custom switcher
        this.baseMaps = baseMaps;

        this.activeBaseLayer = osm;
        this.map.on('baselayerchange', (e: any) => {
            console.log(`[MapController] Base Layer Changed to: ${e.name}`);
            this.activeBaseLayer = e.layer;
        });

        this.map.on('click', (e: any) => {
            console.log('[MapController] Map Clicked (Leaflet Event)', e.latlng);
            this.vscode.postMessage({
                command: 'updateCoordinates',
                data: { lat: e.latlng.lat, lng: e.latlng.lng, zoom: this.map.getZoom() }
            });
        });

        this.map.on('mousemove', (e: any) => {
            this.tooltip.update(
                e,
                this.currentDemData,
                this.currentInitData,
                this.animationFrames,
                this.currentFrameIndex,
                this.animLayer.getCanvas(),
                this.demLayer.getCanvas(),
                this.initLayer.getCanvas(),
                this.currentQxQyData,
                this.vectorLayer.getCanvas(),
                // BUG-5: pass the animation grid width so the anim branch never
                // dereferences a (possibly cleared) DEM header.
                this.animLayer.getGridWidth()
            );
        });
    }

    private setupEventListeners() {
        window.addEventListener('message', event => {
            const message = event.data as ToWebviewMessage;
            switch (message.command) {
                case 'setCoordinates':
                    this.map.setView([message.data.lat, message.data.lng], message.data.zoom);
                    break;
                case 'renderDem':
                    this.handleUpdateDem(message.data);
                    break;
                case 'renderInitialInput':
                    this.handleUpdateInitialInput(message.data);
                    break;
                case 'renderQxQy':
                    this.handleUpdateQxQy(message.data);
                    break;
                case 'toggleDem':
                    if (message.data) {
                        this.demLayer.toggle(message.data.visible);
                        const cb = document.getElementById('dem-checkbox') as HTMLInputElement;
                        if (cb) cb.checked = message.data.visible;
                    }
                    break;
                case 'startAnimationLoad':
                    this.handleStartAnimationLoad();
                    break;
                case 'appendAnimationFrame':
                    this.handleAppendAnimationFrame(message.data);
                    break;
                case 'endAnimationLoad':
                    this.handleEndAnimationLoad();
                    break;
                case 'zoomToExtent':
                    const b = message.data;
                    if (b && typeof b.south === 'number') {
                        this.map.fitBounds([
                            [b.south, b.west],
                            [b.north, b.east]
                        ]);
                    }
                    break;
                case 'requestGifFrame':
                    this.handleRequestGifFrame(message.data.index);
                    break;
                case 'setProjectHeader':
                    this.handleSetProjectHeader(message.data);
                    break;
                case 'clearDem':
                    this.handleClearDem();
                    break;
                case 'clearInitialInput':
                    this.handleClearInitialInput();
                    break;
                case 'clearQxQy':
                    this.handleClearQxQy();
                    break;
                case 'toggleAnimationPane':
                    this.setAnimationPaneVisibility(message.visible);
                    break;
                case 'activateLayer':
                    this.handleActivateLayer(message.data.layer);
                    break;
                case 'renderStreamflow':
                    this.handleRenderStreamflow(message.data);
                    break;
                case 'toggleStreamflow':
                    this.handleToggleStreamflow(message.data.visible);
                    break;
                case 'clearStreamflow':
                    this.handleClearStreamflow();
                    break;
            }
        });

        window.addEventListener('layerOrderChanged', () => {
            this.updateLayerOrder();
        });

        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'initSelectionMode') {
                this.setSelectionMode(e.data.cellSize);
            }
        });
    }

    private setSelectionMode(cellSize?: number) {
        if (cellSize) {
            this._selectionCellSize = cellSize;
            console.log(`[MapController] Setting selection cell size to: ${cellSize}`);
        }
        this.mode = 'selection';
        console.log('[MapController] Switching to Selection Mode');

        const sidebar = document.getElementById('map-sidebar');
        if (sidebar) sidebar.style.display = 'none';

        const panes = document.querySelectorAll('.floating-pane');
        panes.forEach(p => (p as HTMLElement).style.display = 'none');

        this.createDimOverlay();

        if (this.cropManager) {
            console.log('[MapController] Starting CropManager...');
            this.cropManager.start();
        } else {
            console.error('[MapController] CropManager is null!');
        }

        if (this.map) {
            this.map.locate({ setView: true, maxZoom: 13 });
            this.map.on('locationerror', () => {
                this.map.setView([0, 0], 2);
            });
        }
    }

    private createDimOverlay() {
        if (this.dimOverlay) return;
        this.dimOverlay = document.createElement('div');
        this.dimOverlay.style.position = 'absolute';
        this.dimOverlay.style.top = '0';
        this.dimOverlay.style.left = '0';
        this.dimOverlay.style.right = '0';
        this.dimOverlay.style.bottom = '0';
        this.dimOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.4)';
        this.dimOverlay.style.pointerEvents = 'none';
        this.dimOverlay.style.zIndex = '999';

        const mapContainer = document.getElementById('map');
        if (mapContainer) {
            mapContainer.appendChild(this.dimOverlay);
            const cropBox = document.getElementById('crop-box');
            if (cropBox) {
                cropBox.style.zIndex = '1000';
            }
        }
    }

    private handleEndAnimationLoad() {
        if (this.currentDemData) {
            const { header, noData } = this.currentDemData;
            this.animLayer.setData(this.animationFrames);
            this.animLayer.setDemContext(this.currentDemData.bounds, header.ncols, header.nrows, noData || -9999);
            this.animLayer.toggle(true);
            const animCb = document.getElementById('animation-checkbox') as HTMLInputElement;
            if (animCb) animCb.checked = true;

            const slider = document.getElementById('animation-slider') as HTMLInputElement;
            if (slider) {
                slider.max = (this.animationFrames.length - 1).toString();
                slider.value = '0';
            }
            this.currentFrameIndex = 0;
            this.renderAnimationFrame();

            const animContent = document.getElementById('animation-controls-content');
            if (animContent) {
                animContent.style.display = 'block';
                const icon = document.getElementById('animation-toggle-icon');
                if (icon) icon.innerHTML = '&#9660;';

                const loadBtn = document.getElementById('load-anim');
                const saveBtn = document.getElementById('save-gif');
                if (loadBtn) loadBtn.style.display = 'flex';
                if (saveBtn) saveBtn.style.display = 'flex';

                this.draggablePanes.movePaneToLeft('pane-animation');
            }
        }
    }

    public togglePlay() {
        this.isPlaying = !this.isPlaying;
        const btn = document.getElementById('animation-play-btn');
        if (btn) btn.innerHTML = this.isPlaying ? '&#10074;&#10074;' : '&#9658;';

        if (this.isPlaying) {
            this.animInterval = setInterval(() => {
                this.currentFrameIndex++;
                if (this.currentFrameIndex >= this.animationFrames.length) {
                    this.currentFrameIndex = 0;
                }
                const slider = document.getElementById('animation-slider') as HTMLInputElement;
                if (slider) slider.value = this.currentFrameIndex.toString();

                this.renderAnimationFrame();
            }, 200);
        } else {
            clearInterval(this.animInterval);
        }
    }

    private updateLabel() {
        const label = document.getElementById('anim-frame-label');
        if (label) label.innerText = `${this.currentFrameIndex + 1} / ${this.animationFrames.length}`;
    }

    private getFormattedDateTime(index: number): { date: string, time: string } {
        if (this.simStartTime === null) {
            return { date: '-', time: '-' };
        }

        const currentTime = this.simStartTime + (index * this.printInterval * 1000);
        const date = new Date(currentTime);

        try {
            const dateStr = new Intl.DateTimeFormat('en-US', {
                timeZone: this.simTimezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                timeZoneName: 'short'
            }).format(date);

            const timeStr = new Intl.DateTimeFormat('en-US', {
                timeZone: this.simTimezone,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }).format(date);

            return { date: dateStr, time: timeStr };
        } catch (e) {
            console.error('Error formatting date:', e);
            return { date: 'Error', time: '-' };
        }
    }

    private updateDateTimeLabel() {
        const dateLabel = document.getElementById('anim-date-label');
        const timeLabel = document.getElementById('anim-time-label');
        if (!dateLabel || !timeLabel) return;

        const { date, time } = this.getFormattedDateTime(this.currentFrameIndex);
        dateLabel.innerText = date;
        timeLabel.innerText = time;
    }

    private updateLayerOrder() {
        const container = document.getElementById('controls-container');
        if (!container) return;

        const panes = Array.from(container.querySelectorAll('.floating-controls')) as HTMLElement[];
        const baseZ = 110;

        panes.forEach((pane, index) => {
            const layerType = pane.dataset.layer;
            const zIndex = (baseZ - index).toString();

            if (layerType === 'dem') {
                this.demLayer.getCanvas().style.zIndex = zIndex;
            } else if (layerType === 'init') {
                this.initLayer.getCanvas().style.zIndex = zIndex;
            } else if (layerType === 'animation') {
                this.animLayer.getCanvas().style.zIndex = zIndex;
            } else if (layerType === 'qxqy') {
                this.vectorLayer.getCanvas().style.zIndex = zIndex; // Ensure access to canvas
            }
        });
    }

    private handleFinishCrop(rect: { x: number, y: number, w: number, h: number }) {
        if (this.mode === 'selection') {
            this.handleSelectionComplete(rect);
            return;
        }

        const w = Math.max(4, Math.round(rect.w / 4) * 4);
        const h = Math.max(2, Math.round(rect.h / 2) * 2);

        this.activeCropRect = {
            x: rect.x,
            y: rect.y,
            w: w,
            h: h
        };
        this.gifCapture.clearCache();

        this.vscode.postMessage({
            command: 'triggerGifExport',
            data: {
                width: w,
                height: h,
                totalFrames: this.animationFrames.length,
                delay: 200
            }
        });
    }

    private handleRequestGifFrame(index: number) {
        if (!this.activeCropRect) return;
        const cropRect = this.activeCropRect;

        this.currentFrameIndex = index;
        const slider = document.getElementById('animation-slider') as HTMLInputElement;
        if (slider) {
            slider.value = index.toString();
            slider.dispatchEvent(new Event('input'));
        }
        this.renderAnimationFrame();

        // Calculate Date/Time for this frame
        const { date, time } = this.getFormattedDateTime(index);

        const pixels = this.gifCapture.captureFrame(
            index,
            this.animationFrames.length,
            cropRect,
            this.demLayer,
            this.animLayer,
            date,
            time
        );

        this.postMessage({
            command: 'gifFrameData',
            data: {
                index: index,
                pixels: pixels
            }
        });
    }

    private handleSetProjectHeader(data: any) {
        if (!data || !data.header) return;

        // Store UTM Zone from Project
        this.projectUtmZone = data.utmZone;
        console.log(`[MapController] Project UTM Zone set to: ${this.projectUtmZone}`);

        this.projectHeader = data.header;
        this.projectZone = data.utmZone;
        this.projectDatum = data.datum || 'WGS84';

        // Always fit bounds first if possible
        try {
            const header = this.projectHeader;
            const zone = this.projectZone;
            const datum = this.projectDatum;

            const bl = UtmConverter.utmToLatLon(header.xllcorner, header.yllcorner, zone, datum);
            const tr = UtmConverter.utmToLatLon(header.xllcorner + (header.ncols * header.cellsize), header.yllcorner + (header.nrows * header.cellsize), zone, datum);

            if (bl && tr) {
                const bounds = L.latLngBounds([
                    [bl.lat, bl.lng],
                    [tr.lat, tr.lng]
                ]);
                this.map.fitBounds(bounds);
            }
        } catch (e) {
            console.error('Error fitting bounds:', e);
        }

        if (!this.currentDemData) {
            this.drawProjectBoundary();
        } else {
            this.removeProjectBoundary();
        }

        // Parse Time Config
        console.log(`[MapController] Received Time Config: Start='${data.simStartTime}', Timezone='${data.timezone}', Interval='${data.printInterval}'`);
        if (data.simStartTime) {
            const dt = new Date(data.simStartTime);
            if (!isNaN(dt.getTime())) {
                this.simStartTime = dt.getTime();
                console.log(`[MapController] Parsed simStartTime: ${this.simStartTime} (${dt.toISOString()})`);
            } else {
                console.warn(`[MapController] Invalid date format for simStartTime: ${data.simStartTime}`);
                this.simStartTime = null;
            }
        } else {
            console.log(`[MapController] simStartTime is missing or empty in project header.`);
            this.simStartTime = null;
        }
        this.simTimezone = data.timezone || 'UTC';
        this.printInterval = data.printInterval ? parseInt(data.printInterval) : 3600;
        this.updateDateTimeLabel();
    }

    private handleRenderStreamflow(data: any) {
        console.log('[MapController] handleRenderStreamflow called. Data points:', data ? data.length : 'null');
        this.streamflowLayer.setData(data);
        console.log('[MapController] Calling handleActivateLayer("streamflow")');
        this.handleActivateLayer('streamflow');
    }


    private handleToggleStreamflow(visible: boolean) {
        this.streamflowLayer.toggle(visible);
        const cb = document.getElementById('streamflow-checkbox') as HTMLInputElement;
        if (cb) cb.checked = visible;
    }

    public setStreamflowPaneVisibility(visible: boolean) {
        const pane = document.getElementById('pane-streamflow');
        if (pane) {
            pane.style.display = visible ? 'block' : 'none';
        }
    }

    private drawProjectBoundary() {
        // Remove existing first
        this.removeProjectBoundary();

        if (!this.projectHeader || !this.projectUtmZone) return;

        const header = this.projectHeader;
        const zone = this.projectUtmZone;
        const datum = this.projectDatum || 'WGS84';

        try {
            const bl = UtmConverter.utmToLatLon(header.xllcorner, header.yllcorner, zone, datum);
            const br = UtmConverter.utmToLatLon(header.xllcorner + (header.ncols * header.cellsize), header.yllcorner, zone, datum);
            const tr = UtmConverter.utmToLatLon(header.xllcorner + (header.ncols * header.cellsize), header.yllcorner + (header.nrows * header.cellsize), zone, datum);
            const tl = UtmConverter.utmToLatLon(header.xllcorner, header.yllcorner + (header.nrows * header.cellsize), zone, datum);

            if (bl && br && tr && tl) {
                const latLngs = [
                    [bl.lat, bl.lng],
                    [br.lat, br.lng],
                    [tr.lat, tr.lng],
                    [tl.lat, tl.lng]
                ];

                const polygon = L.polygon(latLngs, {
                    color: '#ff7800',
                    weight: 2,
                    fill: false,
                    dashArray: '5, 5'
                }).addTo(this.map);

                (this as any)._projectBoundaryLayer = polygon;
            }
        } catch (e) {
            console.error('Error drawing project boundary:', e);
        }
    }

    private removeProjectBoundary() {
        if ((this as any)._projectBoundaryLayer) {
            this.map.removeLayer((this as any)._projectBoundaryLayer);
            (this as any)._projectBoundaryLayer = null;
        }
    }

    private handleActivateLayer(layerName: string) {
        console.log(`[MapController] Activating layer: ${layerName}`);
        let paneId = '';
        let cbId = '';

        switch (layerName) {
            case 'dem':
                paneId = 'pane-dem';
                cbId = 'dem-checkbox';
                if (this.demLayer) this.demLayer.toggle(true);
                this.setDemPaneVisibility(true);
                break;
            case 'init':
                paneId = 'pane-init';
                cbId = 'init-checkbox';
                if (this.initLayer) this.initLayer.toggle(true);
                this.setInitPaneVisibility(true);
                break;
            case 'qxqy':
                paneId = 'pane-qxqy';
                cbId = 'qxqy-checkbox';
                if (this.vectorLayer) this.vectorLayer.toggle(true);
                // Ensure visibility manually or add a setter for QxQy if missing
                const qxPane = document.getElementById('pane-qxqy');
                if (qxPane) qxPane.style.display = 'block';
                break;
            case 'animation':
                paneId = 'pane-animation';
                if (this.animLayer) this.animLayer.toggle(true);
                this.setAnimationPaneVisibility(true);
                break;
            case 'streamflow':
                paneId = 'pane-streamflow';
                cbId = 'streamflow-checkbox';
                if (this.streamflowLayer) this.streamflowLayer.toggle(true);
                this.setStreamflowPaneVisibility(true);
                break;
        }

        if (paneId) {
            this.draggablePanes.movePaneToLeft(paneId);

            if (cbId) {
                const cb = document.getElementById(cbId) as HTMLInputElement;
                if (cb) cb.checked = true;
            }
        }
    }

    private setDemPaneVisibility(visible: boolean) {
        const pane = document.getElementById('pane-dem');
        if (pane) pane.style.display = visible ? 'block' : 'none';
    }

    private setInitPaneVisibility(visible: boolean) {
        const pane = document.getElementById('pane-init');
        if (pane) pane.style.display = visible ? 'block' : 'none';
    }

    private handleSelectionComplete(rect: { x: number, y: number, w: number, h: number }) {
        const topLeft = this.map.containerPointToLatLng(L.point(rect.x, rect.y));
        const bottomRight = this.map.containerPointToLatLng(L.point(rect.x + rect.w, rect.y + rect.h));

        const north = Math.max(topLeft.lat, bottomRight.lat);
        const south = Math.min(topLeft.lat, bottomRight.lat);
        const east = Math.max(topLeft.lng, bottomRight.lng);
        const west = Math.min(topLeft.lng, bottomRight.lng);

        // BUG-5: convert ALL FOUR corners under a SINGLE forced reference zone
        // (the box centroid). A box straddling a UTM zone boundary otherwise
        // converts each corner with its own auto-detected zone, so Math.min/max
        // over eastings from different central meridians (different false-easting
        // frames) yields a grossly mis-sized, silently mis-georeferenced area.
        const centroidLat = (north + south) / 2;
        const centroidLon = (east + west) / 2;
        const refZone = Math.floor((centroidLon + 180) / 6.0) + 1;
        const isNorth = centroidLat >= 0;

        const nwUtm = UtmConverter.latLonToUtm(north, west, refZone);
        const seUtm = UtmConverter.latLonToUtm(south, east, refZone);
        const neUtm = UtmConverter.latLonToUtm(north, east, refZone);
        const swUtm = UtmConverter.latLonToUtm(south, west, refZone);

        const minX = Math.min(nwUtm.x, seUtm.x, neUtm.x, swUtm.x);
        const maxX = Math.max(nwUtm.x, seUtm.x, neUtm.x, swUtm.x);
        const minY = Math.min(nwUtm.y, seUtm.y, neUtm.y, swUtm.y);
        const maxY = Math.max(nwUtm.y, seUtm.y, neUtm.y, swUtm.y);

        const cellsize = this._selectionCellSize;

        const ncols = Math.ceil((maxX - minX) / cellsize);
        const nrows = Math.ceil((maxY - minY) / cellsize);

        const header = {
            ncols,
            nrows,
            xllcorner: parseFloat(minX.toFixed(2)),
            yllcorner: parseFloat(minY.toFixed(2)),
            cellsize,
            NODATA_value: -9999
        };

        // Tag the header with the SINGLE forced reference zone used for all four
        // corners (not just the NW corner's auto-detected zone).
        const zoneStr = `${refZone}${isNorth ? 'N' : 'S'}`;

        this.vscode.postMessage({
            command: 'selectionComplete',
            data: {
                header,
                utmZone: zoneStr,
                datum: 'WGS84'
            }
        });
    }

    private handleClearStreamflow() {
        if (this.streamflowLayer) {
            this.streamflowLayer.clear();
        }
        this.setStreamflowPaneVisibility(false);
        const cb = document.getElementById('streamflow-checkbox') as HTMLInputElement;
        if (cb) cb.checked = false;
    }

    public setBaseLayer(name: string) {
        if (name === 'None') {
            if (this.activeBaseLayer) {
                this.map.removeLayer(this.activeBaseLayer);
                this.activeBaseLayer = null;
                console.log('[MapController] Base layer removed (None selected)');
            }
            return;
        }

        if (this.baseMaps && this.baseMaps[name]) {
            const layer = this.baseMaps[name];
            if (this.activeBaseLayer !== layer) {
                // Remove previous layer
                if (this.activeBaseLayer) {
                    this.map.removeLayer(this.activeBaseLayer);
                }

                // Add new layer
                this.map.addLayer(layer);
                this.activeBaseLayer = layer;
                console.log(`[MapController] Switched to base layer: ${name}`);
            }
        }
    }
}
