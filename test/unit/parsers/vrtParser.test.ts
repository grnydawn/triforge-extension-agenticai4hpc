import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { expect } from 'chai';

import { VrtParser } from '../../../src/parsers/VrtParser';

// geotiff is required lazily inside before() (not imported at the top level).
// A top-level `import` of geotiff races with VrtParser's own geotiff import when
// mocha loads test files, tripping a Node ESM/CJS sync-require assertion in a
// geotiff transitive dep. Deferring to an awaited context sidesteps that.

// Source-raster NoData sentinel baked into the GeoTIFF tiles. Distinct from the
// target grid's NoData so we can tell a remap apart from a passthrough.
const SRC_NODATA = -32768;
// The NoData value the merged grid is asked to use (targetHeader.noData).
const TARGET_NODATA = -9999;

describe('VrtParser.parseToMatrix (tiled VRT mosaic)', () => {
  let tmpDir: string;
  let vrtPath: string;

  // Build a real 2-tile VRT on disk: two 1x2 Float32 GeoTIFFs stacked into a
  // 1-col x 4-row target grid. Each tile carries one SRC_NODATA cell. Writing
  // real .tif + .vrt files exercises the parser's actual geotiff.fromFile ->
  // readRasters path (no stubbing of geotiff internals).
  before(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const geotiff = require('geotiff') as typeof import('geotiff');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrt-nodata-'));

    const tileA = new Float32Array([10, SRC_NODATA]); // target rows 0,1
    const tileB = new Float32Array([SRC_NODATA, 40]); // target rows 2,3

    for (const [name, vals] of [['a.tif', tileA], ['b.tif', tileB]] as const) {
      const ab = await geotiff.writeArrayBuffer(vals, { width: 1, height: 2 });
      fs.writeFileSync(path.join(tmpDir, name), Buffer.from(ab as ArrayBuffer));
    }

    const vrt = `<VRTDataset rasterXSize="1" rasterYSize="4">
  <VRTRasterBand dataType="Float32" band="1">
    <NoDataValue>${SRC_NODATA}</NoDataValue>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">a.tif</SourceFilename>
      <SrcRect xOff="0" yOff="0" xSize="1" ySize="2"/>
      <DstRect xOff="0" yOff="0" xSize="1" ySize="2"/>
    </SimpleSource>
    <SimpleSource>
      <SourceFilename relativeToVRT="1">b.tif</SourceFilename>
      <SrcRect xOff="0" yOff="0" xSize="1" ySize="2"/>
      <DstRect xOff="0" yOff="2" xSize="1" ySize="2"/>
    </SimpleSource>
  </VRTRasterBand>
</VRTDataset>`;
    vrtPath = path.join(tmpDir, 'mosaic.vrt');
    fs.writeFileSync(vrtPath, vrt);
  });

  after(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Sanity: the real (valid) cell values stitch into the right target positions.
  it('stitches valid cell values into the merged grid', async () => {
    const out = await VrtParser.parseToMatrix(vrtPath, {
      lastCols: 1,
      lastRows: 4,
      noData: TARGET_NODATA,
    });

    expect(out).to.be.instanceOf(Float32Array);
    expect(out!.length).to.equal(4);
    expect(out![0]).to.equal(10);
    expect(out![3]).to.equal(40);
  });

  // BUG-3: a source tile's NoData sentinel must be remapped to targetHeader.noData
  // in the merged grid. _processSource now reads the band's NoDataValue and remaps
  // matching (and NaN) source pixels to the target NoData during the copy, so
  // SRC_NODATA no longer leaks through verbatim.
  it('remaps source NoData sentinel to target NoData', async () => {
    const out = await VrtParser.parseToMatrix(vrtPath, {
      lastCols: 1,
      lastRows: 4,
      noData: TARGET_NODATA,
    });

    expect(out).to.be.instanceOf(Float32Array);

    const values = Array.from(out!);
    // The two SRC_NODATA cells (target rows 1 and 2) must become TARGET_NODATA...
    expect(out![1]).to.equal(TARGET_NODATA);
    expect(out![2]).to.equal(TARGET_NODATA);
    // ...and no raw source sentinel should survive in the merged grid.
    expect(values).to.not.include(SRC_NODATA);
  });
});
