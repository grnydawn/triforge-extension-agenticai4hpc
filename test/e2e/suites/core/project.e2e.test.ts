import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { By, until, VSBrowser } from 'vscode-extension-tester';
import { ProjectsView } from '../../pageobjects/ProjectsView.ts';
import { ProjectCreator } from '../../pageobjects/ProjectCreator.ts';
import { PropertiesPanel } from '../../pageobjects/PropertiesPanel.ts';
import {
  closeAllEditors,
  reloadWindow,
  resetToWorkbench,
} from '../../pageobjects/workbench.ts';
import {
  restoreExtensionWorkspacePath,
  setExtensionWorkspacePath,
  withTempMultiWorkspace,
} from '../../helpers/seed.ts';

/**
 * Project-lifecycle E2E suite (PRJ-1/2/3/4/5/6/9).
 *
 * These scenarios drive the REAL project registry, tree view, ProjectCreator
 * webview and Properties webview-view. Because the extension only loads the
 * project registry at `activate()` (`ProjectManager._loadProjects()`), every
 * scenario that seeds projects on disk reloads the window before asserting.
 *
 * Page objects: ProjectsView (tree + active marker + context menu), ProjectCreator
 * (create webview), PropertiesPanel (Properties webview-view DOM), Settings (to
 * point the persisted workspace path at a temp dir for the create flow).
 */

/** The modal `.monaco-dialog-box` text, or throw if it never appears. */
async function readModalDialogText(timeoutMs = 20000): Promise<string> {
  const driver = VSBrowser.instance.driver;
  const dialog = await driver.wait(
    until.elementLocated(By.className('monaco-dialog-box')),
    timeoutMs,
    'modal dialog (.monaco-dialog-box) did not appear',
  );
  await driver.wait(until.elementIsVisible(dialog), timeoutMs);
  return dialog.getText();
}

/**
 * Dismiss any modal `.monaco-dialog-box` currently shown (best-effort). The
 * extension pops a modal error dialog when a project config fails to load
 * (`_loadProjects` -> `showErrorMessage({ modal: true })`), which would otherwise
 * block tree interaction. Clicks the first dialog button (OK/primary) and waits
 * for the dialog to close; a no-op if no dialog is present.
 */
async function dismissModalIfPresent(timeoutMs = 8000): Promise<void> {
  const driver = VSBrowser.instance.driver;
  let dialogs;
  try {
    dialogs = await driver.wait(
      until.elementLocated(By.className('monaco-dialog-box')),
      timeoutMs,
    );
  } catch {
    return; // none appeared
  }
  if (!dialogs) return;
  const buttons = await driver.findElements(By.className('monaco-text-button'));
  if (buttons.length === 0) return;
  // The primary button is the last one in the dialog button bar (OK).
  await buttons[buttons.length - 1].click();
  await driver
    .wait(
      async () =>
        (await driver.findElements(By.className('monaco-dialog-box'))).length === 0,
      timeoutMs,
    )
    .catch(() => undefined);
}

/** Click a labelled button (e.g. "Delete"/"Cancel") in the open modal dialog. */
async function clickModalButton(label: string, timeoutMs = 20000): Promise<void> {
  const driver = VSBrowser.instance.driver;
  const dialog = await driver.wait(
    until.elementLocated(By.className('monaco-dialog-box')),
    timeoutMs,
    'modal dialog (.monaco-dialog-box) did not appear',
  );
  const buttons = await dialog.findElements(By.className('monaco-text-button'));
  for (const button of buttons) {
    if ((await button.getText()).trim() === label) {
      await button.click();
      await driver.wait(
        async () =>
          (await driver.findElements(By.className('monaco-dialog-box'))).length === 0,
        timeoutMs,
        `modal dialog did not close after clicking "${label}"`,
      );
      return;
    }
  }
  throw new Error(`modal dialog had no "${label}" button`);
}

/**
 * Wait until the (entered) Properties view has rendered a row whose key span
 * contains `keyFragment`, so assertions run against the populated DOM rather than
 * an empty view (the view renders rows asynchronously after `properties:update`).
 */
async function waitForPropertiesKey(
  props: PropertiesPanel,
  keyFragment: string,
  timeoutMs = 30000,
): Promise<void> {
  await VSBrowser.instance.driver.wait(
    async () => {
      const keys = await props.readKeyTexts();
      return keys.some((k) => k.includes(keyFragment));
    },
    timeoutMs,
    `Properties view never rendered a "${keyFragment}" row`,
  );
}

