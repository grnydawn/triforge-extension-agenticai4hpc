import { expect } from 'chai';
import * as path from 'path';
import {
  relativizeForExport,
  absolutizeForImport,
  mergeOutputLists,
  buildManifest,
  validateManifest,
  entryEscapes,
  configReferencedRelPaths,
  exportFileReads,
  SCHEMA_VERSION,
  PROJECT_ROOT_TOKEN,
} from '../../../src/services/projectArchive';

/** A representative on-disk config for a project rooted at `root`. */
function makeConfig(root: string, p: typeof path.posix | typeof path.win32) {
  const j = (...seg: string[]) => p.join(root, ...seg);
  return {
    version: '1.0.0',
    settings: {
      id: 'proj-0001',
      name: 'HawRidge',
      path: root,
      input_format: 'ASC',
      output_format: 'ASC',
      createdAt: 1,
      lastModified: 2,
    },
    input: {
      dem: j('input', 'dem.asc'),
      initialInput: j('input', 'init.out'),
      src_loc_file: j('input', 'src.src'),
      hydrograph_filename: j('input', 'hyg.hyg'),
      num_sources: 1,
      apiKeys: { openTopography: 'SECRET-KEY' }, // legacy plaintext — must never survive
    },
    output: {
      output_directory: j('output'),
      ascii: [j('build', 'output', 'asc', 'H_01_00.out'), p.join(p.sep === '/' ? '/elsewhere' : 'D:\\elsewhere', 'stray.out')],
      geotiff: [],
    },
    compsetup: {
      executable_target_mode: 'source',
      source_dir: p.sep === '/' ? '/opt/triton-src' : 'C:\\triton-src',
      triton_target: j('build', 'triton'),
      build_dir: j('build'),
      sim_duration: 86400,
    },
    execution: {
      execution_type: 'interactive',
      run_directory: j('build'),
      run_command: 'bash run.sh',
    },
  };
}

