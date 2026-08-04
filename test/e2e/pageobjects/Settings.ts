import { By, Key, WebView, Workbench } from 'vscode-extension-tester';
import { enterWebview, leaveWebview, waitForSelector } from './webview.ts';

/**
 * Page object for the Triforge Settings webview (`SettingsEditor`).
 *
 * The panel is opened by the `triforge.openSettings` command and renders in a
 * (nested-iframe) webview with these controls:
 *   #userName  #userEmail  #workspacePath  #browseWorkspaceBtn  #saveBtn  #cancelBtn
 *
 * All iframe entering/leaving is delegated to the shared webview helper so the
 * nesting is handled in exactly one place. While "inside" the webview (between
 * {@link open} and {@link cancel}/{@link save}) the WebDriver is focused on the
 * panel's document; both terminal actions leave the iframe.
 */
export class Settings {
  private webview: WebView | undefined;

  /** Command-palette title contributed for `triforge.openSettings`. */
  private static readonly OPEN_COMMAND_TITLE = 'Triforge Global Settings';

  /**
   * Run the open-settings command and switch into the Settings webview.
   * Waits for the workspace-path field so callers can interact immediately.
   */
  async open(): Promise<void> {
    await new Workbench().executeCommand(Settings.OPEN_COMMAND_TITLE);
    this.webview = await enterWebview();
    await waitForSelector(this.webview, '#workspacePath');
  }

  /** Overwrite the Workspace Path field with `value`. */
  async setWorkspacePath(value: string): Promise<void> {
    await this.setInput('#workspacePath', value);
  }

  /** Overwrite the User Name field with `value`. */
  async setUserName(value: string): Promise<void> {
    await this.setInput('#userName', value);
  }

  /** Overwrite the Email field with `value`. */
  async setEmail(value: string): Promise<void> {
    await this.setInput('#userEmail', value);
  }

  /** Current value of the Workspace Path field. */
  async readWorkspacePath(): Promise<string> {
    return this.readInput('#workspacePath');
  }

  /** Current value of the User Name field. */
  async readUserName(): Promise<string> {
    return this.readInput('#userName');
  }

  /** Current value of the Email field. */
  async readEmail(): Promise<string> {
    return this.readInput('#userEmail');
  }

  /**
   * Whether any element matching `css` exists inside the (entered) Settings
   * webview. Used by injection scenarios to detect a leaked/injected element
   * (e.g. a `<span id="...">` smuggled in via an unescaped settings value).
   */
  async hasElement(css: string): Promise<boolean> {
    const found = await this.element().findWebElements(By.css(css));
    return found.length > 0;
  }

  /**
   * Click Save. On a valid form the extension persists the settings and
   * disposes the panel, so this also leaves the webview iframe.
   */
  async save(): Promise<void> {
    const btn = await this.element().findWebElement(By.css('#saveBtn'));
    await btn.click();
    await this.leave();
  }

  /** Click Cancel (disposes the panel) and leave the webview iframe. */
  async cancel(): Promise<void> {
    const btn = await this.element().findWebElement(By.css('#cancelBtn'));
    await btn.click();
    await this.leave();
  }

  /** The entered WebView, or throw if {@link open} was not called first. */
  private element(): WebView {
    if (!this.webview) {
      throw new Error('Settings webview not open — call open() first');
    }
    return this.webview;
  }

  /** Clear an input and type a fresh value. */
  private async setInput(css: string, value: string): Promise<void> {
    const input = await waitForSelector(this.element(), css);
    await input.clear();
    // Some inputs ignore clear() under the webview; select-all + delete is safe.
    await input.sendKeys(Key.chord(Key.CONTROL, 'a'), Key.DELETE);
    await input.sendKeys(value);
  }

  /** Read the current `value` of an input. */
  private async readInput(css: string): Promise<string> {
    const input = await waitForSelector(this.element(), css);
    const value = await input.getAttribute('value');
    return value ?? '';
  }

  /** Leave the webview iframe and forget the handle. */
  private async leave(): Promise<void> {
    if (this.webview) {
      await leaveWebview(this.webview);
      this.webview = undefined;
    }
  }
}
