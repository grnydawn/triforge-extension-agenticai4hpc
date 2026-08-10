// test/unit/services/tritonKnowledge-content.test.ts
import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { loadKnowledge, lookupKnowledge } from '../../../src/services/tritonKnowledge';
import { bannedSitePattern } from '../../helpers/bannedTokens';

const KNOWLEDGE_DIR = path.join(__dirname, '../../..', 'resources', 'knowledge');

describe('shipped knowledge articles', () => {
  const articles = loadKnowledge(KNOWLEDGE_DIR);

  it('ships the six expected articles', () => {
    expect(articles.map((a) => a.id).sort()).to.deep.equal(
      ['deck-and-paths', 'failure-modes', 'file-formats', 'grid-conventions', 'output-variables', 'triforge-workflow'],
    );
  });

  it('has unique ids', () => {
    const ids = articles.map((a) => a.id);
    expect(new Set(ids).size).to.equal(ids.length);
  });

  it('stays generic — no ephemeral / site-specific tokens', () => {
    const banned = bannedSitePattern('|session_|scratch|\\/home\\/');
    for (const rel of fs.readdirSync(KNOWLEDGE_DIR)) {
      const text = fs.readFileSync(path.join(KNOWLEDGE_DIR, rel), 'utf8');
      expect(banned.test(text), `${rel} contains an ephemeral/site-specific token`).to.equal(false);
    }
  });

  it('wires end-to-end — a keyword lookup returns the right article body', () => {
    const out = lookupKnowledge(articles, 'float64');
    expect(out).to.contain('file-formats');
    expect(out.toLowerCase()).to.contain('header');
  });
});
