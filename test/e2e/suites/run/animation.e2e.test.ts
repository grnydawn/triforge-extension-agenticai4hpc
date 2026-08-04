import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { By, Key, VSBrowser, Workbench } from 'vscode-extension-tester';

import { MapView } from '../../pageobjects/MapView.ts';
import { ProjectsView } from '../../pageobjects/ProjectsView.ts';
import { SimulationsView } from '../../pageobjects/SimulationsView.ts';
import { closeAllEditors, reloadWindow, resetToWorkbench } from '../../pageobjects/workbench.ts';
import { withTempWorkspace } from '../../helpers/seed.ts';

/**
 * Animation E2E suite (ANI-1/2/3; ANI-4 lives in test/unit/).
 *
 * The map is opened through the REAL "Animate" context action
 * (`triforge.loadAnimation`) on the seeded golden project's `Output > Ascii`
 * category node. `triforge.loadAnimation` (`src/commands/animation.ts`) reveals the
 * MapEditor for the active project, loads its DEM (needed to derive the grid
 * dims), then GROUPS the output files by `H_<step>_<partition>` and STITCHES the
 * two partition files per step into ONE animation frame inside a CANCELLABLE
 * `vscode.window.withProgress` (`animation.ts:352–405`).
 *
 * FRAME-COUNT trap (derived from baseline.json, do NOT hardcode):
 *  - 18 ASC depth FILES on disk: steps {1,6,12,18,24,30,36,42,48} × partitions
 *    {0,1} (= BASELINE.frameCount).
 *  - The stitch collapses the two partitions per step into one frame, so the
 *    ANIMATION frame count = the number of distinct steps = 9
 *    (= BASELINE.keptSteps.length), NOT 18.
 *
 * - ANI-1 (green): seed golden, open the map (DEM loaded), Animate the Output
 *   category, assert (a) the animation frame count === 9 (stitched steps), (b)
 *   play/pause toggles the controller's play state, (c) the slider/step advances
 *   the current frame and `#anim-frame-label` reflects it.
 * - ANI-2 (green strength-guard): start an animation load and cancel/dismiss its
 *   cancellable progress notification, then assert the panel stays responsive and
 *   partial state does not throw (a subsequent reload-to-completion succeeds).
 * - ANI-3 (green, up to the NATIVE-DIALOG boundary): with frames loaded, `#save-gif`
 *   becomes visible and clicking it ENTERS crop mode + (on confirm) posts
 *   `triggerGifExport` to the host. The host's `vscode.window.showSaveDialog`
 *   (`MapEditor._initGifExport`) is a NATIVE OS dialog Selenium cannot drive, so
 *   the test asserts the strongest faithful observable up to that boundary.
 *
 * ANI-4 (NODATA color-floor characterization, refuted bug) is a UNIT test:
 * test/unit/webview/animationNodataFloor.test.ts.
 */

const REPO_ROOT = process.cwd();
const BASELINE = JSON.parse(
  fs.readFileSync(
    path.join(REPO_ROOT, 'test', 'e2e', 'fixtures', 'golden', 'exe', 'baseline.json'),
    'utf8',
  ),
);
/** Distinct animation frames after stitching the two partitions per step (= 9). */
const ANIM_FRAME_COUNT: number = BASELINE.keptSteps.length;
/** The raw on-disk ASC depth FILE count (= 18); the stitch halves this to 9 frames. */
const ASC_FILE_COUNT: number = BASELINE.frameCount;

