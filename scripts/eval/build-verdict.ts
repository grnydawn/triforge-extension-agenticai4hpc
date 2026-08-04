// Builds the ground-truth verdict dataset for the reviewer artifact: for every
// diagnose-corpus fixture it crosses the diagnostics TOOL's actual findings with the
// real-TRITON ORACLE outcome, assigns an agreement class, and embeds the deck's files
// (decoded) so a reviewer can verify without the repo.
//
// Run: npx ts-node scripts/eval/build-verdict.ts <output.json>
// (or: TS_NODE_TRANSPILE_ONLY=true TS_NODE_PROJECT=tsconfig.json npx ts-node ...)
import * as fs from 'fs';
import * as path from 'path';
import { parseTritonCfg } from '../../src/services/tritonCfg';
import { diagnoseTritonDeck } from '../../src/services/diagnostics';
import { resolveCfg, fsProbe } from '../../src/mcp/tools/diagnoseProject';
import { ManifestEntry } from '../../src/services/diagnoseCorpusScore';

const TEXT_EXTS = new Set(['.cfg', '.asc', '.hyg', '.src', '.loc', '.txt', '.extbc']);

function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return Number(n.toFixed(6)).toString();
}

// --- BIN decoders (per the KNOWN corpus layouts) ------------------------------
function isPosInt(x: number): boolean {
  return Number.isFinite(x) && x > 0 && Number.isInteger(x);
}

function decodeBin(buf: Buffer): string {
  const len = buf.length;

  // A BIN DEM: float64, 6-value header [ncols,nrows,xll,yll,cellsize,nodata].
  if ((len - 48) % 8 === 0 && len > 48) {
    const ncols = buf.readDoubleLE(0);
    const nrows = buf.readDoubleLE(8);
    if (isPosInt(ncols) && isPosInt(nrows) && ncols * nrows * 8 + 48 === len) {
      const cellsize = buf.readDoubleLE(32);
      const nodata = buf.readDoubleLE(40);
      const n = ncols * nrows;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < n; i++) {
        const v = buf.readDoubleLE(48 + i * 8);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      return `float64 DEM, header ncols=${fmtNum(ncols)} nrows=${fmtNum(nrows)} cellsize=${fmtNum(cellsize)} nodata=${fmtNum(nodata)}; data n=${n} min=${fmtNum(min)} max=${fmtNum(max)} (${len} bytes)`;
    }
  }

  // A BIN runoff map: int32, 2-value header [nrows,ncols].
  if (len % 4 === 0) {
    const nrows = buf.readInt32LE(0);
    const ncols = buf.readInt32LE(4);
    if (isPosInt(nrows) && isPosInt(ncols) && nrows * ncols + 2 === len / 4) {
      const n = nrows * ncols;
      let min = Infinity;
      let max = -Infinity;
      const vals = new Set<number>();
      for (let i = 0; i < n; i++) {
        const v = buf.readInt32LE(8 + i * 4);
        if (v < min) min = v;
        if (v > max) max = v;
        if (vals.size <= 24) vals.add(v);
      }
      const valsStr = Array.from(vals).sort((a, b) => a - b).join(',');
      return `int32 runoff map, header [nrows,ncols]=[${nrows},${ncols}]; zones n=${n} min=${fmtNum(min)} max=${fmtNum(max)} values={${valsStr}} (${len} bytes)`;
    }
  }

  // A BIN aux raster (h_infile etc.): float64, 2-value header [nrows,ncols].
  if (len % 8 === 0) {
    const nrows = buf.readDoubleLE(0);
    const ncols = buf.readDoubleLE(8);
    if (isPosInt(nrows) && isPosInt(ncols) && nrows * ncols + 2 === len / 8) {
      const n = nrows * ncols;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < n; i++) {
        const v = buf.readDoubleLE(16 + i * 8);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      return `float64 raster, header [nrows,ncols]=[${nrows},${ncols}]; data n=${n} min=${fmtNum(min)} max=${fmtNum(max)} (${len} bytes)`;
    }
  }

  // A headerless int32 (rare).
  if (len % 4 === 0 && len > 0) {
    const n = len / 4;
    let min = Infinity;
    let max = -Infinity;
    let allInt = true;
    for (let i = 0; i < n; i++) {
      const v = buf.readInt32LE(i * 4);
      if (v < min) min = v;
      if (v > max) max = v;
      void allInt;
    }
    return `int32 headerless, n=${n} min=${fmtNum(min)} max=${fmtNum(max)} (${len} bytes)`;
  }

  return `unrecognized (${len} bytes)`;
}

interface DeckFile {
  name: string;
  kind: string;
  text: string;
}

