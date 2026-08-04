// src/services/diagnostics.ts
// Pure TRITON-deck diagnostics. NO vscode / no fs: all filesystem access is via an
// injected DiagnosisProbe, so every check is unit-testable with an in-memory probe.
// `path` (a pure Node builtin for string path math) is the only import.
import * as path from 'path';
import { ParsedCfg } from './tritonCfg';

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  id: string;          // stable slug — scorable by the eval harness
  severity: Severity;
  title: string;       // one line
  detail: string;      // what is wrong
  evidence: string;    // the ACTUAL values/paths — "checked, not guessed"
  pointsTo: string;    // which artifact / pipeline stage to inspect
  /** Advisory physical/heuristic finding: excluded from corpus FP/isolation scoring. */
  advisory?: boolean;
}

export interface DiagnosisReport {
  summary: string;
  findings: Finding[];
}

export interface DiagnosisProbe {
  exists(absPath: string): boolean;
  size(absPath: string): number | null;                       // bytes
  readText(absPath: string): string | null;
  ascHeader(absPath: string): { ncols: number; nrows: number } | null;
  /**
   * Grid of a binary DEM read from its leading 6-value header, exactly as TRITON does
   * (`load_header_from_dem_file_binary`: the first 6 elements are ncols,nrows,xll,yll,
   * cellsize,nodata of the matrix's element type). Returns the grid + bytes-per-cell only
   * when the file size is self-consistent with `(6 + ncols*nrows) * bpc` at float32 or
   * float64 — so a headerless/malformed DEM yields null. Aux rasters are headerless, so
   * this is only meaningful for the DEM.
   */
  binHeader(absPath: string): { ncols: number; nrows: number; bpc: number } | null;
  /**
   * Min/max of a headerless (or small-header) BINARY integer raster read as int32, exactly as
   * TRITON reads the runoff map (`matrix<int>`, matrix_io.h:255). `cells` is the domain grid so
   * the reader can align the data region: total int32 = cells (headerless), cells+2
   * (BIN_DEFAULT_HEADER_SIZE), or cells+6 (DEM-style). Returns null when the file cannot be read
   * or cannot be aligned to `cells` (e.g. a grid mismatch — owned by the grid-size check).
   */
  binIntRange(absPath: string, cells: number): { min: number; max: number } | null;
}

/** Optional user-declared invariants (the "capture user input" layer). */
export interface Expectations {
  inputs?: string[];
  numRunoffs?: number;
  numSources?: number;
  simDurationSec?: number;
  forcingRange?: { min: number; max: number };
}

// --- shared helpers (used by every check) -----------------------------------

