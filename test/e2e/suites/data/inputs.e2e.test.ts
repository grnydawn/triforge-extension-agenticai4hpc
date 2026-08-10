import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { By, until, VSBrowser } from 'vscode-extension-tester';
import { ProjectsView } from '../../pageobjects/ProjectsView.ts';
import { SimulationsView } from '../../pageobjects/SimulationsView.ts';
import { InputGenerator } from '../../pageobjects/InputGenerator.ts';
import {
  closeAllEditors,
  reloadWindow,
  resetToWorkbench,
} from '../../pageobjects/workbench.ts';
import { withTempWorkspace } from '../../helpers/seed.ts';

/**
 * Input-generation E2E suite (INP-1..6).
 *
 * Each scenario seeds a ready golden project (whose `input.dem`/`src`/`hyg`
 * static + dynamic inputs are materialized on disk), reloads the window (the
 * extension only loads the project registry at `activate()`), activates the
 * project, then drives the REAL Input Generator webview panel
 * (`src/panels/InputGeneratorEditor.ts` + `templates/InputGeneratorHtml.ts`)
 * through the {@link InputGenerator} page object and the `triforge-simulations`
 * tree.
 *
 * The generator opens in one of two modes from the tree's own entry points:
 *  - the `Static Inputs` group node fires `triforge.generateInput` (static),
 *  - the `Inputs > Dynamic Inputs` node fires
 *    `triforge.openDynamicInputGenerator` (dynamic).
 * Both are the real, reachable UI paths (`triforge.openDynamicInputGenerator` is
 * hidden from the Command Palette by `commandPalette when:false`, so the tree is
 * the only reachable entry point).
 *
 * Green:  INP-1 (static generator produces an input file that appears in the
 *         tree), INP-2 (dynamic mode's observable core behavior — static list
 *         hidden, Streamflow page active), INP-3 (editing a streamflow input
 *         renders the hydrograph bar-chart series), INP-5 (removing an input
 *         round-trips tree + config), INP-4 (SEC-3 FIXED — a `</script>` payload
 *         in `initialData` renders inert and does NOT break the page's script),
 *         INP-6 (ARCH-1 FIXED, option B — the "Other Pages" footer handlers fire
 *         via nonce-gated `addEventListener` and close the panel; the full
 *         inline-JS extraction into a typed bundle remains deferred debt).
 */

/** Read a seeded project's on-disk config.json. */
function readConfig(projectPath: string): any {
  return JSON.parse(fs.readFileSync(path.join(projectPath, 'config.json'), 'utf8'));
}

/** Restore a clean top frame + empty editor area for the next test/suite. */
async function cleanup(): Promise<void> {
  try {
    await resetToWorkbench();
  } catch {
    /* best-effort */
  }
}

/**
 * Activate the named seeded project (selecting it in the Projects tree fires
 * `triforge.openProject`), then close the MapEditor it opens so the input
 * generator is later the single, unambiguous editor-area webview. Waits for the
 * project to actually become active before returning.
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

/** Click the labelled button (e.g. "Remove") in the open modal dialog. */
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
 * Open the STATIC input generator the way a user does: click the `Static Inputs`
 * group node, whose `item.command` is `triforge.generateInput`. Waits for the
 * generator panel to appear.
 */
async function openStaticGenerator(sims: SimulationsView, projectName: string): Promise<void> {
  await sims.selectNode('Inputs', 'Static Inputs');
  await InputGenerator.waitForOpen(projectName);
}

/**
 * Open the DYNAMIC input generator the way a user does: click the
 * `Inputs > Dynamic Inputs` node, whose `item.command` is
 * `triforge.openDynamicInputGenerator`. Waits for the generator panel to appear.
 */
async function openDynamicGenerator(sims: SimulationsView, projectName: string): Promise<void> {
  await sims.selectNode('Inputs', 'Dynamic Inputs');
  await InputGenerator.waitForOpen(projectName);
}

// ===========================================================================
// INP-1 (green) — static generator produces an input file that appears in tree.
// ===========================================================================
/**
 * The static generator (`triforge.generateInput`) opens the Input Generator in
 * `static` mode. Its "Water Depth" page produces an input by applying a selected
 * file: the page's "Ok" (`#btnOkHFooter`) posts `applyInitialInputFile`, which
 * the host applies to `activeProject.initialInputPath` (rewritten into config as
 * `input.initialInput`) and which the Static Inputs group renders as the
 * "Water Depth" node.
 *
 * The native Browse dialog is non-deterministic in E2E, so we materialize a real
 * input file on disk in the project's `input/` dir and drive the page's REAL
 * "Ok" button with that path (the file-path field set as the dialog would). We
 * then assert BOTH that the file exists (is "produced" into the project's input
 * set) AND that it appears in the simulations tree as the "Water Depth" node,
 * AND that config.json carries it.
 */
