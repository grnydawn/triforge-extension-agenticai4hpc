import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { expect } from 'chai';

import { DemManager } from '../../../src/parsers/DemManager';
import { DemHeader } from '../../../src/parsers/DemParser';

// A tiny, valid ESRI ASCII grid. Body is irrelevant to the zone question; the
// header coordinates are UTM easting/northing that get reprojected per zone.
const ASC_BODY = [
  'ncols 3',
  'nrows 2',
  'xllcorner 500000.0',
  'yllcorner 4000000.0',
  'cellsize 10.0',
  'NODATA_value -9999',
  '1 2 3',
  '4 5 6',
  '',
].join('\n');

// The projection source declares a zone that is NOT the hardcoded 16N.
const DETECTED_ZONE = '17N';

describe('DemManager.load (UTM zone detection)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demmgr-zone-'));
  });

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Sanity: prove the zone source and the observable are sound. When the
  // projection source is a .prj sidecar (which DemParser already reads), the
  // resulting DemData.utmZone reflects the detected 17N, not the 16N default.
  // This anchors the SVC-1 case below to a real observable, not a quirk of the fixture.
  it('honors a 17N .prj sidecar (observable: result header zone)', async () => {
    const ascPath = path.join(tmpDir, 'grid.asc');
    fs.writeFileSync(ascPath, ASC_BODY);
    fs.writeFileSync(
      path.join(tmpDir, 'grid.prj'),
      'PROJCS["WGS_1984_UTM_Zone_17N",GEOGCS["GCS_WGS_1984"],' +
        'PROJECTION["Transverse_Mercator"],PARAMETER["central_meridian",-81.0]]',
    );

    const dem = await DemManager.load(ascPath);
    expect(dem.utmZone).to.equal(DETECTED_ZONE);
  });

  // SVC-1 (FIXED): DemManager.load no longer hardcodes '16N'. When the projection
  // source is conveyed as a zone field on the input header (the way a caller would
  // pass a zone it already detected) and there is NO .prj sidecar to fall back on,
  // load threads the detected 17N through to DemParser.parse so the result zone
  // (and thus the converter zone used for bounds) is the DETECTED 17N.
  it('uses the detected zone, not hardcoded 16N [SVC-1 FIXED]', async () => {
    const ascPath = path.join(tmpDir, 'grid.asc');
    fs.writeFileSync(ascPath, ASC_BODY);
    // Deliberately NO grid.prj sidecar: the only zone signal is the header field.

    const header = {
      ncols: 3,
      nrows: 2,
      cellsize: 10,
      xllcorner: 500000,
      yllcorner: 4000000,
      NODATA_value: -9999,
      utmZone: DETECTED_ZONE,
    } as DemHeader & { utmZone: string };

    const dem = await DemManager.load(ascPath, header);

    // Post-fix: load threads the DETECTED zone through to the result, instead of
    // dropping it for the hardcoded 16N fallback.
    expect(dem.utmZone).to.equal(DETECTED_ZONE);
  });
});
