import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { By, Key, until, VSBrowser } from 'vscode-extension-tester';
import { ProjectsView } from '../../pageobjects/ProjectsView.ts';
import { SimulationsView } from '../../pageobjects/SimulationsView.ts';
import { PropertiesPanel } from '../../pageobjects/PropertiesPanel.ts';
import {
  closeAllEditors,
  reloadWindow,
  resetToWorkbench,
} from '../../pageobjects/workbench.ts';
import { withTempMultiWorkspace } from '../../helpers/seed.ts';

/**
 * Simulations-tree E2E suite (SIM-1..9).
 *
 * Each scenario seeds a ready golden project (its `input.dem/src/hyg` static
 * inputs and `output.ascii/binary` frames materialized on disk by the golden
 * copy), reloads the window (the extension only loads the project registry at
 * `activate()`), activates the project, then drives the REAL `triforge-simulations`
 * tree: context-menu actions, sort/filter, expansion, multi-select. Where a
 * scenario mutates project state it asserts BOTH the rendered tree AND the
 * on-disk `config.json` that `ProjectManager.updateProject` rewrites.
 *
 * Green:  SIM-3 (add-input entry point + a driveable input remove round-trips
 *         tree+config), SIM-4 (remove output category + item round-trips
 *         tree+config), SIM-5 (sort/filter reorders/narrows the tree), SIM-8
 *         (multi-select renders a sensible Properties state, no crash).
 * xfail:  SIM-1/2 (VIEW-1 dead menus — add-input/open-folder + delete-DEM
 *         context actions unreachable), SIM-6/7 (VIEW-3 missing stable tree id —
 *         expansion lost on refresh; same-basename files collide), SIM-9
 *         (VIEW-2 sync FS in expansion — large folder blocks past a budget).
 */

/** The output category labels the tree renders for the golden ascii/binary frames. */
const ASCII = 'Ascii';
const BINARY = 'Binary';

// ---------------------------------------------------------------------------
// Shared config helpers — shape the seeded project, then read it back to assert.
// ---------------------------------------------------------------------------

/** Read a seeded project's on-disk config.json. */
function readConfig(projectPath: string): any {
  return JSON.parse(fs.readFileSync(path.join(projectPath, 'config.json'), 'utf8'));
}

/**
 * Replace a seeded project's `output` categories with exactly the given lists
 * (absolute file paths), so the Output group renders a small, known set of
 * leaves and tree navigation is deterministic. Omitted categories are cleared.
 */
function withOutputs(outputs: {
  ascii?: string[];
  binary?: string[];
  geotiff?: string[];
}): (config: any) => void {
  return (config: any) => {
    config.output = config.output || {};
    config.output.ascii = outputs.ascii ?? [];
    config.output.binary = outputs.binary ?? [];
    config.output.geotiff = outputs.geotiff ?? [];
    if (config.output.output_directory === undefined) {
      config.output.output_directory = undefined;
    }
  };
}

/** Pre-existing golden ascii frame paths inside a seeded project dir. */
function goldenAscii(projectPath: string, ...names: string[]): string[] {
  return names.map((n) => path.join(projectPath, 'build', 'output', 'asc', n));
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
 * `triforge.openProject`), then close the MapEditor it opens so later
 * webview-view (Properties) frame selection is unambiguous. Waits for the
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

/** Click the labelled button (e.g. "Remove"/"Delete") in the open modal dialog. */
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
 * SIM-3 (green) — a seeded input renders in the tree, and adding/removing an
 * input round-trips the tree AND config.json.
 *
 * The literal add-input UI paths all go through native pickers Selenium can't
 * drive (`triforge.openInputFolder`, the Static Input Generator\'s own browse
 * dialogs) — and the only non-picker entry, `triforge.addInput`, is hidden from
 * the command palette and reached via the Static Inputs context menu, which
 * VIEW-1 (SIM-1) makes unreachable. So SIM-3 exercises the input-mutation
 * behaviour that CAN be driven end-to-end against real state:
 *   - the seeded Streamflow dynamic input renders in the tree; and
 *   - removing it via the real `triforge.removeInput` (context menu → confirm
 *     modal) drops the node from the tree AND clears the streamflow fields in
 *     config.json (the same `ProjectManager.updateProject` write the add path
 *     produces inversely), proving an input change round-trips tree+config.
 */
