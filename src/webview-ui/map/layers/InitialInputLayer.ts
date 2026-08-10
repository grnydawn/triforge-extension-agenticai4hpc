import { Colors } from '../utils/Colors';
import { ProjectionManager } from '../ProjectionManager';

export class InitialInputLayer {
    private canvas: HTMLCanvasElement;
    private boundaryLayer: any; // Leaflet Polygon
    private map: any; // Leaflet Map
    private data: any = null; // demData
    private corners: any = null; // bounds
    public isVisible: boolean = true;
    private mapType: string = 'Blues'; // Default for Init
    // private hillshade: boolean = false;

    constructor(map: any) {
        this.map = map;
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.transformOrigin = '0 0';
        this.canvas.style.zIndex = '105'; // Slightly above DEM (100) but below Animation (120?)
        this.canvas.className = 'leaflet-zoom-animated';
        this.canvas.style.display = 'none';

        // Add to map immediately but hidden
        map.getPane('overlayPane').appendChild(this.canvas);

        map.on('move', () => this.updateTransform());
        map.on('zoomend', () => this.updateTransform());
    }

    public setData(demData: any) {
        this.data = demData;
        if (demData.bounds && demData.bounds.tl) {
            this.corners = demData.bounds;
        } else if (demData.bounds) {
            this.corners = {
                tl: { lat: demData.bounds.north, lng: demData.bounds.west },
                tr: { lat: demData.bounds.north, lng: demData.bounds.east },
                bl: { lat: demData.bounds.south, lng: demData.bounds.west },
                br: { lat: demData.bounds.south, lng: demData.bounds.east }
            };
        }
        this.render();
    }

    public setOptions(options: { mapType?: string, hillshade?: boolean, min?: number, max?: number }) {
        if (options.mapType) this.mapType = options.mapType;
        // if (typeof options.hillshade !== 'undefined') this.hillshade = options.hillshade;
        this.render(options.min, options.max);
    }

    public setOpacity(opacity: number) {
        this.canvas.style.opacity = opacity.toString();
    }

    public toggle(visible: boolean) {
        this.isVisible = visible;
        this.canvas.style.display = visible ? 'block' : 'none';
        if (this.boundaryLayer) {
            if (visible) this.boundaryLayer.addTo(this.map);
            else this.boundaryLayer.remove();
        }
    }

    public clear() {
        this.data = null;
        this.corners = null;
        const ctx = this.canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.updateBoundary(); // removes boundary
        this.canvas.style.display = 'none';
        this.isVisible = false;
    }

    private render(min?: number, max?: number) {
        if (!this.data) return;

        const { values, noData } = this.data;
        const rows = values.length;
        const cols = values[0].length;
        // const cellsize = header ? header.cellsize : 10;

        // Auto defaults
        if (min === undefined) min = this.data.min;
        if (max === undefined) max = this.data.max;

        this.canvas.width = cols;
        this.canvas.height = rows;
        const ctx = this.canvas.getContext('2d')!;
        const imgData = ctx.createImageData(cols, rows);

        // const zFactor = 3.0; // Hillshade not usually needed for init inputs, but we keep structure

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const val = values[r][c];
                const idx = (r * cols + c) * 4;

                if (val === noData || val < min! || val > max!) {
                    imgData.data[idx] = 0; imgData.data[idx + 1] = 0; imgData.data[idx + 2] = 0; imgData.data[idx + 3] = 0;
                } else {
                    // @ts-ignore
                    const norm = (val - min) / (max - min);
                    const [R, G, B] = Colors.getColor(norm, this.mapType);

                    imgData.data[idx] = R;
                    imgData.data[idx + 1] = G;
                    imgData.data[idx + 2] = B;
                    imgData.data[idx + 3] = 255;
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);

        this.updateBoundary();
        this.updateTransform();
        if (this.isVisible) this.canvas.style.display = 'block';
    }

    private updateBoundary() {
        if (this.boundaryLayer) this.boundaryLayer.remove();
        if (!this.corners) return;

        // @ts-ignore
        const L = window.L;
        const boundaryLatlngs = [
            [this.corners.tl.lat, this.corners.tl.lng],
            [this.corners.tr.lat, this.corners.tr.lng],
            [this.corners.br.lat, this.corners.br.lng],
            [this.corners.bl.lat, this.corners.bl.lng]
        ];

        this.boundaryLayer = L.polygon(boundaryLatlngs, {
            color: '#004488', weight: 1, dashArray: '2, 2', fill: false, interactive: false
        });

        if (this.isVisible) this.boundaryLayer.addTo(this.map);
    }

    public updateTransform() {
        if (!this.corners) return;
        const pTL = this.map.latLngToLayerPoint([this.corners.tl.lat, this.corners.tl.lng]);
        const pTR = this.map.latLngToLayerPoint([this.corners.tr.lat, this.corners.tr.lng]);
        const pBL = this.map.latLngToLayerPoint([this.corners.bl.lat, this.corners.bl.lng]);
        const pBR = this.map.latLngToLayerPoint([this.corners.br.lat, this.corners.br.lng]);

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
}
