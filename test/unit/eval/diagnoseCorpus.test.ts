import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { parseTritonCfg } from '../../../src/services/tritonCfg';
import { diagnoseTritonDeck } from '../../../src/services/diagnostics';
import { resolveCfg, fsProbe } from '../../../src/mcp/tools/diagnoseProject';
import { scoreFixture, aggregate, ManifestEntry } from '../../../src/services/diagnoseCorpusScore';

const CORPUS = path.join(__dirname, '../../..', 'eval', 'diagnose-corpus');

function runFixture(entry: ManifestEntry) {
  const dir = path.join(CORPUS, 'fixtures', entry.dir);
  const cfgAbs = resolveCfg(dir, entry.cfgPath ? path.resolve(dir, entry.cfgPath) : undefined);
  if (typeof cfgAbs !== 'string') throw new Error(`${entry.dir}: ${cfgAbs.error}`);
  const cfg = parseTritonCfg(fs.readFileSync(cfgAbs, 'utf8'));
  const report = diagnoseTritonDeck(cfg, path.dirname(cfgAbs), fsProbe(), entry.expectations);
  return scoreFixture(report.findings, entry);
}

describe('diagnose-corpus regression', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8'));
  const entries: ManifestEntry[] = manifest.fixtures;

  it('has 20 fault + 12 clean fixtures (6 of them genuinely-valid ASC for the agent clean control)', () => {
    expect(entries.filter((e) => e.expect !== 'clean').length).to.equal(20);
    expect(entries.filter((e) => e.expect === 'clean').length).to.equal(12);
    // agent "don't cry wolf" control = genuinely-valid ASC clean decks. No GTIFF clean deck exists:
    // TRITON accepts only BIN/ASC input, so input_format=GTIFF is itself a fault, not a clean control.
    expect(entries.filter((e) => e.expect === 'clean' && e.format === 'ASC').length).to.equal(6);
    // Advisory physical findings (e.g. frictionless-domain on clean-frictionless) are excluded from scoring.
  });

  for (const entry of entries) {
    it(`${entry.dir}: ${entry.expect}`, () => {
      const r = runFixture(entry);
      if (entry.expect === 'clean') {
        expect(r.falsePositives, `${entry.dir} should be clean`).to.equal(0);
      } else {
        expect(r.detected, `${entry.dir} should detect ${entry.expect}`).to.equal(true);
        expect(r.isolated, `${entry.dir} should ONLY fire ${entry.expect}`).to.equal(true);
      }
    });
  }

  it('aggregate: 100% detection, 100% isolation, 100% clean precision', () => {
    const results = entries.map(runFixture);
    const a = aggregate(results);
    expect(a.detectionRate).to.equal(1);
    expect(a.isolationRate).to.equal(1);
    expect(a.cleanPrecision).to.equal(1);
  });
});