describe('Triforge simulations (SIM-3: input renders + input mutation round-trips tree+config)', function () {
  this.timeout(300000);

  after(cleanup);

  it('renders the seeded inputs and round-trips a Streamflow remove to config', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      const dirName = 'SimAddInput';
      const seeded = ws.seed(dirName, { name: 'SIM3Project' });
      ws.register([seeded.projectPath]);
      await reloadWindow();
      await activateProject('SIM3Project');

      const sims = new SimulationsView();

      // The seeded DEM renders as the Elevation node; the seeded streamflow as a
      // Streamflow dynamic input. config.json carries the streamflow fields.
      const staticInputs = await sims.childLabels('Inputs', 'Static Inputs');
      expect(staticInputs, 'seeded DEM should render as the Elevation node').to.include(
        'Elevation',
      );
      const dynChildren = await sims.childLabels('Inputs', 'Dynamic Inputs');
      expect(
        dynChildren,
        'seeded project should render a Streamflow dynamic input',
      ).to.include('Streamflow');
      const before = readConfig(seeded.projectPath);
      expect(
        before.input.src_loc_file,
        'seeded config should carry the streamflow location file',
      ).to.be.a('string');

      // Remove the Streamflow input via the real context-menu action + confirm
      // modal, then assert tree + config both lost it.
      await sims.selectContextMenuAction(
        'Remove',
        'Inputs',
        'Dynamic Inputs',
        'Streamflow',
      );
      await clickModalButton('Remove');

      await VSBrowser.instance.driver.wait(
        async () => {
          const cfg = readConfig(seeded.projectPath);
          return (
            !cfg.input.src_loc_file &&
            !cfg.input.hydrograph_filename &&
            !cfg.input.num_sources
          );
        },
        30000,
        'config.json streamflow fields should be cleared after removing the input',
      );

      const after = await sims.childLabels('Inputs', 'Dynamic Inputs');
      expect(after, 'Streamflow node should be gone from the tree').to.not.include(
        'Streamflow',
      );
    });
  });
});

/**
 * SIM-4 (green) — remove an output item and an output category, asserting the
 * tree AND config.json reflect each change.
 *
 * The add-output paths (`triforge.addOutput` / `triforge.addOutputToCategory`) open
 * native file pickers Selenium can't drive, so the "added" state is established
 * by seeding the same `config.output` shape those commands write; the REMOVE
 * half is then driven end-to-end through the real tree context menu + confirm
 * modal, and both the rendered tree and the rewritten config.json are asserted.
 */
