import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createWaterSourceTool } from '../../../src/mcp/tools/createWaterSource';
import { animateGifTool } from '../../../src/mcp/tools/animateGif';
import { generateDemTool } from '../../../src/mcp/tools/generateDem';

const API_KEY_ENV = 'TRIFORGE_OPENTOPOGRAPHY_API_KEY';

/** A minimal but REAL nested config.json, as ProjectManager writes it. */
function writeNestedConfig(dir: string, over: Record<string, any> = {}): void {
  const cfg = {
    version: '1.0.0',
    settings: {
      name: 'demo',
      utmZone: 17,
      datum: 'WGS84',
      utmHeader: { ncols: 2, nrows: 2, xllcorner: 500000, yllcorner: 4000000, cellsize: 30, NODATA_value: -9999 },
      ...(over.settings ?? {}),
    },
    compsetup: { sim_start_time: 0, sim_duration: 3600 },
    execution: { print_interval: 900 },
    input: {},
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2));
}

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tf-m5-'));
}

describe('M5 tool handlers (nested config schema)', () => {
  it('create_water_source writes .src/.hyg under input/ and wires config.input.*', async () => {
    const dir = tmpProject();
    writeNestedConfig(dir);
    const res = await createWaterSourceTool.handler(
      { projectDir: dir, locations: [{ x: 500010, y: 4000010 }], hydrographs: [[0, 5, 10]] },
      { cwd: dir },
    );
    expect(res.isError).to.not.equal(true);
    expect(fs.existsSync(path.join(dir, 'input', 'demo.src'))).to.equal(true);
    expect(fs.existsSync(path.join(dir, 'input', 'demo.hyg'))).to.equal(true);

    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8'));
    // wired under input/, NOT at the top level
    expect(cfg.input.num_sources).to.equal(1);
    expect(cfg.input.src_loc_file).to.equal(path.join(dir, 'input', 'demo.src'));
    expect(cfg.input.hydrograph_filename).to.equal(path.join(dir, 'input', 'demo.hyg'));
    expect(cfg).to.not.have.property('num_sources');
    expect(cfg).to.not.have.property('src_loc_file');
  });

  it('create_water_source errors when config lacks utmZone', async () => {
    const dir = tmpProject();
    writeNestedConfig(dir, { settings: { utmZone: undefined } });
    const res = await createWaterSourceTool.handler(
      { projectDir: dir, locations: [{ x: 1, y: 2 }], hydrographs: [[0]] },
      { cwd: dir },
    );
    expect(res.isError).to.equal(true);
    expect(res.content[0].text).to.match(/utmZone/);
  });

  it('animate_gif defaults to output/asc, filters to the H variable, and writes a GIF', async () => {
    const dir = tmpProject();
    writeNestedConfig(dir);
    const ascDir = path.join(dir, 'output', 'asc');
    fs.mkdirSync(ascDir, { recursive: true });
    // 2x2 raw grids (matching utmHeader ncols/nrows)
    fs.writeFileSync(path.join(ascDir, 'H_0_0.out'), '1 2\n3 4\n');
    fs.writeFileSync(path.join(ascDir, 'H_1_0.out'), '5 6\n7 8\n');
    // A QX frame that MUST be excluded by the variable filter
    fs.writeFileSync(path.join(ascDir, 'QX_0_0.out'), '0 0\n0 0\n');

    const res = await animateGifTool.handler({ projectDir: dir }, { cwd: dir });
    expect(res.isError).to.not.equal(true);
    // 2 H frames only — if QX leaked in this would be 3
    expect(res.content[0].text).to.match(/2-frame GIF/);
    const gif = path.join(dir, 'demo.gif');
    expect(fs.existsSync(gif)).to.equal(true);
    // valid GIF89a magic
    expect(fs.readFileSync(gif).slice(0, 6).toString('ascii')).to.equal('GIF89a');
  });

  it('animate_gif errors when neither output/asc nor output/bin exists', async () => {
    const dir = tmpProject();
    writeNestedConfig(dir);
    const res = await animateGifTool.handler({ projectDir: dir }, { cwd: dir });
    expect(res.isError).to.equal(true);
    expect(res.content[0].text).to.match(/output/);
  });

  it('generate_dem errors without the API key env var', async () => {
    const saved = process.env[API_KEY_ENV];
    delete process.env[API_KEY_ENV];
    try {
      const dir = tmpProject();
      writeNestedConfig(dir);
      const res = await generateDemTool.handler({ projectDir: dir }, { cwd: dir });
      expect(res.isError).to.equal(true);
      expect(res.content[0].text).to.contain(API_KEY_ENV);
    } finally {
      if (saved !== undefined) process.env[API_KEY_ENV] = saved;
    }
  });

  it('generate_dem reads settings.utmHeader — errors on a config that lacks it (offline)', async () => {
    // Fully offline: with the key present but settings.utmHeader absent, the handler
    // must return the specific "no utmHeader" error BEFORE reaching the download. This
    // proves getUtmHeader reads the nested settings node without any network call.
    // (projectConfig.test.ts proves getUtmHeader returns the header when present.)
    const saved = process.env[API_KEY_ENV];
    process.env[API_KEY_ENV] = 'test-key-offline';
    try {
      const dir = tmpProject();
      writeNestedConfig(dir, { settings: { utmHeader: undefined } }); // JSON.stringify drops it
      const res = await generateDemTool.handler({ projectDir: dir }, { cwd: dir });
      expect(res.isError).to.equal(true);
      expect(res.content[0].text).to.match(/no utmHeader/);
    } finally {
      if (saved === undefined) delete process.env[API_KEY_ENV];
      else process.env[API_KEY_ENV] = saved;
    }
  });
});
