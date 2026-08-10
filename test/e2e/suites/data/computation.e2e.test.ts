import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { By, VSBrowser, Workbench } from 'vscode-extension-tester';
import { ComputationSetup } from '../../pageobjects/ComputationSetup.ts';
import { ProjectsView } from '../../pageobjects/ProjectsView.ts';
import {
  closeAllEditors,
  reloadWindow,
  resetToWorkbench,
} from '../../pageobjects/workbench.ts';
import { withTempWorkspace } from '../../helpers/seed.ts';
import { xfail } from '../../../helpers/xfail.ts';

/**
 * Computation-setup E2E suite (CMP-1..5).
 *
 * Each scenario seeds a ready golden project, reloads the window (the extension
 * only loads its project registry at `activate()`), activates the project, then
 * drives the REAL Computation Setup webview (`triforge.openComputationSetup`) via
 * the {@link ComputationSetup} page object. Where a scenario mutates project
 * state it asserts the on-disk `config.json` (`compsetup` block) that
 * `ProjectManager.updateProject` rewrites and/or the host-side notification /
 * modal that `ComputationSetupEditor.saveSettings` raises.
 *
 * Green:  CMP-1 (source mode + a pre-placed `<build_dir>/triton.exe` is detected
 *         and persisted as the source target), CMP-3 (executable mode + an
 *         existing exe path is accepted and persisted), CMP-2 (docker mode + an
 *         image name persists mode/image to config — the real `docker pull` runs
 *         in a VS Code terminal with no fakeable seam, so the pull itself is not
 *         verified here).
 * xfail:  CMP-4 (TYPE-1 — source mode with NO `triton.exe` SHOULD be rejected
 *         with a warning and not persisted, but the host's validation gate is
 *         dead code: it reads `message.execution_mode` while the webview posts
 *         `executable_target_mode`, so every save is wrongly accepted; CMP-4
 *         guards the post-fix "missing-exe source is rejected" property).
 *         CMP-5 (SEC-6 — `_handleDownloadDocker` interpolates the image into a
 *         shell command string sent to a terminal; a metacharacter payload
 *         executes, so the post-fix "no shell injection" property fails today).
 */

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

/** Read a seeded project's on-disk config.json. */
function readConfig(projectPath: string): any {
  return JSON.parse(fs.readFileSync(path.join(projectPath, 'config.json'), 'utf8'));
}

/**
 * Dismiss every open modal dialog (`.monaco-dialog-box`) by clicking OK/Close.
 *
 * CMP-4's validation gate raises a MODAL `showWarningMessage(...,{modal:true})`
 * ("TRITON executable not found … build") that sits at the workbench frame and
 * blocks the NEXT suite's command-palette open + `switchToFrame`. Clear it (at
 * the top frame) before handing off. Best-effort and fully defensive.
 */
async function dismissModals(timeoutMs = 15000): Promise<void> {
  const driver = VSBrowser.instance.driver;
  await driver.switchTo().defaultContent().catch(() => undefined);
  const deadline = Date.now() + timeoutMs;
  do {
    const dialogs = await driver
      .findElements(By.className('monaco-dialog-box'))
      .catch(() => []);
    if (dialogs.length === 0) return;
    for (const dialog of dialogs) {
      const buttons = await dialog
        .findElements(By.className('monaco-text-button'))
        .catch(() => []);
      let clicked = false;
      for (const button of buttons) {
        const label = (await button.getText().catch(() => '')).trim();
        if (label === 'OK' || label === 'Ok' || label === 'Close') {
          await button.click().catch(() => undefined);
          clicked = true;
          break;
        }
      }
      if (!clicked && buttons[0]) await buttons[0].click().catch(() => undefined);
    }
    await driver.sleep(500);
  } while (Date.now() < deadline);
}

/** Restore a clean top frame + empty editor area for the next test/suite. */
async function cleanup(): Promise<void> {
  try {
    await dismissModals();
  } catch {
    /* best-effort */
  }
  try {
    await resetToWorkbench();
  } catch {
    /* best-effort */
  }
}

/**
 * Activate the named seeded project (selecting it in the Projects tree fires
 * `triforge.openProject`, which also makes it the `activeProject` the Computation
 * Setup reads), then close the MapEditor it opens so the later webview-frame
 * selection is unambiguous. Waits for the project to actually become active.
 */
