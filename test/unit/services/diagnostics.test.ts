// test/unit/services/diagnostics.test.ts
import { expect } from 'chai';
import { parseTritonCfg } from '../../../src/services/tritonCfg';
import { diagnoseTritonDeck, physicalValidityCheck, binRasterHeaderCheck, hydrographDelimiterCheck, DiagnosisProbe } from '../../../src/services/diagnostics';

/** In-memory probe: files present as keys, text as values; sizes/headers optional. */
function fakeProbe(opts: {
  files?: Record<string, string>;
  sizes?: Record<string, number>;
  headers?: Record<string, { ncols: number; nrows: number }>;
  binHeaders?: Record<string, { ncols: number; nrows: number; bpc: number }>;
  binIntRanges?: Record<string, { min: number; max: number }>;
} = {}): DiagnosisProbe {
  const files = opts.files ?? {};
  return {
    exists: (p) => p in files || p in (opts.sizes ?? {}) || p in (opts.headers ?? {}),
    size: (p) => (opts.sizes && p in opts.sizes ? opts.sizes[p] : (p in files ? files[p].length : null)),
    readText: (p) => (p in files ? files[p] : null),
    ascHeader: (p) => (opts.headers && p in opts.headers ? opts.headers[p] : null),
    binHeader: (p) => (opts.binHeaders && p in opts.binHeaders ? opts.binHeaders[p] : null),
    binIntRange: (p) => (opts.binIntRanges && p in opts.binIntRanges ? opts.binIntRanges[p] : null),
  };
}

describe('diagnoseTritonDeck — deck integrity', () => {
  it('flags an unsubstituted template placeholder as an error', () => {
    const cfg = parseTritonCfg('num_runoffs=1\nrunoff_filename="input/XXXsite_HYGXXX"');
    const rep = diagnoseTritonDeck(cfg, '/proj', fakeProbe());
    const f = rep.findings.find((x) => x.id === 'unsubstituted-placeholder');
    expect(f, 'placeholder finding').to.not.equal(undefined);
    expect(f!.severity).to.equal('error');
    expect(f!.evidence).to.contain('XXXsite_HYGXXX');
  });

  it('flags input_format=GTIFF (or any non-BIN/ASC) as an unsupported-input-format error', () => {
    const cfg = parseTritonCfg('input_format=GTIFF\nnum_runoffs=0\nnum_sources=0');
    const rep = diagnoseTritonDeck(cfg, '/proj', fakeProbe());
    const f = rep.findings.find((x) => x.id === 'unsupported-input-format');
    expect(f, 'unsupported-input-format finding').to.not.equal(undefined);
    expect(f!.severity).to.equal('error');
    expect(f!.evidence).to.contain('GTIFF');
  });

  it('accepts input_format=BIN and =ASC (no unsupported-format finding)', () => {
    for (const fmt of ['BIN', 'ASC']) {
      const cfg = parseTritonCfg(`input_format=${fmt}\nnum_runoffs=0\nnum_sources=0`);
      const rep = diagnoseTritonDeck(cfg, '/proj', fakeProbe());
      expect(rep.findings.find((x) => x.id === 'unsupported-input-format'), fmt).to.equal(undefined);
    }
  });

  it('flags a missing referenced input file, skipping commented + irrelevant keys', () => {
    const cfg = parseTritonCfg(
      ['num_runoffs=0', 'num_sources=0', 'dem_filename="input/dem.bin"', '# qx_infile="input/x.out"'].join('\n'),
    );
    // dem file NOT present in the probe → missing; runoff/src keys absent; qx commented.
    const rep = diagnoseTritonDeck(cfg, '/proj', fakeProbe());
    const missing = rep.findings.filter((x) => x.id === 'missing-input-file');
    expect(missing.length).to.equal(1);
    expect(missing[0].evidence).to.contain('dem_filename');
  });

  it('count-gates extbc_file on num_extbc (skip when 0, flag when >0)', () => {
    const gated = parseTritonCfg('num_extbc=0\nextbc_file="input/x.extbc"');
    const repGated = diagnoseTritonDeck(gated, '/proj', fakeProbe());
    expect(repGated.findings.some((x) => x.id === 'missing-input-file')).to.equal(false);
    const active = parseTritonCfg('num_extbc=4\nextbc_file="input/x.extbc"');
    const repActive = diagnoseTritonDeck(active, '/proj', fakeProbe());
    expect(repActive.findings.some((x) => x.id === 'missing-input-file')).to.equal(true);
  });

  it('ranks errors before warnings and reports a clean deck', () => {
    const cleanCfg = parseTritonCfg('sim_duration=3600\ntime_step=0.01\ncourant=0.5\nconst_mann=0.035');
    const rep = diagnoseTritonDeck(cleanCfg, '/proj', fakeProbe());
    expect(rep.findings.length).to.equal(0);
    expect(rep.summary).to.equal('No structural faults found.');
  });
});

