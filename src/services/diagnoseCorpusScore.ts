// Pure scoring for the diagnose_project evaluation corpus. No fs/vscode — takes the
// findings a fixture produced plus its manifest entry and returns a scored result.
import { Finding, Expectations } from './diagnostics';

export interface ManifestEntry {
  dir: string;
  format: 'BIN' | 'ASC' | 'GTIFF';
  fault: string;                 // human description
  expect: string;                // a finding id, or "clean"
  expectations?: Expectations;   // passed to the handler when present
  cfgPath?: string;
}

export interface FixtureResult {
  dir: string;
  expect: string;
  isClean: boolean;
  detected: boolean;             // fault: expected id present (clean: always false)
  rank: number | null;          // 1-based position of the first expected-id finding
  isolated: boolean;            // fault: every finding shares the expected id
  falsePositives: number;       // clean: count of ANY finding (fault: 0)
}

export function scoreFixture(findings: Finding[], entry: ManifestEntry): FixtureResult {
  const isClean = entry.expect === 'clean';
  const scorable = findings.filter((f) => !f.advisory);
  if (isClean) {
    // A clean deck must stay silent: every NON-advisory finding (error/warning/info) is a
    // false positive. Advisory physical/heuristic findings are excluded — they may fire on
    // a physically-clean deck without counting against precision.
    const falsePositives = scorable.length;
    return { dir: entry.dir, expect: entry.expect, isClean: true, detected: false, rank: null, isolated: false, falsePositives };
  }
  const idx = findings.findIndex((f) => f.id === entry.expect);
  const detected = idx >= 0;
  const isolated = detected && scorable.every((f) => f.id === entry.expect);
  return {
    dir: entry.dir, expect: entry.expect, isClean: false,
    detected, rank: detected ? idx + 1 : null, isolated, falsePositives: 0,
  };
}

export function aggregate(results: FixtureResult[]): {
  total: number; faults: number; clean: number;
  detectionRate: number; isolationRate: number; cleanPrecision: number;
} {
  const faultResults = results.filter((r) => !r.isClean);
  const cleanResults = results.filter((r) => r.isClean);
  const faults = faultResults.length;
  const clean = cleanResults.length;
  const detected = faultResults.filter((r) => r.detected).length;
  const isolated = faultResults.filter((r) => r.isolated).length;
  const precise = cleanResults.filter((r) => r.falsePositives === 0).length;
  return {
    total: results.length, faults, clean,
    detectionRate: faults ? detected / faults : 1,
    isolationRate: faults ? isolated / faults : 1,
    cleanPrecision: clean ? precise / clean : 1,
  };
}
