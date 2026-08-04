import * as fs from 'fs';
import * as path from 'path';

import * as proj4 from 'proj4';
import { Logger } from '../utils/Logger';

export interface DemHeader {
    ncols: number;
    nrows: number;
    xllcorner: number;
    yllcorner: number;
    cellsize: number;
    NODATA_value: number;
}

export interface DemData {
    header: DemHeader;
    min: number;
    max: number;
    values: number[][]; // Row-major: values[row][col]
    bounds: {
        north: number;
        south: number;
        east: number;
        west: number;
        tl: { lat: number, lng: number };
        tr: { lat: number, lng: number };
        bl: { lat: number, lng: number };
        br: { lat: number, lng: number };
    };
    utmZone?: string;
    datum?: string;
}

export class DemParser {

    public static calculateBounds(header: DemHeader, utmZone: string, shiftX: number = 0, shiftY: number = 0, datum: string = 'WGS84') {
        // Coordinate Conversion (UTM to LatLng)
        const zoneNum = parseInt(utmZone);
        let zoneParams = `+zone=${zoneNum}`;
        if (utmZone.toUpperCase().includes('S')) {
            zoneParams += " +south";
        }

        // Handle Datum selection
        let datumParam = '+datum=WGS84';
        if (datum === 'NAD83') {
            datumParam = '+datum=NAD83';
        }

        const sourceProj = `+proj=utm ${zoneParams} ${datumParam} +units=m +no_defs`;
        const destProj = 'EPSG:4326'; // WGS84

        const p4 = (proj4 as any).default || proj4;

        // Apply shifts (in cell units)
        const xll = header.xllcorner + (shiftX * header.cellsize);
        const yll = header.yllcorner + (shiftY * header.cellsize);

        // Calculate 4 corners in Projected Space (e.g. UTM)
        // Note: yll is Bottom-Left Y.
        // TL: (xll, yll + height)
        // TR: (xll + width, yll + height)
        // BL: (xll, yll)
        // BR: (xll + width, yll)
        const width = header.ncols * header.cellsize;
        const height = header.nrows * header.cellsize;

        const pTL = [xll, yll + height];
        const pTR = [xll + width, yll + height];
        const pBL = [xll, yll];
        const pBR = [xll + width, yll];

        // Reproject to WGS84 (Lng, Lat)
        const tl = p4(sourceProj, destProj, pTL);
        const tr = p4(sourceProj, destProj, pTR);
        const bl = p4(sourceProj, destProj, pBL);
        const br = p4(sourceProj, destProj, pBR);

        if (!(DemParser as any)._lastLogTime || Date.now() - (DemParser as any)._lastLogTime > 5000) {
            Logger.info(`[DemParser] Bounds calculation: ${utmZone} ${datum}`);
            (DemParser as any)._lastLogTime = Date.now();
        }

        return {
            tl: { lat: tl[1], lng: tl[0] },
            tr: { lat: tr[1], lng: tr[0] },
            bl: { lat: bl[1], lng: bl[0] },
            br: { lat: br[1], lng: br[0] },
            south: Math.min(bl[1], br[1]),
            west: Math.min(bl[0], tl[0]),
            north: Math.max(tl[1], tr[1]),
            east: Math.max(tr[0], br[0])
        };
    }

    /**
     * Efficiently calculates bounds from header and PRJ file (if exists).
     */
    public static async getBoundsOnly(filePath: string, defaultZone: string | undefined = '16N'): Promise<any> {
        const header = await DemParser.parseHeaderOnly(filePath);
        const zone = DemParser._detectUtmZoneFromPrj(filePath, defaultZone);
        // Note: calculateBounds returns { tl, tr, bl, br, south, west, north, east } in LatLng
        return DemParser.calculateBounds(header, zone);
    }

