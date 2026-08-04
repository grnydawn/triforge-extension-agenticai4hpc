import { By, EditorView, VSBrowser, WebView } from 'vscode-extension-tester';
import { enterWebview, leaveWebview, waitForSelector } from './webview.ts';

/**
 * Page object for the Triforge Input Generator webview panel
 * (`src/panels/InputGeneratorEditor.ts` + `templates/InputGeneratorHtml.ts`).
 *
 * The panel is an editor-area webview opened in one of two MODES:
 *  - `static`  — `triforge.generateInput` ("Generate Static Input…"); shows the
 *    Static Inputs sidebar list (`#static-list`: Elevation / Water Depth /
 *    Water Discharge / …).
 *  - `dynamic` — `triforge.openDynamicInputGenerator`; hides the static list and
 *    activates the first dynamic input (`#dynamic-list`: Streamflow hydrograph),
 *    whose `#streamflow` page carries the editable hydrograph BAR CHART
 *    (`#sf-graph-svg` with `.bar-rect` series).
 *
 * The HTML is a single inline `<script nonce>` that calls
 * `acquireVsCodeApi()` ONCE and wires every control with `addEventListener`
 * (including the "Other Pages" footer buttons, which carry an `.other-page-close`
 * marker class and are wired via `addEventListener` rather than the old
 * CSP-blocked inline `onclick="closePanel()"` — ARCH-1 option-B fix, INP-6).
 * Because the API is acquired exactly once by that script and is NOT
 * re-exposed on `window`, this page object drives the REAL DOM controls (set a
 * field's value, click a real button) rather than posting host messages itself —
 * the buttons' own listeners post through the already-acquired `vscode`.
 *
 * All selectors below are the REAL ids/classes from
 * `templates/InputGeneratorHtml.ts`.
 */
export class InputGenerator {
  /**
   * Wait until the input-generator panel's editor tab (for `projectName`) is
   * open. Both modes share the prefix "Generate <Static|Dynamic> Input"; this
   * matches either so a caller need not know the exact mode.
   */
  static async waitForOpen(projectName: string, timeoutMs = 30000): Promise<void> {
    const driver = VSBrowser.instance.driver;
    await driver.wait(
      async () => {
        try {
          const titles = await new EditorView().getOpenEditorTitles();
          return titles.some((t) => t.includes(`Input (${projectName})`));
        } catch {
          return false;
        }
      },
      timeoutMs,
      `Input Generator panel for "${projectName}" never opened`,
    );
  }

  /** Whether an editor tab titled like the generator for `projectName` is open. */
  static async isOpen(projectName: string): Promise<boolean> {
    try {
      const titles = await new EditorView().getOpenEditorTitles();
      return titles.some((t) => t.includes(`Input (${projectName})`));
    } catch {
      return false;
    }
  }

  /**
   * Whether a generator tab is open whose title contains `fragment` after the
   * "Input (" prefix. Used when the project name is awkward to match in full
   * (e.g. an injection payload — INP-4), so we match on its plain sentinel
   * prefix rather than the raw `Input (NAME)` form.
   */
  static async isOpenContaining(fragment: string): Promise<boolean> {
    try {
      const titles = await new EditorView().getOpenEditorTitles();
      return titles.some((t) => t.includes(`Input (${fragment}`));
    } catch {
      return false;
    }
  }

  /**
   * Enter the input-generator webview iframe and wait for its shell (the sidebar
   * `Input Types` list) to mount, so the inline script has run. Pair every call
   * with {@link leave}.
   */
  async enter(timeoutMs = 30000): Promise<WebView> {
    const webview = await enterWebview(timeoutMs);
    // `.container` + the static list are the page shell rendered before the
    // inline script attaches listeners.
    await waitForSelector(webview, '.container', timeoutMs);
    return webview;
  }

  /** Leave the webview iframe (always call after {@link enter}). */
  async leave(webview: WebView): Promise<void> {
    await leaveWebview(webview).catch(() => undefined);
  }