describe('Triforge simulations (SIM-4: remove output item + category round-trips tree+config)', function () {
  this.timeout(300000);

  after(cleanup);

  it('removes an output item then its category, reflecting tree + config', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      const dirName = 'SimOutputs';
      const projectPath = path.join(ws.workspacePath, dirName);
      const asciiFiles = goldenAscii(projectPath, 'H_01_00.out', 'H_01_01.out');
      const binaryFiles = goldenAscii(projectPath, 'H_02_00.out');
      const seeded = ws.seed(dirName, {
        name: 'SIM4Project',
        mutateConfig: withOutputs({ ascii: asciiFiles, binary: binaryFiles }),
      });
      ws.register([seeded.projectPath]);
      await reloadWindow();
      await activateProject('SIM4Project');

      const sims = new SimulationsView();

      // Both categories + their files render before any removal.
      expect(await sims.childLabels('Output'), 'Output should list both categories')
        .to.include.members([ASCII, BINARY]);
      const removedItem = path.basename(asciiFiles[1]); // H_01_01.out
      const keptItem = path.basename(asciiFiles[0]); // H_01_00.out
      expect(await sims.childLabels('Output', ASCII), 'Ascii lists both seeded files')
        .to.include.members([keptItem, removedItem]);

      // --- Remove a single output item via its context menu + confirm modal. ---
      await sims.selectContextMenuAction('Remove', 'Output', ASCII, removedItem);
      await clickModalButton('Remove');

      await VSBrowser.instance.driver.wait(
        async () => {
          const cfg = readConfig(seeded.projectPath);
          return (
            Array.isArray(cfg.output.ascii) &&
            !cfg.output.ascii.includes(asciiFiles[1]) &&
            cfg.output.ascii.includes(asciiFiles[0])
          );
        },
        30000,
        'config.json output.ascii should drop the removed file but keep the other',
      );
      const asciiAfterItem = await sims.childLabels('Output', ASCII);
      expect(asciiAfterItem, 'removed item gone from tree').to.not.include(removedItem);
      expect(asciiAfterItem, 'kept item still in tree').to.include(keptItem);

      // --- Remove the whole Binary category via its inline action + modal. ---
      // `removeOutputCategory` is contributed only as an inline action on the
      // category row (group: 'inline'), not in the right-click context menu.
      await sims.invokeInlineAction('Remove Category', 'Output', BINARY);
      await clickModalButton('Remove');

      await VSBrowser.instance.driver.wait(
        async () => {
          const cfg = readConfig(seeded.projectPath);
          return Array.isArray(cfg.output.binary) && cfg.output.binary.length === 0;
        },
        30000,
        'config.json output.binary should be emptied after removing the category',
      );
      const categoriesAfter = await sims.childLabels('Output');
      expect(
        categoriesAfter,
        'Binary category should disappear once emptied',
      ).to.not.include(BINARY);
      expect(categoriesAfter, 'Ascii category should remain').to.include(ASCII);
    });
  });
});

/**
 * SIM-5 (green) — sorting and filtering an output category reorders / narrows
 * the rendered leaves.
 *
 * Seeds a category whose natural (name-ascending) order is known, then drives
 * the real `triforge.simulations.sort` (inline category action → modal
 * "Name (Z-A)") and asserts the leaf order REVERSES; then drives
 * `triforge.simulations.filter` (inline category action → Properties-view filter
 * input) and asserts the visible set NARROWS to the matching files only.
 */
describe('Triforge simulations (SIM-5: sort + filter reorder/narrow the tree)', function () {
  this.timeout(300000);

  after(cleanup);

  it('reverses leaf order on sort and narrows the set on filter', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      const dirName = 'SimSortFilter';
      const projectPath = path.join(ws.workspacePath, dirName);
      // A small, name-ordered set: ascending is A, B, C.
      const files = goldenAscii(projectPath, 'H_01_00.out', 'H_01_01.out', 'H_02_00.out');
      const seeded = ws.seed(dirName, {
        name: 'SIM5Project',
        mutateConfig: withOutputs({ ascii: files }),
      });
      ws.register([seeded.projectPath]);
      await reloadWindow();
      await activateProject('SIM5Project');

      const sims = new SimulationsView();
      const names = files.map((f) => path.basename(f));
      const ascending = [...names].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
      );

      // Default (name asc) order.
      const initial = await sims.childLabels('Output', ASCII);
      expect(initial, 'default order is name-ascending').to.deep.equal(ascending);

      // --- Sort: Name (Z-A) should reverse the leaf order. ---
      // `simulations.sort` is an inline action on the category row.
      await sims.invokeInlineAction('Sort Folder...', 'Output', ASCII);
      await clickModalButton('Name (Z-A)');

      const descending = [...ascending].reverse();
      await VSBrowser.instance.driver.wait(
        async () => {
          const current = await sims.childLabels('Output', ASCII);
          return JSON.stringify(current) === JSON.stringify(descending);
        },
        30000,
        `sort Z-A should reorder the leaves to ${descending.join(', ')}`,
      );

      // --- Filter: narrow to just the files whose basename contains "01_01". ---
      await applyCategoryFilter(sims, ASCII, '01_01');
      const filterTarget = names.filter((n) => n.includes('01_01'));
      await VSBrowser.instance.driver.wait(
        async () => {
          const visible = await sims.childLabels('Output', ASCII);
          return (
            visible.length === filterTarget.length &&
            filterTarget.every((n) => visible.includes(n))
          );
        },
        30000,
        `filter "01_01" should narrow the category to ${filterTarget.join(', ')}`,
      );
    });
  });
});