describe('diagnoseTritonDeck — forcing coherence', () => {
  it('flags num_runoffs vs runoff-hydrograph column mismatch', () => {
    const cfg = parseTritonCfg('num_runoffs=28\nrunoff_filename="input/roff.hyg"');
    // .hyg has time + 2 value columns → 2, not 28
    const probe = fakeProbe({ files: { '/proj/input/roff.hyg': '% Time(hr) Runoff\n0,1.0,2.0\n3,1.0,2.0\n' } });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    const f = rep.findings.find((x) => x.id === 'runoff-column-mismatch');
    expect(f, 'mismatch finding').to.not.equal(undefined);
    expect(f!.evidence).to.contain('28');
    expect(f!.evidence).to.contain('2');
  });

  it('flags num_sources vs src_loc row mismatch (only when num_sources>0)', () => {
    const cfg = parseTritonCfg('num_sources=3\nsrc_loc_file="input/src.txt"');
    const probe = fakeProbe({ files: { '/proj/input/src.txt': '1 2\n3 4\n' } }); // 2 rows, not 3
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    expect(rep.findings.some((x) => x.id === 'source-count-mismatch')).to.equal(true);
  });

  it('warns when the active runoff forcing is all zero', () => {
    const cfg = parseTritonCfg('num_runoffs=2\nrunoff_filename="input/roff.hyg"');
    const probe = fakeProbe({ files: { '/proj/input/roff.hyg': '% h\n0,0,0\n3,0,0\n' } });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    expect(rep.findings.some((x) => x.id === 'degenerate-forcing' && x.severity === 'warning')).to.equal(true);
  });

  it('accepts a whitespace-delimited runoff hydrograph (delimiter genericity)', () => {
    // time + 2 value columns, whitespace-delimited → 2 value columns == num_runoffs.
    const cfg = parseTritonCfg('num_runoffs=2\nrunoff_filename="input/roff.hyg"');
    const probe = fakeProbe({ files: { '/proj/input/roff.hyg': '0 1 2\n3 1 2\n' } });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    expect(rep.findings.some((x) => x.id === 'runoff-column-mismatch')).to.equal(false);
  });
});