  /**
   * Whether any element matching `css` exists in the generator webview DOM.
   * Enters the webview, queries, then leaves. Used by the SEC-3 injection
   * scenario to detect a SENTINEL element smuggled in via the unescaped
   * `JSON.stringify(initialData)` `</script>` breakout (`InputGeneratorHtml.ts:491`):
   * while SEC-3 stands the breakout parses the payload's `<span id=…>` as LIVE
   * markup so the sentinel element exists; once `safeJsonForScript` escapes
   * `</script>`/`<`, the payload stays an inert string and no such element exists.
   */
  async hasElement(css: string): Promise<boolean> {
    const driver = VSBrowser.instance.driver;
    const webview = await this.enter();
    try {
      const found = await driver.findElements(By.css(css));
      return found.length > 0;
    } finally {
      await this.leave(webview);
    }
  }

  /**
   * Whether the "Other Pages" (manning/runoff-map/boundaries/observation) footer
   * close handlers actually fire. We navigate to the Surface Roughness page
   * (`#manning`), click its footer "Ok" button (selected by page+footer, NOT by
   * any `[onclick]` attribute), and report whether the panel closed.
   *
   * The page's CSP (`script-src 'nonce-…'`, no `'unsafe-inline'`) BLOCKS inline
   * handlers, so the old inline `onclick="closePanel()"` was a dead no-op (ARCH-1).
   * The option-B fix tags these buttons with `.other-page-close` and wires them via
   * `addEventListener` inside the nonce-gated script, so the click closes the
   * panel. INP-6 guards that.
   *
   * Drives the DOM inside the webview, then LEAVES the iframe before checking the
   * editor-tab count (the panel-disposal signal lives in the workbench frame).
   *
   * @param projectName the active project (to match the panel's tab title)
   * @returns true iff clicking the inline-onclick "Ok" closed the panel.
   */
  async inlineOnclickClosesPanel(projectName: string): Promise<boolean> {
    const driver = VSBrowser.instance.driver;
    const webview = await this.enter();
    try {
      // Navigate to the Surface Roughness ("manning") page via its nav item, then
      // click that page's footer "Ok" — the button using inline onclick.
      await driver.executeScript(
        `const nav = document.querySelector('.nav-item[data-target="manning"]');
         if (nav) {
           const r = nav.getBoundingClientRect();
           const o = { bubbles: true, cancelable: true, view: window,
             clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
           for (const t of ['mousedown', 'mouseup', 'click']) nav.dispatchEvent(new MouseEvent(t, o));
         }
         // Click the manning page's "Ok" footer button (wired via the nonce-gated
         // addEventListener on .other-page-close).
         const page = document.getElementById('manning');
         const btns = page ? Array.from(page.querySelectorAll('.page-footer button')) : [];
         const ok = btns.find(b => b.textContent.trim() === 'Ok') || btns[btns.length - 1];
         if (ok) {
           const r = ok.getBoundingClientRect();
           const o = { bubbles: true, cancelable: true, view: window,
             clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
           for (const t of ['mousedown', 'mouseup', 'click']) ok.dispatchEvent(new MouseEvent(t, o));
           // Also invoke the native click path for robustness.
           ok.click();
         }`,
      );
    } finally {
      await this.leave(webview);
    }
    // Give the host a moment to process any 'close' message, then check the tab.
    await driver.sleep(1500);
    return !(await InputGenerator.isOpen(projectName));
  }

  /**
   * Drive the STATIC "Water Depth" producer: set the file-path field to
   * `filePath` (bypassing the native Browse dialog, which is non-deterministic in
   * E2E) and click the page's real "Ok" button (`#btnOkHFooter`). Its listener
   * posts `{ type: 'applyInitialInputFile', path }`, which the host applies to
   * `activeProject.initialInputPath` (-> config `input.initialInput`) and renders
   * as the "Water Depth" node under Static Inputs.
   *
   * Enters the webview, drives the controls, then leaves the iframe.
   */
  async produceWaterDepthFromFile(filePath: string): Promise<void> {
    const driver = VSBrowser.instance.driver;
    const webview = await this.enter();
    try {
      // The "Water Depth" page must be active (its file tab is active by default).
      await driver.executeScript(
        `const nav = document.querySelector('.nav-item[data-target="h-initial"]');
         if (nav) {
           const r = nav.getBoundingClientRect();
           const o = { bubbles: true, cancelable: true, view: window,
             clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
           for (const t of ['mousedown', 'mouseup', 'click']) nav.dispatchEvent(new MouseEvent(t, o));
         }`,
      );
      await waitForSelector(webview, '#ii_filePath');
      await waitForSelector(webview, '#btnOkHFooter');
      // Set the (readonly) path field's value directly, as the Browse dialog
      // would, then click the REAL "Ok" button (#btnOkHFooter). Its listener
      // reads #ii_filePath and posts applyInitialInputFile through the
      // already-acquired vscode API. We dispatch the mouse-event sequence Monaco-
      // style (rather than Selenium's interactable-gated .click()) so the click
      // lands even while layout is settling.
      await driver.executeScript(
        `document.getElementById('ii_filePath').value = arguments[0];
         const ok = document.getElementById('btnOkHFooter');
         const r = ok.getBoundingClientRect();
         const o = { bubbles: true, cancelable: true, view: window,
           clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
         for (const t of ['mousedown', 'mouseup', 'click']) ok.dispatchEvent(new MouseEvent(t, o));`,
        filePath,
      );
    } finally {
      await this.leave(webview);
    }
  }