/** True once a Projects-tree item with the given label appears (after reload). */
async function waitForProjectItem(
  projects: ProjectsView,
  label: string,
  timeoutMs = 30000,
): Promise<void> {
  await VSBrowser.instance.driver.wait(
    async () => projects.hasItem(label),
    timeoutMs,
    `project item "${label}" never appeared in the Projects tree`,
  );
}

/**
 * PRJ-1 (green) — create a new project through the ProjectCreator webview.
 *
 * Points the persisted workspace path at a fresh temp dir (so the extension's
 * `ProjectManager.addProject` writes `projects.json` there), then drives the real
 * Create New Project webview: name + an explicit in-workspace location + the grid
 * fields, then Create. Asserts the on-disk registry + the new project's
 * config.json exist, and that the project shows in the tree AND becomes active
 * (the create handler auto-runs `triforge.openProject`). No reload needed — create
 * mutates the live in-memory project list and fires `project:listChanged`.
 */
describe('Triforge projects (PRJ-1: create via ProjectCreator webview)', function () {
  this.timeout(300000);

  let workspacePath: string;
  let previousSettings: string | undefined;

  before(async () => {
    await VSBrowser.instance.waitForWorkbench();
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'triforge-e2e-prj1-'));
    // Point the extension at this workspace so addProject persists here, then
    // reload so the running extension picks up the workspace path.
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

  it('creates the registry + config.json and shows the project active in the tree', async () => {
    await resetToWorkbench();
    // Unique name per attempt keeps each run's created project distinct; the
    // create handler now REUSES an existing folder, so a retry re-registers it.
    const projectName = `PRJ1Created${Date.now().toString(36)}`;
    const projectPath = path.join(workspacePath, projectName);
    const creator = new ProjectCreator();
    await creator.open();
    await creator.setName(projectName);
    // Typing the name auto-derives the path; overwrite with the in-workspace path.
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

    // The real create path created the project dir + config.json...
    const configFile = path.join(projectPath, 'config.json');
    await VSBrowser.instance.driver.wait(
      async () => fs.existsSync(configFile),
      30000,
      `expected config.json to be created at ${configFile}`,
    );
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    expect(config.settings.name).to.equal(projectName);
    expect(config.settings.path).to.equal(projectPath);

    // ...and registered the project in the workspace's projects.json.
    const registryFile = path.join(workspacePath, '.triforge', 'projects.json');
    await VSBrowser.instance.driver.wait(
      async () => fs.existsSync(registryFile),
      30000,
      `expected projects.json registry at ${registryFile}`,
    );
    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    expect(registry.triforge.projectpaths).to.include(projectPath);

    // And it appears in the Projects tree AND is the active project.
    const projects = new ProjectsView();
    await waitForProjectItem(projects, projectName);
    expect(await projects.hasItem(projectName)).to.be.true;
    await VSBrowser.instance.driver.wait(
      async () => projects.isActive(projectName),
      30000,
      'newly created project should become active',
    );
    expect(
      await projects.isActive(projectName),
      'newly created project should be active',
    ).to.be.true;
  });
});

/**
 * PRJ-3 (green) — a seeded, registered project loads + shows active after reload.
 *
 * Seeds a ready golden project into a temp workspace, registers it, then reloads
 * the window so `activate()` re-runs `_loadProjects()`. Asserts the project is
 * loaded (present in the tree). Then opens it (clicking the item fires
 * `triforge.openProject`) and asserts it shows the `(Active)` marker.
 */
describe('Triforge projects (PRJ-3: seeded project loads + activates after reload)', function () {
  this.timeout(300000);

  it('loads the registered project after a window reload and can activate it', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      const seeded = ws.seed('HawRidgePark', { name: 'PRJ3Seeded' });
      ws.register([seeded.projectPath]);
      await reloadWindow();

      const projects = new ProjectsView();
      await waitForProjectItem(projects, seeded.projectName);
      expect(await projects.hasItem(seeded.projectName), 'seeded project should load')
        .to.be.true;

      // Activating it via the tree marks it active.
      await projects.openItem(seeded.projectName);
      await VSBrowser.instance.driver.wait(
        async () => projects.isActive(seeded.projectName),
        30000,
        'seeded project should become active after opening it',
      );
      expect(await projects.isActive(seeded.projectName)).to.be.true;
    });
  });
});