describe('projectArchive: relativizeForExport', () => {
  const ROOT = '/abs/proj';

  it('relativizes inside-project input paths to POSIX and drops settings.path + apiKeys', () => {
    const { portableConfig } = relativizeForExport(
      makeConfig(ROOT, path.posix), ROOT, { includeOutputs: true }, path.posix);
    expect(portableConfig.input.dem).to.equal('input/dem.asc');
    expect(portableConfig.input.initialInput).to.equal('input/init.out');
    expect(portableConfig.input.src_loc_file).to.equal('input/src.src');
    expect(portableConfig.input.hydrograph_filename).to.equal('input/hyg.hyg');
    expect(portableConfig.settings.path).to.equal(undefined);
    expect(JSON.stringify(portableConfig)).to.not.match(/apiKeys|SECRET-KEY/);
    // non-path fields untouched
    expect(portableConfig.input.num_sources).to.equal(1);
    expect(portableConfig.settings.id).to.equal('proj-0001');
  });

  it('canonicalizes the machine-local dirs to build/build/output', () => {
    const { portableConfig } = relativizeForExport(
      makeConfig(ROOT, path.posix), ROOT, { includeOutputs: true }, path.posix);
    expect(portableConfig.compsetup.build_dir).to.equal('build');
    expect(portableConfig.execution.run_directory).to.equal('build');
    expect(portableConfig.output.output_directory).to.equal('output');
  });

  it('keeps inside-project output entries (POSIX-relative) and reports outside ones', () => {
    const { portableConfig, skippedOutputs } = relativizeForExport(
      makeConfig(ROOT, path.posix), ROOT, { includeOutputs: true }, path.posix);
    expect(portableConfig.output.ascii).to.deep.equal(['build/output/asc/H_01_00.out']);
    expect(skippedOutputs).to.deep.equal(['/elsewhere/stray.out']);
  });

  it('empties the output lists when outputs are not included', () => {
    const { portableConfig, skippedOutputs } = relativizeForExport(
      makeConfig(ROOT, path.posix), ROOT, { includeOutputs: false }, path.posix);
    expect(portableConfig.output.ascii).to.deep.equal([]);
    expect(portableConfig.output.geotiff).to.deep.equal([]);
    expect(skippedOutputs).to.deep.equal([]);
  });

  it('stages inputs living OUTSIDE the project into input/ with basename dedupe', () => {
    const config = makeConfig(ROOT, path.posix);
    config.input.dem = '/external/data/dem.asc';        // outside
    config.input.initialInput = '/other/place/dem.asc'; // outside, SAME basename
    const { portableConfig, externalInputs } = relativizeForExport(
      config, ROOT, { includeOutputs: false }, path.posix);
    expect(externalInputs).to.deep.equal([
      { field: 'input.dem', sourcePath: '/external/data/dem.asc', archivePath: 'input/dem.asc' },
      { field: 'input.initialInput', sourcePath: '/other/place/dem.asc', archivePath: 'input/dem-2.asc' },
    ]);
    expect(portableConfig.input.dem).to.equal('input/dem.asc');
    expect(portableConfig.input.initialInput).to.equal('input/dem-2.asc');
  });

  it('an external basename colliding with an INSIDE input is deduped too', () => {
    const config = makeConfig(ROOT, path.posix); // input.dem is inside at input/dem.asc
    config.input.qx_infile = '/external/dem.asc';
    const { portableConfig, externalInputs } = relativizeForExport(
      config, ROOT, { includeOutputs: false }, path.posix);
    expect(portableConfig.input.dem).to.equal('input/dem.asc');
    expect(externalInputs[0].archivePath).to.equal('input/dem-2.asc');
    expect(portableConfig.input.qx_infile).to.equal('input/dem-2.asc');
  });

  it('handles win32 configs (backslash paths, drive letters)', () => {
    const root = 'C:\\Users\\me\\proj';
    const { portableConfig, externalInputs } = relativizeForExport(
      makeConfig(root, path.win32), root, { includeOutputs: true }, path.win32);
    expect(portableConfig.input.dem).to.equal('input/dem.asc');
    expect(portableConfig.output.ascii).to.deep.equal(['build/output/asc/H_01_00.out']);
    expect(externalInputs).to.deep.equal([]);
  });

  it('missing/empty fields are left alone (no crash, no invention)', () => {
    const { portableConfig, externalInputs } = relativizeForExport(
      { settings: { id: 'x', name: 'y' }, input: {}, output: {}, compsetup: {}, execution: {} },
      ROOT, { includeOutputs: true }, path.posix);
    expect(portableConfig.input.dem).to.equal(undefined);
    expect(externalInputs).to.deep.equal([]);
  });
});

