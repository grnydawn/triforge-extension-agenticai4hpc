import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VSBrowser } from 'vscode-extension-tester';
import { ProjectCreator } from '../../pageobjects/ProjectCreator.ts';
import { reloadWindow, resetToWorkbench } from '../../pageobjects/workbench.ts';
import {
  restoreExtensionWorkspacePath,
  setExtensionWorkspacePath,
} from '../../helpers/seed.ts';

/**
 * PRJ-7 — the project-setup page reuses a folder that ALREADY EXISTS instead of
 * rejecting it. Pre-change, an existing target folder errored ("...already
 * exists..."); post-change the folder is reused: its input/output/build subdirs
 * are ensured, config.json is written from the form, and the project registered.
 * A pre-existing stray file must survive (reuse, not recreate).
 */
describe('Triforge projects (PRJ-7: reuse an existing project folder)', function () {
  this.timeout(300000);

  let workspacePath: string;
  let previousSettings: string | undefined;

  before(async () => {
    await VSBrowser.instance.waitForWorkbench();
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'triforge-e2e-prj7-'));
    previousSettings = setExtensionWorkspacePath(workspacePath);
    await reloadWindow();
  });

  after(async () => {
    restoreExtensionWorkspacePath(previousSettings);
    try {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it('creates + registers a project in a folder that already exists (reuse)', async () => {
    await resetToWorkbench();
    const projectName = `PRJ7Reuse${Date.now().toString(36)}`;
    const projectPath = path.join(workspacePath, projectName);
    // Pre-create the target folder + a stray file so the handler must REUSE it.
    fs.mkdirSync(projectPath, { recursive: true });
    fs.writeFileSync(path.join(projectPath, 'pre-existing.txt'), 'keep');

    const creator = new ProjectCreator();
    await creator.open();
    await creator.setName(projectName);
    await creator.setPath(projectPath);
    await creator.setGrid({
      ncols: 211,
      nrows: 161,
      cellsize: 30,
      xllcorner: 751164.22,
      yllcorner: 3985440.72,
      nodata: -9999,
      utmZone: '16N',
    });
    await creator.create();

    // Reuse succeeded → config.json written into the pre-existing folder.
    const configFile = path.join(projectPath, 'config.json');
    await VSBrowser.instance.driver.wait(
      async () => fs.existsSync(configFile),
      30000,
      `expected config.json in the reused folder ${configFile}`,
    );
    // The pre-existing file is untouched, subdirs ensured, project registered.
    expect(fs.existsSync(path.join(projectPath, 'pre-existing.txt'))).to.be.true;
    expect(fs.existsSync(path.join(projectPath, 'input'))).to.be.true;
    const registryFile = path.join(workspacePath, '.triforge', 'projects.json');
    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    expect(registry.triforge.projectpaths).to.include(projectPath);
  });

  it('re-creating over an already-registered project keeps its id + no duplicate registry entry', async () => {
    await resetToWorkbench();
    const projectName = `PRJ7Reg${Date.now().toString(36)}`;
    const projectPath = path.join(workspacePath, projectName);
    const configFile = path.join(projectPath, 'config.json');
    const registryFile = path.join(workspacePath, '.triforge', 'projects.json');
    const grid = {
      ncols: 211,
      nrows: 161,
      cellsize: 30,
      xllcorner: 751164.22,
      yllcorner: 3985440.72,
      nodata: -9999,
      utmZone: '16N',
    };

    // First create → registers the project and writes its config.json (id X).
    const first = new ProjectCreator();
    await first.open();
    await first.setName(projectName);
    await first.setPath(projectPath);
    await first.setGrid(grid);
    await first.create();
    await VSBrowser.instance.driver.wait(
      async () => fs.existsSync(configFile),
      30000,
      'first create should write config.json',
    );
    const idBefore = JSON.parse(fs.readFileSync(configFile, 'utf8')).settings.id;
    expect(idBefore, 'first create should assign an id').to.be.a('string').and.not.be.empty;

    // Second create at the SAME (now-registered) path → reuse-in-place, not a new UUID.
    await resetToWorkbench();
    const second = new ProjectCreator();
    await second.open();
    await second.setName(projectName);
    await second.setPath(projectPath);
    await second.setGrid(grid);
    await second.create();

    // The reused project keeps its original id (no UUID churn = no disk/registry divergence)...
    await VSBrowser.instance.driver.wait(
      async () => JSON.parse(fs.readFileSync(configFile, 'utf8')).settings.id === idBefore,
      30000,
      'the reused project must keep its original id (no UUID churn)',
    );
    // ...and its path appears exactly once in projects.json (no duplicate entry).
    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    const count = (registry.triforge.projectpaths as string[]).filter((p) => p === projectPath).length;
    expect(count, 'project path must appear exactly once in projects.json').to.equal(1);
  });
});
