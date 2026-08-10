import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate';
import { exportTfpTool } from '../../../src/mcp/tools/exportTfp';
import { importTfpTool } from '../../../src/mcp/tools/importTfp';
import { ToolRegistry } from '../../../src/mcp/registry';

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A minimal on-disk project: config.json + one input file. */
function makeProject(): string {
  const dir = tmp('tf-proj-');
  fs.mkdirSync(path.join(dir, 'input'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'input', 'dem.asc'), 'DEM_BYTES');
  const config = {
    settings: { name: 'Demo', id: 'demo-1', path: dir },
    input: { dem: path.join(dir, 'input', 'dem.asc') },
    compsetup: {},
    execution: {},
    output: { geotiff: [], binary: [], ascii: [] },
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
  return dir;
}

describe('export_tfp tool', () => {
  it('packages config + inputs into a .tfp with a valid manifest', async () => {
    const proj = makeProject();
    const out = path.join(tmp('tf-out-'), 'demo.tfp');
    const res = await exportTfpTool.handler({ projectDir: proj, outPath: out }, { cwd: process.cwd() });
    expect(res.isError).to.not.equal(true);
    expect(fs.existsSync(out)).to.equal(true);

    const entries = unzipSync(fs.readFileSync(out));
    expect(Object.keys(entries)).to.include('triforge.export.json');
    expect(Object.keys(entries)).to.include('config.json');
    expect(Object.keys(entries)).to.include('input/dem.asc');
    const manifest = JSON.parse(strFromU8(entries['triforge.export.json']));
    expect(manifest.projectName).to.equal('Demo');
    expect(manifest.projectId).to.equal('demo-1');
    // The portable config must NOT carry the machine-local project path.
    const cfg = JSON.parse(strFromU8(entries['config.json']));
    expect(cfg.settings.path).to.equal(undefined);
    expect(cfg.input.dem).to.equal('input/dem.asc'); // relativized + POSIX
  });

  it('surfaces input files staged from OUTSIDE the project', async () => {
    const proj = makeProject();
    // A DEM that lives outside the project folder.
    const outsideDir = tmp('tf-outside-');
    const outside = path.join(outsideDir, 'faraway.asc');
    fs.writeFileSync(outside, 'OUTSIDE');
    const cfgPath = path.join(proj, 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.input.dem = outside;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

    const out = path.join(tmp('tf-out-'), 'demo.tfp');
    const res = await exportTfpTool.handler({ projectDir: proj, outPath: out }, { cwd: process.cwd() });
    expect(res.isError).to.not.equal(true);
    expect(res.content[0].text).to.match(/external input/i);
    expect(res.content[0].text).to.contain(outside);
  });

  it('errors when the project folder has no config.json', async () => {
    const res = await exportTfpTool.handler(
      { projectDir: tmp('tf-empty-'), outPath: path.join(tmp('tf-o-'), 'x.tfp') },
      { cwd: process.cwd() },
    );
    expect(res.isError).to.equal(true);
    expect(res.content[0].text).to.match(/config\.json/i);
  });
});

describe('import_tfp tool', () => {
  it('round-trips: export then import re-materializes the project under destRoot', async () => {
    const proj = makeProject();
    const out = path.join(tmp('tf-out-'), 'demo.tfp');
    await exportTfpTool.handler({ projectDir: proj, outPath: out }, { cwd: process.cwd() });

    const dest = path.join(tmp('tf-dest-'), 'Demo');
    const res = await importTfpTool.handler({ archivePath: out, destRoot: dest }, { cwd: process.cwd() });
    expect(res.isError).to.not.equal(true);
    expect(fs.existsSync(path.join(dest, 'config.json'))).to.equal(true);
    expect(fs.existsSync(path.join(dest, 'input', 'dem.asc'))).to.equal(true);

    const local = JSON.parse(fs.readFileSync(path.join(dest, 'config.json'), 'utf8'));
    expect(local.settings.path).to.equal(dest);                      // re-absolutized
    expect(local.input.dem).to.equal(path.join(dest, 'input', 'dem.asc'));
  });

  it('refuses an archive whose entry escapes the destination (zip-slip)', async () => {
    const evil = zipSync({
      'triforge.export.json': strToU8(JSON.stringify({
        schemaVersion: '1.0.0', exportedAt: 'x', projectName: 'E', projectId: 'e-1', includesOutputs: false, sourceOS: 'linux',
      })),
      'config.json': strToU8(JSON.stringify({ settings: { id: 'e-1', name: 'E' } })),
      '../evil.txt': strToU8('pwn'),
    });
    const archive = path.join(tmp('tf-evil-'), 'evil.tfp');
    fs.writeFileSync(archive, evil);
    const dest = path.join(tmp('tf-dest2-'), 'E');
    const res = await importTfpTool.handler({ archivePath: archive, destRoot: dest }, { cwd: process.cwd() });
    expect(res.isError).to.equal(true);
    expect(res.content[0].text).to.match(/escape/i);
    expect(fs.existsSync(path.join(path.dirname(dest), 'evil.txt'))).to.equal(false); // nothing written
  });

  it('is gated: the registry requires approval before it imports', async () => {
    const proj = makeProject();
    const out = path.join(tmp('tf-out-'), 'demo.tfp');
    await exportTfpTool.handler({ projectDir: proj, outPath: out }, { cwd: process.cwd() });
    const dest = path.join(tmp('tf-dest3-'), 'Demo');

    const r = new ToolRegistry();
    r.register(importTfpTool);
    const first = await r.call('import_tfp', { archivePath: out, destRoot: dest });
    expect(first.pendingApproval).to.be.an('object');
    expect(fs.existsSync(path.join(dest, 'config.json'))).to.equal(false); // not yet
    const second = await r.call('import_tfp', { archivePath: out, destRoot: dest, approvalToken: first.pendingApproval!.token });
    expect(second.isError).to.not.equal(true);
    expect(fs.existsSync(path.join(dest, 'config.json'))).to.equal(true);
  });
});