describe('diagnoseTritonDeck — runoff-map zone range (index OOB)', () => {
  // BIN DEM 10x10=100 cells (header); runoff map read as int32 via binIntRange.
  const bin = (extra: string) =>
    parseTritonCfg(['input_format=BIN', 'num_runoffs=2', 'dem_filename="input/dem.bin"', 'runoff_map="input/roff.bin"', extra].join('\n'));
  const demHdr = { '/proj/input/dem.bin': { ncols: 10, nrows: 10, bpc: 4 } };

  it('flags a runoff map whose max id == num_runoffs (1-based map → OOB, the operational bug)', () => {
    const probe = fakeProbe({ binHeaders: demHdr, binIntRanges: { '/proj/input/roff.bin': { min: 1, max: 2 } } });
    const rep = diagnoseTritonDeck(bin(''), '/proj', probe);
    const f = rep.findings.find((x) => x.id === 'runoff-map-zone-range');
    expect(f, 'zone-range finding').to.not.equal(undefined);
    expect(f!.severity).to.equal('error');
    expect(f!.evidence).to.contain('max id=2');
    expect(f!.evidence).to.contain('num_runoffs=2');
  });

  it('accepts a valid 0-based runoff map (max id == num_runoffs-1)', () => {
    const probe = fakeProbe({ binHeaders: demHdr, binIntRanges: { '/proj/input/roff.bin': { min: 0, max: 1 } } });
    const rep = diagnoseTritonDeck(bin(''), '/proj', probe);
    expect(rep.findings.some((x) => x.id === 'runoff-map-zone-range')).to.equal(false);
  });

  it('flags a negative zone id', () => {
    const probe = fakeProbe({ binHeaders: demHdr, binIntRanges: { '/proj/input/roff.bin': { min: -1, max: 1 } } });
    const rep = diagnoseTritonDeck(bin(''), '/proj', probe);
    const f = rep.findings.find((x) => x.id === 'runoff-map-zone-range');
    expect(f, 'negative-id finding').to.not.equal(undefined);
    expect(f!.evidence).to.contain('-1');
  });

  it('defers (no finding) when the runoff map cannot be aligned to the DEM grid (grid check owns it)', () => {
    const probe = fakeProbe({ binHeaders: demHdr, binIntRanges: {} }); // binIntRange returns null
    const rep = diagnoseTritonDeck(bin(''), '/proj', probe);
    expect(rep.findings.some((x) => x.id === 'runoff-map-zone-range')).to.equal(false);
  });

  it('flags an ASC runoff map with an out-of-range integer token', () => {
    const cfg = parseTritonCfg('input_format=ASC\nnum_runoffs=2\ndem_filename="input/dem.asc"\nrunoff_map="input/roff.asc"');
    const probe = fakeProbe({
      headers: { '/proj/input/dem.asc': { ncols: 2, nrows: 2 } },
      files: { '/proj/input/roff.asc': '0 1\n2 1\n' }, // id 2 == num_runoffs → OOB
    });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    const f = rep.findings.find((x) => x.id === 'runoff-map-zone-range');
    expect(f, 'asc zone-range finding').to.not.equal(undefined);
    expect(f!.evidence).to.contain('max id=2');
  });

  it('accepts a valid ASC runoff map (all ids < num_runoffs)', () => {
    const cfg = parseTritonCfg('input_format=ASC\nnum_runoffs=2\ndem_filename="input/dem.asc"\nrunoff_map="input/roff.asc"');
    const probe = fakeProbe({
      headers: { '/proj/input/dem.asc': { ncols: 2, nrows: 2 } },
      files: { '/proj/input/roff.asc': '0 1\n1 0\n' },
    });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    expect(rep.findings.some((x) => x.id === 'runoff-map-zone-range')).to.equal(false);
  });

  it('does not run when num_runoffs is 0', () => {
    const cfg = parseTritonCfg('input_format=BIN\nnum_runoffs=0\ndem_filename="input/dem.bin"\nrunoff_map="input/roff.bin"');
    const probe = fakeProbe({ binHeaders: demHdr, binIntRanges: { '/proj/input/roff.bin': { min: 0, max: 99 } } });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    expect(rep.findings.some((x) => x.id === 'runoff-map-zone-range')).to.equal(false);
  });
});

