// src/mcp/tools/configureSolver.ts
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { renderTritonExecutionCfg } from '../../services/tritonConfig';
import { ToolDef, ToolResult } from '../types';

const DEFAULT_TEMPLATE = path.join(process.cwd(), 'resources', 'triton_execution.cfg.template');

/** Render a TRITON execution .cfg from a flat project-config object. */
export const configureSolverTool: ToolDef = {
  name: 'configure_solver',
  description:
    'Render a TRITON execution .cfg from a flat project-config object using the ' +
    'execution template. Optionally writes the .cfg to outPath. Returns the cfg text.',
  inputSchema: {
    project: z.record(z.string(), z.any()),
    templatePath: z.string().optional(),
    outPath: z.string().optional(),
  },
  handler: (args): ToolResult => {
    const project = args.project as Record<string, unknown>;
    const templatePath = (args.templatePath as string | undefined) ?? DEFAULT_TEMPLATE;
    const outPath = args.outPath as string | undefined;
    if (!fs.existsSync(templatePath)) {
      return { content: [{ type: 'text', text: `template not found: ${templatePath}` }], isError: true };
    }
    const cfg = renderTritonExecutionCfg(project, fs.readFileSync(templatePath, 'utf8'));
    if (outPath) {
      const dir = path.dirname(outPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outPath, cfg);
    }
    return { content: [{ type: 'text', text: cfg }] };
  },
};
