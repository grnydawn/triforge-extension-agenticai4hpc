import { expect } from 'chai';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { By, VSBrowser, Workbench } from 'vscode-extension-tester';
import { ExecutionSetup } from '../../pageobjects/ExecutionSetup.ts';
import { MapView } from '../../pageobjects/MapView.ts';
import { ProjectsView } from '../../pageobjects/ProjectsView.ts';
import { closeAllEditors, reloadWindow, resetToWorkbench } from '../../pageobjects/workbench.ts';
import { withTempWorkspace } from '../../helpers/seed.ts';

/**
 * Execution-setup E2E suite (EXE-1..7).
 *
 * Each scenario seeds a ready golden project with `{ executableTarget: true }`
 * (so the computation target validates in executable mode and the Execution
 * Setup open-gate passes), reloads the window (the extension only loads its
 * project registry at `activate()`), activates the project, then drives the
 * REAL Execution Setup webview (`triforge.openExecutionSetup`) via the
 * {@link ExecutionSetup} page object.
 *
 * Green:
 *  - EXE-1: clicking Run writes `triton_execution.cfg` to the run dir with the
 *    project's key=value lines AND OMITS blank-value entries (no `const_mann=`,
 *    no line ending in `=`). Asserted against the on-disk file.
 *  - EXE-2: interactive run via the wired `fake-triton.sh` streams the canned
 *    log into the output area AND copies the golden output files into the run
 *    dir.
 *  - EXE-3: batch run via the wired `fake-sbatch.sh` writes `triton_batch.sh`
 *    into the run dir AND the submit output contains "Submitted batch job 1".
 *
 * Green (post-fix property now holds — PERF-4 fixed in T3):
 *  - EXE-4 (PERF-4): closing the panel mid-run kills the child + clears the
 *    throttle timer + leaves no orphan. `dispose()` now kills the spawned child's
 *    process group, so no orphan survives.
 *  - EXE-6 (PERF-4): starting a run while one is active is blocked/rejected. A
 *    run-in-progress guard now rejects the second run, so no new child spawns.
 *
 * xfail (post-fix property guarded; throws today so xfail PASSES):
 *  - EXE-7 (SEC-6): a `run_command` carrying shell metacharacters is
 *    quoted/argv'd so a side-effect payload does NOT run. Today
 *    `cp.spawn(runCommand, { shell: true })` evaluates the whole string, so the
 *    injected `touch <marker>` runs -> the "marker absent" assertion throws.
 *
 * Golden flagship (GREEN end-to-end):
 *  - EXE-8: composes the proven EXE-2 interactive-run path with the proven MAP
 *    render + animate path. It runs the seeded golden project (interactive),
 *    asserts the 18 on-disk depth FILES appear in the run dir, then opens the Map
 *    via the Animate affordance and asserts the DEM renders (a real legend range)
 *    and the animation loads exactly 9 stitched frames. This is the exe-only
 *    flagship; the docker parity assertion is parked (GOLDEN_RUN.md §4).
 */

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

/** Make a fresh, empty run directory under the OS temp dir. */
function freshRunDir(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `triforge-e2e-${tag}-`));
}

/** Number of live processes whose full command line matches `pattern`. */
function processCount(pattern: string): number {
  try {
    // List matching pids WITH their command line, then exclude the measurement
    // pipeline itself: `pgrep -f "<pattern>"` is run via `/bin/sh -c`, and both
    // that shell wrapper and the `pgrep` process carry the pattern string in
    // their own argv, so a naive `pgrep -fc` self-counts (a non-zero floor even
    // with no real child). We count only genuine matches (the spawned run shell
    // and its `sleep`/`triton` grandchild), excluding any line that is the
    // pgrep/grep invocation.
    const out = cp
      .execSync(`pgrep -af ${JSON.stringify(pattern)} || true`, { encoding: 'utf8' })
      .trim();
    if (!out) return 0;
    const lines = out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      // Drop the measurement pipeline's own processes (the `sh -c pgrep ...`
      // wrapper and the `pgrep` itself).
      .filter((l) => !/\bpgrep\b/.test(l));
    return lines.length;
  } catch {
    return 0;
  }
}

