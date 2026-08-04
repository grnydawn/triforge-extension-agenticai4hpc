import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { By, until, VSBrowser, Workbench } from 'vscode-extension-tester';
import { Settings } from '../../pageobjects/Settings.ts';
import { globalSettingsFile, withTempWorkspace } from '../../helpers/seed.ts';
import { reloadWindow } from '../../pageobjects/workbench.ts';

/**
 * Confirm the in-workbench modal warning shown by `triforge.resetSettings`
 * (`showWarningMessage({ modal: true })` renders as a `.monaco-dialog-box`).
 *
 * We drive it at the driver level (rather than via the `ModalDialog` page object)
 * so the wait timeouts are explicit and the exact "Yes" button is located by its
 * visible label — clicking it both confirms the reset and dismisses the modal.
 */
async function confirmResetDialog(): Promise<void> {
  const driver = VSBrowser.instance.driver;
  const dialog = await driver.wait(
    until.elementLocated(By.className('monaco-dialog-box')),
    20000,
    'reset confirmation dialog (.monaco-dialog-box) did not appear',
  );
  await driver.wait(until.elementIsVisible(dialog), 20000);

  // Find the "Yes" button among the dialog's text buttons and click it.
  const buttons = await dialog.findElements(By.className('monaco-text-button'));
  for (const button of buttons) {
    const label = (await button.getText()).trim();
    if (label === 'Yes') {
      await button.click();
      // Wait for the modal to disappear so later tests start from a clean frame.
      await driver.wait(
        async () =>
          (await driver.findElements(By.className('monaco-dialog-box'))).length === 0,
        20000,
        'reset confirmation dialog did not close after clicking "Yes"',
      );
      return;
    }
  }
  throw new Error('reset confirmation dialog had no "Yes" button');
}

/**
 * SET-1 — first-run: settings open and persist.
 *
 * Drives the real Settings webview (`triforge.openSettings`), fills in name,
 * email and a *fresh* workspace path, and saves. The extension's real save path
 * (`SettingsEditor` -> `GlobalSettingsManager`) creates the workspace dir and
 * writes `global_settings.json` — the very file it reads at startup. We assert
 * that persisted file (real observable state), not any mock internals.
 *
 * Note: the save handler now REUSES a workspace path that already exists; this
 * test still points at a fresh dir to exercise the mkdirSync-on-create path.
 */