describe('Triforge Inputs (INP-1: static generator produces an input file shown in the tree)', function () {
  this.timeout(300000);

  after(cleanup);

  it('produces a Water Depth input that appears in the tree and config', async () => {
    await resetToWorkbench();
    await withTempWorkspace(async ({ projectPath, projectName }) => {
      await reloadWindow();
      await activateProject(projectName);

      const sims = new SimulationsView();

      // Pre-state: the seeded project has NO Water Depth input yet.
      const before = await sims.childLabels('Inputs', 'Static Inputs');
      expect(before, 'seeded project should not yet have a Water Depth node').to.not.include(
        'Water Depth',
      );

      // Materialize a real Water Depth input file on disk (the producer's source).
      const depthFile = path.join(projectPath, 'input', 'init_h.asc');
      fs.writeFileSync(
        depthFile,
        'ncols 211\nnrows 161\nxllcorner 751164.22\nyllcorner 3985440.72\ncellsize 30\nNODATA_value -9999\n',
      );

      // Open the static generator and drive its Water Depth producer.
      await openStaticGenerator(sims, projectName);
      const gen = new InputGenerator();
      await gen.produceWaterDepthFromFile(depthFile);

      // The produced file exists in the project's input set.
      expect(fs.existsSync(depthFile), 'the produced input file should exist on disk').to.be.true;

      // config.json records the produced input (input.initialInput).
      await VSBrowser.instance.driver.wait(
        async () => {
          const cfg = readConfig(projectPath);
          return cfg.input && cfg.input.initialInput === depthFile;
        },
        30000,
        'config.json input.initialInput should record the produced Water Depth file',
      );

      // The Water Depth node appears under Static Inputs in the tree.
      await resetToWorkbench();
      await VSBrowser.instance.driver.wait(
        async () => {
          const labels = await sims.childLabels('Inputs', 'Static Inputs');
          return labels.includes('Water Depth');
        },
        30000,
        'the produced Water Depth input should appear in the simulations tree',
      );
    });
  });
});

// ===========================================================================
// INP-2 (green) — dynamic-input mode (triforge.openDynamicInputGenerator) works.
// ===========================================================================
/**
 * `triforge.openDynamicInputGenerator` opens the Input Generator in `dynamic` mode.
 * Its observable core behavior (the inline script's `initialData.mode ===
 * 'dynamic'` branch): the Static Inputs list is HIDDEN, the Dynamic Inputs list
 * is SHOWN, and the first dynamic input (Streamflow hydrograph) is auto-activated
 * so the `#streamflow` page is the active page. We assert that exact mode
 * behavior — proving the dynamic generator opened in dynamic mode rather than
 * defaulting to the static layout.
 */
describe('Triforge Inputs (INP-2: dynamic input mode opens with dynamic layout active)', function () {
  this.timeout(300000);

  after(cleanup);

  it('opens the dynamic generator with the static list hidden and Streamflow active', async () => {
    await resetToWorkbench();
    await withTempWorkspace(async ({ projectName }) => {
      await reloadWindow();
      await activateProject(projectName);

      const sims = new SimulationsView();
      await openDynamicGenerator(sims, projectName);

      const gen = new InputGenerator();
      const dynamic = await gen.isDynamicMode();
      expect(
        dynamic,
        'dynamic mode should hide the static list, show the dynamic list, and ' +
          'activate the Streamflow page',
      ).to.be.true;
    });
  });
});

// ===========================================================================
// INP-3 (green) — edit a streamflow input; assert the bar chart renders.
// ===========================================================================
/**
 * The Streamflow hydrograph page's "Create/Edit" tab hosts an editable bar-chart
 * preview (`#sf-graph-svg`). Editing the streamflow value (`#sf-val-constant`)
 * fires the page's `change` listener -> `generateGraphData` -> `renderGraph`,
 * which draws one `.bar-rect` per simulation step. We open the dynamic generator
 * (where Streamflow is active), edit the value, and assert the chart renders a
 * real series (`.bar-rect` rects > 0) inside the SVG.
 */
describe('Triforge Inputs (INP-3: editing a streamflow input renders the hydrograph bar chart)', function () {
  this.timeout(300000);

  after(cleanup);

  it('renders a bar-chart series when the streamflow value is edited', async () => {
    await resetToWorkbench();
    await withTempWorkspace(async ({ projectName }) => {
      await reloadWindow();
      await activateProject(projectName);

      const sims = new SimulationsView();
      await openDynamicGenerator(sims, projectName);

      const gen = new InputGenerator();
      const bars = await gen.editStreamflowAndCountBars(3);
      expect(
        bars,
        'the hydrograph bar chart should render a real series of `.bar-rect` bars',
      ).to.be.greaterThan(0);
    });
  });
});

