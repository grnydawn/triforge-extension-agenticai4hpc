/**
 * Regenerate baseline.json for a golden fixture mode from the committed real frames.
 *
 * Usage:
 *   npx ts-node test/helpers/gen-golden-baseline.ts [exe]
 *
 * Reads test/e2e/fixtures/golden/<mode>/{config.json,triton_execution.cfg,output/asc/H_*.out}
 * and writes test/e2e/fixtures/golden/<mode>/baseline.json. Grid/NODATA come from config.json,
 * projection from the cfg, and depthMin/Max are scanned from the committed H_ depth frames
 * (NODATA cells excluded). Re-run after re-harvesting or changing the kept-frame subset.
 */
import * as fs from 'fs';
import * as path from 'path';

const mode = process.argv[2] || 'exe';
const root = path.join('test', 'e2e', 'fixtures', 'golden', mode);
const ascDir = path.join(root, 'output', 'asc');

const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const header = config.settings.utmHeader;
const noData: number = header.NODATA_value;

const cfgText = fs.readFileSync(path.join(root, 'triton_execution.cfg'), 'utf8');
const projLine = cfgText.split(/\r?\n/).find((l) => l.startsWith('projection='));
const projection = projLine ? projLine.split('=')[1].trim() : null;

const frames = fs
  .readdirSync(ascDir)
  .filter((f) => /^H_\d+_\d+\.out$/.test(f))
  .sort();

const steps = new Set<number>();
const partitions = new Set<number>();
let min = Infinity;
let max = -Infinity;

for (const f of frames) {
  const m = f.match(/^H_(\d+)_(\d+)\.out$/)!;
  steps.add(parseInt(m[1], 10));
  partitions.add(parseInt(m[2], 10));
  const txt = fs.readFileSync(path.join(ascDir, f), 'utf8');
  for (const tok of txt.split(/\s+/)) {
    if (tok === '') continue;
    const v = parseFloat(tok);
    if (Number.isNaN(v) || v === noData) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

const baseline = {
  mode,
  project: config.settings.name,
  demFile: 'test/e2e/fixtures/dems/HawRidgePark.asc',
  cfgFile: path.join(root, 'triton_execution.cfg'),
  outputDir: ascDir,
  depthFramePattern: 'H_%02d_%02d.out',
  keptSteps: [...steps].sort((a, b) => a - b),
  partitions: [...partitions].sort((a, b) => a - b),
  frameCount: frames.length,
  gridCols: header.ncols,
  gridRows: header.nrows,
  cellsize: header.cellsize,
  noData,
  projection,
  depthMin: round6(min),
  depthMax: round6(max),
  _note:
    'depthMin/Max computed over the committed H frame subset only (both partitions), excluding NODATA cells.',
};

fs.writeFileSync(path.join(root, 'baseline.json'), JSON.stringify(baseline, null, 2) + '\n');
console.log(`Wrote ${path.join(root, 'baseline.json')} (${frames.length} frames, depth ${baseline.depthMin}..${baseline.depthMax})`);