    /**
     * Parses only the header of an ASCII DEM file.
     * @param filePath Absolute path to the .dem or .asc file.
     */
    public static async parseHeaderOnly(filePath: string): Promise<DemHeader> {
        return new Promise((resolve, reject) => {
            // Read first 1024 bytes - should be enough for header
            const buffer = Buffer.alloc(1024);
            fs.open(filePath, 'r', (err, fd) => {
                if (err) return reject(err);

                fs.read(fd, buffer as any, 0, 1024, 0, (readErr, bytesRead) => {
                    fs.close(fd, () => { }); // Close file regardless

                    if (readErr) return reject(readErr);

                    const data = buffer.toString('utf8', 0, bytesRead);
                    const lines = data.split(/\r\n|\n|\r/);

                    const header: any = {};

                    const parseHeaderLine = (line: string) => {
                        const parts = line.trim().split(/\s+/);
                        if (parts.length >= 2) {
                            const key = parts[0].toLowerCase();
                            const value = parseFloat(parts[1]);
                            header[key] = value;
                        }
                    };

                    // Try to parse first 6 lines
                    for (let i = 0; i < Math.min(lines.length, 10); i++) {
                        const line = lines[i];
                        if (/^[a-zA-Z]/.test(line)) { // Starts with letter
                            parseHeaderLine(line);
                        }
                    }

                    if (!header.ncols || !header.nrows || !header.cellsize) {
                        return reject(new Error('Missing required header fields'));
                    }

                    const xllVal = header.xllcorner !== undefined ? header.xllcorner : (header.xllcenter !== undefined ? header.xllcenter : 0);
                    const yllVal = header.yllcorner !== undefined ? header.yllcorner : (header.yllcenter !== undefined ? header.yllcenter : 0);

                    // If center, shift by half cell size to get corner
                    const xll = header.xllcenter !== undefined ? xllVal - header.cellsize / 2 : xllVal;
                    const yll = header.yllcenter !== undefined ? yllVal - header.cellsize / 2 : yllVal;

                    resolve({
                        ncols: header.ncols,
                        nrows: header.nrows,
                        cellsize: header.cellsize,
                        xllcorner: xll,
                        yllcorner: yll,
                        NODATA_value: header.nodata_value !== undefined ? header.nodata_value : -9999
                    });
                });
            });
        });
    }

    /**
     * Parses an ASCII DEM file.
     * @param filePath Absolute path to the .dem or .asc file.
     * @param utmZone The UTM zone for coordinate conversion (e.g., "11N").
     * @param datum The Datum to use (e.g. 'WGS84', 'NAD83'). Defaults to 'WGS84'.
     */
    public static async parse(filePath: string, utmZone: string, datum: string = 'WGS84'): Promise<DemData> {
        return new Promise((resolve, reject) => {
            fs.readFile(filePath, 'utf8', (err, data) => {
                if (err) {
                    return reject(err);
                }

                try {
                    const lines = data.trim().split(/\r\n|\n|\r/);
                    if (lines.length < 7) {
                        return reject(new Error('File too short to be a valid DEM'));
                    }

                    // Parse Header
                    const header: any = {};
                    let lineIndex = 0;

                    // Helper to parse header lines
                    const parseHeaderLine = (line: string) => {
                        const parts = line.trim().split(/\s+/);
                        if (parts.length >= 2) {
                            const key = parts[0].toLowerCase();
                            const value = parseFloat(parts[1]);
                            header[key] = value;
                        }
                    };

                    // Read first 6 lines
                    for (; lineIndex < 6; lineIndex++) {
                        parseHeaderLine(lines[lineIndex]);
                    }

                    // Validate header
                    if (!header.ncols || !header.nrows || !header.cellsize) {
                        return reject(new Error('Missing required header fields (ncols, nrows, cellsize)'));
                    }
                    // Handle xllcorner/yllcorner variations (sometimes xllcenter)
                    const xllVal = header.xllcorner !== undefined ? header.xllcorner : (header.xllcenter !== undefined ? header.xllcenter : 0);
                    const yllVal = header.yllcorner !== undefined ? header.yllcorner : (header.yllcenter !== undefined ? header.yllcenter : 0);

                    // If center, shift by half cell size to get corner
                    const xll = header.xllcenter !== undefined ? xllVal - header.cellsize / 2 : xllVal;
                    const yll = header.yllcenter !== undefined ? yllVal - header.cellsize / 2 : yllVal;

                    // Standardize header for internal use
                    const stdHeader: DemHeader = {
                        ncols: header.ncols,
                        nrows: header.nrows,
                        cellsize: header.cellsize,
                        xllcorner: xll,
                        yllcorner: yll,
                        NODATA_value: header.nodata_value !== undefined ? header.nodata_value : -9999
                    };

                    const ncols = stdHeader.ncols;
                    const noData = stdHeader.NODATA_value;

                    // Parse Data
                    const values: number[][] = [];
                    let min = Number.MAX_VALUE;
                    let max = -Number.MAX_VALUE;

                    for (; lineIndex < lines.length; lineIndex++) {
                        const line = lines[lineIndex].trim();
                        if (!line) continue;

                        const rowValues = line.split(/\s+/).map(v => parseFloat(v));

                        // If the line contains all columns
                        if (rowValues.length === ncols) {
                            values.push(rowValues);
                        } else {
                            // Warn or handle? For now assuming specific format.
                        }

                        // Calculate stats
                        for (const val of rowValues) {
                            if (val !== noData) {
                                if (val < min) min = val;
                                if (val > max) max = val;
                            }
                        }
                    }

                    // Attempt to detect UTM Zone from .prj file if not provided/default
                    const currentZone = DemParser._detectUtmZoneFromPrj(filePath, utmZone);

                    // Calculate bounds
                    const bounds = DemParser.calculateBounds(stdHeader, currentZone, 0, 0, datum);

                    Logger.info(`[DemParser] Parsed DEM: min=${min}, max=${max}, noData=${noData}, vals=${values.length}x${values[0]?.length}`);
                    resolve({
                        header: stdHeader,
                        min,
                        max,
                        values,
                        bounds,
                        utmZone: currentZone,
                        datum: datum
                    });

                } catch (parseErr) {
                    reject(parseErr);
                }
            });
        });
    }

