import * as fs from 'fs';
import { Logger } from './Logger';

export class FileTypeDetector {

    /**
     * Heuristic to determine if a file is 'binary' or 'ascii'.
     * Reads the first 1024 bytes.
     * Binary if:
     * - Contains null bytes (0x00).
     * - High ratio of non-printable characters.
     */
    public static detect(filePath: string): 'binary' | 'ascii' | 'geotiff' | 'vrt' | 'unknown' {
        try {
            if (!fs.existsSync(filePath)) return 'unknown';

            // Read first 1KB
            const buffer = new Uint8Array(1024);
            const fd = fs.openSync(filePath, 'r');
            const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
            fs.closeSync(fd);

            if (bytesRead === 0) return 'unknown'; // Empty file

            const checkBuffer = buffer.slice(0, bytesRead);

            // 1. GeoTIFF / TIFF Check (Magic Bytes)
            // Little Endian: II (0x49 0x49 0x2A 0x00)
            // Big Endian: MM (0x4D 0x4D 0x00 0x2A)
            if (bytesRead >= 4) {
                if ((checkBuffer[0] === 0x49 && checkBuffer[1] === 0x49 && checkBuffer[2] === 0x2A && checkBuffer[3] === 0x00) ||
                    (checkBuffer[0] === 0x4D && checkBuffer[1] === 0x4D && checkBuffer[2] === 0x00 && checkBuffer[3] === 0x2A)) {
                    return 'geotiff';
                }
            }

            // 2. VRT Check (XML Content)
            // VRT is XML. Check for <VRTDataset> tag in first 1KB.
            // Convert buffer to string (utf-8)
            let headerStr = '';
            for (let i = 0; i < Math.min(bytesRead, 512); i++) {
                if (checkBuffer[i] >= 32 && checkBuffer[i] <= 126) {
                    headerStr += String.fromCharCode(checkBuffer[i]);
                }
            }
            if (headerStr.includes('<VRTDataset')) {
                return 'vrt';
            }

            // 3. Null Byte Check -> Binary
            if (checkBuffer.includes(0x00)) {
                return 'binary';
            }

            // 4. Printable Content Check
            // Count non-printable ascii (0-8, 11-12, 14-31)
            // Allow: 9 (Tab), 10 (LF), 13 (CR)
            let nonPrintableCount = 0;
            for (const byte of checkBuffer) {
                if ((byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) || byte === 127) {
                    nonPrintableCount++;
                }
            }

            // If more than 10% non-printable, assume binary
            // Standard text files are usually 100% printable.
            if (nonPrintableCount > (bytesRead * 0.1)) {
                return 'binary';
            }

            return 'ascii';

        } catch (e) {
            Logger.error(`FileTypeDetector error for ${filePath}:`, e);
            return 'unknown';
        }
    }
}
