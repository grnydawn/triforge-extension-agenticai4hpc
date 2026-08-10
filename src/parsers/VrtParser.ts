import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import * as geotiff from 'geotiff';
import { Logger } from '../utils/Logger';

// Helper Type
type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;

export class VrtParser {
    /**
     * Parses a VRT file and produces a single Float32Array (flattened matrix)
     * representing the raster values, matched to the target DEM's dimensions.
     * 
     * Assumes the VRT Coordinate System aligns with the DEM (pixel for pixel).
     * If the VRT describes a mosaic where DstRect corresponds to pixel coordinates
     * in the target grid, this will work.
     */
    public static async parseToMatrix(vrtPath: string, targetHeader: { lastCols: number; lastRows: number; noData: number }): Promise<Float32Array | null> {
        try {
            const xmlContent = fs.readFileSync(vrtPath, 'utf8');
            const parser = new XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix: '',
                parseAttributeValue: true
            });
            const result = parser.parse(xmlContent);

            const root = result.VRTDataset;
            if (!root) {
                Logger.error(`[VrtParser] Invalid VRT: ${vrtPath}`);
                return null;
            }

            // We expect the VRT to match the DEM size roughly, or at least we output to DEM size.
            // But per request "size of each matrix should be the same as the DEM data file size".
            // So we allocate based on targetHeader.
            const totalSize = targetHeader.lastCols * targetHeader.lastRows;
            const outputMatrix = new Float32Array(totalSize).fill(targetHeader.noData); // Init with NoData

            // Identify the Band (assuming Band 1 for now)
            let band = root.VRTRasterBand;
            if (Array.isArray(band)) {
                band = band[0]; // Take first band
            }

            if (!band || !band.SimpleSource) {
                Logger.warn(`[VrtParser] No SimpleSource found in Band 1: ${vrtPath}`);
                return null;
            }

            // Source NoData sentinel declared on the band (if any). Pixels matching
            // this value must be remapped to the target NoData rather than copied
            // verbatim, otherwise the source sentinel leaks into the mosaic.
            const srcNoData = band.NoDataValue !== undefined ? Number(band.NoDataValue) : undefined;

            let sources: any[] = band.SimpleSource;
            if (!Array.isArray(sources)) {
                sources = [sources];
            }

            // Process each source tile
            for (const source of sources) {
                await this._processSource(source, vrtPath, outputMatrix, targetHeader.lastCols, srcNoData, targetHeader.noData);
            }

