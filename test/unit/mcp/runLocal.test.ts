import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runLocalTool } from '../../../src/mcp/tools/runLocal';
import { ToolRegistry } from '../../../src/mcp/registry';

const TEMPLATE = path.join(process.cwd(), 'resources', 'triton_execution.cfg.template');

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tf-run-'));
}

describe('run_local tool', () => {
  it('writes triton_execution.cfg into runDir and runs the command, capturing output', async () => {
    const runDir = tmpDir();
    const res = await runLocalTool.handler({
      project: { sim_duration: 60 },
      runDir,
      runCommand: `node -e "console.log('RAN_OK')"`,
      templatePath: TEMPLATE,
    });
    expect(fs.existsSync(path.join(runDir, 'triton_execution.cfg'))).to.equal(true);
    expect(res.isError).to.not.equal(true);
    expect(res.content[0].text).to.contain('RAN_OK');
    expect(res.content[0].text).to.contain('exit=0');
  });

  it('marks a non-zero exit as isError', async () => {
    const runDir = tmpDir();
    const res = await runLocalTool.handler({
      project: {},
      runDir,
      runCommand: `node -e "process.exit(3)"`,
      templatePath: TEMPLATE,
    });
    expect(res.isError).to.equal(true);
    expect(res.content[0].text).to.contain('exit=3');
  });

  it('errors cleanly when the template is missing', async () => {
    const res = await runLocalTool.handler({
      project: {},
      runDir: tmpDir(),
      runCommand: 'true',
      templatePath: '/no/such/template',
    });
    expect(res.isError).to.equal(true);
    expect(res.content[0].text).to.match(/template/i);
  });

  it('resolves runDir against ctx.cwd', async () => {
    const base = tmpDir();
    const res = await runLocalTool.handler(
      { project: { sim_duration: 60 }, runCommand: `node -e "console.log('RAN_OK')"`, runDir: 'sub/run', templatePath: TEMPLATE },
      { cwd: base },
    );
    expect(res.isError).to.not.equal(true);
    expect(fs.existsSync(path.join(base, 'sub/run', 'triton_execution.cfg'))).to.equal(true);
  });

  it('times out a hung command and reports it as an error', async () => {
    const res = await runLocalTool.handler(
      { project: {}, runDir: tmpDir(), runCommand: 'node -e "setTimeout(() => {}, 60000)"', templatePath: TEMPLATE, timeoutMs: 300 },
      { cwd: process.cwd() },
    );
    expect(res.isError).to.equal(true);
    expect(res.content[0].text).to.match(/timed out/i);
  });

  it('is gated: the registry requires approval before it runs', async () => {
    const runDir = tmpDir();
    const r = new ToolRegistry();
    r.register(runLocalTool);
    const args = { project: {}, runDir, runCommand: `node -e "console.log('RAN_OK')"`, templatePath: TEMPLATE };
    const first = await r.call('run_local', { ...args });
    expect(first.pendingApproval).to.be.an('object');
    expect(fs.existsSync(path.join(runDir, 'triton_execution.cfg'))).to.equal(false); // did not run yet
    const second = await r.call('run_local', { ...args, approvalToken: first.pendingApproval!.token });
    expect(second.content[0].text).to.contain('RAN_OK');
  });
});