    public static async save(filePath: string, data: DemData): Promise<void> {
        return new Promise((resolve, reject) => {
            const header = data.header;
            const content = [
                `ncols         ${header.ncols}`,
                `nrows         ${header.nrows}`,
                `xllcorner     ${header.xllcorner.toFixed(4)}`,
                `yllcorner     ${header.yllcorner.toFixed(4)}`, // Using corner as per TRITON standard
                `cellsize      ${header.cellsize}`,
                `NODATA_value  ${header.NODATA_value}`
            ];

            const stream = fs.createWriteStream(filePath);

            stream.on('error', (err) => reject(err));
            stream.on('finish', () => resolve());

            // Write Header
            stream.write(content.join('\n') + '\n');

            // Write Data Row by Row
            // DemData values are row-major: values[row][col]
            for (let r = 0; r < header.nrows; r++) {
                const row = data.values[r];
                // Check if row exists, otherwise fill NoData
                if (!row) {
                    stream.write(Array(header.ncols).fill(header.NODATA_value).join(' ') + '\n');
                    continue;
                }

                // Join is faster than repeated writes? For large files, maybe. 
                // But extremely large strings can crash V8. 
                // Let's write chunks or smaller lines. 
                // A row of 4000 cols * 10 chars = 40KB, safe.
                stream.write(row.join(' ') + '\n');
            }

            stream.end();
        });
    }

    public static _detectUtmZoneFromPrj(filePath: string, defaultZone: string): string {
        let currentZone = defaultZone;

        const ext = path.extname(filePath);
        const prjPath = filePath.substring(0, filePath.length - ext.length) + '.prj';

        if (fs.existsSync(prjPath)) {
            try {
                const prjContent = fs.readFileSync(prjPath, 'utf8');
                // Simple heuristic to extract zone from WKT
                // Look for "ZONE", 11] or "UTM zone 11N"
                // Example WKT: PROJCS["NAD_1983_UTM_Zone_11N",GEOGCS[...],PROJECTION["Transverse_Mercator"],PARAMETER["central_meridian",-117.0],...]

                const zoneMatch = prjContent.match(/Zone_(\d+)([NS])/i);
                if (zoneMatch) {
                    currentZone = zoneMatch[1] + zoneMatch[2].toUpperCase();
                } else {
                    // Try extracting Central Meridian to guess zone?
                    // CM = -117 -> Zone 11. Zone = floor((lon + 180) / 6) + 1
                    const cmMatch = prjContent.match(/PARAMETER\["central_meridian",\s*(-?\d+(\.\d+)?)/);
                    if (cmMatch) {
                        const cm = parseFloat(cmMatch[1]);
                        const calcZone = Math.floor((cm + 180) / 6) + 1;
                        currentZone = calcZone + 'N'; // Assume N by default if not specified, user can fix
                    }
                }
            } catch (e) {
                // Ignore prj errors
            }
        }
        return currentZone;
    }
}
