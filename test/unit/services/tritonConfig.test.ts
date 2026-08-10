import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { renderTritonExecutionCfg } from '../../../src/services/tritonConfig';

// The REAL template (unit tests run from the repo root).
const TEMPLATE = fs.readFileSync(
  path.resolve(process.cwd(), 'resources', 'triton_execution.cfg.template'), 'utf8');

describe('tritonConfig: renderTritonExecutionCfg (characterization of the pre-refactor generator)', () => {
  it('renders exactly what ExecutionSetupEditor._writeTritonConfig produced', () => {
    const project = {
      demPath: '/proj/input/dem.asc',
      initialInputPath: '/proj/input/init.out',
      num_sources: 2,
      input_format: 'ASC',
      print_option: 'huv',
      checkpoint_id: 0, // numeric 0 must render, not be dropped
    };
    // Derived by hand from resources/triton_execution.cfg.template + the
    // mapping rules: project value wins; else template default; lines whose
    // resolved value is empty are OMITTED; trailing newline preserved.
    const expected = [
      'checkpoint_id=0',
      'courant=0.5',
      'dem_filename=/proj/input/dem.asc',
      'domain_decomposition=static',
      'factor_interval_domain_decomposition=1',
      'gpu_direct_flag=0',
      'h_infile=/proj/input/init.out',
      'hextra=0.001',
      'input_format=ASC',
      'it_count=0',
      'it_print=3600',
      'num_extbc=0',
      'num_runoffs=0',
      'num_sources=2',
      'open_boundaries=1',
      'outfile_pattern=%s/%s/%s_%02d_%02d',
      'output_format=ASC',
      'output_option=PAR',
      'print_interval=900',
      'print_observation=1',
      'print_option=huv',
      'projection=EPSG:32616',
      'sim_duration=86400',
      'sim_start_time=0',
      'time_increment_fixed=0',
      'time_series_flag=0',
      'time_step=1.0',
      '', // template's trailing newline
    ].join('\n');
    expect(renderTritonExecutionCfg(project, TEMPLATE)).to.equal(expected);
  });

  it('project values override template defaults (input_format BIN→ASC above; here output_format)', () => {
    const out = renderTritonExecutionCfg({ output_format: 'GTIFF' }, TEMPLATE);
    expect(out).to.include('output_format=GTIFF');
    expect(out).to.not.include('output_format=ASC');
  });

  it('empty-valued keys are dropped entirely (const_mann, qx_infile, …)', () => {
    const out = renderTritonExecutionCfg({}, TEMPLATE);
    expect(out).to.not.match(/^const_mann/m);
    expect(out).to.not.match(/^qx_infile/m);
    expect(out).to.not.match(/^dem_filename/m);
  });

  it('comment and blank template lines pass through untouched', () => {
    const out = renderTritonExecutionCfg({ demPath: '/x.asc' }, '# header\n\ndem_filename=\n');
    expect(out).to.equal('# header\n\ndem_filename=/x.asc\n');
  });
});