// ===========================================================================
// INP-5 (green) — remove an input; assert it is gone from tree + config.
// ===========================================================================
/**
 * The seeded golden project carries a Streamflow dynamic input
 * (`input.num_sources`/`src_loc_file`/`hydrograph_filename`), rendered as the
 * "Streamflow" node under `Inputs > Dynamic Inputs`. `triforge.removeInput`
 * (context-menu "Remove", gated on `viewItem == streamflowNode`) clears those
 * fields (rewriting config) and drops the node from the tree. INP-5 drives that
 * real, reachable removal and asserts the input is gone from BOTH the tree AND
 * config.json.
 */
describe('Triforge Inputs (INP-5: removing an input clears it from tree and config)', function () {
  this.timeout(300000);

  after(cleanup);

  it('removes the Streamflow input and reflects it in the tree and config', async () => {
    await resetToWorkbench();
    await withTempWorkspace(async ({ projectPath, projectName }) => {
      await reloadWindow();
      await activateProject(projectName);

      const sims = new SimulationsView();

      // Pre-state: the Streamflow node renders and config carries its fields.
      const before = await sims.childLabels('Inputs', 'Dynamic Inputs');
      expect(before, 'seeded project should render the Streamflow dynamic input').to.include(
        'Streamflow',
      );
      const beforeConfig = readConfig(projectPath);
      expect(
        beforeConfig.input.src_loc_file,
        'seeded config should carry the streamflow location file before removal',
      ).to.be.a('string');

      // Remove the input via the real, reachable context-menu action + confirm.
      await sims.selectContextMenuAction('Remove', 'Inputs', 'Dynamic Inputs', 'Streamflow');
      await clickModalButton('Remove');

      // config.json drops the streamflow fields.
      await VSBrowser.instance.driver.wait(
        async () => {
          const cfg = readConfig(projectPath);
          return (
            !cfg.input.src_loc_file &&
            !cfg.input.hydrograph_filename &&
            !cfg.input.num_sources
          );
        },
        30000,
        'config.json streamflow fields should be cleared after removing the input',
      );

      // The Streamflow node disappears from the tree.
      await VSBrowser.instance.driver.wait(
        async () => {
          const labels = await sims.childLabels('Inputs', 'Dynamic Inputs');
          return !labels.includes('Streamflow');
        },
        30000,
        'Streamflow node should disappear from the tree after removal',
      );
    });
  });
});

// ===========================================================================
// INP-4 (xfail SEC-3) — a </script> payload in initialData renders inert.
// ===========================================================================
/**
 * Post-fix property (SEC-3): a `</script>` injection payload carried into the
 * generator's `initialData` (here via the project NAME, which flows into both
 * `initialData.projectName` and the serialized `const initialData = ${dataJson}`
 * at `InputGeneratorHtml.ts:491`) is rendered INERT and does NOT break the page.
 *
 * Today `const dataJson = JSON.stringify(initialData)` performs NO `</script>`
 * escaping (unlike `ComputationSetupHtml`/`ExecutionSetupHtml`, which
 * `.replace(/</g,'&lt;')…`). A name like `</script><img src=x onerror=…>`
 * therefore CLOSES the inline `<script>` element early: everything after the
 * breakout (the `acquireVsCodeApi()` call, the nav/tab listeners) never runs, so
 * the page's scripted behavior is dead. The fix adds a `safeJsonForScript()`
 * (escaping `</script>` / `<`) so the script stays intact and the payload is
 * inert markup.
 *
 * We seed a project whose name carries a plain sentinel PREFIX (so the tree row
 * is still matchable) followed by `</script><span id=inp4-pwned>…</span>`, open
 * the static generator, and assert (post-fix) that the sentinel `<span>` does NOT
 * exist in the generator DOM — i.e. the payload was escaped to an inert string,
 * not parsed as live markup. While SEC-3 stands the unescaped `</script>` closes
 * the inline script early and the trailing `<span id=inp4-pwned>` is parsed as a
 * LIVE element, so it IS present, the "must be absent" assertion throws and the
 * xfail PASSES; once `safeJsonForScript` lands the span never materializes, the
 * assertion holds, the body stops throwing and the xfail FLIPS loudly.
 *
 * (Attribute values in the payload are left UNQUOTED, mirroring PRJ-2, so no
 * stray double-quote corrupts the surrounding JSON/markup — the sentinel must
 * render cleanly TODAY for the xfail to reflect the real vuln. We activate the
 * payload project the same way PRJ-2 does — match the sentinel prefix and
 * `safeClick` — since its raw name is awkward to match / mark "(Active)".)
 */
