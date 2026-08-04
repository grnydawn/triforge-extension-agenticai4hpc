export class Colors {
    static getColor(t: number, mapType: string): number[] {
        // t is 0.0 to 1.0
        switch (mapType) {
            case 'Grayscale':
                // White (Low) -> Black (High)
                const g = Math.floor((1 - t) * 255);
                return [g, g, g];
            case 'Rainbow':
                return this.hslToRgb((1 - t) * 240 / 360, 1, 0.5);
            case 'Viridis':
                return this.interpolateViridis(t);
            case 'Magma':
                // Simple Magma-ish
                return this.interpolateMagma(t);
            case 'Terrain':
                return this.interpolateTerrain(t);
            case 'Blues':
                return this.interpolateBlues(t);
            case 'Teal':
                return this.interpolateTeal(t);
            case 'Water':
                return this.interpolateWater(t);
            default:
                return [Math.floor(t * 255), Math.floor(t * 255), Math.floor(t * 255)];
        }
    }

    static hslToRgb(h: number, s: number, l: number): number[] {
        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p: number, q: number, t: number) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1 / 6) return p + (q - p) * 6 * t;
                if (t < 1 / 2) return q;
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    static interpolateMagma(t: number): number[] {
        if (t < 0.33) {
            const f = t / 0.33;
            return [f * 80, f * 0, f * 80];
        } else if (t < 0.66) {
            const f = (t - 0.33) / 0.33;
            return [80 + f * 175, 0 + f * 100, 80 - f * 80];
        } else {
            const f = (t - 0.66) / 0.34;
            return [255, 100 + f * 155, 0 + f * 150];
        }
    }

    static interpolateBlues(t: number): number[] {
        if (t < 0.5) {
            const f = t * 2;
            return [247 + (107 - 247) * f, 251 + (174 - 251) * f, 255 + (214 - 255) * f];
        } else {
            const f = (t - 0.5) * 2;
            return [107 + (8 - 107) * f, 174 + (48 - 174) * f, 214 + (107 - 214) * f];
        }
    }

    static interpolateTeal(t: number): number[] {
        if (t < 0.5) {
            const f = t * 2;
            return [224 + (100 - 224) * f, 255 + (200 - 255) * f, 255 + (200 - 255) * f];
        } else {
            const f = (t - 0.5) * 2;
            return [100 + (0 - 100) * f, 200 + (100 - 200) * f, 200 + (100 - 200) * f];
        }
    }

    static interpolateWater(t: number): number[] {
        const r = 200 * (1 - t);
        const g = 200 * (1 - t);
        const b = 255;
        return [r, g, b];
    }

    static interpolateViridis(t: number): number[] {
        if (t < 0.5) {
            const f = t * 2;
            return [68 + (33 - 68) * f, 1 + (145 - 1) * f, 84 + (140 - 84) * f];
        } else {
            const f = (t - 0.5) * 2;
            return [33 + (253 - 33) * f, 145 + (231 - 145) * f, 140 + (37 - 140) * f];
        }
    }

    static interpolateTerrain(t: number): number[] {
        if (t < 0.2) {
            const f = t / 0.2;
            return [0 + (34 - 0) * f, 60 + (139 - 60) * f, 0 + (34 - 0) * f];
        } else if (t < 0.5) {
            const f = (t - 0.2) / 0.3;
            return [34 + (244 - 34) * f, 139 + (164 - 139) * f, 34 + (96 - 34) * f];
        } else if (t < 0.8) {
            const f = (t - 0.5) / 0.3;
            return [244 + (139 - 244) * f, 164 + (69 - 164) * f, 96 + (19 - 96) * f];
        } else {
            const f = (t - 0.8) / 0.2;
            return [139 + (255 - 139) * f, 69 + (255 - 69) * f, 19 + (255 - 19) * f];
        }
    }
}
