// test/unit/mcp/diagnoseProject.test.ts
import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { diagnoseProjectTool } from '../../../src/mcp/tools/diagnoseProject';

function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'tf-diag-')); }

describe('diagnose_project handler', () => {
  it('reports an unsubstituted placeholder and a missing DEM, ranked, from a real .cfg', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'triton_execution.cfg'),
      ['num_runoffs=1', 'dem_filename="input/dem.bin"', 'runoff_filename="input/XXXhygXXX"'].join('\n'));
    const res = await diagnoseProjectTool.handler({ projectDir: dir }, { cwd: dir });
    expect(res.isError).to.not.equal(true);
    const text = res.content[0].text;
    expect(text).to.contain('ERROR');
    expect(text).to.contain('placeholder');
    expect(text).to.contain('Missing input file');
  });

  it('errors clearly when no .cfg can be resolved', async () => {
    const dir = tmp();
    const res = await diagnoseProjectTool.handler({ projectDir: dir }, { cwd: dir });
    expect(res.isError).to.equal(true);
    expect(res.content[0].text).to.match(/no \.cfg/i);
  });

  it('gives a clean report for a coherent deck', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'input'));
    fs.writeFileSync(path.join(dir, 'input', 'dem.bin'), Buffer.alloc(400));
    fs.writeFileSync(path.join(dir, 'run.cfg'),
      ['input_format=BIN', 'num_runoffs=0', 'num_sources=0', 'dem_filename="input/dem.bin"',
       'sim_duration=3600', 'time_step=0.01', 'courant=0.5', 'const_mann=0.035'].join('\n'));
    const res = await diagnoseProjectTool.handler({ projectDir: dir }, { cwd: dir });
    expect(res.isError).to.not.equal(true);
    expect(res.content[0].text).to.contain('No structural faults found');
  });
});
