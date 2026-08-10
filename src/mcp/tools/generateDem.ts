// src/mcp/tools/generateDem.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { ToolDef, ToolResult } from '../types';
import { downloadProjectDem } from '../../services/demDownload';
import { readConfig, writeConfig, getName, getUtmZone, getDatum, getUtmHeader, setInputDem } from '../../services/projectConfig';

const API_KEY_ENV = 'TRIFORGE_OPENTOPOGRAPHY_API_KEY';

/** Gated: fetch a DEM from OpenTopography matching the project's simulation area. */
export const generateDemTool: ToolDef = {
  name: 'generate_dem',
  description:
    'Download an elevation model (DEM) from OpenTopography matching the project simulation ' +
    `area and write a TRITON-native .asc into the project input folder. Requires the ${API_KEY_ENV} ` +
    'environment variable (the key is never passed as an argument). Gated — first call returns an ' +
    'approval token; re-call with the same args plus the token.',
  gated: true,
  summarize: (args) => `download a DEM (source ${String(args.source ?? 'OpenTopography')}) into ${String(args.projectDir)}`,
  inputSchema: {
    projectDir: z.string(),
    source: z.string().optional(),
    outPath: z.string().optional(),
    approvalToken: z.string().optional(),
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    const cwd = ctx?.cwd ?? process.cwd();
    const projectDir = path.resolve(cwd, args.projectDir as string);
    const configPath = path.join(projectDir, 'config.json');
    const apiKey = process.env[API_KEY_ENV];
    if (!apiKey) {
      return { content: [{ type: 'text', text: `missing ${API_KEY_ENV} environment variable` }], isError: true };
    }
    if (!fs.existsSync(configPath)) {
      return { content: [{ type: 'text', text: `config.json not found in ${projectDir}` }], isError: true };
    }
    try {
      const config = readConfig(configPath);
      const targetHeader = getUtmHeader(config);
      if (!targetHeader) {
        return { content: [{ type: 'text', text: 'project config has no utmHeader (draw a simulation area first)' }], isError: true };
      }
      const utmZone = getUtmZone(config);
      if (!utmZone) {
        return { content: [{ type: 'text', text: 'project config has no utmZone' }], isError: true };
      }
      const datum = getDatum(config);
      const source = (args.source as string | undefined) ?? 'OpenTopography';
      const baseName = getName(config) || 'dem';
      const outPath = args.outPath
        ? path.resolve(cwd, args.outPath as string)
        : path.join(projectDir, 'input', `${baseName}.asc`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const r = await downloadProjectDem({
        apiKey, source, targetHeader, utmZone, datum, outPath, tmpDir: os.tmpdir(),
      });
      setInputDem(config, r.outPath);
      writeConfig(configPath, config);
      return { content: [{ type: 'text', text: `wrote DEM ${r.cols}x${r.rows} to ${r.outPath}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `generate_dem failed: ${String(err)}` }], isError: true };
    }
  },
};
