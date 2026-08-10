import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveCfg, fsProbe } from '../../../src/mcp/tools/diagnoseProject';

describe('diagnoseProject exported helpers', () => {
  it('resolveCfg finds the single .cfg and fsProbe reads size/text', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-exp-'));
    fs.writeFileSync(path.join(dir, 'run.cfg'), 'sim_duration=3600\n');
    const resolved = resolveCfg(dir, undefined);
    expect(resolved).to.equal(path.join(dir, 'run.cfg'));
    const probe = fsProbe();
    expect(probe.exists(path.join(dir, 'run.cfg'))).to.equal(true);
    expect(probe.size(path.join(dir, 'run.cfg'))).to.be.a('number');
    expect(probe.readText(path.join(dir, 'run.cfg'))).to.contain('sim_duration');
  });

  // fsProbe.binIntRange reads an int32 runoff map, aligning past a 0-, 2-, or 6-int header. The
  // 2-int header is the real operational layout (BIN_DEFAULT_HEADER_SIZE) that corpus fixtures
  // (headerless) don't cover, so exercise it here against a real file.
  it('binIntRange reads int32 zone ids and skips a 2-int header (real runoff-map layout)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-int-'));
    const cells = 4; // 2x2 grid
    // header [nrows=2, ncols=2] then zone ids [0,1,2,1] — a 1-based-ish map whose max id is 2
    const buf = Buffer.alloc((2 + cells) * 4);
    [2, 2, 0, 1, 2, 1].forEach((v, i) => buf.writeInt32LE(v, i * 4));
    const f = path.join(dir, 'roff.bin');
    fs.writeFileSync(f, buf);
    const probe = fsProbe();
    // Correct alignment (cells=4, total=6 → skip 2 header): data max=2, min=0.
    expect(probe.binIntRange(f, cells)).to.deep.equal({ min: 0, max: 2 });
    // A headerless file (total == cells) reads from byte 0.
    const bare = path.join(dir, 'bare.bin');
    const b2 = Buffer.alloc(cells * 4);
    [0, 1, 1, 0].forEach((v, i) => b2.writeInt32LE(v, i * 4));
    fs.writeFileSync(bare, b2);
    expect(probe.binIntRange(bare, cells)).to.deep.equal({ min: 0, max: 1 });
    // Cannot align to the grid (total fits none of cells/+2/+6) → null (grid check owns it).
    expect(probe.binIntRange(bare, 99)).to.equal(null);
  });
});
