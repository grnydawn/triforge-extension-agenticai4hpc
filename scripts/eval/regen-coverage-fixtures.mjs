#!/usr/bin/env node
// Regenerate the Phase-3 COVERAGE fixtures — the diagnose-corpus over-covers runoff maps and had
// NO clean deck exercising point SOURCES, and no deck exercising the `ran-but-diverged` oracle
// outcome. This generator (deterministic, no RNG) writes three TRITON-valid fixtures:
//
//   FIXTURE                fmt  family   condition  oracle              tool expectation
//   ---------------------  ---  -------  ---------  ------------------  -----------------------------
//   clean-sources-asc      ASC  sources  clean      ran-to-completion   NO finding (clean control)
//   clean-sources-bin      BIN  sources  clean      ran-to-completion   NO finding (clean control)
//   diverge-runoff-oob     ASC  runoff   physical   ran-but-diverged    runoff-map-zone-range (isolated)
//
// Format facts (verified against real TRITON source + prior oracle runs):
//  - ASC DEM: 6-line ESRI header (ncols/nrows/xllcorner/yllcorner/cellsize/NODATA_value) + matrix.
//  - BIN DEM: this build is DOUBLE precision — float64 with a 6-value header
//    [ncols,nrows,xll,yll,cellsize,nodata]; file bytes = (6 + ncols*nrows)*8.
//  - ASC runoff map: HEADERLESS integer matrix (ncols*nrows tokens).
//  - .src (src_loc_file): comma-delimited X,Y per source, one row per source, %-comment header.
//    Coords are in the DEM's projected space and MUST be INSIDE the domain.
//  - .hyg: COMMA-delimited. Source row = Time,Discharge1..; runoff row = Time,Zone0,Zone1..;
//    Time is in HOURS. TRITON splits on commas ONLY.
//  - .src/.hyg text is identical in ASC and BIN mode; only rasters differ.
//
// The runoff-OOB deck sets one map cell to a HUGE zone id (100000000), far past num_runoffs=2. TRITON
// indexes the 0-based runoff table by that id with NO bounds check (kernels.h:134), so it reads far
// out of bounds and SIGSEGVs mid-run (after "Simulation starts") → the oracle's ran-but-diverged.
// (A zone id merely ONE past num_runoffs reads adjacent memory and usually completes silently; only a
// far-OOB id reliably crashes.)
//
// Idempotent. Run from repo root: node scripts/eval/regen-coverage-fixtures.mjs
import fs from 'fs';
import path from 'path';

const ROOT = 'eval/diagnose-corpus/fixtures';

// Grid + common physics shared by all three decks.
const NCOLS = 10, NROWS = 10, CELLSIZE = 1, NODATA = -9999;
// gently sloped positive elevations (drains toward the origin corner) — a real hydraulic gradient.
const elev = (r, c) => 10 - 0.01 * (r + 0.3 * c);

const COMMON = [
  'sim_duration=3600',
  'time_step=0.01',
  'courant=0.5',
  'const_mann=0.035',
  'print_interval=900',
];

// --- writers -------------------------------------------------------------------------------------

// ESRI ASCII grid: 6-line header + rows. `integer` toggles token formatting (DEM floats vs zone ints).
function writeAscGrid(file, valueFn, integer) {
  const header = [`ncols ${NCOLS}`, `nrows ${NROWS}`, `xllcorner 0`, `yllcorner 0`,
                  `cellsize ${CELLSIZE}`, `NODATA_value ${NODATA}`];
  const rows = [];
  for (let r = 0; r < NROWS; r++) {
    const row = [];
    for (let c = 0; c < NCOLS; c++) { const v = valueFn(r, c); row.push(integer ? String(v) : v.toFixed(2)); }
    rows.push(row.join(' '));
  }
  fs.writeFileSync(file, header.join('\n') + '\n' + rows.join('\n') + '\n');
}

// HEADERLESS integer matrix (ncols*nrows tokens) — the ASC runoff-map layout TRITON expects.
function writeAscRunoffMap(file, valueFn) {
  const rows = [];
  for (let r = 0; r < NROWS; r++) {
    const row = [];
    for (let c = 0; c < NCOLS; c++) row.push(String(valueFn(r, c)));
    rows.push(row.join(' '));
  }
  fs.writeFileSync(file, rows.join('\n') + '\n');
}

