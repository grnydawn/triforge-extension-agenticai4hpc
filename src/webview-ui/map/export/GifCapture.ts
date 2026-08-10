import { DemLayer } from '../layers/DemLayer';
import { AnimationLayer } from '../layers/AnimationLayer';

export class GifCapture {

    private capturedBackgroundCanvas: HTMLCanvasElement | null = null;

    public clearCache() {
        this.capturedBackgroundCanvas = null;
    }

    public captureBackground(cropRect: { x: number, y: number, w: number, h: number }, demLayer: DemLayer): HTMLCanvasElement {
        const bgCanvas = document.createElement('canvas');
        bgCanvas.width = Math.max(1, cropRect.w);
        bgCanvas.height = Math.max(1, cropRect.h);
        const ctx = bgCanvas.getContext('2d')!;

        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

        // 1. Tiles
        const tiles = document.querySelectorAll('.leaflet-tile-loaded');
        tiles.forEach(imgElement => {
            const img = imgElement as HTMLImageElement;
            const imgRect = img.getBoundingClientRect();
            const destX = imgRect.left - (cropRect.x);
            const destY = imgRect.top - (cropRect.y);

            if (destX + imgRect.width < 0 || destX > cropRect.w || destY + imgRect.height < 0 || destY > cropRect.h) return;

            try {
                ctx.drawImage(img, destX, destY, imgRect.width, imgRect.height);
            } catch (e) { }
        });

        // 2. DEM
        if (demLayer && demLayer.isVisible) {
            const demCanvas = demLayer.getCanvas();
            if (demCanvas && demCanvas.width > 0 && demCanvas.height > 0) {
                const demRect = demCanvas.getBoundingClientRect();
                const destX = demRect.left - cropRect.x;
                const destY = demRect.top - cropRect.y;
                const opacity = parseFloat(demCanvas.style.opacity || '1');
                const oldAlpha = ctx.globalAlpha;
                ctx.globalAlpha = opacity;
                ctx.drawImage(demCanvas, destX, destY, demRect.width, demRect.height);
                ctx.globalAlpha = oldAlpha;
            }
        }

        return bgCanvas;
    }

    public captureFrame(
        index: number,
        totalFrames: number,
        cropRect: { x: number, y: number, w: number, h: number },
        demLayer: DemLayer,
        animLayer: AnimationLayer,
        dateStr: string = '',
        timeStr: string = ''
    ): number[] {

        // On first frame, capture background
        if (index === 0 || !this.capturedBackgroundCanvas) {
            this.capturedBackgroundCanvas = this.captureBackground(cropRect, demLayer);
        }

        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = cropRect.w;
        finalCanvas.height = cropRect.h;
        const finalCtx = finalCanvas.getContext('2d')!;

        // 1. Background
        if (this.capturedBackgroundCanvas) {
            finalCtx.drawImage(this.capturedBackgroundCanvas, 0, 0);
        }

        // 2. Capture Animation Layer
        const animCanvas = animLayer.getCanvas();
        if (animCanvas && animCanvas.style.display !== 'none' && animCanvas.width > 0 && animCanvas.height > 0) {
            const animRect = animCanvas.getBoundingClientRect();
            const destX = animRect.left - cropRect.x;
            const destY = animRect.top - cropRect.y;
            const opacity = parseFloat(animCanvas.style.opacity || '1');
            const oldAlpha = finalCtx.globalAlpha;
            finalCtx.globalAlpha = opacity;
            finalCtx.drawImage(animCanvas, destX, destY, animRect.width, animRect.height);
            finalCtx.globalAlpha = oldAlpha;
        }

        // 3. Draw Label
        finalCtx.font = "20px sans-serif";
        finalCtx.fillStyle = "white";
        finalCtx.strokeStyle = "black";
        finalCtx.lineWidth = 3;
        const text = `${index + 1} / ${totalFrames}`;
        finalCtx.strokeText(text, 10, 30);
        finalCtx.fillText(text, 10, 30);

        // Draw Date/Time
        // Slightly smaller font below the frame count
        if (dateStr && timeStr) {
            finalCtx.font = "16px sans-serif";

            const dateText = dateStr;
            finalCtx.strokeText(dateText, 10, 55);
            finalCtx.fillText(dateText, 10, 55);

            const timeText = timeStr;
            finalCtx.strokeText(timeText, 10, 75);
            finalCtx.fillText(timeText, 10, 75);
        }

        // 4. Send Pixels
        const imgData = finalCtx.getImageData(0, 0, cropRect.w, cropRect.h);
        return Array.from(imgData.data);
    }
}