async function activateProject(projectName: string): Promise<void> {
  const projects = new ProjectsView();
  await VSBrowser.instance.driver.wait(
    async () => projects.hasItem(projectName),
    30000,
    `project "${projectName}" never appeared in the Projects tree`,
  );
  await projects.openItem(projectName);
  await VSBrowser.instance.driver.wait(
    async () => projects.isActive(projectName),
    30000,
    `project "${projectName}" should become active after opening it`,
  );
  await closeAllEditors();
}

/** Wait for a non-modal notification whose message matches `re`. */
async function waitForNotification(re: RegExp, timeoutMs = 30000): Promise<string> {
  const driver = VSBrowser.instance.driver;
  let matched = '';
  await driver.wait(
    async () => {
      const notifications = await new Workbench().getNotifications().catch(() => []);
      for (const n of notifications) {
        const text = await n.getMessage().catch(() => '');
        if (re.test(text)) {
          matched = text;
          return true;
        }
      }
      return false;
    },
    timeoutMs,
    `expected a notification matching ${re} but none appeared`,
  );
  return matched;
}

/**
 * Wait for the validation warning the host raises on an invalid target. The
 * editor uses `showWarningMessage(error, { modal: true })`, which renders as a
 * `.monaco-dialog-box` modal in this harness — but to stay robust against
 * modal-vs-toast rendering differences we accept EITHER a modal dialog whose
 * text matches `re` OR a notification matching `re`. Returns the matched text
 * and dismisses any modal so later tests start from a clean frame.
 *
 * Must run at the workbench (top) frame — call after leaving the webview iframe.
 */
async function waitForWarning(re: RegExp, timeoutMs = 30000): Promise<string> {
  const driver = VSBrowser.instance.driver;
  await driver.switchTo().defaultContent();
  let matched = '';

  await driver.wait(
    async () => {
      // Modal dialog channel.
      const dialogs = await driver
        .findElements(By.className('monaco-dialog-box'))
        .catch(() => []);
      for (const dialog of dialogs) {
        const text = await dialog.getText().catch(() => '');
        if (re.test(text)) {
          matched = text;
          return true;
        }
      }
      // Notification toast channel.
      const notifications = await new Workbench().getNotifications().catch(() => []);
      for (const n of notifications) {
        const text = await n.getMessage().catch(() => '');
        if (re.test(text)) {
          matched = text;
          return true;
        }
      }
      return false;
    },
    timeoutMs,
    `expected a validation warning matching ${re} (modal or notification)`,
  );

  // Dismiss any modal so the next test starts clean.
  const dialogs = await driver
    .findElements(By.className('monaco-dialog-box'))
    .catch(() => []);
  for (const dialog of dialogs) {
    const buttons = await dialog.findElements(By.className('monaco-text-button'));
    let clicked = false;
    for (const button of buttons) {
      const label = (await button.getText().catch(() => '')).trim();
      if (label === 'OK' || label === 'Ok' || label === 'Close') {
        await button.click().catch(() => undefined);
        clicked = true;
        break;
      }
    }
    if (!clicked && buttons[0]) await buttons[0].click().catch(() => undefined);
  }
  await driver
    .wait(
      async () =>
        (await driver.findElements(By.className('monaco-dialog-box'))).length === 0,
      timeoutMs,
      'modal warning dialog did not close',
    )
    .catch(() => undefined);
  return matched;
}

/** Mark a file as executable (a dummy stand-in for a real build output / exe). */
function writeFakeExecutable(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '#!/bin/sh\necho fake triton\n');
  fs.chmodSync(filePath, 0o755);
}

// ===========================================================================
// CMP-1 (green) — source mode + a pre-placed build/triton.exe validates & saves.
// ===========================================================================
/**
 * The source path's "build" shells out (`triton_build.sh`) and has no fakeable
 * seam, so instead of running a real build we PRE-PLACE a dummy executable file
 * at `<build_dir>/triton.exe` standing in for the build output. Selecting source
 * mode with that build dir and saving accepts the target and persists
 * `executable_target_mode='source'` with a `triton_target` resolving to the
 * detected `<build_dir>/triton.exe` (the editor's `defaultBuildPath` logic
 * detects the exe and the webview resolves the same path on save). We assert the
 * observable persisted state — the detected build/triton.exe is recorded as the
 * project's triton_target.
 *
 * NOTE: the host's would-be validation gate is currently dead code (TYPE-1 — it
 * reads `message.execution_mode`, a field the webview never sends), so the save
 * is accepted whether or not the exe exists; CMP-1 still proves the *detection*
 * because the pre-placed exe is the path that gets resolved + persisted, and the
 * MISSING-exe rejection is guarded separately by CMP-4 (xfail TYPE-1).
 */
