import { expect } from 'chai';
import { scoreFixture, aggregate, ManifestEntry } from '../../../src/services/diagnoseCorpusScore';
import { Finding } from '../../../src/services/diagnostics';

const f = (id: string, severity: 'error' | 'warning' | 'info' = 'error'): Finding =>
  ({ id, severity, title: id, detail: '', evidence: '', pointsTo: '' });

const err = (id: string): Finding => ({ id, severity: 'error', title: '', detail: '', evidence: '', pointsTo: '' });
const advisory = (id: string): Finding => ({ id, severity: 'warning', title: '', detail: '', evidence: '', pointsTo: '', advisory: true });

describe('diagnoseCorpusScore advisory handling', () => {
  it('clean fixture: advisory findings are NOT false positives', () => {
    const r = scoreFixture([advisory('frictionless-domain')], { dir: 'x', format: 'BIN', fault: '', expect: 'clean' });
    expect(r.falsePositives).to.equal(0);
  });
  it('clean fixture: a non-advisory finding IS a false positive', () => {
    const r = scoreFixture([err('grid-size-mismatch')], { dir: 'x', format: 'BIN', fault: '', expect: 'clean' });
    expect(r.falsePositives).to.equal(1);
  });
  it('fault fixture: co-firing advisory does NOT break isolation', () => {
    const r = scoreFixture([err('value-range-sanity'), advisory('courant-above-recommended')],
      { dir: 'x', format: 'BIN', fault: '', expect: 'value-range-sanity' });
    expect(r.detected).to.equal(true);
    expect(r.isolated).to.equal(true);
  });
});

describe('scoreFixture', () => {
  const faultEntry: ManifestEntry = { dir: 'x', format: 'BIN', fault: '', expect: 'grid-size-mismatch' };

  it('detects + isolates a fault when only the expected id is present', () => {
    const r = scoreFixture([f('grid-size-mismatch')], faultEntry);
    expect(r.detected).to.equal(true);
    expect(r.rank).to.equal(1);
    expect(r.isolated).to.equal(true);
  });

  it('detected but NOT isolated when a foreign finding also fires', () => {
    const r = scoreFixture([f('value-range-sanity', 'warning'), f('grid-size-mismatch')], faultEntry);
    expect(r.detected).to.equal(true);
    expect(r.rank).to.equal(2);
    expect(r.isolated).to.equal(false);
  });

  it('not detected when the expected id is absent', () => {
    const r = scoreFixture([f('value-range-sanity', 'warning')], faultEntry);
    expect(r.detected).to.equal(false);
    expect(r.rank).to.equal(null);
  });

  it('clean fixture: falsePositives counts findings of ANY severity', () => {
    const clean: ManifestEntry = { dir: 'c', format: 'BIN', fault: '', expect: 'clean' };
    expect(scoreFixture([], clean).falsePositives).to.equal(0);
    // A clean deck must stay silent — even an info finding is a false positive.
    expect(scoreFixture([f('x', 'info')], clean).falsePositives).to.equal(1);
    expect(scoreFixture([f('x', 'warning'), f('y', 'error')], clean).falsePositives).to.equal(2);
    expect(scoreFixture([f('a', 'error'), f('b', 'warning'), f('c', 'info')], clean).falsePositives).to.equal(3);
  });

  it('aggregate computes rates', () => {
    const results = [
      scoreFixture([f('grid-size-mismatch')], faultEntry),
      scoreFixture([f('value-range-sanity', 'warning')], faultEntry),
      scoreFixture([], { dir: 'c', format: 'BIN', fault: '', expect: 'clean' }),
    ];
    const a = aggregate(results);
    expect(a.faults).to.equal(2);
    expect(a.clean).to.equal(1);
    expect(a.detectionRate).to.equal(0.5);
    expect(a.cleanPrecision).to.equal(1);
  });
});
