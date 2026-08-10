// test/unit/services/demDownload.test.ts
import { expect } from 'chai';
import { downloadProjectDem, DemDownloadDeps } from '../../../src/services/demDownload';

const HEADER = { ncols: 4, nrows: 3, xllcorner: 500000, yllcorner: 4100000, cellsize: 30, NODATA_value: -9999 };

describe('downloadProjectDem', () => {
  it('chains download -> load -> resample -> save and reports the grid', async () => {
    const calls: string[] = [];
    const fakeData = { header: HEADER, min: 0, max: 1, values: [[0]], bounds: {} } as any;
    const deps: DemDownloadDeps = {
      downloadDem: async () => { calls.push('download'); return '/tmp/wgs84.asc'; },
      load: async (p: string) => { calls.push(`load:${p}`); return fakeData; },
      resample: async () => { calls.push('resample'); return fakeData; },
      save: async (p: string) => { calls.push(`save:${p}`); },
    };
    const r = await downloadProjectDem({
      apiKey: 'k', source: 'OpenTopography', targetHeader: HEADER,
      utmZone: '16', datum: 'WGS84', outPath: '/proj/input/dem.asc', tmpDir: '/tmp',
    }, deps);
    expect(calls).to.deep.equal(['download', 'load:/tmp/wgs84.asc', 'resample', 'save:/proj/input/dem.asc']);
    expect(r).to.deep.equal({ outPath: '/proj/input/dem.asc', cols: 4, rows: 3 });
  });
});
