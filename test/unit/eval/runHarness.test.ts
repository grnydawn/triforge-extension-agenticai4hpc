import { expect } from 'chai';
import {
  categoryOf, trialsFor, nlExpectation, promptFor, goldFor, buildScoringCsv, buildAnswerKey, buildPromptsJson, Gold,
} from '../../../scripts/eval/run-harness';
import { ManifestEntry } from '../../../src/services/diagnoseCorpusScore';
import { Finding } from '../../../src/services/diagnostics';

const deckFault: ManifestEntry = { dir: 'fault-grid-bin', format: 'BIN', fault: 'x', expect: 'grid-size-mismatch' };
const expEntry: ManifestEntry = { dir: 'exp-runoff-count', format: 'BIN', fault: 'x', expect: 'expectation-runoff-count', expectations: { numRunoffs: 5 } };
const cleanEntry: ManifestEntry = { dir: 'clean-bin', format: 'BIN', fault: 'none', expect: 'clean' };

describe('run-harness', () => {
  it('categorizes deck-fault / expectation / clean', () => {
    expect(categoryOf(deckFault)).to.equal('deck-fault');
    expect(categoryOf(expEntry)).to.equal('expectation');
    expect(categoryOf(cleanEntry)).to.equal('clean');
  });

  it('trials: deck faults use deckTrials, others 1', () => {
    expect(trialsFor(deckFault, 3)).to.equal(3);
    expect(trialsFor(expEntry, 3)).to.equal(1);
    expect(trialsFor(cleanEntry, 3)).to.equal(1);
  });

  it('nlExpectation renders each field (and empty for none)', () => {
    expect(nlExpectation({ numRunoffs: 5 })).to.contain('5 runoff zones');
    expect(nlExpectation({ forcingRange: { min: 0, max: 0.5 } })).to.contain('0..0.5');
    expect(nlExpectation(undefined)).to.equal('');
  });

  it('promptFor appends the expectation clause only for expectation fixtures', () => {
    const p = promptFor('eval/diagnose-corpus/fixtures/fault-grid-bin', deckFault);
    expect(p).to.contain('Review the TRITON project');
    expect(p).to.not.contain('I also expect');
    expect(promptFor('eval/diagnose-corpus/fixtures/exp-runoff-count', expEntry)).to.contain('5 runoff zones');
  });

  it('goldFor picks the matching finding; clean has no fault', () => {
    const findings: Finding[] = [{ id: 'grid-size-mismatch', severity: 'error', title: 't', detail: 'd', evidence: 'DEM 1024 cells', pointsTo: 'the raster-generation step' }];
    const g = goldFor(findings, deckFault);
    expect(g.goldFinding).to.equal('grid-size-mismatch');
    expect(g.goldEvidence).to.contain('1024');
    expect(g.goldStage).to.equal('the raster-generation step');
    expect(goldFor([], cleanEntry).goldFinding).to.equal('clean');
  });

  it('scoring CSV: header + one row per client×arm×trial, called_tool n/a for Arm C', () => {
    const csv = buildScoringCsv([deckFault, cleanEntry], ['claude', 'copilot'], ['A', 'C'], 3);
    const lines = csv.trim().split('\n');
    // header + (deckFault ×3 + clean ×1) = 4 trials × 2 clients × 2 arms = 16 rows
    expect(lines.length).to.equal(1 + 16);
    expect(lines[0]).to.contain('called_tool');
    const armC = lines.slice(1).filter((l) => /^[a-z]+,C,/.test(l));
    expect(armC.length).to.equal(8);
    expect(armC.every((l) => l.includes('n/a'))).to.equal(true);
  });

  it('prompts.json round-trips fixture + prompt + gold', () => {
    const golds: Gold[] = [{ dir: 'fault-grid-bin', category: 'deck-fault', prompt: 'P', expectationText: '', goldFinding: 'grid-size-mismatch', goldEvidence: 'E', goldStage: 'S' }];
    const parsed = JSON.parse(buildPromptsJson(golds));
    expect(parsed[0].dir).to.equal('fault-grid-bin');
    expect(parsed[0].prompt).to.equal('P');
    expect(parsed[0].goldFinding).to.equal('grid-size-mismatch');
  });

  it('answer key contains directions, each fixture, and a collapsed gold block', () => {
    const golds: Gold[] = [{ dir: 'fault-grid-bin', category: 'deck-fault', prompt: 'P', expectationText: '', goldFinding: 'grid-size-mismatch', goldEvidence: 'E', goldStage: 'S' }];
    const md = buildAnswerKey(golds);
    expect(md).to.contain('How to run one session');
    expect(md).to.contain('How to score against the gold');
    expect(md).to.contain('fault-grid-bin');
    expect(md).to.contain('grid-size-mismatch');
    expect(md).to.contain('<details>');                     // gold collapsed by default
    expect(md).to.contain('do NOT show the agent');
  });
});