// Headered float64 BIN DEM: 6-value header [ncols,nrows,xll,yll,cellsize,nodata] + ncols*nrows
// elevation cells, all as float64 (this build is double precision). Matches TRITON's reader.
function writeHeaderedDemBin(file) {
  const header = [NCOLS, NROWS, 0, 0, CELLSIZE, NODATA];
  const total = 6 + NCOLS * NROWS;
  const b = Buffer.alloc(total * 8);
  header.forEach((v, i) => b.writeDoubleLE(v, i * 8));
  for (let k = 0; k < NCOLS * NROWS; k++) b.writeDoubleLE(elev(Math.floor(k / NCOLS), k % NCOLS), (6 + k) * 8);
  fs.writeFileSync(file, b);
}

// BIN aux raster (h/qx/qy/n) as TRITON's 3-arg load_from_binary_file expects: a 2-value
// [nrows,ncols] DOUBLE header (BIN_DEFAULT_HEADER_SIZE=2) it validates against the grid, then
// ncols*nrows float64 cells. Bytes = (2 + ncols*nrows)*8 (816 B for 10x10). Same reader that
// loads the DEM here is double precision, so the header and cells are all float64.
function writeBinAuxRaster(file, valueFn) {
  const total = 2 + NCOLS * NROWS;
  const b = Buffer.alloc(total * 8);
  b.writeDoubleLE(NROWS, 0);
  b.writeDoubleLE(NCOLS, 8);
  for (let k = 0; k < NCOLS * NROWS; k++) b.writeDoubleLE(valueFn(Math.floor(k / NCOLS), k % NCOLS), (2 + k) * 8);
  fs.writeFileSync(file, b);
}

// BIN runoff map: a 2-value [nrows,ncols] INT32 header + ncols*nrows int32 zone ids. Bytes =
// (2 + ncols*nrows)*4 (408 B for 10x10). Distinct from the DOUBLE aux-raster loader above.
function writeBinRunoffMap(file, valueFn) {
  const total = 2 + NCOLS * NROWS;
  const b = Buffer.alloc(total * 4);
  b.writeInt32LE(NROWS, 0);
  b.writeInt32LE(NCOLS, 4);
  for (let k = 0; k < NCOLS * NROWS; k++) b.writeInt32LE(valueFn(Math.floor(k / NCOLS), k % NCOLS), (2 + k) * 4);
  fs.writeFileSync(file, b);
}

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function writeText(file, lines) { fs.writeFileSync(file, lines.join('\n') + '\n'); }

// --- fixture builders ----------------------------------------------------------------------------

// A clean point-source deck: 1 source at (5.5,5.5) inside [0,10]^2, a steady 1.0 cms hydrograph,
// num_runoffs=0 (no runoff map). `fmt` selects the DEM raster; the .src/.hyg text is identical.
function buildCleanSources(dir, fmt) {
  const base = path.join(ROOT, dir);
  const input = path.join(base, 'input');
  ensureDir(input);
  const demName = fmt === 'BIN' ? 'input/dem.bin' : 'input/dem.asc';
  writeText(path.join(base, 'run.cfg'), [
    `input_format=${fmt}`,
    `dem_filename="${demName}"`,
    'num_sources=1',
    'hydrograph_filename="input/src.hyg"',
    'src_loc_file="input/src.loc"',
    'num_runoffs=0',
    ...COMMON,
  ]);
  if (fmt === 'BIN') writeHeaderedDemBin(path.join(input, 'dem.bin'));
  else writeAscGrid(path.join(input, 'dem.asc'), elev, false);
  // %-comment header + one comma-delimited X,Y inside the domain.
  writeText(path.join(input, 'src.loc'), ['%X-Location,Y-Location', '5.5,5.5']);
  // one discharge column (num_sources=1), steady 1.0 cms, hours axis covering the 1 h sim.
  writeText(path.join(input, 'src.hyg'), ['% Time(hr) Discharge(cms)', '0,1.0', '1,1.0']);
}

// A runoff deck that genuinely blows up mid-run: one map cell holds a zone id far past num_runoffs=2,
// so TRITON reads the runoff table far out of bounds and SIGSEGVs after "Simulation starts".
function buildDivergeRunoffOob(dir) {
  const base = path.join(ROOT, dir);
  const input = path.join(base, 'input');
  ensureDir(input);
  writeText(path.join(base, 'run.cfg'), [
    'input_format=ASC',
    'dem_filename="input/dem.asc"',
    'num_runoffs=2',
    'runoff_map="input/roff.asc"',
    'runoff_filename="input/roff.hyg"',
    'num_sources=0',
    ...COMMON,
  ]);
  writeAscGrid(path.join(input, 'dem.asc'), elev, false);
  // headerless integer map, all 0 EXCEPT one far-OOB id at the domain interior.
  const OOB = 100000000, HOT_R = 5, HOT_C = 5;
  writeAscRunoffMap(path.join(input, 'roff.asc'), (r, c) => (r === HOT_R && c === HOT_C ? OOB : 0));
  // two runoff zone columns (num_runoffs=2), commas only, hours axis.
  writeText(path.join(input, 'roff.hyg'), ['% Time(hr) Runoff(mm/hr)', '0,1.0,1.0', '1,2.0,2.0']);
}

