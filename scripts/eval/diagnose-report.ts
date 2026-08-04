// Runs the diagnose-corpus and emits a human table + eval/diagnose-corpus/report.json.
// Pure formatters (toReportRows/toMarkdown) are unit-tested; runMain() does the I/O.
import * as fs from 'fs';
import * as path from 'path';
import { parseTritonCfg } from '../../src/services/tritonCfg';
import { diagnoseTritonDeck } from '../../src/services/diagnostics';
import { resolveCfg, fsProbe } from '../../src/mcp/tools/diagnoseProject';
import { scoreFixture, aggregate, ManifestEntry, FixtureResult } from '../../src/services/diagnoseCorpusScore';

export interface ReportRow {
  dir: string; format: string; fault: string; expect: string; detected: string; rank: string;
}

export function toReportRows(entries: ManifestEntry[], results: FixtureResult[]): ReportRow[] {
  return entries.map((e, i) => {
    const r = results[i];
    return {
      dir: e.dir, format: e.format, fault: e.fault, expect: e.expect === 'clean' ? '—' : e.expect,
      detected: r.isClean ? (r.falsePositives === 0 ? 'CLEAN' : `FP:${r.falsePositives}`) : (r.detected ? 'YES' : 'NO'),
      rank: r.rank === null ? '—' : String(r.rank),
    };
  });
}

export function toMarkdown(rows: ReportRow[]): string {
  const head = '| fixture | fmt | injected fault | expected id | detected | rank |';
  const sep = '|---|---|---|---|---|---|';
  const body = rows.map((r) => `| ${r.dir} | ${r.format} | ${r.fault} | ${r.expect} | ${r.detected} | ${r.rank} |`);
  return [head, sep, ...body].join('\n');
}

export function runMain(): void {
  const corpus = path.join(__dirname, '../..', 'eval', 'diagnose-corpus');
  const manifest = JSON.parse(fs.readFileSync(path.join(corpus, 'manifest.json'), 'utf8'));
  const entries: ManifestEntry[] = manifest.fixtures;
  const results: FixtureResult[] = entries.map((entry) => {
    const dir = path.join(corpus, 'fixtures', entry.dir);
    const cfgAbs = resolveCfg(dir, entry.cfgPath ? path.resolve(dir, entry.cfgPath) : undefined);
    if (typeof cfgAbs !== 'string') {
      return { dir: entry.dir, expect: entry.expect, isClean: entry.expect === 'clean', detected: false, rank: null, isolated: false, falsePositives: 0 };
    }
    const cfg = parseTritonCfg(fs.readFileSync(cfgAbs, 'utf8'));
    const report = diagnoseTritonDeck(cfg, path.dirname(cfgAbs), fsProbe(), entry.expectations);
    return scoreFixture(report.findings, entry);
  });
  const rows = toReportRows(entries, results);
  const summary = aggregate(results);
  const md = toMarkdown(rows);
  fs.writeFileSync(path.join(corpus, 'report.json'), JSON.stringify({ rows, summary }, null, 2));
  // eslint-disable-next-line no-console
  console.log(md + `\n\nSummary: detection ${summary.detectionRate * 100}% · isolation ${summary.isolationRate * 100}% · clean precision ${summary.cleanPrecision * 100}%`);
}

if (require.main === module) runMain();
