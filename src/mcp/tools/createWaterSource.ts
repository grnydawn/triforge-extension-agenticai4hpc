// src/mcp/tools/createWaterSource.ts
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { ToolDef, ToolResult } from '../types';
import { serializeSourceLocations, serializeHydrograph, Source } from '../../services/streamflow';
import { readConfig, writeConfig, getName, getUtmZone, getTimeBase, setStreamflow } from '../../services/projectConfig';

/** Gated: write TRITON streamflow inputs (.src + .hyg) and wire the config vars. */
export const createWaterSourceTool: ToolDef = {
  name: 'create_water_source',
  description:
    'Write TRITON streamflow inputs for a project: source locations (.src) and a discharge ' +
    'hydrograph (.hyg), then wire num_sources/src_loc_file/hydrograph_filename into config.json. ' +
    'Sources are UTM {x,y} or {lat,lng} (converted via the project UTM zone); discharge is a ' +
    'number[][] (one array per source). Gated — first call returns an approval token; re-call ' +
    'with the same args plus the token.',
  gated: true,
  summarize: (args) =>
    `write ${Array.isArray(args.locations) ? args.locations.length : 0} water source(s) into ${String(args.projectDir)}`,
  inputSchema: {
    projectDir: z.string(),
    locations: z.array(z.union([
      z.object({ lat: z.number(), lng: z.number() }),
      z.object({ x: z.number(), y: z.number() }),
    ])),
    hydrographs: z.array(z.array(z.number())),
    approvalToken: z.string().optional(),
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
      const zone = getUtmZone(config);
      if (zone === undefined) {
        return { content: [{ type: 'text', text: 'project config has no utmZone' }], isError: true };
      }
      const locations = args.locations as Source[];
      const hydrographs = args.hydrographs as number[][];
      const baseName = getName(config) || 'streamflow';
      const inputDir = path.join(projectDir, 'input');
      fs.mkdirSync(inputDir, { recursive: true });
      const srcFile = path.join(inputDir, `${baseName}.src`);
      const hygFile = path.join(inputDir, `${baseName}.hyg`);
      fs.writeFileSync(srcFile, serializeSourceLocations(locations, zone));
      fs.writeFileSync(hygFile, serializeHydrograph(hydrographs, getTimeBase(config)));
      setStreamflow(config, locations.length, srcFile, hygFile);
      writeConfig(configPath, config);
      return { content: [{ type: 'text', text: `wrote ${locations.length} source(s): ${path.basename(srcFile)} + ${path.basename(hygFile)}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `create_water_source failed: ${String(err)}` }], isError: true };
    }
  },
};