/** Best-effort terminate every process whose command line matches `pattern`. */
function killMatching(pattern: string): void {
  try {
    cp.execSync(`pkill -f ${JSON.stringify(pattern)} || true`);
  } catch {
    /* best-effort */
  }
}

/**
 * Dismiss every open modal dialog (`.monaco-dialog-box`) by clicking OK/Close.
 *
 * A successful interactive/batch run ends in `_updateOutputPaths`, which raises a
 * MODAL `showWarningMessage("Simulation finished, but no generated output folder
 * was found.", { modal: true })` whenever the run dir's output does not match the
 * `<runDir>/output/{bin,asc,gtiff}` layout the validator expects (the fake copies
 * the golden frames flat into the run dir, not under `output/`). That modal sits
 * at the workbench frame and blocks the NEXT panel's `switchToFrame`, so we must
 * clear it. Must run at the top (workbench) frame.
 */
async function dismissModals(timeoutMs = 15000): Promise<void> {
  const driver = VSBrowser.instance.driver;
  await driver.switchTo().defaultContent().catch(() => undefined);
  const deadline = Date.now() + timeoutMs;
  do {
    const dialogs = await driver.findElements(By.className('monaco-dialog-box')).catch(() => []);
    if (dialogs.length === 0) return;
    for (const dialog of dialogs) {
      const buttons = await dialog.findElements(By.className('monaco-text-button')).catch(() => []);
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

/**
 * After a run completes the host fires the terminal "no generated output folder"
 * MODAL asynchronously (in the child's `close` handler, several seconds after
 * spawn). Wait for and dismiss it so it cannot leak into the next test's frame
 * switch. Best-effort: if no modal appears in the window, returns quietly.
 */
async function settleRunModal(timeoutMs = 60000): Promise<void> {
  const driver = VSBrowser.instance.driver;
  await driver.switchTo().defaultContent().catch(() => undefined);
  await driver
    .wait(
      async () => (await driver.findElements(By.className('monaco-dialog-box')).catch(() => [])).length > 0,
      timeoutMs,
    )
    .catch(() => undefined);
  await dismissModals();
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
 * `triforge.openProject`, which makes it the `activeProject` the Execution Setup
 * reads), then close the MapEditor it opens so the later webview-frame
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

// ===========================================================================
// EXE-1 — config generation: written to run dir, blank-value entries omitted.
// ===========================================================================
describe('Triforge execution (EXE-1: triton_execution.cfg is generated with blank entries omitted)', function () {
  this.timeout(300000);

  after(cleanup);

  it('writes key=value lines and omits empty-value entries (e.g. const_mann=)', async () => {
    await resetToWorkbench();
    await dismissModals();
    await withTempWorkspace(
      async (ctx) => {
        await reloadWindow();
        await activateProject(ctx.projectName);

        const runDir = freshRunDir('exe1');
        const cfgPath = path.join(runDir, 'triton_execution.cfg');
        try {
          const exe = new ExecutionSetup();
          const opened = await exe.open();
          expect(opened, 'Execution Setup webview should open for a valid target').to.equal(true);
          try {
            await exe.selectExecutionType('interactive');
            await exe.setRunDirectory(runDir);
            await exe.clickRun();
          } finally {
            await exe.leave();
          }

          // The host writes the cfg before spawning the run; await it on disk.
          await VSBrowser.instance.driver.wait(
            async () => fs.existsSync(cfgPath),
            60000,
            `triton_execution.cfg was never written to ${runDir}`,
          );

          const cfg = fs.readFileSync(cfgPath, 'utf8');
          const lines = cfg.split(/\r?\n/);

          // Non-blank, non-comment config lines.
          const entryLines = lines.filter((l) => l.trim() && !l.trim().startsWith('#'));

          // A representative non-empty key from the template default survives.
          expect(entryLines, 'cfg should keep non-empty defaults like courant=0.5').to.include(
            'courant=0.5',
          );
          // A value resolved from the project (the DEM path) is written through.
          const demLine = entryLines.find((l) => l.startsWith('dem_filename='));
          expect(demLine, 'cfg should carry the resolved dem_filename').to.be.a('string');
          expect((demLine as string).length, 'dem_filename must have a non-empty value').to.be.greaterThan(
            'dem_filename='.length,
          );

          // Blank-value entries are OMITTED entirely.
          expect(
            entryLines.some((l) => l.startsWith('const_mann=')),
            'const_mann has no value and must be omitted (no const_mann= line)',
          ).to.equal(false);
          // No surviving entry line ends in "=" (i.e. nothing has an empty value).
          const danglers = entryLines.filter((l) => /=\s*$/.test(l));
          expect(
            danglers,
            `no entry should have an empty value; found dangling: ${JSON.stringify(danglers)}`,
          ).to.deep.equal([]);

          // The seeded run continues in the background and fires the terminal
          // "no output folder" modal — settle/dismiss it so it cannot block the
          // next test's frame switch.
          await settleRunModal();
        } finally {
          fs.rmSync(runDir, { recursive: true, force: true });
        }
      },
      { executableTarget: true },
    );
  });
});

// ===========================================================================
// EXE-2 — interactive run streams the fake log + copies golden output in.
// ===========================================================================
describe('Triforge execution (EXE-2: interactive run streams the fake log and produces output)', function () {
  this.timeout(300000);

  after(cleanup);

  it('streams fake-triton.sh canned log and the golden output appears in the run dir', async () => {
    await resetToWorkbench();
    await dismissModals();
    await withTempWorkspace(
      async (ctx) => {
        await reloadWindow();
        await activateProject(ctx.projectName);

        const runDir = freshRunDir('exe2');
        try {
          const exe = new ExecutionSetup();
          const opened = await exe.open();
          expect(opened, 'Execution Setup webview should open for a valid target').to.equal(true);
          try {
            await exe.selectExecutionType('interactive');
            await exe.setRunDirectory(runDir);
            // Leave the run_command field as the seeded `bash <fake-triton.sh>`.
            await exe.clickRun();

            // The fake prints a canned startup line, then a completion line.
            await exe.waitForLog('TRITON v0.0-fake starting up', 120000);
            const log = await exe.waitForLog('Simulation finished', 120000);
            expect(log).to.include('Beginning simulation');
          } finally {
            await exe.leave();
          }

          // The fake copies $GOLDEN_OUTPUT_DIR contents into the run dir.
          await VSBrowser.instance.driver.wait(
            async () => fs.existsSync(path.join(runDir, 'asc')),
            120000,
            `golden output (asc/) never appeared in the run dir ${runDir}`,
          );
          const ascFiles = fs.readdirSync(path.join(runDir, 'asc'));
          expect(
            ascFiles.some((f) => f.endsWith('.out')),
            'golden .out frames should be copied into the run dir',
          ).to.equal(true);

          // Settle/dismiss the terminal "no output folder" modal the run fires.
          await settleRunModal();
        } finally {
          fs.rmSync(runDir, { recursive: true, force: true });
        }
      },
      { executableTarget: true },
    );
  });
});

// ===========================================================================
// EXE-3 — batch run writes triton_batch.sh and the submit output is captured.
// ===========================================================================
describe('Triforge execution (EXE-3: batch run writes triton_batch.sh and submits)', function () {
  this.timeout(300000);

  after(cleanup);

  it('writes triton_batch.sh and the submit output contains "Submitted batch job 1"', async () => {
    await resetToWorkbench();
    await dismissModals();
    await withTempWorkspace(
      async (ctx) => {
        await reloadWindow();
        await activateProject(ctx.projectName);

        const fakeSbatch = path.resolve(process.cwd(), 'test', 'e2e', 'fakes', 'fake-sbatch.sh');
        const runDir = freshRunDir('exe3');
        const batchScript = path.join(runDir, 'triton_batch.sh');
        try {
          const exe = new ExecutionSetup();
          const opened = await exe.open();
          expect(opened, 'Execution Setup webview should open for a valid target').to.equal(true);
          try {
            await exe.selectExecutionType('batch');
            await exe.setRunDirectory(runDir);
            // In batch mode the run-command field carries the SUBMIT command.
            await exe.setRunCommand(`bash ${fakeSbatch}`);
            await exe.clickRun();

            // The fake submitter prints the canned SLURM acknowledgement.
            const log = await exe.waitForLog('Submitted batch job 1', 120000);
            expect(log).to.include('Submitted batch job 1');
          } finally {
            await exe.leave();
          }

          // The batch script is written into the run dir before submission.
          await VSBrowser.instance.driver.wait(
            async () => fs.existsSync(batchScript),
            120000,
            `triton_batch.sh was never written to ${runDir}`,
          );
          const script = fs.readFileSync(batchScript, 'utf8');
          expect(script, 'batch script should carry the step launch command').to.match(/srun|triton/);

          // Settle/dismiss the terminal "no output folder" modal the run fires.
          await settleRunModal();
        } finally {
          fs.rmSync(runDir, { recursive: true, force: true });
        }
      },
      { executableTarget: true },
    );
  });
});

// ===========================================================================
// EXE-4 — close panel mid-run; child must be killed, no orphan (xfail PERF-4).
// ===========================================================================
describe('Triforge execution (EXE-4: closing the panel mid-run kills the child — PERF-4)', function () {
  this.timeout(300000);

  // Unique sentinel so we can find/kill exactly this run's child.
  const sentinel = `7651${Math.floor(Math.random() * 9000 + 1000)}`;
  const sleepPattern = `sleep ${sentinel}`;

  after(async () => {
    killMatching(sleepPattern); // never leak the long-running orphan
    await cleanup();
  });

  it('child process is killed when the panel is disposed mid-run (post-fix)', async () => {
    await resetToWorkbench();
    await dismissModals();
    await withTempWorkspace(
      async (ctx) => {
        await reloadWindow();
        await activateProject(ctx.projectName);

        const runDir = freshRunDir('exe4');
        try {
          const exe = new ExecutionSetup();
          const opened = await exe.open();
          expect(opened, 'Execution Setup webview should open for a valid target').to.equal(true);
          await exe.selectExecutionType('interactive');
          await exe.setRunDirectory(runDir);
          // A long-running child uniquely identifiable on the process table.
          await exe.setRunCommand(`sleep ${sentinel}`);
          await exe.clickRun();
          await exe.leave();

          // Wait until the child is actually live (the host prepends `sleep 2;`
          // and adds a 2s JS delay before spawning, so give it room).
          const driver = VSBrowser.instance.driver;
          await driver.wait(
            async () => processCount(sleepPattern) > 0,
            60000,
            'the long-running run child never appeared on the process table',
          );
          expect(
            processCount(sleepPattern),
            'precondition: the run child is alive before we close the panel',
          ).to.be.greaterThan(0);

          // Close the panel mid-run (disposes the ExecutionSetupEditor).
          await closeAllEditors();

          // POST-FIX property: dispose() kills the child, so it disappears.
          await driver.wait(async () => processCount(sleepPattern) === 0, 20000).catch(() => undefined);
          expect(
            processCount(sleepPattern),
            'PERF-4: closing the panel must kill the spawned child (no orphan left)',
          ).to.equal(0);
        } finally {
          killMatching(sleepPattern);
          fs.rmSync(runDir, { recursive: true, force: true });
        }
      },
      { executableTarget: true },
    );
  });
});

// ===========================================================================
// EXE-6 — second run while one is active must be blocked (xfail PERF-4).
// ===========================================================================
describe('Triforge execution (EXE-6: a second run while one is active must be blocked — PERF-4)', function () {
  this.timeout(300000);

  const sentinel = `7652${Math.floor(Math.random() * 9000 + 1000)}`;
  const sleepPattern = `sleep ${sentinel}`;

  after(async () => {
    killMatching(sleepPattern);
    await cleanup();
  });

  it('starting a second run does not spawn another child (post-fix)', async () => {
    await resetToWorkbench();
    await dismissModals();
    await withTempWorkspace(
      async (ctx) => {
        await reloadWindow();
        await activateProject(ctx.projectName);

        const runDir = freshRunDir('exe6');
        try {
          const exe = new ExecutionSetup();
          const opened = await exe.open();
          expect(opened, 'Execution Setup webview should open for a valid target').to.equal(true);
          const driver = VSBrowser.instance.driver;
          try {
            await exe.selectExecutionType('interactive');
            await exe.setRunDirectory(runDir);
            await exe.setRunCommand(`sleep ${sentinel}`);

            // Start the first run and wait until its child is live.
            await exe.clickRun();
            await driver.wait(
              async () => processCount(sleepPattern) > 0,
              60000,
              'the first run child never appeared on the process table',
            );
            // Let the count settle (sh wrapper + the sleep both match).
            await driver.sleep(4000);
            const afterFirst = processCount(sleepPattern);
            expect(afterFirst, 'precondition: the first run is active').to.be.greaterThan(0);

            // Start a SECOND run while the first is still active.
            await exe.clickRun();
            // Give the second run time to spawn (if it is not blocked).
            await driver.sleep(8000);
            const afterSecond = processCount(sleepPattern);

            // POST-FIX property: the second run is blocked, so no new child is
            // spawned — the live-child count does not grow beyond the first run.
            expect(
              afterSecond,
              'PERF-4: a second run must be rejected while one is active ' +
                `(saw ${afterSecond} children, up from ${afterFirst})`,
            ).to.be.at.most(afterFirst);
          } finally {
            await exe.leave();
          }
        } finally {
          killMatching(sleepPattern);
          fs.rmSync(runDir, { recursive: true, force: true });
        }
      },
      { executableTarget: true },
    );
  });
});

// ===========================================================================
// EXE-5 — large log output: persisted buffer must be capped (MEM-1, fixed).
// ===========================================================================
describe('Triforge execution (EXE-5: persisted log buffer must be capped — MEM-1)', function () {
  this.timeout(300000);

  // Cap the reopened-panel replay should respect post-fix (bytes).
  const REPLAY_CAP = 50000;
  // Emit well above the cap but below the webview client's ~500KB single-append
  // truncation, so the reopened DOM faithfully reflects the host buffer size.
  const EMIT_BYTES = 200000;

  after(cleanup);

  it('reopening the panel does not replay the full unbounded log (post-fix)', async () => {
    await resetToWorkbench();
    await dismissModals();
    await withTempWorkspace(
      async (ctx) => {
        await reloadWindow();
        await activateProject(ctx.projectName);

        const runDir = freshRunDir('exe5');
        try {
          // First run: emit a large block of output that the host accumulates
          // into its static `_executionLogs` buffer.
          const exe = new ExecutionSetup();
          const opened = await exe.open();
          expect(opened, 'Execution Setup webview should open for a valid target').to.equal(true);
          await exe.selectExecutionType('interactive');
          await exe.setRunDirectory(runDir);
          // Print EMIT_BYTES of a single repeated char, then a completion marker.
          await exe.setRunCommand(
            `head -c ${EMIT_BYTES} /dev/zero | tr '\\0' 'x'; echo; echo EXE5_RUN_DONE`,
          );
          await exe.clickRun();
          await exe.waitForLog('EXE5_RUN_DONE', 120000);
          await exe.leave();

          // The run completes (exit 0) and fires the terminal "no output folder"
          // modal; dismiss it so it cannot block the reopen's frame switch.
          await settleRunModal();

          // Close the panel so the next open builds a NEW panel that replays the
          // persisted host buffer via `initialLogs`.
          await closeAllEditors();
          await dismissModals();

          // Reopen — the host serializes `_executionLogs` into the new panel and
          // the client replays it into `#executionLog` on init.
          const exe2 = new ExecutionSetup();
          const reopened = await exe2.open();
          expect(reopened, 'Execution Setup should reopen').to.equal(true);
          let replayedLen = 0;
          try {
            // Allow the init replay to land.
            await VSBrowser.instance.driver
              .wait(async () => (await exe2.getLogText()).length > 0, 30000)
              .catch(() => undefined);
            replayedLen = (await exe2.getLogText()).length;
          } finally {
            await exe2.leave();
          }

          // POST-FIX property: the persisted buffer is capped to a rolling tail,
          // so reopening replays at most REPLAY_CAP bytes (not the full run).
          expect(
            replayedLen,
            `MEM-1: reopening must not replay the unbounded log ` +
              `(replayed ${replayedLen} bytes; cap ${REPLAY_CAP})`,
          ).to.be.at.most(REPLAY_CAP);
        } finally {
          fs.rmSync(runDir, { recursive: true, force: true });
        }
      },
      { executableTarget: true },
    );
  });
});

// ===========================================================================
// EXE-7 — run_command shell metacharacters must not inject (xfail SEC-6).
// ===========================================================================
describe('Triforge execution (EXE-7: run_command shell metacharacters must not inject — SEC-6)', function () {
  this.timeout(300000);

  let marker: string;

  before(() => {
    marker = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'triforge-e2e-exe7-')),
      'sec6-injection-marker',
    );
  });

  after(async () => {
    try {
      fs.rmSync(path.dirname(marker), { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    await cleanup();
  });

  it('does not execute injected shell from a metacharacter run_command (post-fix)', async () => {
    await resetToWorkbench();
    await dismissModals();
    await withTempWorkspace(
      async (ctx) => {
        await reloadWindow();
        await activateProject(ctx.projectName);

        const runDir = freshRunDir('exe7');
        try {
          expect(
            fs.existsSync(marker),
            'precondition: the injection marker must not yet exist',
          ).to.equal(false);

          const exe = new ExecutionSetup();
          const opened = await exe.open();
          expect(opened, 'Execution Setup webview should open for a valid target').to.equal(true);
          try {
            await exe.selectExecutionType('interactive');
            await exe.setRunDirectory(runDir);
            // A payload whose command-substitution `$(touch <marker>)` the shell
            // evaluates if `run_command` is interpolated into `/bin/sh -c "..."`.
            await exe.setRunCommand(`$(touch ${marker})`);
            await exe.clickRun();
          } finally {
            await exe.leave();
          }

          const driver = VSBrowser.instance.driver;
          // Give the (now-fixed) shell:false spawn time to run — if a regression
          // re-introduced shell interpretation the marker would appear here.
          await driver.wait(async () => fs.existsSync(marker), 60000).catch(() => undefined);
          // POST-FIX property: run_command passed via argv/quoting => no marker.
          expect(
            fs.existsSync(marker),
            'SEC-6: run_command must be spawned via argv/quoted (shell:false), ' +
              'not interpolated into a shell string — no side-effect should run',
          ).to.equal(false);
        } finally {
          fs.rmSync(runDir, { recursive: true, force: true });
        }
      },
      { executableTarget: true },
    );
  });
});

// ===========================================================================
// EXE-8 — golden flagship (GREEN): configure -> run -> outputs -> map renders
//         -> animates (exe-only). Composes the proven EXE-2 interactive-run path
//         with the proven MAP render + animate path.
// ===========================================================================
/**
 * The golden flagship end-to-end. It reuses, in one scenario:
 *  - EXE-2's interactive-run mechanism (seed `{ executableTarget: true }` so the
 *    open-gate passes; `run_command` wired by the seed to `fake-triton.sh`, which
 *    copies `$GOLDEN_OUTPUT_DIR` into the run cwd), and
 *  - the MAP suite's Animate affordance + MapView page object to reveal the
 *    MapEditor for the active project, render its DEM, and stream the animation.
 *
 * Frame-count facts are DERIVED from `baseline.json` (not hardcoded):
 *  - On-disk depth FILE count = `keptSteps.length × partitions.length` = 18
 *    (steps {1,6,12,18,24,30,36,42,48} × partitions {0,1}), which equals
 *    `baseline.frameCount`. We assert this is what the run drops on disk.
 *  - ANIMATION frame count = `keptSteps.length` = 9. `triforge.loadAnimation`
 *    (src/commands/animation.ts) groups the ASC depth files by their
 *    `H_<step>_<partition>` name via the `^(.*)_(\d+)_(\d+)\.[a-z0-9]+$` regex —
 *    the key is `baseName_step`, so the two partition files per step STITCH
 *    (`AsciiParser.stitchFiles`) into ONE animation frame. So 18 files -> 9
 *    distinct-step frames; we assert the animation denominator against 9, NOT 18.
 *
 * The docker parity assertion is PARKED (GOLDEN_RUN.md §4): EXE-8 is exe-only.
 *
 * CONCERN (tree-presence vs on-disk-presence): the strongest faithful
 * "outputs present" observable is the on-disk run-dir frame set (exactly what
 * EXE-2 proves). The Simulations Output > Ascii tree renders the project's
 * CONFIGURED output manifest (`config.json` `output.ascii`, which lists the full
 * 96-step H/QX/QY simulation, not just the committed 18-file subset) and points
 * at `build/output/asc`, NOT the fresh run dir — so the tree node count is not
 * the 18 produced files. We therefore assert the run-produced files on disk (18)
 * and let the proven Animate path (which loads only the H frames that actually
 * exist + sniff as ascii) deliver the 9 stitched animation frames.
 */
describe('Triforge execution (EXE-8: golden flagship — configure, run, outputs, map renders, animates)', function () {
  this.timeout(300000);

  // baseline.json is the on-disk source of truth for the golden fixture's frame
  // facts; derive the magic numbers from it rather than hardcoding 18 / 9.
  const baseline = JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), 'test', 'e2e', 'fixtures', 'golden', 'exe', 'baseline.json'),
      'utf8',
    ),
  );
  /** On-disk depth FILE count = kept steps × partitions = 18 (== baseline.frameCount). */
  const DEPTH_FILE_COUNT: number = baseline.keptSteps.length * baseline.partitions.length;
  /** Distinct-step ANIMATION frame count after stitching the two partitions/step = 9. */
  const ANIM_FRAME_COUNT: number = baseline.keptSteps.length;

  after(cleanup);

  it('runs interactively, drops the 18 depth frames, renders the DEM, and animates 9 stitched frames', async () => {
    await resetToWorkbench();
    await dismissModals();
    await withTempWorkspace(
      async (ctx) => {
        await reloadWindow();
        await activateProject(ctx.projectName);

        const runDir = freshRunDir('exe8');
        try {
          // --- (1)+(2): configure + interactive run (the proven EXE-2 path) ----
          const exe = new ExecutionSetup();
          const opened = await exe.open();
          expect(opened, 'Execution Setup webview should open for a valid target').to.equal(true);
          try {
            await exe.selectExecutionType('interactive');
            await exe.setRunDirectory(runDir);
            // Leave the run_command as the seeded `bash <fake-triton.sh>` so the
            // run writes triton_execution.cfg, spawns the fake, and the fake
            // copies $GOLDEN_OUTPUT_DIR into the run cwd.
            await exe.clickRun();

            // The fake streams its canned startup + completion lines.
            await exe.waitForLog('TRITON v0.0-fake starting up', 120000);
            const log = await exe.waitForLog('Simulation finished', 120000);
            expect(log).to.include('Beginning simulation');
          } finally {
            await exe.leave();
          }

          // --- (2) outputs-present: the run drops the depth frames on disk -----
          // The fake copies the golden output flat into the run dir (-> asc/),
          // so the depth frames land at <runDir>/asc/*.out. Assert the FILE count
          // (18 = baseline.frameCount), the strongest faithful "outputs present"
          // observable (see the suite CONCERN on tree-vs-disk presence).
          const ascDir = path.join(runDir, 'asc');
          await VSBrowser.instance.driver.wait(
            async () => fs.existsSync(ascDir),
            120000,
            `golden output (asc/) never appeared in the run dir ${runDir}`,
          );
          await VSBrowser.instance.driver.wait(
            async () =>
              fs.readdirSync(ascDir).filter((f) => /^H_\d+_\d+\.out$/.test(f)).length ===
              DEPTH_FILE_COUNT,
            120000,
            `the run should drop ${DEPTH_FILE_COUNT} H_*.out depth frames into ${ascDir}`,
          );
          const depthFiles = fs.readdirSync(ascDir).filter((f) => /^H_\d+_\d+\.out$/.test(f));
          expect(
            depthFiles.length,
            `the interactive run should produce ${DEPTH_FILE_COUNT} depth FILES ` +
              `(keptSteps × partitions, == baseline.frameCount ${baseline.frameCount})`,
          ).to.equal(DEPTH_FILE_COUNT);
          expect(
            baseline.frameCount,
            'sanity: baseline.frameCount is the on-disk FILE count',
          ).to.equal(DEPTH_FILE_COUNT);

          // Settle/dismiss the terminal "no output folder" modal the run fires,
          // then leave a clean editor area before opening the map.
          await settleRunModal();
          await closeAllEditors();
          await dismissModals();

          // --- (3) open the Map via the Animate affordance; DEM renders --------
          const map = new MapView();
          await map.openViaAnimate('Ascii');
          try {
            const driver = VSBrowser.instance.driver;

            // The DEM control pane becomes visible and its legend canvas is drawn.
            await driver.wait(
              async () => map.isDemPaneVisible(),
              60000,
              '#pane-dem should become visible once the DEM renders',
            );
            expect(
              await map.demLegendCanvasDrawn(),
              '#dem-legend-canvas should be painted with the colormap gradient',
            ).to.be.true;

            // The legend min/max inputs reflect a REAL (non-empty) range, not
            // "Auto": MapController.updateInputIfAuto writes value.toFixed(2) of
            // the loaded DEM data min/max once it renders.
            await driver.wait(
              async () => {
                const { max } = await map.demLegendRange();
                return /^-?\d/.test(max.trim());
              },
              60000,
              'the DEM legend max input should reflect the loaded data range (not "Auto")',
            );
            const range = await map.demLegendRange();
            const minNum = parseFloat(range.min);
            const maxNum = parseFloat(range.max);
            expect(maxNum, 'legend max should be a finite number').to.be.a('number').and.not.NaN;
            expect(
              maxNum,
              'legend range should be non-empty (max strictly above min)',
            ).to.be.greaterThan(minNum);

            // --- (4) animation loads; frame count === stitched step count (9) --
            // loadAnimation groups the on-disk H_<step>_<partition>.out files by
            // step and stitches the two partitions into one frame (see
            // src/commands/animation.ts: the `^(.*)_(\d+)_(\d+)` regex keys on
            // baseName_step), so 18 files -> 9 frames. Assert 9, NOT 18.
            const total = await map.waitForAnimationLoaded(180000);
            expect(
              total,
              `animation frame count should equal the stitched step count ` +
                `(${ANIM_FRAME_COUNT} = keptSteps.length), not the ${DEPTH_FILE_COUNT} ` +
                `on-disk depth files (two partitions per step are stitched into one frame)`,
            ).to.equal(ANIM_FRAME_COUNT);
            expect(
              await map.frameCount(),
              "the controller's animationFrames.length should match the label denominator",
            ).to.equal(ANIM_FRAME_COUNT);
          } finally {
            await map.detach();
          }
        } finally {
          fs.rmSync(runDir, { recursive: true, force: true });
        }
      },
      { executableTarget: true },
    );
  });
});
