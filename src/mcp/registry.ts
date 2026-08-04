// src/mcp/registry.ts
import { ToolDef, ToolResult, ToolCtx } from './types';
import { Transcript } from './transcript';
import { ApprovalStore, approvalArgsKey } from './approvalStore';
import { configureSolverTool } from './tools/configureSolver';
import { runLocalTool } from './tools/runLocal';
import { exportTfpTool } from './tools/exportTfp';
import { importTfpTool } from './tools/importTfp';
import { createWaterSourceTool } from './tools/createWaterSource';
import { generateDemTool } from './tools/generateDem';
import { animateGifTool } from './tools/animateGif';
import { diagnoseProjectTool } from './tools/diagnoseProject';
import { explainTritonTool } from './tools/explainTriton';

/** Truncated preview of a tool result for the transcript summary field. */
function digest(result: ToolResult): string {
  return (result.content[0]?.text ?? '').slice(0, 200);
}

/** In-memory tool registry with approval-token gating and transcript-on-call. SDK-free. */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDef>();
  private readonly approvals = new ApprovalStore();

  register(def: ToolDef): void {
    if (this.tools.has(def.name)) throw new Error(`duplicate tool: ${def.name}`);
    this.tools.set(def.name, def);
  }

  list(): ToolDef[] {
    return [...this.tools.values()];
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  async call(name: string, args: Record<string, unknown>, transcript?: Transcript): Promise<ToolResult> {
    const def = this.tools.get(name);
    if (!def) {
      const result: ToolResult = { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
      transcript?.record({ ts: Date.now(), tool: name, args, ok: false, summary: digest(result) });
      return result;
    }

    if (def.gated) {
      const argsKey = approvalArgsKey(args);
      const token = typeof args.approvalToken === 'string' ? args.approvalToken : undefined;
      if (!token) {
        const summary = def.summarize ? def.summarize(args) : `Run ${name}`;
        const issued = this.approvals.issue(name, argsKey);
        const result: ToolResult = {
          content: [
            {
              type: 'text',
              text:
                `APPROVAL REQUIRED — ${summary}\n` +
                `Re-call ${name} with the same arguments plus approvalToken="${issued}" to proceed.\n` +
                `APPROVAL_TOKEN: ${issued}`,
            },
          ],
          pendingApproval: { token: issued, summary },
        };
        transcript?.record({ ts: Date.now(), tool: name, args, ok: true, summary: `pending-approval: ${summary}` });
        return result;
      }
      if (!this.approvals.consume(token, name, argsKey)) {
        const result: ToolResult = {
          content: [{ type: 'text', text: `invalid or expired approval token for ${name}` }],
          isError: true,
        };
        transcript?.record({ ts: Date.now(), tool: name, args, ok: false, summary: 'denied: invalid approval token' });
        return result;
      }
      // approved — fall through and run the handler.
    }

    const ctx: ToolCtx = {
      cwd: process.cwd(),
      approval: def.gated && typeof args.approvalToken === 'string' ? { token: args.approvalToken } : undefined,
    };
    try {
      const result = await def.handler(args, ctx);
      transcript?.record({ ts: Date.now(), tool: name, args, ok: !result.isError, summary: digest(result) });
      return result;
    } catch (err) {
      const result: ToolResult = { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true };
      transcript?.record({ ts: Date.now(), tool: name, args, ok: false, summary: digest(result) });
      return result;
    }
  }
}

/** Assemble the server's tool set. */
export function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(configureSolverTool);
  registry.register(runLocalTool);
  registry.register(exportTfpTool);
  registry.register(importTfpTool);
  registry.register(createWaterSourceTool);
  registry.register(generateDemTool);
  registry.register(animateGifTool);
  registry.register(diagnoseProjectTool);
  registry.register(explainTritonTool);
  return registry;
}
