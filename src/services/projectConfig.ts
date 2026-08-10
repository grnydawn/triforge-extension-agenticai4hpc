// src/services/projectConfig.ts
// Pure (no vscode): read/write the REAL nested config.json schema that
// ProjectManager writes (settings/input/compsetup/execution/output). The MCP
// tool handlers previously assumed a flat shape and silently read undefined for
// utmHeader/utmZone/name/time-base — this helper is the single source of truth
// so that class of bug can't recur.
import * as fs from 'fs';
import type { DemHeader } from '../parsers/DemParser';

export interface NestedConfig {
  version?: string;
  settings?: any;
  input?: any;
  compsetup?: any;
  execution?: any;
  output?: any;
  [k: string]: unknown;
}

/** JSON.parse of the config file (nested schema). */
export function readConfig(configPath: string): NestedConfig {
  return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as NestedConfig;
}

/** Pretty-printed round-trip write. */
export function writeConfig(configPath: string, c: NestedConfig): void {
  fs.writeFileSync(configPath, JSON.stringify(c, null, 2));
}

/** Project display name (used as the input file basename). */
export function getName(c: NestedConfig): string | undefined {
  return c.settings?.name;
}

/** UTM zone as a string, or undefined when absent/empty. */
export function getUtmZone(c: NestedConfig): string | undefined {
  const z = c.settings?.utmZone;
  if (z === undefined || z === null || z === '') return undefined;
  return String(z);
}

/** Horizontal datum, defaulting to WGS84. */
export function getDatum(c: NestedConfig): string {
  return c.settings?.datum ?? 'WGS84';
}

/** UTM header (simulation grid), Number()-coerced, or undefined when absent. */
export function getUtmHeader(c: NestedConfig): DemHeader | undefined {
  const h = c.settings?.utmHeader;
  if (!h) return undefined;
  return {
    ncols: Number(h.ncols),
    nrows: Number(h.nrows),
    xllcorner: Number(h.xllcorner),
    yllcorner: Number(h.yllcorner),
    cellsize: Number(h.cellsize),
    NODATA_value: Number(h.NODATA_value ?? -9999),
  };
}

/** Time base pulled from compsetup + execution, with TRITON-sensible defaults. */
export function getTimeBase(c: NestedConfig): { simStart: number; printInterval: number; simDuration: number } {
  return {
    simStart: c.compsetup?.sim_start_time || 0,
    printInterval: c.execution?.print_interval || 900,
    simDuration: c.compsetup?.sim_duration || 86400,
  };
}

/** Set the input DEM path (creating input node if absent). */
export function setInputDem(c: NestedConfig, demPath: string): void {
  (c.input ??= {}).dem = demPath;
}

/** Wire the streamflow inputs under the input node (creating it if absent). */
export function setStreamflow(c: NestedConfig, n: number, srcFile: string, hygFile: string): void {
  const input = (c.input ??= {});
  input.num_sources = n;
  input.src_loc_file = srcFile;
  input.hydrograph_filename = hygFile;
}
