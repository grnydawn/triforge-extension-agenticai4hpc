import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/Logger';
import { DemData, DemHeader, DemParser } from './DemParser';

export class AsciiParser {

    /**
     * Parses an arbitrary ASCII grid file using an external header for dimensions and georeferencing.
     * Equivalent to InitialInputParser logic.
     */
    public static async parseRawWithHeader(filePath: string, header: DemHeader, utmZone: string, datum: string = 'WGS84'): Promise<DemData> {
        return new Promise((resolve, reject) => {
            fs.readFile(filePath, 'utf8', (err, data) => {
                if (err) return reject(err);

                try {
                    const tokens = data.trim().split(/\s+/);
                    const expectedCount = header.nrows * header.ncols;

                    if (tokens.length < expectedCount) {
                        return reject(new Error(`Insufficient data points in file. Expected ${expectedCount} (rows=${header.nrows} * cols=${header.ncols}), found ${tokens.length}.`));
                    }

                    const values: number[][] = [];
                    let min = Number.MAX_VALUE;
                    let max = -Number.MAX_VALUE;
                    let tokenIdx = 0;

                    for (let r = 0; r < header.nrows; r++) {
                        const row: number[] = [];
                        for (let c = 0; c < header.ncols; c++) {
                            const val = parseFloat(tokens[tokenIdx++]);
                            row.push(val);

                            if (val !== header.NODATA_value) {
                                if (val < min) min = val;
                                if (val > max) max = val;
                            }
                        }
                        values.push(row);
                    }

                    // Calculate bounds
                    const bounds = DemParser.calculateBounds(header, utmZone, 0, 0, datum);

                    resolve({
                        header: header,
                        min,
                        max,
                        values,
                        bounds,
                        utmZone,
                        datum
                    });

                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    /**
     * Parses an ASCII grid file (.asc or .out) into a Float32Array.
     * Supports:
     * 1. ESRI ASCII Grid (with Header)
     * 2. Raw Matrix (No Header, Space-delimited)
     */
    public static async parse(filePath: string, demHeader: { lastCols: number; lastRows: number; noData: number }): Promise<Float32Array | null> {
        return new Promise((resolve) => {
            if (!fs.existsSync(filePath)) {
                resolve(null);
                return;
            }

            // Using fs.readStream might be better for large files, but for simplicity/robustness of parsing 
            // diverse formats, reading lines is easier. Warn if file > 500MB?
            // Use readline interface if possible, or readFileSync for now (simpler sync flow, matching existing codebase style).
            // NOTE: Large ASC files can freeze the extension host if read synchronously.
            // Let's use readFileSync for v1 to match BinaryParser/VrtParser concurrency patterns (which run in async wrapper).

            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                // Split by newline
                const lines = content.split(/\r\n|\n|\r/);

                let nrows = 0;
                let ncols = 0;
                let nodata = -9999;
                let headerLines = 0;
                let isHeaderFound = false;

                // 1. Try to Parse Header (First 6-10 lines)
                // Look for 'ncols' or 'nrows' (case insensitive)
                const headerParams: any = {};

                // Scan first 20 lines for keywords
                for (let i = 0; i < Math.min(lines.length, 20); i++) {
                    const line = lines[i].trim();
                    if (!line) continue;

                    const parts = line.split(/\s+/);
                    if (parts.length >= 2) {
                        const key = parts[0].toLowerCase();
                        const val = parts[1];

                        if (['ncols', 'nrows', 'xllcorner', 'yllcorner', 'xllcenter', 'yllcenter', 'cellsize', 'nodata_value'].includes(key)) {
                            headerParams[key] = parseFloat(val);
                            headerLines = i + 1; // Content starts after this
                            isHeaderFound = true;
                        } else {
                            // Hit non-keyword line, stop header scan if we already found some
                            if (isHeaderFound) break;
                        }
                    }
                }

                if (isHeaderFound && headerParams['ncols'] && headerParams['nrows']) {
                    ncols = headerParams['ncols'];
                    nrows = headerParams['nrows'];
                    if (headerParams['nodata_value'] !== undefined) nodata = headerParams['nodata_value'];
                } else {
                    // Raw Matrix Mode
                    // Infer Dimensions
                    // Cols = tokens in first non-empty line
                    // Rows = number of non-empty lines
                    let firstDataLine = -1;
                    let validLines = 0;

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue;

                        const tokens = line.split(/\s+/);
                        if (firstDataLine === -1) {
                            firstDataLine = i;
                            ncols = tokens.length;
                        } else {
                            // Check consistency? Optional.
                            if (tokens.length !== ncols) {
                                // warning?
                            }
                        }
                        validLines++;
                    }
                    nrows = validLines;
                    headerLines = firstDataLine;
                    isHeaderFound = false; // It's "Raw"
                }

                if (ncols === 0 || nrows === 0) {
                    Logger.error('AsciiParser: Could not determine dimensions.');
                    resolve(null);
                    return;
                }

                // 2. Parse Data
                const expectedSize = demHeader.lastCols * demHeader.lastRows;
                // If dimensions differ from DEM, we might need to resize/resample or just center?
                // For now, assume 1:1 overlap or return raw if dimensions match exactly?
                // The current MapEditor expects `demHeader` dimensions usually, but appendFrame can handle varying sizes?
                // Actually MapEditor.appendFrame takes `frameData` which is Float32Array.
                // It assumes `matrix` matches the DEM grid unless we do the transform here.
                // BinaryParser.ts was stitching into `expectedSize`.
                // VrtParser.ts was warping to `expectedSize`.
                // If this is a raw output file from TRITON, it likely MATCHES the DEM grid exactly (domain decomposition or full grid).

                // Let's allocate output buffer
                const output = new Float32Array(expectedSize).fill(demHeader.noData);

                // Ptr for reading
                let writeIdx = 0;

                // If Header found, start at headerLines. Else start at 0 (or firstDataLine).
                const startLine = isHeaderFound ? headerLines : (headerLines > -1 ? headerLines : 0);

                // Flatten Loop
                let validCount = 0;

                for (let i = startLine; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;

                    const tokens = line.split(/\s+/);
                    for (const token of tokens) {
                        if (writeIdx >= output.length) break;

                        const val = parseFloat(token);

                        // Handle NoData conversion
                        if (isHeaderFound && Math.abs(val - nodata) < 0.0001) {
                            output[writeIdx] = demHeader.noData;
                        } else {
                            output[writeIdx] = val;
                            validCount++;
                        }
                        writeIdx++;
                    }
                }

                resolve(output);

            } catch (e) {
                Logger.error(`AsciiParser Error: ${e}`);
                resolve(null);
            }
        });
    }

    /**
     * Efficiently determines the dimensions (cols, rows) of an ASCII file.
     * Uses the header if available, or counts tokens/lines if raw.
     */
    public static async getDimensions(filePath: string): Promise<{ cols: number; rows: number } | null> {
        return new Promise((resolve) => {
            if (!fs.existsSync(filePath)) {
                resolve(null);
                return;
            }
            try {
                // To be efficient, we might read only the start for header, 
                // but for raw counting we need the whole file or stream.
                // For simplicity v1: read file (same as parse).
                // TODO: optimization - stream read line by line without loading all to mem.

                const content = fs.readFileSync(filePath, 'utf-8');
                const lines = content.split(/\r\n|\n|\r/);

                const headerParams: any = {};
                let isHeaderFound = false;

                // 1. Check Header
                for (let i = 0; i < Math.min(lines.length, 20); i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    const parts = line.split(/\s+/);
                    if (parts.length >= 2) {
                        const key = parts[0].toLowerCase();
                        if (['ncols', 'nrows'].includes(key)) {
                            headerParams[key] = parseFloat(parts[1]);
                            isHeaderFound = true;
                        }
                    }
                }

                if (isHeaderFound && headerParams['ncols'] && headerParams['nrows']) {
                    resolve({ cols: headerParams['ncols'], rows: headerParams['nrows'] });
                    return;
                }

                // 2. Raw Fallback
                let nrows = 0;
                let ncols = 0;
                let firstDataLine = -1;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;

                    if (firstDataLine === -1) {
                        firstDataLine = i;
                        const tokens = line.split(/\s+/);
                        ncols = tokens.length;
                    }
                    nrows++;
                }

                if (ncols > 0 && nrows > 0) {
                    resolve({ cols: ncols, rows: nrows });
                } else {
                    resolve(null);
                }

            } catch (e) {
                Logger.error(`AsciiParser.getDimensions Error: ${e}`);
                resolve(null);
            }
        });
    }

    /**
     * Stitches multiple ASCII or Raw Grid files into a single Float32Array.
     * Follows the logic:
     * 1. Sort files alphanumerically.
     * 2. Read each file as lines of space-delimited numbers.
     * 3. Concatenate into output buffer linearly.
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
            let stitchedMin = Number.MAX_VALUE;
            let stitchedMax = -Number.MAX_VALUE;

            for (const filePath of files) {
                if (!fs.existsSync(filePath)) continue;

                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const lines = content.split(/\r\n|\n|\r/);

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;

                        const tokens = trimmed.split(/\s+/);
                        for (const token of tokens) {
                            if (currentOffset >= expectedSize) break;

                            const val = parseFloat(token);

                            // Check no data from header if header parsing logic isn't reused here
                            // User implied raw values for stitching. "stitching method... same to binary... using number scheme"
                            // If user said "simply nrow lines... splited by space", treat as raw.

                            outputMatrix[currentOffset] = val;

                            if (Math.abs(val - demHeader.noData) > 0.0001) { // Not NoData
                                if (val < stitchedMin) stitchedMin = val;
                                if (val > stitchedMax) stitchedMax = val;
                            }

                            currentOffset++;
                        }
                    }
                } catch (e) {
                    Logger.warn(`[AsciiParser] Failed to read ${path.basename(filePath)}: ${e}`);
                }
            }

            return outputMatrix;

        } catch (e) {
            Logger.error(`[AsciiParser] Stitch Error: ${e}`);
            return null;
        }
    }
}