describe('projectArchive: absolutizeForImport', () => {
  const portable = {
    version: '1.0.0',
    settings: { id: 'proj-0001', name: 'HawRidge' },
    input: { dem: 'input/dem.asc', src_loc_file: 'input/src.src', num_sources: 1 },
    output: { output_directory: 'output', ascii: ['build/output/asc/H_01_00.out'], geotiff: [] },
    compsetup: {
      executable_target_mode: 'source',
      source_dir: '/opt/triton-src',
      triton_target: '/opt/triton-src/build/triton',
      build_dir: 'build',
      sim_duration: 86400,
    },
    execution: { execution_type: 'interactive', run_directory: 'build' },
  };

  it('re-absolutizes every inside path under destRoot with the local separator (posix)', () => {
    const local = absolutizeForImport(portable, '/home/me/tp/HawRidge', path.posix);
    expect(local.settings.path).to.equal('/home/me/tp/HawRidge');
    expect(local.input.dem).to.equal('/home/me/tp/HawRidge/input/dem.asc');
    expect(local.output.ascii).to.deep.equal(['/home/me/tp/HawRidge/build/output/asc/H_01_00.out']);
    expect(local.compsetup.build_dir).to.equal('/home/me/tp/HawRidge/build');
    expect(local.execution.run_directory).to.equal('/home/me/tp/HawRidge/build');
    expect(local.output.output_directory).to.equal('/home/me/tp/HawRidge/output');
    expect(local.input.num_sources).to.equal(1); // non-path untouched
  });

  it('re-absolutizes with win32 joins on Windows', () => {
    const local = absolutizeForImport(portable, 'C:\\tp\\HawRidge', path.win32);
    expect(local.input.dem).to.equal('C:\\tp\\HawRidge\\input\\dem.asc');
    expect(local.compsetup.build_dir).to.equal('C:\\tp\\HawRidge\\build');
  });

  it('resets the compute target for source/executable modes but keeps mode + docker image', () => {
    const src = absolutizeForImport(portable, '/dest', path.posix);
    expect(src.compsetup.source_dir).to.equal('');
    expect(src.compsetup.triton_target).to.equal('');
    expect(src.compsetup.executable_target_mode).to.equal('source');

    const dockerPortable = JSON.parse(JSON.stringify(portable));
    dockerPortable.compsetup.executable_target_mode = 'docker';
    dockerPortable.compsetup.is_docker_target = true;
    dockerPortable.compsetup.triton_target = 'ghcr.io/triton/triton:latest';
    const docker = absolutizeForImport(dockerPortable, '/dest', path.posix);
    expect(docker.compsetup.triton_target).to.equal('ghcr.io/triton/triton:latest');
    expect(docker.compsetup.is_docker_target).to.equal(true);
    expect(docker.compsetup.source_dir).to.equal('');
  });

  it('forces the canonical dirs even when the archive omitted them, and never carries apiKeys', () => {
    const local = absolutizeForImport(
      { settings: { id: 'x', name: 'y' }, input: { apiKeys: { openTopography: 'S' } }, output: {}, compsetup: {}, execution: {} },
      '/dest', path.posix);
    expect(local.compsetup.build_dir).to.equal('/dest/build');
    expect(local.execution.run_directory).to.equal('/dest/build');
    expect(local.output.output_directory).to.equal('/dest/output');
    expect(JSON.stringify(local)).to.not.match(/apiKeys/);
  });

  it('round-trip: relativize then absolutize lands every inside path under the new root', () => {
    const original = makeConfig('/abs/proj', path.posix);
    const { portableConfig } = relativizeForExport(original, '/abs/proj', { includeOutputs: true }, path.posix);
    const relanded = absolutizeForImport(portableConfig, '/new/home', path.posix);
    expect(relanded.input.dem).to.equal('/new/home/input/dem.asc');
    expect(relanded.input.hydrograph_filename).to.equal('/new/home/input/hyg.hyg');
    expect(relanded.output.ascii).to.deep.equal(['/new/home/build/output/asc/H_01_00.out']);
    expect(relanded.settings.id).to.equal(original.settings.id);
  });

  // SECURITY: portable values are archive-controlled. Without containment, a
  // crafted archive yields a local config pointing OUTSIDE the project (e.g.
  // at ~/.ssh/id_rsa) and a later re-export would stage that secret into the
  // new archive as an "external input" — exfiltration via the round-trip.
  it('SECURITY: clears input scalars that traverse or point outside destRoot (posix)', () => {
    const hostile = JSON.parse(JSON.stringify(portable));
    hostile.input.dem = '../../.ssh/id_rsa';                   // plain traversal
    hostile.input.src_loc_file = 'input/../../../etc/passwd';  // embedded traversal
    hostile.input.initialInput = '/etc/shadow';                // absolute
    hostile.input.qx_infile = 'input/ok.qx';                   // sane value survives
    const local = absolutizeForImport(hostile, '/home/me/tp/HawRidge', path.posix);
    expect(local.input.dem).to.equal('');
    expect(local.input.src_loc_file).to.equal('');
    expect(local.input.initialInput).to.equal('');
    expect(local.input.qx_infile).to.equal('/home/me/tp/HawRidge/input/ok.qx');
  });

  it('SECURITY: filters output entries that escape destRoot, keeps inside ones (posix)', () => {
    const hostile = JSON.parse(JSON.stringify(portable));
    hostile.output.ascii = ['build/output/asc/ok.out', '../../victim/secret.out', '/var/log/auth.log'];
    const local = absolutizeForImport(hostile, '/home/me/tp/HawRidge', path.posix);
    expect(local.output.ascii).to.deep.equal(['/home/me/tp/HawRidge/build/output/asc/ok.out']);
  });

  it('SECURITY: traversal/absolute portable values cannot escape on win32 either', () => {
    const hostile = JSON.parse(JSON.stringify(portable));
    hostile.input.dem = '../../secret.txt';                    // → would be C:\secret.txt
    hostile.input.initialInput = 'C:/direct.txt';              // drive-absolute
    hostile.output.ascii = ['..\\..\\evil.out', 'build/ok.out']; // backslash traversal
    const local = absolutizeForImport(hostile, 'C:\\tp\\HawRidge', path.win32);
    expect(local.input.dem).to.equal('');
    expect(local.input.initialInput).to.equal('');
    expect(local.output.ascii).to.deep.equal(['C:\\tp\\HawRidge\\build\\ok.out']);
  });
});

