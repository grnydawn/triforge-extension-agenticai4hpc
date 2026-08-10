import { expect } from 'chai';
import * as path from 'path';
import { resolveInvocationArgs, ProjectContext } from '../../../src/lm/resolveArgs';

const TEMPLATE = '/ext/resources/triton_execution.cfg.template';

function ctx(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    activeProject: { id: 'p1', name: 'P1', path: '/proj/p1', sim_duration: 100, demPath: '/proj/p1/input/dem.asc' },
    projectPath: '/proj/p1',
    templatePath: TEMPLATE,
    ...overrides,
  };
}

describe('resolveInvocationArgs', () => {
  it('configure_solver: defaults project from the active project + bundled template + cwd', () => {
    const r = resolveInvocationArgs('configure_solver', {}, ctx());
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect((r.args.project as any).sim_duration).to.equal(100);
    expect(r.args.templatePath).to.equal(TEMPLATE);
    expect(r.args.outPath).to.equal(undefined);
    expect(r.ctx.cwd).to.equal('/proj/p1');
  });

  it('configure_solver: model project overrides win over the active project', () => {
    const r = resolveInvocationArgs('configure_solver', { project: { sim_duration: 7200 } }, ctx());
    if (!r.ok) throw new Error('expected ok');
    expect((r.args.project as any).sim_duration).to.equal(7200);
    expect((r.args.project as any).demPath).to.equal('/proj/p1/input/dem.asc'); // untouched field kept
  });

  it('configure_solver: passes through an explicit outPath and templatePath', () => {
    const r = resolveInvocationArgs('configure_solver', { outPath: '/proj/p1/out.cfg', templatePath: '/t2' }, ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.args.outPath).to.equal('/proj/p1/out.cfg');
    expect(r.args.templatePath).to.equal('/t2');
  });

  it('run_local: defaults runDir to <projectPath>/build and keeps runCommand', () => {
    const r = resolveInvocationArgs('run_local', { runCommand: './triton' }, ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.args.runCommand).to.equal('./triton');
    expect(r.args.runDir).to.equal(path.join('/proj/p1', 'build'));
    expect(r.args.templatePath).to.equal(TEMPLATE);
  });

  it('run_local: respects an explicit runDir', () => {
    const r = resolveInvocationArgs('run_local', { runCommand: './triton', runDir: '/tmp/run' }, ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.args.runDir).to.equal('/tmp/run');
  });

  it('run_local: missing runCommand is an error', () => {
    const r = resolveInvocationArgs('run_local', {}, ctx());
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.error).to.match(/runCommand/i);
  });

  it('export_tfp: defaults projectDir to the active project folder and requires outPath', () => {
    const r = resolveInvocationArgs('export_tfp', { outPath: 'run.tfp' }, ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.args.projectDir).to.equal('/proj/p1');
    expect(r.args.outPath).to.equal('run.tfp');
    expect(r.args.includeOutputs).to.equal(undefined);
    expect(r.ctx.cwd).to.equal('/proj/p1');
  });

  it('export_tfp: honors an explicit projectDir and includeOutputs', () => {
    const r = resolveInvocationArgs(
      'export_tfp',
      { outPath: 'run.tfp', projectDir: '/other', includeOutputs: true },
      ctx(),
    );
    if (!r.ok) throw new Error('expected ok');
    expect(r.args.projectDir).to.equal('/other');
    expect(r.args.includeOutputs).to.equal(true);
  });

  it('export_tfp: missing outPath is an error', () => {
    const r = resolveInvocationArgs('export_tfp', {}, ctx());
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.error).to.match(/outPath/i);
  });

  it('import_tfp: passes through archivePath + destRoot and resolves cwd from the active project', () => {
    const r = resolveInvocationArgs(
      'import_tfp',
      { archivePath: 'run.tfp', destRoot: 'imported' },
      ctx(),
    );
    if (!r.ok) throw new Error('expected ok');
    expect(r.args.archivePath).to.equal('run.tfp');
    expect(r.args.destRoot).to.equal('imported');
    expect(r.ctx.cwd).to.equal('/proj/p1');
  });

  it('import_tfp: missing archivePath or destRoot is an error', () => {
    const noArchive = resolveInvocationArgs('import_tfp', { destRoot: 'd' }, ctx());
    expect(noArchive.ok).to.equal(false);
    if (!noArchive.ok) expect(noArchive.error).to.match(/archivePath/i);

    const noDest = resolveInvocationArgs('import_tfp', { archivePath: 'a.tfp' }, ctx());
    expect(noDest.ok).to.equal(false);
    if (!noDest.ok) expect(noDest.error).to.match(/destRoot/i);
  });

  it('ignores a non-object project input instead of spreading it', () => {
    const r = resolveInvocationArgs('configure_solver', { project: 'oops' as any }, ctx());
    if (!r.ok) throw new Error('expected ok');
    expect((r.args.project as any).sim_duration).to.equal(100); // active project intact
  });

  it('create_water_source: defaults projectDir to the active project + passes data through', () => {
    const r = resolveInvocationArgs('create_water_source', {
      locations: [{ x: 1, y: 2 }], hydrographs: [[1, 2]],
    }, ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.args.projectDir).to.equal('/proj/p1');
    expect((r.args.locations as unknown[]).length).to.equal(1);
  });

  it('create_water_source: missing locations is an error', () => {
    const r = resolveInvocationArgs('create_water_source', { hydrographs: [[1]] }, ctx());
    expect(r.ok).to.equal(false);
  });

  it('generate_dem: defaults projectDir + source from the active project', () => {
    const r = resolveInvocationArgs('generate_dem', {}, ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.args.projectDir).to.equal('/proj/p1');
  });

  it('animate_gif: defaults projectDir + colormap passthrough', () => {
    const r = resolveInvocationArgs('animate_gif', { colormap: 'Viridis' }, ctx());
    if (!r.ok) throw new Error('expected ok');
    expect(r.args.projectDir).to.equal('/proj/p1');
    expect(r.args.colormap).to.equal('Viridis');
  });

  it('errors clearly when no project is active', () => {
    const r = resolveInvocationArgs('configure_solver', {}, ctx({ activeProject: undefined, projectPath: undefined }));
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.error).to.match(/active .*project/i);
  });
});

