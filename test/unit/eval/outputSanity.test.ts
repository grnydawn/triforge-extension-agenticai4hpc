import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  scanValues,
  parseAsciiRaster,
  parseBinRaster,
  scanOutputDir,
  HARD_CEILING,
  SOFT_CEILING,
} from '../../../scripts/eval/output-sanity';

// A physically-plausible little flood field: all distinct, sub-metre depths.
const PHYSICAL = [0, 0, 0.12, 0.4, 1.3, 0.8, 0.05, 0, 2.1, 0.6];

describe('Tier-2 output-sanity scanner: scanValues', () => {
  it('passes a physically-plausible field as sane', () => {
    const s = scanValues(PHYSICAL);
    expect(s.verdict).to.equal('sane');
    expect(s.nonFinite).to.equal(0);
    expect(s.reasons).to.deep.equal([]);
  });

  it('flags NaN/Inf cells as insane (silent divergence)', () => {
    const s = scanValues([0.1, NaN, 0.3, Infinity, 0.2]);
    expect(s.verdict).to.equal('insane');
    expect(s.nonFinite).to.equal(2);
    expect(s.reasons.join(' ')).to.match(/non-finite/);
  });

  it('flags the operational out-of-bounds magnitude (~6e213) as insane', () => {
    const s = scanValues([0.1, 6e213, 0.2]);
    expect(s.verdict).to.equal('insane');
    expect(s.max).to.be.greaterThan(HARD_CEILING);
    expect(s.reasons.join(' ')).to.match(/hard ceiling|out-of-bounds/);
  });

  it('escalates a soft-ceiling magnitude to review (not auto-fault)', () => {
    const v = SOFT_CEILING * 5; // suspicious but below the hard ceiling
    const s = scanValues([0.2, v, 0.3]);
    expect(s.verdict).to.equal('review');
    expect(s.reasons.join(' ')).to.match(/soft ceiling|suspicious/);
  });

  it('escalates a constant block of a non-zero value to review', () => {
    // 200 cells all = 3.3 (well over BLOCK_MIN_CELLS and 1% of cells), plus a few varied.
    const vals = new Array(200).fill(3.3).concat([0, 0.1, 0.2, 0.9]);
    const s = scanValues(vals);
    expect(s.verdict).to.equal('review');
    expect(s.modeValue).to.equal(3.3);
    expect(s.reasons.join(' ')).to.match(/constant block/);
  });

  it('does NOT call a physical field (all-distinct floats) a constant block', () => {
    const vals: number[] = [];
    for (let i = 1; i <= 500; i++) vals.push(i * 0.0011); // all distinct, in-range
    const s = scanValues(vals);
    expect(s.verdict).to.equal('sane');
  });

  it('escalates an all-zero output to review (nothing happened)', () => {
    const s = scanValues([0, 0, 0, 0]);
    expect(s.verdict).to.equal('review');
    expect(s.reasons.join(' ')).to.match(/entirely zero|nothing happened/);
  });

  it('does not confuse dry (zero) cells in an otherwise-live field', () => {
    const s = scanValues([0, 0, 0, 0, 1.2]); // one live cell, rest dry
    expect(s.verdict).to.equal('sane');
  });
});

describe('Tier-2 output-sanity scanner: parsers', () => {
  it('parses a bare ASCII matrix (no header) with correct dims', () => {
    const p = parseAsciiRaster('0.1 0.2 0.3\n0.4 0.5 0.6\n');
    expect(p.rows).to.equal(2);
    expect(p.cols).to.equal(3);
    expect(p.values).to.deep.equal([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
  });

  it('turns ASCII nan/inf tokens into non-finite values', () => {
    const p = parseAsciiRaster('0.1 nan\ninf 0.2\n');
    const s = scanValues(p.values);
    expect(s.nonFinite).to.equal(2);
    expect(s.verdict).to.equal('insane');
  });

  it('parses a float64 binary raster: [nrows,ncols] header then data', () => {
    const rows = 2;
    const cols = 3;
    const data = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    const buf = Buffer.alloc(16 + rows * cols * 8);
    buf.writeDoubleLE(rows, 0);
    buf.writeDoubleLE(cols, 8);
    data.forEach((v, i) => buf.writeDoubleLE(v, 16 + i * 8));
    const p = parseBinRaster(buf);
    expect(p.kind).to.equal('bin');
    expect(p.rows).to.equal(2);
    expect(p.cols).to.equal(3);
    expect(p.values).to.deep.equal(data);
  });

  it('reports an unrecognized binary blob as unknown', () => {
    const p = parseBinRaster(Buffer.from([1, 2, 3])); // 3 bytes: neither layout fits
    expect(p.kind).to.equal('unknown');
    expect(p.values.length).to.equal(0);
  });
});

describe('Tier-2 output-sanity scanner: scanOutputDir', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tier2-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeAsc(name: string, text: string): void {
    const d = path.join(dir, 'asc');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, name), text);
  }

  it('is sane when every output raster is physical', () => {
    writeAsc('H_1.out', '0.1 0.2 0.3\n0.4 0.5 0.6\n');
    const r = scanOutputDir(dir);
    expect(r.verdict).to.equal('sane');
    expect(r.rasters).to.have.length(1);
  });

  it('is insane when any raster carries the OOB-read signature', () => {
    writeAsc('H_1.out', '0.1 0.2\n0.3 0.4\n');
    writeAsc('MH.out', `0.1 ${6e213}\n0.2 0.3\n`);
    const r = scanOutputDir(dir);
    expect(r.verdict).to.equal('insane');
    expect(r.reasons.join(' ')).to.match(/MH\.out/);
  });

  it('reviews when the run wrote no output rasters', () => {
    const r = scanOutputDir(dir);
    expect(r.verdict).to.equal('review');
    expect(r.reasons.join(' ')).to.match(/no output rasters/);
  });
});
