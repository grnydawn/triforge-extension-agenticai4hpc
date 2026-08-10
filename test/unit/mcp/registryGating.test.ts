import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { ToolRegistry } from '../../../src/mcp/registry';
import { Transcript } from '../../../src/mcp/transcript';
import { ToolDef, ToolResult } from '../../../src/mcp/types';

function gatedProbe(): { def: ToolDef; calls: () => number } {
  let ran = 0;
  const def: ToolDef = {
    name: 'gated_probe',
    description: 'gated test tool',
    gated: true,
    summarize: (args) => `do the thing with ${JSON.stringify(args.x)}`,
    inputSchema: { x: z.number(), approvalToken: z.string().optional() },
    handler: (): ToolResult => {
      ran += 1;
      return { content: [{ type: 'text', text: 'did the thing' }] };
    },
  };
  return { def, calls: () => ran };
}

describe('ToolRegistry gating', () => {
  it('a gated tool without a token returns pendingApproval and does NOT run the handler', async () => {
    const { def, calls } = gatedProbe();
    const r = new ToolRegistry();
    r.register(def);
    const res = await r.call('gated_probe', { x: 1 });
    expect(res.pendingApproval).to.be.an('object');
    expect(res.pendingApproval!.token).to.be.a('string').with.length.greaterThan(0);
    expect(res.content[0].text).to.contain(res.pendingApproval!.token);
    expect(res.content[0].text).to.match(/do the thing with 1/);
    expect(calls()).to.equal(0);
  });

  it('re-calling with the same args + token runs the handler', async () => {
    const { def, calls } = gatedProbe();
    const r = new ToolRegistry();
    r.register(def);
    const first = await r.call('gated_probe', { x: 1 });
    const token = first.pendingApproval!.token;
    const second = await r.call('gated_probe', { x: 1, approvalToken: token });
    expect(second.content[0].text).to.equal('did the thing');
    expect(second.isError).to.not.equal(true);
    expect(calls()).to.equal(1);
  });

  it('a token is single-use', async () => {
    const { def } = gatedProbe();
    const r = new ToolRegistry();
    r.register(def);
    const token = (await r.call('gated_probe', { x: 1 })).pendingApproval!.token;
    await r.call('gated_probe', { x: 1, approvalToken: token });
    const third = await r.call('gated_probe', { x: 1, approvalToken: token });
    expect(third.isError).to.equal(true);
    expect(third.content[0].text).to.match(/approval token/i);
  });

  it('a token does not authorize different args', async () => {
    const { def, calls } = gatedProbe();
    const r = new ToolRegistry();
    r.register(def);
    const token = (await r.call('gated_probe', { x: 1 })).pendingApproval!.token;
    const res = await r.call('gated_probe', { x: 999, approvalToken: token });
    expect(res.isError).to.equal(true);
    expect(calls()).to.equal(0);
  });

  it('records pending then approved entries in the transcript', async () => {
    const { def } = gatedProbe();
    const r = new ToolRegistry();
    r.register(def);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-gate-')), 't.jsonl');
    const transcript = new Transcript(file);
    const token = (await r.call('gated_probe', { x: 1 }, transcript)).pendingApproval!.token;
    await r.call('gated_probe', { x: 1, approvalToken: token }, transcript);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).to.have.length(2);
    expect(lines[0].summary).to.match(/pending-approval/i);
    expect(lines[1].ok).to.equal(true);
  });
});
