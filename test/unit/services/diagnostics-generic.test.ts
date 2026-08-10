// test/unit/services/diagnostics-generic.test.ts
import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { bannedSitePattern } from '../../helpers/bannedTokens';

// The diagnosis code must be generic to ANY TRITON workflow — no site-specific token.
describe('diagnose_project genericity invariant', () => {
  const files = [
    'src/services/tritonCfg.ts',
    'src/services/diagnostics.ts',
    'src/mcp/tools/diagnoseProject.ts',
  ];
  const banned = bannedSitePattern();

  it('hardcodes no site-specific value in the diagnosis sources', () => {
    for (const rel of files) {
      const text = fs.readFileSync(path.join(__dirname, '../../..', rel), 'utf8');
      expect(banned.test(text), `${rel} contains a site-specific token`).to.equal(false);
    }
  });
});
