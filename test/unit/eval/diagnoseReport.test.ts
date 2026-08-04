import { expect } from 'chai';
import { toReportRows, toMarkdown } from '../../../scripts/eval/diagnose-report';
import { FixtureResult, ManifestEntry } from '../../../src/services/diagnoseCorpusScore';

const entry: ManifestEntry = { dir: 'fault-grid-bin', format: 'BIN', fault: 'roff != dem bytes', expect: 'grid-size-mismatch' };
const res: FixtureResult = { dir: 'fault-grid-bin', expect: 'grid-size-mismatch', isClean: false, detected: true, rank: 1, isolated: true, falsePositives: 0 };

describe('diagnose-report formatting', () => {
  it('builds a row with detection + rank', () => {
    const row = toReportRows([entry], [res])[0];
    expect(row.dir).to.equal('fault-grid-bin');
    expect(row.detected).to.equal('YES');
    expect(row.rank).to.equal('1');
  });
  it('markdown table has a header and the fixture row', () => {
    const md = toMarkdown(toReportRows([entry], [res]));
    expect(md).to.contain('| fixture |');
    expect(md).to.contain('fault-grid-bin');
  });
});