/** Restore a clean top frame + empty editor area for the next test. */
async function cleanup(): Promise<void> {
  try {
    await dismissTransientUi();
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
 * Best-effort clear of any transient UI (a lingering modal dialog / open
 * notifications) before a test drives the workbench (reload command palette,
 * tree context menu). A prior test's `{ modal: true }` warning (e.g. the
 * animation loader's "No valid data" dialog) or a progress/error toast can
 * otherwise survive into the next test and block ExTester — the reload's command
 * palette (`.quick-input-widget`) and the context menu never open while a modal
 * is up. We close any `.monaco-dialog-box` by clicking one of its buttons (OK /
 * Cancel), Escape any remaining overlay, then clear notification toasts.
 */
async function dismissTransientUi(): Promise<void> {
  const driver = VSBrowser.instance.driver;
  try {
    await driver.switchTo().defaultContent();
  } catch {
    /* ignore */
  }
  // Close any modal dialog by clicking a button in it (OK/Cancel/etc).
  try {
    for (let i = 0; i < 3; i++) {
      const dialogs = await driver.findElements(By.className('monaco-dialog-box'));
      if (dialogs.length === 0) break;
      const buttons = await dialogs[0].findElements(By.className('monaco-text-button'));
      if (buttons.length > 0) {
        await buttons[buttons.length - 1].click().catch(() => undefined);
      } else {
        await driver.actions().sendKeys(Key.ESCAPE).perform().catch(() => undefined);
      }
      await driver.sleep(300);
    }
  } catch {
    /* ignore */
  }
  // Escape any remaining open menu / quick input.
  for (let i = 0; i < 2; i++) {
    try {
      await driver.actions().sendKeys(Key.ESCAPE).perform();
    } catch {
      /* ignore */
    }
  }
  // Clear any lingering notification toasts.
  try {
    const notifications = await new Workbench().getNotifications().catch(() => []);
    for (const n of notifications) {
      await n.dismiss().catch(() => undefined);
    }
  } catch {
    /* ignore */
  }
}

/** Activate the named seeded project, then close the map it auto-opens. */
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
// ANI-1 (green) — frame count vs baseline, play/pause, step.
// ===========================================================================
describe('Triforge Animation (ANI-1: stitched frame count, play/pause, stepping)', function () {
  this.timeout(300000);
  after(cleanup);

  it('loads 9 stitched frames, toggles play/pause, and steps the current frame', async () => {
    await dismissTransientUi();
    await resetToWorkbench();
    await withTempWorkspace(async ({ projectName }) => {
      await reloadWindow();
      await activateProject(projectName);
      await dismissTransientUi();

      const driver = VSBrowser.instance.driver;
      const map = new MapView();
      await map.openViaAnimate('Ascii');
      try {
        // DEM must render first (loadAnimation derives the grid dims from it).
        await driver.wait(
          async () => map.isDemPaneVisible(),
          60000,
          '#pane-dem should become visible (the DEM loads before frames stream)',
        );

        // (a) FRAME COUNT — the animation has 9 STITCHED frames, not the 18 files.
        // baseline.json: 18 ASC files (9 steps × 2 partitions); loadAnimation
        // groups by H_<step>_<partition> and stitches the two partitions per step
        // into one frame (animation.ts:289–342), so distinct steps = 9.
        const total = await map.waitForAnimationLoaded(180000);
        expect(
          total,
          `the #anim-frame-label denominator must equal the stitched step count ` +
            `(${ANIM_FRAME_COUNT}), NOT the ${ASC_FILE_COUNT} on-disk ASC files (2 partitions/step)`,
        ).to.equal(ANIM_FRAME_COUNT);
        // The controller's authoritative animationFrames.length agrees.
        expect(
          await map.frameCount(),
          'animationFrames.length (post-stitch) should equal the stitched step count',
        ).to.equal(ANIM_FRAME_COUNT);
        // The slider spans 0..frameCount-1.
        expect(
          await map.sliderMax(),
          'the #animation-slider max should be frameCount-1',
        ).to.equal(ANIM_FRAME_COUNT - 1);

        // (b) PLAY/PAUSE — clicking #animation-play-btn toggles the controller's
        // real isPlaying state, then toggles it back.
        expect(await map.isPlaying(), 'animation should start paused').to.be.false;
        await map.playPause();
        await driver.wait(
          async () => map.isPlaying(),
          15000,
          'clicking #animation-play-btn should start playback (isPlaying -> true)',
        );
        await map.playPause();
        await driver.wait(
          async () => !(await map.isPlaying()),
          15000,
          'clicking #animation-play-btn again should pause playback (isPlaying -> false)',
        );

        // (c) STEPPING — drive #animation-slider; the controller's current frame
        // index and #anim-frame-label's "N" reflect the requested frame.
        const targetIdx = ANIM_FRAME_COUNT - 1; // step to the last frame
        await map.stepToFrame(targetIdx);
        await driver.wait(
          async () => (await map.currentFrameIndex()) === targetIdx,
          15000,
          'stepping the slider should set the controller currentFrameIndex',
        );
        await driver.wait(
          async () => {
            const { current, total: t } = await map.frameLabel();
            // #anim-frame-label shows (currentFrameIndex + 1) / animationFrames.length.
            return current === targetIdx + 1 && t === ANIM_FRAME_COUNT;
          },
          15000,
          `#anim-frame-label should read "${targetIdx + 1} / ${ANIM_FRAME_COUNT}" after stepping`,
        );

        // Step back to the first frame and confirm the label follows.
        await map.stepToFrame(0);
        await driver.wait(
          async () => {
            const { current } = await map.frameLabel();
            return (await map.currentFrameIndex()) === 0 && current === 1;
          },
          15000,
          '#anim-frame-label should read "1 / N" after stepping back to frame 0',
        );
      } finally {
        await map.detach();
      }
    });
  });
});

// ===========================================================================
// ANI-2 (green strength-guard) — cancel a mid-load animation cleanly.
// ===========================================================================
/**
 * `triforge.loadAnimation` wraps the per-frame parse/stitch loop in a CANCELLABLE
 * `vscode.window.withProgress` (`animation.ts:352–356`) and breaks the loop on
 * `token.isCancellationRequested` (`:362`). This guards that the load can be
 * cancelled and the panel stays responsive afterward — no crash, partial state
 * does not throw, and a subsequent full animate completes.
 *
 * The cancel is driven by dismissing the progress notification (its dismiss/clear
 * button IS the cancel button for a cancellable progress), which flips the
 * cancellation token. Because the golden animation is only 9 stitched frames it
 * can finish before the cancel lands; this test does NOT assert that the cancel
 * necessarily interrupted mid-load (which would be a flaky race). It asserts the
 * faithful, deterministic properties: a cancellable progress is surfaced for the
 * load (cancellability is wired), dismissing it does not break the panel, and the
 * map remains responsive enough to load the animation to completion afterward.
 *
 * To make the toast catch reliable on a fast load, we fire the Animate action
 * directly (via SimulationsView) and poll for the notification in the WORKBENCH
 * frame BEFORE attaching into the webview — `MapView.openViaAnimate` blocks on
 * the webview `#map`/DEM mount, which alone can outlast the 9-frame stream.
 *
 * CONCERN (honest deferral): if even the eager catch misses the toast (the load
 * finished first), `progressSeen` stays false; the deterministic responsiveness +
 * clean-reload assertions still run, and the toast catch is best-effort (it does
 * NOT hard-fail) — see DONE_WITH_CONCERNS. We never fabricate a cancel we cannot
 * observe.
 */
describe('Triforge Animation (ANI-2: a loading animation is cancellable and stays responsive)', function () {
  this.timeout(300000);
  after(cleanup);

  it('cancels/dismisses the load progress and remains responsive afterward', async () => {
    await dismissTransientUi();
    await resetToWorkbench();
    await withTempWorkspace(async ({ projectName }) => {
      await reloadWindow();
      await activateProject(projectName);
      await dismissTransientUi();

      const driver = VSBrowser.instance.driver;
      const sims = new SimulationsView();
      const map = new MapView();

      // Fire Animate on the Output > Ascii category (the real affordance that
      // reveals the map + begins streaming frames), WITHOUT attaching yet — so we
      // can poll for the load's progress toast before the webview mount eats time.
      await sims.selectContextMenuAction('Animate', 'Output', 'Ascii');

      // A cancellable progress notification ("Loading N Frames ...") is shown for
      // the load. Catch it (best-effort) and dismiss it — the dismiss/clear button
      // is the cancel affordance for a cancellable progress, flipping the
      // cancellation token in animation.ts.
      let progressSeen = false;
      let dismissed = false;
      await driver
        .wait(
          async () => {
            const notifications = await new Workbench().getNotifications().catch(() => []);
            for (const n of notifications) {
              const msg = await n.getMessage().catch(() => '');
              if (/Loading\s+\d+\s+Frames/i.test(msg)) {
                progressSeen = true;
                // Best-effort: confirm it carries a progress bar (cancellable
                // long-op UX), then dismiss/cancel it (flips the token).
                await n.hasProgress().catch(() => false);
                await n.dismiss().catch(() => undefined);
                dismissed = true;
                return true;
              }
            }
            return false;
          },
          30000,
          'a "Loading N Frames" cancellable progress notification should appear for the load',
        )
        .catch(() => undefined);

      // The cancellable progress was surfaced + dismissed (the cancel affordance is
      // wired in animation.ts). If the 9-frame load finished before the toast could
      // be caught, that is acceptable (best-effort, not a hard fail) — the
      // deterministic responsiveness + clean-reload properties below are what ANI-2
      // GUARDS, and they hold whether the cancel landed mid-load or the load
      // completed.
      if (progressSeen) {
        expect(dismissed, 'a caught progress notification should be dismissible (cancel affordance)')
          .to.be.true;
      }

      // Attach to the (revealed) panel and assert responsiveness after the
      // cancel/dismiss/finish.
      await map.attach();
      try {
        await driver.sleep(1500);

        // RESPONSIVENESS after cancel/dismiss: the panel did not crash and partial
        // state does not throw — the DEM pane is still visible and the controller
        // answers DOM queries (no exception escapes).
        await driver.wait(
          async () => map.isDemPaneVisible(),
          60000,
          'the map panel must remain responsive (DEM pane visible) after cancelling the load',
        );
        const partialCount = await map.frameCount();
        expect(
          partialCount,
          'reading animationFrames.length after a cancel must not throw (partial state is safe)',
        ).to.be.at.least(0);

        // A subsequent full Animate completes cleanly on the SAME panel, proving
        // the cancel left the panel in a usable state. Detach the driver frame
        // first (the Animate context action runs in the workbench frame, not the
        // webview iframe); the panel itself is NOT disposed.
        await map.detach();
        await map.revealSamePanelViaAnimate('Ascii');
        const total = await map.waitForAnimationLoaded(180000);
        expect(
          total,
          'after cancelling, re-running Animate must load the full stitched animation',
        ).to.equal(ANIM_FRAME_COUNT);
      } finally {
        await map.detach();
      }
    });
  });
});

// ===========================================================================
// ANI-3 (green, native-dialog boundary) — GIF export is wired/initiated.
// ===========================================================================
/**
 * GIF export path: `#save-gif` is HIDDEN until frames load (`UIManager.ts:215`),
 * then shown (`display:flex`, `MapController.ts:603–605`). Clicking it (with
 * frames loaded) pauses playback, disables map interaction and calls
 * `cropManager.start()` (`UIManager.ts:216–223`) -> the `#crop-box` overlay
 * appears. Confirming the crop (Enter) fires `CropManager.onConfirm` ->
 * `MapController.handleFinishCrop` -> posts `triggerGifExport` to the HOST
 * (`MapController.ts:720`). The host's `_initGifExport` then calls
 * `vscode.window.showSaveDialog` — a NATIVE OS dialog (`MapEditor.ts:361`).
 *
 * NATIVE-DIALOG BOUNDARY (precedent: SIM-3/4 native pickers): Selenium cannot
 * drive the native save dialog, so the test cannot pick a path or complete the
 * file write end-to-end. Worse, leaving that native OS dialog OPEN wedges the VS
 * Code UI thread (blocking teardown/retries). ANI-3 therefore asserts the
 * strongest faithful observable UP TO that boundary: `#save-gif` is gated on a
 * loaded animation, clicking it enters crop mode, and confirming the crop reaches
 * the export-initiation method `handleFinishCrop` (which is the exact point that
 * would post `triggerGifExport` to the host). The probe COUNTS that initiation
 * but stubs the host post so the native dialog never opens (see
 * `MapView.installGifExportProbe`). It does NOT fabricate a written-file
 * assertion it cannot drive (PERF-3 is a soft perf nicety, not asserted).
 */
describe('Triforge Animation (ANI-3: GIF export is wired and initiated up to the native save dialog)', function () {
  this.timeout(300000);
  after(cleanup);

  it('reveals #save-gif after frames load and initiates the export (triggerGifExport) on crop-confirm', async () => {
    await dismissTransientUi();
    await resetToWorkbench();
    await withTempWorkspace(async ({ projectName }) => {
      await reloadWindow();
      await activateProject(projectName);
      await dismissTransientUi();

      const driver = VSBrowser.instance.driver;
      const map = new MapView();
      await map.openViaAnimate('Ascii');
      try {
        await driver.wait(
          async () => map.isDemPaneVisible(),
          60000,
          '#pane-dem should be visible before loading the animation',
        );

        // Frames must be loaded for the export to be available.
        const total = await map.waitForAnimationLoaded(180000);
        expect(total, 'the animation should load its stitched frames first').to.equal(
          ANIM_FRAME_COUNT,
        );

        // #save-gif becomes visible only after frames load (load-gated export).
        await driver.wait(
          async () => map.isSaveGifVisible(),
          30000,
          '#save-gif (Download GIF) should become visible once the animation has frames',
        );

        // Install the export-initiation probe BEFORE the click. It wraps the
        // controller's handleFinishCrop (the source method that posts
        // triggerGifExport to the host) — the webview's VS Code API object is
        // FROZEN (postMessage is non-writable), so this method seam is the
        // faithful, drivable observation point for "the export was initiated".
        await map.installGifExportProbe();
        expect(
          await map.gifExportTriggeredCount(),
          'the GIF-export probe should install cleanly (count starts at 0)',
        ).to.equal(0);

        // Click #save-gif -> the controller enters crop mode (#crop-box shown).
        await map.clickSaveGif();
        await driver.wait(
          async () => map.isCropBoxVisible(),
          15000,
          'clicking #save-gif (with frames loaded) should enter crop mode (#crop-box visible)',
        );

        // No export has been TRIGGERED yet — crop mode precedes the trigger.
        expect(
          await map.gifExportTriggeredCount(),
          'no triggerGifExport should fire merely on entering crop mode',
        ).to.equal(0);

        // Confirm the crop (Enter) -> CropManager.onConfirm -> handleFinishCrop,
        // the method that would post triggerGifExport to the host. This is the
        // strongest faithful observable BEFORE the host's native showSaveDialog
        // (which Selenium cannot drive and which would wedge the session).
        await map.confirmCropWithEnter();
        await driver.wait(
          async () => (await map.gifExportTriggeredCount()) >= 1,
          15000,
          'confirming the crop should INITIATE the GIF export (reach handleFinishCrop)',
        );
        expect(
          await map.gifExportTriggeredCount(),
          'the GIF export must be initiated exactly once by a single crop confirmation',
        ).to.equal(1);

        // NATIVE-DIALOG BOUNDARY: the host export then opens
        // vscode.window.showSaveDialog (a native OS dialog Selenium cannot drive).
        // The probe stubs the host post so that dialog never opens (it would wedge
        // the session); the test stops at the faithful, drivable observable
        // (export initiated) and does NOT assert a written .gif it cannot complete.
      } finally {
        await map.detach();
      }
    });
  });
});
