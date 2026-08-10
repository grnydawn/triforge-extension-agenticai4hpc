import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { bannedSitePattern } from '../../helpers/bannedTokens';

// The corpus must stay a GENERIC TRITON corpus — no site-specific token in any fixture.
describe('diagnose-corpus genericity', () => {
  const root = path.join(__dirname, '../../..', 'eval', 'diagnose-corpus');
  const banned = bannedSitePattern();

  // `runs/` holds transient, gitignored study outputs (agent transcripts + answers), NOT corpus
  // material. Some predate the bwrap isolation and legitimately mention the private deck; the
  // genericity guarantee is about the committed FIXTURES + manifest, so don't walk into runs/.
  // `build/` is a gitignored compiled TRITON solver tree (triton.exe + CMake artifacts) used by
  // the oracle harness — also not corpus material, and its env script carries a TRITON_RUN token.
  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) return d.name === 'runs' || d.name === 'build' ? [] : walk(p);
      return [p];
    });
  }

  it('no site-specific token in any text fixture or the manifest', () => {
    for (const file of walk(root)) {
      if (/\.(bin)$/i.test(file)) continue; // binary size-carriers
      const text = fs.readFileSync(file, 'utf8');
      expect(banned.test(text), `${file} contains a site-specific token`).to.equal(false);
    }
  });
});