/**
 * PRJ-6 (green) — switching the active project updates the tree + properties.
 *
 * Seeds two projects, registers both, reloads. Opens the first (active), then
 * opens the second and asserts the active marker moves to the second (and off
 * the first), and the Properties view reflects the newly active project's name.
 */
describe('Triforge projects (PRJ-6: switching active project updates tree + properties)', function () {
  this.timeout(300000);

  it('moves the active marker and properties to the newly opened project', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      const a = ws.seed('ProjectA', { name: 'PRJ6Alpha' });
      const b = ws.seed('ProjectB', { name: 'PRJ6Bravo' });
      ws.register([a.projectPath, b.projectPath]);
      await reloadWindow();

      const projects = new ProjectsView();
      await waitForProjectItem(projects, a.projectName);
      await waitForProjectItem(projects, b.projectName);

      // Activate Alpha first.
      await projects.openItem(a.projectName);
      await VSBrowser.instance.driver.wait(
        async () => projects.isActive(a.projectName),
        30000,
        'Alpha should be active after opening it',
      );

      // Switch to Bravo.
      await projects.openItem(b.projectName);
      await VSBrowser.instance.driver.wait(
        async () => projects.isActive(b.projectName),
        30000,
        'Bravo should be active after switching to it',
      );

      expect(await projects.isActive(b.projectName), 'Bravo active').to.be.true;
      expect(await projects.isActive(a.projectName), 'Alpha no longer active').to.be
        .false;

      // The Properties view reflects the selected (now-active) project. Close the
      // MapEditor first so the Properties view is the ONLY webview — otherwise
      // ExTester's WebviewView picks the larger MapEditor iframe by rect.
      await closeAllEditors();
      const props = new PropertiesPanel();
      await props.reveal();
      await props.enter();
      try {
        await waitForPropertiesKey(props, 'Project Name');
        const values = await props.readValueTexts();
        expect(
          values.some((v) => v.includes(b.projectName)),
          `Properties view should show the active project name "${b.projectName}"`,
        ).to.be.true;
      } finally {
        await props.leave();
      }
    });
  });
});

/**
 * PRJ-9 (green strength-guard) — one corrupt config does not block the others.
 *
 * Seeds two projects, corrupts one project's config.json (invalid JSON), registers
 * both, reloads. `_loadProjects` catches the per-project parse error and continues,
 * so the OTHER project must still load. Asserts the good project loads and the
 * corrupt one does not silently take the good one down with it.
 */
describe('Triforge projects (PRJ-9: a corrupt config does not block other projects)', function () {
  this.timeout(300000);

  it('still loads the healthy project when a sibling config.json is invalid', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      const good = ws.seed('GoodProject', { name: 'PRJ9Good' });
      const bad = ws.seed('BadProject', { name: 'PRJ9Bad' });

      // Corrupt the bad project's config.json with invalid JSON.
      fs.writeFileSync(path.join(bad.projectPath, 'config.json'), '{ this is : not, valid JSON');

      ws.register([bad.projectPath, good.projectPath]);
      await reloadWindow();
      // The corrupt config triggers a modal load-error dialog; dismiss it so the
      // tree is interactive. The healthy project must still have loaded.
      await dismissModalIfPresent();

      const projects = new ProjectsView();
      await waitForProjectItem(projects, good.projectName);

      expect(
        await projects.hasItem(good.projectName),
        'healthy project must still load despite a corrupt sibling',
      ).to.be.true;
      expect(
        await projects.hasItem(bad.projectName),
        'the corrupt project must not load',
      ).to.be.false;
    });
  });
});

/**
 * PRJ-4 (green characterization) — opening a project does NOT execute run_command.
 *
 * Refuted SEC-1 claimed the per-project `run_command` was auto-executed on open.
 * It is not: `triforge.openProject` only sets the active project + reveals the map;
 * `run_command` is only spawned from the ExecutionSetupEditor when the user
 * explicitly runs the simulation. We characterize that safety: seed a project
 * whose `run_command` is a sentinel that would `touch` a marker file if executed,
 * reload, open the project, and assert the marker NEVER appears (no auto-exec).
 */
