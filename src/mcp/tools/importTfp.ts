// src/mcp/tools/importTfp.ts
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { ToolDef, ToolResult } from '../types';
import { extractTfp } from './tfpArchive';

const asU8 = (b: Buffer): Uint8Array => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

/** Gated: extract a portable .tfp into destRoot and re-localize its config. */
export const importTfpTool: ToolDef = {
  name: 'import_tfp',
  description:
    'Extract a portable .tfp archive into a destination folder: validates the archive, ' +
    'refuses any entry that escapes the folder, writes the project files, and re-localizes ' +
    'config.json to this machine. Gated — the first call returns an approval token; re-call ' +
    'with the same args plus the token. Does not render the run .cfg (use configure_solver).',
  gated: true,
  summarize: (args) => `extract ${String(args.archivePath)} into ${String(args.destRoot)}`,
  inputSchema: {
    archivePath: z.string(),
    destRoot: z.string(),
    approvalToken: z.string().optional(),
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    const cwd = ctx?.cwd ?? process.cwd();
    const archivePath = path.resolve(cwd, args.archivePath as string);
    const destRoot = path.resolve(cwd, args.destRoot as string);
    if (!fs.existsSync(archivePath)) {
      return { content: [{ type: 'text', text: `archive not found: ${archivePath}` }], isError: true };
    }
    try {
      const r = extractTfp(asU8(fs.readFileSync(archivePath)), destRoot);
      return {
        content: [{
          type: 'text',
          text: `imported '${r.manifest.projectName}' (${r.fileCount} entries) into ${r.destRoot}`,
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `import failed: ${String(err)}` }], isError: true };
    }
  },
};