describe('diagnoseTritonDeck — extbc count integrity', () => {
  it('flags num_extbc != extbc file entry count (ignoring % headers)', () => {
    const cfg = parseTritonCfg('num_extbc=4\nextbc_file="input/x.extbc"');
    const probe = fakeProbe({ files: { '/proj/input/x.extbc': '% BC Type, X1, Y1, X2, Y2, BC\n2,1,2,3,4,0.5\n2,3,4,5,6,0.5\n' } });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    const f = rep.findings.find((x) => x.id === 'extbc-count-mismatch');
    expect(f, 'extbc-count finding').to.not.equal(undefined);
    expect(f!.severity).to.equal('error');
    expect(f!.evidence).to.contain('num_extbc=4');
    expect(f!.evidence).to.contain('entries=2');
  });

  it('accepts a matching extbc count', () => {
    const cfg = parseTritonCfg('num_extbc=2\nextbc_file="input/x.extbc"');
    const probe = fakeProbe({ files: { '/proj/input/x.extbc': '% header\n2,1,2,3,4,0.5\n2,3,4,5,6,0.5\n' } });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    expect(rep.findings.some((x) => x.id === 'extbc-count-mismatch')).to.equal(false);
  });

  it('does not run when num_extbc is 0', () => {
    const cfg = parseTritonCfg('num_extbc=0\nextbc_file="input/x.extbc"');
    const probe = fakeProbe({ files: { '/proj/input/x.extbc': '2,1,2,3,4,0.5\n' } });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    expect(rep.findings.some((x) => x.id === 'extbc-count-mismatch')).to.equal(false);
  });
});

