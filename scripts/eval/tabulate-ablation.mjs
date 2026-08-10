// Turn the judged ablation CSVs into the paper's tab:results / tab:efficiency rows and the
// clean-controls prose numbers, so the Phase-2 landing is a copy-paste, not a hand-count.
//
// Run: node scripts/eval/tabulate-ablation.mjs [runs-dir]
//   reads results-<client>-judged.csv for each client it finds.
import fs from 'fs';
import path from 'path';

const RUNS = process.argv[2] || 'eval/diagnose-corpus/runs';
const CLIENTS = ['claude', 'codex'];
const yes = (v) => v === 'Y' || v === 'y' || v === '1' || v === 'yes';
const H = 'client,arm,fixture,category,trial,turns,wall_s,tokens_in,tokens_out,tokens_cached,mcp_overhead_tokens,called_tool,found_fault,right_stage,transcript'.split(',');
const I = Object.fromEntries(H.map((h, i) => [h, i]));

function load(client) {
  const f = path.join(RUNS, `results-${client}-judged.csv`);
  if (!fs.existsSync(f)) return null;
  return fs.readFileSync(f, 'utf8').trim().split('\n').slice(1).filter(Boolean).map((l) => l.split(','));
}

const pct = (n, d) => (d === 0 ? '--' : Math.round((100 * n) / d));
const mean = (xs) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + Number(b || 0), 0) / xs.length);

function statsFor(rows, arm) {
  const R = rows.filter((r) => r[I.arm] === arm);
  const deck = R.filter((r) => r[I.category] === 'deck-fault');
  const exp = R.filter((r) => r[I.category] === 'expectation');
  const clean = R.filter((r) => r[I.category] === 'clean');
  const found = (a) => a.filter((r) => yes(r[I.found_fault])).length;
  const stage = (a) => a.filter((r) => yes(r[I.right_stage])).length;
  const all = [...deck, ...exp, ...clean];
  return {
    deckN: deck.length, deckFound: pct(found(deck), deck.length), deckStage: pct(stage(deck), deck.length),
    expN: exp.length, expFound: pct(found(exp), exp.length),
    cleanN: clean.length, cleanPrec: pct(found(clean), clean.length), cleanCorrect: found(clean),
    overall: pct(found(all), all.length),
    turns: mean(all.map((r) => r[I.turns])).toFixed(1),
    wall: mean(all.map((r) => r[I.wall_s])).toFixed(0),
    tin: Math.round(mean(all.map((r) => r[I.tokens_in]))),
    tout: Math.round(mean(all.map((r) => r[I.tokens_out]))),
    ovh: arm === 'A' ? Math.round(mean(all.map((r) => (r[I.mcp_overhead_tokens] === 'na' ? 0 : r[I.mcp_overhead_tokens])))) : 0,
  };
}

const grp = (n) => n.toLocaleString('en-US').replace(/,/g, '{,}');

const resultsRows = [];
const effRows = [];
const cleanProse = [];
for (const client of CLIENTS) {
  const rows = load(client);
  if (!rows) { console.error(`(skip ${client}: no judged CSV)`); continue; }
  const Cap = client[0].toUpperCase() + client.slice(1);
  for (const [arm, label] of [['A', '$+$tool'], ['C', 'bare']]) {
    const s = statsFor(rows, arm);
    const bold = (v) => (arm === 'A' ? `\\textbf{${v}}` : `${v}`);
    resultsRows.push(`${Cap.padEnd(6)} & ${label.padEnd(7)} & ${bold(s.deckFound)} & ${s.deckStage} & ${s.expFound} & ${bold(s.cleanPrec)} & ${bold(s.overall)} \\\\`);
    effRows.push(`${Cap.padEnd(6)} & ${label.padEnd(7)} & ${s.turns} & ${s.wall} & ${grp(s.tin)} & ${grp(s.tout)} & ${s.ovh} \\\\`);
    cleanProse.push(`${Cap} ${arm === 'A' ? '+tool' : 'bare'}: clean-precision ${s.cleanCorrect}/${s.cleanN} (${s.cleanPrec}%), overall ${s.overall}%`);
  }
}

console.log('=== tab:results rows ===');
console.log(resultsRows.join('\n'));
console.log('\n=== tab:efficiency rows ===');
console.log(effRows.join('\n'));
console.log('\n=== clean-controls prose numbers ===');
console.log(cleanProse.join('\n'));
