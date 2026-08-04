import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { VSBrowser } from 'vscode-extension-tester';
import { ProjectsView } from '../../pageobjects/ProjectsView.ts';
import { SimulationsView } from '../../pageobjects/SimulationsView.ts';
import { PropertiesPanel } from '../../pageobjects/PropertiesPanel.ts';
import { closeAllEditors, reloadWindow, resetToWorkbench } from '../../pageobjects/workbench.ts';
import { withTempMultiWorkspace } from '../../helpers/seed.ts';

/**
 * Properties webview-view E2E suite (PROP-1/2/3).
 *
 * Each scenario seeds a ready golden project whose `Output > Ascii` category
 * carries a controlled file list, reloads the window (the extension only loads
 * the project registry at `activate()`), activates the project, then selects a
 * FILE leaf in the Simulations tree. Selecting a file fires the tree's
 * `onDidChangeSelection` -> `properties:update` EventBus event, and the
 * Properties webview-view (`triforge-properties`) renders one row per
 * `PropertyItem` returned by the file node's `getProperties()`
 * (`src/views/SimulationsView.ts` `RecursiveFileNode.getProperties`).
 *
 * - PROP-1 (green): a real, on-disk file renders Name/Path/Type/Size correctly.
 * - PROP-2 (green, BUG-4 FIXED): a registered-but-missing file made
 *   `getProperties()` call `fs.statSync` on a non-existent path, which threw —
 *   the panel never rendered the file's row. The guarded statSync now degrades
 *   gracefully and still renders the file's Name row.
 * - PROP-3 (xfail SEC-3): a file whose name carries an HTML payload is
 *   interpolated unescaped into the view's `innerHTML`, rendering live. Post-fix
 *   it should be inert text.
 */

/** The category that holds the project's ASCII output files in the tree. */
const ASCII_CATEGORY = 'Ascii';

/**
 * Replace a seeded project's config `output.ascii` with exactly `files` (and
 * clear `binary`), so the `Output > Ascii` category contains a small, known set
 * of leaves and tree navigation is deterministic. Returns a `mutateConfig`
 * suitable for the seed helper.
 */
function withAsciiOutputs(files: string[]): (config: any) => void {
  return (config: any) => {
    config.output = config.output || {};
    config.output.ascii = files;
    config.output.binary = [];
  };
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
 * Activate the seeded project (selecting it in the Projects tree fires
 * `triforge.openProject`), close the MapEditor it opens so the Properties view is
 * the ONLY webview ExTester can switch into, then select the named output file
 * in the Simulations tree and enter the (now-populated) Properties view.
 *
 * Returns the entered {@link PropertiesPanel}; the caller must `leave()` it.
 */
async function selectFileAndOpenProperties(
  projectName: string,
  category: string,
  fileLabel: string,
): Promise<PropertiesPanel> {
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

  // Close the MapEditor opened on project activation FIRST, so the Properties
  // view is the only webview ExTester's WebviewView can switch into (otherwise
  // it grabs the larger MapEditor frame by rect). Closing editors touches only
  // the editor area, not the sidebar tree, so the file selection below is fresh.
  await closeAllEditors();

  // Select the file leaf in the Simulations tree -> fires properties:update.
  const sims = new SimulationsView();
  await sims.selectOutputFile(category, fileLabel);

  const props = new PropertiesPanel();
  await props.reveal();
  await props.enter();
  return props;
}

/** Wait until the (entered) Properties view renders a row whose key === `key`. */
async function waitForPropertyKey(
  props: PropertiesPanel,
  key: string,
  timeoutMs = 30000,
): Promise<void> {
  await VSBrowser.instance.driver.wait(
    async () => (await props.readKeyTexts()).includes(key),
    timeoutMs,
    `Properties view never rendered a "${key}" row`,
  );
}

/**
 * PROP-1 (green) — selecting a real file shows its Name/Path/Type/Size.
 *
 * Seeds a project whose Ascii category holds a single, on-disk golden `.out`
 * file, activates it, selects the file in the Simulations tree, and asserts the
 * Properties view renders the file's real Name (basename), Path (the absolute
 * file path), Type (the extension) and Size (the on-disk size in KB, computed
 * from the seeded file so the assertion tracks reality).
 */
describe('Triforge properties (PROP-1: selecting a file shows name/path/type/size)', function () {
  this.timeout(300000);

  after(cleanup);

  it('renders the selected file name, path, type and size', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      const dirName = 'PropProject';
      const projectPath = path.join(ws.workspacePath, dirName);
      // Single Ascii file, materialized on disk by the golden copy.
      const filePath = path.join(projectPath, 'build', 'output', 'asc', 'H_01_00.out');
      const seeded = ws.seed(dirName, {
        name: 'PROP1Project',
        mutateConfig: withAsciiOutputs([filePath]),
      });
      ws.register([seeded.projectPath]);
      await reloadWindow();

      const fileName = path.basename(filePath);
      const expectedType = path.extname(fileName); // '.out'
      const sizeKB = `${(fs.statSync(filePath).size / 1024).toFixed(2)} KB`;

      const props = await selectFileAndOpenProperties('PROP1Project', ASCII_CATEGORY, fileName);
      try {
        await waitForPropertyKey(props, 'Name');
        const rows = await props.readRows();
        const get = (k: string) => rows.find((r) => r.key === k)?.value;

        expect(get('Name'), 'Name row should be the file basename').to.equal(fileName);
        expect(get('Path'), 'Path row should be the absolute file path').to.equal(filePath);
        expect(get('Type'), 'Type row should be the file extension').to.equal(expectedType);
        expect(get('Size'), 'Size row should be the on-disk size in KB').to.equal(sizeKB);
      } finally {
        await props.leave();
      }
    });
  });
});

