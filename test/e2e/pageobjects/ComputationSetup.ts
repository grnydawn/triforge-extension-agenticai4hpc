import { VSBrowser, WebView, Workbench } from 'vscode-extension-tester';
import { enterWebview, leaveWebview, waitForSelector } from './webview.ts';

/**
 * Page object for the Triforge Computation Setup webview
 * (`src/panels/ComputationSetupEditor.ts` + `templates/ComputationSetupHtml.ts`).
 *
 * Opened by the `triforge.openComputationSetup` command, it renders in a
 * (nested-iframe) webview whose "TRITON Executable Target" section offers three
 * mutually-exclusive modes selected by `<input type="radio" name="execMode">`:
 *   - `source`      — build from source; fields `#triforgeSource`, `#buildDir`,
 *                     `#buildCommand`, button `#buildNowBtn` (config `#sourceConfig`).
 *   - `executable`  — use an existing exe; field `#triforgeExec` (config `#execConfig`).
 *   - `docker`      — use an image; field `#dockerImage`, button `#downloadDockerBtn`
 *                     (config `#dockerConfig`).
 * The footer carries `#okBtn` (save) and `#cancelBtn`.
 *
 * The page's behavior is shipped as a nonce-gated bundle
 * (`dist/webview/computationSetup.bundle.js`) that calls `acquireVsCodeApi()`
 * ONCE and wires every control via `addEventListener`. Because the API is not
 * re-exposed on `window`, this page object drives the REAL DOM controls — select
 * a radio (+ fire `change` so the bundle reveals the matching config block), set
 * a field, click the REAL `#okBtn`/`#downloadDockerBtn` — and lets the bundle's
 * own listeners post the host message. All selectors are the REAL ids/classes
 * from `ComputationSetupHtml.ts`.
 *
 * Saving (`#okBtn`) makes the host validate the selected mode
 * (`ComputationSetupEditor` `saveSettings`): source requires
 * `<build_dir>/triton.exe` to exist, executable requires the exe path to exist,
 * docker requires a non-empty image. On success it persists to the project's
 * `config.json` (`compsetup` block) and shows a non-modal "Settings saved."
 * notification, then disposes the panel; on failure it shows a MODAL
 * `showWarningMessage` (a `.monaco-dialog-box`) and leaves the panel open. The
 * suite reads those host-side signals at the workbench frame.
 */
export class ComputationSetup {
  private webview: WebView | undefined;

  /** Command-palette title contributed for `triforge.openComputationSetup`. */
  private static readonly OPEN_COMMAND_TITLE = 'Open Computation Setup';

  /**
   * Run the open command and switch into the Computation Setup webview, waiting
   * for the mode radios so callers can interact immediately. Pair every call
   * with a terminal action ({@link save}/{@link cancel}) or {@link leave}.
   */
  async open(): Promise<void> {
    await new Workbench().executeCommand(ComputationSetup.OPEN_COMMAND_TITLE);
    this.webview = await enterWebview();
    await waitForSelector(this.webview, 'input[name="execMode"]');
    // The bundle wires its listeners on init; the Ok button is the last control
    // it binds, so waiting for it ensures handleSave/downloadDocker are live.
    await waitForSelector(this.webview, '#okBtn');
  }

  /**
   * Select an execution mode radio and fire its `change` event, so the bundle's
   * `updateVisibility()` reveals the matching config block (source/exec/docker)
   * exactly as a real user click would.
   */
  async selectMode(mode: 'source' | 'executable' | 'docker'): Promise<void> {
    const driver = VSBrowser.instance.driver;
    await driver.executeScript(
      `const radios = Array.from(document.getElementsByName('execMode'));
       const target = radios.find(r => r.value === arguments[0]);
       if (target) {
         target.checked = true;
         target.dispatchEvent(new Event('change', { bubbles: true }));
       }`,
      mode,
    );
  }

  /** Set the source-mode Build Directory field (`#buildDir`). */
  async setBuildDir(value: string): Promise<void> {
    await this.setInputValue('#buildDir', value);
  }

