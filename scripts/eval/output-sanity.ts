// Tier-2 of the three-tier fixture ground-truth (see docs .../three-tier-*): after the
// solver RAN TO COMPLETION (Tier-1), scan its output rasters for gross physical
// impossibility. This is the automated step between "the solver rejected it" (Tier-1,
// authoritative fault) and "a human confirms it" (Tier-3). It exists because a completed
// run does NOT mean a clean deck: the operational out-of-bounds runoff-zone read on a small grid
// COMPLETES while filling the domain with a ~1e214 m constant block. Tier-2 catches the
// obvious corruption automatically; anything borderline it escalates to a human ("review"),
// never silently to "clean".
//
// Verdict is three-state, and the rule is FAIL TOWARD THE HUMAN:
//   insane  -> automatic FAULT (non-finite cells, or magnitude past the hard ceiling)
//   review  -> escalate to Tier-3 human audit (constant block, soft-ceiling magnitude, all-zero)
//   sane    -> candidate-clean, still needs Tier-3 sign-off before earning the "clean" label
//
// Run: npx ts-node scripts/eval/output-sanity.ts <run-output-dir>
//   (or on a fixture whose run preserved output/, e.g. via scan-fixture-output.sh)
import * as fs from 'fs';
import * as path from 'path';

// |value| above this is non-physical for any flood field on these test domains; it is the
// signature of an out-of-bounds table read (the real operational block was ~1.5e214 m; the
// exact magnitude is heap-dependent and moved when the run was redone, so nothing keys on it).
export const HARD_CEILING = 1e6;
// Suspicious but not absurd depth/height/velocity; a human should look.
export const SOFT_CEILING = 1e3;
// A single finite non-zero value repeated across at least this fraction of cells (and at
// least BLOCK_MIN_CELLS) reads as a constant block, not a physical field (physical fields
// are almost all distinct floats, so a real field's mode count is tiny).
export const BLOCK_FRACTION = 0.01;
export const BLOCK_MIN_CELLS = 64;
// |value| <= this counts as dry/zero (excluded from the constant-block mode; used for the
// all-zero check).
export const ZERO_EPS = 1e-9;
// Above this many cells, skip the exact-mode scan (memory guard); real corpus fixtures are
// tiny, this only trips on operational-scale rasters, where we note the skip rather than
// silently pass.
export const MODE_SCAN_MAX = 5_000_000;

export type Verdict = 'sane' | 'review' | 'insane';

export interface ValueScan {
  cells: number;
  min: number;
  max: number;
  nonFinite: number;
  modeValue: number | null;
  modeCount: number;
  verdict: Verdict;
  reasons: string[];
}

export interface RasterScan extends ValueScan {
  file: string;
  kind: 'asc' | 'bin' | 'unknown';
  rows: number;
  cols: number;
}

const worse = (a: Verdict, b: Verdict): Verdict => {
  const rank: Record<Verdict, number> = { sane: 0, review: 1, insane: 2 };
  return rank[a] >= rank[b] ? a : b;
};

/** Scan a flat array of cell values for the Tier-2 impossibility signals. Pure. */
export function scanValues(values: ArrayLike<number>): ValueScan {
  const cells = values.length;
  let min = Infinity;
  let max = -Infinity;
  let nonFinite = 0;
  let allZero = true;

  const trackMode = cells <= MODE_SCAN_MAX;
  const freq = new Map<number, number>();
  let modeValue: number | null = null;
  let modeCount = 0;

  for (let i = 0; i < cells; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      nonFinite++;
      continue;
    }
    if (v < min) min = v;
    if (v > max) max = v;
    if (Math.abs(v) > ZERO_EPS) {
      allZero = false;
      if (trackMode) {
        const c = (freq.get(v) ?? 0) + 1;
        freq.set(v, c);
        if (c > modeCount) {
          modeCount = c;
          modeValue = v;
        }
      }
    }
  }

  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 0;

  const reasons: string[] = [];
  let verdict: Verdict = 'sane';

  if (nonFinite > 0) {
    verdict = worse(verdict, 'insane');
    reasons.push(`${nonFinite} non-finite cell(s) (NaN/Inf) — silent divergence`);
  }

  const absMax = Math.max(Math.abs(min), Math.abs(max));
  if (absMax > HARD_CEILING) {
    verdict = worse(verdict, 'insane');
    reasons.push(`magnitude ${absMax.toExponential(3)} exceeds hard ceiling ${HARD_CEILING.toExponential(0)} — out-of-bounds read signature`);
  } else if (absMax > SOFT_CEILING) {
    verdict = worse(verdict, 'review');
    reasons.push(`magnitude ${absMax.toExponential(3)} above soft ceiling ${SOFT_CEILING.toExponential(0)} — physically suspicious`);
  }

  const blockThreshold = Math.max(BLOCK_MIN_CELLS, Math.ceil(BLOCK_FRACTION * cells));
  if (trackMode && modeValue !== null && modeCount >= blockThreshold) {
    verdict = worse(verdict, 'review');
    reasons.push(`constant block: ${modeCount}/${cells} cells all = ${modeValue} — possible corruption`);
  }
  if (!trackMode) {
    reasons.push(`mode scan skipped (${cells} cells > ${MODE_SCAN_MAX}); constant-block check not run`);
  }

  if (allZero && cells > 0) {
    verdict = worse(verdict, 'review');
    reasons.push('output is entirely zero — nothing happened (dry, or forcing never applied)');
  }

  return { cells, min, max, nonFinite, modeValue, modeCount, verdict, reasons };
}

