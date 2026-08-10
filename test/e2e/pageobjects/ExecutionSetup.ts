import { VSBrowser, WebView, Workbench } from 'vscode-extension-tester';
import { enterWebview, leaveWebview, waitForSelector } from './webview.ts';

/**
 * Page object for the Triforge Execution Setup webview
 * (`src/panels/ExecutionSetupEditor.ts` + `templates/ExecutionSetupHtml.ts`).
 *
 * Opened by the `triforge.openExecutionSetup` command, it renders in a
 * (nested-iframe) webview. The panel only OPENS if the active project's
 * computation target validates (`ExecutionSetupEditor.createOrShow`): executable
 * mode requires `triton_target` to exist, source mode requires
 * `<build_dir>/triton.exe`, docker mode requires an image name. Seed the project
 * with `{ executableTarget: true }` (see `helpers/seed.ts`) so the gate passes.
 *
 * The behavior ships as a nonce-gated bundle
 * (`dist/webview/executionSetup.bundle.js`) that calls `acquireVsCodeApi()` once
 * and wires every control via `addEventListener`. Because the API is not
 * re-exposed on `window`, this page object drives the REAL DOM controls and lets
 * the bundle's own listeners post the host `runSimulation` message. All
 * selectors are the REAL ids/names from `ExecutionSetupHtml.ts`:
 *   - execution-type radios `input[name="execution_type"]` (`#typeInteractive` /
 *     `#typeBatch`); selecting Batch reveals `#batch_header_group` /
 *     `#step_launch_group` and relabels the run-command field,
 *   - `#run_directory`, `#run_command` (interactive run command OR — in batch
 *     mode — the batch submission command), `#batch_header`,
 *     `#step_launch_command`, `#env_variables`, `#it_count`, `#checkpoint_id`,
 *   - `#runBtn` (Run Simulation), `#logDetails` / `#executionLog` (the streamed
 *     output area the host appends to via `appendLog`).
 *
 * Clicking Run posts `runSimulation`; the host writes `triton_execution.cfg`
 * into the run dir, then spawns `run_command` (interactive) or writes
 * `triton_batch.sh` + spawns `batch_submit_command` (batch), streaming child
 * output back into `#executionLog`.
 */
export class ExecutionSetup {
  private webview: WebView | undefined;

  /** Command-palette title contributed for `triforge.openExecutionSetup`. */
  private static readonly OPEN_COMMAND_TITLE = 'Open Execution Setup';

  /**
   * Run the open command and switch into the Execution Setup webview, waiting
   * for the execution-type radios and the Run button (the last control the
   * bundle binds, so its presence means `handleRunClick` is live). Pair every
   * call with {@link leave}.
   *
   * Returns `true` if the webview opened; `false` if the open-gate rejected it
   * (no webview iframe ever mounted within the timeout).
   */
  async open(): Promise<boolean> {
    await new Workbench().executeCommand(ExecutionSetup.OPEN_COMMAND_TITLE);
    try {
      this.webview = await enterWebview();
    } catch {
      this.webview = undefined;
      return false;
    }
    await waitForSelector(this.webview, 'input[name="execution_type"]');
    await waitForSelector(this.webview, '#runBtn');
    return true;
  }

  /**
   * Select the Interactive or Batch execution-type radio and fire its `change`
   * event so the bundle's `updateVisibility()` shows/hides the batch fields and
   * relabels the run-command field exactly as a real user click would.
   */
  async selectExecutionType(type: 'interactive' | 'batch'): Promise<void> {
    const driver = VSBrowser.instance.driver;
    await driver.executeScript(
      `const radios = Array.from(document.getElementsByName('execution_type'));
       const target = radios.find(r => r.value === arguments[0]);
       if (target) {
         target.checked = true;
         target.dispatchEvent(new Event('change', { bubbles: true }));
       }`,
      type,
    );
  }

  /** Set the Run Directory field (`#run_directory`). */
  async setRunDirectory(value: string): Promise<void> {
    await this.setInputValue('#run_directory', value);
  }

  /**
   * Set the Run Command field (`#run_command`). In interactive mode this is the
   * spawned run command; in batch mode this same field carries the batch
   * SUBMISSION command (the bundle reads `runCmdInput.value` into either
   * `run_command` or `batch_submit_command` depending on the selected type).
   */
  async setRunCommand(value: string): Promise<void> {
    await this.setInputValue('#run_command', value);
  }

  /** Set the Step Launch Command field (`#step_launch_command`, batch mode). */
  async setStepLaunchCommand(value: string): Promise<void> {
    await this.setInputValue('#step_launch_command', value);
  }

  /** Set the Environment Variables textarea (`#env_variables`). */
  async setEnvVariables(value: string): Promise<void> {
    await this.setInputValue('#env_variables', value);
  }

  /** Click the REAL Run Simulation button (`#runBtn`). */
  async clickRun(): Promise<void> {
    await this.dispatchClick('#runBtn');
  }

  /** Current text of the streamed execution-output area (`#executionLog`). */
  async getLogText(): Promise<string> {
    const driver = VSBrowser.instance.driver;
    return (await driver.executeScript(
      `const el = document.querySelector('#executionLog');
       return el ? (el.textContent || '') : '';`,
    )) as string;
  }

  /**
   * Wait until the streamed log contains `substring` (the host appends child
   * output to `#executionLog` via throttled `appendLog` messages). Returns the
   * full log text once matched.
   */
  async waitForLog(substring: string, timeoutMs = 90000): Promise<string> {
    const driver = VSBrowser.instance.driver;
    let last = '';
    await driver.wait(
      async () => {
        last = await this.getLogText();
        return last.includes(substring);
      },
      timeoutMs,
      `Execution log never contained "${substring}". Last log:\n${last}`,
    );
    return last;
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
   * lands even while webview layout is settling (matching the ComputationSetup
   * PO pattern). Falls back to the DOM `.click()` too.
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

  /** The entered WebView, or throw if {@link open} was not called first. */
  private element(): WebView {
    if (!this.webview) {
      throw new Error('Execution Setup webview not open — call open() first');
    }
    return this.webview;
  }
}
