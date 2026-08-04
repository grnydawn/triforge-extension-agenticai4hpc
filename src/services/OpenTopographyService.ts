import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
// Robust proj4 import handling
 
const proj4 = require('proj4').default || require('proj4');
import { Logger } from '../utils/Logger';

export class OpenTopographyService {

    /**
     * Downloads a DEM from OpenTopography based on UTM bounds.
     * 
     * @param apiKey OpenTopography API Key
     * @param demType Dataset identifier (e.g., 'SRTMGL1', 'COP30', etc. - mapped from UI values)
     * @param header UTM Header (ncols, nrows, xll, yll, cellsize)
     * @param utmZone UTM Zone (e.g., '16N')
     * @param datum Datum (e.g., 'WGS84', 'NAD83')
     * @param outputDir Directory to save the downloaded file
     * @returns Promise resolving to the full path of the downloaded file
     */
    // Abort a stalled connection after this many ms of inactivity (BUG-7).
    private static readonly REQUEST_TIMEOUT_MS = 60000;
    // Follow at most this many redirects to avoid loops (BUG-7).
    private static readonly MAX_REDIRECTS = 5;

    public static async downloadDem(
        apiKey: string,
        demTypeSource: string, // Value from UI dropdown
        header: any,
        utmZone: string,
        datum: string,
        outputDir: string,
        onCancel?: (abort: () => void) => void
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                // 1. Map UI Source to OpenTopography dataset ID
                // See: https://portal.opentopography.org/apidocs/
                let demType = 'SRTMGL3'; // Default 90m
                switch (demTypeSource) {
                    case 'USGS_3DEP':
                        // USGS 3DEP 10m is often requested via other means, but for global/public via OT, 
                        // "USGS30m" (SRTMGL1_E) or similar might be best if available.
                        // OT API often uses: SRTMGL1 (30m), SRTMGL3 (90m), AW3D30, COP30, COP90, NASADEM
                        // Let's use SRTMGL1 (30m) as a safe high-res default if USGS isn't strictly distinct in OT Global API key usage without specialized dataset IDs.
                        // Actually, checking docs: USGS 3DEP is avail via separate endpoint often, but Global API covers:
                        // SRTMGL3, SRTMGL1, SRTMGL1_E, AW3D30, AW3D30_E, SRTM15Plus, NASADEM, COP30, COP90, EU_DTM, GEDI_L3, GEBCOIceTopo, GEBCOSubIceTopo
                        // Let's map "USGS_3DEP" to SRTMGL1 (approx 30m) for now as a fallback, or maybe NASADEM.
                        // Or better, let's map 'OpenTopography' option to 'SRTMGL1' (30m) and 'AWS_Terrain' to 'COP30'.
                        // Wait, the UI has: USGS_3DEP, OpenTopography, AWS_Terrain.
                        // The user asked for "Get DEM from OpenTopography".
                        // If user selected USGS_3DEP, we probably shouldn't use OT API unless OT hosts it (it does host 3DEP but often as local datasets, not global API).
                        // However, the prompt implies using OT API for *the* selected source or just when OT is selected.
                        // The UI only shows the API Key input when "OpenTopography" is selected.
                        // So we only support the "OpenTopography" option effectively.
                        demType = 'SRTMGL1'; // 30m
                        break;
                    case 'OpenTopography':
                        demType = 'SRTMGL1'; // Defaulting to SRTM 30m
                        break;
                    case 'AWS_Terrain':
                        demType = 'COP30'; // Copernicus 30m is a good alternative
                        break;
                    default:
                        demType = 'SRTMGL1';
                }

                // 2. Calculate Bounds in Lat/Lon
                const bounds = this.calculateLatLonBounds(header, utmZone, datum);

                // 3. Construct URL
                // Example: https://portal.opentopography.org/API/globaldem?demtype=SRTMGL3&south=50&north=50.1&west=14.35&east=14.6&outputFormat=AAIGrid&API_Key=...
                const baseUrl = 'https://portal.opentopography.org/API/globaldem';
                // SEC-2: OpenTopography's REST API requires the key in the query
                // string, so the key is unavoidably part of `url`. NEVER log `url`
                // (or `apiKey`) — only the dataset + bounds, which carry no secret.
                const url = `${baseUrl}?demtype=${demType}&south=${bounds.south}&north=${bounds.north}&west=${bounds.west}&east=${bounds.east}&outputFormat=AAIGrid&API_Key=${apiKey}`;

                Logger.info(`[OpenTopography] Requesting DEM: ${demType} bounds=[${bounds.west}, ${bounds.south}, ${bounds.east}, ${bounds.north}]`);

                // 4. Download
                // OpenTopography AAIGrid often comes as a compressed file or direct text?
                // Global DEM API usually returns the requested format directly if small, or maybe compressed.
                // However, standard browser download from OT often gives a .tar.gz.
                // But the API documentation says "outputFormat".
                // Let's assume it returns the file directly or we might need to handle unzip if it turns out to be zipped.
                // For now, save as .dem (which is essentially what AAIGrid is).
                const fileName = `temp_dem_${Date.now()}.dem`;
                const filePath = path.join(outputDir, fileName);

                // Track the in-flight request so it can be aborted on
                // cancel/timeout (BUG-7); supports redirect re-issue.
                let activeRequest: import('http').ClientRequest | undefined;
                let aborted = false;

                const abort = () => {
                    if (aborted) { return; }
                    aborted = true;
                    if (activeRequest) {
                        activeRequest.destroy();
                    }
                    fs.unlink(filePath, () => { });
                };
                // Allow the caller (cancellable progress) to abort the download.
                if (onCancel) {
                    onCancel(abort);
                }

                const performRequest = (requestUrl: string, redirectsLeft: number) => {
                    if (aborted) { return; }

                    const request = https.get(requestUrl, (response) => {
                        const status = response.statusCode ?? 0;

                        // BUG-7: follow 301/302/307/308 redirects (re-request Location).
                        if (
                            [301, 302, 307, 308].includes(status) &&
                            response.headers.location
                        ) {
                            response.resume(); // drain
                            if (redirectsLeft <= 0) {
                                reject(new Error('API Request Failed: too many redirects'));
                                return;
                            }
                            const nextUrl = new URL(response.headers.location, requestUrl).toString();
                            Logger.info(`[OpenTopography] Following redirect (${status})`);
                            performRequest(nextUrl, redirectsLeft - 1);
                            return;
                        }

                        // BUG-7: any non-200 is an error (not just !== 200 success branch).
                        if (status !== 200) {
                            let rawData = '';
                            response.on('data', (chunk) => { rawData += chunk; });
                            response.on('end', () => {
                                Logger.error(`[OpenTopography] API Error: ${status} - ${rawData}`);
                                reject(new Error(`API Request Failed (${status}): ${rawData.substring(0, 200)}...`));
                            });
                            return;
                        }

                        // BUG-7: a 200 HTML/quota page must NOT be saved as a DEM.
                        // Sniff the content-type and the first bytes (an ESRI AAIGrid
                        // starts with `ncols`/`nrows`) before accepting the body.
                        const contentType = (response.headers['content-type'] || '').toLowerCase();
                        const looksLikeHtml =
                            contentType.includes('text/html') ||
                            contentType.includes('application/json') ||
                            contentType.includes('application/xml');

                        let sniffBuffer = '';
                        let sniffed = false;
                        let validGrid = false;
                        const file = fs.createWriteStream(filePath);

                        file.on('error', (err) => {
                            Logger.error(`[OpenTopography] File write error: ${err.message}`);
                            fs.unlink(filePath, () => { });
                            reject(err);
                        });

                        const rejectNonGrid = (reason: string) => {
                            response.destroy();
                            file.destroy();
                            fs.unlink(filePath, () => { });
                            Logger.error(`[OpenTopography] Rejected non-DEM 200 response: ${reason}`);
                            reject(new Error(`OpenTopography returned a non-DEM response (${reason}). ` +
                                'This usually means an invalid API key or an exceeded quota.'));
                        };

                        response.on('data', (chunk: Buffer) => {
                            if (!sniffed) {
                                sniffBuffer += chunk.toString('latin1', 0, Math.min(chunk.length, 64));
                                if (sniffBuffer.length >= 16 || looksLikeHtml) {
                                    sniffed = true;
                                    const head = sniffBuffer.replace(/^\uFEFF/, '').trimStart().toLowerCase();
                                    validGrid = head.startsWith('ncols') || head.startsWith('nrows');
                                    if (looksLikeHtml || !validGrid) {
                                        rejectNonGrid(looksLikeHtml ? `content-type ${contentType}` : 'first bytes are not an AAIGrid header (ncols/nrows)');
                                        return;
                                    }
                                }
                            }
                        });

                        response.pipe(file);

                        // BUG-7: resolve inside 'close' (after fd flush), not 'finish'.
                        file.on('close', () => {
                            if (aborted || !sniffed || !validGrid) {
                                return;
                            }
                            Logger.info(`[OpenTopography] Download complete: ${filePath}`);
                            resolve(filePath);
                        });
                    });

                    activeRequest = request;

                    // BUG-7: a stalled endpoint must not hang forever.
                    request.setTimeout(OpenTopographyService.REQUEST_TIMEOUT_MS, () => {
                        Logger.error('[OpenTopography] Request timed out');
                        request.destroy();
                        fs.unlink(filePath, () => { });
                        reject(new Error(`OpenTopography request timed out after ${OpenTopographyService.REQUEST_TIMEOUT_MS}ms`));
                    });

                    request.on('error', (err) => {
                        fs.unlink(filePath, () => { });
                        if (aborted) {
                            Logger.info('[OpenTopography] Download cancelled');
                            reject(new Error('DEM download cancelled'));
                            return;
                        }
                        Logger.error(`[OpenTopography] Network Error: ${err.message}`);
                        reject(err);
                    });
                };

                performRequest(url, OpenTopographyService.MAX_REDIRECTS);

            } catch (err) {
                Logger.error(`[OpenTopography] Error: ${err}`);
                reject(err);
            }
        });
    }

    private static calculateLatLonBounds(header: any, utmZone: string, datum: string) {
        // Parse Header
        const xll = parseFloat(header.xllcorner);
        const yll = parseFloat(header.yllcorner);
        const cellsize = parseFloat(header.cellsize);
        const ncols = parseInt(header.ncols);
        const nrows = parseInt(header.nrows);

        const xur = xll + (ncols * cellsize);
        const yur = yll + (nrows * cellsize);

        // Define Projections
        // WGS84
        const wgs84 = 'EPSG:4326';

        // Construct UTM Projection String
        // Format: "+proj=utm +zone=16 +datum=WGS84 +units=m +no_defs"
        // Handle "16N", "16S"
        const zoneNum = parseInt(utmZone); // extracts number
        const isSouth = utmZone.toUpperCase().endsWith('S');

        let utmProj = `+proj=utm +zone=${zoneNum} +units=m +no_defs`;

        if (datum === 'NAD83') {
            utmProj += ' +datum=NAD83';
        } else {
            utmProj += ' +datum=WGS84'; // Default
        }

        if (isSouth) {
            utmProj += ' +south';
        }

        // Convert 4 Corners to ensure we cover the area even if rotated/skewed
        // proj4(source, dest, coordinates)
        const pBL = proj4(utmProj, wgs84, [xll, yll]);
        const pTR = proj4(utmProj, wgs84, [xur, yur]);
        const pTL = proj4(utmProj, wgs84, [xll, yur]);
        const pBR = proj4(utmProj, wgs84, [xur, yll]);

        // Find min/max
        let west = Math.min(pBL[0], pTR[0], pTL[0], pBR[0]);
        let east = Math.max(pBL[0], pTR[0], pTL[0], pBR[0]);
        let south = Math.min(pBL[1], pTR[1], pTL[1], pBR[1]);
        let north = Math.max(pBL[1], pTR[1], pTL[1], pBR[1]);

        // Add minimal safety buffer (approx 50m) to handle rounding/interpolation edges
        const buffer = 0.0005;
        west -= buffer;
        east += buffer;
        south -= buffer;
        north += buffer;

        Logger.info(`[OpenTopography] Calculated Bounds: N=${north}, S=${south}, W=${west}, E=${east}`);

        return { south, north, west, east };
    }
}