describe('Triforge projects (PRJ-4: opening a project does not execute run_command)', function () {
  this.timeout(300000);

  it('does not run the configured run_command on open (no auto-exec)', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      const markerFile = path.join(ws.workspacePath, 'prj4-exec-marker');
      // A sentinel command that would create the marker IF it were ever executed.
      const sentinel = ws.seed('SentinelProject', {
        name: 'PRJ4Sentinel',
        runCommand: `touch ${markerFile}`,
      });
      ws.register([sentinel.projectPath]);
      await reloadWindow();

      const projects = new ProjectsView();
      await waitForProjectItem(projects, sentinel.projectName);

      // Open/activate the project — this is the action SEC-1 alleged would exec.
      await projects.openItem(sentinel.projectName);
      await VSBrowser.instance.driver.wait(
        async () => projects.isActive(sentinel.projectName),
        30000,
        'sentinel project should activate on open',
      );

      // Give any (erroneous) async spawn a chance to land, then assert NO exec.
      await VSBrowser.instance.driver.sleep(1500);
      expect(
        fs.existsSync(markerFile),
        'opening a project must NOT execute its run_command (no auto-exec on open)',
      ).to.be.false;

      // And the run_command is preserved verbatim in config (handled as data only).
      const config = JSON.parse(
        fs.readFileSync(path.join(sentinel.projectPath, 'config.json'), 'utf8'),
      );
      expect(config.execution.run_command).to.equal(`touch ${markerFile}`);
    });
  });
});

/**
 * PRJ-2 (xfail SEC-3) — a project name with an HTML/script payload must render
 * inert wherever it is shown in a webview.
 *
 * The Properties webview builds its rows by string-interpolating each property's
 * key/value straight into `innerHTML` with NO escaping (see
 * `src/views/PropertiesHtml.ts` `renderProperties`). So a project whose NAME
 * carries an HTML payload + a sentinel element renders that element LIVE in the
 * Properties view instead of as literal text.
 *
 * Post-fix property (SEC-3): the name is rendered as inert text — the injected
 * sentinel element does NOT appear in the Properties DOM, and the displayed value
 * equals the literal payload. Today it is unescaped, so the sentinel element IS
 * present -> the safety assertion throws -> xfail passes. When SEC-3 lands the
 * sentinel is gone and the value is literal, so xfail flips loudly.
 */
describe('Triforge projects (PRJ-2: project-name HTML payload stays inert — SEC-3 FIXED)', function () {
  this.timeout(300000);

  // Plain prefix (for tree matching) + a sentinel element. Attribute values are
  // left UNQUOTED so the payload survives interpolation into both the row's
  // `title="..."` attribute and its `.value` innerHTML without a stray double
  // quote corrupting the surrounding markup — the sentinel `<span>` must render
  // cleanly today (unescaped) for the xfail to reflect the real vuln.
  const SENTINEL_PREFIX = 'PRJ2pwn';
  const PAYLOAD = `${SENTINEL_PREFIX}<img src=x onerror=window.__prj2=1><span id=prj2-pwned>x</span>`;

  it('renders an HTML-payload project name as inert text in the Properties view', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      const evil = ws.seed('EvilProject', { name: PAYLOAD });
      ws.register([evil.projectPath]);
      await reloadWindow();

      const projects = new ProjectsView();
      // Match on the plain sentinel prefix (full raw payload is awkward to match).
      await VSBrowser.instance.driver.wait(
        async () => (await projects.getItemContaining(SENTINEL_PREFIX)) !== undefined,
        30000,
        'payload project never appeared in the Projects tree',
      );
      const item = await projects.getItemContaining(SENTINEL_PREFIX);
      if (!item) throw new Error('payload project item not found');
      // Select it so the Properties view updates with this project's name.
      await (item as typeof item & { safeClick: () => Promise<void> }).safeClick();

      // Close the MapEditor opened by selecting the project, so the Properties
      // view is the ONLY webview for ExTester's WebviewView to switch into.
      await closeAllEditors();
      const props = new PropertiesPanel();
      await props.reveal();
      await props.enter();
      try {
        // Ensure the project's rows have actually rendered before asserting, so
        // the xfail reflects the rendered (unescaped) DOM, not an empty view.
        await waitForPropertiesKey(props, 'Project Name');
        // SEC-3 FIXED (T2): the injected sentinel element must NOT exist in the DOM...
        const injected = await props.hasElement('#prj2-pwned');
        expect(
          injected,
          'injected sentinel element must not be rendered in the Properties view',
        ).to.be.false;
        // ...and the displayed value should be the literal payload text.
        const values = await props.readValueTexts();
        expect(
          values.some((v) => v.includes(PAYLOAD)),
          'project name should render as the literal payload string',
        ).to.be.true;
      } finally {
        await props.leave();
      }
    });
  });
});

