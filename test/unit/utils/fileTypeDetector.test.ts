import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { expect } from 'chai';

import { FileTypeDetector } from '../../../src/utils/FileTypeDetector';

describe('FileTypeDetector.detect', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileTypeDetector-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFixture(name: string, data: Buffer | string): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, data);
    return filePath;
  }

  it('detects a GeoTIFF by its little-endian TIFF magic header', () => {
    // Little-endian TIFF magic: 0x49 0x49 0x2A 0x00 ("II*\0").
    const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
    const file = writeFixture('sample.tif', tiff);
    expect(FileTypeDetector.detect(file)).to.equal('geotiff');
  });

  it('detects a VRT by its <VRTDataset XML root element', () => {
    const vrt = '<VRTDataset rasterXSize="10" rasterYSize="10">\n  <SRS></SRS>\n</VRTDataset>\n';
    const file = writeFixture('sample.vrt', vrt);
    expect(FileTypeDetector.detect(file)).to.equal('vrt');
  });

  it('detects an ESRI ASCII grid as ascii', () => {
    const asc = [
      'ncols 3',
      'nrows 2',
      'xllcorner 500000',
      'yllcorner 4000000',
      'cellsize 10',
      'NODATA_value -9999',
      '1 2 3',
      '4 5 6',
      '',
    ].join('\n');
    const file = writeFixture('grid.asc', asc);
    expect(FileTypeDetector.detect(file)).to.equal('ascii');
  });

  it('detects an arbitrary binary blob as binary', () => {
    // Contains a null byte and non-printable bytes -> binary.
    const blob = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x01, 0x02]);
    const file = writeFixture('blob.bin', blob);
    expect(FileTypeDetector.detect(file)).to.equal('binary');
  });

  it('returns unknown for a non-existent file', () => {
    expect(FileTypeDetector.detect(path.join(tmpDir, 'does-not-exist.dat'))).to.equal('unknown');
  });
});
