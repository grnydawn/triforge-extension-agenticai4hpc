import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { By, InputBox, Key, until, VSBrowser, Workbench } from 'vscode-extension-tester';
import { ProjectsView } from '../../pageobjects/ProjectsView.ts';
import { closeAllEditors, reloadWindow, resetToWorkbench } from '../../pageobjects/workbench.ts';
import {
  restoreExtensionWorkspacePath,
  seedProjectInto,
  setExtensionWorkspacePath,
  writeProjectsRegistry,
} from '../../helpers/seed.ts';

/**
 * Project export/import E2E (.tfp) — the portable-project journey:
 *
 * EXP-1 — right-click Export on the seeded project produces a real archive
 *         (both "Inputs + outputs" and "Inputs only"), whose config is
 *         POSIX-relative, secret-free and canonical.
 * IMP-1 — after deleting the project, palette-import of the inputs-only
 *         archive recreates it under the workspace root as if created
 *         locally: absolute local paths, compute target reset, TRITON-ready
 *         build/triton_execution.cfg, active in the tree.
 * IMP-2 — importing the full archive again MERGES into the same-id project:
 *         outputs land (config union + files on disk), no duplicate entry.
 * SEC-1 — a crafted archive with a traversal entry is refused outright.
 *
 * File dialogs: test/extester-settings.json enables files.simpleDialog.enable,
 * so showSaveDialog/showOpenDialog render as in-window quick-inputs that
 * `InputBox` can drive (native OS dialogs are un-drivable — see
 * run/animation.e2e.test.ts:381). Driving them is inherently racy — the
 * dialog swallows Enter while its async directory listing is loading — so
 * driveSimpleFileDialog waits for idle and confirms in a loop until the
 * dialog really closes, and every test starts by dismissing leftovers.
 */

/** Buffer → plain Uint8Array view (no copy): TS 5.9's generic Uint8Array lib
 *  types reject Buffer where fflate expects a Uint8Array (same shim as
 *  src/commands/projectArchive.ts). */
