import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Transcript } from '../../../src/mcp/transcript';

describe('Transcript', () => {
  let file: string;
  beforeEach(() => {
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-mcp-')), 'transcript.jsonl');
  });

  it('appends one JSON line per record', () => {
    const t = new Transcript(file);
    t.record({ ts: 1, tool: 'configure_solver', args: { a: 1 }, ok: true, summary: 'ok' });
    t.record({ ts: 2, tool: 'configure_solver', args: { a: 2 }, ok: false, summary: 'boom' });
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).to.have.length(2);
    expect(JSON.parse(lines[0])).to.deep.equal({ ts: 1, tool: 'configure_solver', args: { a: 1 }, ok: true, summary: 'ok' });
    expect(JSON.parse(lines[1]).ok).to.equal(false);
  });

  it('creates the parent directory if missing', () => {
    const nested = path.join(path.dirname(file), 'sub', 'dir', 'transcript.jsonl');
    const t = new Transcript(nested);
    t.record({ ts: 1, tool: 'x', args: null, ok: true, summary: '' });
    expect(fs.existsSync(nested)).to.equal(true);
  });
});
