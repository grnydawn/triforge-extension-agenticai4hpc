import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/Logger';

export class BinaryParser {

    public static async save(filePath: string, data: { header: { ncols: number, nrows: number, noData: number }, values: number[][] }): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const stream = fs.createWriteStream(filePath);
                stream.on('error', (err) => reject(err));
                stream.on('finish', () => resolve());

                // Header: 16 bytes (Rows, Cols as DoubleLE)
                const headerBuf = Buffer.alloc(16);
                headerBuf.writeDoubleLE(data.header.nrows, 0);
                headerBuf.writeDoubleLE(data.header.ncols, 8);
                stream.write(headerBuf);

                // Body: Rows * Cols * 8 bytes (DoubleLE)
                // values is number[][]
                for (let r = 0; r < data.header.nrows; r++) {
                    const row = data.values[r];
                    // Create buffer for row
                    const rowBuf = Buffer.alloc(data.header.ncols * 8);
                    for (let c = 0; c < data.header.ncols; c++) {
                        const val = (row && row[c] !== undefined) ? row[c] : data.header.noData;
                        rowBuf.writeDoubleLE(val, c * 8);
                    }
                    stream.write(rowBuf);
                }

                stream.end();

            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Stitches multiple binary part files into a single Float32Array matrix.
     * Format per User's Python Script:
     * Header: 16 bytes = 2 * Float64 (Rows, Cols).
     * Body: Rows * Cols * Float64.
     * 
     * Stitching Logic:
     * Assuming blocks are standard domain decomposition slices.
     * We will concatenate them in the order of the file names (00, 01, etc).
     */
    public static async stitchFiles(files: string[], demHeader: { lastCols: number; lastRows: number; noData: number }): Promise<Float32Array | null> {
        try {
            const expectedSize = demHeader.lastCols * demHeader.lastRows;
            const outputMatrix = new Float32Array(expectedSize).fill(demHeader.noData);

            // 1. Sort files
            files.sort((a, b) => {
                return path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' });
            });

            // 2. Read and Concatenate
            let currentOffset = 0;

            // Final Stitched Stats
            let stitchedMin = Number.MAX_VALUE;
            let stitchedMax = -Number.MAX_VALUE;

            for (const filePath of files) {
                if (!fs.existsSync(filePath)) continue;

                // Read Header (16 bytes) - Attempt for Double
                const headerBuffer = Buffer.alloc(16);
                let fd = 0;
                try {
                    fd = fs.openSync(filePath, 'r');
                    const bytesRead = fs.readSync(fd, headerBuffer as unknown as Uint8Array, 0, 16, 0);
                    // Minimal 8 bytes needed for Float fallback
                    if (bytesRead < 8) {
                        fs.closeSync(fd);
                        continue;
                    }
                } catch (e) {
                    if (fd) fs.closeSync(fd);
                    continue;
                }

                const stats = fs.statSync(filePath);

                // 1. Try Double Precision Header (16 bytes: Rows(F64), Cols(F64))
                let rows = headerBuffer.readDoubleLE(0);
                let cols = headerBuffer.readDoubleLE(8);

                let isDouble = false;
                let isFloat = false;
                let headerSize = 16;

                const expectedBodyDouble = rows * cols * 8;

                // Strict Check for Double
                if (rows > 0 && cols > 0 && stats.size === expectedBodyDouble + 16) {
                    isDouble = true;
                    if (fd) { try { fs.closeSync(fd); } catch (e) { } fd = 0; }
                }

                // 2. Try Single Precision Header (8 bytes: Rows(F32), Cols(F32))
                if (!isDouble) {
                    rows = headerBuffer.readFloatLE(0);
                    cols = headerBuffer.readFloatLE(4);

                    const expectedBodyFloat = rows * cols * 4;

                    // Strict Check for Float
                    if (rows > 0 && cols > 0 && stats.size === expectedBodyFloat + 8) {
                        isFloat = true;
                        headerSize = 8;
                        if (fd) { try { fs.closeSync(fd); } catch (e) { } fd = 0; }
                    }
                }

                let srcData: Float64Array;

                if (isDouble || isFloat) {
                    const frameSize = rows * cols;
                    const fullBuf = fs.readFileSync(filePath);
                    const bodyBuf = fullBuf.subarray(headerSize);

                    if (isFloat) {
                        const f32 = new Float32Array(bodyBuf.buffer, bodyBuf.byteOffset, frameSize);
                        srcData = new Float64Array(f32);
                    } else {
                        // Double
                        srcData = new Float64Array(bodyBuf.buffer, bodyBuf.byteOffset, frameSize);
                    }
                } else {
                    if (fd) { try { fs.closeSync(fd); } catch (e) { } }
                    const buffer = fs.readFileSync(filePath);
                    const elemCount = Math.floor(buffer.length / 8);
                    srcData = new Float64Array(buffer.buffer, buffer.byteOffset, elemCount);
                }

                // Copy to output
                const toCopy = Math.min(srcData.length, expectedSize - currentOffset);

                if (toCopy > 0) {
                    for (let i = 0; i < toCopy; i++) {
                        const val = srcData[i];
                        outputMatrix[currentOffset + i] = val;
                        // Update Stitched Stats
                        if (val !== demHeader.noData) {
                            if (val < stitchedMin) stitchedMin = val;
                            if (val > stitchedMax) stitchedMax = val;
                        }
                    }
                    currentOffset += toCopy;
                }
            }

            return outputMatrix;

        } catch (e) {
            Logger.error(`[BinaryParser] Stitch Error: ${e}`);
            return null;
        }
    }