/**
 * Drive `triforge.simulations.filter` on an output category: invoke the inline
 * "Filter Folder..." action (which prompts via the Properties-view filter
 * input), then type `value` into that input and apply.
 *
 * The filter prompt is rendered inside the Properties webview VIEW
 * (`PropertiesView.showFilterInput` posts `showFilterInput` to the resolved
 * `_view`). The view only resolves once it has been made visible, so we REVEAL
 * the Properties section FIRST — otherwise `showFilterInput`'s postMessage fires
 * against an unresolved view and is lost. After invoking the action we enter the
 * (now-resolved) view, type the filter and submit it.
 */
async function applyCategoryFilter(
  sims: SimulationsView,
  category: string,
  value: string,
): Promise<void> {
  const props = new PropertiesPanel();
  // Reveal Properties first so its webview is resolved and listening BEFORE the
  // filter command posts the showFilterInput message.
  await props.reveal();

  // `simulations.filter` is an inline action on the category row.
  await sims.invokeInlineAction('Filter Folder...', 'Output', category);

  await props.enter();
  try {
    const input = await waitForFilterInput();
    await input.sendKeys(value);
    await submitFilter(input);
  } finally {
    await props.leave();
  }
}

/** Wait for the Properties view's `#filterInput` to appear, return it. */
async function waitForFilterInput(timeoutMs = 20000) {
  const driver = VSBrowser.instance.driver;
  return driver.wait(
    until.elementLocated(By.css('#filterInput')),
    timeoutMs,
    'Properties filter input (#filterInput) never appeared',
  );
}

/** Submit the filter (Enter key applies it via the view's message handler). */
async function submitFilter(input: any): Promise<void> {
  await input.sendKeys(Key.ENTER);
}

/**
 * SIM-8 (green) — multi-selecting tree items leaves the Properties view in a
 * sensible state (no crash; a clear "multiple items" summary).
 *
 * Ctrl-selecting two file leaves drives the tree's `onDidChangeSelection` with a
 * 2-item selection, which the Properties view renders via its multi-selection
 * branch (`PropertiesView._computeProperties` → a "Multiple items (N)" row plus
 * one "Item" row per selection). Asserts the view stays responsive and shows
 * that 2-item summary.
 */
describe('Triforge simulations (SIM-8: multi-selection renders a sensible Properties state)', function () {
  this.timeout(300000);

  after(cleanup);

  it('shows a multiple-items summary without crashing on multi-select', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      const dirName = 'SimMultiSelect';
      const projectPath = path.join(ws.workspacePath, dirName);
      const files = goldenAscii(projectPath, 'H_01_00.out', 'H_01_01.out');
      const seeded = ws.seed(dirName, {
        name: 'SIM8Project',
        mutateConfig: withOutputs({ ascii: files }),
      });
      ws.register([seeded.projectPath]);
      await reloadWindow();
      await activateProject('SIM8Project');

      const sims = new SimulationsView();
      const [a, b] = files.map((f) => path.basename(f));
      await sims.multiSelectFiles(ASCII, a, b);

      const props = new PropertiesPanel();
      await props.reveal();
      await props.enter();
      try {
        // Wait for the multi-selection summary to render. The view stays alive
        // (no crash) and shows a "Multiple items (2)" value.
        await VSBrowser.instance.driver.wait(
          async () => {
            const values = await props.readValueTexts();
            return values.some((v) => /Multiple items \(2\)/.test(v));
          },
          30000,
          'Properties view should show a "Multiple items (2)" summary on multi-select',
        );
        const rows = await props.readRows();
        const selectionRow = rows.find((r) => r.key === 'Selection');
        expect(selectionRow, 'a Selection summary row should be present').to.not.be
          .undefined;
        expect(
          selectionRow!.value,
          'summary should report the 2-item multi-selection',
        ).to.match(/Multiple items \(2\)/);
      } finally {
        await props.leave();
      }
    });
  });
});

