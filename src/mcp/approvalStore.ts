// src/mcp/approvalStore.ts
import { randomUUID } from 'crypto';

/** Deterministic JSON with recursively sorted object keys (arrays keep order). */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Canonical key for an approval: the args minus the token itself, order-independent. */
export function approvalArgsKey(args: Record<string, unknown>): string {
  const rest: Record<string, unknown> = { ...args };
  delete rest.approvalToken;
  return stableStringify(rest);
}

interface Pending {
  tool: string;
  argsKey: string;
}

/** Issues single-use approval tokens bound to a tool name + canonical args key. */
export class ApprovalStore {
  private readonly pending = new Map<string, Pending>();

  issue(tool: string, argsKey: string): string {
    const token = randomUUID();
    this.pending.set(token, { tool, argsKey });
    return token;
  }

  consume(token: string, tool: string, argsKey: string): boolean {
    const p = this.pending.get(token);
    if (!p || p.tool !== tool || p.argsKey !== argsKey) return false;
    this.pending.delete(token); // single-use
    return true;
  }
}
