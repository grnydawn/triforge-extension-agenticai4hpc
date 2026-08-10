import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { configureSolverTool } from '../../../src/mcp/tools/configureSolver';
import { renderTritonExecutionCfg } from '../../../src/services/tritonConfig';

const TEMPLATE = path.join(process.cwd(), 'resources', 'triton_execution.cfg.template');

describe('configure_solver tool', () => {
  it('returns the same cfg text as renderTritonExecutionCfg', async () => {
    const project = { sim_duration: 7200, demPath: 'input/dem.tif' };
    const res = await configureSolverTool.handler({ project, templatePath: TEMPLATE });
    const expected = renderTritonExecutionCfg(project, fs.readFileSync(TEMPLATE, 'utf8'));
    expect(res.isError).to.not.equal(true);
    expect(res.content[0].text).to.equal(expected);
    expect(res.content[0].text).to.contain('7200');
  });

  it('writes the cfg to outPath when given', async () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-cfg-')), 'triton_execution.cfg');
    const project = { sim_duration: 3600 };
    const res = await configureSolverTool.handler({ project, templatePath: TEMPLATE, outPath: out });
    expect(fs.readFileSync(out, 'utf8')).to.equal(res.content[0].text);
  });

  it('errors cleanly when the template path does not exist', async () => {
    const res = await configureSolverTool.handler({ project: {}, templatePath: '/no/such/template' });
    expect(res.isError).to.equal(true);
    expect(res.content[0].text).to.match(/template/i);
  });
});