describe('diagnoseTritonDeck — grid coherence', () => {
  it('flags a BIN runoff_map that differs in byte-size from the DEM', () => {
    const cfg = parseTritonCfg('input_format=BIN\nnum_runoffs=1\ndem_filename="input/dem.bin"\nrunoff_map="input/roff.bin"');
    const probe = fakeProbe({ sizes: { '/proj/input/dem.bin': 4000, '/proj/input/roff.bin': 3600 } });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    const f = rep.findings.find((x) => x.id === 'grid-size-mismatch');
    expect(f, 'grid finding').to.not.equal(undefined);
    expect(f!.evidence).to.contain('4000');
    expect(f!.evidence).to.contain('3600');
  });

  it('flags an ASC aux raster whose token count differs from DEM cells', () => {
    // DEM header 3x2 = 6 cells; headerless runoff map has only 5 tokens.
    const cfg = parseTritonCfg('input_format=ASC\nnum_runoffs=1\ndem_filename="input/dem.asc"\nrunoff_map="input/roff.asc"');
    const probe = fakeProbe({
      headers: { '/proj/input/dem.asc': { ncols: 3, nrows: 2 } },
      files: { '/proj/input/roff.asc': '1 2 3 4 5' },
    });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    const f = rep.findings.find((x) => x.id === 'grid-size-mismatch');
    expect(f, 'grid finding').to.not.equal(undefined);
    expect(f!.evidence).to.contain('6 cells');
    expect(f!.evidence).to.contain('5 tokens');
  });

  it('accepts an ASC aux raster whose token count equals DEM cells', () => {
    const cfg = parseTritonCfg('input_format=ASC\nnum_runoffs=1\ndem_filename="input/dem.asc"\nrunoff_map="input/roff.asc"');
    const probe = fakeProbe({
      headers: { '/proj/input/dem.asc': { ncols: 3, nrows: 2 } },
      files: { '/proj/input/roff.asc': '1 2 3\n4 5 6\n' },
    });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    expect(rep.findings.some((x) => x.id === 'grid-size-mismatch')).to.equal(false);
  });

  it('does NOT compare byte-sizes for a GTIFF deck (no false positive)', () => {
    const cfg = parseTritonCfg('input_format=GTIFF\nnum_runoffs=1\ndem_filename="input/dem.tif"\nrunoff_map="input/roff.tif"');
    const probe = fakeProbe({ sizes: { '/proj/input/dem.tif': 4000, '/proj/input/roff.tif': 3600 } });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    expect(rep.findings.some((x) => x.id === 'grid-size-mismatch')).to.equal(false);
  });

  // Real operational decks mix dtypes (float64 DEM, float32 runoff map) and carry small
  // headers, so byte-for-byte equality is wrong. When a same-basename .asc sidecar exists,
  // compare grid cell counts (dtype-independent) instead.
  it('accepts a BIN aux raster of a different dtype when .asc sidecars show the same grid', () => {
    const cfg = parseTritonCfg('input_format=BIN\nnum_runoffs=1\ndem_filename="input/dem.bin"\nrunoff_map="input/roff.bin"');
    const probe = fakeProbe({
      sizes: { '/proj/input/dem.bin': 8192, '/proj/input/roff.bin': 4096 }, // f64 vs f32, same grid
      headers: { '/proj/input/dem.asc': { ncols: 32, nrows: 32 }, '/proj/input/roff.asc': { ncols: 32, nrows: 32 } },
    });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    expect(rep.findings.some((x) => x.id === 'grid-size-mismatch')).to.equal(false);
  });

  it('still flags a BIN grid mismatch when a .asc sidecar shows a different grid (even at equal bytes)', () => {
    const cfg = parseTritonCfg('input_format=BIN\nnum_runoffs=1\ndem_filename="input/dem.bin"\nrunoff_map="input/roff.bin"');
    const probe = fakeProbe({
      sizes: { '/proj/input/dem.bin': 8192, '/proj/input/roff.bin': 8192 }, // equal bytes hide the mismatch
      headers: { '/proj/input/dem.asc': { ncols: 32, nrows: 32 }, '/proj/input/roff.asc': { ncols: 32, nrows: 16 } },
    });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    const f = rep.findings.find((x) => x.id === 'grid-size-mismatch');
    expect(f, 'grid finding').to.not.equal(undefined);
    expect(f!.evidence).to.contain('1024');
    expect(f!.evidence).to.contain('512');
  });

  it('accepts a BIN aux with no sidecar whose bytes fit the DEM grid at float64 (header-tolerant)', () => {
    const cfg = parseTritonCfg('input_format=BIN\nnum_runoffs=0\ndem_filename="input/dem.bin"\nh_infile="input/init_H.out"');
    const probe = fakeProbe({
      sizes: { '/proj/input/dem.bin': 8192, '/proj/input/init_H.out': 8208 }, // 1024*8 + 16 B header
      headers: { '/proj/input/dem.asc': { ncols: 32, nrows: 32 } }, // no sidecar for init_H.out
    });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    expect(rep.findings.some((x) => x.id === 'grid-size-mismatch')).to.equal(false);
  });

  it('flags a BIN aux with no sidecar whose bytes fit neither float32 nor float64 of the DEM grid', () => {
    const cfg = parseTritonCfg('input_format=BIN\nnum_runoffs=0\ndem_filename="input/dem.bin"\nh_infile="input/init_H.out"');
    const probe = fakeProbe({
      sizes: { '/proj/input/dem.bin': 8192, '/proj/input/init_H.out': 99999 }, // implausible for a 1024-cell grid
      headers: { '/proj/input/dem.asc': { ncols: 32, nrows: 32 } },
    });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    expect(rep.findings.some((x) => x.id === 'grid-size-mismatch')).to.equal(true);
  });

  // A real (headered) BIN DEM is self-describing: the tool reads its grid from the binary
  // header, exactly like TRITON, and validates each headerless aux raster against it.
  it('accepts a headerless aux raster that fits the DEM grid read from the BIN header', () => {
    const cfg = parseTritonCfg('input_format=BIN\nnum_runoffs=1\ndem_filename="input/dem.bin"\nrunoff_map="input/roff.bin"');
    const probe = fakeProbe({
      // DEM header says 10x10=100 cells; DEM file = (6+100)*4 B, runoff = 100*4 B (headerless).
      sizes: { '/proj/input/dem.bin': 424, '/proj/input/roff.bin': 400 },
      binHeaders: { '/proj/input/dem.bin': { ncols: 10, nrows: 10, bpc: 4 } },
    });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    expect(rep.findings.some((x) => x.id === 'grid-size-mismatch')).to.equal(false);
  });

  it('flags a headerless aux raster whose cell count differs from the BIN-header DEM grid', () => {
    const cfg = parseTritonCfg('input_format=BIN\nnum_runoffs=1\ndem_filename="input/dem.bin"\nrunoff_map="input/roff.bin"');
    const probe = fakeProbe({
      // DEM header 10x10=100 cells; runoff is an 8x8=64-cell grid (256 B) — a real mismatch,
      // not absorbable padding (fault-grid-bin).
      sizes: { '/proj/input/dem.bin': 424, '/proj/input/roff.bin': 256 },
      binHeaders: { '/proj/input/dem.bin': { ncols: 10, nrows: 10, bpc: 4 } },
    });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    expect(rep.findings.some((x) => x.id === 'grid-size-mismatch')).to.equal(true);
  });
});

