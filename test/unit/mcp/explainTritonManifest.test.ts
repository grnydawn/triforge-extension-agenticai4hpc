// test/unit/mcp/explainTritonManifest.test.ts
import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

describe('explain_triton languageModelTools manifest', () => {
  it('is declared in package.json with the triforge tag and optional topic', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../..', 'package.json'), 'utf8'));
    const entry = (pkg.contributes.languageModelTools as any[]).find((t) => t.name === 'triforge_explain_triton');
    expect(entry, 'triforge_explain_triton entry').to.not.equal(undefined);
    expect(entry.tags).to.include('triforge');
    expect(entry.inputSchema.properties).to.have.property('topic');
  });
});
