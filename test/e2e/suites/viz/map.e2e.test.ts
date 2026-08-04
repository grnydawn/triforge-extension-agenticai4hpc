import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { VSBrowser } from 'vscode-extension-tester';

import { MapView } from '../../pageobjects/MapView.ts';
import { ProjectsView } from '../../pageobjects/ProjectsView.ts';
import { closeAllEditors, reloadWindow, resetToWorkbench } from '../../pageobjects/workbench.ts';
import { withTempWorkspace } from '../../helpers/seed.ts';

/**
 * MapEditor render / interaction E2E suite (MAP-1/2/3/5/6/7).
 *
 * The seeded golden project (`test/e2e/fixtures/golden/exe/` + the DEM fixture
 * `HawRidgePark.asc`, materialized by `helpers/seed.ts`) carries a DEM
 * (`input/HawRidgePark.asc`), a UTM header (`16N`, 211×161, EPSG:32616), and ASC
 * output frames. The map is opened through the REAL "Animate" context action
 * (`triforge.loadAnimation`) on the `Output > Ascii` category node, which reveals
 * the MapEditor for the active project, loads its DEM, then streams animation
 * frames (see `src/commands/animation.ts`, `src/panels/MapEditor.ts`).
 *
 * Frame-count facts (from `baseline.json`): 18 ASC depth FILES on disk
 * (steps {1,6,12,18,24,30,36,42,48} × partitions {0,1}); `loadAnimation` groups
 * by `H_<step>_<partition>` and STITCHES the two partitions per step into one
 * animation frame, so the ANIMATION frame count = 9 distinct steps
 * (= `keptSteps.length`), NOT 18.
 *
 * - MAP-1 (green): DEM renders — pane visible, checkbox checked, legend canvas
 *   drawn, legend range reflects the loaded data; DEM checkbox round-trips.
 * - MAP-5 (green): the golden project populates streamflow (`src_loc_file` +
 *   `hydrograph_filename`) but NOT init/qxqy; assert the available layer renders
 *   + round-trips and the unavailable layers are correctly HIDDEN; plus the
 *   base-layer switcher swaps layers.
 * - MAP-6 (green): interactive chrome — floating panes are draggable, the
 *   layer-switcher menu opens + options select, and the DEM colormap select
 *   re-draws the legend.
 * - MAP-2 (green, PERF-1 FIXED): the DEM cache now short-circuits; assert the
 *   "second reveal of the same DEM does NOT re-ship the grid" via the renderDem
 *   message count on the retained webview.
 * - MAP-3 (BUG-5 FIXED): after an animation loads and the DEM is cleared, the
 *   tooltip's anim branch no longer null-derefs `demData.header.ncols`; bare
 *   assertion guards the "tooltip still updates" property.
 * - MAP-7 (SEC-4 FIXED): Leaflet is bundled locally under media/leaflet (served
 *   via asWebviewUri) and unpkg is dropped from every CSP/link/script; bare
 *   assertion guards the "no unpkg reference anywhere" property.
 *
 * See test/XFAIL.md (PERF-1, BUG-5, SEC-4). MAP-4 (BUG-5 selection unit) and
 * MAP-8 (PKG-2 unit) live under test/unit/.
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
/** The raw on-disk ASC depth FILE count (= 18); kept for documentation/sanity. */
const ASC_FILE_COUNT: number = BASELINE.frameCount;