  /** Set the executable-mode Executable Path field (`#triforgeExec`). */
  async setExecutablePath(value: string): Promise<void> {
    await this.setInputValue('#triforgeExec', value);
  }

  /** Set the docker-mode Docker Image Name field (`#dockerImage`). */
  async setDockerImage(value: string): Promise<void> {
    await this.setInputValue('#dockerImage', value);
  }

  /**
   * Click the REAL Ok button (`#okBtn`). Its listener gathers the form and posts
   * `saveSettings`. On a valid target the host persists config + shows "Settings
   * saved." then disposes the panel; on an invalid target it shows a modal
   * warning and keeps the panel open. This does NOT leave the iframe (the caller
   * decides based on outcome) — but the panel may dispose underneath us, so
   * always finish with {@link leave}.
   */
  async clickOk(): Promise<void> {
    await this.dispatchClick('#okBtn');
  }

  /**
   * Click the REAL Download/Pull button (`#downloadDockerBtn`). Its listener
   * posts `downloadDocker` with the current `#dockerImage` value; the host runs
   * the pull in a VS Code terminal (`terminal.sendText(\`docker pull <image>\`)`)
   * with NO save-time validation gate. Used by the SEC-6 injection scenario.
   */
  async clickDownloadDocker(): Promise<void> {
    await this.dispatchClick('#downloadDockerBtn');
  }

  /** Whether the source-mode config block (`#sourceConfig`) is visible. */
  async isSourceConfigVisible(): Promise<boolean> {
    return this.isVisible('#sourceConfig');
  }

  /** Whether the executable-mode config block (`#execConfig`) is visible. */
  async isExecConfigVisible(): Promise<boolean> {
    return this.isVisible('#execConfig');
  }

  /** Whether the docker-mode config block (`#dockerConfig`) is visible. */
  async isDockerConfigVisible(): Promise<boolean> {
    return this.isVisible('#dockerConfig');
  }

  /** Leave the webview iframe and forget the handle (idempotent / best-effort). */
  async leave(): Promise<void> {
    if (this.webview) {
      await leaveWebview(this.webview).catch(() => undefined);
      this.webview = undefined;
    }
  }

  /** Clear an input and set a fresh value, firing input/change so listeners run. */
  private async setInputValue(css: string, value: string): Promise<void> {
    await waitForSelector(this.element(), css);
    const driver = VSBrowser.instance.driver;
    await driver.executeScript(
      `const el = document.querySelector(arguments[0]);
       if (el) {
         el.value = arguments[1];
         el.dispatchEvent(new Event('input', { bubbles: true }));
         el.dispatchEvent(new Event('change', { bubbles: true }));
       }`,
      css,
      value,
    );
  }

  /**
   * Dispatch a Monaco-style mouse-event sequence at the element so the click
   * lands even while webview layout is settling (matching the InputGenerator PO
   * pattern). Falls back to the DOM `.click()` too.
   */
  private async dispatchClick(css: string): Promise<void> {
    await waitForSelector(this.element(), css);
    const driver = VSBrowser.instance.driver;
    await driver.executeScript(
      `const el = document.querySelector(arguments[0]);
       if (el) {
         const r = el.getBoundingClientRect();
         const o = { bubbles: true, cancelable: true, view: window,
           clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
         for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, o));
         el.click();
       }`,
      css,
    );
  }

  /** Whether `css` exists and is not `display:none` (config-block visibility). */
  private async isVisible(css: string): Promise<boolean> {
    const driver = VSBrowser.instance.driver;
    return (await driver.executeScript(
      `const el = document.querySelector(arguments[0]);
       if (!el) return false;
       return window.getComputedStyle(el).display !== 'none';`,
      css,
    )) as boolean;
  }

  /** The entered WebView, or throw if {@link open} was not called first. */
  private element(): WebView {
    if (!this.webview) {
      throw new Error('Computation Setup webview not open — call open() first');
    }
    return this.webview;
  }
}
