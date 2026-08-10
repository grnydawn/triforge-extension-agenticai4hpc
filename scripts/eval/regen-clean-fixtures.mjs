#!/usr/bin/env node
// Regenerate the diagnose-corpus "clean" fixtures so they are GENUINELY clean — a valid
// "don't cry wolf" control where a correct deck should yield "no structural fault".
//
// Why they weren't clean: agents (which, unlike the structural tool, read raster CONTENT) flagged
// real problems the tool ignores — every clean fixture had (a) a perfectly flat DEM (no hydraulic
// gradient → "no flow") and (b) num_runoffs=2 while the runoff MAP used a single area, so one of
// the two declared runoff series was spatially unused. Both are genuine; the tool only checks
// hyg-column-count vs num_runoffs and byte sizes, so it reported clean and the agents "beat" it.
//
// TRITON runoff-map convention (verified in externals/triton/src: triton_init.h:1332/1352,
// kernels.h:134): each map cell holds a 0-BASED area index in [0, num_runoffs-1]; area k reads
// hydrograph column k+1 (column 0 is time). So for num_runoffs=2 a correct map uses BOTH ids 0 and
// 1. An all-same map (all 0 or all 1) leaves an area unused (and all-1 under num_runoffs=1 is
// out of bounds) — exactly what agents flagged.
//
// Fix (keeps the original num_runoffs=2 + 2-column hydrograph intent): give the DEM a gentle,
// realistic tilt, and make the runoff map a genuine 2-zone split (top half area 0, bottom half
// area 1) so both declared series are used. Byte lengths are preserved, so every grid-size check
// still passes. Each fixture's special trait is untouched: frictionless (const_mann=0),
// whitespace-hyg, GTIFF, and the dtype-mixed f64-DEM/f32-runoff sidecar.
//
// Idempotent. Run from repo root: node scripts/eval/regen-clean-fixtures.mjs
import fs from 'fs';
import path from 'path';

const ROOT = 'eval/diagnose-corpus/fixtures';

// gentle tilted plane (real relief, drains toward one corner). ~1% grade — non-flat but not absurd
// (a first attempt used a 50→1 m ramp over a 10 m grid = ~495% grade, which agents correctly flagged).
const BASE = 10.0, GRADE = 0.01;
const elev = (r, c, dx) => BASE - GRADE * dx * (r + 0.3 * c);
// genuine 2-zone runoff map: top half → area 0, bottom half → area 1 (both declared series used)
const zone = (r, _c, nrows) => (r < nrows / 2 ? 0 : 1);

// Fill a headerless raster binary (dtype = itemBytes) via valueFn(r,c); trailing slop (file longer
// than the grid) repeats the last grid value. Preserves exact byte length.
function writeBin(file, itemBytes, ncols, nrows, valueFn) {
  const total = Math.floor(fs.statSync(file).size / itemBytes);
  const b = Buffer.alloc(total * itemBytes);
  for (let i = 0; i < total; i++) {
    const inGrid = i < ncols * nrows;
    const r = inGrid ? Math.floor(i / ncols) : nrows - 1;
    const c = inGrid ? i % ncols : ncols - 1;
    const v = valueFn(r, c);
    itemBytes === 8 ? b.writeDoubleLE(v, i * 8) : b.writeFloatLE(v, i * 4);
  }
  fs.writeFileSync(file, b);
}
// Fill an .asc grid via valueFn(r,c). Some fixtures ship a headerless map (bare tokens), others an
// ESRI 6-line header — detect and preserve it. `integer` controls token formatting (zone map vs DEM).
function writeAsc(file, ncols, nrows, valueFn, integer) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\n$/, '').split('\n');
  const hasHeader = /^\s*ncols/i.test(lines[0]);
  const header = hasHeader ? lines.slice(0, 6) : [];
  const rows = [];
  for (let r = 0; r < nrows; r++) {
    const row = [];
    for (let c = 0; c < ncols; c++) {
      const v = valueFn(r, c);
      row.push(integer ? String(v) : v.toFixed(2));
    }
    rows.push(row.join(' '));
  }
  fs.writeFileSync(file, (hasHeader ? header.join('\n') + '\n' : '') + rows.join('\n') + '\n');
}

// dem/roff entries: [kind, file, ncols, nrows, dx]; kinds: asc | bin4 (f32) | bin8 (f64).
// NOTE: the BIN fixtures (clean-bin, clean-frictionless, fault-whitespace-hyg, clean-bin-sidecar)
// moved to scripts/eval/regen-bin-fixtures.mjs, which writes REAL 6-value DEM headers (this script
// wrote headerless byte-length-preserving rasters). This script now owns only the ASC-headered and
// GTIFF-skipped clean fixtures. Do not re-add BIN entries here or they will revert to headerless.
// NOTE: clean-gtiff was REMOVED — TRITON does not accept input_format=GTIFF for input (BIN/ASC
// only), so a "clean GTIFF deck" is a contradiction, not a valid control. It was replaced by
// clean-asc-wide, a plain non-square ASC clean deck (below).
const FIXTURES = [
  { dir: 'clean-asc',            dem: [['asc',  'dem.asc', 10, 10, 1]], roff: [['asc',  'roff.asc', 10, 10, 1]] },
  { dir: 'clean-asc-wide',       dem: [['asc',  'dem.asc', 12, 8,  1]], roff: [['asc',  'roff.asc', 12, 8,  1]] },
];

for (const fx of FIXTURES) {
  const d = path.join(ROOT, fx.dir);
  for (const [kind, name, ncols, nrows, dx] of fx.dem) {
    const f = path.join(d, 'input', name);
    const demFn = (r, c) => elev(r, c, dx);
    if (kind === 'asc') writeAsc(f, ncols, nrows, demFn, false);
    else writeBin(f, kind === 'bin8' ? 8 : 4, ncols, nrows, demFn);
  }
  for (const [kind, name, ncols, nrows] of fx.roff) {
    const f = path.join(d, 'input', name);
    const mapFn = (r, c) => zone(r, c, nrows);
    if (kind === 'asc') writeAsc(f, ncols, nrows, mapFn, true);
    else writeBin(f, kind === 'bin8' ? 8 : 4, ncols, nrows, mapFn);
  }
  console.log(`regenerated ${fx.dir}`);
}
console.log('done — tilted DEMs + genuine 2-zone runoff maps (areas 0 & 1 both used); num_runoffs=2 intent preserved.');