/** Parse a TRITON ASCII output raster: bare space-separated matrix, no header. */
export function parseAsciiRaster(text: string): { values: number[]; rows: number; cols: number } {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const rows = lines.length;
  const values: number[] = [];
  let cols = 0;
  for (const line of lines) {
    const toks = line.split(/\s+/);
    if (cols === 0) cols = toks.length;
    for (const t of toks) values.push(Number(t)); // 'nan'/'inf' -> NaN -> flagged non-finite
  }
  return { values, rows, cols };
}

/** Parse a TRITON binary output raster: 2-value [nrows,ncols] header in T, then data.
 *  This build is double precision (T=float64); a float32 fallback is kept for robustness. */
export function parseBinRaster(buf: Buffer): { values: number[]; rows: number; cols: number; kind: 'bin' | 'unknown' } {
  const isPosInt = (x: number) => Number.isFinite(x) && x > 0 && Number.isInteger(x);

  // float64 header + float64 data
  if (buf.length >= 16 && (buf.length - 16) % 8 === 0) {
    const rows = buf.readDoubleLE(0);
    const cols = buf.readDoubleLE(8);
    if (isPosInt(rows) && isPosInt(cols) && rows * cols * 8 + 16 === buf.length) {
      const values: number[] = new Array(rows * cols);
      for (let i = 0; i < rows * cols; i++) values[i] = buf.readDoubleLE(16 + i * 8);
      return { values, rows, cols, kind: 'bin' };
    }
  }
  // float32 header + float32 data
  if (buf.length >= 8 && (buf.length - 8) % 4 === 0) {
    const rows = buf.readFloatLE(0);
    const cols = buf.readFloatLE(4);
    if (isPosInt(rows) && isPosInt(cols) && rows * cols * 4 + 8 === buf.length) {
      const values: number[] = new Array(rows * cols);
      for (let i = 0; i < rows * cols; i++) values[i] = buf.readFloatLE(8 + i * 4);
      return { values, rows, cols, kind: 'bin' };
    }
  }
  return { values: [], rows: 0, cols: 0, kind: 'unknown' };
}

/** A file is binary if its first bytes contain a NUL — ASCII output never does, and
 *  TRITON's float64/float32 rasters almost always do. */
function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 1024);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Collect every *.out file under a directory tree (TRITON's output location depends on
 *  `outfile_pattern`: it may be output/{asc,bin}/<var>_<id>.out, or a bare .out at the run
 *  root when the pattern is unset — so we search the whole tree, not a fixed subdir). */
function findOutFiles(root: string): Array<{ abs: string; rel: string }> {
  const out: Array<{ abs: string; rel: string }> = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const st = fs.statSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (name.endsWith('.out')) out.push({ abs, rel: path.relative(root, abs) });
    }
  };
  if (fs.existsSync(root) && fs.statSync(root).isDirectory()) walk(root);
  return out;
}

/** Scan every *.out raster under a run directory, auto-detecting binary vs ASCII. */
export function scanOutputDir(runDir: string): { verdict: Verdict; rasters: RasterScan[]; reasons: string[] } {
  const rasters: RasterScan[] = [];

  for (const { abs, rel } of findOutFiles(runDir)) {
    const buf = fs.readFileSync(abs);
    let parsed: { values: number[]; rows: number; cols: number; kind: 'asc' | 'bin' | 'unknown' };
    if (looksBinary(buf)) {
      parsed = parseBinRaster(buf);
    } else {
      const p = parseAsciiRaster(buf.toString('utf8'));
      parsed = { ...p, kind: 'asc' };
    }
    if (parsed.kind === 'unknown' || parsed.values.length === 0) {
      rasters.push({
        file: rel, kind: 'unknown', rows: parsed.rows, cols: parsed.cols,
        cells: 0, min: 0, max: 0, nonFinite: 0, modeValue: null, modeCount: 0,
        verdict: 'review', reasons: ['unparseable or empty output raster'],
      });
      continue;
    }
    const scan = scanValues(parsed.values);
    rasters.push({ file: rel, kind: parsed.kind as 'asc' | 'bin', rows: parsed.rows, cols: parsed.cols, ...scan });
  }

  let verdict: Verdict = rasters.length === 0 ? 'review' : 'sane';
  const reasons: string[] = [];
  if (rasters.length === 0) reasons.push('no output rasters found — did the run write output?');
  for (const r of rasters) {
    verdict = worse(verdict, r.verdict);
    for (const why of r.reasons) reasons.push(`${r.file}: ${why}`);
  }
  return { verdict, rasters, reasons };
}

const EXIT: Record<Verdict, number> = { sane: 0, review: 1, insane: 2 };

function main(): void {
  const outputDir = process.argv[2];
  if (!outputDir) {
    // eslint-disable-next-line no-console
    console.error('usage: output-sanity.ts <run-output-dir>');
    process.exit(64);
  }
  const result = scanOutputDir(outputDir);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  process.exit(EXIT[result.verdict]);
}

if (require.main === module) main();