const pctx = {
  activeProject: { path: '/proj', sim_duration: 3600 },
  projectPath: '/proj',
  templatePath: '/tmpl/triton_execution.cfg.template',
};

describe('resolveInvocationArgs — diagnose_project', () => {
  it('defaults projectDir to the active project and passes optional cfgPath/expectations', () => {
    const r = resolveInvocationArgs('diagnose_project', { cfgPath: 'run.cfg', expectations: { numRunoffs: 28 } }, pctx);
    expect(r.ok).to.equal(true);
    if (r.ok) {
      expect(r.args.projectDir).to.equal('/proj');
      expect(r.args.cfgPath).to.equal('run.cfg');
      expect((r.args.expectations as any).numRunoffs).to.equal(28);
      expect(r.ctx.cwd).to.equal('/proj');
    }
  });

  it('errors with no active project AND no explicit projectDir', () => {
    const r = resolveInvocationArgs('diagnose_project', {}, { templatePath: '/t' } as any);
    expect(r.ok).to.equal(false);
  });

  it('runs on an explicit projectDir with NO active project (read-only, path-addressable)', () => {
    const r = resolveInvocationArgs(
      'diagnose_project',
      { projectDir: '/some/triton/project', cfgPath: 'run.cfg', expectations: { numRunoffs: 5 } },
      { templatePath: '/t' } as any, // no activeProject / projectPath
    );
    expect(r.ok).to.equal(true);
    if (r.ok) {
      expect(r.args.projectDir).to.equal('/some/triton/project');
      expect(r.args.cfgPath).to.equal('run.cfg');
      expect((r.args.expectations as any).numRunoffs).to.equal(5);
      expect(r.ctx.cwd).to.equal('/some/triton/project');
    }
  });
});
