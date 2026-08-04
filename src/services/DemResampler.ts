import * as proj4 from 'proj4';
import { DemData, DemHeader, DemParser } from '../parsers/DemParser';


import { Logger } from '../utils/Logger';

export class DemResampler {

    /**
     * Resamples a Source DEM (e.g. WGS84) to a Target Grid (UTM) using Bilinear Interpolation.
     */
    public static async resample(
        source: DemData,
        targetHeader: DemHeader,
        targetUtmZone: string,
        targetDatum: string = 'WGS84'
    ): Promise<DemData> {

        // 1. Setup Projections
        // Target is UTM
        const zoneNum = parseInt(targetUtmZone);
        let zoneParams = `+zone=${zoneNum}`;
        if (targetUtmZone.toUpperCase().includes('S')) zoneParams += " +south";

        let datumParam = '+datum=WGS84';
        if (targetDatum === 'NAD83') datumParam = '+datum=NAD83';

        // Source is typically WGS84 (Lat/Lon) from OpenTopography AAIGrid
        // But we should verify. The OpenTopography output is generally EPSG:4326.
        const sourceProj = 'EPSG:4326';
        const targetProj = `+proj=utm ${zoneParams} ${datumParam} +units=m +no_defs`;

        const p4 = (proj4 as any).default || proj4;
        const transformToSource = p4(targetProj, sourceProj); // Forward: UTM -> LonLat

        // 2. Prepare Source Data properties for fast access
        const srcCols = source.header.ncols;
        const srcRows = source.header.nrows;
        const srcNoData = source.header.NODATA_value;
        const srcCellSize = source.header.cellsize;

        // Source standard corner (OpenTopology returns xllcorner/yllcorner usually)
        // If xllcenter is used, we adjusted in DemParser. 
        // DemParser ensures xllcorner/yllcorner are set.
        const srcXll = source.header.xllcorner;
        const srcYll = source.header.yllcorner; // Bottom-Left Y

        // 3. Initialize Target
        const tgtCols = targetHeader.ncols;
        const tgtRows = targetHeader.nrows;
        const tgtNoData = targetHeader.NODATA_value;
        const tgtCellSize = targetHeader.cellsize;
        const tgtXll = targetHeader.xllcorner;
        const tgtYll = targetHeader.yllcorner;

        Logger.info(`[DemResampler] Source Grid: ${srcCols}x${srcRows} @ [${srcXll}, ${srcYll}], Cell=${srcCellSize}`);
        Logger.info(`[DemResampler] Target Grid: ${tgtCols}x${tgtRows} @ [${tgtXll}, ${tgtYll}], Cell=${tgtCellSize}`);

        const targetValues: number[][] = new Array(tgtRows);

        let min = Number.MAX_VALUE;
        let max = -Number.MAX_VALUE;
        let validCount = 0;


        // Loop Rows
        for (let r = 0; r < tgtRows; r++) {
            const rowData = new Float32Array(tgtCols); // Using TypedArray for internal row

            // Calculate UTM Y for this row (center of cell)
            // Y = Top - (r * cs) - (cs/2) ?? 
            // Standard: y = yll + (nrows - 1 - r) * cellsize + cellsize/2
            const utmY = tgtYll + ((tgtRows - 1 - r) * tgtCellSize) + (tgtCellSize / 2);

            for (let c = 0; c < tgtCols; c++) {
                // Calculate UTM X for this col (center)
                const utmX = tgtXll + (c * tgtCellSize) + (tgtCellSize / 2);

                // Convert to Source Coords (Lon, Lat)
                const [lon, lat] = transformToSource.forward([utmX, utmY]);

                // Map Lon/Lat to Source Grid Indices (Float)
                // Col = (lon - xll) / cellsize
                // Row? 
                // Source Y (Lat) = srcYll + (srcRows - 1 - srcRowIndex) * srcCellSize + srcCellSize/2
                // => (Lat - srcYll - srcCellSize/2) / srcCellSize = srcRows - 1 - srcRowIndex
                // => srcRowIndex = srcRows - 1 - ((Lat - srcYll - srcCellSize/2) / srcCellSize)
                // Let's verify standard grid:
                // Lat = Yll + i*cs (if i is 0 at bottom). 
                // But row index 0 is Top.
                // gridY (from bottom) = (Lat - srcYll) / srcCellSize
                // row = srcRows - 1 - floor(gridY) (roughly)

                // Note: v is 0 at Top Center? 
                // Lat of Top Edge = srcYll + srcRows * cs
                // Row 0 Center Lat = Top Edge - 0.5 * cs
                // If lat == Row 0 Center, then:
                // v_from_bottom = (srcYll + srcRows*cs - 0.5*cs - srcYll) / cs = srcRows - 0.5
                // v = srcRows - 1 - (srcRows - 0.5) = -0.5 ??
                const srcTopY = srcYll + (srcRows * srcCellSize);
                const colFloat = (lon - srcXll) / srcCellSize;
                const rowFloat = (srcTopY - lat) / srcCellSize;

                // Bilinear Interpolation
                // Center of top-left pixel (0,0) is at (0.5, 0.5) in pixel coordinates
                const u_shift = colFloat - 0.5;
                const v_shift = rowFloat - 0.5;

                const c0 = Math.floor(u_shift);
                const c1 = c0 + 1;
                const r0 = Math.floor(v_shift);
                const r1 = r0 + 1;

                // Helper to get value with Edge Clamping (Nearest Neighbor at boundary)
                const getVal = (r: number, c: number) => {
                    if (r < 0) r = 0;
                    if (r >= srcRows) r = srcRows - 1;
                    if (c < 0) c = 0;
                    if (c >= srcCols) c = srcCols - 1;
                    return source.values[r][c];
                };

                // Check for gross out-of-bounds (e.g. outside the map entirely)
                // Relaxed: Allow 0.5 pixel margin? 
                // Strict: If c0 < -1 or c0 >= srcCols ??
                // Let's rely on coordinate coverage. If it's way off, it's NoData.
                if (u_shift < -1 || u_shift > srcCols || v_shift < -1 || v_shift > srcRows) {
                    rowData[c] = tgtNoData;
                    continue;
                }

                const v00 = getVal(r0, c0);
                const v01 = getVal(r0, c1);
                const v10 = getVal(r1, c0);
                const v11 = getVal(r1, c1);

                // If any surrounding pixel is NoData, result is NoData?
                // Or try to salvage? Standard is strict.
                if (v00 === srcNoData || v01 === srcNoData || v10 === srcNoData || v11 === srcNoData) {
                    rowData[c] = tgtNoData;
                    continue;
                }

                // Bilinear weights
                // u_shift might be e.g. 0.1 -> c0=0. wx = 0.1
                const wx = u_shift - c0;
                const wy = v_shift - r0;

                // Interpolate
                const val =
                    (1 - wx) * (1 - wy) * v00 +
                    wx * (1 - wy) * v01 +
                    (1 - wx) * wy * v10 +
                    wx * wy * v11;

                rowData[c] = val;

                // Update Min/Max
                if (val !== tgtNoData) {
                    if (val < min) min = val;
                    if (val > max) max = val;
                    validCount++;

                    if (validCount <= 1) {
                        Logger.info(`[DemResampler] First Hit: Row=${r}, Col=${c} -> Val=${val} (Src indices: ${u_shift.toFixed(2)}, ${v_shift.toFixed(2)})`);
                    }
                }
            }
            targetValues[r] = Array.from(rowData);
        }



        Logger.info(`[DemResampler] Resampling Complete. Valid Pixels: ${validCount} / ${tgtRows * tgtCols}. Min=${min}, Max=${max}`);

        // If no target cell sampled a valid source pixel, the source and target
        // footprints do not overlap (wrong UTM zone/bounds). Returning a flat
        // NODATA grid here would masquerade as real elevation data, so reject.
        if (validCount === 0) {
            throw new Error(
                '[DemResampler] No valid overlap between source DEM and target grid — check UTM zone/bounds.'
            );
        }

        return {
            header: targetHeader,
            min: min === Number.MAX_VALUE ? 0 : min,
            max: max === -Number.MAX_VALUE ? 0 : max,
            values: targetValues,
            // Re-calculate bounds for the Target to ensure consistency
            bounds: DemParser.calculateBounds(targetHeader, targetUtmZone, 0, 0, targetDatum),
            utmZone: targetUtmZone,
            datum: targetDatum
        };
    }
}