describe('projectArchive: mergeOutputLists', () => {
  it('unions the output lists (existing first, incoming appended, exact dedupe)', () => {
    const existing = { output: { ascii: ['/p/a.out', '/p/b.out'], geotiff: ['/p/g.vrt'] } };
    const incoming = { output: { ascii: ['/p/b.out', '/p/c.out'], geotiff: [] }, input: { dem: '/p/d.asc' } };
    const merged = mergeOutputLists(existing, incoming);
    expect(merged.output.ascii).to.deep.equal(['/p/a.out', '/p/b.out', '/p/c.out']);
    expect(merged.output.geotiff).to.deep.equal(['/p/g.vrt']);
    expect(merged.input.dem).to.equal('/p/d.asc'); // everything else = incoming
  });

  it('an inputs-only (empty-list) archive never wipes local outputs', () => {
    const existing = { output: { ascii: ['/p/a.out'] } };
    const incoming = { output: { ascii: [] } };
    expect(mergeOutputLists(existing, incoming).output.ascii).to.deep.equal(['/p/a.out']);
  });
});

describe('projectArchive: manifest', () => {
  it('buildManifest stamps schema/name/id/outputs-flag/OS', () => {
    const m = buildManifest(
      { name: 'HawRidge', id: 'proj-0001' },
      { includesOutputs: true, sourceOS: 'linux', exportedAt: '2026-07-10T00:00:00.000Z' });
    expect(m).to.deep.equal({
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-07-10T00:00:00.000Z',
      projectName: 'HawRidge',
      projectId: 'proj-0001',
      includesOutputs: true,
      sourceOS: 'linux',
    });
  });

  it('validateManifest accepts same-major schemas and rejects newer majors', () => {
    const ok = buildManifest({ name: 'a', id: 'b' }, { includesOutputs: false });
    expect(() => validateManifest(ok)).to.not.throw();
    expect(() => validateManifest({ ...ok, schemaVersion: '1.9.0' })).to.not.throw();
    expect(() => validateManifest({ ...ok, schemaVersion: '2.0.0' })).to.throw(/newer/i);
  });

  it('validateManifest rejects garbage', () => {
    expect(() => validateManifest(undefined)).to.throw();
    expect(() => validateManifest({})).to.throw();
    expect(() => validateManifest({ schemaVersion: '1.0.0', projectName: '', projectId: 'x' })).to.throw();
  });
});

describe('projectArchive: entryEscapes (zip-slip guard)', () => {
  const DEST = '/home/me/tp/proj';
  const escapes = (entry: string) => entryEscapes(entry, DEST, path.posix);

  it('rejects traversal, absolute and drive-letter entries', () => {
    expect(escapes('../evil.txt')).to.equal(true);
    expect(escapes('a/../../evil.txt')).to.equal(true);
    expect(escapes('a\\..\\..\\evil.txt')).to.equal(true); // backslash traversal
    expect(escapes('/abs/evil.txt')).to.equal(true);
    expect(escapes('C:\\evil.txt')).to.equal(true);
    expect(escapes('c:/evil.txt')).to.equal(true);
    expect(escapes('')).to.equal(true);
    expect(escapes('a/\0b')).to.equal(true);
    expect(escapes('.')).to.equal(true); // resolves TO the root itself
  });

  it('accepts normal relative entries (including a benign internal ..)', () => {
    expect(escapes('input/dem.asc')).to.equal(false);
    expect(escapes('build/output/asc/H_01_00.out')).to.equal(false);
    expect(escapes('a/../b.txt')).to.equal(false); // never leaves the root
    expect(escapes('output/')).to.equal(false);    // directory entry
  });
});

