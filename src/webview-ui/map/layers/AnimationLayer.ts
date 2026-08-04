import { Colors } from '../utils/Colors';
import { ProjectionManager } from '../ProjectionManager';

export class AnimationLayer {
    private canvas: HTMLCanvasElement;
    private map: any;
    private frames: number[][] = [];
    private demBounds: any = null;
    private demDims: { cols: number, rows: number } = { cols: 0, rows: 0 };
    private demNoData: number = -9999;

    private isVisible: boolean = true;
    private mapType: string = 'Rainbow';

    // Optimization Cache
    // Map key: frameIndex -> ImageBitmap (or HTMLCanvasElement/ImageData)
    // We use ImageData for now as it is device-independent, or a separate offscreen canvas? 
    // ImageBitmap is faster for drawing.
    private frameCache: Map<number, ImageBitmap> = new Map();
    private lastOptionsKey: string = '';

    private cachedImageData: ImageData | null = null;
    private cachedUint32View: Uint32Array | null = null;
    private colorLUT: Uint32Array = new Uint32Array(256);
    private lutMin: number = -1;
    private lutMax: number = -1;
    private lutMapType: string = '';
    // Store opacity during cache generation to detect changes? 
    // Actually opacity is applied to the main canvas via style.opacity. 
    // BUT if we want to support per-pixel alpha from value, that's inside the pixel data. 
    // The current implementation applies global opacity to the canvas. 
    // So we don't need to invalidate cache on opacity change! 
    // We DO need to invalidate on: mapType change, min/max change, data change.

    constructor(map: any) {
        this.map = map;
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.transformOrigin = '0 0';
        this.canvas.style.zIndex = '101';
        this.canvas.className = 'leaflet-zoom-animated';
        this.canvas.style.pointerEvents = 'none'; // Passthrough
        this.canvas.style.display = 'none';

        map.getPane('overlayPane').appendChild(this.canvas);

        map.on('move', () => this.updateTransform());
        map.on('zoomend', () => this.updateTransform());
    }

    public setData(frames: number[][]) {
        this.frames = frames;
        this.clearCache();
    }

    public setDemContext(bounds: any, cols: number, rows: number, noData: number) {
        this.demBounds = bounds;
        this.demDims = { cols, rows };
        this.demNoData = noData;

        // Init canvas size
        this.canvas.width = cols;
        this.canvas.height = rows;

        // Invalidate buffers and cache
        this.cachedImageData = null;
        this.cachedUint32View = null;
        this.clearCache();

        this.updateTransform();
    }

    public setOptions(options: { mapType?: string, opacity?: number }) {
        let changed = false;
        if (options.mapType && this.mapType !== options.mapType) {
            this.mapType = options.mapType;
            changed = true;
        }
        if (options.opacity !== undefined) this.setOpacity(options.opacity);

        if (changed) this.clearCache();
    }

    public setOpacity(opacity: number) {
        this.canvas.style.opacity = opacity.toString();
        // Opacity handled via CSS, no cache clear needed
    }

    public toggle(visible: boolean) {
        this.isVisible = visible;
        this.canvas.style.display = visible ? 'block' : 'none';
    }

    private clearCache() {
        // Close bitmaps if needed? JS GC should handle it, but explicit close is good practice if supported manually.
        this.frameCache.forEach(bitmap => {
            if (bitmap && typeof bitmap.close === 'function') bitmap.close();
        });
        this.frameCache.clear();
        this.lastOptionsKey = '';
    }

    private updateLUT(min: number, max: number) {
        if (this.lutMin === min && this.lutMax === max && this.lutMapType === this.mapType) return;

        for (let i = 0; i < 256; i++) {
            const t = i / 255;
            const [r, g, b] = Colors.getColor(t, this.mapType);
            this.colorLUT[i] = (255 << 24) | (b << 16) | (g << 8) | r;
        }

        this.lutMin = min;
        this.lutMax = max;
        this.lutMapType = this.mapType;
        // LUT changed, this implicitly means visual changed.
        // But invalidation is handled by check in renderFrame or setOptions.
        // Actually, renderFrame passes min/max. If min/max changes, we need new cache.
    }

