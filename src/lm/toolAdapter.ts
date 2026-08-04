// src/lm/toolAdapter.ts
import * as vscode from 'vscode';
import { ToolDef } from '../mcp/types';
import { ProjectContext, resolveInvocationArgs } from './resolveArgs';

export interface LmToolDeps {
  /** Snapshot the active-project context at call time (late-bound, not cached). */
  getProjectContext: () => ProjectContext;
}

/** Wrap a pure ToolDef as a VS Code Language Model Tool: active-project context
 *  injection, native confirmation for gated tools, and result mapping. */
export function makeLmTool(
  def: ToolDef,
  deps: LmToolDeps,
): vscode.LanguageModelTool<Record<string, unknown>> {
  const summarize = (args: Record<string, unknown>): string =>
    def.summarize ? def.summarize(args) : `Run ${def.name}`;

  return {
    prepareInvocation(
      options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, unknown>>,
    ): vscode.PreparedToolInvocation {
      const resolved = resolveInvocationArgs(def.name, options.input ?? {}, deps.getProjectContext());
      if (!resolved.ok) {
        // invoke() will return the error without running anything — don't show a
        // misleading confirmation dialog for a call that won't execute.
        return { invocationMessage: `Triforge: ${def.name} — ${resolved.error}` };
      }
      const invocationMessage = summarize(resolved.args);
      if (def.gated) {
        return {
          invocationMessage,
          confirmationMessages: {
            title: `Triforge: ${def.name}`,
            message: new vscode.MarkdownString(invocationMessage),
          },
        };
      }
      return { invocationMessage };
    },

    async invoke(
      options: vscode.LanguageModelToolInvocationOptions<Record<string, unknown>>,
    ): Promise<vscode.LanguageModelToolResult> {
      const resolved = resolveInvocationArgs(def.name, options.input ?? {}, deps.getProjectContext());
      if (!resolved.ok) {
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`ERROR: ${resolved.error}`)]);
      }
      const result = await def.handler(resolved.args, resolved.ctx);
      const text = result.content.map((c) => c.text).join('\n');
      const body = result.isError ? `ERROR: ${text}` : text;
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(body)]);
    },
  };
}