describe('Triforge settings (SET-1: first-run open and persist)', function () {
  this.timeout(180000);

  let workspacePath: string;

  before(async () => {
    await VSBrowser.instance.waitForWorkbench();
    // A unique, not-yet-existing workspace dir under tmp; the extension creates it.
    workspacePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'triforge-e2e-set1-')),
      'workspace',
    );
  });

  after(() => {
    try {
      fs.rmSync(path.dirname(workspacePath), { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it('opens the Settings webview, saves, and persists to global_settings.json', async () => {
    const userName = 'SET-1 User';
    const email = 'set1@triforge.test';

    const settings = new Settings();
    await settings.open();

    await settings.setUserName(userName);
    await settings.setEmail(email);
    await settings.setWorkspacePath(workspacePath);

    // Read back what we typed before saving (in-webview observable state).
    expect(await settings.readUserName()).to.equal(userName);
    expect(await settings.readEmail()).to.equal(email);
    expect(await settings.readWorkspacePath()).to.equal(workspacePath);

    await settings.save();

    // The extension created the workspace dir as part of the save.
    expect(fs.existsSync(workspacePath), 'workspace dir should be created on save').to
      .be.true;

    // And persisted the settings to the file it consumes at startup.
    const file = globalSettingsFile();
    expect(fs.existsSync(file), `expected persisted settings at ${file}`).to.be.true;

    const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(persisted.userName).to.equal(userName);
    expect(persisted.email).to.equal(email);
    expect(persisted.workspacePath).to.equal(workspacePath);
  });
});

/**
 * SET-2 — settings persist across reopen.
 *
 * Saves a fresh set of values through the real Settings webview, then *reopens*
 * the Settings panel (`triforge.openSettings` again). Because the panel is rendered
 * from `GlobalSettingsManager.getSettings()` — i.e. from the persisted
 * `global_settings.json` — the reopened webview must echo back the saved values.
 * We assert BOTH observable layers: the in-webview readback after reopen AND the
 * persisted file shape.
 *
 * The Settings webview exposes only User Name / Email / Workspace Path fields
 * (see `src/panels/SettingsEditor.ts`); there is no API-key field in global
 * settings (the OpenTopography key lives on the per-project config — see SET-3),
 * so only those three fields can be persistence-tested here.
 */
describe('Triforge settings (SET-2: values persist across reopen)', function () {
  this.timeout(180000);

  let workspacePath: string;

  before(async () => {
    await VSBrowser.instance.waitForWorkbench();
    workspacePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'triforge-e2e-set2-')),
      'workspace',
    );
  });

  after(() => {
    try {
      fs.rmSync(path.dirname(workspacePath), { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it('reopening Settings shows the saved values and they match the persisted file', async () => {
    const userName = 'SET-2 Persisted User';
    const email = 'set2@triforge.test';

    // 1) Save values through the real webview.
    const settings = new Settings();
    await settings.open();
    await settings.setUserName(userName);
    await settings.setEmail(email);
    await settings.setWorkspacePath(workspacePath);
    await settings.save();

    // The persisted file the extension reads at startup has the saved shape.
    const file = globalSettingsFile();
    expect(fs.existsSync(file), `expected persisted settings at ${file}`).to.be.true;
    const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(persisted.userName).to.equal(userName);
    expect(persisted.email).to.equal(email);
    expect(persisted.workspacePath).to.equal(workspacePath);

    // 2) Reopen Settings — the panel is rebuilt from the persisted settings, so
    //    the readback must echo what we saved (persistence across reopen).
    const reopened = new Settings();
    await reopened.open();
    try {
      expect(await reopened.readUserName()).to.equal(userName);
      expect(await reopened.readEmail()).to.equal(email);
      expect(await reopened.readWorkspacePath()).to.equal(workspacePath);
    } finally {
      // Leave the panel without mutating state (cancel disposes it).
      await reopened.cancel();
    }
  });
});

/**
 * SET-4 — reset clears settings back to defaults.
 *
 * After saving some settings, runs `triforge.resetSettings`. The command shows an
 * in-workbench modal warning (`showWarningMessage({ modal: true })`, rendered as
 * a `.monaco-dialog-box`); we confirm with the "Yes" button. The real reset path
 * (`GlobalSettingsManager.resetSettings`) deletes `global_settings.json` and
 * resets the in-memory settings to empty defaults. We assert the persisted file
 * is gone — and, to prove the in-memory state was cleared too, reopen Settings
 * and confirm the user/email fields come back EMPTY (the workspace path field
 * falls back to a `~/triforge-projects` default when unset, so it is not asserted empty).
 */
describe('Triforge settings (SET-4: reset clears settings)', function () {
  this.timeout(180000);

  let workspacePath: string;

  before(async () => {
    await VSBrowser.instance.waitForWorkbench();
    workspacePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'triforge-e2e-set4-')),
      'workspace',
    );
  });

  after(() => {
    try {
      fs.rmSync(path.dirname(workspacePath), { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it('resetSettings deletes the persisted file and clears the in-memory state', async () => {
    // 1) Save settings so there is something to reset.
    const settings = new Settings();
    await settings.open();
    await settings.setUserName('SET-4 User');
    await settings.setEmail('set4@triforge.test');
    await settings.setWorkspacePath(workspacePath);
    await settings.save();

    const file = globalSettingsFile();
    expect(fs.existsSync(file), 'settings file should exist after save').to.be.true;

    // 2) Run the reset command and confirm the modal warning.
    //    The command is contributed with the title "Triforge: Reset Settings"; it
    //    shows an in-workbench modal (`.monaco-dialog-box`) we confirm with "Yes".
    await new Workbench().executeCommand('Triforge: Reset Settings');
    await confirmResetDialog();

    // 3) The persisted file is deleted (back to first-run / no-settings state).
    await VSBrowser.instance.driver.wait(
      async () => !fs.existsSync(file),
      20000,
      'expected global_settings.json to be deleted by resetSettings',
    );
    expect(fs.existsSync(file), 'settings file should be removed after reset').to.be
      .false;

    // 4) The in-memory state is cleared too: reopen Settings, user/email empty.
    const reopened = new Settings();
    await reopened.open();
    try {
      expect(await reopened.readUserName()).to.equal('');
      expect(await reopened.readEmail()).to.equal('');
    } finally {
      await reopened.cancel();
    }
  });
});

/**
 * SET-3 (SEC-2) — OpenTopography API key must NOT be persisted in plaintext.
 *
 * The OpenTopography API key used to be written into the *project config*
 * (`config.json` -> `input.apiKeys.openTopography`) by `ProjectManager` (see
 * `src/state/ProjectManager.ts`) when the Input page or Map command saved it —
 * plaintext on disk in a commonly-shared workspace file.
 *
 * Post-fix property (SEC-2): the key lives in VS Code SecretStorage, NOT in the
 * plaintext config file, and any PRE-EXISTING plaintext key is migrated out of
 * config.json the next time the extension loads the project.
 *
 * We exercise the REAL persistence path: seed a registered project whose
 * config.json carries a plaintext `input.apiKeys.openTopography`, reload the
 * window (so the extension's `ProjectManager._loadProjects()` runs the migration
 * — move the key into SecretStorage, then scrub it from config.json), and assert
 * the key is absent from the on-disk config bytes afterwards.
 *
 * Pre-fix this test was an `xfail('SEC-2', …)` guard (the key stayed in config so
 * the absence assertion threw and the xfail passed). SEC-2 landed: the key is
 * migrated to SecretStorage + scrubbed, so the bare assertion now guards it.
 */
describe('Triforge settings (SET-3: API key not in plaintext config — SEC-2)', function () {
  this.timeout(180000);

  const API_KEY = 'ot-secret-key-SEC2-7f3a9b2c1d';

  before(async () => {
    await VSBrowser.instance.waitForWorkbench();
  });

  it('migrates the OpenTopography API key out of plaintext config.json (SecretStorage)', async () => {
    await withTempWorkspace(
      async (ctx) => {
        const configFile = path.join(ctx.projectPath, 'config.json');

        // Sanity: the seeded config really does carry the plaintext key on disk,
        // i.e. the seam we are guarding actually exists before the extension runs.
        const seeded = fs.readFileSync(configFile, 'utf8');
        expect(
          seeded.includes(API_KEY),
          'seeded config.json should contain the plaintext key before reload',
        ).to.be.true;

        // Reload so the extension activates and `_loadProjects()` migrates the
        // plaintext key into SecretStorage, then scrubs it from config.json.
        await reloadWindow();

        // Post-fix: the secret must not appear anywhere in the plaintext config.
        // Give the (synchronous) config-scrub a brief settle window after activate.
        let raw = '';
        await VSBrowser.instance.driver.wait(
          async () => {
            raw = fs.readFileSync(configFile, 'utf8');
            return !raw.includes(API_KEY);
          },
          30000,
          'OpenTopography API key was not scrubbed from config.json after reload',
        );
        expect(
          raw.includes(API_KEY),
          'OpenTopography API key must not be persisted in plaintext config.json (should be in SecretStorage)',
        ).to.be.false;
      },
      {
        // Plant the plaintext key into the seeded project's config before write.
        mutateConfig: (config: any) => {
          config.input = config.input || {};
          config.input.apiKeys = { openTopography: API_KEY };
        },
      },
    );
  });
});

/**
 * SET-5 (xfail SEC-3) — Settings fields must treat injected HTML as inert text.
 *
 * `SettingsEditor._getHtmlForWebview()` interpolates persisted values straight
 * into HTML attributes (`value="${settings.userName}"`) with no escaping, so a
 * value like  "><script>...</script>  breaks out of the attribute when the panel
 * is rebuilt from the persisted settings on reopen.
 *
 * Post-fix property (SEC-3): the value is stored/rendered as INERT TEXT — on
 * reopen the field readback equals the literal payload AND no injected marker
 * element appears in the webview DOM. Today the value is not escaped, so the
 * round-tripped readback does not equal the literal payload (the attribute is
 * truncated at the first `"`) -> the safety assertion throws -> xfail passes.
 * When SEC-3 lands (proper escaping) the readback equals the literal and the
 * injected element is absent, so xfail flips loudly.
 */
describe('Triforge settings (SET-5: HTML-injection value stays inert — SEC-3 FIXED)', function () {
  this.timeout(180000);

  // Classic break-out-of-attribute + script + sentinel-marker payload.
  const PAYLOAD = '"><script>window.__pwned=1</script><span id="set5-pwned">x</span>';
  let workspacePath: string;

  before(async () => {
    await VSBrowser.instance.waitForWorkbench();
    workspacePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'triforge-e2e-set5-')),
      'workspace',
    );
  });

  after(() => {
    try {
      fs.rmSync(path.dirname(workspacePath), { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it('reopening Settings renders an injected value as literal inert text', async () => {
    // 1) Save the payload into the User Name field (valid email/workspace so the
    //    real save handler persists rather than rejecting the form).
    const settings = new Settings();
    await settings.open();
    await settings.setUserName(PAYLOAD);
    await settings.setEmail('set5@triforge.test');
    await settings.setWorkspacePath(workspacePath);
    await settings.save();

    // 2) Reopen — the panel HTML is rebuilt from the persisted (unescaped) value.
    const reopened = new Settings();
    await reopened.open();
    try {
      // SEC-3 FIXED (T2): the field round-trips the payload as a literal string...
      const readback = await reopened.readUserName();
      expect(readback, 'injected value should round-trip as literal text').to.equal(
        PAYLOAD,
      );
      // ...and no injected sentinel element leaked into the webview DOM.
      const injected = await reopened.hasElement('#set5-pwned');
      expect(injected, 'injected element must not appear in the webview').to.be.false;
    } finally {
      await reopened.cancel();
    }
  });
});