describe('diagnoseTritonDeck — temporal & parameter sanity', () => {
  it('warns when the hydrograph ends before sim_duration', () => {
    const cfg = parseTritonCfg('num_runoffs=1\nsim_duration=864000\nrunoff_filename="input/roff.hyg"');
    // max time 3 h = 10800 s << 864000 s
    const probe = fakeProbe({ files: { '/proj/input/roff.hyg': '% h\n0,1\n3,1\n' } });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe);
    expect(rep.findings.some((x) => x.id === 'hydrograph-coverage')).to.equal(true);
  });

  it('warns on out-of-range courant (value-range) and manning (physical)', () => {
    const cfg = parseTritonCfg('courant=1.7\nconst_mann=0.9\nsim_duration=3600\ntime_step=0.01');
    const rep = diagnoseTritonDeck(cfg, '/proj', fakeProbe());
    expect(rep.findings.filter((x) => x.id === 'value-range-sanity').length).to.equal(1); // courant only
    expect(rep.findings.some((x) => x.id === 'manning-out-of-range')).to.equal(true);
  });

  it('admits const_mann=0 (frictionless) but warns on negative / >0.2', () => {
    const zero = diagnoseTritonDeck(parseTritonCfg('const_mann=0.0'), '/proj', fakeProbe());
    expect(zero.findings.some((x) => x.id === 'manning-out-of-range')).to.equal(false);
    expect(zero.findings.some((x) => x.id === 'frictionless-domain')).to.equal(true);
    const neg = diagnoseTritonDeck(parseTritonCfg('const_mann=-0.1'), '/proj', fakeProbe());
    expect(neg.findings.some((x) => x.id === 'manning-out-of-range')).to.equal(true);
    const big = diagnoseTritonDeck(parseTritonCfg('const_mann=0.9'), '/proj', fakeProbe());
    expect(big.findings.some((x) => x.id === 'manning-out-of-range')).to.equal(true);
  });
});

describe('diagnoseTritonDeck — expectations layer', () => {
  it('errors when a user-expected input is missing and when counts differ', () => {
    const cfg = parseTritonCfg('num_runoffs=12\ndem_filename="input/dem.bin"');
    const probe = fakeProbe({ sizes: { '/proj/input/dem.bin': 4000 } });
    const rep = diagnoseTritonDeck(cfg, '/proj', probe, {
      inputs: ['input/site.extbc'],  // not present
      numRunoffs: 28,                // deck says 12
    });
    expect(rep.findings.some((x) => x.id === 'expectation-inputs-present')).to.equal(true);
    const rc = rep.findings.find((x) => x.id === 'expectation-runoff-count');
    expect(rc, 'runoff-count expectation').to.not.equal(undefined);
    expect(rc!.evidence).to.contain('28');
    expect(rc!.evidence).to.contain('12');
  });

  it('runs no expectation checks when expectations are omitted', () => {
    const cfg = parseTritonCfg('num_runoffs=12');
    const rep = diagnoseTritonDeck(cfg, '/proj', fakeProbe());
    expect(rep.findings.some((x) => x.id.startsWith('expectation-'))).to.equal(false);
  });
});

