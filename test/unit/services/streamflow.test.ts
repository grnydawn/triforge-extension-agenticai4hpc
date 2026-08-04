import { expect } from 'chai';
import { serializeSourceLocations, serializeHydrograph } from '../../../src/services/streamflow';

describe('serializeSourceLocations', () => {
  it('writes the TRITON .src header + fixed(3) UTM coords', () => {
    const out = serializeSourceLocations([{ x: 500000.1234, y: 4100000.5 }], 16);
    expect(out).to.equal('%X-Location,Y-Location\n500000.123,4100000.500');
  });
});

describe('serializeHydrograph', () => {
  it('emits one time column (fixed 1) + one fixed(4) column per source', () => {
    const out = serializeHydrograph([[1, 2, 3], [4, 5, 6]], { simStart: 0, printInterval: 900, simDuration: 1800 });
    expect(out).to.equal('0.0,1.0000,4.0000\n900.0,2.0000,5.0000\n1800.0,3.0000,6.0000');
  });
});

describe('streamflow parity with the pre-refactor panel writer', () => {
  it('reproduces the exact bytes the inlined writer produced', () => {
    const locations = [{ lat: 37.0, lng: -88.0 }];
    const src = serializeSourceLocations(locations, 16);
    expect(src.startsWith('%X-Location,Y-Location\n')).to.equal(true);
    expect(src.split('\n')).to.have.length(2);
    const hyg = serializeHydrograph([[10, 20]], { simStart: 0, printInterval: 900, simDuration: 900 });
    expect(hyg).to.equal('0.0,10.0000\n900.0,20.0000');
  });
});