function collectFiles(cfgAbs: string, deckDir: string): DeckFile[] {
  const files: DeckFile[] = [];

  // run.cfg first.
  const cfgName = path.basename(cfgAbs);
  files.push({
    name: cfgName,
    kind: 'cfg',
    text: fs.readFileSync(cfgAbs, 'utf8').replace(/\s+$/, ''),
  });

  // every file under input/.
  const inputDir = path.join(deckDir, 'input');
  if (fs.existsSync(inputDir) && fs.statSync(inputDir).isDirectory()) {
    for (const fname of fs.readdirSync(inputDir).sort()) {
      const abs = path.join(inputDir, fname);
      if (!fs.statSync(abs).isFile()) continue;
      const ext = path.extname(fname).toLowerCase();
      const rel = `input/${fname}`;
      if (ext === '.bin') {
        const buf = fs.readFileSync(abs);
        const summary = decodeBin(buf);
        // eslint-disable-next-line no-console
        console.log(`  [bin] ${cfgName.replace(/run\.cfg$/, '')}${rel}: ${summary}`);
        files.push({ name: rel, kind: 'bin', text: summary });
      } else if (TEXT_EXTS.has(ext)) {
        files.push({ name: rel, kind: ext.slice(1), text: fs.readFileSync(abs, 'utf8').replace(/\s+$/, '') });
      } else {
        // unknown extension: treat as binary summary
        const buf = fs.readFileSync(abs);
        files.push({ name: rel, kind: 'bin', text: decodeBin(buf) });
      }
    }
  }
  return files;
}

function classify(oracleOutcome: string, hasError: boolean): string {
  const rejects = oracleOutcome === 'startup-reject' || oracleOutcome === 'ran-but-diverged';
  if (rejects && hasError) return 'agree-fault';
  if (oracleOutcome === 'ran-to-completion' && !hasError) return 'agree-clean';
  if (oracleOutcome === 'ran-to-completion' && hasError) return 'tool-stricter';
  if (rejects && !hasError) return 'tool-missed';
  return 'unclassified';
}

function main(): void {
  const outPath = process.argv[2];
  if (!outPath) {
    // eslint-disable-next-line no-console
    console.error('usage: build-verdict.ts <output.json>');
    process.exit(1);
  }

  const corpus = path.join(__dirname, '../..', 'eval', 'diagnose-corpus');
  const manifest = JSON.parse(fs.readFileSync(path.join(corpus, 'manifest.json'), 'utf8'));
  // Raw entries retain extra fields (family/condition/oracleExpect) not on ManifestEntry.
  const rawEntries: Array<ManifestEntry & { family?: string }> = manifest.fixtures;

  const oracle: Array<{ fixture: string; outcome: string }> = JSON.parse(
    fs.readFileSync(path.join(corpus, 'oracle-report.json'), 'utf8'),
  );
  const oracleByDir = new Map(oracle.map((o) => [o.fixture, o.outcome]));

  const out = rawEntries.map((entry) => {
    const deckDir = path.join(corpus, 'fixtures', entry.dir);
    const cfgAbs = resolveCfg(deckDir, entry.cfgPath ? path.resolve(deckDir, entry.cfgPath) : undefined);
    if (typeof cfgAbs !== 'string') {
      throw new Error(`could not resolve cfg for ${entry.dir}: ${cfgAbs.error}`);
    }
    const cfg = parseTritonCfg(fs.readFileSync(cfgAbs, 'utf8'));
    const report = diagnoseTritonDeck(cfg, path.dirname(cfgAbs), fsProbe(), entry.expectations);

    const findings = report.findings.map((f) => ({
      id: f.id,
      severity: f.severity,
      advisory: f.advisory === true,
      title: f.title,
      evidence: f.evidence,
      detail: f.detail,
    }));
    const hasError = findings.some((f) => f.severity === 'error');
    const oracleOutcome = oracleByDir.get(entry.dir);
    if (oracleOutcome === undefined) {
      throw new Error(`no oracle outcome for fixture ${entry.dir}`);
    }
    const agreement = classify(oracleOutcome, hasError);

    // eslint-disable-next-line no-console
    console.log(`${entry.dir}: oracle=${oracleOutcome} hasError=${hasError} -> ${agreement}`);

    const files = collectFiles(cfgAbs, deckDir);

    return {
      dir: entry.dir,
      family: entry.family ?? '',
      format: entry.format,
      fault: entry.fault,
      expect: entry.expect,
      // User-declared invariants passed to the tool ALONGSIDE the deck (not parsed from run.cfg).
      // The exp-* fixtures' findings reference these, so the page must show them to stay self-contained.
      expectations: entry.expectations ?? null,
      oracleOutcome,
      findings,
      hasError,
      agreement,
      files,
    };
  });

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  const tally: Record<string, number> = {};
  for (const x of out) tally[x.agreement] = (tally[x.agreement] || 0) + 1;
  // eslint-disable-next-line no-console
  console.log(`\nWrote ${out.length} entries to ${outPath}`);
  // eslint-disable-next-line no-console
  console.log(`Agreement tally: ${JSON.stringify(tally)}`);
  const missing = out.filter((x) => !x.oracleOutcome).map((x) => x.dir);
  // eslint-disable-next-line no-console
  console.log(`Fixtures missing oracleOutcome: ${missing.length ? missing.join(', ') : 'none'}`);
  const missed = out.filter((x) => x.agreement === 'tool-missed').map((x) => x.dir);
  // eslint-disable-next-line no-console
  console.log(`tool-missed (must be 0): ${missed.length} ${missed.length ? '-> ' + missed.join(', ') : ''}`);
}

main();