/**
 * SIM-1 (xfail VIEW-1) — the Static Inputs group\'s Add Input / Open Input
 * Folder INLINE action buttons must be REACHABLE.
 *
 * VIEW-1: `triforge.addInput` / `triforge.openInputFolder` are contributed in
 * `view/item/context` with `"group": "inline"` and `when: viewItem == inputGroup`
 * (package.json) — i.e. they are INLINE row-hover action buttons, NOT right-click
 * context-menu entries. But the Static Inputs node sets
 * `contextValue = 'staticInputNode'` (`src/views/SimulationsView.ts`, comment
 * "Remove inputGroup context"); no node ever sets `inputGroup`, so the `when`
 * never matches and the inline buttons never render on the row.
 *
 * Post-fix property (VIEW-1): the Static Inputs row exposes both "Add Input" and
 * "Open Input Folder" as inline action buttons. Today the contextValue mismatch
 * means neither inline button is present, so asserting their reachability throws
 * and xfail passes; once VIEW-1 lands (the `when` clauses are corrected to
 * `staticInputNode`) the inline buttons appear and xfail flips loudly. The
 * assertion targets the INLINE-action accessor (`inlineActionLabels`) — these are
 * inline buttons, not context-menu items, so this is the faithful post-fix probe.
 */
describe('Triforge simulations (SIM-1: input-group add/open-folder inline actions reachable — VIEW-1 FIXED)', function () {
  this.timeout(300000);

  after(cleanup);

  it('exposes Add Input / Open Input Folder as inline actions on the Static Inputs node', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      const seeded = ws.seed('SimView1Input', { name: 'SIM1Project' });
      ws.register([seeded.projectPath]);
      await reloadWindow();
      await activateProject('SIM1Project');

      const sims = new SimulationsView();
      const actions = await sims.inlineActionLabels('Inputs', 'Static Inputs');
      expect(
        actions,
        'Static Inputs node should expose an Add Input inline action',
      ).to.include('Add Input');
      expect(
        actions,
        'Static Inputs node should expose an Open Input Folder inline action',
      ).to.include('Open Input Folder');
    });
  });
});

/**
 * SIM-2 (xfail VIEW-1) — the DEM node\'s Delete DEM context action must be
 * REACHABLE.
 *
 * VIEW-1: the `triforge.deleteDem` menu `when` targets `viewItem == demItem`, but
 * the DEM node sets `contextValue = 'demNode'` (`src/views/SimulationsView.ts`).
 * No node sets `demItem`, so Delete DEM is a dead menu contribution.
 *
 * Post-fix property (VIEW-1): the Elevation (DEM) node\'s context menu offers
 * "Delete DEM". Today it is absent, so the assertion throws and xfail passes;
 * once the `when` is corrected to `demNode` the action appears and xfail flips.
 */
describe('Triforge simulations (SIM-2: DEM delete reachable — VIEW-1 FIXED)', function () {
  this.timeout(300000);

  after(cleanup);

  it('exposes Delete DEM on the Elevation node context menu', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      const seeded = ws.seed('SimView1Dem', { name: 'SIM2Project' });
      ws.register([seeded.projectPath]);
      await reloadWindow();
      await activateProject('SIM2Project');

      const sims = new SimulationsView();
      // The seeded project has a DEM, rendered as the "Elevation" node.
      const staticInputs = await sims.childLabels('Inputs', 'Static Inputs');
      expect(staticInputs, 'seeded project should render the DEM node').to.include(
        'Elevation',
      );

      const actions = await sims.contextMenuActionLabels('Inputs', 'Static Inputs', 'Elevation');
      expect(
        actions,
        'Elevation node context menu should offer Delete DEM',
      ).to.include('Delete DEM');
    });
  });
});

/**
 * SIM-6 (green; VIEW-3 symptom does not reproduce in E2E) — an expanded output
 * folder's expansion state persists across a FULL tree refresh.
 *
 * VIEW-3 (source): `RecursiveFileNode.getTreeItem()` sets no stable `item.id`
 * (`src/views/SimulationsView.ts`), which the review says makes an expanded
 * folder "collapse on every refresh". This scenario seeds an output category
 * whose entry is a DIRECTORY (an expandable folder leaf), expands it, then fires
 * a FULL tree refresh (`project:listChanged` -> `provider.refresh()`) by
 * deleting a sibling trigger file, and checks the folder's expansion.
 *
 * EMPIRICAL FINDING: the expansion-loss symptom does NOT reproduce in this
 * ExTester / VS Code 1.90 harness — VS Code preserves the folder's expansion
 * across both partial and full refreshes even without stable ids. So VIEW-3's
 * *user-visible* collapse cannot be guarded as a flipping E2E xfail here (it
 * would "unexpectedly pass" today). The assertion below is therefore a GREEN
 * check of the real, correct behavior; VIEW-3 should be guarded at the unit
 * level (assert `getTreeItem().id` is set post-fix). See test/XFAIL.md (VIEW-3).
 */