/**
 * PROP-2 (green, BUG-4 FIXED) — selecting a missing file degrades gracefully.
 *
 * `RecursiveFileNode.getProperties()` called `fs.statSync(this.fullPath)` with no
 * guard (`src/views/SimulationsView.ts`). We register a `.out` file in the Ascii
 * category whose path is NOT created on disk; the tree still renders the leaf
 * (it only `existsSync`-checks to decide isDir), so selecting it drives the
 * panel to stat a non-existent path. Before the fix statSync threw before any
 * row was built, so the Properties view never rendered the file's `Name` row.
 *
 * Post-fix property (BUG-4): the view degrades gracefully — no crash; it still
 * renders a sensible state for the missing file (at minimum its `Name` row).
 * statSync is now wrapped in try/catch, so the Name/Path/Type rows are built
 * even when the file is missing and the bare assertion below guards that.
 */
describe('Triforge properties (PROP-2: missing file degrades gracefully — BUG-4 FIXED)', function () {
  this.timeout(300000);

  after(cleanup);

  it('does not crash and shows a sensible state when the file is missing', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      const dirName = 'MissingProject';
      const projectPath = path.join(ws.workspacePath, dirName);
      // A registered output file path that is deliberately NOT created on disk.
      const missingName = 'PROP2_missing.out';
      const missingPath = path.join(projectPath, 'build', 'output', 'asc', missingName);
      const seeded = ws.seed(dirName, {
        name: 'PROP2Project',
        mutateConfig: withAsciiOutputs([missingPath]),
      });
      ws.register([seeded.projectPath]);
      // Be certain the file does not exist (the golden copy only creates the
      // golden frames, never this name — but assert it to keep the test honest).
      expect(fs.existsSync(missingPath), 'missing file must not exist on disk').to.be.false;
      await reloadWindow();

      const props = await selectFileAndOpenProperties(
        'PROP2Project',
        ASCII_CATEGORY,
        missingName,
      );
      try {
        // Post-fix (BUG-4): even for a missing file the panel renders gracefully
        // and shows the file's Name row (degraded but not crashed). statSync is
        // now guarded, so the Name/Path/Type rows are built regardless.
        await waitForPropertyKey(props, 'Name', 15000);
        const name = await props.valueForKey('Name');
        expect(
          name,
          'Properties view should still show the missing file name (graceful degradation)',
        ).to.equal(missingName);
      } finally {
        await props.leave();
      }
    });
  });
});

/**
 * PROP-3 (xfail SEC-3) — a file name carrying HTML must render as inert text.
 *
 * The Properties view builds each row by string-interpolating the property
 * key/value straight into `innerHTML` with NO escaping (`renderProperties` in
 * `src/views/PropertiesHtml.ts`). We seed a real, on-disk `.out` file whose
 * BASENAME embeds an HTML sentinel element; selecting it sets the `Name` value
 * to that basename, which is then injected live into the panel DOM.
 *
 * Post-fix property (SEC-3): the name is rendered as inert text — the injected
 * sentinel element does NOT exist in the Properties DOM, and the displayed value
 * equals the literal basename. Today it is unescaped, so the sentinel element IS
 * present -> the safety assertion throws -> xfail passes. When SEC-3 lands the
 * sentinel is gone and xfail flips loudly.
 */
describe('Triforge properties (PROP-3: file-name HTML payload stays inert — SEC-3 FIXED)', function () {
  this.timeout(300000);

  after(cleanup);

  // A sentinel element smuggled into the basename. No '/' (illegal in file
  // names) and attribute left unquoted, mirroring PRJ-2: the unescaped value is
  // interpolated into the row's innerHTML, so the `<span id=prop3-pwned>` parses
  // into a real element today. The plain prefix makes the leaf easy to match.
  const SENTINEL_PREFIX = 'PROP3pwn';
  const PAYLOAD_NAME = `${SENTINEL_PREFIX}<span id=prop3-pwned>x.out`;

  it('renders an HTML-payload file name as inert text in the Properties view', async () => {
    await resetToWorkbench();
    await withTempMultiWorkspace(async (ws) => {
      const dirName = 'EvilFileProject';
      const projectPath = path.join(ws.workspacePath, dirName);
      const asciiDir = path.join(projectPath, 'build', 'output', 'asc');
      const payloadPath = path.join(asciiDir, PAYLOAD_NAME);
      const seeded = ws.seed(dirName, {
        name: 'PROP3Project',
        mutateConfig: withAsciiOutputs([payloadPath]),
      });
      // Materialize the payload-named file on disk so statSync succeeds and the
      // Name row (carrying the payload) actually renders.
      fs.mkdirSync(asciiDir, { recursive: true });
      fs.writeFileSync(payloadPath, 'payload\n');
      ws.register([seeded.projectPath]);
      await reloadWindow();

      const props = await selectFileAndOpenProperties(
        'PROP3Project',
        ASCII_CATEGORY,
        PAYLOAD_NAME,
      );
      try {
        // Ensure the file's rows rendered before asserting, so the xfail reflects
        // the rendered (unescaped) DOM rather than an empty view.
        await waitForPropertyKey(props, 'Name');
        // SEC-3 FIXED (T2): the injected sentinel element must NOT exist in the DOM...
        const injected = await props.hasElement('#prop3-pwned');
        expect(
          injected,
          'injected sentinel element must not be rendered in the Properties view',
        ).to.be.false;
        // ...and the displayed Name should be the literal payload basename.
        const name = await props.valueForKey('Name');
        expect(
          name,
          'file name should render as the literal payload string',
        ).to.equal(PAYLOAD_NAME);
      } finally {
        await props.leave();
      }
    });
  });
});