describe('Triforge computation (CMP-1: source mode detects a built triton.exe)', function () {
  this.timeout(300000);

  after(cleanup);

  it('validates and persists when build_dir contains triton.exe', async () => {
    await resetToWorkbench();
    await withTempWorkspace(async (ctx) => {
      const buildDir = path.join(ctx.projectPath, 'build');
      const tritonExe = path.join(buildDir, 'triton.exe');
      writeFakeExecutable(tritonExe); // stand-in for a real build output

      await reloadWindow();
      await activateProject(ctx.projectName);

      const comp = new ComputationSetup();
      await comp.open();
      try {
        await comp.selectMode('source');
        expect(
          await comp.isSourceConfigVisible(),
          'selecting source mode should reveal the source config block',
        ).to.equal(true);
        await comp.setBuildDir(buildDir);
        await comp.clickOk();
      } finally {
        await comp.leave();
      }

      // The host shows a non-modal "Settings saved." on a valid target.
      await waitForNotification(/Settings saved/i);

      // config.json (compsetup block) reflects the validated source target.
      await VSBrowser.instance.driver.wait(
        async () => {
          const cfg = readConfig(ctx.projectPath);
          return cfg.compsetup && cfg.compsetup.executable_target_mode === 'source';
        },
        30000,
        'config.compsetup.executable_target_mode should persist as "source"',
      );
      const cfg = readConfig(ctx.projectPath);
      expect(cfg.compsetup.build_dir, 'build_dir should persist').to.equal(buildDir);
      expect(
        cfg.compsetup.triton_target,
        'triton_target should resolve to the detected build/triton.exe',
      ).to.match(/triton\.exe$/);
      expect(
        cfg.compsetup.triton_target,
        'triton_target should sit under the build dir',
      ).to.include(buildDir);
    });
  });
});

// ===========================================================================
// CMP-3 (green) — executable mode + an existing exe path validates & saves.
// ===========================================================================
/**
 * Executable mode carries the exe path as `triton_target`. We point it at a
 * dummy executable file we create and save; the host persists
 * `executable_target_mode='executable'` and `triton_target=<that path>`, proving
 * the chosen, existing exe path is accepted and recorded as the project's
 * target. (As with CMP-1 the host's existence-validation gate is dead code
 * today — TYPE-1 — so this asserts the observable persisted exe path; the
 * existence requirement is exercised post-fix via CMP-4's TYPE-1 xfail.)
 */
describe('Triforge computation (CMP-3: executable mode validates an existing exe path)', function () {
  this.timeout(300000);

  after(cleanup);

  it('validates and persists when the executable path exists', async () => {
    await resetToWorkbench();
    await withTempWorkspace(async (ctx) => {
      const exePath = path.join(ctx.projectPath, 'bin', 'triton');
      writeFakeExecutable(exePath);

      await reloadWindow();
      await activateProject(ctx.projectName);

      const comp = new ComputationSetup();
      await comp.open();
      try {
        await comp.selectMode('executable');
        expect(
          await comp.isExecConfigVisible(),
          'selecting executable mode should reveal the executable config block',
        ).to.equal(true);
        await comp.setExecutablePath(exePath);
        await comp.clickOk();
      } finally {
        await comp.leave();
      }

      await waitForNotification(/Settings saved/i);

      await VSBrowser.instance.driver.wait(
        async () => {
          const cfg = readConfig(ctx.projectPath);
          return cfg.compsetup && cfg.compsetup.executable_target_mode === 'executable';
        },
        30000,
        'config.compsetup.executable_target_mode should persist as "executable"',
      );
      const cfg = readConfig(ctx.projectPath);
      expect(
        cfg.compsetup.triton_target,
        'triton_target should persist as the validated exe path',
      ).to.equal(exePath);
      expect(
        cfg.compsetup.is_docker_target,
        'a non-docker target must not be flagged as docker',
      ).to.not.equal(true);
    });
  });
});

