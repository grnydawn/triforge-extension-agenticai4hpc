import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectManager } from '../../../src/state/ProjectManager';
import { GlobalSettingsManager } from '../../../src/state/GlobalSettingsManager';

/** Minimal VALID nested config (strict loader requires settings.id/name +
 *  input/compsetup/execution nodes). */
function writeProjectDir(root: string, dirName: string, id: string, name: string): string {
  const projectPath = path.join(root, dirName);
  fs.mkdirSync(projectPath, { recursive: true });
  const config = {
    version: '1.0.0',
    settings: { id, name, path: projectPath, createdAt: 1, lastModified: 2 },
    input: { dem: path.join(projectPath, 'input', 'dem.asc') },
    output: { output_directory: path.join(projectPath, 'output') },
    compsetup: { executable_target_mode: 'source', source_dir: '', triton_target: '' },
    execution: { execution_type: 'interactive' },
  };
  fs.writeFileSync(path.join(projectPath, 'config.json'), JSON.stringify(config, null, 2));
  return projectPath;
}

describe('ProjectManager.registerImportedProject', () => {
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'triforge-pm-import-'));
    GlobalSettingsManager.instance.updateSettings({ workspacePath });
    // The singleton persists across tests — start each from a clean slate.
    (ProjectManager.instance as any)._projects = [];
    (ProjectManager.instance as any)._activeProject = undefined;
  });

  afterEach(() => {
    GlobalSettingsManager.instance.updateSettings({ workspacePath: '' });
    fs.rmSync(workspacePath, { recursive: true, force: true });
  });

  it('registers a fresh on-disk project and persists projects.json', () => {
    const projectPath = writeProjectDir(workspacePath, 'Imported', 'id-import-1', 'Imported');
    const loaded = ProjectManager.instance.registerImportedProject(projectPath);
    expect(loaded?.id).to.equal('id-import-1');
    expect(loaded?.name).to.equal('Imported');
    expect(ProjectManager.instance.getProjects().map(p => p.id)).to.deep.equal(['id-import-1']);
    const registry = JSON.parse(fs.readFileSync(
      path.join(workspacePath, '.triforge', 'projects.json'), 'utf8'));
    expect(registry.triforge.projectpaths).to.deep.equal([projectPath]);
  });

  it('same-id re-registration replaces the entry in place (no duplicate)', () => {
    const projectPath = writeProjectDir(workspacePath, 'Imported', 'id-import-1', 'Imported');
    ProjectManager.instance.registerImportedProject(projectPath);
    // Same id, updated name on disk (the merge path overwrites config.json).
    writeProjectDir(workspacePath, 'Imported', 'id-import-1', 'Imported-v2');
    const reloaded = ProjectManager.instance.registerImportedProject(projectPath);
    expect(reloaded?.name).to.equal('Imported-v2');
    const projects = ProjectManager.instance.getProjects();
    expect(projects.length).to.equal(1);
    expect(projects[0].name).to.equal('Imported-v2');
  });

  it('returns undefined (and registers nothing) for an invalid config', () => {
    const projectPath = path.join(workspacePath, 'Broken');
    fs.mkdirSync(projectPath, { recursive: true });
    fs.writeFileSync(path.join(projectPath, 'config.json'),
      JSON.stringify({ settings: { id: 'x', name: 'Broken' } })); // missing input/compsetup/execution
    expect(ProjectManager.instance.registerImportedProject(projectPath)).to.equal(undefined);
    expect(ProjectManager.instance.getProjects().length).to.equal(0);
  });

  // SEC-2 regression pin: before the _loadProjectFromPath extraction, the
  // project was pushed into _projects BEFORE _migratePlaintextApiKey ran, so
  // setOpenTopographyApiKey's synchronous in-memory mirror found it. The
  // extraction runs migration before the caller registers the project, so the
  // mirror must land on the loaded object itself — otherwise, with
  // SecretStorage unavailable, the key is scrubbed from disk AND lost from
  // memory (data loss).
  it('legacy plaintext apiKey: scrubbed from config.json but kept on the in-memory project', () => {
    const projectPath = writeProjectDir(workspacePath, 'Legacy', 'id-legacy-1', 'Legacy');
    const configFile = path.join(projectPath, 'config.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    config.input.apiKeys = { openTopography: 'LEGACY-PLAINTEXT-KEY' };
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));

    const loaded = ProjectManager.instance.registerImportedProject(projectPath);

    // Mirrored in memory (matches pre-extraction startup-load behavior)...
    expect(loaded?.apiKeys?.openTopography).to.equal('LEGACY-PLAINTEXT-KEY');
    expect(ProjectManager.instance.getProjects()[0]?.apiKeys?.openTopography)
      .to.equal('LEGACY-PLAINTEXT-KEY');
    // ...and scrubbed from the shared on-disk config (never persisted back).
    const scrubbed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    expect(scrubbed.input.apiKeys, 'plaintext key must be scrubbed from config.json')
      .to.equal(undefined);
  });
});
