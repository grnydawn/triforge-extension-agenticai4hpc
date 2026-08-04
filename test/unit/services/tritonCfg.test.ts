import { expect } from 'chai';
import { parseTritonCfg } from '../../../src/services/tritonCfg';

describe('parseTritonCfg', () => {
  const sample = [
    '#--- comment header ---',
    'dem_filename="input/terrain_12m.bin"',
    'input_format=BIN',
    'num_runoffs=28',
    'runoff_filename="input/XXXsite_HYGXXX"',
    '# qx_infile="input/init_QX_30_00.out"',
    'courant=0.5',
  ].join('\n');

  it('reads active key=value pairs, stripping quotes', () => {
    const cfg = parseTritonCfg(sample);
    expect(cfg.get('dem_filename')).to.equal('input/terrain_12m.bin');
    expect(cfg.get('input_format')).to.equal('BIN');
    expect(cfg.getNumber('num_runoffs')).to.equal(28);
    expect(cfg.getNumber('courant')).to.equal(0.5);
  });

  it('marks whole-line comments inactive but records commented keys', () => {
    const cfg = parseTritonCfg(sample);
    expect(cfg.isActive('runoff_filename')).to.equal(true);
    expect(cfg.isActive('qx_infile')).to.equal(false);   // commented out
    expect(cfg.get('qx_infile')).to.equal(undefined);
  });

  it('exposes active entries for placeholder scanning', () => {
    const cfg = parseTritonCfg(sample);
    const entry = cfg.activeEntries().find((e) => e.key === 'runoff_filename');
    expect(entry?.value).to.equal('input/XXXsite_HYGXXX');
  });

  it('last duplicate key wins', () => {
    const cfg = parseTritonCfg('num_sources=0\nnum_sources=3');
    expect(cfg.getNumber('num_sources')).to.equal(3);
  });

  it('strips a trailing # comment on a bare value', () => {
    const cfg = parseTritonCfg('courant=0.5 # CFL number');
    expect(cfg.getNumber('courant')).to.equal(0.5);
  });

  it('keeps a quoted value and ignores a trailing # comment', () => {
    const cfg = parseTritonCfg('dem_filename="x.dem" # main DEM');
    expect(cfg.get('dem_filename')).to.equal('x.dem');
  });
});
