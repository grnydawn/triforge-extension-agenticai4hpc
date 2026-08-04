
import { ProjectionManager } from '../ProjectionManager';

export class VectorLayer {
    private canvas: HTMLCanvasElement;
    private map: any; // Leaflet Map
    private data: { qx: number[][], qy: number[][], noData: number } | null = null;
    private corners: any = null; // bounds
    public isVisible: boolean = true;

    // Rendering Settings
    public stride: number = 10;
    public scale: number = 1.0;
    public color: string = '#000000';
    public lineWidth: number = 1;

    constructor(map: any) {
        this.map = map;
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.transformOrigin = '0 0';
        this.canvas.style.zIndex = '110'; // Above Init (105)
        this.canvas.className = 'leaflet-zoom-animated';
        this.canvas.style.display = 'none';
        this.canvas.style.pointerEvents = 'none'; // Passthrough click

        map.getPane('overlayPane').appendChild(this.canvas);

        map.on('move', () => this.updateTransform());
        map.on('zoomend', () => this.updateTransform());
    }

    public setData(data: { qx: number[][], qy: number[][], noData: number, bounds: any } | null) {
        this.data = data;
        if (!data) {
            this.render();
            return;
        }

        if (data.bounds && data.bounds.tl) {
            this.corners = data.bounds;
        } else if (data.bounds) {
            this.corners = {
                tl: { lat: data.bounds.north, lng: data.bounds.west },
                tr: { lat: data.bounds.north, lng: data.bounds.east },
                bl: { lat: data.bounds.south, lng: data.bounds.west },
                br: { lat: data.bounds.south, lng: data.bounds.east }
            };
        }

        // Auto-stride logic removed (handled by MapController)
        // Default only if needed
        if (!this.stride && this.data && this.data.qx && this.data.qx.length > 0) {
            const width = this.data.qx[0].length;
            this.stride = Math.max(1, Math.floor(width / 50));
        }

        this.render();
    }

    public setOptions(options: { stride?: number, scale?: number, color?: string }) {
        if (options.stride !== undefined) this.stride = options.stride;
        if (options.scale !== undefined) this.scale = options.scale;
        if (options.color !== undefined) this.color = options.color;
        this.render();
    }

    public toggle(visible: boolean) {
        this.isVisible = visible;
        this.canvas.style.display = visible ? 'block' : 'none';
        if (visible) this.render();
    }

    private render() {
        if (!this.data || !this.isVisible) {
            const ctx = this.canvas.getContext('2d')!;
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            return;
        }

        const { qx, qy, noData } = this.data;
        if (!qx || qx.length === 0) {
            const ctx = this.canvas.getContext('2d')!;
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            return;
        }

        const rows = qx.length;
        const cols = qx[0].length;

        this.canvas.width = cols;
        this.canvas.height = rows;
        const ctx = this.canvas.getContext('2d')!;
        ctx.clearRect(0, 0, cols, rows);

        ctx.strokeStyle = this.color;
        ctx.lineWidth = this.lineWidth;
        ctx.beginPath();

        const stride = Math.max(1, Math.round(this.stride));

        for (let r = 0; r < rows; r += stride) {
            for (let c = 0; c < cols; c += stride) {
                const valX = qx[r][c];
                const valY = qy[r][c];

                if (valX === noData || valY === noData || (valX === 0 && valY === 0)) continue;

                // Hydra: +Y is North (Up), but Canvas +Y is Down.
                // So dy should be -valY
                const dx = valX * this.scale;
                const dy = -valY * this.scale;

                // Center point
                const cx = c + 0.5;
                const cy = r + 0.5;

                // Draw Arrow
                // Main line
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx + dx, cy + dy);

                // Arrowhead
                const headLen = Math.min(5, Math.sqrt(dx * dx + dy * dy) * 0.3);
                const angle = Math.atan2(dy, dx);
                ctx.moveTo(cx + dx, cy + dy);
                ctx.lineTo(cx + dx - headLen * Math.cos(angle - Math.PI / 6), cy + dy - headLen * Math.sin(angle - Math.PI / 6));
                ctx.moveTo(cx + dx, cy + dy);
                ctx.lineTo(cx + dx - headLen * Math.cos(angle + Math.PI / 6), cy + dy - headLen * Math.sin(angle + Math.PI / 6));
            }
        }
        ctx.stroke();

        this.updateTransform();
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
        // console.log('[VectorLayer] Transform updated', matrix3d);
    }

    public getCanvas() {
        return this.canvas;
    }
}
