import { By, WebElement, WebviewView } from 'vscode-extension-tester';
import { Sidebar } from './Sidebar.ts';

/**
 * Page object for the Triforge `Properties` webview *view* (`triforge-properties`).
 *
 * Unlike the Settings panel (an editor-area webview), Properties is a webview
 * VIEW docked in the Triforge side bar, so it is driven through ExTester's
 * {@link WebviewView} (which mixes in `switchToFrame` / `findWebElement`) rather
 * than the `WebView` panel helper. The view renders one `.tree-item` per
 * `PropertyItem` emitted on the `properties:update` EventBus channel; each row's
 * key/value live in `.key` / `.value` spans (see `src/views/PropertiesHtml.ts`).
 *
 * Crucially, that HTML is built by string-interpolating the key/value straight
 * into `innerHTML` with NO escaping — the seam SEC-3 (PRJ-2) guards: a project
 * whose name carries an HTML/script payload renders live here instead of inert.
 */
export class PropertiesPanel {
  private readonly sidebar = new Sidebar();
  private view: WebviewView | undefined;

  /**
   * Make the Properties view visible (it must be mounted before its iframe is
   * switchable). Opening the Triforge container and the Properties section forces
   * the webview to resolve.
   */
  async reveal(): Promise<void> {
    await this.sidebar.openTriforge();
    const section = await this.sidebar.getPropertiesSection();
    // Expanding the section ensures the webview view is rendered/visible.
    await section.expand();
  }

  /** Switch the driver into the Properties view's iframe. */
  async enter(): Promise<void> {
    const view = new WebviewView();
    await view.switchToFrame();
    this.view = view;
  }

  /** Leave the Properties view's iframe, returning to the workbench frame. */
  async leave(): Promise<void> {
    if (this.view) {
      await this.view.switchBack();
      this.view = undefined;
    }
  }

  /** The entered WebviewView, or throw if {@link enter} was not called. */
  private element(): WebviewView {
    if (!this.view) {
      throw new Error('Properties view not entered — call enter() first');
    }
    return this.view;
  }

  /** All rendered property-row value texts (the `.value` spans), in order. */
  async readValueTexts(): Promise<string[]> {
    const spans = await this.element().findWebElements(By.css('.tree-item .value'));
    return Promise.all(spans.map((s) => s.getText()));
  }

  /** All rendered property-row key texts (the `.key` spans), in order. */
  async readKeyTexts(): Promise<string[]> {
    const spans = await this.element().findWebElements(By.css('.tree-item .key'));
    return Promise.all(spans.map((s) => s.getText()));
  }

  /**
   * All rendered property rows as `{ key, value }` pairs, in tree order. Each
   * `.tree-item` carries a `.key` and a `.value` span; reading them together
   * lets a scenario assert a specific property (e.g. the `Name`/`Path`/`Type`/
   * `Size` of the selected file) rather than scanning value text alone.
   */
  async readRows(): Promise<Array<{ key: string; value: string }>> {
    const items = await this.element().findWebElements(By.css('.tree-item'));
    const rows: Array<{ key: string; value: string }> = [];
    for (const item of items) {
      const keyEls = await item.findElements(By.css('.key'));
      const valueEls = await item.findElements(By.css('.value'));
      if (keyEls.length === 0 || valueEls.length === 0) continue;
      rows.push({
        key: await keyEls[0].getText(),
        value: await valueEls[0].getText(),
      });
    }
    return rows;
  }

  /**
   * The value of the first rendered row whose key equals `key` exactly, or
   * `undefined` if no such row is present.
   */
  async valueForKey(key: string): Promise<string | undefined> {
    const rows = await this.readRows();
    return rows.find((r) => r.key === key)?.value;
  }

  /**
   * Whether any element matching `css` exists inside the (entered) Properties
   * view DOM. Used by injection scenarios to detect a sentinel element smuggled
   * in via an unescaped property value (e.g. an HTML payload in a project name).
   */
  async hasElement(css: string): Promise<boolean> {
    const found = await this.element().findWebElements(By.css(css));
    return found.length > 0;
  }

  /** The located `#content` container element inside the Properties view. */
  async content(): Promise<WebElement> {
    return this.element().findWebElement(By.css('#content'));
  }
}