describe('projectArchive: configReferencedRelPaths', () => {
  it('lists every referenced input + output file once', () => {
    const { portableConfig } = relativizeForExport(
      makeConfig('/abs/proj', path.posix), '/abs/proj', { includeOutputs: true }, path.posix);
    const refs = configReferencedRelPaths(portableConfig);
    expect(refs).to.include('input/dem.asc');
    expect(refs).to.include('build/output/asc/H_01_00.out');
    expect(refs.length).to.equal(new Set(refs).size); // deduped
  });
});

describe('projectArchive: exportFileReads (zip read plan)', () => {
  const ROOT = '/abs/proj';

  it('reads in-project referenced inputs AND outputs from under the project root', () => {
    const { portableConfig, externalInputs } = relativizeForExport(
      makeConfig(ROOT, path.posix), ROOT, { includeOutputs: true }, path.posix);
    const reads = exportFileReads(portableConfig, externalInputs, ROOT, path.posix);
    expect(reads).to.deep.include({ archivePath: 'input/dem.asc', sourcePath: '/abs/proj/input/dem.asc' });
    expect(reads).to.deep.include({
      archivePath: 'build/output/asc/H_01_00.out',
      sourcePath: '/abs/proj/build/output/asc/H_01_00.out',
    });
  });

  // Regression (review): the adapter used to stage config-referenced paths
  // BEFORE external inputs, but relativizeForExport had already rewritten the
  // external fields to archive paths — so 'input/dem.asc' was first read from
  // INSIDE the project. Every external-input export produced a spurious
  // "skipped file"; worse, a stale same-named local file was silently shipped
  // in place of the real external one (the dedupe then dropped it).
  it('an external input is read from its TRUE source path, never from inside the project', () => {
    const config = makeConfig(ROOT, path.posix);
    config.input.dem = '/external/data/dem.asc'; // re-pointed outside the project
    const { portableConfig, externalInputs } = relativizeForExport(
      config, ROOT, { includeOutputs: false }, path.posix);
    expect(externalInputs).to.deep.include(
      { field: 'input.dem', sourcePath: '/external/data/dem.asc', archivePath: 'input/dem.asc' });

    const reads = exportFileReads(portableConfig, externalInputs, ROOT, path.posix);
    // Exactly ONE read claims input/dem.asc — the external source, listed first.
    const demReads = reads.filter((r) => r.archivePath === 'input/dem.asc');
    expect(demReads).to.deep.equal([{ archivePath: 'input/dem.asc', sourcePath: '/external/data/dem.asc' }]);
    expect(reads[0]).to.deep.equal(demReads[0]);
    // No read may resolve the external archive path under the project root
    // (a stale <project>/input/dem.asc must never win, nor be skip-reported).
    expect(reads.map((r) => r.sourcePath)).to.not.include('/abs/proj/input/dem.asc');
  });

  it('externals always precede config-referenced reads (in-project files keep shipping)', () => {
    const config = makeConfig(ROOT, path.posix); // input.dem stays inside
    config.input.qx_infile = '/elsewhere/flow.qx';
    const { portableConfig, externalInputs } = relativizeForExport(
      config, ROOT, { includeOutputs: true }, path.posix);
    const reads = exportFileReads(portableConfig, externalInputs, ROOT, path.posix);
    const firstConfigRead = reads.findIndex((r) => r.sourcePath.startsWith('/abs/proj/'));
    const lastExternalRead = reads.map((r) => r.sourcePath).lastIndexOf('/elsewhere/flow.qx');
    expect(lastExternalRead).to.be.at.least(0);
    expect(firstConfigRead).to.be.greaterThan(lastExternalRead);
    // In-project inputs are still read from the project as before.
    expect(reads).to.deep.include({ archivePath: 'input/dem.asc', sourcePath: '/abs/proj/input/dem.asc' });
  });

  it('builds native win32 source paths from POSIX archive paths', () => {
    const root = 'C:\\Users\\me\\proj';
    const config = makeConfig(root, path.win32);
    config.input.dem = 'D:\\data\\dem.asc'; // external on another drive
    const { portableConfig, externalInputs } = relativizeForExport(
      config, root, { includeOutputs: true }, path.win32);
    const reads = exportFileReads(portableConfig, externalInputs, root, path.win32);
    expect(reads[0]).to.deep.equal({ archivePath: 'input/dem.asc', sourcePath: 'D:\\data\\dem.asc' });
    expect(reads).to.deep.include({
      archivePath: 'build/output/asc/H_01_00.out',
      sourcePath: 'C:\\Users\\me\\proj\\build\\output\\asc\\H_01_00.out',
    });
    expect(reads.map((r) => r.sourcePath)).to.not.include('C:\\Users\\me\\proj\\input\\dem.asc');
  });
});

