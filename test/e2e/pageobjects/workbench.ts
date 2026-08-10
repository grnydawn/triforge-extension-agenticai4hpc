import { By, EditorView, until, VSBrowser, Workbench } from 'vscode-extension-tester';

/**
 * Close every open editor/webview tab (best-effort).
 *
 * Several Triforge actions open editor-area webviews (the MapEditor on
 * `triforge.openProject`, the ProjectCreator panel). When more than one webview is
 * open, ExTester's frame pickers grab the WRONG iframe: `WebView` (panels) may
 * switch into a stale tab, and `WebviewView` (the Properties sidebar view)
 * selects the iframe whose rect best matches — i.e. the LARGE MapEditor instead
 * of the small Properties view. Closing editors first leaves a single,
 * unambiguous webview to target.
 */
export async function closeAllEditors(): Promise<void> {
  try {
    await new EditorView().closeAllEditors();
  } catch {
    /* nothing open / already closed */
  }
}

/**
 * Reset the WebDriver to the top-level workbench document.
 *
 * If a previous step left the driver switched INTO a webview iframe (e.g. a
 * panel that disposed mid-flow, or a test that failed before its
 * `leaveWebview`), later workbench/tree/`executeCommand` queries fail with
 * `NoSuchElementError: .monaco-workbench` because they run inside the iframe.
 * Calling this at the start of each test (and on retries) guarantees a clean,
 * top-frame context regardless of how the prior step ended.
 */
export async function resetToWorkbench(timeoutMs = 30000): Promise<void> {
  const driver = VSBrowser.instance.driver;
  await driver.switchTo().defaultContent();
  await driver.wait(
    until.elementLocated(By.className('monaco-workbench')),
    timeoutMs,
    'workbench (.monaco-workbench) not present after resetting to default content',
  );
  // Leave a clean editor area so later webview-frame selection is unambiguous.
  await closeAllEditors();
}

/**
 * Reload the VS Code window and re-establish the WebDriver context afterwards.
 *
 * The Triforge extension only loads its project registry at `activate()`
 * (`ProjectManager.initialize()` -> `_loadProjects()`), so any project seeded on
 * disk AFTER activation is invisible until the window reloads and the extension
 * re-activates. Group D suites seed projects, then call this, then assert.
 *
 * `workbench.action.reloadWindow` tears down and rebuilds the renderer document.
 * After firing it, the WebDriver is still pointed at the OLD (now-detached)
 * document, so a bare `waitForWorkbench()` fails with `NoSuchElementError` for
 * `.monaco-workbench`. The fix (validated by the harness probe) is to let the new
 * workbench mount, then re-`switchTo().window(handle)` to reset the driver's
 * document context before waiting for `.monaco-workbench`. We retry the
 * switch-and-wait a few times to absorb the reload's timing jitter.
 */
export async function reloadWindow(): Promise<void> {
  const driver = VSBrowser.instance.driver;

  // Ensure we issue the reload from the top frame, not a lingering webview iframe.
  await driver.switchTo().defaultContent();
  await new Workbench().executeCommand('workbench.action.reloadWindow');

  // Let the old workbench tear down and the new one begin mounting.
  await driver.sleep(4000);

  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const handles = await driver.getAllWindowHandles();
      // Reset the driver's document context onto the (rebuilt) window.
      await driver.switchTo().window(handles[handles.length - 1]);
      await driver.wait(
        until.elementLocated(By.className('monaco-workbench')),
        30000,
        'workbench did not reload (.monaco-workbench not found)',
      );
      // Belt-and-braces: ExTester's own readiness wait.
      await VSBrowser.instance.waitForWorkbench();
      return;
    } catch (err) {
      lastErr = err;
      await driver.sleep(2000);
    }
  }
  throw new Error(
    `reloadWindow failed to re-establish the workbench: ${String(lastErr)}`,
  );
}
