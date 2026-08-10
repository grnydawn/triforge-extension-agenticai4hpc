import { expect } from 'chai';

import { DemData, DemHeader } from '../../../src/parsers/DemParser';
import { DemResampler } from '../../../src/services/DemResampler';

// The resampler treats `source` as EPSG:4326 (lon/lat) and `targetHeader` as a
// UTM grid (zone passed separately). Each target cell center is reprojected
// UTM -> lon/lat, then bilinearly sampled from the source grid.

const TARGET_ZONE = '16N';

// Target grid: 2x2 cells, 10 m, origin chosen so its UTM->lonlat footprint lands
// near lon -87.0, lat 36.1448 (interior of the source grid below).
function makeTargetHeader(): DemHeader {
  return {
    ncols: 2,
    nrows: 2,
    cellsize: 10,
    xllcorner: 500000,
    yllcorner: 4000000,
    NODATA_value: -9999,
  };
}

// Source grid in EPSG:4326 (lon/lat). 4x4 cells of 0.00025 deg covering the
// target footprint with margin. Every cell holds the same constant, so the
// bilinear interpolation must yield exactly that constant regardless of weights.
const SRC_CONST = 42.5;

function makeOverlappingSource(): DemData {
  const header: DemHeader = {
    ncols: 4,
    nrows: 4,
    cellsize: 0.00025,
    xllcorner: -87.0005,
    yllcorner: 36.14435,
    NODATA_value: -9999,
  };
  const values: number[][] = [];
  for (let r = 0; r < header.nrows; r++) {
    values.push(new Array(header.ncols).fill(SRC_CONST));
  }
  return {
    header,
    min: SRC_CONST,
    max: SRC_CONST,
    values,
    // Bounds are not consulted by the resampler; supply a trivial placeholder.
    bounds: {
      north: 0, south: 0, east: 0, west: 0,
      tl: { lat: 0, lng: 0 }, tr: { lat: 0, lng: 0 },
      bl: { lat: 0, lng: 0 }, br: { lat: 0, lng: 0 },
    },
  };
}

// Same shape, but parked far away (lon 0, lat 0) so it does NOT overlap the
// target's UTM footprint at all -> every target cell maps out of bounds and
// the resampler's internal validCount stays 0.
function makeNonOverlappingSource(): DemData {
  const src = makeOverlappingSource();
  src.header.xllcorner = 0;
  src.header.yllcorner = 0;
  return src;
}

describe('DemResampler.resample (bilinear, UTM target)', () => {
  // DEM-9: known small source -> known target. Output dimensions equal the
  // target, and a sampled value equals the (constant) source within tolerance.
  it('resamples a constant source grid onto the target grid', async () => {
    const out = await DemResampler.resample(
      makeOverlappingSource(),
      makeTargetHeader(),
      TARGET_ZONE,
    );

    // Dimensions match the requested target grid.
    expect(out.values.length).to.equal(2);
    expect(out.values[0].length).to.equal(2);
    expect(out.values[1].length).to.equal(2);

    // Every sampled cell is the constant source value (within float tolerance),
    // and none was flagged NODATA.
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        expect(out.values[r][c]).to.be.closeTo(SRC_CONST, 1e-4);
      }
    }
    // Spot-check a single cell explicitly.
    expect(out.values[0][0]).to.be.closeTo(SRC_CONST, 1e-4);
  });

  // SVC-2 [FIXED]: when source and target footprints do not overlap, the
  // resampler's internal validCount is 0. It rejects that as an error (the
  // target would otherwise be an all-NODATA / flat grid the user can't tell
  // apart from real data).
  it('rejects non-overlapping source/target bounds [SVC-2 FIXED]', async () => {
    let threw = false;
    try {
      await DemResampler.resample(
        makeNonOverlappingSource(),
        makeTargetHeader(),
        TARGET_ZONE,
      );
    } catch {
      threw = true;
    }
    expect(threw, 'resample should throw when no source pixels are valid').to.equal(true);
  });
});
