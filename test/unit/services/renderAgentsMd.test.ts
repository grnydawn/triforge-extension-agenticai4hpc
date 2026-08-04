import { expect } from 'chai';
import {
  TRIFORGE_CONTEXT_MARKER,
  renderAgentsMd,
  renderClaudePointer,
  renderCopilotPointer,
  shouldWrite,
} from '../../../src/services/agentContext/render';
import type { TriforgeProject } from '../../../src/state/ProjectManager';

function fullProject(): TriforgeProject {
  return {
    id: 'p1', name: 'HawRidgePark', path: '/abs/proj',
    demPath: '/abs/proj/input/HawRidgePark.asc',
    utmZone: '16N', datum: 'WGS84', timezone: 'UTC', simulationStart: '2020-01-01T00:00:00Z',
    utmHeader: { ncols: 100, nrows: 200, xllcorner: 0, yllcorner: 0, cellsize: 30, NODATA_value: -9999 },
    src_loc_file: '/abs/proj/input/HawRidgePark.src',
    hydrograph_filename: '/abs/proj/input/HawRidgePark.hyg',
    outputs: { output_directory: '/abs/proj/output', ascii: ['/abs/proj/output/asc/H_01_00.out'], binary: [], geotiff: [] },
    build_dir: '/abs/proj/build', source_dir: '/abs/proj/src',
    executable_target_mode: 'source', triton_target: '/abs/proj/build/triton.exe',
    run_directory: '/abs/proj/build', run_command: 'triton_run.sh', execution_type: 'interactive',
    sim_duration: 3600, time_step: 1, courant: 0.7, input_format: 'ASC', output_format: 'ASC',
    print_option: 'huv', outfile_pattern: '%s/%s/%s_%02d_%02d',
    apiKeys: { openTopography: 'SECRET-KEY-DO-NOT-LEAK' },
    createdAt: 1, lastModified: 2,
  };
}

describe('renderAgentsMd (AI context manifest)', () => {
  it('includes the provenance marker and all section headers', () => {
    const md = renderAgentsMd(fullProject());
    expect(md).to.include(TRIFORGE_CONTEXT_MARKER);
    for (const h of ['What this is', 'Project overview', 'Directory map', 'Setup', 'Output data', 'run', 'modify']) {
      expect(md.toLowerCase(), `missing section mentioning "${h}"`).to.include(h.toLowerCase());
    }
  });

  it('maps the key project directories', () => {
    const md = renderAgentsMd(fullProject());
    for (const p of ['/abs/proj', '/abs/proj/output', '/abs/proj/build', '/abs/proj/input/HawRidgePark.asc']) {
      expect(md, `manifest should reference ${p}`).to.include(p);
    }
  });

  it('NEVER leaks secrets (apiKeys)', () => {
    const md = renderAgentsMd(fullProject());
    expect(md).to.not.include('SECRET-KEY-DO-NOT-LEAK');
    expect(md.toLowerCase()).to.not.include('apikey');
  });

  it('renders "not set" for a sparse project without throwing', () => {
    const sparse: TriforgeProject = { id: 'p2', name: 'Bare', path: '/abs/bare', createdAt: 1, lastModified: 1 };
    const md = renderAgentsMd(sparse);
    expect(md).to.include('/abs/bare');
    expect(md.toLowerCase()).to.include('not set');
  });

  it('pointer files carry the marker and point at AGENTS.md', () => {
    for (const p of [renderClaudePointer(), renderCopilotPointer()]) {
      expect(p).to.include(TRIFORGE_CONTEXT_MARKER);
      expect(p).to.include('AGENTS.md');
    }
  });

  it('shouldWrite: true when absent or marked, false for un-marked user content', () => {
    expect(shouldWrite(undefined)).to.equal(true);
    expect(shouldWrite(`x ${TRIFORGE_CONTEXT_MARKER} y`)).to.equal(true);
    expect(shouldWrite('# My own notes')).to.equal(false);
  });

  it('renders zero numeric fields as "0", not "not set"', () => {
    const p = fullProject();
    p.time_step = 0;
    p.courant = 0;
    const md = renderAgentsMd(p);
    expect(md).to.include('time step 0 s');
    expect(md).to.include('Courant 0');
  });

  it('keeps a backtick in the project name/path from breaking code spans', () => {
    const p = fullProject();
    p.path = '/abs/ev`il';
    const md = renderAgentsMd(p);
    expect(md).to.not.include('ev`il');   // raw backtick neutralized
  });

  it('Claude and Copilot pointers are distinguishable', () => {
    expect(renderClaudePointer()).to.not.equal(renderCopilotPointer());
  });
});
