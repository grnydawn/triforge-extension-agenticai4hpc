import { Colors } from '../utils/Colors';

export class LegendRenderer {
    public static draw(canvasId: string, mapType: string) {
        const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);
        const grad = ctx.createLinearGradient(0, 0, w, 0);

        const steps = 10;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const [r, g, b] = Colors.getColor(t, mapType);
            grad.addColorStop(t, `rgb(${r},${g},${b})`);
        }

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    }
}
