import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  readConfig, writeConfig, getName, getUtmZone, getDatum,
  getUtmHeader, getTimeBase, setInputDem, setStreamflow, NestedConfig,
} from '../../../src/services/projectConfig';

function nested(): NestedConfig {
  return {
    version: '1.0.0',
    settings: {
      name: 'demo',
      utmZone: 17,
      datum: 'NAD83',
      utmHeader: { ncols: '10', nrows: '20', xllcorner: '100', yllcorner: '200', cellsize: '5' },
    },
    compsetup: { sim_start_time: 60, sim_duration: 3600 },
    execution: { print_interval: 300 },
    input: {},
  };
}

describe('projectConfig helper', () => {
  it('reads scalar accessors from the nested settings node', () => {
    const c = nested();
    expect(getName(c)).to.equal('demo');
    expect(getUtmZone(c)).to.equal('17');
    expect(getDatum(c)).to.equal('NAD83');
  });

  it('defaults datum to WGS84 and utmZone to undefined when absent', () => {
    const c: NestedConfig = { settings: {} };
    expect(getDatum(c)).to.equal('WGS84');
    expect(getUtmZone(c)).to.equal(undefined);
    expect(getUtmHeader(c)).to.equal(undefined);
  });

  it('getUtmHeader coerces strings to numbers and defaults NODATA', () => {
    const h = getUtmHeader(nested());
    expect(h).to.deep.equal({
      ncols: 10, nrows: 20, xllcorner: 100, yllcorner: 200, cellsize: 5, NODATA_value: -9999,
    });
  });

  it('getTimeBase pulls from compsetup + execution', () => {
    expect(getTimeBase(nested())).to.deep.equal({ simStart: 60, printInterval: 300, simDuration: 3600 });
  });

  it('getTimeBase falls back to TRITON defaults when nodes are absent', () => {
    expect(getTimeBase({})).to.deep.equal({ simStart: 0, printInterval: 900, simDuration: 86400 });
  });

  it('setInputDem writes under input, creating the node if absent', () => {
    const c: NestedConfig = {};
    setInputDem(c, '/p/input/dem.asc');
    expect(c.input.dem).to.equal('/p/input/dem.asc');
  });

  it('setStreamflow wires all three vars under input', () => {
    const c: NestedConfig = {};
    setStreamflow(c, 2, '/p/input/s.src', '/p/input/s.hyg');
    expect(c.input).to.deep.equal({ num_sources: 2, src_loc_file: '/p/input/s.src', hydrograph_filename: '/p/input/s.hyg' });
  });

  it('read/writeConfig round-trips through disk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-cfg-'));
    const p = path.join(dir, 'config.json');
    const c = nested();
    writeConfig(p, c);
    expect(readConfig(p)).to.deep.equal(c);
  });
});