/** Restore a clean top frame + empty editor area for the next test. */
async function cleanup(): Promise<void> {
  try {
    await resetToWorkbench();
  } catch {
    /* best-effort */
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
// MAP-1 (green) — DEM renders + DEM-checkbox round-trips.
// ===========================================================================
describe('Triforge Map (MAP-1: DEM renders and the DEM layer toggle round-trips)', function () {
  this.timeout(300000);
  after(cleanup);

  it('renders the seeded DEM (pane, checkbox, legend, range) and toggles it', async () => {
    await resetToWorkbench();
    await withTempWorkspace(async ({ projectName }) => {
      await reloadWindow();
      await activateProject(projectName);

      const map = new MapView();
      await map.openViaAnimate('Ascii');
      try {
        const driver = VSBrowser.instance.driver;

        // The DEM control pane becomes visible and the DEM checkbox is checked.
        await driver.wait(
          async () => map.isDemPaneVisible(),
          60000,
          '#pane-dem should become visible once the DEM renders',
        );
        expect(await map.isDemChecked(), '#dem-checkbox should be present and checked').to.be
          .true;

        // The legend canvas exists with width>0 and is actually drawn (gradient).
        expect(
          await map.demLegendCanvasWidth(),
          '#dem-legend-canvas should have a positive width',
        ).to.be.greaterThan(0);
        expect(
          await map.demLegendCanvasDrawn(),
          '#dem-legend-canvas should be painted with the colormap gradient',
        ).to.be.true;

        // Post-load the legend min/max inputs reflect a REAL range (not "Auto").
        // MapController.updateInputIfAuto writes value.toFixed(2) of the loaded
        // data min/max. Wait for at least the max input to leave "Auto".
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
        // The golden DEM is a real elevation grid; its rendered range is a
        // non-degenerate interval (max strictly above min).
        expect(maxNum, 'legend max should exceed legend min (a real range)').to.be.greaterThan(
          minNum,
        );

        // Toggle round-trip: DEM starts visible; toggling hides the overlay,
        // toggling again restores it.
        expect(await map.isDemOverlayVisible(), 'DEM overlay should start visible').to.be.true;
        await map.toggleDem();
        await driver.wait(
          async () => !(await map.isDemChecked()),
          15000,
          'toggling #dem-checkbox should uncheck it',
        );
        await driver.wait(
          async () => !(await map.isDemOverlayVisible()),
          15000,
          'unchecking #dem-checkbox should hide the DEM overlay',
        );
        await map.toggleDem();
        await driver.wait(
          async () => map.isDemChecked(),
          15000,
          're-toggling #dem-checkbox should re-check it',
        );
        await driver.wait(
          async () => map.isDemOverlayVisible(),
          15000,
          're-checking #dem-checkbox should re-show the DEM overlay',
        );
      } finally {
        await map.detach();
      }
    });
  });
});

// ===========================================================================
// MAP-5 (green) — available vs hidden data layers + base-layer switching.
// ===========================================================================
/**
 * The golden config populates `src_loc_file` + `hydrograph_filename`
 * (streamflow) but has NO initial-input (`init`) and NO `qx_infile`/`qy_infile`
 * (qxqy). So `MapEditor.loadStreamflowIfAvailable` renders the streamflow layer
 * (pane + markers), while `loadInitialInputIfAvailable`/`loadQxQyIfAvailable`
 * post `clearInitialInput`/`clearQxQy` and the panes stay HIDDEN.
 */
describe('Triforge Map (MAP-5: available layer renders+toggles, absent layers hidden, base layer switches)', function () {
  this.timeout(300000);
  after(cleanup);

  it('renders streamflow, hides init/qxqy, and switches the base layer', async () => {
    await resetToWorkbench();
    await withTempWorkspace(async ({ projectName }) => {
      await reloadWindow();
      await activateProject(projectName);

      const map = new MapView();
      await map.openViaAnimate('Ascii');
      try {
        const driver = VSBrowser.instance.driver;

        // Streamflow IS available in the golden config -> its pane renders and
        // its checkbox round-trips.
        await driver.wait(
          async () => map.isPaneVisible('pane-streamflow'),
          60000,
          '#pane-streamflow should render (golden config has src_loc_file + hydrograph)',
        );
        expect(
          await map.isCheckboxChecked('streamflow-checkbox'),
          'streamflow checkbox should start checked',
        ).to.be.true;
        await map.toggleCheckbox('streamflow-checkbox');
        await driver.wait(
          async () => !(await map.isCheckboxChecked('streamflow-checkbox')),
          15000,
          'toggling the streamflow checkbox should uncheck it',
        );
        await map.toggleCheckbox('streamflow-checkbox');
        await driver.wait(
          async () => map.isCheckboxChecked('streamflow-checkbox'),
          15000,
          're-toggling the streamflow checkbox should re-check it',
        );

        // Init + QxQy are NOT in the golden config -> their panes stay HIDDEN
        // (a real, correct hidden state — not a fabricated pass).
        expect(
          await map.isPaneVisible('pane-init'),
          '#pane-init must stay hidden (no initial-input in the golden config)',
        ).to.be.false;
        expect(
          await map.isPaneVisible('pane-qxqy'),
          '#pane-qxqy must stay hidden (no qx/qy in the golden config)',
        ).to.be.false;

        // Base-layer switcher: OpenStreetMap is active by default; pick None and
        // assert the base tile layer is removed, then pick OpenTopoMap back.
        expect(
          await map.activeBaseLayer(),
          'OpenStreetMap should be the active base layer initially',
        ).to.equal('OpenStreetMap');
        await map.pickBaseLayer('None');
        await driver.wait(
          async () => (await map.activeBaseLayer()) === 'None',
          15000,
          'picking "None" should make it the active base-layer option',
        );
        await driver.wait(
          async () => !(await map.hasBaseTileLayer()),
          15000,
          'picking "None" should remove the base tile layer from the map',
        );
        await map.pickBaseLayer('OpenTopoMap');
        await driver.wait(
          async () => (await map.activeBaseLayer()) === 'OpenTopoMap',
          15000,
          'picking "OpenTopoMap" should make it the active base-layer option',
        );
        await driver.wait(
          async () => map.hasBaseTileLayer(),
          15000,
          'picking "OpenTopoMap" should add a base tile layer back to the map',
        );
      } finally {
        await map.detach();
      }
    });
  });
});

// ===========================================================================
// MAP-6 (green) — interactive chrome the golden project supports.
// ===========================================================================
/**
 * Reachable interactive chrome for the seeded project: the floating control
 * panes are declared `draggable="true"` (`MapEditorHtml.ts`); the custom
 * base-layer switcher menu opens and its options are selectable; and the DEM
 * colormap select (`#color-map-select`) re-draws the legend on change.
 *
 * Vector-edit / crop chrome (the GIF crop / vector-edit overlay) is reachable
 * only AFTER a GIF export / vector-layer interaction and is not part of the
 * golden render path, so it is intentionally NOT asserted here (noted in the
 * task's concerns rather than weakening the assertions below).
 */
describe('Triforge Map (MAP-6: draggable panes, layer-switcher menu, DEM colormap legend update)', function () {
  this.timeout(300000);
  after(cleanup);

  it('exposes draggable panes, an openable layer menu, and a colormap-driven legend', async () => {
    await resetToWorkbench();
    await withTempWorkspace(async ({ projectName }) => {
      await reloadWindow();
      await activateProject(projectName);

      const map = new MapView();
      await map.openViaAnimate('Ascii');
      try {
        const driver = VSBrowser.instance.driver;
        await driver.wait(
          async () => map.isDemPaneVisible(),
          60000,
          '#pane-dem should be visible before asserting interactive chrome',
        );

        // Floating control panes carry the draggable affordance.
        expect(
          await map.isPaneDraggable('pane-dem'),
          'the DEM control pane should be draggable',
        ).to.be.true;
        expect(
          await map.isPaneDraggable('pane-animation'),
          'the animation control pane should be draggable',
        ).to.be.true;

        // The layer-switcher menu opens (its options become reachable/selectable):
        // picking OpenTopoMap then OpenStreetMap flips the active option.
        await map.pickBaseLayer('OpenTopoMap');
        await driver.wait(
          async () => (await map.activeBaseLayer()) === 'OpenTopoMap',
          15000,
          'the layer menu should open and let OpenTopoMap be selected',
        );
        await map.pickBaseLayer('OpenStreetMap');
        await driver.wait(
          async () => (await map.activeBaseLayer()) === 'OpenStreetMap',
          15000,
          'the layer menu should let OpenStreetMap be re-selected',
        );

        // The DEM colormap select re-draws #dem-legend-canvas: switching from the
        // default Terrain to Grayscale changes the rendered legend pixels.
        const beforeSig = await map.selectDemColormap('Terrain');
        const afterSig = await map.selectDemColormap('Grayscale');
        expect(
          afterSig,
          'changing the DEM colormap should re-draw the legend canvas (different pixels)',
        ).to.not.equal(beforeSig);
      } finally {
        await map.detach();
      }
    });
  });
});

// ===========================================================================
// MAP-2 (xfail PERF-1) — DEM is re-parsed on every reveal (dead cache guard).
// ===========================================================================
/**
 * PERF-1 (CODE_REVIEW): `MapEditor.loadDemIfAvailable(overrideZone?,
 * overrideDatum = 'WGS84', force = false)` guards the cache with
 * `if (this._currentDemData && !overrideZone && !overrideDatum && !force)`.
 * Because `overrideDatum` defaults to the truthy `'WGS84'`, `!overrideDatum` is
 * always false, so the cache NEVER short-circuits — every reveal re-reads +
 * re-parses the DEM and re-`postMessage`s the full grid. The fix compares
 * against the cached datum/zone so an unchanged DEM short-circuits.
 *
 * Observable (genuine, headless-safe): every ACTUAL DEM parse ends with
 * `loadDemIfAvailable` posting a `renderDem` message carrying the full grid; the
 * cache-HIT path posts NOTHING. Because the panel is `retainContextWhenHidden`,
 * the webview JS context (and any listener we add) survives across reveals — but
 * ONLY if the SAME panel instance is retained. So we open the map (reveal #1
 * loads + caches the DEM), install a `renderDem` message counter on the retained
 * webview, then reveal the SAME panel AGAIN by firing the Animate context action
 * a second time WITHOUT disposing the panel: we merely `detach()` (switch the
 * driver frame back to the workbench) and re-trigger Animate, which hits
 * `createOrShow`'s EXISTING-panel branch (`MapEditor.ts:87–93`) ->
 * `loadDemIfAvailable()` on the same instance for the unchanged DEM. The counter
 * (installed on that retained webview context) survives, and the per-instance
 * `_currentDemData` cache is the very thing PERF-1 should short-circuit on.
 *
 * Post-fix the second reveal short-circuits on the cache and posts NO
 * `renderDem` -> count 0 -> `=== 0` holds. Today the dead guard re-parses and
 * re-posts the grid -> count >= 1 -> the assertion throws -> the xfail passes; it
 * flips when PERF-1 fixes the guard.
 *
 * IMPORTANT (panel lifecycle): we must NOT call `closeAllEditors()` /
 * `activateProject()` between the two reveals. `closeAllEditors()` disposes the
 * MapEditor panel (`MapEditor.ts:36` `onDidDispose -> dispose()` ->
 * `currentPanels.delete` at :736), so a second reveal would create a BRAND-NEW
 * panel: (1) the counter installed on the now-destroyed webview would be gone
 * (`demRenderCount()` -> -1), and (2) the fresh panel's `_currentDemData` cache
 * starts empty so it re-parses EVEN AFTER PERF-1 is fixed — the xfail could then
 * never flip. Revealing the SAME retained instance is what makes the post-fix
 * cache-hit (0 `renderDem`) a genuine flip.
 *
 * NOTE (closest faithful observable): the raw extension-host parse COUNT is not
 * directly observable in ExTester, and `OutputView.getText()` reads via a
 * clipboard select-all+copy that does NOT complete under headless xvfb. The
 * `renderDem`-message count on the retained webview is the closest faithful E2E
 * signal of "the host re-parsed + re-shipped the DEM on the second reveal".
 */
describe('Triforge Map (MAP-2: DEM is not re-parsed on a second reveal — PERF-1 FIXED)', function () {
  this.timeout(300000);
  after(cleanup);

  it('does not re-ship the DEM (no re-parse) when the same map panel is revealed again', async () => {
    await resetToWorkbench();
    await withTempWorkspace(async ({ projectName }) => {
      await reloadWindow();
      await activateProject(projectName);

      const driver = VSBrowser.instance.driver;
      const map = new MapView();

      // Reveal #1: open the map; the DEM loads (>=1 renderDem) and is cached.
      await map.openViaAnimate('Ascii');
      await driver.wait(
        async () => map.isDemPaneVisible(),
        60000,
        '#pane-dem should be visible after the first reveal',
      );
      // Install the renderDem counter on the retained webview AFTER reveal #1's
      // loads have settled, so it counts only the SECOND reveal's parses.
      await driver.sleep(1500);
      await map.installDemRenderCounter();
      const baseline = await map.demRenderCount();
      expect(
        baseline,
        'the renderDem counter should install cleanly on the retained webview',
      ).to.equal(0);

      // Detach the driver frame (the panel itself is NOT disposed — we do NOT
      // call closeAllEditors/activateProject, so the SAME retained instance and
      // its counter survive into reveal #2).
      await map.detach();
      await driver.sleep(1000);

      // Reveal #2: re-fire Animate on the SAME retained panel (Animate ->
      // createOrShow's existing-panel branch -> loadDemIfAvailable for the
      // unchanged DEM on the same MapEditor instance). The retained webview's
      // counter keeps accumulating.
      await map.revealSamePanelViaAnimate('Ascii');
      await driver.wait(
        async () => map.isDemPaneVisible(),
        60000,
        '#pane-dem should be visible after the second reveal',
      );
      // The retained webview kept the counter (re-attach found the same context,
      // not a fresh -1). Assert that before timing the second reveal's parses.
      expect(
        await map.demRenderCount(),
        'the SAME retained webview must be re-attached on reveal #2 (counter ' +
          'survived; not a fresh panel returning -1)',
      ).to.be.at.least(0);
      // Give the second reveal's loadDemIfAvailable time to (re-)post renderDem.
      await driver.sleep(3000);
      const reParseShipments = await map.demRenderCount();
      await map.detach();

      // PERF-1 FIXED (T2): revealing the same unchanged DEM a second time
      // short-circuits on the cache and posts NO renderDem. (Was xfail(PERF-1).)
      expect(
        reParseShipments,
        'a second reveal of the same unchanged DEM must hit the cache and NOT ' +
          're-ship the DEM grid (no new renderDem message) — PERF-1',
      ).to.equal(0);
    });
  });
});

// ===========================================================================
// MAP-3 (BUG-5 FIXED) — tooltip survives DEM-clear with an animation visible.
// ===========================================================================
/**
 * BUG-5 (Tooltip half): `src/webview-ui/map/ui/Tooltip.ts:113–118` — the anim
 * branch reads `demData.header.ncols` for the grid width. After the DEM is
 * cleared (`handleClearDem` -> `currentDemData = null`), the next mousemove with
 * an animation still visible dereferences null and throws inside the controller's
 * `mousemove` handler, so the tooltip stops updating for the rest of the session.
 * The fix passes the animation grid width from `AnimationLayer.setDemContext`
 * and guards the anim branch against null `currentDemData`.
 *
 * Sequence: open the map, load the animation, CLEAR the DEM, then move the mouse
 * over `#map`. Post-fix the tooltip STILL updates (the anim branch uses the
 * animation grid width supplied by `AnimationLayer.setDemContext` and guards
 * null `currentDemData`). (Was xfail('BUG-5', ...) — flipped to a bare assertion
 * when BUG-5 landed.)
 */
describe('Triforge Map (MAP-3: tooltip survives DEM-clear with an animation visible — BUG-5 FIXED)', function () {
  this.timeout(300000);
  after(cleanup);

  it('keeps updating the tooltip over the animation after the DEM is cleared', async () => {
    await resetToWorkbench();
    await withTempWorkspace(async ({ projectName }) => {
      await reloadWindow();
      await activateProject(projectName);

      const driver = VSBrowser.instance.driver;
      const map = new MapView();
      await map.openViaAnimate('Ascii');
      try {
        // Wait for the animation to finish loading; its frame count is the
        // STITCHED step count (9), not the 18 on-disk ASC files.
        await driver.wait(
          async () => map.isDemPaneVisible(),
          60000,
          '#pane-dem should be visible before loading the animation',
        );
        const total = await map.waitForAnimationLoaded(180000);
        expect(
          total,
          `animation frame count should equal the stitched step count (${ANIM_FRAME_COUNT}), ` +
            `not the ${ASC_FILE_COUNT} on-disk ASC files`,
        ).to.equal(ANIM_FRAME_COUNT);
        // Sanity: the controller's authoritative animationFrames.length agrees.
        expect(await map.frameCount(), 'animationFrames.length should match the label').to.equal(
          ANIM_FRAME_COUNT,
        );

        // POSITIVE CONTROL (pre-clear): with the DEM still loaded and the
        // animation visible, the SAME hoverMapAndReadTooltip() MUST show a
        // tooltip. This proves the hover path actually drives the controller's
        // Leaflet `mousemove` handler and resolves a value at the map centre —
        // so the post-clear failure below is attributable to BUG-5's null-deref
        // and NOT to a synthetic event that never reached the handler. Without
        // this control the xfail could pass for the wrong reason and never flip.
        let baselineShown = false;
        for (let i = 0; i < 10 && !baselineShown; i++) {
          const tip = await map.hoverMapAndReadTooltip();
          baselineShown = tip.visible && tip.text.trim().length > 0;
          if (!baselineShown) await driver.sleep(300);
        }
        expect(
          baselineShown,
          'positive control: while the DEM is loaded and the animation is visible, ' +
            'hovering the map centre MUST show the tooltip (the hover path reaches ' +
            "Leaflet's mousemove handler and resolves a value)",
        ).to.be.true;

        // Clear the DEM (the host clearDem path) -> currentDemData becomes null
        // while the animation layer stays visible: the BUG-5 precondition.
        await map.clearDem();

        // Reset the tooltip to hidden+blank AFTER the positive-control hover.
        // BUG-5's null-deref throws INSIDE Tooltip.update before it ever hides or
        // repaints the element, so without this reset the stale pre-clear tooltip
        // (still `display:block` with old text) would read as "visible" and the
        // post-clear assertion would pass for the wrong reason. With the reset, a
        // post-clear "visible+text" reading can ONLY come from a hover that
        // actually re-showed it (the post-fix recovery), so the xfail flips
        // honestly: today it stays hidden (assertion throws -> xfail passes).
        await map.resetTooltip();

        // Move over the map and read the tooltip. Post-fix the anim branch uses
        // the animation grid width (no DEM needed), so the tooltip STILL shows a
        // value even though currentDemData is null.
        let shown = false;
        for (let i = 0; i < 5 && !shown; i++) {
          await map.resetTooltip();
          const tip = await map.hoverMapAndReadTooltip();
          shown = tip.visible && tip.text.trim().length > 0;
          if (!shown) await driver.sleep(300);
        }
        expect(
          shown,
          'with an animation visible and the DEM cleared, the tooltip must still ' +
            'update (anim branch guards null currentDemData, uses the anim grid width) — BUG-5',
        ).to.be.true;
      } finally {
        await map.detach();
      }
    });
  });
});

// ===========================================================================
// MAP-7 (SEC-4 FIXED) — Leaflet is bundled locally; no unpkg.com CDN.
// ===========================================================================
/**
 * SEC-4 (CODE_REVIEW): previously `MapEditorHtml.ts` CSP allowed
 * `https://unpkg.com` (`style-src`/`script-src`/`connect-src`), a `<link>` to the
 * unpkg Leaflet CSS, and a `<script src="https://unpkg.com/.../leaflet.js">` —
 * Leaflet was CDN-loaded with no SRI and not bundled locally. The fix vendors
 * Leaflet 1.9.4 under media/leaflet, serves it via `asWebviewUri` under scoped
 * `localResourceRoots`, drops unpkg from every CSP directive, and nonce-gates
 * the local script.
 *
 * Post-fix property (now a bare assertion): the loaded webview references NO
 * unpkg.com — no `script[src*="unpkg.com"]`, no `link[href*="unpkg.com"]`, and
 * no `unpkg.com` token in the CSP meta.
 */
describe('Triforge Map (MAP-7: the webview references no unpkg.com CDN — SEC-4 FIXED)', function () {
  this.timeout(300000);
  after(cleanup);

  it('loads Leaflet locally with no unpkg.com reference', async () => {
    await resetToWorkbench();
    await withTempWorkspace(async ({ projectName }) => {
      await reloadWindow();
      await activateProject(projectName);

      const map = new MapView();
      await map.openViaAnimate('Ascii');
      try {
        const driver = VSBrowser.instance.driver;
        await driver.wait(
          async () => map.isDemPaneVisible(),
          60000,
          'the map should be open before inspecting its document for unpkg references',
        );

        // Sanity: the document still loads Leaflet (now bundled locally).
        const html = await map.documentHtml();
        expect(html, 'the map webview HTML should be inspectable').to.contain('leaflet');

        // SEC-4 FIXED (T2): Leaflet is bundled locally under media/leaflet and
        // served via asWebviewUri; unpkg is gone from every script src, link href,
        // and the CSP meta. (Was xfail('SEC-4', ...) — flipped to a bare assertion.)
        const referencesUnpkg = await map.hasUnpkgReference();
        expect(
          referencesUnpkg,
          'the map webview must reference NO unpkg.com (Leaflet bundled locally; ' +
            'no script[src], no link[href], no CSP token) — SEC-4',
        ).to.be.false;
      } finally {
        await map.detach();
      }
    });
  });
});
