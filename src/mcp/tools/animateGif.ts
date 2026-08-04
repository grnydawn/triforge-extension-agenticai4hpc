// src/mcp/tools/animateGif.ts
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { ToolDef, ToolResult } from '../types';
import { AsciiParser } from '../../parsers/AsciiParser';
import { BinaryParser } from '../../parsers/BinaryParser';
import { renderFloodGif, groupOutputFrames } from '../../services/floodGif';
import { readConfig, getName, getUtmHeader } from '../../services/projectConfig';

/** Un-gated: render a colormap water-depth GIF from a run's output. */
export const animateGifTool: ToolDef = {
  name: 'animate_gif',
  description:
    'Render an animated GIF of a TRITON output variable (default H, water depth) from a ' +
    'finished run\'s output rasters, using a colormap (no basemap). Inputs: projectDir ' +
    '(+ optional variable/outputDir/colormap/fps/outPath). Un-gated (produces a visualization artifact).',
  inputSchema: {
    projectDir: z.string(),
    variable: z.string().optional(),
    outputDir: z.string().optional(),
    colormap: z.string().optional(),
    fps: z.number().optional(),
    outPath: z.string().optional(),
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    const cwd = ctx?.cwd ?? process.cwd();
    const projectDir = path.resolve(cwd, args.projectDir as string);
    const configPath = path.join(projectDir, 'config.json');
    if (!fs.existsSync(configPath)) {
      return { content: [{ type: 'text', text: `config.json not found in ${projectDir}` }], isError: true };
    }
    try {
      const config = readConfig(configPath);
      const h = getUtmHeader(config);
      if (!h) {
        return { content: [{ type: 'text', text: 'project config has no utmHeader' }], isError: true };
      }
      const demHeader = { lastCols: h.ncols, lastRows: h.nrows, noData: h.NODATA_value };
      const variable = (typeof args.variable === 'string' && args.variable) ? args.variable : 'H';
      // TRITON writes rasters into output/asc or output/bin (both use .out; the
      // FOLDER — not the extension — distinguishes ascii from binary).
      let outputDir: string;
      if (args.outputDir) {
        outputDir = path.resolve(cwd, args.outputDir as string);
      } else {
        const ascDir = path.join(projectDir, 'output', 'asc');
        const binDir = path.join(projectDir, 'output', 'bin');
        if (fs.existsSync(ascDir)) outputDir = ascDir;
        else if (fs.existsSync(binDir)) outputDir = binDir;
        else {
          return { content: [{ type: 'text', text: `no output rasters found: neither ${ascDir} nor ${binDir} exists` }], isError: true };
        }
      }
      if (!fs.existsSync(outputDir)) {
        return { content: [{ type: 'text', text: `output folder not found: ${outputDir}` }], isError: true };
      }
      const all = fs.readdirSync(outputDir)
        .filter((f) => f.startsWith(`${variable}_`) && /\.(asc|out|bin)$/i.test(f));
      const groups = groupOutputFrames(all);
      if (groups.length === 0) {
        return { content: [{ type: 'text', text: `no ${variable} output frames found in ${outputDir}` }], isError: true };
      }
      const useBinary = path.basename(outputDir).toLowerCase() === 'bin';
      const frames = [];
      for (const g of groups) {
        const paths = g.map((f) => path.join(outputDir, f));
        const m = useBinary
          ? await BinaryParser.stitchFiles(paths, demHeader)
          : await AsciiParser.stitchFiles(paths, demHeader);
        if (m) frames.push(m);
      }
      if (frames.length === 0) {
        return { content: [{ type: 'text', text: 'frames could not be parsed' }], isError: true };
      }
      const fps = typeof args.fps === 'number' && args.fps > 0 ? args.fps : 5;
      const outPath = args.outPath
        ? path.resolve(cwd, args.outPath as string)
        : path.join(projectDir, `${getName(config) || 'flood'}.gif`);
      await renderFloodGif({
        frames, cols: demHeader.lastCols, rows: demHeader.lastRows,
        colormap: (args.colormap as string | undefined) ?? 'Rainbow',
        noData: demHeader.noData, delayMs: Math.round(1000 / fps), outPath,
      });
      return { content: [{ type: 'text', text: `wrote ${frames.length}-frame GIF to ${outPath}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `animate_gif failed: ${String(err)}` }], isError: true };
    }
  },
};