describe('Triforge Inputs (INP-4: a </script> payload renders inert and keeps the page functional — SEC-3 FIXED)', function () {
  this.timeout(300000);

  // Plain prefix (for tree matching) + the </script> breakout + a sentinel
  // <span> that only materializes as a live element if the breakout happens.
  const SENTINEL_PREFIX = 'INP4pwn';
  const PAYLOAD_NAME = `${SENTINEL_PREFIX}</script><span id=inp4-pwned>x</span>`;

  after(cleanup);

  it('renders a </script> injection payload as inert markup in the generator', async () => {
    await resetToWorkbench();
    await withTempWorkspace(
      async () => {
        await reloadWindow();

        // Activate the payload project by its sentinel prefix (its raw name is
        // awkward to match verbatim / never gets an "(Active)" marker).
        const projects = new ProjectsView();
        await VSBrowser.instance.driver.wait(
          async () => (await projects.getItemContaining(SENTINEL_PREFIX)) !== undefined,
          30000,
          'payload project never appeared in the Projects tree',
        );
        const item = await projects.getItemContaining(SENTINEL_PREFIX);
        if (!item) throw new Error('payload project item not found');
        await (item as typeof item & { safeClick: () => Promise<void> }).safeClick();
        await closeAllEditors();

        // Open the static generator for the (now active) payload project.
        const sims = new SimulationsView();
        await sims.selectNode('Inputs', 'Static Inputs');
        await VSBrowser.instance.driver.wait(
          async () => InputGenerator.isOpenContaining(SENTINEL_PREFIX),
          30000,
          'static generator never opened for the payload project',
        );

        const gen = new InputGenerator();

        // SEC-3 FIXED (T2): the </script> payload is escaped (safeJsonForScript), so
        // the sentinel <span> is NEVER parsed as live markup and does not exist.
        const injected = await gen.hasElement('#inp4-pwned');
        expect(
          injected,
          'a </script> payload in initialData must be rendered inert (escaped): ' +
            'the injected sentinel element must NOT be parsed as live markup in ' +
            'the generator webview (SEC-3)',
        ).to.be.false;
      },
      { name: PAYLOAD_NAME },
    );
  });
});

// ===========================================================================
// INP-6 (green — ARCH-1 FIXED, option B) — footer handlers fire via
// nonce-gated addEventListener.
// ===========================================================================
/**
 * Property (ARCH-1, option B FIXED): the generator's "Other Pages"
 * (manning/runoff-map/boundaries/observation) footer buttons fire their close
 * handler. They previously used inline `onclick="closePanel()"`
 * (`InputGeneratorHtml.ts:305–375`), which the page's own CSP
 * (`script-src 'nonce-…'`, NO `'unsafe-inline'`) BLOCKS — making them dead
 * no-ops. The minimal option-B fix removes the inline onclick, tags each button
 * with an `.other-page-close` marker class, and wires them via `addEventListener`
 * inside the existing nonce-gated `<script>` (calling the same `closePanel` the
 * file already defines). The full inline-JS-into-typed-bundle extraction remains
 * DEFERRED debt.
 *
 * We open the static generator, navigate to the Surface Roughness page, click its
 * footer "Ok", and assert the panel CLOSED — proving the nonce-gated
 * addEventListener wiring fires (not the CSP-blocked inline handler).
 */
describe('Triforge Inputs (INP-6: footer event handlers fire via nonce-gated addEventListener — ARCH-1 FIXED (option B))', function () {
  this.timeout(300000);

  after(cleanup);

  it('fires the Other Pages footer handler in the generator (closes the panel)', async () => {
    await resetToWorkbench();
    await withTempWorkspace(async ({ projectName }) => {
      await reloadWindow();
      await activateProject(projectName);

      const sims = new SimulationsView();
      await openStaticGenerator(sims, projectName);

      const gen = new InputGenerator();

      // ARCH-1 FIXED (option B): the Other Pages' footer buttons no longer use the
      // CSP-blocked inline onclick="closePanel()"; they carry an `.other-page-close`
      // marker class and are wired via addEventListener inside the nonce-gated
      // script. Clicking the Surface Roughness "Ok" now closes the panel.
      const closed = await gen.inlineOnclickClosesPanel(projectName);
      expect(
        closed,
        "the generator's Other Pages footer handlers must fire via the nonce-gated " +
          'addEventListener wiring and close the panel (ARCH-1, option B)',
      ).to.be.true;
    });
  });
});
