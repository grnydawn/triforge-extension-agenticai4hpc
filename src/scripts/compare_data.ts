import * as fs from 'fs';
import * as path from 'path';
import * as geotiff from 'geotiff';

// --- HELPER: SIMPLE LOGGER ---
const log = (msg: string) => console.log(`[INFO] ${msg}`);
const warn = (msg: string) => console.log(`[WARN] ${msg}`);
const error = (msg: string) => console.error(`[ERROR] ${msg}`);

// --- HELPER: BINARY READER ---
async function readBinary(filePath: string): Promise<{ data: Float64Array, rows: number, cols: number } | null> {
    try {
        if (!fs.existsSync(filePath)) {
            error(`File not found: ${filePath}`);
            return null;
        }

        const stats = fs.statSync(filePath);
        const fd = fs.openSync(filePath, 'r');
        const headerBuffer = Buffer.alloc(16);
        fs.readSync(fd, headerBuffer as unknown as Uint8Array, 0, 16, 0);

        // Header: Rows (Double), Cols (Double)
        let rows = headerBuffer.readDoubleLE(0);
        let cols = headerBuffer.readDoubleLE(8);
        let headerSize = 16;
        let isDouble = true;

        // Basic Validation
        const expectedBodyDouble = rows * cols * 8;
        if (rows <= 0 || cols <= 0 || stats.size !== expectedBodyDouble + 16) {
            // Fallback to Float header check?
            // User stated: "two double precision number at the beginning"
            // But let's keep the float check just in case, or fail strict.
            // Let's support both just to be safe, but prioritize Double.

            // Try Float
            rows = headerBuffer.readFloatLE(0);
            cols = headerBuffer.readFloatLE(4);
            const expectedBodyFloat = rows * cols * 4;
            if (rows > 0 && cols > 0 && stats.size === expectedBodyFloat + 8) {
                isDouble = false;
                headerSize = 8;
                log(`Detected Float Header: Rows=${rows}, Cols=${cols}`);
            } else {
                // Revert to double values for error message
                rows = headerBuffer.readDoubleLE(0);
                cols = headerBuffer.readDoubleLE(8);
                error(`Binary Header Mismatch for ${path.basename(filePath)}. FileSize: ${stats.size}. read Rows:${rows}, Cols:${cols}. Expected bytes: ${expectedBodyDouble + 16}`);
                fs.closeSync(fd);
                return null;
            }
        } else {
            log(`Detected Double Header: Rows=${rows}, Cols=${cols}`);
        }

        const frameSize = rows * cols;
        const fullBuf = fs.readFileSync(filePath); // Read entire file
        fs.closeSync(fd);

        const bodyBuf = fullBuf.subarray(headerSize);
        let data: Float64Array;

        if (isDouble) {
            data = new Float64Array(bodyBuf.buffer, bodyBuf.byteOffset, frameSize);
        } else {
            // If body is float, convert to float64 for uniform comparison
            const f32 = new Float32Array(bodyBuf.buffer, bodyBuf.byteOffset, frameSize);
            data = new Float64Array(f32);
        }

        return { data, rows, cols };

    } catch (e) {
        error(`Failed to read binary: ${e}`);
        return null;
    }
}

// --- HELPER: GEOTIFF READER ---
async function readGeoTiff(filePath: string): Promise<{ data: Float32Array | Float64Array, width: number, height: number } | null> {
    try {
        if (!fs.existsSync(filePath)) {
            error(`File not found: ${filePath}`);
            return null;
        }

        const tiff = await geotiff.fromFile(filePath);
        const image = await tiff.getImage();
        const width = image.getWidth();
        const height = image.getHeight();

        log(`GeoTIFF Header: Width=${width}, Height=${height}`);

        const rasters = await image.readRasters();
        let data: Float32Array | Float64Array; // geotiff returns diverse typed arrays

        if (Array.isArray(rasters)) {
            data = rasters[0] as any;
        } else {
            data = (rasters as any)[0] as any;
        }

        await tiff.close();

        // Ensure compatible type? Comparison handles generic numbers, but let's just return it.
        return { data, width, height };

    } catch (e) {
        error(`Failed to read GeoTIFF: ${e}`);
        return null;
    }
}

// --- MAIN ---
async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log("Usage: npx ts-node scripts/compare_data.ts <binary_file.out> <geotiff_file.tif>");
        process.exit(1);
    }

    const binPath = args[0];
    const tifPath = args[1];

    console.log(`\n--- Comparing Data ---\nBinary: ${binPath}\nGeoTIFF: ${tifPath}\n`);

    const binRes = await readBinary(binPath);
    const tifRes = await readGeoTiff(tifPath);

    if (!binRes || !tifRes) {
        error("Aborting due to read errors.");
        process.exit(1);
    }

    // Compare Dimensions
    if (binRes.cols !== tifRes.width || binRes.rows !== tifRes.height) {
        error(`Dimension Mismatch!`);
        error(`Binary: ${binRes.cols} x ${binRes.rows}`);
        error(`GeoTIFF: ${tifRes.width} x ${tifRes.height}`);

        // If dimensions mismatch, is it a ghost row issue?
        // Let's attempt to compare anyway up to min size?
        warn("Proceeding with comparison on intersection (top-left aligned)...");
    }

    const rows = Math.min(binRes.rows, tifRes.height);
    const cols = Math.min(binRes.cols, tifRes.width);
    const totalPixels = rows * cols;

    let mismatchCount = 0;
    let maxDiff = 0;
    let sumDiff = 0;
    const errors: string[] = [];

    // Indices might be different if strides differ (i.e. if width differs)
    // We must use 2D loop.

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            // Bin Index
            const bIdx = r * binRes.cols + c;
            // Tif Index
            const tIdx = r * tifRes.width + c;

            const bVal = binRes.data[bIdx];
            const tVal = tifRes.data[tIdx];

            // Filter NoData? User didn't specify value, but usually -9999 or 0
            // Let's just compare raw values.
            const diff = Math.abs(bVal - tVal);

            // Using a small epsilon for floating point comparison
            if (diff > 0.0001) {
                mismatchCount++;
                if (diff > maxDiff) maxDiff = diff;
                sumDiff += diff;

                if (errors.length < 20) {
                    errors.push(`[R${r}, C${c}] Bin=${bVal}, Tif=${tVal} (Diff=${diff})`);
                }
            }
        }
    }

    console.log("\n--- Results ---");
    console.log(`Compared Region: ${cols} x ${rows}`);
    console.log(`Total Mismatches (>0.0001): ${mismatchCount} / ${totalPixels} (${((mismatchCount / totalPixels) * 100).toFixed(2)}%)`);
    console.log(`Max Difference: ${maxDiff}`);

    if (mismatchCount > 0) {
        console.log("\nFirst 20 Mismatches:");
        errors.forEach(e => console.log(e));
    } else {
        console.log("✅ Data matches exactly!");
    }
}

main().catch(e => console.error(e));
