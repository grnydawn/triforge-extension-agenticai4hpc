import * as path from 'path';
import * as geotiff from 'geotiff';
import { DemParser, DemData, DemHeader } from './DemParser';
import { BinaryParser } from './BinaryParser';
import { FileTypeDetector } from '../utils/FileTypeDetector';

export class DemManager {

    /**
     * Loads a DEM file (ASCII or Binary) into a DemData structure.
     * For Binary files, a header is required to interpret dimensions/cellsize.
     */
    public static async load(filePath: string, header?: DemHeader & { utmZone?: string; datum?: string }): Promise<DemData> {
        const type = FileTypeDetector.detect(filePath);

        if (type === 'ascii') {
            // SVC-1: thread the DETECTED UTM zone (and datum) through instead of
            // hardcoding '16N'. A caller that already detected a zone conveys it on
            // the header; DemParser.parse still prefers a .prj sidecar when present
            // and otherwise uses this value as the default, falling back to '16N'
            // only when the zone is genuinely unknown.
            const defaultZone = header?.utmZone ?? '16N';
            const datum = header?.datum ?? 'WGS84';
            return await DemParser.parse(filePath, defaultZone, datum);
        } else if (type === 'binary') {
            if (!header) {
                // Try to read dimensions from binary header
                const dims = await BinaryParser.getDimensions(filePath);
                if (!dims) throw new Error("Cannot determine dimensions of binary file and no header provided.");
                header = {
                    ncols: dims.cols,
                    nrows: dims.rows,
                    cellsize: 0,
                    xllcorner: 0,
                    yllcorner: 0,
                    NODATA_value: -9999
                };
            }
            // Use BinaryParser.read (which we are adding)
            return await BinaryParser.read(filePath, {
                ncols: header.ncols,
                nrows: header.nrows,
                noData: header.NODATA_value,
                cellsize: header.cellsize,
                xllcorner: header.xllcorner,
                yllcorner: header.yllcorner
            });
        } else if (type === 'geotiff') {
            // BUG-8: a generated GeoTIFF DEM (generated_dem_*.tif) must load and
            // render instead of throwing. Mirror VrtParser's geotiff.fromFile read.
            return await DemManager._loadGeotiff(filePath, header);
        } else {
            throw new Error(`Cannot load DEM — unrecognized format for file: ${filePath}`);
        }
    }

    /**
     * BUG-8: load a single-band GeoTIFF DEM into a DemData structure using the
     * `geotiff` dependency (same approach as VrtParser.fromFile). The raster's own
     * ModelPixelScale / ModelTiepoint give cellsize + the lower-left corner; its
     * GDAL NoData (falling back to a header / -9999) drives min/max masking.
     */
    private static async _loadGeotiff(filePath: string, header?: DemHeader & { utmZone?: string; datum?: string }): Promise<DemData> {
        const tiff = await geotiff.fromFile(filePath);
        const image = await tiff.getImage();

        const ncols = image.getWidth();
        const nrows = image.getHeight();

        // Origin is the TOP-left corner; resolution[1] (resY) is typically
        // negative (north-up), so the lower-left Y is origin + nrows * resY.
        const [originX, originY] = image.getOrigin();
        const [resX, resY] = image.getResolution();
        const cellsize = header?.cellsize ?? Math.abs(resX);
        const xllcorner = header?.xllcorner ?? originX;
        const yllcorner = header?.yllcorner ?? (originY + nrows * resY);

        const gdalNoData = image.getGDALNoData();
        const noData = header?.NODATA_value ?? (gdalNoData ?? -9999);

        const rasters = await image.readRasters({ interleave: false });
        const band = (Array.isArray(rasters) ? rasters[0] : rasters) as ArrayLike<number>;

        const values: number[][] = [];
        let min = Number.MAX_VALUE;
        let max = -Number.MAX_VALUE;
        for (let r = 0; r < nrows; r++) {
            const row: number[] = new Array(ncols);
            const rowStart = r * ncols;
            for (let c = 0; c < ncols; c++) {
                const v = Number(band[rowStart + c]);
                row[c] = v;
                if (Number.isFinite(v) && Math.abs(v - noData) > 0.0001) {
                    if (v < min) min = v;
                    if (v > max) max = v;
                }
            }
            values.push(row);
        }
        if (min === Number.MAX_VALUE) min = 0;
        if (max === -Number.MAX_VALUE) max = 0;

        const fullHeader: DemHeader = {
            ncols,
            nrows,
            xllcorner,
            yllcorner,
            cellsize,
            NODATA_value: noData
        };

        // SVC-1: honor a detected zone/datum conveyed on the header; fall back to
        // the same default the ASCII branch uses so bounds can still be computed.
        const zone = header?.utmZone ?? '16N';
        const datum = header?.datum ?? 'WGS84';
        const bounds = DemParser.calculateBounds(fullHeader, zone, 0, 0, datum);

        return {
            header: fullHeader,
            min,
            max,
            values,
            bounds,
            utmZone: zone,
            datum
        };
    }

    /**
     * Saves DemData to a file, format determined by extension (.bin or .asc/.dem).
     */
    public static async save(filePath: string, data: DemData): Promise<void> {
        const ext = path.extname(filePath).toLowerCase();

        if (ext === '.bin') {
            const h = data.header;
            // Adapt to BinaryParser structure
            await BinaryParser.save(filePath, {
                header: { ncols: h.ncols, nrows: h.nrows, noData: h.NODATA_value },
                values: data.values
            });
        } else {
            // Assume ASCII
            await DemParser.save(filePath, data);
        }
    }

    /**
     * Converts a DEM file from one format to another (or same).
     */
    public static async convert(sourcePath: string, targetPath: string, header?: DemHeader & { utmZone?: string; datum?: string }): Promise<void> {
        const data = await DemManager.load(sourcePath, header);
        await DemManager.save(targetPath, data);
    }
}