describe('projectArchive: free-form command/env portability (run_command, batch, env)', () => {
  it('tokenizes the exporter project-root prefix in run_command (source-mode cfg path — the reported bug)', () => {
    const config = makeConfig('/home/u/tp/HawRidge', path.posix);
    config.execution.run_command =
      'triton_run.sh /home/u/tp/HawRidge/build/triton_execution.cfg "mpirun -n 2"';
    const { portableConfig } = relativizeForExport(
      config, '/home/u/tp/HawRidge', { includeOutputs: false }, path.posix);
    expect(portableConfig.execution.run_command).to.equal(
      `triton_run.sh ${PROJECT_ROOT_TOKEN}/build/triton_execution.cfg "mpirun -n 2"`);
    // The exporter's absolute path is gone from the archive.
    expect(portableConfig.execution.run_command).to.not.include('/home/u/tp/HawRidge');
  });

  it('tokenizes across step_launch_command, batch_header and env_variables', () => {
    const root = '/home/u/tp/HawRidge';
    const config = makeConfig(root, path.posix);
    config.execution.step_launch_command = `srun ${root}/build/triton_execution.cfg`;
    (config.execution as any).batch_header = `#!/bin/bash\n#SBATCH --output=${root}/build/run.log`;
    (config.execution as any).env_variables = `TRITON_DATA=${root}/data\nFOO=bar`;
    const { portableConfig } = relativizeForExport(
      config, root, { includeOutputs: false }, path.posix);
    expect(portableConfig.execution.step_launch_command).to.equal(
      `srun ${PROJECT_ROOT_TOKEN}/build/triton_execution.cfg`);
    expect(portableConfig.execution.batch_header).to.equal(
      `#!/bin/bash\n#SBATCH --output=${PROJECT_ROOT_TOKEN}/build/run.log`);
    expect(portableConfig.execution.env_variables).to.equal(
      `TRITON_DATA=${PROJECT_ROOT_TOKEN}/data\nFOO=bar`);
  });

  it('leaves paths OUTSIDE the project root untouched (e.g. a machine-local scratch dir)', () => {
    const config = makeConfig('/home/u/tp/HawRidge', path.posix);
    config.execution.run_command =
      'triton_run.sh /home/u/tp/HawRidge/build/triton_execution.cfg --scratch /scratch/global/tmp';
    const { portableConfig } = relativizeForExport(
      config, '/home/u/tp/HawRidge', { includeOutputs: false }, path.posix);
    expect(portableConfig.execution.run_command).to.equal(
      `triton_run.sh ${PROJECT_ROOT_TOKEN}/build/triton_execution.cfg --scratch /scratch/global/tmp`);
  });

  it('a Windows exporter tokenizes backslash paths and forward-slashes the archived suffix', () => {
    const root = 'C:\\Users\\me\\HawRidge';
    const config = makeConfig(root, path.win32);
    config.execution.run_command =
      'mpirun -n 2 triton.exe C:\\Users\\me\\HawRidge\\build\\triton_execution.cfg';
    const { portableConfig } = relativizeForExport(
      config, root, { includeOutputs: false }, path.win32);
    expect(portableConfig.execution.run_command).to.equal(
      `mpirun -n 2 triton.exe ${PROJECT_ROOT_TOKEN}/build/triton_execution.cfg`);
  });

  it('a command with no project-root reference is left verbatim', () => {
    const config = makeConfig('/home/u/tp/HawRidge', path.posix);
    config.execution.run_command = 'echo hello world';
    const { portableConfig } = relativizeForExport(
      config, '/home/u/tp/HawRidge', { includeOutputs: false }, path.posix);
    expect(portableConfig.execution.run_command).to.equal('echo hello world');
  });

  it('import re-localizes the token to destRoot (posix)', () => {
    const portable = {
      settings: { id: 'x', name: 'y' }, input: {}, output: {}, compsetup: {},
      execution: {
        run_command: `triton_run.sh ${PROJECT_ROOT_TOKEN}/build/triton_execution.cfg "mpirun -n 2"`,
      },
    };
    const local = absolutizeForImport(portable, '/Users/dev/HawRidge', path.posix);
    expect(local.execution.run_command).to.equal(
      'triton_run.sh /Users/dev/HawRidge/build/triton_execution.cfg "mpirun -n 2"');
    expect(local.execution.run_command).to.not.include(PROJECT_ROOT_TOKEN);
  });

  it('import forward-slashes the destRoot too (win32 dest stays `/`-separated and OS-neutral)', () => {
    const portable = {
      settings: { id: 'x', name: 'y' }, input: {}, output: {}, compsetup: {},
      execution: { run_command: `triton_run.sh ${PROJECT_ROOT_TOKEN}/build/triton_execution.cfg` },
    };
    const local = absolutizeForImport(portable, 'C:\\tp\\HawRidge', path.win32);
    expect(local.execution.run_command).to.equal(
      'triton_run.sh C:/tp/HawRidge/build/triton_execution.cfg');
  });

  it('ROUND-TRIP: a source-mode cfg path lands at the destination cfg path (the reported Linux→Mac bug)', () => {
    const config = makeConfig('/home/user/triforge-projects/HawRidgePark', path.posix);
    config.execution.run_command =
      'triton_run.sh /home/user/triforge-projects/HawRidgePark/build/triton_execution.cfg  "mpirun -n 2"';
    const { portableConfig } = relativizeForExport(
      config, '/home/user/triforge-projects/HawRidgePark', { includeOutputs: false }, path.posix);
    const local = absolutizeForImport(portableConfig, '/Users/dev/HawRidgePark', path.posix);
    expect(local.execution.run_command).to.equal(
      'triton_run.sh /Users/dev/HawRidgePark/build/triton_execution.cfg  "mpirun -n 2"');
    expect(local.execution.run_command).to.not.include('/home/user');
  });

  it('EXECUTABLE mode: an out-of-project binary path in the run command is blanked on import (compute target reset)', () => {
    const config = makeConfig('/home/u/tp/HawRidge', path.posix);
    config.compsetup.executable_target_mode = 'executable';
    config.compsetup.triton_target = '/opt/triton/build/triton';        // outside the project
    config.compsetup.source_dir = '';
    config.execution.run_command =
      'mpirun -n 4 /opt/triton/build/triton /home/u/tp/HawRidge/build/triton_execution.cfg';
    const { portableConfig } = relativizeForExport(
      config, '/home/u/tp/HawRidge', { includeOutputs: false }, path.posix);
    // The exporter's binary path survives tokenization (it is outside the project)…
    expect(portableConfig.execution.run_command).to.include('/opt/triton/build/triton');
    const local = absolutizeForImport(portableConfig, '/Users/dev/HawRidge', path.posix);
    // …so on import (target reset) the invocation command is blanked to regenerate locally.
    expect(local.execution.run_command).to.equal('');
    expect(local.compsetup.triton_target).to.equal('');
  });

  it('DOCKER mode: the run command is NOT blanked and the image is preserved; cfg path is localized', () => {
    const config = makeConfig('/home/u/tp/HawRidge', path.posix);
    config.compsetup.executable_target_mode = 'docker';
    (config.compsetup as any).is_docker_target = true;
    config.compsetup.triton_target = 'ghcr.io/triton/triton:latest';
    config.execution.run_command =
      'docker run triton /home/u/tp/HawRidge/build/triton_execution.cfg';
    const { portableConfig } = relativizeForExport(
      config, '/home/u/tp/HawRidge', { includeOutputs: false }, path.posix);
    const local = absolutizeForImport(portableConfig, '/Users/dev/HawRidge', path.posix);
    expect(local.compsetup.triton_target).to.equal('ghcr.io/triton/triton:latest');
    expect(local.execution.run_command).to.equal(
      'docker run triton /Users/dev/HawRidge/build/triton_execution.cfg');
  });

  it('SOURCE mode with no binary path is NOT blanked — only the cfg is re-localized', () => {
    const config = makeConfig('/home/u/tp/HawRidge', path.posix);
    config.execution.run_command =
      'triton_run.sh /home/u/tp/HawRidge/build/triton_execution.cfg';
    const { portableConfig } = relativizeForExport(
      config, '/home/u/tp/HawRidge', { includeOutputs: false }, path.posix);
    const local = absolutizeForImport(portableConfig, '/Users/dev/HawRidge', path.posix);
    expect(local.execution.run_command).to.equal(
      'triton_run.sh /Users/dev/HawRidge/build/triton_execution.cfg');
  });
});

