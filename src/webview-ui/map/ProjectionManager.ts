
export class ProjectionManager {
    static matrix: number[] | null = null;
    static invMatrix: number[] | null = null;

    static math = {
        multmm(a: number[], b: number[]): number[] {
            const c = Array(9);
            for (let i = 0; i != 3; ++i) {
                for (let j = 0; j != 3; ++j) {
                    let cij = 0;
                    for (let k = 0; k != 3; ++k) {
                        cij += a[3 * i + k] * b[3 * k + j];
                    }
                    c[3 * i + j] = cij;
                }
            }
            return c;
        },
        multmv(m: number[], v: number[]): number[] {
            return [
                m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
                m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
                m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
            ];
        },
        adj(m: number[]): number[] {
            return [
                m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
                m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
                m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]
            ];
        },
        basisToPoints(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): number[] {
            const m = [
                x1, x2, x3,
                y1, y2, y3,
                1, 1, 1
            ];
            const v = this.multmv(this.adj(m), [x4, y4, 1]);
            return this.multmm(m, [
                v[0], 0, 0,
                0, v[1], 0,
                0, 0, v[2]
            ]);
        },
        general2DProjection(x1s: number, y1s: number, x1d: number, y1d: number, x2s: number, y2s: number, x2d: number, y2d: number, x3s: number, y3s: number, x3d: number, y3d: number, x4s: number, y4s: number, x4d: number, y4d: number): number[] {
            const s = this.basisToPoints(x1s, y1s, x2s, y2s, x3s, y3s, x4s, y4s);
            const d = this.basisToPoints(x1d, y1d, x2d, y2d, x3d, y3d, x4d, y4d);
            return this.multmm(d, this.adj(s));
        },
        invert3x3(m: number[]): number[] | null {
            const m00 = m[0], m01 = m[1], m02 = m[2];
            const m10 = m[3], m11 = m[4], m12 = m[5];
            const m20 = m[6], m21 = m[7], m22 = m[8];

            const det = m00 * (m11 * m22 - m12 * m21) -
                m01 * (m10 * m22 - m12 * m20) +
                m02 * (m10 * m21 - m11 * m20);

            if (Math.abs(det) < 1e-10) return null; // Singular

            const invDet = 1 / det;
            const inv = [];
            inv[0] = (m11 * m22 - m12 * m21) * invDet;
            inv[1] = (m02 * m21 - m01 * m22) * invDet;
            inv[2] = (m01 * m12 - m02 * m11) * invDet;
            inv[3] = (m12 * m20 - m10 * m22) * invDet;
            inv[4] = (m00 * m22 - m02 * m20) * invDet;
            inv[5] = (m02 * m10 - m00 * m12) * invDet;
            inv[6] = (m10 * m21 - m11 * m20) * invDet;
            inv[7] = (m01 * m20 - m00 * m21) * invDet;
            inv[8] = (m00 * m11 - m01 * m10) * invDet;
            return inv;
        },
        applyPerspective(x: number, y: number, matrix: number[]): [number, number] {
            const w = matrix[6] * x + matrix[7] * y + matrix[8];
            const nx = (matrix[0] * x + matrix[1] * y + matrix[2]) / w;
            const ny = (matrix[3] * x + matrix[4] * y + matrix[5]) / w;
            return [nx, ny];
        }
    };

    // Calculate forward and inverse matrices
    static update(src: number[], dst: number[]): string {
        // src: [x1,y1, x2,y2, x3,y3, x4,y4] (Normalized Coords: 0,0 ... w,h)
        // dst: [x1,y1, x2,y2, x3,y3, x4,y4] (Screen Pixels)

        this.matrix = this.math.general2DProjection(
            src[0], src[1], dst[0], dst[1],
            src[2], src[3], dst[2], dst[3],
            src[4], src[5], dst[4], dst[5],
            src[6], src[7], dst[6], dst[7]
        );

        // Calculate inverse for hit-testing
        this.invMatrix = this.math.invert3x3(this.matrix);

        // Normalize Matrix (divide by w=m[8]) to prevent massive numbers in CSS
        if (this.matrix[8] !== 0 && this.matrix[8] !== 1) {
            const w = this.matrix[8];
            for (let i = 0; i < 9; i++) {
                this.matrix[i] /= w;
            }
        }

        // Convert to CSS matrix3d string
        const m = this.matrix;
        // CSS matrix3d is 4x4 column-major
        // [ m00, m10, 0, m20 ]
        // [ m01, m11, 0, m21 ]
        // [ 0,   0,   1, 0   ]
        // [ m02, m12, 0, m22 ]
        return `matrix3d(${m[0]}, ${m[3]}, 0, ${m[6]}, ${m[1]}, ${m[4]}, 0, ${m[7]}, 0, 0, 1, 0, ${m[2]}, ${m[5]}, 0, ${m[8]})`;
    }

    // Map Screen Pixel (relative to pane) -> DEM Grid Index (Source Coords)
    static pixelToDem(x: number, y: number): [number, number] | null {
        if (!this.invMatrix) return null;
        return this.math.applyPerspective(x, y, this.invMatrix);
    }

    static demToPixel(col: number, row: number): [number, number] | null {
        if (!this.matrix) return null;
        return this.math.applyPerspective(col, row, this.matrix);
    }
}
