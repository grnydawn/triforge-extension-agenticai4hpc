// test/unit/services/tritonKnowledge.test.ts
import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseArticle, loadKnowledge, lookupKnowledge } from '../../../src/services/tritonKnowledge';

function tmpDirWith(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfk-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

const A = `---\nid: file-formats\ntitle: File formats\nkeywords: [bin, dem, float64]\n---\nDEM body text.`;
const B = `---\nid: output-vars\ntitle: Output variables\nkeywords: [mh, h, qx]\n---\nMH is max height.`;

describe('tritonKnowledge.parseArticle', () => {
  it('parses frontmatter and body', () => {
    const a = parseArticle(A);
    expect(a).to.not.equal(null);
    expect(a!.id).to.equal('file-formats');
    expect(a!.title).to.equal('File formats');
    expect(a!.keywords).to.deep.equal(['bin', 'dem', 'float64']);
    expect(a!.body).to.equal('DEM body text.');
  });
  it('returns null when there is no frontmatter', () => {
    expect(parseArticle('just prose, no dashes')).to.equal(null);
  });
});

describe('tritonKnowledge.loadKnowledge', () => {
  it('loads every .md sorted by id, skipping malformed files', () => {
    const dir = tmpDirWith({ 'a.md': A, 'b.md': B, 'bad.md': 'no frontmatter', 'notes.txt': A });
    const arts = loadKnowledge(dir);
    expect(arts.map((x) => x.id)).to.deep.equal(['file-formats', 'output-vars']);
  });
  it('returns [] for a missing directory', () => {
    expect(loadKnowledge('/no/such/dir/here')).to.deep.equal([]);
  });
});

describe('tritonKnowledge.lookupKnowledge', () => {
  const arts = [parseArticle(A)!, parseArticle(B)!];
  it('no topic → an index listing every id and title', () => {
    const out = lookupKnowledge(arts);
    expect(out).to.contain('file-formats — File formats');
    expect(out).to.contain('output-vars — Output variables');
  });
  it('a keyword topic → the matching article body', () => {
    const out = lookupKnowledge(arts, 'float64');
    expect(out).to.contain('DEM body text.');
    expect(out).to.not.contain('MH is max height.');
  });
  it('an id substring topic → that article', () => {
    expect(lookupKnowledge(arts, 'output')).to.contain('MH is max height.');
  });
  it('no match → index plus a notice', () => {
    const out = lookupKnowledge(arts, 'zzz');
    expect(out).to.contain('No knowledge article matches "zzz"');
    expect(out).to.contain('file-formats — File formats');
  });
  it('empty article set → a clear message', () => {
    expect(lookupKnowledge([], 'anything')).to.contain('No knowledge articles');
  });
});