describe('projectArchive: command portability hardening (boundaries + over-blank guard)', () => {
  it('does NOT tokenize a sibling project that merely shares the root as a prefix', () => {
    const config = makeConfig('/home/u/tp/Haw', path.posix);
    // An unrelated sibling path (root is `/home/u/tp/Haw`, this is `/home/u/tp/HawRidge`).
    config.execution.run_command =
      'triton_run.sh /home/u/tp/HawRidge/build/triton_execution.cfg';
    const { portableConfig } = relativizeForExport(
      config, '/home/u/tp/Haw', { includeOutputs: false }, path.posix);
    // The sibling is left verbatim (no mid-segment tokenization).
    expect(portableConfig.execution.run_command).to.equal(
      'triton_run.sh /home/u/tp/HawRidge/build/triton_execution.cfg');
  });

  it('a project root stored WITH a trailing separator still round-trips without eating the separator', () => {
    const config = makeConfig('/home/u/tp/HawRidge', path.posix);
    config.execution.run_command =
      'triton_run.sh /home/u/tp/HawRidge/build/triton_execution.cfg';
    // Simulate a root recorded with a trailing slash.
    const { portableConfig } = relativizeForExport(
      config, '/home/u/tp/HawRidge/', { includeOutputs: false }, path.posix);
    expect(portableConfig.execution.run_command).to.equal(
      `triton_run.sh ${PROJECT_ROOT_TOKEN}/build/triton_execution.cfg`);
    const local = absolutizeForImport(portableConfig, '/Users/dev/HawRidge', path.posix);
    expect(local.execution.run_command).to.equal(
      'triton_run.sh /Users/dev/HawRidge/build/triton_execution.cfg');
  });

  it('tokenizes the root when it is the WHOLE value or followed by a quote (boundary variants)', () => {
    const config = makeConfig('/home/u/tp/HawRidge', path.posix);
    (config.execution as any).env_variables = 'ROOT=/home/u/tp/HawRidge';
    config.execution.run_command = 'cd "/home/u/tp/HawRidge" && triton_run.sh';
    const { portableConfig } = relativizeForExport(
      config, '/home/u/tp/HawRidge', { includeOutputs: false }, path.posix);
    expect(portableConfig.execution.env_variables).to.equal(`ROOT=${PROJECT_ROOT_TOKEN}`);
    expect(portableConfig.execution.run_command).to.equal(
      `cd "${PROJECT_ROOT_TOKEN}" && triton_run.sh`);
  });

  it('does NOT blank an executable-mode command whose target is a BARE binary name (PATH-resolved)', () => {
    const config = makeConfig('/home/u/tp/HawRidge', path.posix);
    config.compsetup.executable_target_mode = 'executable';
    config.compsetup.triton_target = 'triton'; // bare name on PATH, not an absolute path
    config.compsetup.source_dir = '';
    config.execution.run_command =
      'mpirun -n 4 triton /home/u/tp/HawRidge/build/triton_execution.cfg';
    const { portableConfig } = relativizeForExport(
      config, '/home/u/tp/HawRidge', { includeOutputs: false }, path.posix);
    const local = absolutizeForImport(portableConfig, '/Users/dev/HawRidge', path.posix);
    // The bare name never collides with `triton_execution.cfg`; the command is
    // kept and its cfg path re-localized.
    expect(local.execution.run_command).to.equal(
      'mpirun -n 4 triton /Users/dev/HawRidge/build/triton_execution.cfg');
  });
});
