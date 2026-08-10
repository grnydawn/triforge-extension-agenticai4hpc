import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VSBrowser } from 'vscode-extension-tester';
import { Settings } from '../../pageobjects/Settings.ts';
import { globalSettingsFile } from '../../helpers/seed.ts';

/**
 * SET-6 — the global-settings page reuses a workspace folder that ALREADY EXISTS
 * instead of rejecting it. Pre-change, an existing path that differs from the
 * currently-saved one was rejected ("...already exists..."); post-change it is
 * reused (its projects.json is picked up on load). We drive the real Settings
 * webview and assert the persisted global_settings.json points at the existing dir.
 */
describe('Triforge settings (SET-6: reuse an existing workspace folder)', function () {
  this.timeout(180000);

  let workspacePath: string;

  before(async () => {
    await VSBrowser.instance.waitForWorkbench();
    // A workspace dir that already exists before setup runs.
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'triforge-e2e-set6-'));
  });

  after(() => {
    try {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it('saves settings pointing at a pre-existing folder (reuse, no rejection)', async () => {
    const userName = 'SET-6 User';
    const email = 'set6@triforge.test';

    const settings = new Settings();
    await settings.open();
    await settings.setUserName(userName);
    await settings.setEmail(email);
    await settings.setWorkspacePath(workspacePath);
    await settings.save();

    // Reuse succeeded → persisted settings point at the pre-existing folder.
    const file = globalSettingsFile();
    await VSBrowser.instance.driver.wait(
      async () =>
        fs.existsSync(file) &&
        JSON.parse(fs.readFileSync(file, 'utf8')).workspacePath === workspacePath,
      20000,
      'settings should persist with the reused (pre-existing) workspace path',
    );
    const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(persisted.workspacePath).to.equal(workspacePath);
    expect(persisted.userName).to.equal(userName);
  });
});
