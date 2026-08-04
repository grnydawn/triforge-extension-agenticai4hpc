// src/mcp/tools/diagnoseProject.ts
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { ToolDef, ToolResult } from '../types';
import { parseTritonCfg } from '../../services/tritonCfg';
import { diagnoseTritonDeck, DiagnosisProbe, DiagnosisReport, Expectations } from '../../services/diagnostics';

/** Resolve the .cfg: explicit cfgPath → triton_execution.cfg → the single *.cfg. */
export function resolveCfg(projectDir: string, cfgAbs?: string): string | { error: string } {
  if (cfgAbs) return cfgAbs;
  const preferred = path.join(projectDir, 'triton_execution.cfg');
  if (fs.existsSync(preferred)) return preferred;
  const cfgs = fs.existsSync(projectDir)
    ? fs.readdirSync(projectDir).filter((f) => f.toLowerCase().endsWith('.cfg'))
    : [];
  if (cfgs.length === 1) return path.join(projectDir, cfgs[0]);
  if (cfgs.length === 0) return { error: `no .cfg found in ${projectDir} (pass cfgPath)` };
  return { error: `multiple .cfg files in ${projectDir}: ${cfgs.join(', ')} — pass cfgPath` };
}

export function fsProbe(): DiagnosisProbe {
  return {
    exists: (p) => fs.existsSync(p),
    size: (p) => { try { return fs.statSync(p).size; } catch { return null; } },
    readText: (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } },
    ascHeader: (p) => {
      try {
        const hdr: { ncols?: number; nrows?: number } = {};
        for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/).slice(0, 8)) {
          const m = /^\s*(ncols|nrows)\s+(\d+)/i.exec(line);
          if (m) hdr[m[1].toLowerCase() as 'ncols' | 'nrows'] = parseInt(m[2], 10);
        }
        return hdr.ncols && hdr.nrows ? { ncols: hdr.ncols, nrows: hdr.nrows } : null;
      } catch { return null; }
    },
    binHeader: (p) => {
      try {
        const buf = fs.readFileSync(p);
        const total = buf.length;
        // The header is 6 values of the matrix element type; ncols,nrows are its first two.
        // Try float32 then float64, accepting the dtype whose header makes the file size
        // self-consistent: (6 + ncols*nrows) * bpc. A headerless DEM (data starts at byte 0)
        // fails this — its "ncols" is an elevation, non-integer or size-inconsistent.
        for (const bpc of [4, 8] as const) {
          if (total < 6 * bpc) continue;
          const ncols = bpc === 4 ? buf.readFloatLE(0) : buf.readDoubleLE(0);
          const nrows = bpc === 4 ? buf.readFloatLE(bpc) : buf.readDoubleLE(bpc);
          if (!Number.isInteger(ncols) || !Number.isInteger(nrows)) continue;
          if (ncols < 1 || nrows < 1 || ncols > 1e6 || nrows > 1e6) continue;
          if ((6 + ncols * nrows) * bpc === total) return { ncols, nrows, bpc };
        }
        return null;
      } catch { return null; }
    },
    binIntRange: (p, cells) => {
      try {
        const buf = fs.readFileSync(p);
        const total = Math.floor(buf.length / 4); // int32 = 4 bytes (TRITON matrix<int>)
        // Align the data region to the DEM grid: the runoff map may be headerless (cells),
        // carry BIN_DEFAULT_HEADER_SIZE=2 leading ints (real decks), or 6 (DEM-style).
        const header = [0, 2, 6].find((h) => total === cells + h);
        if (header === undefined) return null; // cannot align to the grid → defer to grid check
        let min = Infinity, max = -Infinity;
        for (let i = header; i < header + cells; i++) {
          const v = buf.readInt32LE(i * 4);
          if (v < min) min = v;
          if (v > max) max = v;
        }
        return cells > 0 ? { min, max } : null;
      } catch { return null; }
    },
  };
}

function render(report: DiagnosisReport): string {
  if (report.findings.length === 0) {
    return `OK — ${report.summary} (structural checks only; physical correctness not assessed).`;
  }
  const blocks = report.findings.map((f) =>
    `[${f.severity.toUpperCase()}] ${f.title}\n    ${f.detail}\n    evidence: ${f.evidence}\n    look at: ${f.pointsTo}`,
  );
  return [report.summary, '', ...blocks].join('\n');
}

/** Un-gated, read-only TRITON deck diagnosis. Generic to any TRITON workflow. */
export const diagnoseProjectTool: ToolDef = {
  name: 'diagnose_project',
  description:
    'Statically diagnose a TRITON project deck (.cfg + input files) and return ranked, ' +
    'evidence-backed findings for a "runs-but-broken" workflow: unsubstituted template ' +
    'placeholders, missing inputs, runoff/source count vs hydrograph mismatches, grid-size ' +
    'mismatches, all-zero forcing, coverage/parameter sanity. Read-only, un-gated. Inputs: ' +
    'projectDir (+ optional cfgPath, expectations). Generic to any TRITON workflow.',
  inputSchema: {
    projectDir: z.string(),
    cfgPath: z.string().optional(),
    expectations: z.object({
      inputs: z.array(z.string()).optional(),
      numRunoffs: z.number().optional(),
      numSources: z.number().optional(),
      simDurationSec: z.number().optional(),
      forcingRange: z.object({ min: z.number(), max: z.number() }).optional(),
    }).optional(),
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    const cwd = ctx?.cwd ?? process.cwd();
    const projectDir = path.resolve(cwd, args.projectDir as string);
    const cfgAbs = typeof args.cfgPath === 'string' && args.cfgPath
      ? path.resolve(cwd, args.cfgPath)
      : undefined;
    const resolved = resolveCfg(projectDir, cfgAbs);
    if (typeof resolved !== 'string') {
      return { content: [{ type: 'text', text: resolved.error }], isError: true };
    }
    let text: string;
    try {
      text = fs.readFileSync(resolved, 'utf8');
    } catch (err) {
      return { content: [{ type: 'text', text: `cannot read cfg ${resolved}: ${String(err)}` }], isError: true };
    }
    const cfg = parseTritonCfg(text);
    const report = diagnoseTritonDeck(
      cfg, path.dirname(resolved), fsProbe(), args.expectations as Expectations | undefined,
    );
    return { content: [{ type: 'text', text: `Diagnosis of ${resolved}\n\n${render(report)}` }] };
  },
};