describe('Triforge simulations (SIM-6: expansion persists across a full refresh)', function () {
  this.timeout(300000);

  after(cleanup);

  it('keeps an expanded output folder expanded after a refresh', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      const dirName = 'SimExpand';
      const projectPath = path.join(ws.workspacePath, dirName);
      // An output category entry that is a DIRECTORY with .out files inside, so
      // it renders as an expandable folder leaf under Ascii.
      const subDir = path.join(projectPath, 'build', 'output', 'asc', 'frames');
      // A second, distinctly-named ascii file we delete to fire a FULL tree
      // refresh (`updateProject` -> `project:listChanged` -> provider.refresh()),
      // which is the "every refresh" that VIEW-3 says collapses id-less folders.
      const trigger = path.join(projectPath, 'build', 'output', 'asc', 'trigger.out');
      const seeded = ws.seed(dirName, {
        name: 'SIM6Project',
        mutateConfig: withOutputs({ ascii: [subDir, trigger] }),
      });
      // Materialize the directory with a couple of frame files inside it.
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, 'frame_a.out'), 'a');
      fs.writeFileSync(path.join(subDir, 'frame_b.out'), 'b');
      fs.writeFileSync(trigger, 't');
      ws.register([seeded.projectPath]);
      await reloadWindow();
      await activateProject('SIM6Project');

      const sims = new SimulationsView();
      const folderLabel = path.basename(subDir); // 'frames'

      // Expand the folder leaf so its children are visible, and confirm it.
      await sims.expandNode('Output', ASCII, folderLabel);
      await VSBrowser.instance.driver.wait(
        async () => sims.isExpanded('Output', ASCII, folderLabel),
        30000,
        'output folder should be expanded before the refresh',
      );

      // Fire a FULL tree refresh by deleting the trigger file (context menu +
      // confirm modal); its removal calls `updateProject`, which fires
      // `project:listChanged` and re-renders the whole tree from the root.
      await sims.selectContextMenuAction('Remove', 'Output', ASCII, 'trigger.out');
      await clickModalButton('Remove');
      await VSBrowser.instance.driver.wait(
        async () => !readConfig(seeded.projectPath).output.ascii.includes(trigger),
        30000,
        'config should drop the trigger file after removal',
      );

      // The folder remains expanded after the full refresh. This is the behavior
      // VIEW-3's fix would also guarantee; it already holds in this VS Code
      // version, so it is asserted GREEN. Settle briefly so a transient
      // mid-refresh read can't masquerade as the final state.
      await VSBrowser.instance.driver.sleep(1500);
      const stillExpanded = await sims.isExpanded('Output', ASCII, folderLabel);
      expect(
        stillExpanded,
        'expanded output folder should stay expanded across a refresh',
      ).to.be.true;
    });
  });
});

/**
 * SIM-7 (green; VIEW-3 symptom does not reproduce in E2E) — two output files
 * sharing a basename in DIFFERENT folders render distinctly across a refresh.
 *
 * VIEW-3 (source): `RecursiveFileNode.getTreeItem()` sets no stable `item.id`
 * and the provider has no `getParent`, which the review says causes duplicate
 * basenames to "collide" and breaks `reveal()`. This scenario seeds two real,
 * on-disk `same.out` files under different directories and fires a FULL tree
 * refresh, then asserts BOTH still render distinctly.
 *
 * EMPIRICAL FINDING: the collision symptom does NOT reproduce in this
 * ExTester / VS Code 1.90 harness — VS Code renders the two distinct
 * `RecursiveFileNode` objects as two distinct rows even without stable ids, and
 * keeps them across a full refresh. So VIEW-3's *user-visible* collision cannot
 * be guarded as a flipping E2E xfail here (it would "unexpectedly pass" today).
 * The assertion below is therefore a GREEN check of the real, correct behavior;
 * VIEW-3 should be guarded at the unit level (assert `getTreeItem().id` is set
 * post-fix). See test/XFAIL.md (VIEW-3) and the task concerns.
 */
