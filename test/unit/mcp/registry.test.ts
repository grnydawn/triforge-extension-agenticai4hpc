import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { ToolRegistry, buildRegistry } from '../../../src/mcp/registry';
import { Transcript } from '../../../src/mcp/transcript';
import { ToolDef, ToolResult, ToolCtx } from '../../../src/mcp/types';

const okTool: ToolDef = {
  name: 'ok_tool',
  description: 'returns ok',
  inputSchema: { n: z.number() },
  handler: (args): ToolResult => ({ content: [{ type: 'text', text: `n=${args.n}` }] }),
};
const boomTool: ToolDef = {
  name: 'boom_tool',
  description: 'throws',
  inputSchema: {},
  handler: () => {
    throw new Error('kaboom');
  },
};
const softFailTool: ToolDef = {
  name: 'soft_fail_tool',
  description: 'returns isError without throwing',
  inputSchema: {},
  handler: (): ToolResult => ({ content: [{ type: 'text', text: 'nope' }], isError: true }),
};

describe('ToolRegistry', () => {
  it('registers, lists, and gets tools', () => {
    const r = new ToolRegistry();
    r.register(okTool);
    expect(r.list().map((t) => t.name)).to.deep.equal(['ok_tool']);
    expect(r.get('ok_tool')).to.equal(okTool);
    expect(r.get('nope')).to.equal(undefined);
  });

  it('throws on duplicate registration', () => {
    const r = new ToolRegistry();
    r.register(okTool);
    expect(() => r.register(okTool)).to.throw(/duplicate/i);
  });

  it('call() runs the handler and records a success entry', async () => {
    const r = new ToolRegistry();
    r.register(okTool);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-reg-')), 't.jsonl');
    const transcript = new Transcript(file);
    const res = await r.call('ok_tool', { n: 5 }, transcript);
    expect(res.content[0].text).to.equal('n=5');
    const entry = JSON.parse(fs.readFileSync(file, 'utf8').trim());
    expect(entry).to.include({ tool: 'ok_tool', ok: true });
  });

  it('call() traps handler errors into an isError result and records ok:false', async () => {
    const r = new ToolRegistry();
    r.register(boomTool);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-reg-')), 't.jsonl');
    const transcript = new Transcript(file);
    const res = await r.call('boom_tool', {}, transcript);
    expect(res.isError).to.equal(true);
    expect(res.content[0].text).to.match(/kaboom/);
    expect(JSON.parse(fs.readFileSync(file, 'utf8').trim()).ok).to.equal(false);
  });

  it('call() on an unknown tool returns isError without throwing', async () => {
    const r = new ToolRegistry();
    const res = await r.call('ghost', {});
    expect(res.isError).to.equal(true);
    expect(res.content[0].text).to.match(/unknown tool/i);
  });

  it('call() records ok:false when a handler returns isError without throwing', async () => {
    const r = new ToolRegistry();
    r.register(softFailTool);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-reg-')), 't.jsonl');
    const transcript = new Transcript(file);
    const res = await r.call('soft_fail_tool', {}, transcript);
    expect(res.isError).to.equal(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8').trim())).to.include({ tool: 'soft_fail_tool', ok: false });
  });
});

describe('buildRegistry', () => {
  it('registers all four tools', () => {
    const names = buildRegistry().list().map((t) => t.name);
    expect(names).to.include.members(['configure_solver', 'run_local', 'export_tfp', 'import_tfp']);
  });
});

describe('ToolRegistry ctx threading', () => {
  it('passes a ctx with cwd to the handler', async () => {
    let seen: ToolCtx | undefined;
    const r = new ToolRegistry();
    r.register({
      name: 'ctx_probe',
      description: 'probe',
      inputSchema: {},
      handler: (_args, ctx) => {
        seen = ctx;
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    });
    await r.call('ctx_probe', {});
    expect(seen).to.be.an('object');
    expect(seen!.cwd).to.equal(process.cwd());
    expect(seen!.approval).to.equal(undefined);
  });

  it('includes approval.token on an approved gated call', async () => {
    let seen: ToolCtx | undefined;
    const r = new ToolRegistry();
    r.register({
      name: 'gated_probe',
      description: 'probe',
      gated: true,
      inputSchema: {},
      handler: (_args, ctx) => {
        seen = ctx;
        return { content: [{ type: 'text', text: 'ran' }] };
      },
    });
    const first = await r.call('gated_probe', {});
    const token = first.pendingApproval!.token;
    await r.call('gated_probe', { approvalToken: token });
    expect(seen!.approval!.token).to.equal(token);
  });
});