    /**
     * Reads the dimensions from a single binary file header.
     */
    public static async getDimensions(filePath: string): Promise<{ cols: number; rows: number } | null> {
        try {
            if (!fs.existsSync(filePath)) return null;

            const buffer = Buffer.alloc(16);
            const fd = fs.openSync(filePath, 'r');
            const bytes = fs.readSync(fd, buffer as unknown as Uint8Array, 0, 16, 0);
            fs.closeSync(fd);

            if (bytes < 16) return null;

            const rows = buffer.readDoubleLE(0);
            const cols = buffer.readDoubleLE(8);

            // Validate against file size? 
            // Strictly check if possible
            return { cols, rows };
        } catch (e) {
            return null;
        }
    }

    /**
     * Reads headers to summon full dimensions.
     */
    public static getGroupDimensions(files: string[]): { cols: number; rows: number; blockCount: number; totalPixels: number } | null {
        try {
            if (!files || files.length === 0) return null;

            let totalPixels = 0;
            let lastCols = 0;
            let totalRows = 0;

            for (const f of files) {
                if (!fs.existsSync(f)) continue;

                const stats = fs.statSync(f);

                let isHeaderValid = false;
                let rows = 0;
                let cols = 0;

                try {
                    // Read header (16 bytes)
                    const headerBuffer = Buffer.alloc(16);
                    const fd = fs.openSync(f, 'r');
                    const bytesRead = fs.readSync(fd, headerBuffer as unknown as Uint8Array, 0, 16, 0);
                    fs.closeSync(fd);

                    if (bytesRead >= 16) {
                        rows = headerBuffer.readDoubleLE(0);
                        cols = headerBuffer.readDoubleLE(8);

                        // Diagnostic: Trust header if sane
                        if (rows > 0 && cols > 0 && rows < 200000 && cols < 200000) {
                            isHeaderValid = true;
                        }
                    }
                } catch (e) {
                    Logger.error(`[BinaryParser] IO Error: ${e}`);
                    continue;
                }

                if (isHeaderValid) {
                    totalPixels += (rows * cols);
                    lastCols = cols;
                    totalRows += rows;
                } else {
                    // Raw fallback
                    Logger.warn(`[BinaryParser] Falling back to RAW for ${path.basename(f)}`);
                    totalPixels += Math.floor(stats.size / 8);
                }
            }

            if (totalPixels === 0) return null;

            return { cols: lastCols, rows: totalRows, blockCount: files.length, totalPixels };

        } catch (e) {
            return null;
        }
    }
    /**
     * Reads a binary DEM file into a DemData structure.
     * Note: Binary files often lack full georeferencing in the file itself.
     * The header argument is crucial for providing metadata (cellsize, corners).
     * If header is partial, defaults will be used, but georeferencing might be lost.
     */
    public static async read(filePath: string, header: { ncols: number; nrows: number; noData: number; cellsize?: number; xllcorner?: number; yllcorner?: number }): Promise<any> { // Returns DemData-like structure
        const matrix = await BinaryParser.stitchFiles([filePath], {
            lastCols: header.ncols,
            lastRows: header.nrows,
            noData: header.noData
        });

        if (!matrix) throw new Error("Failed to read/stitch binary file.");

        // Convert Float32Array to number[][]
        const rows: number[][] = [];
        for (let r = 0; r < header.nrows; r++) {
            const start = r * header.ncols;
            const end = start + header.ncols;
            rows.push(Array.from(matrix.subarray(start, end)));
        }

        // Calculate simplified stats
        let min = Number.MAX_VALUE;
        let max = -Number.MAX_VALUE;
        // matrix is already the data, just scan it
        for (let i = 0; i < matrix.length; i++) {
            const val = matrix[i];
            if (val !== header.noData) {
                if (val < min) min = val;
                if (val > max) max = val;
            }
        }

        return {
            header: {
                ncols: header.ncols,
                nrows: header.nrows,
                noData: header.noData,
                // Fill in rest if missing, though ideally they are passed in
                cellsize: header.cellsize || 0,
                xllcorner: header.xllcorner || 0,
                yllcorner: header.yllcorner || 0,
                NODATA_value: header.noData // Maintain compatibility
            },
            min,
            max,
            values: rows,
            bounds: null as any // Bounds calculation requires Utils or DemParser logic, optional here?
        };
    }
}
