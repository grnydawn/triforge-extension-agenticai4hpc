import { By, until, VSBrowser, WebView, WebElement } from 'vscode-extension-tester';

/**
 * Shared helpers for driving Triforge webviews in E2E tests.
 *
 * Triforge renders its panels (Settings, ProjectCreator, Map, ...) inside the
 * VS Code webview, which lives in a *nested* iframe (an outer
 * `iframe.webview` host wrapping the extension's `#active-frame`). ExTester's
 * `WebView.switchToFrame()` walks that nesting for us; the point of this module
 * is to make every suite reach a webview the SAME way so the iframe handling is
 * defined exactly once.
 */

/** Default wait for the webview iframe to mount before we switch into it. */
const DEFAULT_ENTER_TIMEOUT_MS = 30000;

/** Default wait for a selector to appear inside an already-entered webview. */
const DEFAULT_SELECTOR_TIMEOUT_MS = 20000;

/**
 * Construct an ExTester {@link WebView}, switch the WebDriver into its
 * (possibly nested) iframe, and return the WebView for further interaction.
 *
 * After this call, WebDriver queries (e.g. via {@link waitForSelector}) target
 * the DOM *inside* the webview. Pair every successful call with
 * {@link leaveWebview} so the driver returns to the workbench frame.
 *
 * @param timeoutMs max time to wait for the iframe to be switchable
 * @returns the WebView, focused on the webview's inner document
 */
export async function enterWebview(timeoutMs: number = DEFAULT_ENTER_TIMEOUT_MS): Promise<WebView> {
  const webview = new WebView();
  await webview.switchToFrame(timeoutMs);
  return webview;
}

/**
 * Leave the webview iframe, returning the WebDriver to the workbench frame.
 * Always call this after {@link enterWebview}, even on failure paths, so later
 * interactions (sidebar, command palette, ...) are not stuck inside the iframe.
 */
export async function leaveWebview(webview: WebView): Promise<void> {
  await webview.switchBack();
}

/**
 * Wait for an element matching `css` to be located inside the currently
 * entered webview. Built on the underlying WebDriver + `until` so suites get a
 * single, consistent way to await webview content.
 *
 * Must be called while focused inside a webview (i.e. between
 * {@link enterWebview} and {@link leaveWebview}).
 *
 * @param _webview the entered WebView (kept in the signature so callers pass
 *   the focused webview explicitly; the wait runs on the shared driver)
 * @param css CSS selector to locate
 * @param timeoutMs max time to wait for the element
 * @returns the located WebElement
 */
export async function waitForSelector(
  _webview: WebView,
  css: string,
  timeoutMs: number = DEFAULT_SELECTOR_TIMEOUT_MS,
): Promise<WebElement> {
  const driver = VSBrowser.instance.driver;
  return driver.wait(
    until.elementLocated(By.css(css)),
    timeoutMs,
    `Timed out waiting for webview selector "${css}"`,
  );
}