  /**
   * Navigate to the Streamflow hydrograph page's "Create/Edit" tab and edit the
   * streamflow value so the hydrograph BAR CHART (re)renders, then return the
   * number of rendered bar series elements (`.bar-rect` rects inside
   * `#sf-graph-svg`). The chart renders on init from the default constant value;
   * editing `#sf-val-constant` fires the `change` listener -> `generateGraphData`
   * -> `renderGraph`, re-creating the bars.
   *
   * Enters the webview, drives the controls, reads the bar count, then leaves.
   *
   * @param value the constant streamflow value to set (drives bar heights)
   * @returns the count of `.bar-rect` elements drawn in the SVG.
   */
  async editStreamflowAndCountBars(value: number): Promise<number> {
    const driver = VSBrowser.instance.driver;
    const webview = await this.enter();
    try {
      // Activate the Streamflow page (dynamic mode already selects it, but be
      // explicit so this works regardless of which list is shown).
      await driver.executeScript(
        `const nav = document.querySelector('.nav-item[data-target="streamflow"]');
         if (nav) {
           const r = nav.getBoundingClientRect();
           const o = { bubbles: true, cancelable: true, view: window,
             clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
           for (const t of ['mousedown', 'mouseup', 'click']) nav.dispatchEvent(new MouseEvent(t, o));
         }
         // Switch to the "Create/Edit" tab (data-target="flow-tab-create"), which
         // hosts the map + hydrograph chart.
         const tab = document.querySelector('#streamflow .tab[data-target="flow-tab-create"]');
         if (tab) {
           const r = tab.getBoundingClientRect();
           const o = { bubbles: true, cancelable: true, view: window,
             clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
           for (const t of ['mousedown', 'mouseup', 'click']) tab.dispatchEvent(new MouseEvent(t, o));
         }`,
      );
      await waitForSelector(webview, '#sf-graph-svg');
      // Edit the constant value and fire its change listener -> regenerate chart.
      await driver.executeScript(
        `const inp = document.getElementById('sf-val-constant');
         if (inp) {
           inp.value = String(arguments[0]);
           inp.dispatchEvent(new Event('change', { bubbles: true }));
         }`,
        value,
      );
      // Wait until the SVG has a non-empty bar series, then count it.
      let bars = 0;
      await driver.wait(
        async () => {
          bars = (await driver.executeScript(
            `return document.querySelectorAll('#sf-graph-svg .bar-rect').length;`,
          )) as number;
          return bars > 0;
        },
        20000,
        'streamflow hydrograph bar chart never rendered any .bar-rect series',
      );
      return bars;
    } finally {
      await this.leave(webview);
    }
  }

  /**
   * Whether the dynamic mode is in effect: the static list is hidden and the
   * dynamic list is shown with the Streamflow page active. Reflects the inline
   * script's `initialData.mode === 'dynamic'` branch. Enters/leaves the webview.
   */
  async isDynamicMode(): Promise<boolean> {
    const webview = await this.enter();
    try {
      const driver = VSBrowser.instance.driver;
      return (await driver.executeScript(
        `const staticList = document.getElementById('static-list');
         const dynamicList = document.getElementById('dynamic-list');
         const streamflowPage = document.getElementById('streamflow');
         const staticHidden = !staticList || staticList.style.display === 'none';
         const dynamicShown = !!dynamicList && dynamicList.style.display !== 'none';
         const streamflowActive = !!streamflowPage && streamflowPage.classList.contains('active');
         return staticHidden && dynamicShown && streamflowActive;`,
      )) as boolean;
    } finally {
      await this.leave(webview);
    }
  }
}
