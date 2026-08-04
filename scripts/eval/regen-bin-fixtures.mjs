#!/usr/bin/env node
// Regenerate the diagnose-corpus BIN fixtures so their rasters are FAITHFUL to real TRITON —
// closing the "BIN-DEM-header gap" and removing a confound that inflated the A-vs-C study gap.
//
// The problem: every BIN fixture shipped a *headerless* DEM (often all-zero placeholder data),
// but real TRITON requires a binary DEM to embed a 6-value header — verified in
// externals/triton/src: load_header_from_dem_file_binary (dem_utils.h:237) reads
// [ncols,nrows,xll,yll,cellsize,nodata] as the leading DEM_HEADER_SIZE(=6) values of the
// matrix's element type, then load_from_binary_file(...,DEM_HEADER_SIZE) skips them and reads
// ncols*nrows data cells (triton_init.h:181/206). The BIN runoff map is the exception: TRITON's
// 3-arg load_from_binary_file overload (triton_init.h:298, matrix_io.h:226) reads
// BIN_DEFAULT_HEADER_SIZE=2 leading INT32 values as [nrows,ncols] (matrix<int>) and VALIDATES them
// against the grid before reading data — so a valid runoff map carries a 2-value header and is
// (2 + ncols*nrows)*4 bytes. The other aux rasters (n, h, qx, qy) are TBD/deferred to the Phase 3
// generator (their header handling isn't implemented in this file yet). So a valid BIN deck has
// demBytes = (6 + cells)*bpc and roffBytes = (2 + cells)*4.
//
// Because the old DEMs were headerless AND frequently all-zero, the bare LLM (Arm C) kept
// diagnosing "binary rasters lack required headers" / "empty/corrupt raster" INSTEAD of the
// intended injected fault — a corpus artifact, not a real single fault. That handed Arm A an
// unfair advantage on BIN fixtures. This regen gives every DEM a real header + gentle non-zero
// relief and every runoff map a genuine 2-zone split, so the ONLY fault in each fixture is the
// intended one. The grid check now reads the DEM header (gridSizeCheck via probe.binHeader),
// exactly like TRITON, so the fixtures stay tool-detectable.
//
// Idempotent. Run from repo root: node scripts/eval/regen-bin-fixtures.mjs
import fs from 'fs';
import path from 'path';

const ROOT = 'eval/diagnose-corpus/fixtures';

// gentle tilted plane (real relief, drains toward one corner), ~1% grade — matches the ASC
// clean fixtures (regen-clean-fixtures.mjs) so BIN and ASC decks are physically comparable.
const BASE = 10.0, GRADE = 0.01;
const elev = (r, c) => BASE - GRADE * (r + 0.3 * c);
// genuine multi-zone runoff map: rows split evenly into `numZones` bands (all declared series used),
// labelled from `zoneBase` (0-based is correct per triton_init.h:1332/1352; zoneBase=1 makes a
// FAULTY 1-based map whose top id == num_runoffs → out-of-bounds, the real corner-blow-up signature).
const zoneId = (r, nrows, numZones, zoneBase) =>
  zoneBase + Math.min(numZones - 1, Math.floor((r * numZones) / nrows));

const CELLSIZE = 1, NODATA = -9999;

// Write a headered BIN DEM: 6-value header [ncols,nrows,xll,yll,cellsize,nodata] + ncols*nrows
// elevation cells, all at `bpc` bytes-per-cell (4=float32, 8=float64). Matches TRITON's reader.
function writeHeaderedDem(file, bpc, ncols, nrows) {
  const header = [ncols, nrows, 0, 0, CELLSIZE, NODATA];
  const total = 6 + ncols * nrows;
  const b = Buffer.alloc(total * bpc);
  const put = (v, i) => (bpc === 8 ? b.writeDoubleLE(v, i * 8) : b.writeFloatLE(v, i * 4));
  header.forEach((v, i) => put(v, i));
  for (let k = 0; k < ncols * nrows; k++) put(elev(Math.floor(k / ncols), k % ncols), 6 + k);
  fs.writeFileSync(file, b);
}

// Write a BIN runoff map: a 2-value INT32 header [nrows,ncols] + ncols*nrows INT32 zone ids.
// TRITON's load_from_binary_file (matrix_io.h) reads BIN_DEFAULT_HEADER_SIZE=2 leading values and
// VALIDATES them as the matrix dimensions — file_row=arr[BIN_ROW_ID=0], file_col=arr[BIN_COL_ID=1] —
// aborting with "Invalid Matrix dimensions" unless rows==file_row && cols==file_col. So a valid
// runoff map MUST embed the 2-value header; a headerless map startup-rejects at load.
// When noHeader is true, write the OLD headerless layout (ncols*nrows int32, no 2-value header) —
// exactly demCells int32, which TRITON's 3-arg loader misreads the first two zone ids as dims and
// rejects with "Invalid Matrix dimensions" (the fault-bin-noheader fixture).
function writeZoneMap(file, ncols, nrows, numZones, zoneBase, noHeader) {
  const hdr = noHeader ? 0 : 2;
  const b = Buffer.alloc((hdr + ncols * nrows) * 4);
  if (!noHeader) {
    b.writeInt32LE(nrows, 0);          // BIN_ROW_ID=0
    b.writeInt32LE(ncols, 4);          // BIN_COL_ID=1
  }
  for (let k = 0; k < ncols * nrows; k++) {
    b.writeInt32LE(zoneId(Math.floor(k / ncols), nrows, numZones, zoneBase), (hdr + k) * 4);
  }
  fs.writeFileSync(file, b);
}