function asU8(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Drive VS Code's SIMPLE file dialog: replace its path input, then confirm
 * until the dialog actually closes.
 *
 * The simple dialog re-reads the directory listing asynchronously after every
 * value change, and its accept handler DROPS Enter while that read is in
 * flight (`simpleFileDialog.ts` `onDidAccept` returns early when the pick box
 * is busy). A single `confirm()` right after `setText()` therefore races the
 * listing and can leave the dialog open forever with the path correctly typed
 * — the exact IMP-1/IMP-2 failure mode on this box. So: wait for the busy
 * bar to go idle, re-assert the value, confirm, and repeat until the shared
 * quick-input widget hides.
 */
async function driveSimpleFileDialog(targetPath: string, timeoutMs = 60000): Promise<void> {
  const driver = VSBrowser.instance.driver;
  const input = await InputBox.create(20000);

  // The simple dialog pre-fills its input with a filesystem path; the command
  // palette (same widget) shows a '>'-prefixed value and the export flavor
  // QuickPick an empty one. Requiring the widget to be DISPLAYED with such a
  // path excludes both — and also a hidden widget's residual value from an
  // earlier dialog — so we never type into the wrong (or no) quick input.
  await driver.wait(async () => {
    try {
      if (!(await input.isDisplayed())) return false;
      const value = await input.getText();
      return value.length > 0 && !value.startsWith('>');
    } catch {
      return false;
    }
  }, 20000, 'simple file dialog did not engage (no pre-filled path in the quick input)');

  await driver.wait(async () => {
    // Done? The shared quick-input widget hides once the dialog accepts.
    try {
      if (!(await input.isDisplayed())) return true;
    } catch {
      return true; // stale/detached widget — the dialog closed
    }
    try {
      // Busy (directory listing in flight)? Enter would be dropped/deferred —
      // wait. (VS Code 1.90 only marks the bar `.active` after ~800ms of
      // continuous busy, so short busy windows slip through this check; the
      // re-assert + confirm retry below is what actually converges.)
      const busy = await driver.findElements(
        By.css('.quick-input-widget .monaco-progress-container.active'));
      if (busy.length > 0) return false;
      // Type the target INSIDE the retry loop (first pass types it, later
      // passes re-assert it after a late listing update rewrote the input) so
      // a transient typing failure is retried instead of failing the test,
      // and Enter is only ever sent on an iteration where the value already
      // matches — never in the same breath as the typing that re-busies the
      // dialog.
      if ((await input.getText()) !== targetPath) {
        await input.setText(targetPath);
        return false;
      }
      await input.confirm();
    } catch {
      /* dialog may have closed mid-interaction — re-check on the next poll */
    }
    await driver.sleep(300);
    return false;
  }, timeoutMs, `simple file dialog never accepted "${targetPath}"`);
}

/**
 * Dismiss anything a failed attempt may have left open — a stuck simple file
 * dialog, an export QuickPick, or a modal dialog. Leftovers block EVERY later
 * workbench interaction, which is how one dropped Enter cascaded into all
 * three IMP-1 attempts (and IMP-2) failing at their preconditions.
 */
async function dismissLeftovers(): Promise<void> {
  const driver = VSBrowser.instance.driver;
  try {
    await driver.switchTo().defaultContent();
  } catch {
    /* ignore */
  }
  // Modal dialogs first (Escape cancels showWarningMessage modals).
  for (let i = 0; i < 3; i++) {
    const dialogs = await driver.findElements(By.className('monaco-dialog-box'));
    if (dialogs.length === 0) break;
    await driver.actions().sendKeys(Key.ESCAPE).perform().catch(() => undefined);
    await driver.sleep(300);
  }
  // Then any visible quick input (the stuck simple dialog / QuickPick).
  for (let i = 0; i < 3; i++) {
    let anyVisible = false;
    for (const widget of await driver.findElements(By.css('.quick-input-widget'))) {
      try {
        if (await widget.isDisplayed()) {
          anyVisible = true;
          break;
        }
      } catch {
        /* stale — treat as gone */
      }
    }
    if (!anyVisible) break;
    await driver.actions().sendKeys(Key.ESCAPE).perform().catch(() => undefined);
    await driver.sleep(300);
  }
}

/** Click the labelled button in the open modal dialog (same pattern as
 *  data/dem.e2e.test.ts — suites keep this helper file-local). */
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

/** Wait until a notification whose message contains `fragment` shows up. */
async function waitForNotification(fragment: string, timeoutMs = 30000): Promise<void> {
  await VSBrowser.instance.driver.wait(async () => {
    const notifications = await new Workbench().getNotifications();
    for (const n of notifications) {
      try {
        if ((await n.getMessage()).includes(fragment)) return true;
      } catch {
        /* notification disposed mid-read — keep polling */
      }
    }
    return false;
  }, timeoutMs, `no notification containing "${fragment}" appeared`);
}

describe('Triforge project export/import (.tfp)', function () {
  this.timeout(600000);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'triforge-e2e-archive-'));
  const archiveFull = path.join(scratch, 'HawRidgePark-full.tfp');
  const archiveLite = path.join(scratch, 'HawRidgePark-lite.tfp');

  let workspacePath: string;
  let projectPath: string;
  let projectName: string;
  let previousSettings: string | undefined;

  before(async function () {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'triforge-e2e-ws-'));
    // Give the seeded project a run command + env var that embed the project's
    // OWN absolute paths — exactly what the interactive run builder produces
    // (it appends the absolute triton_execution.cfg path). This suite never
    // runs TRITON, so a non-fake run command is fine, and it lets EXP-1/IMP-1
    // prove those free-form strings survive the machine hop (the Linux→Mac bug).
    const seeded = seedProjectInto(workspacePath, 'HawRidgePark', {
      mutateConfig: (config: any) => {
        const root = config.settings.path;
        config.execution.run_command =
          `triton_run.sh ${root}/build/triton_execution.cfg  "mpirun -n 2"`;
        config.execution.env_variables = `TRITON_WORKDIR=${root}/build`;
      },
    });
    projectPath = seeded.projectPath;
    projectName = seeded.projectName;
    writeProjectsRegistry(workspacePath, projectPath);
    previousSettings = setExtensionWorkspacePath(workspacePath);
    await reloadWindow();
    await resetToWorkbench();
  });

  beforeEach(async function () {
    // Mocha retries re-enter the test body but not `before`: start every
    // attempt from a clean workbench so a failed attempt's leftover dialog
    // can't fail the retry (or the next test) at its precondition.
    await dismissLeftovers();
  });

  after(async function () {
    restoreExtensionWorkspacePath(previousSettings);
    for (const dir of [workspacePath, scratch]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
    try {
      await resetToWorkbench();
    } catch {
      /* best-effort */
    }
  });

  it('EXP-1: exports inputs+outputs and inputs-only archives with a portable, secret-free config', async () => {
    const projects = new ProjectsView();
    await VSBrowser.instance.driver.wait(
      async () => projects.hasItem(projectName), 30000, 'seeded project never appeared');

    // Inputs + outputs.
    await projects.selectContextMenuAction(projectName, 'Export Project...');
    const qp = await InputBox.create(20000);
    await qp.selectQuickPick('Inputs + outputs');
    await driveSimpleFileDialog(archiveFull);
    await VSBrowser.instance.driver.wait(
      () => fs.existsSync(archiveFull), 30000, 'full .tfp was never written');

    // Inputs only.
    await projects.selectContextMenuAction(projectName, 'Export Project...');
    const qp2 = await InputBox.create(20000);
    await qp2.selectQuickPick('Inputs only');
    await driveSimpleFileDialog(archiveLite);
    await VSBrowser.instance.driver.wait(
      () => fs.existsSync(archiveLite), 30000, 'lite .tfp was never written');

    // Unpack + portability invariants.
    const entries = unzipSync(asU8(fs.readFileSync(archiveFull)));
    const manifest = JSON.parse(strFromU8(entries['triforge.export.json']));
    expect(manifest.projectName).to.equal(projectName);
    expect(manifest.includesOutputs).to.equal(true);
    expect(manifest.schemaVersion).to.match(/^\d+\.\d+\.\d+$/);

    const config = JSON.parse(strFromU8(entries['config.json']));
    expect(config.settings.path, 'settings.path must not be exported').to.equal(undefined);
    expect(JSON.stringify(config), 'no secrets in the archive').to.not.match(/apiKeys|openTopography/i);
    expect(config.input.dem, 'dem is POSIX-relative').to.equal('input/HawRidgePark.asc');
    expect(config.compsetup.build_dir).to.equal('build');
    expect(config.execution.run_directory).to.equal('build');
    expect(config.output.output_directory).to.equal('output');
    expect(config.output.ascii.length).to.be.greaterThan(0);
    expect(config.output.ascii[0]).to.match(/^build\/output\//);

    // Free-form command/env strings: the exporter's absolute project path is
    // replaced by the portable token (matches PROJECT_ROOT_TOKEN in src), so no
    // machine-local path leaks into the archive.
    expect(config.execution.run_command).to.equal(
      'triton_run.sh __TRITON_PROJECT_ROOT__/build/triton_execution.cfg  "mpirun -n 2"');
    expect(config.execution.run_command, 'no exporter path in the archived run command')
      .to.not.include(projectPath);
    expect(config.execution.env_variables).to.equal('TRITON_WORKDIR=__TRITON_PROJECT_ROOT__/build');

    // Input bytes round-trip exactly; listed outputs really ship.
    const original = fs.readFileSync(path.join(projectPath, 'input', 'HawRidgePark.asc'));
    expect(Buffer.compare(entries['input/HawRidgePark.asc'], asU8(original))).to.equal(0);
    expect(entries[config.output.ascii[0]], 'listed outputs must be in the archive').to.not.equal(undefined);

    // Inputs-only: lists emptied, no output payload.
    const liteEntries = unzipSync(asU8(fs.readFileSync(archiveLite)));
    const liteConfig = JSON.parse(strFromU8(liteEntries['config.json']));
    expect(liteConfig.output.ascii).to.deep.equal([]);
    expect(Object.keys(liteEntries).some((e) => e.startsWith('build/output/'))).to.equal(false);
  });

  it('IMP-1: imports the inputs-only archive as a fresh, locally-reset, TRITON-ready project', async () => {
    const projects = new ProjectsView();
    const dest = path.join(workspacePath, projectName);

    // Delete the seeded project (context menu → modal → folder removed from
    // disk) so the import is fresh. On a retry it may already be gone —
    // this block only has to guarantee ABSENCE before importing.
    if (await projects.hasItem(projectName)) {
      await projects.selectContextMenuAction(projectName, 'Remove Project');
      await clickModalButton('Delete');
    }
    await VSBrowser.instance.driver.wait(
      async () => !(await projects.hasItem(projectName)), 30000, 'project was not removed');
    // A half-failed attempt can leave the folder on disk without a registry
    // entry; clear it so the import claims `<root>/<name>`, not `<name>-2`.
    fs.rmSync(dest, { recursive: true, force: true });

    // Palette import — MUST work with an empty Projects list (the
    // first-machine bootstrap path), then the simple open dialog.
    await new Workbench().executeCommand('Triforge: Import Project');
    await driveSimpleFileDialog(archiveLite);

    await VSBrowser.instance.driver.wait(
      async () => projects.hasItem(projectName), 60000, 'imported project never appeared');

    const config = JSON.parse(fs.readFileSync(path.join(dest, 'config.json'), 'utf8'));
    expect(config.settings.path).to.equal(dest);
    expect(config.input.dem).to.equal(path.join(dest, 'input', 'HawRidgePark.asc'));
    expect(fs.existsSync(config.input.dem), 'imported DEM exists on disk').to.equal(true);
    expect(config.compsetup.source_dir, 'compute target reset').to.equal('');
    expect(config.compsetup.triton_target, 'compute target reset').to.equal('');
    expect(config.compsetup.build_dir).to.equal(path.join(dest, 'build'));
    expect(config.execution.run_directory).to.equal(path.join(dest, 'build'));
    expect(config.output.output_directory).to.equal(path.join(dest, 'output'));

    // Build folder is TRITON-ready and points at the LOCAL inputs.
    const cfg = fs.readFileSync(path.join(dest, 'build', 'triton_execution.cfg'), 'utf8');
    expect(cfg).to.include(`dem_filename=${path.join(dest, 'input', 'HawRidgePark.asc')}`);

    // The run command + env var are re-localized to THIS machine: the portable
    // token is gone and they point at the local cfg / build dir. (This is the
    // Linux→Mac bug: TRITON must read the local cfg, not the exporter's path.)
    expect(config.execution.run_command, 'run command token must be re-localized')
      .to.not.include('__TRITON_PROJECT_ROOT__');
    expect(config.execution.run_command).to.include(
      `${path.join(dest, 'build', 'triton_execution.cfg')}`);
    expect(config.execution.env_variables).to.equal(
      `TRITON_WORKDIR=${path.join(dest, 'build')}`);

    // Active, like a locally created project.
    await VSBrowser.instance.driver.wait(
      async () => projects.isActive(projectName), 30000, 'imported project should be active');
    await closeAllEditors();
  });

  it('IMP-2: merging the full archive into the same-id project unions outputs without duplicating it', async () => {
    const projects = new ProjectsView();

    await new Workbench().executeCommand('Triforge: Import Project');
    await driveSimpleFileDialog(archiveFull);
    await clickModalButton('Merge');

    const dest = path.join(workspacePath, projectName);
    await VSBrowser.instance.driver.wait(() => {
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(dest, 'config.json'), 'utf8'));
        return Array.isArray(cfg.output?.ascii) && cfg.output.ascii.length > 0;
      } catch {
        return false;
      }
    }, 60000, 'merge never landed the archive outputs into config.json');

    const config = JSON.parse(fs.readFileSync(path.join(dest, 'config.json'), 'utf8'));
    const sample = config.output.ascii[0];
    expect(sample.startsWith(dest), 'merged output entries are local absolute paths').to.equal(true);
    expect(fs.existsSync(sample), 'merged output file materialized on disk').to.equal(true);

    // Registry not duplicated.
    const labels = await projects.getItemLabels();
    expect(labels.filter((l) => l.includes(projectName)).length).to.equal(1);
  });

  it('SEC-1: refuses an archive whose entry escapes the destination (zip-slip)', async () => {
    const evilArchive = path.join(scratch, 'evil.tfp');
    const manifest = {
      schemaVersion: '1.0.0',
      exportedAt: '2026-07-10T00:00:00.000Z',
      projectName: 'EvilProject',
      projectId: 'evil-0001',
      includesOutputs: false,
      sourceOS: 'linux',
    };
    const config = {
      version: '1.0.0',
      settings: { id: 'evil-0001', name: 'EvilProject' },
      input: {}, output: {}, compsetup: {}, execution: {},
    };
    fs.writeFileSync(evilArchive, zipSync({
      'triforge.export.json': strToU8(JSON.stringify(manifest)),
      'config.json': strToU8(JSON.stringify(config)),
      '../evil.txt': strToU8('pwned'),
    }));

    await new Workbench().executeCommand('Triforge: Import Project');
    await driveSimpleFileDialog(evilArchive);

    await waitForNotification('escapes');
    expect(fs.existsSync(path.join(workspacePath, 'evil.txt')),
      'nothing may be written outside the destination').to.equal(false);
    const projects = new ProjectsView();
    expect(await projects.hasItem('EvilProject')).to.equal(false);
  });
});