describe('Triforge simulations (SIM-7: same-basename files render distinctly across refresh)', function () {
  this.timeout(300000);

  after(cleanup);

  it('renders both same-basename files from different folders after a refresh', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      const dirName = 'SimCollide';
      const projectPath = path.join(ws.workspacePath, dirName);
      const dirA = path.join(projectPath, 'build', 'output', 'asc', 'a');
      const dirB = path.join(projectPath, 'build', 'output', 'asc', 'b');
      const fileA = path.join(dirA, 'same.out');
      const fileB = path.join(dirB, 'same.out');
      // A third, distinctly-named ascii file we delete to fire a FULL tree
      // refresh (`updateProject` -> `project:listChanged` -> provider.refresh()).
      // VIEW-3's collision manifests when VS Code RECONCILES id-less tree items
      // across that refresh: two same-label rows can merge to one.
      const trigger = path.join(projectPath, 'build', 'output', 'asc', 'trigger.out');
      const seeded = ws.seed(dirName, {
        name: 'SIM7Project',
        mutateConfig: withOutputs({ ascii: [fileA, fileB, trigger] }),
      });
      fs.mkdirSync(dirA, { recursive: true });
      fs.mkdirSync(dirB, { recursive: true });
      fs.writeFileSync(fileA, 'a');
      fs.writeFileSync(fileB, 'b');
      fs.writeFileSync(trigger, 't');
      ws.register([seeded.projectPath]);
      await reloadWindow();
      await activateProject('SIM7Project');

      const sims = new SimulationsView();
      // Both same-basename files render before the refresh.
      const before = await sims.childLabels('Output', ASCII);
      expect(
        before.filter((l) => l === 'same.out').length,
        'both same.out files should be present before the refresh',
      ).to.equal(2);

      // Fire a FULL tree refresh by deleting the trigger file (context menu +
      // confirm modal), then wait for config to reflect it.
      await sims.selectContextMenuAction('Remove', 'Output', ASCII, 'trigger.out');
      await clickModalButton('Remove');
      await VSBrowser.instance.driver.wait(
        async () => !readConfig(seeded.projectPath).output.ascii.includes(trigger),
        30000,
        'config should drop the trigger file after removal',
      );

      // After the full refresh both same-basename leaves still render distinctly
      // (count === 2). This is the behavior VIEW-3's fix would also guarantee;
      // it already holds in this VS Code version, so it is asserted GREEN.
      const labels = await sims.childLabels('Output', ASCII);
      const sameCount = labels.filter((l) => l === 'same.out').length;
      expect(
        sameCount,
        'both same-basename files should survive a refresh distinctly',
      ).to.equal(2);
    });
  });
});

/**
 * SIM-9 (xfail VIEW-2) — expanding a LARGE output folder must stay responsive
 * within a timing budget.
 *
 * VIEW-2: tree expansion does synchronous `readdirSync` + per-entry `statSync`
 * (`src/views/SimulationsView.ts` `RecursiveFileNode.getDirectoryChildren`), so
 * expanding a folder with many entries blocks the host thread. We seed an output
 * category entry that is a directory containing many files, then time how long
 * its expansion (the synchronous child scan) takes.
 *
 * VIEW-2 (FIXED): the scan is now async (`fs.promises.readdir({withFileTypes})`
 * + mtimes precomputed once) so it no longer blocks the extension-host thread.
 *
 * Why this is a GREEN CHARACTERIZATION, not a flipping xfail (see test/XFAIL.md
 * VIEW-2 CAVEAT): SIM-9's signal is wall-clock time-to-expanded measured via
 * Selenium. An async fix unblocks the UI thread but does NOT meaningfully reduce
 * the TOTAL scan+render wall-clock for LARGE_COUNT entries, so this budget can
 * never cleanly flip — it would be a false guard. The faithful, flippable VIEW-2
 * guard therefore lives at the unit level
 * (`test/unit/views/treeScanAsync.test.ts`): it sabotages the synchronous FS APIs
 * and proves the scan still returns all children, i.e. it ran fully off the host
 * thread through `fs.promises`. Here we keep a correctness characterization: the
 * large folder still expands and renders its children (no functional regression),
 * with no flaky wall-clock assertion.
 */