// Write an ESRI ASCII grid (6-line header + rows) that MIRRORS a companion .bin, for the
// sidecar fixture. The header's cellsize/NODATA and the data must match the .bin exactly, so a
// content-reading agent sees a consistent DEM (not a contradictory second one).
function writeAscMirror(file, ncols, nrows, valueFn, integer) {
  const header = [`ncols ${ncols}`, `nrows ${nrows}`, `xllcorner 0`, `yllcorner 0`,
                  `cellsize ${CELLSIZE}`, `NODATA_value ${NODATA}`];
  const rows = [];
  for (let r = 0; r < nrows; r++) {
    const row = [];
    for (let c = 0; c < ncols; c++) { const v = valueFn(r, c); row.push(integer ? String(v) : v.toFixed(2)); }
    rows.push(row.join(' '));
  }
  fs.writeFileSync(file, header.join('\n') + '\n' + rows.join('\n') + '\n');
}

// Per-fixture plan. Defaults: DEM = float64 10x10 headered; runoff = int32 10x10 headered
// 2-zone (same grid → clean). Overrides encode each fixture's intended fault or shape:
//   demBpc/demN: DEM dtype + grid (null demBpc → DEM is intentionally ABSENT, e.g. missing-input)
//   roffN: runoff-map grid (a grid DIFFERENT from the DEM = grid-size-mismatch)
// The default DEM dtype is float64 because this TRITON is built double-precision (value_t=double,
// constants.h:45): dem_file<double> reads the 6-value DEM header AND data as double, so a float32
// DEM is misread into garbage org_rows/org_cols (dem_utils.h:237, triton_init.h:189). That garbage
// then fails the runoff map's dimension validation (matrix_io.h:246) — the real reason float32 BIN
// decks startup-reject. A float64 DEM matches the build and reads cleanly.
const DEF = { demBpc: 8, demN: [10, 10], roffN: [10, 10], numZones: 2, zoneBase: 0, noHeader: false };
const PLAN = {
  'fault-placeholder': {},
  'fault-missing-input': { demBpc: null },                     // DEM absent → missing-input-file
  'fault-runoff-count': {},                                    // fault lives in num_runoffs vs hyg cols
  'fault-source-count': {},                                    // fault lives in src.txt / num_sources
  'fault-runoff-zone-oob': { zoneBase: 1 },                    // 1-based map (ids 1..2), num_runoffs=2 → max id==2 OOB
  'fault-extbc-count': {},                                     // runoff clean; fault lives in num_extbc vs .extbc rows
  'fault-grid-bin': { roffN: [8, 8] },                         // runoff grid != DEM grid
  'fault-bin-noheader': { noHeader: true },                    // runoff map written headerless (exactly demCells int32) → startup-reject
  'fault-grid-sidecar': { demBpc: 8, demN: [32, 32], roffN: [32, 16] }, // sidecar grids differ
  'fault-degenerate': {},                                      // fault lives in all-zero hyg VALUES
  'fault-coverage': {},                                        // fault lives in short hyg time range
  'fault-value-range': {},                                     // fault lives in courant
  'exp-inputs': {}, 'exp-runoff-count': {}, 'exp-source-count': {},
  'exp-sim-duration': {}, 'exp-forcing-range': {},             // faults live only in manifest expectations
  'clean-bin': {}, 'clean-frictionless': {}, 'fault-whitespace-hyg': {},
  'clean-runoff-zone': { numZones: 3 },                        // valid 0-based 3-zone map (ids 0..2), num_runoffs=3
  'clean-bin-sidecar': { demBpc: 8, demN: [32, 32], roffN: [32, 32], sidecar: true }, // dtype-mixed, same grid; .asc sidecars MIRROR the .bin
};

for (const [dir, ov] of Object.entries(PLAN)) {
  const p = { ...DEF, ...ov };
  const inDir = path.join(ROOT, dir, 'input');
  if (p.demBpc !== null) writeHeaderedDem(path.join(inDir, 'dem.bin'), p.demBpc, p.demN[0], p.demN[1]);
  writeZoneMap(path.join(inDir, 'roff.bin'), p.roffN[0], p.roffN[1], p.numZones, p.zoneBase, p.noHeader);
  if (p.sidecar) {
    // .asc sidecars mirror the .bin exactly (same cellsize + data) so the DEM has one consistent
    // representation — fixes the stale dem.asc (cellsize=12) that agents rightly flagged.
    writeAscMirror(path.join(inDir, 'dem.asc'), p.demN[0], p.demN[1],
      (r, c) => elev(r, c), false);
    writeAscMirror(path.join(inDir, 'roff.asc'), p.roffN[0], p.roffN[1],
      (r) => zoneId(r, p.roffN[1], p.numZones, p.zoneBase), true);
  }
  const ids = `${p.zoneBase}..${p.zoneBase + p.numZones - 1}`;
  console.log(`regenerated ${dir}: dem=${p.demBpc ? `f${p.demBpc * 8} ${p.demN.join('x')}+hdr` : 'ABSENT'} roff=int32 ${p.roffN.join('x')} ids[${ids}]`);
}
console.log('done — headered non-zero DEMs + int32 zone maps (faithful to matrix<int>); each fixture keeps ONLY its intended fault.');