// A clean deck driven by a SPATIAL Manning's-n raster (n_infile) instead of const_mann: every
// cell holds n=0.035 as a headerless ASC matrix (same layout as the runoff map). num_runoffs=2
// keeps a simple runoff forcing so water actually moves. n_infile is what's under test — gridSizeCheck
// never grid-checks it, and frictionless-domain cannot fire because a Manning raster is present.
function buildCleanManningRasterAsc(dir) {
  const base = path.join(ROOT, dir);
  const input = path.join(base, 'input');
  ensureDir(input);
  writeText(path.join(base, 'run.cfg'), [
    'input_format=ASC',
    'dem_filename="input/dem.asc"',
    'n_infile="input/mann.asc"',
    'num_runoffs=2',
    'runoff_map="input/roff.asc"',
    'runoff_filename="input/roff.hyg"',
    'num_sources=0',
    ...COMMON,
  ]);
  writeAscGrid(path.join(input, 'dem.asc'), elev, false);
  // headerless 10x10 Manning matrix, uniform n=0.035 (a physically ordinary floodplain roughness).
  writeAscRunoffMap(path.join(input, 'mann.asc'), () => '0.035');
  // headerless zone map: top half zone 0, bottom half zone 1.
  writeAscRunoffMap(path.join(input, 'roff.asc'), (r) => (r < NROWS / 2 ? 0 : 1));
  writeText(path.join(input, 'roff.hyg'), ['% Time(hr) Runoff(mm/hr)', '0,1.0,1.0', '1,2.0,2.0']);
}

// A clean BIN deck with an INITIAL-CONDITION depth raster (h_infile): a hot start with 0.1 m of
// water everywhere. inith.bin is a 2-value float64-header aux raster (816 B); roff.bin is the
// int32-header runoff map (408 B). gridSizeCheck DOES check h_infile in BIN — 816 B is within the
// header tolerance of the 100-cell f64 grid (800 B), so it stays silent.
function buildCleanInitcondBin(dir) {
  const base = path.join(ROOT, dir);
  const input = path.join(base, 'input');
  ensureDir(input);
  writeText(path.join(base, 'run.cfg'), [
    'input_format=BIN',
    'dem_filename="input/dem.bin"',
    'h_infile="input/inith.bin"',
    'num_runoffs=2',
    'runoff_map="input/roff.bin"',
    'runoff_filename="input/roff.hyg"',
    'num_sources=0',
    ...COMMON,
  ]);
  writeHeaderedDemBin(path.join(input, 'dem.bin'));
  writeBinAuxRaster(path.join(input, 'inith.bin'), () => 0.1); // 0.1 m initial depth everywhere
  writeBinRunoffMap(path.join(input, 'roff.bin'), (r) => (r < NROWS / 2 ? 0 : 1));
  writeText(path.join(input, 'roff.hyg'), ['% Time(hr) Runoff(mm/hr)', '0,1.0,1.0', '1,2.0,2.0']);
}

// --- run -----------------------------------------------------------------------------------------

buildCleanSources('clean-sources-asc', 'ASC');
console.log('regenerated clean-sources-asc: ASC DEM 10x10 + point source (5.5,5.5), num_runoffs=0');
buildCleanSources('clean-sources-bin', 'BIN');
console.log('regenerated clean-sources-bin: float64 headered DEM 10x10 + point source (5.5,5.5), num_runoffs=0');
buildDivergeRunoffOob('diverge-runoff-oob');
console.log('regenerated diverge-runoff-oob: ASC runoff map with one cell id=100000000 (num_runoffs=2) → far-OOB mid-run SIGSEGV');
buildCleanManningRasterAsc('clean-manning-raster-asc');
console.log('regenerated clean-manning-raster-asc: ASC DEM + headerless Manning raster (n=0.035), 2-zone runoff');
buildCleanInitcondBin('clean-initcond-bin');
console.log('regenerated clean-initcond-bin: float64 DEM + BIN initial-depth raster (0.1 m hot start), 2-zone runoff');
console.log('done — point-source coverage (ASC/BIN) + ran-but-diverged runoff deck + Manning-raster + initial-condition decks.');