/** Generic template-token shapes: `XX..XX` runs or `$NAME$`. No workflow-specific tokens. */
export const PLACEHOLDER_RE = /(X{2,}[^=\s"]*X{2,}|\$[A-Za-z0-9_]+\$)/;

const NODATA = -9999;

/** Path keys a TRITON deck may reference (standard schema). */
const PATH_KEYS = [
  'dem_filename', 'runoff_map', 'runoff_filename', 'hydrograph_filename', 'src_loc_file',
  'n_infile', 'extbc_file', 'observation_loc_file', 'h_infile', 'qx_infile', 'qy_infile',
];

function resolveRel(cfgDir: string, rel: string): string {
  return path.isAbsolute(rel) ? rel : path.join(cfgDir, rel);
}

/** Data rows of a .hyg/.txt: non-empty lines that are not `%`/`#` headers. */
function dataRows(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('%') && !l.startsWith('#'));
}

/** Split a forcing row into tokens — rows may be comma- OR whitespace-delimited. */
function rowTokens(row: string): string[] {
  return row.trim().split(/[,\s]+/).filter(Boolean);
}

/** Value-column count of a hydrograph (columns minus the leading time column). */
function hygValueColumns(text: string): number | null {
  const rows = dataRows(text);
  if (rows.length === 0) return null;
  return rowTokens(rows[0]).length - 1;
}

/** All numeric forcing values (every column after the time column). */
function hygValues(text: string): number[] {
  const out: number[] = [];
  for (const r of dataRows(text)) {
    const parts = rowTokens(r);
    for (let i = 1; i < parts.length; i++) {
      const v = Number(parts[i]);
      if (Number.isFinite(v)) out.push(v);
    }
  }
  return out;
}

/** The time column (first column) of a hydrograph. */
function hygTimes(text: string): number[] {
  const out: number[] = [];
  for (const r of dataRows(text)) {
    const v = Number(rowTokens(r)[0]);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** True when a key is usable as a real path (active, present, not still a placeholder). */
function usablePath(cfg: ParsedCfg, key: string): string | null {
  if (!cfg.isActive(key)) return null;
  const v = cfg.get(key);
  if (!v || PLACEHOLDER_RE.test(v)) return null;
  return v;
}

// --- checks ------------------------------------------------------------------

type Check = (cfg: ParsedCfg, cfgDir: string, probe: DiagnosisProbe, exp?: Expectations) => Finding[];

const placeholderCheck: Check = (cfg) =>
  cfg.activeEntries()
    .filter((e) => PLACEHOLDER_RE.test(e.value))
    .map((e) => ({
      id: 'unsubstituted-placeholder',
      severity: 'error',
      title: `Unsubstituted template placeholder in ${e.key}`,
      detail: 'The value still contains a template token, so the deck was not fully rendered.',
      evidence: `${e.key}=${e.value}`,
      pointsTo: 'the template-substitution step that generates the .cfg',
    }));

// TRITON loads DEM/runoff rasters only as BIN (raw binary + header) or ASC (ESRI ASCII grid); it has
// no GeoTIFF *input* path (GeoTIFF is a Triforge-side/intermediate format, never a solver input). A
// deck declaring input_format=GTIFF (or any other value) cannot load its rasters — a static,
// deck-level fault that would otherwise only surface as a runtime raster-open failure.
const inputFormatCheck: Check = (cfg) => {
  const fmt = (cfg.get('input_format') ?? '').toUpperCase();
  if (fmt === '' || fmt === 'BIN' || fmt === 'ASC') return [];
  return [{
    id: 'unsupported-input-format',
    severity: 'error',
    title: 'Unsupported input_format',
    detail:
      `input_format=${fmt} is not a TRITON input raster format. TRITON reads DEM and runoff ` +
      `rasters only as BIN (raw binary with a header) or ASC (ESRI ASCII grid); GeoTIFF and other ` +
      `formats are not accepted for input, so the solver cannot read the referenced rasters.`,
    evidence: `input_format=${fmt} (valid: BIN, ASC)`,
    pointsTo: 'set input_format to BIN or ASC and provide the rasters in that format',
  }];
};

const missingInputCheck: Check = (cfg, cfgDir, probe) => {
  const out: Finding[] = [];
  const numRunoffs = cfg.getNumber('num_runoffs') ?? 0;
  const numSources = cfg.getNumber('num_sources') ?? 0;
  const numExtbc = cfg.getNumber('num_extbc') ?? 0;
  const timeSeriesFlag = cfg.getNumber('time_series_flag');
  for (const key of PATH_KEYS) {
    const rel = usablePath(cfg, key);
    if (!rel) continue;
    if ((key === 'runoff_map' || key === 'runoff_filename') && numRunoffs <= 0) continue;
    if ((key === 'src_loc_file' || key === 'hydrograph_filename') && numSources <= 0) continue;
    if (key === 'extbc_file' && numExtbc <= 0) continue;
    if (key === 'observation_loc_file' && timeSeriesFlag === 0) continue;
    const abs = resolveRel(cfgDir, rel);
    if (!probe.exists(abs)) {
      out.push({
        id: 'missing-input-file',
        severity: 'error',
        title: `Missing input file: ${key}`,
        detail: 'The deck references a file that does not exist.',
        evidence: `${key}="${rel}" -> ${abs}`,
        pointsTo: 'the stage that stages/copies the input files',
      });
    }
  }
  return out;
};

const runoffColumnCheck: Check = (cfg, cfgDir, probe) => {
  const n = cfg.getNumber('num_runoffs');
  if (n === undefined || n <= 0) return [];
  const rel = usablePath(cfg, 'runoff_filename');
  if (!rel) return [];
  const text = probe.readText(resolveRel(cfgDir, rel));
  if (text === null) return []; // missing handled by missingInputCheck
  const cols = hygValueColumns(text);
  if (cols === null || cols === n) return [];
  return [{
    id: 'runoff-column-mismatch',
    severity: 'error',
    title: 'Runoff zone count does not match the runoff hydrograph',
    detail: `num_runoffs declares ${n} zones but the runoff hydrograph has ${cols} value column(s).`,
    evidence: `num_runoffs=${n}, runoff .hyg value-columns=${cols} (${path.basename(rel)})`,
    pointsTo: 'the hydrograph-generation step (zone mapping) or num_runoffs in the cfg',
  }];
};

const sourceCountCheck: Check = (cfg, cfgDir, probe) => {
  const n = cfg.getNumber('num_sources');
  if (n === undefined || n <= 0) return [];
  const out: Finding[] = [];
  const srcRel = usablePath(cfg, 'src_loc_file');
  if (srcRel) {
    const text = probe.readText(resolveRel(cfgDir, srcRel));
    if (text !== null) {
      const rows = dataRows(text).length;
      if (rows !== n) out.push({
        id: 'source-count-mismatch', severity: 'error',
        title: 'Source count does not match the source-location file',
        detail: `num_sources declares ${n} but src_loc_file has ${rows} row(s).`,
        evidence: `num_sources=${n}, src_loc rows=${rows}`,
        pointsTo: 'src_loc_file or num_sources',
      });
    }
  }
  const hRel = usablePath(cfg, 'hydrograph_filename');
  if (hRel) {
    const text = probe.readText(resolveRel(cfgDir, hRel));
    if (text !== null) {
      const cols = hygValueColumns(text);
      if (cols !== null && cols !== n) out.push({
        id: 'source-count-mismatch', severity: 'error',
        title: 'Source count does not match the point hydrograph',
        detail: `num_sources declares ${n} but the point hydrograph has ${cols} value column(s).`,
        evidence: `num_sources=${n}, point .hyg value-columns=${cols}`,
        pointsTo: 'hydrograph_filename or num_sources',
      });
    }
  }
  return out;
};

const degenerateForcingCheck: Check = (cfg, cfgDir, probe) => {
  const out: Finding[] = [];
  const candidates: { key: string; label: string }[] = [];
  if ((cfg.getNumber('num_runoffs') ?? 0) > 0) candidates.push({ key: 'runoff_filename', label: 'runoff hydrograph' });
  if ((cfg.getNumber('num_sources') ?? 0) > 0) candidates.push({ key: 'hydrograph_filename', label: 'point hydrograph' });
  for (const { key, label } of candidates) {
    const rel = usablePath(cfg, key);
    if (!rel) continue;
    const text = probe.readText(resolveRel(cfgDir, rel));
    if (text === null) continue;
    const vals = hygValues(text);
    if (vals.length === 0) continue;
    if (vals.every((v) => v === 0 || v === NODATA)) out.push({
      id: 'degenerate-forcing', severity: 'warning',
      title: `Forcing is all zero (${label})`,
      detail: `Every value in the ${label} is zero or nodata — the run will produce no flood.`,
      evidence: `${label}=${path.basename(rel)}, ${vals.length} values all zero/nodata`,
      pointsTo: 'the conversion step (nodata mismatch, grid mismatch, or IDs not in grid)',
    });
  }
  return out;
};

// TRITON parses forcing rows by splitting on COMMA only (StringUtils::split(trim(row), ','),
// inflow.h:203). A whitespace-delimited row collapses to one column, so indexing the 2nd
// zone/source throws (vector range error -> SIGABRT at load). Flag any active forcing file whose
// data rows use whitespace instead of commas.
const hydrographDelimiterCheck: Check = (cfg, cfgDir, probe) => {
  const out: Finding[] = [];
  const files = [
    { key: 'runoff_filename', label: 'runoff hydrograph', active: (cfg.getNumber('num_runoffs') ?? 0) > 0 },
    { key: 'hydrograph_filename', label: 'source hydrograph', active: (cfg.getNumber('num_sources') ?? 0) > 0 },
  ];
  for (const { key, label, active } of files) {
    if (!active) continue;
    const rel = usablePath(cfg, key);
    if (!rel) continue;
    const text = probe.readText(resolveRel(cfgDir, rel));
    if (text === null) continue;
    for (const row of dataRows(text)) {
      // Deliberately NOT the shared rowTokens() helper: it merges commas AND whitespace, which
      // would hide exactly the whitespace-vs-comma distinction this check exists to catch.
      if (!row.includes(',') && row.split(/\s+/).filter(Boolean).length >= 2) {
        out.push({
          id: 'hydrograph-delimiter', severity: 'error',
          title: `Whitespace-delimited ${label}`,
          detail: `TRITON parses forcing rows by splitting on commas only; this ${label} uses whitespace, so every row collapses to one column and TRITON aborts at load.`,
          evidence: `${path.basename(rel)} row "${row}" has no comma`,
          pointsTo: `re-delimit the ${label} rows with commas`,
        });
        break; // one finding per file
      }
    }
  }
  return out;
};

// Real TRITON BIN rasters carry a small (<~64 B observed) header/padding; a wrong grid
// differs by at least one row (thousands of bytes), so this absorbs headers without masking
// a genuine mismatch. Kept well below the float32/float64 gap of any real (large) grid.
// Aux rasters are headerless matrices = exactly cells*bpc bytes; a real deck may carry a few
// bytes of padding, so allow a small slack that still catches a whole-cell (grid) difference.
const GRID_HEADER_TOL = 64;

/** Cell count from a raster's same-basename `.asc` sidecar (e.g. dem.bin → dem.asc), or null. */
function companionGridCells(probe: DiagnosisProbe, absPath: string): number | null {
  const ascPath = absPath.replace(/\.[^./\\]+$/, '.asc');
  if (ascPath === absPath) return null;
  const h = probe.ascHeader(ascPath);
  return h ? h.ncols * h.nrows : null;
}

/** Could `bytes` hold `cells` values as float32 or float64 (plus a small header)? */
function bytesFitGrid(bytes: number, cells: number): boolean {
  return [4, 8].some((bpc) => Math.abs(bytes - cells * bpc) <= GRID_HEADER_TOL);
}

/** DEM cell count as TRITON reads it: BIN header, else a same-basename .asc sidecar, else the
 *  ASC header. null when the grid is unknowable (e.g. GTIFF, or a headerless BIN DEM with no
 *  sidecar) — callers then defer rather than risk a false positive. */
function demCells(cfg: ParsedCfg, cfgDir: string, probe: DiagnosisProbe): number | null {
  const demRel = usablePath(cfg, 'dem_filename');
  if (!demRel) return null;
  const demAbs = resolveRel(cfgDir, demRel);
  const fmt = (cfg.get('input_format') ?? '').toUpperCase();
  if (fmt === 'ASC') { const h = probe.ascHeader(demAbs); return h ? h.ncols * h.nrows : null; }
  if (fmt === 'BIN') { const bh = probe.binHeader(demAbs); return bh ? bh.ncols * bh.nrows : companionGridCells(probe, demAbs); }
  return null;
}

// A member of the declared-count / referenced-artifact integrity family: TRITON reads the runoff
// map as matrix<int> (triton.h:135) and indexes runoff_intensity[id] with NO bounds check
// (kernels.h:134); the table is sized/filled 0-based for ids 0..num_runoffs-1 (triton_init.h:1348).
// So any map id >= num_runoffs reads past the table (OOB → garbage runoff). The static,
// deck-authoritative form of a real-world corner blow-up caused by a 1-based map (max id ==
// num_runoffs indexing a 0-based table).
const runoffZoneRangeCheck: Check = (cfg, cfgDir, probe) => {
  const n = cfg.getNumber('num_runoffs');
  if (n === undefined || n <= 0) return [];
  const rel = usablePath(cfg, 'runoff_map');
  if (!rel) return [];
  const abs = resolveRel(cfgDir, rel);
  const fmt = (cfg.get('input_format') ?? '').toUpperCase();
  let range: { min: number; max: number } | null = null;
  if (fmt === 'ASC') {
    const text = probe.readText(abs);
    if (text === null) return [];
    let min = Infinity, max = -Infinity, seen = false;
    for (const tok of text.trim().split(/[,\s]+/)) {
      if (tok === '') continue;
      const v = Number(tok);
      if (!Number.isInteger(v)) continue; // a non-integer token means it isn't a zone map — defer
      seen = true;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!seen) return [];
    range = { min, max };
  } else if (fmt === 'BIN') {
    const cells = demCells(cfg, cfgDir, probe);
    if (cells === null) return [];            // grid unknowable → defer
    range = probe.binIntRange(abs, cells);
    if (range === null) return [];            // unreadable or grid mismatch → grid check owns it
  } else {
    return [];                                // GTIFF/unknown → cannot read zone ids
  }
  if (range.max >= n) return [{
    id: 'runoff-map-zone-range', severity: 'error',
    title: 'Runoff map references an out-of-range zone id',
    detail: `The runoff map's maximum zone id is ${range.max}, but num_runoffs=${n} defines a 0-based runoff table with valid ids 0..${n - 1}. TRITON reads the map as int and indexes the runoff table by that id with no bounds check, so id ${range.max} reads past the table (out of bounds) and injects a garbage runoff rate — a hallmark of a 1-based runoff map used against a 0-based table.`,
    evidence: `runoff_map max id=${range.max}, num_runoffs=${n} (valid 0..${n - 1})`,
    pointsTo: 'the runoff-zone map: re-index to 0-based (0..num_runoffs-1), or increase num_runoffs',
  }];
  if (range.min < 0) return [{
    id: 'runoff-map-zone-range', severity: 'error',
    title: 'Runoff map has a negative zone id',
    detail: `The runoff map contains a negative zone id (${range.min}); TRITON would index the runoff table at a negative offset (out of bounds).`,
    evidence: `runoff_map min id=${range.min}, num_runoffs=${n}`,
    pointsTo: 'the runoff-zone map generation',
  }];
  return [];
};

// Family member: num_extbc is trusted by the consumer loop (triton_init.h:922-936) over vectors
// sized by the extbc file's actual entry count, with no cross-check — so num_extbc > entries reads
// out of bounds and num_extbc < entries silently drops boundaries. TRITON treats a line as an entry
// unless it begins with '%' (config_utils.h:325).
const extbcCountCheck: Check = (cfg, cfgDir, probe) => {
  const n = cfg.getNumber('num_extbc');
  if (n === undefined || n <= 0) return [];
  const rel = usablePath(cfg, 'extbc_file');
  if (!rel) return [];
  const text = probe.readText(resolveRel(cfgDir, rel));
  if (text === null) return []; // missing handled by missingInputCheck
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('%')).length;
  if (rows === n) return [];
  return [{
    id: 'extbc-count-mismatch', severity: 'error',
    title: 'External-boundary count does not match the extbc file',
    detail: `num_extbc declares ${n} boundary segment(s) but the extbc file has ${rows} entr${rows === 1 ? 'y' : 'ies'}. TRITON loops num_extbc times over vectors sized by the file, so ${n > rows ? 'the extra iterations read out of bounds' : 'the surplus entries are silently dropped'}.`,
    evidence: `num_extbc=${n}, extbc entries=${rows} (${path.basename(rel)})`,
    pointsTo: 'the extbc file or num_extbc in the cfg',
  }];
};

const gridSizeCheck: Check = (cfg, cfgDir, probe) => {
  const demRel = usablePath(cfg, 'dem_filename');
  if (!demRel) return [];
  const demAbs = resolveRel(cfgDir, demRel);
  const fmt = (cfg.get('input_format') ?? '').toUpperCase();
  const others: { key: string; label: string }[] = [];
  if ((cfg.getNumber('num_runoffs') ?? 0) > 0) others.push({ key: 'runoff_map', label: 'runoff map' });
  for (const k of ['h_infile', 'qx_infile', 'qy_infile']) others.push({ key: k, label: k });

  const out: Finding[] = [];
  if (fmt === 'ASC') {
    // Real ASC decks give ncols/nrows headers ONLY to the DEM; aux rasters are
    // headerless whitespace matrices — so compare the DEM cell count to aux token counts.
    const dh = probe.ascHeader(demAbs);
    if (!dh) return [];
    const cells = dh.ncols * dh.nrows;
    for (const { key, label } of others) {
      const rel = usablePath(cfg, key);
      if (!rel) continue;
      const text = probe.readText(resolveRel(cfgDir, rel));
      if (text === null) continue;
      const tokens = text.trim().split(/\s+/).filter(Boolean).length;
      if (tokens !== cells) out.push({
        id: 'grid-size-mismatch', severity: 'error',
        title: `Grid mismatch: ${label} vs DEM`,
        detail: `${label} has ${tokens} value(s) but the DEM grid is ${dh.ncols}x${dh.nrows}=${cells} cells.`,
        evidence: `DEM ${dh.ncols}x${dh.nrows}=${cells} cells, ${label} ${tokens} tokens`,
        pointsTo: `the raster-generation step for ${key}`,
      });
    }
  } else if (fmt === 'BIN') {
    // Only the DEM is self-describing: it carries a 6-value header (ncols,nrows,...) exactly
    // as TRITON reads it (load_header_from_dem_file_binary). Aux rasters (runoff map, n, h,
    // qx, qy) are headerless matrices = cells*bpc bytes. So take the DEM grid from its binary
    // header (preferred) or a same-basename .asc sidecar, then require each aux raster to fit
    // that grid at float32/float64. Byte-for-byte equality is the WRONG invariant (a valid DEM
    // is 6*bpc larger than a same-grid aux, and dtypes may differ); use it only as a last
    // resort when the DEM grid is unknowable (no header AND no sidecar).
    const demSize = probe.size(demAbs);
    const bh = probe.binHeader(demAbs);
    const demCells = bh ? bh.ncols * bh.nrows : companionGridCells(probe, demAbs);
    for (const { key, label } of others) {
      const rel = usablePath(cfg, key);
      if (!rel) continue;
      const sz = probe.size(resolveRel(cfgDir, rel));
      if (sz === null) continue;
      const auxCells = companionGridCells(probe, resolveRel(cfgDir, rel));
      if (demCells !== null && auxCells !== null) {
        // Both grids known from .asc sidecars — compare cell counts, ignore dtype/bytes.
        if (auxCells !== demCells) out.push({
          id: 'grid-size-mismatch', severity: 'error',
          title: `Grid mismatch: ${label} vs DEM`,
          detail: `${label} grid is ${auxCells} cells but the DEM grid is ${demCells} cells (from .asc sidecars).`,
          evidence: `DEM ${demCells} cells, ${label} ${auxCells} cells`,
          pointsTo: `the raster-generation step for ${key}`,
        });
      } else if (demCells !== null) {
        // DEM grid known, aux has no sidecar — accept if aux bytes fit that grid at f32/f64.
        if (!bytesFitGrid(sz, demCells)) out.push({
          id: 'grid-size-mismatch', severity: 'error',
          title: `Grid mismatch: ${label} vs DEM`,
          detail: `${label} is ${sz} bytes, not consistent with the DEM grid of ${demCells} cells at float32 (${demCells * 4} B) or float64 (${demCells * 8} B).`,
          evidence: `DEM ${demCells} cells, ${label} ${sz} B`,
          pointsTo: `the raster-generation step for ${key}`,
        });
      } else if (auxCells === null && demSize !== null && sz !== demSize) {
        // No grid metadata on either side — fall back to strict byte-size equality.
        out.push({
          id: 'grid-size-mismatch', severity: 'error',
          title: `Grid mismatch: ${label} vs DEM`,
          detail: `${label} is ${sz} bytes but the DEM is ${demSize} bytes; without an .asc sidecar to confirm the grid, same-grid BIN rasters must match byte-for-byte.`,
          evidence: `DEM ${demSize} B, ${label} ${sz} B`,
          pointsTo: `the raster-generation step for ${key}`,
        });
      }
      // (demCells null but auxCells known): no reliable reference grid → skip, avoid a false positive.
    }
  }
  // Any other format (GTIFF, empty/unset, unknown): cannot reliably compare — no findings.
  return out;
};

// TRITON's BIN loader (load_from_binary_file 3-arg overload, matrix_io.h:226) reads a 2-value
// [nrows,ncols] int32 header (BIN_DEFAULT_HEADER_SIZE=2) on the runoff map and aborts on mismatch.
// A headerless map is exactly demCells int32 (no header room) -> TRITON reads the first two zone
// ids as dims and rejects. A wrong-GRID map is a different size and is owned by gridSizeCheck, so
// this fires only on the exactly-demCells (headerless) case to avoid double-reporting.
const binRasterHeaderCheck: Check = (cfg, cfgDir, probe) => {
  if ((cfg.get('input_format') ?? '').toUpperCase() !== 'BIN') return [];
  if ((cfg.getNumber('num_runoffs') ?? 0) <= 0) return [];
  const rel = usablePath(cfg, 'runoff_map');
  const demRel = usablePath(cfg, 'dem_filename');
  if (!rel || !demRel) return [];
  const bh = probe.binHeader(resolveRel(cfgDir, demRel));
  if (!bh) return []; // DEM grid unknown -> defer
  const sz = probe.size(resolveRel(cfgDir, rel));
  if (sz === null) return [];
  const demCells = bh.ncols * bh.nrows;
  if (Math.floor(sz / 4) === demCells) return [{
    id: 'bin-raster-header', severity: 'error',
    title: 'BIN runoff map missing its 2-value header',
    detail: `TRITON validates a 2-value [nrows,ncols] int32 header on a BIN runoff map; this file is exactly ${demCells} int32 (headerless) and TRITON rejects it at load with "Invalid Matrix dimensions".`,
    evidence: `${path.basename(rel)} ${sz} B = ${demCells} int32 (no header); DEM grid ${bh.ncols}x${bh.nrows}`,
    pointsTo: 'prepend a 2-value [nrows,ncols] int32 header to the BIN runoff map',
  }];
  return [];
};

const hydrographCoverageCheck: Check = (cfg, cfgDir, probe) => {
  const sim = cfg.getNumber('sim_duration');
  if (sim === undefined || sim <= 0) return [];
  const out: Finding[] = [];
  const forcings: { key: string; gate: boolean }[] = [
    { key: 'runoff_filename', gate: (cfg.getNumber('num_runoffs') ?? 0) > 0 },
    { key: 'hydrograph_filename', gate: (cfg.getNumber('num_sources') ?? 0) > 0 },
  ];
  for (const { key, gate } of forcings) {
    if (!gate) continue;
    const rel = usablePath(cfg, key);
    if (!rel) continue;
    const text = probe.readText(resolveRel(cfgDir, rel));
    if (text === null) continue;
    const times = hygTimes(text);
    if (times.length === 0) continue;
    const maxHr = Math.max(...times);
    if (maxHr * 3600 < sim) out.push({
      id: 'hydrograph-coverage', severity: 'warning',
      title: `Forcing ends before the simulation (${key})`,
      detail: `The hydrograph covers ${maxHr} h (${maxHr * 3600} s) but sim_duration is ${sim} s.`,
      evidence: `max Time=${maxHr} h, sim_duration=${sim} s`,
      pointsTo: 'the time range of the hydrograph-generation step, or sim_duration',
    });
    for (let i = 1; i < times.length; i++) {
      if (times[i] <= times[i - 1]) {
        out.push({
          id: 'hydrograph-coverage', severity: 'warning',
          title: `Hydrograph time column not increasing (${key})`,
          detail: 'Time values must strictly increase.',
          evidence: `time[${i - 1}]=${times[i - 1]}, time[${i}]=${times[i]}`,
          pointsTo: 'the hydrograph writer',
        });
        break;
      }
    }
  }
  return out;
};

const valueRangeCheck: Check = (cfg) => {
  const out: Finding[] = [];
  const warn = (title: string, detail: string, evidence: string, key: string): Finding =>
    ({ id: 'value-range-sanity', severity: 'warning', title, detail, evidence, pointsTo: `${key} in the cfg` });
  const cour = cfg.getNumber('courant');
  if (cour !== undefined && !(cour > 0 && cour <= 1)) out.push(warn('Courant number out of range', 'courant is expected in (0, 1].', `courant=${cour}`, 'courant'));
  const dur = cfg.getNumber('sim_duration');
  if (dur !== undefined && !(dur > 0)) out.push(warn('Non-positive sim_duration', 'sim_duration must be > 0.', `sim_duration=${dur}`, 'sim_duration'));
  const dt = cfg.getNumber('time_step');
  if (dt !== undefined && !(dt > 0)) out.push(warn('Non-positive time_step', 'time_step must be > 0.', `time_step=${dt}`, 'time_step'));
  return out;
};

const expectationChecks: Check = (cfg, cfgDir, probe, exp) => {
  if (!exp) return [];
  const out: Finding[] = [];
  if (exp.inputs) {
    for (const f of exp.inputs) {
      const abs = resolveRel(cfgDir, f);
      if (!probe.exists(abs)) out.push({
        id: 'expectation-inputs-present', severity: 'error',
        title: `Expected input missing: ${f}`,
        detail: 'A file the user declared as required is not present.',
        evidence: `expected "${f}" -> ${abs}`,
        pointsTo: 'user-declared required inputs',
      });
    }
  }
  if (exp.numRunoffs !== undefined) {
    const n = cfg.getNumber('num_runoffs');
    if (n !== exp.numRunoffs) out.push({
      id: 'expectation-runoff-count', severity: 'error',
      title: 'Runoff count differs from expected',
      detail: `The user expected ${exp.numRunoffs} runoff zones.`,
      evidence: `expected ${exp.numRunoffs}, deck num_runoffs=${n}`,
      pointsTo: 'num_runoffs / zone mapping',
    });
  }
  if (exp.numSources !== undefined) {
    const n = cfg.getNumber('num_sources');
    if (n !== exp.numSources) out.push({
      id: 'expectation-source-count', severity: 'error',
      title: 'Source count differs from expected',
      detail: `The user expected ${exp.numSources} sources.`,
      evidence: `expected ${exp.numSources}, deck num_sources=${n}`,
      pointsTo: 'num_sources',
    });
  }
  if (exp.simDurationSec !== undefined) {
    const d = cfg.getNumber('sim_duration');
    if (d !== exp.simDurationSec) out.push({
      id: 'expectation-sim-duration', severity: 'warning',
      title: 'Simulation duration differs from expected',
      detail: `The user expected ${exp.simDurationSec} s.`,
      evidence: `expected ${exp.simDurationSec}, deck sim_duration=${d}`,
      pointsTo: 'sim_duration',
    });
  }
  if (exp.forcingRange) {
    const { min, max } = exp.forcingRange;
    for (const key of ['runoff_filename', 'hydrograph_filename']) {
      const rel = usablePath(cfg, key);
      if (!rel) continue;
      const text = probe.readText(resolveRel(cfgDir, rel));
      if (text === null) continue;
      const vals = hygValues(text);
      const bad = vals.filter((v) => v < min || v > max);
      if (bad.length) out.push({
        id: 'expectation-forcing-range', severity: 'warning',
        title: `Forcing values outside expected range (${key})`,
        detail: `The user expected forcing in [${min}, ${max}].`,
        evidence: `${bad.length}/${vals.length} values out of range (e.g. ${bad[0]})`,
        pointsTo: 'the conversion / units step',
      });
    }
  }
  return out;
};

// Advisory physical-validity heuristics. Every finding is advisory (warning/info) — TRITON
// accepts these decks; the tool flags them as physically suspect, never as errors. Derived
// from externals/triton/doc/configuration_reference.rst. See the design spec for the signal table.
const physicalValidityCheck: Check = (cfg, cfgDir, probe) => {
  const out: Finding[] = [];
  const adv = (id: string, severity: Severity, title: string, detail: string, evidence: string, pointsTo: string): Finding =>
    ({ id, severity, title, detail, evidence, pointsTo, advisory: true });

  const mann = cfg.getNumber('const_mann');
  const nInfile = usablePath(cfg, 'n_infile');
  if (mann !== undefined && mann === 0 && !nInfile)
    out.push(adv('frictionless-domain', 'info', 'Frictionless domain (const_mann=0)',
      'const_mann=0 with no Manning raster models a frictionless surface — valid for idealized benchmarks, but unusual for a real flood.',
      'const_mann=0', 'const_mann in the cfg'));
  if (mann !== undefined && (mann < 0 || mann > 0.2))
    out.push(adv('manning-out-of-range', 'warning', 'Manning n physically implausible',
      'const_mann outside the physical roughness range [0, 0.2].', `const_mann=${mann}`, 'const_mann in the cfg'));

  const cour = cfg.getNumber('courant');
  if (cour !== undefined && cour > 0.5)
    out.push(adv('courant-above-recommended', 'warning', 'Courant number above recommended',
      'The reference recommends courant <= 0.5 for reliable runs.', `courant=${cour}`, 'courant in the cfg'));

  const hextra = cfg.getNumber('hextra');
  if (hextra !== undefined && hextra <= 0)
    out.push(adv('hextra-nonpositive', 'warning', 'Non-positive hextra',
      'hextra (depth tolerance, meters) should be a small positive value.', `hextra=${hextra}`, 'hextra in the cfg'));

  const dur = cfg.getNumber('sim_duration');
  const pint = cfg.getNumber('print_interval');
  if (dur !== undefined && pint !== undefined && dur > 0 && pint > dur)
    out.push(adv('no-raster-output', 'info', 'No raster output will be written',
      'print_interval exceeds sim_duration, so no raster snapshot is emitted.', `print_interval=${pint} > sim_duration=${dur}`, 'print_interval in the cfg'));

  if ((cfg.getNumber('num_runoffs') ?? 0) > 0) {
    const rel = usablePath(cfg, 'runoff_filename');
    if (rel) {
      const text = probe.readText(resolveRel(cfgDir, rel));
      if (text !== null) {
        const neg = hygValues(text).filter((v) => v < 0 && v !== NODATA);
        if (neg.length) out.push(adv('negative-runoff', 'warning', 'Negative runoff forcing',
          'Runoff intensities (mm/hr) should be >= 0; negative values are unphysical.',
          `${neg.length} negative value(s), min=${Math.min(...neg)}`, 'the runoff hydrograph'));
      }
    }
  }

  const fmt = (cfg.get('input_format') ?? '').toUpperCase();
  const demRel = usablePath(cfg, 'dem_filename');
  if (fmt === 'ASC' && demRel) {
    const text = probe.readText(resolveRel(cfgDir, demRel));
    if (text !== null) {
      let nodata = NODATA;
      let pit = false, worst = Infinity;
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (t === '') continue;
        // ESRI header lines start with a keyword (letter); data rows start with a number/sign.
        if (/^[A-Za-z]/.test(t)) {
          const m = /nodata_value\s+(-?\d+(?:\.\d+)?)/i.exec(t);
          if (m) nodata = Number(m[1]);
          continue;
        }
        for (const tok of rowTokens(t)) {
          const v = Number(tok);
          if (!Number.isFinite(v)) continue;
          if (v < 0 || v === nodata) { pit = true; if (v < worst) worst = v; }
        }
      }
      if (pit) out.push(adv('dem-deep-pits', 'warning', 'DEM contains deep pits / nodata cells',
        'Interior cells are negative or equal the NODATA sentinel; a NODATA sentinel left in the grid is read literally as a very deep pit and may destabilize the run.',
        `min pit value=${worst} (nodata=${nodata})`, 'the DEM raster'));
    }
  }

  return out;
};

/** Registry — later tasks append here. Order defines within-severity ranking. */
const CHECKS: Check[] = [
  placeholderCheck,
  inputFormatCheck,
  missingInputCheck,
  runoffColumnCheck,
  runoffZoneRangeCheck,
  sourceCountCheck,
  extbcCountCheck,
  degenerateForcingCheck,
  hydrographDelimiterCheck,
  gridSizeCheck,
  binRasterHeaderCheck,
  hydrographCoverageCheck,
  valueRangeCheck,
  physicalValidityCheck,
  expectationChecks,
];

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function diagnoseTritonDeck(
  cfg: ParsedCfg,
  cfgDir: string,
  probe: DiagnosisProbe,
  expectations?: Expectations,
): DiagnosisReport {
  const findings = CHECKS.flatMap((c) => {
    try {
      return c(cfg, cfgDir, probe, expectations);
    } catch {
      return []; // one broken check never aborts the pass
    }
  });
  // Stable sort keeps registry order within a severity band.
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  if (findings.length === 0) return { summary: 'No structural faults found.', findings };
  const nErr = findings.filter((f) => f.severity === 'error').length;
  const nWarn = findings.filter((f) => f.severity === 'warning').length;
  return { summary: `${nErr} error(s), ${nWarn} warning(s).`, findings };
}

// Re-export helpers used by checks added in later tasks.
export { resolveRel, dataRows, hygValueColumns, hygValues, hygTimes, usablePath, NODATA, physicalValidityCheck, binRasterHeaderCheck, hydrographDelimiterCheck, type Check };