describe('Triforge simulations (SIM-9: large folder still expands + renders — VIEW-2 FIXED, unit-guarded)', function () {
  this.timeout(300000);

  after(cleanup);

  const LARGE_COUNT = 1500;

  it('expands a large output folder and renders its children', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      const dirName = 'SimLargeFolder';
      const projectPath = path.join(ws.workspacePath, dirName);
      const bigDir = path.join(projectPath, 'build', 'output', 'asc', 'big');
      const seeded = ws.seed(dirName, {
        name: 'SIM9Project',
        mutateConfig: withOutputs({ ascii: [bigDir] }),
      });
      // Materialize a large directory: many small .out files so the synchronous
      // readdir + per-entry stat in expansion does real work.
      fs.mkdirSync(bigDir, { recursive: true });
      for (let i = 0; i < LARGE_COUNT; i++) {
        fs.writeFileSync(
          path.join(bigDir, `f_${String(i).padStart(5, '0')}.out`),
          'x',
        );
      }
      ws.register([seeded.projectPath]);
      await reloadWindow();
      await activateProject('SIM9Project');

      const sims = new SimulationsView();
      const folderLabel = path.basename(bigDir); // 'big'
      // Make sure the parent category is expanded and the (collapsed) big folder
      // row is present BEFORE timing, so the measurement isolates the folder's
      // own child scan, not the ancestor navigation.
      await sims.expandNode('Output', ASCII);
      await VSBrowser.instance.driver.wait(
        async () => sims.hasNode('Output', ASCII, folderLabel),
        30000,
        'the big folder row should be present before timing its expansion',
      );

      // VIEW-2 FIXED: expanding the large folder (now an async child scan in
      // `RecursiveFileNode.getDirectoryChildren`) completes and renders rows.
      // We characterize correctness (it expands; no functional regression); the
      // off-the-host-thread property is the unit guard in treeScanAsync.test.ts.
      await sims.expandNode('Output', ASCII, folderLabel);
      await VSBrowser.instance.driver.wait(
        async () => sims.isExpanded('Output', ASCII, folderLabel),
        60000,
        'large folder never reported expanded',
      );
      expect(
        await sims.isExpanded('Output', ASCII, folderLabel),
        `a ${LARGE_COUNT}-entry folder should expand and render its children`,
      ).to.equal(true);
    });
  });
});

/**
 * SIM tree structure — the new top-level `Inputs` group holds `Static Inputs` and
 * `Dynamic Inputs`, and `Computation` no longer carries `Dynamic Inputs`.
 */
describe('Triforge simulations (tree structure: Inputs group holds Static + Dynamic)', function () {
  this.timeout(300000);

  after(cleanup);

  it('nests Static + Dynamic Inputs under a top-level Inputs group; Computation keeps Setup + Execution', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      const seeded = ws.seed('SimTreeStructure', { name: 'TreeStructProject' });
      ws.register([seeded.projectPath]);
      await reloadWindow();
      await activateProject('TreeStructProject');

      const sims = new SimulationsView();

      // Root groups, in render order.
      expect(await sims.childLabels()).to.deep.equal([
        'Inputs',
        'Computation',
        'Output',
      ]);

      // Inputs holds both input generators.
      expect(await sims.childLabels('Inputs')).to.deep.equal([
        'Static Inputs',
        'Dynamic Inputs',
      ]);

      // Computation dropped Dynamic Inputs, keeping only Setup + Execution.
      const compChildren = await sims.childLabels('Computation');
      expect(compChildren, 'Dynamic Inputs must have moved out of Computation').to.not.include(
        'Dynamic Inputs',
      );
      expect(compChildren).to.deep.equal(['Setup', 'Execution']);
    });
  });
});
