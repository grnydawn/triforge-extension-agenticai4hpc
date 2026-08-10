import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { expect } from 'chai';

import { ProjectManager, TriforgeProject } from '../../../src/state/ProjectManager';
import { GlobalSettingsManager } from '../../../src/state/GlobalSettingsManager';

// ProjectManager persists to <workspacePath>/.triforge/projects.json (shape
// `{ triforge: { projectpaths: [...] } }`) plus a config.json inside each project
// folder. It is a singleton reached via `ProjectManager.instance`, and it reads
// the workspace path from the GlobalSettingsManager singleton. We point that
// singleton at a fresh temp dir per test, and reload via initialize().

describe('ProjectManager (persistence round-trip + BUG-9/BUG-10)', () => {
  let workspaceDir: string;
  let projectDir: string;
  const mgr = ProjectManager.instance;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ws-'));
    projectDir = path.join(workspaceDir, 'proj');
    // Drive ProjectManager's notion of "where to persist" through the real
    // GlobalSettingsManager singleton it depends on.
    GlobalSettingsManager.instance.updateSettings({ workspacePath: workspaceDir });
  });

  afterEach(() => {
    if (workspaceDir) {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('persists a created project and reloads its config.json key fields', async () => {
    const created = mgr.addProject(
      'Round Trip',
      projectDir,
      undefined,        // demPath
      '16N',            // utmZone
      'WGS84',          // datum
      undefined,        // utmHeader
      undefined,        // simulationStart
      'UTC',            // timezone
      'BIN',            // inputFormat
      'GTIFF'           // outputFormat
    );

    // config.json was written to the project folder.
    const configFile = path.join(projectDir, 'config.json');
    expect(fs.existsSync(configFile), 'config.json should exist after addProject').to.equal(true);

    // projects.json registry got the project path under triforge.projectpaths.
    const registryFile = path.join(workspaceDir, '.triforge', 'projects.json');
    expect(fs.existsSync(registryFile), 'projects.json registry should exist').to.equal(true);
    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    expect(registry.triforge.projectpaths).to.include(projectDir);

    // Reload from disk into a clean in-memory list and confirm the key fields round-trip.
    await mgr.initialize();
    const reloaded = mgr.getProjects().find((p) => p.id === created.id);
    expect(reloaded, 'created project should be reloaded from disk').to.not.equal(undefined);

    const r = reloaded as TriforgeProject;
    expect(r.id).to.equal(created.id);
    expect(r.name).to.equal('Round Trip');
    expect(r.path).to.equal(projectDir);
    expect(r.utmZone).to.equal('16N');
    expect(r.datum).to.equal('WGS84');
    expect(r.timezone).to.equal('UTC');
    expect(r.input_format).to.equal('BIN');
    expect(r.output_format).to.equal('GTIFF');
    expect(r.createdAt).to.equal(created.createdAt);
    expect(r.lastModified).to.equal(created.lastModified);
  });

  it('BUG-9 FIXED: getProjects() returns a clone so callers cannot mutate internal state', async () => {
    mgr.addProject('Mutate Me', projectDir, undefined, '16N', 'WGS84');
    await mgr.initialize();

    const firstName = mgr.getProjects()[0].name;

    // FIXED (T3, BUG-9): the accessor hands back frozen deep clones, so mutating
    // the returned object must NOT leak into ProjectManager's internal state.
    const returned = mgr.getProjects();
    // Mutation cannot leak: the clone is frozen, and even a tolerated write
    // never touches the internal array. Use a try so a frozen-write throw
    // (strict mode) doesn't fail the test before we assert the real property.
    try {
      returned[0].name = 'MUTATED BY CALLER';
    } catch {
      // frozen object: write rejected — also proves no leak.
    }

    const internalName = mgr.getProjects()[0].name;
    expect(internalName).to.equal(firstName);
  });

  it('BUG-10 (FIXED): a failed config write must not leave config.json truncated/corrupt (atomic temp+rename)', async () => {
    // Seed a valid, parseable config.json via the normal create path.
    const created = mgr.addProject('Atomic', projectDir, undefined, '16N', 'WGS84');
    const configFile = path.join(projectDir, 'config.json');
    const originalOnDisk = fs.readFileSync(configFile, 'utf8');
    JSON.parse(originalOnDisk); // sanity: starts valid

    // Simulate a write failure mid-update. We sabotage only direct writes to the
    // FINAL config.json path: truncate it then throw (the non-atomic failure mode).
    // An atomic implementation writes to a temp file then renames, so it would
    // never touch the final path directly and the original would survive.
    const realWriteFileSync = fs.writeFileSync;
    (fs as any).writeFileSync = function (file: fs.PathOrFileDescriptor, data: any, options?: any) {
      if (typeof file === 'string' && path.resolve(file) === path.resolve(configFile)) {
        // Mimic a crash after the OS truncated/opened the destination but before
        // the full payload landed: leave the file corrupt, then fail the write.
        realWriteFileSync.call(fs, file, '{ "truncated":');
        throw Object.assign(new Error('simulated mid-write crash'), { code: 'EIO' });
      }
      return (realWriteFileSync as any).call(fs, file, data, options);
    };

    try {
      const update: TriforgeProject = { ...created, name: 'Atomic v2', lastModified: Date.now() };
      // updateProject swallows write errors internally (shows an error message),
      // so this call does not throw regardless of atomicity.
      mgr.updateProject(update);

      // FIXED (T3, BUG-10): writes are atomic (temp file + rename), so the
      // sabotaged write to the FINAL config.json path never fires — the original
      // complete config survives intact and stays fully parseable.
      const after = fs.readFileSync(configFile, 'utf8');
      const parsed = JSON.parse(after); // throws if truncated
      expect(parsed.settings.id).to.equal(created.id);
    } finally {
      (fs as any).writeFileSync = realWriteFileSync;
    }
  });
});