            return outputMatrix;

        } catch (e) {
            Logger.error(`[VrtParser] Failed to process ${vrtPath}: ${e}`);
            return null;
        }
    }

    private static async _processSource(source: any, vrtPath: string, outputMatrix: Float32Array, targetCols: number, srcNoData?: number, targetNoData?: number) {
        try {
            // parsing SrcRect / DstRect
            // Format usually: <SrcRect xOff="0" yOff="0" xSize="128" ySize="128" />
            // fast-xml-parser with attributes turned on puts them as properties
            const srcRect = source.SrcRect;
            const dstRect = source.DstRect;

            if (!srcRect || !dstRect) return;

            // Enforce integer parsing
            const sXOff = parseInt(srcRect['@_xOff'] || srcRect.xOff);
            const sYOff = parseInt(srcRect['@_yOff'] || srcRect.yOff);
            const sW = parseInt(srcRect['@_xSize'] || srcRect.xSize);
            const sH = parseInt(srcRect['@_ySize'] || srcRect.ySize);

            const dXOff = parseInt(dstRect['@_xOff'] || dstRect.xOff);
            const dYOff = parseInt(dstRect['@_yOff'] || dstRect.yOff);
            const dW = parseInt(dstRect['@_xSize'] || dstRect.xSize);
            const dH = parseInt(dstRect['@_ySize'] || dstRect.ySize);

            // Use normalized values
            const width = sW;
            const height = sH;

            // Resolve Filename
            const filename = source.SourceFilename;
            let isRelative = 0;

            // Handle element text vs object with attributes
            let srcFile = "";
            if (typeof filename === 'object') {
                srcFile = filename['#text'];
                isRelative = parseInt(filename.relativeToVRT);
            } else {
                srcFile = filename;
            }

            if (isRelative === 1 || (isRelative !== 0 && !path.isAbsolute(srcFile))) {
                srcFile = path.resolve(path.dirname(vrtPath), srcFile);
            }

            if (!fs.existsSync(srcFile)) {
                Logger.warn(`[VrtParser] Source file not found: ${srcFile}`);
                return;
            }

            // Read Tiff
            const tiff = await geotiff.fromFile(srcFile);
            const image = await tiff.getImage();

            // Validate Scaling
            if (sW !== dW || sH !== dH) {
                Logger.warn(`[VrtParser] Scaling not supported. Src: ${sW}x${sH} -> Dst: ${dW}x${dH}`);
                return;
            }

            // Read Raster Data
            // window: [minX, minY, maxX, maxY]
            const window = [sXOff, sYOff, sXOff + width, sYOff + height];

            const rasters = await image.readRasters({ window: window });
            let data: TypedArray;

            if (Array.isArray(rasters)) {
                data = rasters[0] as TypedArray;
            } else {
                data = (rasters as any)[0];
            }

            // Optimized Copy:
            const startCol = dXOff;
            const startRow = dYOff;

            // Validation: Ensure Width Matches (Strict) or handle simple copy
            if (width === targetCols && startCol === 0) {

                // Fast Path: Contiguous Block Copy
                // The data block corresponds to [startRow ... startRow + height] in the target
                const targetStartIdx = startRow * targetCols;
                const totalElements = width * height;

                // Clamp to the available room in the output buffer.
                const copyLen = Math.min(totalElements, outputMatrix.length - targetStartIdx);

                // Remap source NoData (and NaN) sentinels to the target NoData so the
                // source raster's own NoData does not leak into the mosaic as real data.
                // Only differ-remap is needed; if source/target NoData already match a
                // straight copy is equivalent.
                const needsRemap = (srcNoData !== undefined && srcNoData !== targetNoData) || data.some(v => Number.isNaN(v));
                if (needsRemap && targetNoData !== undefined) {
                    for (let i = 0; i < copyLen; i++) {
                        const v = data[i];
                        outputMatrix[targetStartIdx + i] =
                            (Number.isNaN(v) || (srcNoData !== undefined && v === srcNoData)) ? targetNoData : v;
                    }
                } else if (copyLen === totalElements) {
                    outputMatrix.set(data, targetStartIdx);
                } else {
                    outputMatrix.set(data.subarray(0, copyLen), targetStartIdx);
                }
            } else {
                const msg = `[VrtParser] Unsupported VRT structure: xSize (${width}) must match full target width (${targetCols}) and startCol (${startCol}) must be 0.`;
                Logger.error(msg);
                throw new Error(msg);
            }

            await tiff.close();

        } catch (e) {
            Logger.warn(`[VrtParser] Error reading source ${source.SourceFilename}: ${e}`);
        }
    }
    /**
     * Extracts dimensions from VRT and verifies by successfully parsing it (without returning data).
     */
    public static async getDimensions(vrtPath: string): Promise<{ cols: number, rows: number } | null> {
        try {
            const xmlContent = fs.readFileSync(vrtPath, 'utf8');
            const parser = new XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix: '',
                parseAttributeValue: true
            });
            const result = parser.parse(xmlContent);

            const root = result.VRTDataset;
            if (!root || !root.rasterXSize || !root.rasterYSize) {
                return null;
            }

            const cols = parseInt(root.rasterXSize);
            const rows = parseInt(root.rasterYSize);

            // Optional: "Generate one matrix" as requested implies we should try to do the work.
            // We can reuse parseToMatrix with these dimensions to verify it works.
            // But for just showing properties, maybe just the header is enough?
            // "Using Vrt file, generate one matrix... Show ncols X nrows"
            // Let's call the internal methods to simulate generation without holding the result.

            // To strictly follow "generate one matrix", we execute the load.
            const header = { lastCols: cols, lastRows: rows, noData: -9999 };
            const matrix = await this.parseToMatrix(vrtPath, header);

            if (matrix) {
                return { cols, rows };
            }
            return null;

        } catch (e) {
            Logger.error(`[VrtParser] Failed to get dimensions: ${e}`);
            return null;
        }
    }
}

