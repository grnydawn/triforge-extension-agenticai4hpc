import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { By, VSBrowser } from 'vscode-extension-tester';

import { ExecutionSetup } from '../../pageobjects/ExecutionSetup.ts';
import { ProjectsView } from '../../pageobjects/ProjectsView.ts';
import { closeAllEditors, reloadWindow, resetToWorkbench } from '../../pageobjects/workbench.ts';
import { withTempWorkspace } from '../../helpers/seed.ts';

/** Count *.out / *.vrt output frames anywhere under `dir`. */
function countOutFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) n += countOutFiles(full);
    else if (e.name.endsWith('.out') || e.name.endsWith('.vrt')) n++;
  }
  return n;
}

/** Dismiss any open modal dialog (.monaco-dialog-box) by clicking OK/Close. Runs at the top frame. */
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

/** Activate a seeded project: wait for the tree item, open it, wait until active. */
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

/**
 * Output normalization (Option 3): a successful run relocates TRITON's outputs
 * from build/output into the canonical <project>/output and pins
 * output_directory there — so the AI manifest and downstream tools see real
 * results in one predictable place (and the old build/output-sticky bug is gone).
 */
describe('Output normalization (sim results land in <project>/output)', function () {
  this.timeout(300000);

  after(async () => {
    await dismissModals().catch(() => undefined);
    await resetToWorkbench().catch(() => undefined);
  });

  it('relocates outputs to <project>/output and pins output_directory after a run', async () => {
    await resetToWorkbench();
    await withTempWorkspace(
      async ({ projectPath, projectName }) => {
        await reloadWindow();
        await activateProject(projectName);

        const canonical = path.join(projectPath, 'output');
        const buildOutput = path.join(projectPath, 'build', 'output');
        // Precondition: the seed stages frames under build/output, NOT <project>/output.
        expect(
          countOutFiles(buildOutput),
          'seed should stage golden frames under build/output',
        ).to.be.greaterThan(0);

        // Ensure the command palette can open: top frame, no lingering modal, settle.
        await VSBrowser.instance.driver.switchTo().defaultContent().catch(() => undefined);
        await dismissModals();
        await VSBrowser.instance.driver.sleep(1500);

        const exe = new ExecutionSetup();
        const opened = await exe.open();
        expect(opened, 'Execution Setup should open for a valid target').to.equal(true);
        try {
          await exe.selectExecutionType('interactive');
          // Use the project's default run_directory (<project>/build) — do NOT override.
          await exe.clickRun();
          await exe.waitForLog('Simulation finished', 120000);
          // _updateOutputPaths runs on exit 0: relocation + scan are logged here.
          await exe.waitForLog('Successfully added', 120000);
        } finally {
          await exe.leave();
        }

        // Relocation: frames now under the canonical <project>/output.
        await VSBrowser.instance.driver.wait(
          async () => countOutFiles(canonical) > 0,
          15000,
          `outputs were not relocated into ${canonical}`,
        );
        expect(
          countOutFiles(canonical),
          'frames should be relocated to <project>/output',
        ).to.be.greaterThan(0);

        // Pinning: output_directory is the canonical dir, NOT build/output (the old bug).
        const cfg = JSON.parse(fs.readFileSync(path.join(projectPath, 'config.json'), 'utf8'));
        expect(
          cfg.output.output_directory,
          'output_directory must be pinned to <project>/output',
        ).to.equal(canonical);

        // The AI manifest advertises the canonical output directory.
        const md = fs.readFileSync(path.join(projectPath, 'AGENTS.md'), 'utf8');
        expect(md, 'AGENTS.md should reference the canonical output dir').to.include(canonical);
      },
      { executableTarget: true },
    );
  });
});