    public async renderFrame(index: number, min: number, max: number) {
        if (!this.frames || !this.frames[index]) return;
        if (this.demDims.cols === 0 || this.demDims.rows === 0) return;

        // Cache Key Logic
        // If min/max change, the entire cache is invalid for this new range.
        const optionsKey = `${min}_${max}_${this.mapType}`;
        if (this.lastOptionsKey !== optionsKey) {
            this.clearCache();
            this.lastOptionsKey = optionsKey;
        }

        if (this.frameCache.has(index)) {
            const bitmap = this.frameCache.get(index)!;
            const ctx = this.canvas.getContext('2d')!;
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.drawImage(bitmap, 0, 0);

            if (this.isVisible) this.canvas.style.display = 'block';
            return;
        }

        const cols = this.demDims.cols;
        const rows = this.demDims.rows;

        // Ensure buffer exists
        if (!this.cachedImageData || this.cachedImageData.width !== cols || this.cachedImageData.height !== rows) {
            const ctx = this.canvas.getContext('2d')!;
            this.cachedImageData = ctx.createImageData(cols, rows);
            this.cachedUint32View = new Uint32Array(this.cachedImageData.data.buffer);
        }

        const data = this.frames[index];
        const pixels = this.cachedUint32View!;
        this.updateLUT(min, max);

        const lut = this.colorLUT;
        const range = max - min;
        const invRange = range > 0 ? 255 / range : 0;
        const noData = this.demNoData;

        for (let i = 0; i < data.length; i++) {
            const val = data[i];

            if (val === -9999 || val === noData || val < min || val > max) {
                pixels[i] = 0; // Transparent
            } else {
                const normalizedIdx = Math.floor((val - min) * invRange);
                pixels[i] = lut[normalizedIdx > 255 ? 255 : (normalizedIdx < 0 ? 0 : normalizedIdx)];
            }
        }

        // Create ImageBitmap from the ImageData for fast drawing next time
        // Note: createImageBitmap matches the ImageData.
        const ctx = this.canvas.getContext('2d')!;
        ctx.putImageData(this.cachedImageData, 0, 0);

        try {
            const bitmap = await createImageBitmap(this.cachedImageData);
            this.frameCache.set(index, bitmap);
        } catch (e) {
            console.warn('[AnimationLayer] CreateImageBitmap failed, caching disabled for frame', e);
        }

        if (this.isVisible) this.canvas.style.display = 'block';
    }

    public updateTransform() {
        if (!this.demBounds) return;

        const pTL = this.map.latLngToLayerPoint([this.demBounds.tl.lat, this.demBounds.tl.lng]);
        const pTR = this.map.latLngToLayerPoint([this.demBounds.tr.lat, this.demBounds.tr.lng]);
        const pBL = this.map.latLngToLayerPoint([this.demBounds.bl.lat, this.demBounds.bl.lng]);
        const pBR = this.map.latLngToLayerPoint([this.demBounds.br.lat, this.demBounds.br.lng]);

        const w = this.canvas.width;
        const h = this.canvas.height;

        const matrix3d = ProjectionManager.update(
            [0, 0, w, 0, 0, h, w, h],
            [pTL.x, pTL.y, pTR.x, pTR.y, pBL.x, pBL.y, pBR.x, pBR.y]
        );

        this.canvas.style.transform = matrix3d;
    }

    public getCanvas() {
        return this.canvas;
    }

    /**
     * BUG-5: the animation grid width (columns) carried via `setDemContext`.
     * The Tooltip uses this to index animation frames so it no longer needs to
     * dereference the (possibly cleared) DEM header's `ncols`.
     */
    public getGridWidth(): number {
        return this.demDims.cols;
    }
}
