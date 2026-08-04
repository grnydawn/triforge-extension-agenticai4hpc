import * as path from 'path';

import { expect } from 'chai';

import { DemParser } from '../../../src/parsers/DemParser';

const FIXTURES = path.join(__dirname, 'fixtures');

describe('DemParser.parse (ESRI ASCII grid)', () => {
  // DEM-9: hand-authored 3x2 grid with known header + cell values.
  it('reads header fields and cell values from a tiny grid', async () => {
    const dem = await DemParser.parse(path.join(FIXTURES, 'tiny.asc'), '16N');

    // Header
    expect(dem.header.ncols).to.equal(3);
    expect(dem.header.nrows).to.equal(2);
    expect(dem.header.cellsize).to.equal(10);
    expect(dem.header.xllcorner).to.equal(500000);
    expect(dem.header.yllcorner).to.equal(4000000);

    // Cell values are row-major: values[row][col].
    expect(dem.values.length).to.equal(2);
    expect(dem.values[0]).to.deep.equal([1, 2, 3]);
    expect(dem.values[1]).to.deep.equal([4, 5, 6]);

    // A couple of individual cells, plus derived stats.
    expect(dem.values[0][0]).to.equal(1);
    expect(dem.values[1][2]).to.equal(6);
    expect(dem.min).to.equal(1);
    expect(dem.max).to.equal(6);
  });

  // DEM-10 / BUG-2: NODATA_value of 0 must be preserved. The parser previously
  // used a falsy-OR fallback (`header.nodata_value || -9999`), so 0 became -9999;
  // it now uses an explicit `!== undefined` check, so a legitimate 0 survives.
  it('preserves a NODATA_value of zero', async () => {
    const dem = await DemParser.parse(path.join(FIXTURES, 'zero-nodata.asc'), '16N');

    expect(dem.header.NODATA_value).to.equal(0);
  });
});