describe('binRasterHeaderCheck', () => {
  const dem = '/proj/input/dem.bin', roff = '/proj/input/roff.bin';
  const cfg = () => parseTritonCfg('input_format=BIN\ndem_filename="input/dem.bin"\nnum_runoffs=2\nrunoff_map="input/roff.bin"\n');
  it('headerless BIN runoff map (exactly demCells int32) -> bin-raster-header error', () => {
    const probe = fakeProbe({ binHeaders: { [dem]: { ncols: 10, nrows: 10, bpc: 8 } }, sizes: { [roff]: 100 * 4 } });
    const f = binRasterHeaderCheck(cfg(), '/proj', probe);
    const hit = f.find((x) => x.id === 'bin-raster-header');
    expect(hit).to.exist; expect(hit!.severity).to.equal('error');
  });
  it('properly-headered BIN runoff map (demCells+2 int32) -> silent', () => {
    const probe = fakeProbe({ binHeaders: { [dem]: { ncols: 10, nrows: 10, bpc: 8 } }, sizes: { [roff]: (100 + 2) * 4 } });
    expect(binRasterHeaderCheck(cfg(), '/proj', probe)).to.deep.equal([]);
  });
  it('ASC format -> silent (not a BIN raster)', () => {
    const ascCfg = parseTritonCfg('input_format=ASC\ndem_filename="input/dem.asc"\nnum_runoffs=2\nrunoff_map="input/roff.asc"\n');
    expect(binRasterHeaderCheck(ascCfg, '/proj', fakeProbe())).to.deep.equal([]);
  });
  it('num_runoffs=0 -> silent', () => {
    const c0 = parseTritonCfg('input_format=BIN\ndem_filename="input/dem.bin"\nnum_runoffs=0\n');
    expect(binRasterHeaderCheck(c0, '/proj', fakeProbe())).to.deep.equal([]);
  });
});

const cfgOf = (body: string) => parseTritonCfg(body);