/**
 * PRJ-5 (xfail SEC-5) — removing an out-of-workspace project must be validated
 * and blocked; a normal in-workspace remove still works.
 *
 * `triforge.removeProject` deletes `project.path` with `fs.rmSync(..., { recursive,
 * force })` after a confirm modal, with NO validation that the path lives inside
 * the configured workspace and NO resolution shown for relative entries (see
 * `src/commands/project.ts`). An attacker-controlled / out-of-workspace registry
 * entry is therefore deleted verbatim.
 *
 * Post-fix property (SEC-5): removal of an out-of-workspace path is validated and
 * BLOCKED (the directory survives), and the confirm modal shows the RESOLVED
 * absolute path. Today there is no validation, so confirming the delete removes
 * the out-of-workspace dir -> the "directory survives" safety assertion throws ->
 * xfail passes. The normal in-workspace remove is asserted green outside the
 * xfail to prove the happy path is intact.
 */
describe('Triforge projects (PRJ-5: out-of-workspace remove blocked — SEC-5 FIXED)', function () {
  this.timeout(300000);

  let outsideDir: string;

  after(async () => {
    // Leave a clean editor area + top frame for whatever suite runs next, so a
    // leftover MapEditor/ProjectCreator webview can't confuse its frame pickers.
    try {
      await resetToWorkbench();
    } catch {
      /* best-effort */
    }
    try {
      if (outsideDir) fs.rmSync(outsideDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it('blocks deleting an out-of-workspace project while a normal remove works', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      // An out-of-workspace project: registered, but its dir lives OUTSIDE the
      // workspace tree, so deleting it should be validated/blocked post-fix.
      outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triforge-e2e-prj5-outside-'));
      const outside = ws.seed('OutsideHolder', { name: 'PRJ5OutsideSrc' });
      // Move the materialized project out of the workspace, rewriting its
      // config path so it loads from the out-of-workspace location.
      fs.rmSync(outsideDir, { recursive: true, force: true });
      fs.renameSync(outside.projectPath, outsideDir);
      const outsideConfigFile = path.join(outsideDir, 'config.json');
      const outsideConfig = JSON.parse(fs.readFileSync(outsideConfigFile, 'utf8'));
      outsideConfig.settings.path = outsideDir;
      outsideConfig.settings.name = 'PRJ5Outside';
      fs.writeFileSync(outsideConfigFile, JSON.stringify(outsideConfig, null, 2));

      // A normal in-workspace project for the happy-path remove.
      const inside = ws.seed('InsideProject', { name: 'PRJ5Inside' });

      ws.register([outsideDir, inside.projectPath]);
      await reloadWindow();

      const projects = new ProjectsView();
      await waitForProjectItem(projects, 'PRJ5Outside');
      await waitForProjectItem(projects, inside.projectName);

      // 1) Happy path: remove the in-workspace project via its context menu.
      await projects.selectContextMenuAction(inside.projectName, 'Remove Project');
      await clickModalButton('Delete');
      await VSBrowser.instance.driver.wait(
        async () => !(await projects.hasItem(inside.projectName)),
        30000,
        'in-workspace project should be removed from the tree',
      );
      expect(
        await projects.hasItem(inside.projectName),
        'normal in-workspace remove should work',
      ).to.be.false;
      expect(
        fs.existsSync(inside.projectPath),
        'in-workspace project dir should be deleted by a normal remove',
      ).to.be.false;

      // 2) Out-of-workspace: trigger remove and inspect the confirm modal, then
      //    confirm. Post-fix this must be blocked (the dir survives) and the modal
      //    must show the resolved absolute path.
      await projects.selectContextMenuAction('PRJ5Outside', 'Remove Project');
      const modalText = await readModalDialogText();
      await clickModalButton('Delete');
      // Let any deletion settle.
      await VSBrowser.instance.driver.sleep(1500);

      // Post-fix (SEC-5): the out-of-workspace directory is NOT deleted (removal blocked)...
      expect(
        fs.existsSync(outsideDir),
        'out-of-workspace project removal must be validated and blocked (dir survives)',
      ).to.be.true;
      // ...and the confirm modal showed the RESOLVED absolute path.
      expect(
        modalText.includes(outsideDir),
        'confirm modal should show the resolved absolute project path',
      ).to.be.true;
    });
  });
});
