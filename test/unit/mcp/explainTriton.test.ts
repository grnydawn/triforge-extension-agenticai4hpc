// test/unit/mcp/explainTriton.test.ts
import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { explainTritonTool } from '../../../src/mcp/tools/explainTriton';

function tmpKnowledge(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfk-tool-'));
  fs.writeFileSync(path.join(dir, 'a.md'),
    `---\nid: file-formats\ntitle: File formats\nkeywords: [bin, float64]\n---\nDEM body.`);
  return dir;
}

describe('explain_triton tool', () => {
  it('is read-only (not gated) and named explain_triton', () => {
    expect(explainTritonTool.name).to.equal('explain_triton');
    expect(explainTritonTool.gated).to.not.equal(true);
  });

  it('with no topic returns the index of articles', async () => {
    const res = await explainTritonTool.handler({ knowledgeDir: tmpKnowledge() });
    expect(res.content[0].text).to.contain('file-formats — File formats');
  });

  it('with a topic returns the matching article body', async () => {
    const res = await explainTritonTool.handler({ knowledgeDir: tmpKnowledge(), topic: 'float64' });
    expect(res.content[0].text).to.contain('DEM body.');
  });

  it('with a missing knowledgeDir returns a message, never throws', async () => {
    const res = await explainTritonTool.handler({ knowledgeDir: '/no/such/knowledge' });
    expect(res.content[0].text).to.contain('No knowledge articles');
  });
});
