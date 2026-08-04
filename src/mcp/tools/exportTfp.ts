// src/mcp/tools/exportTfp.ts
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { ToolDef, ToolResult } from '../types';
import { assembleTfp } from './tfpArchive';

/** Un-gated: read a project folder and write a portable .tfp archive. */
export const exportTfpTool: ToolDef = {
  name: 'export_tfp',
  description:
    'Package a Triforge project folder (its config.json + input files, and optionally ' +
    'outputs) into a single portable .tfp archive that can be moved to another machine ' +
    '(e.g. an HPC system) and re-imported with import_tfp.',
  summarize: (args) => `package ${String(args.projectDir)} into ${String(args.outPath)}`,
  inputSchema: {
    projectDir: z.string(),
    outPath: z.string(),
    includeOutputs: z.boolean().optional(),
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    const cwd = ctx?.cwd ?? process.cwd();
    const projectDir = path.resolve(cwd, args.projectDir as string);
    const outPath = path.resolve(cwd, args.outPath as string);
    const includeOutputs = args.includeOutputs === true;
    try {
      const r = assembleTfp(projectDir, includeOutputs);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, r.data);
      const notes: string[] = [];
      // Surface reads that reached OUTSIDE the project folder — the config's input
      // paths drive these, so an unexpected entry here means the archive carries a
      // file from beyond the project root.
      if (r.externalInputs.length) {
        notes.push(`staged ${r.externalInputs.length} external input(s) from outside the project: ${r.externalInputs.join(', ')}`);
      }
      if (r.skippedFiles.length) notes.push(`skipped ${r.skippedFiles.length} unreadable file(s)`);
      if (r.skippedOutputs.length) notes.push(`dropped ${r.skippedOutputs.length} output(s) outside the project`);
      const suffix = notes.length ? ` (${notes.join('; ')})` : '';
      return {
        content: [{ type: 'text', text: `exported ${r.fileCount} entries to ${outPath}${suffix}` }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `export failed: ${String(err)}` }], isError: true };
    }
  },
};