// ===========================================================================
// CMP-4 (green) — source mode with NO triton.exe raises a warning.
// ===========================================================================
/**
 * With source mode selected and a build dir that has NO `triton.exe`, the host
 * validation fails and shows a MODAL `showWarningMessage` ("TRITON executable
 * not found … Please build the project") WITHOUT persisting a source target.
 */
describe('Triforge computation (CMP-4: source mode warns when triton.exe is missing)', function () {
  this.timeout(300000);

  after(cleanup);

  it('shows a warning and does not persist a source target', async () => {
    await resetToWorkbench();
    await withTempWorkspace(async (ctx) => {
      // The seeded build/ dir holds only output frames — there is no triton.exe.
      const buildDir = path.join(ctx.projectPath, 'build');
      expect(
        fs.existsSync(path.join(buildDir, 'triton.exe')),
        'precondition: build dir must NOT contain triton.exe',
      ).to.equal(false);

      const before = readConfig(ctx.projectPath);

      await reloadWindow();
      await activateProject(ctx.projectName);

      const comp = new ComputationSetup();
      await comp.open();
      try {
        await comp.selectMode('source');
        await comp.setBuildDir(buildDir);
        await comp.clickOk();
      } finally {
        // Leave the iframe so the workbench-frame warning is reachable.
        await comp.leave();
      }

      // POST-FIX property: a source-mode save with NO `<build_dir>/triton.exe`
      // must be REJECTED — the host raises a "TRITON executable not found … build"
      // warning and does NOT persist the invalid save.
      //
      // TYPE-1 (fixed in T4): the webview posts the selected mode as
      // `executable_target_mode`, but the host validation used to read
      // `message.execution_mode` — a field that is NEVER sent — so `mode` was
      // `undefined`, the source/executable/docker validation branches were all
      // skipped, `isValid` stayed true, and EVERY save succeeded regardless of
      // whether `triton.exe` existed. `saveSettings` now reads
      // `message.executable_target_mode`, so the source branch runs, the
      // missing-exe target is rejected with a warning, and `updateProject` never
      // runs — leaving the project's `compsetup` block byte-identical to `before`.
      //
      // NOTE: the seeded golden project already carries a source-mode `compsetup`
      // (triton_target = `<build>/triton.exe`), so "not persisted" is asserted as
      // "the rejected save left the persisted config UNCHANGED": pre-fix the save
      // was accepted and `updateProject` rewrote the block (dropping it_count /
      // checkpoint_id and overwriting sim_* with the empty-form webview values),
      // so `after.compsetup` would NOT deep-equal `before.compsetup`; post-fix the
      // validation gate returns early and the block is untouched.
      const warningText = await waitForWarning(
        /triton executable not found|build/i,
      );
      expect(
        warningText,
        'warning should explain the triton executable was not found / to build',
      ).to.match(/triton executable not found|build/i);

      // The rejected save did NOT update the project config: the whole compsetup
      // block is unchanged from before the (invalid) save attempt.
      const after = readConfig(ctx.projectPath);
      expect(
        after.compsetup,
        'an invalid (missing-exe) source save must NOT modify the persisted config',
      ).to.deep.equal(before.compsetup);
    });
  });
});

// ===========================================================================
// CMP-2 (green where possible) — docker mode persists image + mode to config.
// ===========================================================================
/**
 * Docker mode carries the image name as `triton_target`; saving persists
 * `executable_target_mode='docker'`, `is_docker_target=true` and
 * `triton_target=<image>` to config. The actual `docker pull` runs via
 * `terminal.sendText` in a VS Code integrated terminal and has NO configurable
 * fake seam (and we must not run real docker), so this asserts ONLY the
 * image-set / mode-persist behaviour; the pull itself is deferred (see
 * DONE_WITH_CONCERNS). (The host's would-be image-non-empty check is dead today
 * — TYPE-1 — but the save succeeds and persists the docker target regardless,
 * which is exactly what we assert.)
 */