describe('physicalValidityCheck', () => {
  it('const_mann=0 with no n_infile -> frictionless info (advisory)', () => {
    const f = physicalValidityCheck(cfgOf('const_mann=0.0\nn_infile=""\n'), '.', fakeProbe());
    const hit = f.find((x) => x.id === 'frictionless-domain');
    expect(hit).to.exist; expect(hit!.severity).to.equal('info'); expect(hit!.advisory).to.equal(true);
  });
  it('const_mann=0.5 -> manning-out-of-range warning (advisory)', () => {
    const f = physicalValidityCheck(cfgOf('const_mann=0.5\n'), '.', fakeProbe());
    const hit = f.find((x) => x.id === 'manning-out-of-range');
    expect(hit).to.exist; expect(hit!.severity).to.equal('warning'); expect(hit!.advisory).to.equal(true);
  });
  it('const_mann=0 but n_infile set -> no frictionless (raster overrides)', () => {
    const f = physicalValidityCheck(cfgOf('const_mann=0.0\nn_infile="in/n.asc"\n'), '.', fakeProbe());
    expect(f.find((x) => x.id === 'frictionless-domain')).to.not.exist;
  });
  it('courant=0.9 -> courant-above-recommended warning', () => {
    const f = physicalValidityCheck(cfgOf('courant=0.9\n'), '.', fakeProbe());
    const hit = f.find((x) => x.id === 'courant-above-recommended');
    expect(hit).to.exist; expect(hit!.severity).to.equal('warning'); expect(hit!.advisory).to.equal(true);
  });
  it('courant=0.5 -> silent', () => {
    expect(physicalValidityCheck(cfgOf('courant=0.5\n'), '.', fakeProbe())).to.deep.equal([]);
  });
  it('hextra=0 -> hextra-nonpositive warning', () => {
    const hit = physicalValidityCheck(cfgOf('hextra=0\n'), '.', fakeProbe()).find((x) => x.id === 'hextra-nonpositive');
    expect(hit).to.exist; expect(hit!.severity).to.equal('warning'); expect(hit!.advisory).to.equal(true);
  });
  it('print_interval > sim_duration -> no-raster-output info', () => {
    const f = physicalValidityCheck(cfgOf('sim_duration=10\nprint_interval=20\n'), '.', fakeProbe());
    const hit = f.find((x) => x.id === 'no-raster-output');
    expect(hit).to.exist; expect(hit!.severity).to.equal('info'); expect(hit!.advisory).to.equal(true);
  });
  it('negative runoff value -> negative-runoff warning', () => {
    const probe = { readText: () => '% t z0\n0,0.0\n1,-2.5\n' } as unknown as DiagnosisProbe;
    const cfg = cfgOf('num_runoffs=1\nrunoff_filename="in/roff.hyg"\n');
    const hit = physicalValidityCheck(cfg, '.', probe).find((x) => x.id === 'negative-runoff');
    expect(hit).to.exist; expect(hit!.severity).to.equal('warning'); expect(hit!.advisory).to.equal(true);
  });
  it('nodata sentinel (-9999) is not treated as negative runoff', () => {
    const probe = { readText: () => '% t z0\n0,0.0\n1,-9999\n' } as unknown as DiagnosisProbe;
    const cfg = cfgOf('num_runoffs=1\nrunoff_filename="in/roff.hyg"\n');
    expect(physicalValidityCheck(cfg, '.', probe).find((x) => x.id === 'negative-runoff')).to.not.exist;
  });
  it('ASC DEM with a negative interior cell -> dem-deep-pits warning', () => {
    const dem = 'ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 1\nNODATA_value -9999\n10 11\n12 -5\n';
    const probe = { readText: () => dem } as unknown as DiagnosisProbe;
    const cfg = cfgOf('input_format=ASC\ndem_filename="in/dem.asc"\n');
    const hit = physicalValidityCheck(cfg, '.', probe).find((x) => x.id === 'dem-deep-pits');
    expect(hit).to.exist; expect(hit!.severity).to.equal('warning'); expect(hit!.advisory).to.equal(true);
  });
  it('ASC DEM all-positive -> no dem-deep-pits', () => {
    const dem = 'ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 1\nNODATA_value -9999\n10 11\n12 13\n';
    const probe = { readText: () => dem } as unknown as DiagnosisProbe;
    const cfg = cfgOf('input_format=ASC\ndem_filename="in/dem.asc"\n');
    expect(physicalValidityCheck(cfg, '.', probe).find((x) => x.id === 'dem-deep-pits')).to.not.exist;
  });
  it('ASC DEM with a 5-line header (no NODATA_value) still scans the first data row', () => {
    const dem = 'ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 1\n-3 11\n12 13\n';
    const probe = { readText: () => dem } as unknown as DiagnosisProbe;
    const cfg = cfgOf('input_format=ASC\ndem_filename="in/dem.asc"\n');
    expect(physicalValidityCheck(cfg, '.', probe).find((x) => x.id === 'dem-deep-pits')).to.exist;
  });
});

describe('hydrographDelimiterCheck', () => {
  const roff = '/proj/input/roff.hyg';
  const cfg = () => parseTritonCfg('num_runoffs=2\nrunoff_filename="input/roff.hyg"\n');
  it('whitespace-delimited runoff hyg -> hydrograph-delimiter error', () => {
    const probe = fakeProbe({ files: { [roff]: '% t z0 z1\n0 1.0 1.0\n1 2.0 2.0\n' } });
    const hit = hydrographDelimiterCheck(cfg(), '/proj', probe).find((x) => x.id === 'hydrograph-delimiter');
    expect(hit).to.exist; expect(hit!.severity).to.equal('error');
  });
  it('comma-delimited runoff hyg -> silent', () => {
    const probe = fakeProbe({ files: { [roff]: '% t z0 z1\n0,1.0,1.0\n1,2.0,2.0\n' } });
    expect(hydrographDelimiterCheck(cfg(), '/proj', probe)).to.deep.equal([]);
  });
  it('num_runoffs=0 and no sources -> silent', () => {
    expect(hydrographDelimiterCheck(parseTritonCfg('num_runoffs=0\nnum_sources=0\n'), '/proj', fakeProbe())).to.deep.equal([]);
  });
});
