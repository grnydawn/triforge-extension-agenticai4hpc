// src/mcp/tools/runLocal.ts
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { z } from 'zod';
import { renderTritonExecutionCfg } from '../../services/tritonConfig';
import { tokenizeCommand } from '../commandTokenize';
import { ToolDef, ToolResult } from '../types';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 min; a local TRITON run can be long
const DEFAULT_MAX_BYTES = 1_000_000; // 1 MB of combined stdout+stderr captured

export interface RunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Kill the process group after this many ms. <= 0 disables the timeout. */
  timeoutMs: number;
  /** Stop appending captured output past this many bytes (memory bound). */
  maxBytes: number;
  /** External cancellation; kills the process group when it fires. */
  signal?: AbortSignal;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

/** Kill a detached child's whole process group; fall back to the direct child.
 *  POSIX-oriented: `detached: true` makes the child a group leader so `kill(-pid)`
 *  reaches mpirun/srun children. On Windows there is no such group, so the negative-pid
 *  kill throws and we fall back to killing only the direct child. */
function killGroup(child: cp.ChildProcess): void {
  if (child.pid == null) return;
  try {
    process.kill(-child.pid, 'SIGKILL'); // negative pid = the group (needs detached: true)
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already exited */
    }
  }
}

/** Spawn a command (no shell) with a timeout, output cap, and optional cancellation. */
export function runProcess(file: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = cp.spawn(file, args, { cwd: opts.cwd, shell: false, env: opts.env, detached: true });
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let truncated = false;
    let timedOut = false;

    const capture = (chunk: Buffer, onStdout: boolean): void => {
      if (bytes >= opts.maxBytes) {
        truncated = true;
        return;
      }
      const s = chunk.toString();
      const remaining = opts.maxBytes - bytes;
      // Truncate within an oversized chunk, not just across chunks, so a single big
      // write can't blow the cap. Slicing by char count is a close-enough byte bound.
      const kept = Buffer.byteLength(s) <= remaining ? s : s.slice(0, remaining);
      if (kept.length < s.length) truncated = true;
      bytes += Buffer.byteLength(kept);
      if (onStdout) stdout += kept;
      else stderr += kept;
    };
    child.stdout.on('data', (d) => capture(d, true));
    child.stderr.on('data', (d) => capture(d, false));

    const timer =
      opts.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            killGroup(child);
          }, opts.timeoutMs)
        : undefined;
    timer?.unref?.();

    const onAbort = (): void => {
      timedOut = true;
      killGroup(child);
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    const finish = (code: number | null): void => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ code, stdout, stderr, timedOut, truncated });
    };
    child.on('error', (err) => {
      stderr += String(err);
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}

/** Gated: run a TRITON simulation locally. Writes the cfg, then spawns runCommand in runDir. */
export const runLocalTool: ToolDef = {
  name: 'run_local',
  description:
    'Run a TRITON simulation locally: writes triton_execution.cfg into runDir from the ' +
    'project config, then executes runCommand (e.g. "mpirun -np 4 ./triton") in runDir. ' +
    'Gated — the first call returns an approval token; re-call with the same args plus the token.',
  gated: true,
  summarize: (args) => `run "${String(args.runCommand)}" in ${String(args.runDir)}`,
  inputSchema: {
    project: z.record(z.string(), z.any()),
    runDir: z.string(),
    runCommand: z.string(),
    templatePath: z.string().optional(),
    approvalToken: z.string().optional(),
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    const cwd = ctx?.cwd ?? process.cwd();
    const project = args.project as Record<string, unknown>;
    const runDir = path.resolve(cwd, args.runDir as string);
    const runCommand = args.runCommand as string;
    const defaultTemplate = path.join(cwd, 'resources', 'triton_execution.cfg.template');
    const templatePath = (args.templatePath as string | undefined) ?? defaultTemplate;
    // Internal test seam: not exposed in inputSchema, so an MCP client cannot set it.
    const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : DEFAULT_TIMEOUT_MS;
    if (!fs.existsSync(templatePath)) {
      return { content: [{ type: 'text', text: `template not found: ${templatePath}` }], isError: true };
    }
    const argv = tokenizeCommand(runCommand);
    if (argv.length === 0) {
      return { content: [{ type: 'text', text: 'runCommand is empty' }], isError: true };
    }
    if (!fs.existsSync(runDir)) fs.mkdirSync(runDir, { recursive: true });
    const cfg = renderTritonExecutionCfg(project, fs.readFileSync(templatePath, 'utf8'));
    fs.writeFileSync(path.join(runDir, 'triton_execution.cfg'), cfg);
    const [file, ...rest] = argv;
    // Inherit PATH as-is (do NOT prepend runDir): prepending would let a file placed in
    // runDir silently shadow a bare-name command without the approver being told. A binary
    // inside runDir must be referenced explicitly, e.g. "./triton".
    const r = await runProcess(file, rest, {
      cwd: runDir,
      env: process.env,
      timeoutMs,
      maxBytes: DEFAULT_MAX_BYTES,
      signal: ctx?.signal,
    });
    const notes: string[] = [];
    if (r.timedOut) notes.push(`[timed out after ${timeoutMs}ms — process group killed]`);
    if (r.truncated) notes.push(`[output truncated at ${DEFAULT_MAX_BYTES} bytes]`);
    const noteText = notes.length ? `${notes.join('\n')}\n` : '';
    return {
      content: [
        {
          type: 'text',
          text: `exit=${r.code}\n${noteText}--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`,
        },
      ],
      isError: r.code !== 0 || r.timedOut,
    };
  },
};