describe('Triforge computation (CMP-2: docker mode persists image + mode to config)', function () {
  this.timeout(300000);

  after(cleanup);

  it('persists the docker image name and mode on save', async () => {
    await resetToWorkbench();
    await withTempWorkspace(async (ctx) => {
      const image = 'triton:latest';

      await reloadWindow();
      await activateProject(ctx.projectName);

      const comp = new ComputationSetup();
      await comp.open();
      try {
        await comp.selectMode('docker');
        expect(
          await comp.isDockerConfigVisible(),
          'selecting docker mode should reveal the docker config block',
        ).to.equal(true);
        await comp.setDockerImage(image);
        await comp.clickOk();
      } finally {
        await comp.leave();
      }

      await waitForNotification(/Settings saved/i);

      await VSBrowser.instance.driver.wait(
        async () => {
          const cfg = readConfig(ctx.projectPath);
          return cfg.compsetup && cfg.compsetup.executable_target_mode === 'docker';
        },
        30000,
        'config.compsetup.executable_target_mode should persist as "docker"',
      );
      const cfg = readConfig(ctx.projectPath);
      expect(
        cfg.compsetup.triton_target,
        'the docker image name should persist as triton_target',
      ).to.equal(image);
      expect(
        cfg.compsetup.is_docker_target,
        'docker mode should flag is_docker_target true',
      ).to.equal(true);
    });
  });
});

// ===========================================================================
// CMP-5 (xfail SEC-6) — a metacharacter image must not be shell-interpolated.
// ===========================================================================
/**
 * SEC-6: `ComputationSetupEditor._handleDownloadDocker` builds the pull command
 * by string interpolation — `terminal.sendText(\`docker pull ${image}\`)` — with
 * an UNVALIDATED, UNQUOTED image name. A payload containing shell metacharacters
 * (here `$(touch <marker>)`) is therefore evaluated by the terminal's shell, so
 * the side-effect `touch` runs and creates a sentinel marker file — proof of
 * shell injection.
 *
 * POST-FIX (SEC-6: validate against `^[A-Za-z0-9._/:@-]+$` and/or pass the image
 * via argv / quoting) the payload would be rejected or treated as inert text, so
 * the injected command NEVER runs and the marker is ABSENT. We wrap that
 * post-fix property ("no marker => no injection") in `xfail('SEC-6', …)`: today
 * the marker appears, the absence assertion throws, and the xfail passes; once
 * SEC-6 lands the marker stays absent, the assertion holds, and `xfail` throws
 * loudly to demand the wrapper be removed.
 *
 * NOTE: EXE-7 maps to the same SEC-6 finding on the ExecutionSetup `run_command`
 * spawn path; this CMP-5 guards the ComputationSetup docker-pull surface.
 */
describe('Triforge computation (CMP-5: docker image with shell metacharacters must not inject — SEC-6)', function () {
  this.timeout(300000);

  let marker: string;

  before(() => {
    marker = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'triforge-e2e-cmp5-')),
      'sec6-injection-marker',
    );
  });

  after(async () => {
    try {
      fs.rmSync(path.dirname(marker), { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    // Dispose any terminal the pull opened so it does not leak across suites.
    try {
      await new Workbench().executeCommand('Terminal: Kill All Terminals');
    } catch {
      /* best-effort */
    }
    await cleanup();
  });

  it('does not execute injected shell from a metacharacter docker image (post-fix)', async () => {
    await resetToWorkbench();
    await withTempWorkspace(async (ctx) => {
      await reloadWindow();
      await activateProject(ctx.projectName);

      // A payload whose command-substitution `$(touch <marker>)` the shell
      // evaluates as it parses `docker pull $(touch <marker>)` — so the marker
      // is created immediately, independent of whether `docker` exists.
      const payload = `$(touch ${marker})`;
      expect(
        fs.existsSync(marker),
        'precondition: the injection marker must not yet exist',
      ).to.equal(false);

      const comp = new ComputationSetup();
      await comp.open();
      try {
        await comp.selectMode('docker');
        await comp.setDockerImage(payload);
        // Click Download/Pull (NOT Ok): the pull path runs the interpolated
        // command in a terminal with no validation gate.
        await comp.clickDownloadDocker();
      } finally {
        await comp.leave();
      }

      const driver = VSBrowser.instance.driver;
      // Give the (now-fixed) validation gate time to reject the payload — if a
      // regression let it through the marker would appear within this window.
      await driver
        .wait(async () => fs.existsSync(marker), 30000)
        .catch(() => undefined);
      // POST-FIX property: no shell injection => the marker was NEVER created.
      expect(
        fs.existsSync(marker),
        'SEC-6: the docker image must be passed via argv/quoted, not interpolated ' +
          'into a shell string — no side-effect command should execute',
      ).to.equal(false);
    });
  });
});
