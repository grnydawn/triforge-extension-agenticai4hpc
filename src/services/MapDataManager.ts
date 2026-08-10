import * as fs from 'fs';
import * as path from 'path';
import { DemParser, DemData, DemHeader } from '../parsers/DemParser';

export class MapDataManager {
    constructor() { }

    public async loadDem(demInputPath: string, zone: string, overrideDatum: string = 'WGS84', projectHeader?: DemHeader): Promise<DemData | null> {
        if (!fs.existsSync(demInputPath)) {
            throw new Error(`DEM path not found: ${demInputPath}`);
        }

        let fullPath = demInputPath;
        const stats = await fs.promises.stat(demInputPath);

        if (stats.isDirectory()) {
            const files = await fs.promises.readdir(demInputPath);
            // BUG-8: a fetched GeoTIFF DEM (generated_dem_*.tif) must not be silently
            // skipped, so .tif/.tiff are scanned alongside .dem/.asc.
            const demFile = files.find(f => {
                const lower = f.toLowerCase();
                return lower.endsWith('.dem') || lower.endsWith('.asc') ||
                    lower.endsWith('.tif') || lower.endsWith('.tiff');
            });
            if (!demFile) {
                console.error(`[MapDataManager] No .dem/.asc/.tif DEM file found in ${demInputPath}`);
                return null;
            }
            fullPath = path.join(demInputPath, demFile);
            console.log(`[MapDataManager] Found DEM file: ${fullPath}`);
        } else {
            console.log(`[MapDataManager] Using provided file path: ${fullPath}`);
        }

        // Detect Type
        const { FileTypeDetector } = await import('../utils/FileTypeDetector');
        const type = FileTypeDetector.detect(fullPath);

        if (type === 'geotiff') {
            // BUG-8: a generated GeoTIFF DEM is loaded via DemManager's geotiff
            // branch (geotiff dep) and georeferenced with the project header/zone.
            const { DemManager } = await import('../parsers/DemManager');
            const data = await DemManager.load(fullPath, projectHeader);
            return {
                ...data,
                bounds: DemParser.calculateBounds(data.header, zone, 0, 0, overrideDatum),
                utmZone: zone,
                datum: overrideDatum
            };
        } else if (type === 'binary') {
            const { BinaryParser } = await import('../parsers/BinaryParser');
            const dims = await BinaryParser.getDimensions(fullPath);
            if (!dims) {
                // Assuming Logger is available or needs to be imported/defined
                // For now, using console.error
                console.error(`[MapDataManager] Failed to read dimensions from binary: ${fullPath}`);
                throw new Error("Failed to read dimensions from Binary DEM header.");
            }

            // Read matrix
            // Use stitchFiles logic to read single file content
            const matrix = await BinaryParser.stitchFiles([fullPath], { lastCols: dims.cols, lastRows: dims.rows, noData: -9999 });

            if (!matrix) throw new Error("Failed to read binary DEM data.");

            // Convert F32Array to number[][]
            const values: number[][] = [];
            for (let r = 0; r < dims.rows; r++) {
                const start = r * dims.cols;
                const end = start + dims.cols;
                values.push(Array.from(matrix.subarray(start, end)));
            }

            // Calculate stats
            let min = Number.MAX_VALUE;
            let max = -Number.MAX_VALUE;
            const noData = -9999;
            for (let i = 0; i < matrix.length; i++) {
                const v = matrix[i];
                if (Math.abs(v - noData) > 0.0001) {
                    if (v < min) min = v;
                    if (v > max) max = v;
                }
            }
            if (min === Number.MAX_VALUE) min = 0;
            if (max === -Number.MAX_VALUE) max = 0;

            // Combine binary dims with project header for georeferencing if available
            const header: DemHeader = {
                ncols: dims.cols,
                nrows: dims.rows,
                cellsize: projectHeader?.cellsize || 1,
                xllcorner: projectHeader?.xllcorner || 0,
                yllcorner: projectHeader?.yllcorner || 0,
                NODATA_value: noData
            };

            // Re-use DemParser.calculateBounds helper
            // Note: calculateBounds(header, zone, shiftX, shiftY, datum)
            // It expects a full DemHeader.
            const bounds = DemParser.calculateBounds(header, zone, 0, 0, overrideDatum);

            return {
                header: header,
                min,
                max,
                values,
                bounds: bounds,
                utmZone: zone,
                datum: overrideDatum
            };

        } else {
            // We can't know the zone here if it's not provided, unless we parse first.
            // But DemParser needs zone?
            // Wait, MapEditor was passing `this._currentDemData.utmZone` if cached. 
            // Here we don't have cache.
            // We will return the parsed data, and let the caller handle caching/zone persistence if needed.
            // But DemParser.parse REQUIRES a zone if it's NOT in the header (which usually isn't for .asc?)

            // Actually DemParser.parse signature: parse(filePath: string, zone: string, datum: string)
            // If zone is undefined, what happens? 
            // Let's assume caller provides default '16N' if unknown.

            return await DemParser.parse(fullPath, zone, overrideDatum);
        }
    }
}
