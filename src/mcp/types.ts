// src/mcp/types.ts
// Shared, SDK-free types for the triforge MCP server. Nothing here imports the
// MCP SDK, so every consumer stays unit-testable under the repo's mocha setup.
import type { ZodRawShape } from 'zod';

/** MCP tool result shape (a plain object — intentionally not the SDK's type). */
export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  /** Present when a gated tool needs approval before it will run. Internal to the
   *  registry/server — NOT sent to the MCP client (the token is echoed in `content`). */
  pendingApproval?: { token: string; summary: string };
}

/** Per-call context handed to every tool handler by the registry. */
export interface ToolCtx {
  /** Base directory for resolving relative paths. The registry sets this to process.cwd(). */
  cwd: string;
  /** Cancellation signal. Honored by spawn-based tools when present. Not yet populated by
   *  the registry (no external canceller exists); reserved for server-driven cancellation. */
  signal?: AbortSignal;
  /** Set by the registry when a gated tool ran after consuming a valid approval token. */
  approval?: { token: string };
}

/** One registerable tool: a name, a zod input shape, and a handler. */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  /** When true, the registry requires a valid `approvalToken` before running the handler. */
  gated?: boolean;
  /** Human-readable one-line description of the action, shown in the approval prompt. */
  summarize?: (args: Record<string, unknown>) => string;
  handler: (args: Record<string, unknown>, ctx?: ToolCtx) => Promise<ToolResult> | ToolResult;
}

/** One line in the append-only call transcript. */
export interface TranscriptEntry {
  ts: number;
  tool: string;
  args: unknown;
  ok: boolean;
  summary: string;
}
