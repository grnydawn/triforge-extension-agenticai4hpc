import { expect } from 'chai';
import { runProcess } from '../../../src/mcp/tools/runLocal';

const OPTS = { cwd: process.cwd(), env: process.env, timeoutMs: 30_000, maxBytes: 1_000_000 };

describe('runProcess', () => {
  it('captures output and exit code of a normal command', async () => {
    const r = await runProcess('node', ['-e', "process.stdout.write('hi')"], OPTS);
    expect(r.code).to.equal(0);
    expect(r.stdout).to.contain('hi');
    expect(r.timedOut).to.equal(false);
    expect(r.truncated).to.equal(false);
  });

  it('stops appending output past maxBytes and marks truncated (without killing)', async () => {
    // Emit ~50 KB but cap at 1 KB.
    const r = await runProcess(
      'node',
      ['-e', "process.stdout.write('x'.repeat(50000)); process.exit(0)"],
      { ...OPTS, maxBytes: 1000 },
    );
    expect(r.truncated).to.equal(true);
    expect(r.stdout.length).to.be.lessThan(5000); // bounded, nowhere near 50000
    expect(r.code).to.equal(0); // finished normally — cap did not kill it
  });

  it('kills a hung command after timeoutMs and marks timedOut', async () => {
    const start = Date.now();
    const r = await runProcess('node', ['-e', 'setTimeout(() => {}, 60000)'], {
      ...OPTS,
      timeoutMs: 300,
    });
    expect(r.timedOut).to.equal(true);
    expect(Date.now() - start).to.be.lessThan(5000); // returned promptly, not after 60s
  });

  it('honors an already-aborted signal by killing immediately', async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await runProcess('node', ['-e', 'setTimeout(() => {}, 60000)'], {
      ...OPTS,
      timeoutMs: 30_000,
      signal: ac.signal,
    });
    expect(r.timedOut).to.equal(true);
  });
});
