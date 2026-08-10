import { By, Key, WebView } from 'vscode-extension-tester';
import { Workbench } from 'vscode-extension-tester';
import { enterWebview, leaveWebview, waitForSelector } from './webview.ts';

/**
 * Page object for the Triforge ProjectCreator webview (`triforge.createProject`).
 *
 * The panel renders in a (nested-iframe) webview with these controls (see
 * `src/panels/templates/ProjectCreatorHtml.ts`):
 *   #projectName #projectPath #browseBtn
 *   #inputFormat #outputFormat
 *   #ncols #nrows #xllcorner #yllcorner #cellsize #nodata #utmZone #datum
 *   #loadDemFileBtn #generateFromMapBtn #createBtn #cancelBtn
 *
 * Typing into #projectName auto-derives #projectPath (`<parent>/<name>`); tests
 * that need a controlled location overwrite #projectPath explicitly afterwards.
 * The real create handler (`ProjectCreator._handleCreateProject`) reuses an
 * existing target folder, and requires a name and ncols/nrows/cellsize(>0)/zone.
 */
export class ProjectCreator {
  private webview: WebView | undefined;

  /** Command-palette title contributed for `triforge.createProject`. */
  private static readonly OPEN_COMMAND_TITLE = 'Create New Project';

  /** Run the create-project command and switch into the ProjectCreator webview. */
  async open(): Promise<void> {
    await new Workbench().executeCommand(ProjectCreator.OPEN_COMMAND_TITLE);
    this.webview = await enterWebview();
    await waitForSelector(this.webview, '#projectName');
  }

  /** Set the Project Name field (this also auto-derives the Project Location). */
  async setName(value: string): Promise<void> {
    await this.setInput('#projectName', value);
  }

  /** Overwrite the Project Location field with an explicit absolute path. */
  async setPath(value: string): Promise<void> {
    await this.setInput('#projectPath', value);
  }

  /** Fill the UTM grid fields required for a valid create. */
  async setGrid(grid: {
    ncols: number;
    nrows: number;
    cellsize: number;
    xllcorner?: number;
    yllcorner?: number;
    nodata?: number;
    utmZone?: string;
  }): Promise<void> {
    await this.setInput('#ncols', String(grid.ncols));
    await this.setInput('#nrows', String(grid.nrows));
    await this.setInput('#cellsize', String(grid.cellsize));
    if (grid.xllcorner !== undefined) await this.setInput('#xllcorner', String(grid.xllcorner));
    if (grid.yllcorner !== undefined) await this.setInput('#yllcorner', String(grid.yllcorner));
    if (grid.nodata !== undefined) await this.setInput('#nodata', String(grid.nodata));
    if (grid.utmZone !== undefined) await this.setInput('#utmZone', grid.utmZone);
  }

  /** Current value of the Project Location field. */
  async readPath(): Promise<string> {
    return this.readInput('#projectPath');
  }

  /**
   * Click Create Project. On a valid form the extension creates the project dir,
   * writes config.json, registers it and disposes the panel — so this also
   * leaves the webview iframe.
   */
  async create(): Promise<void> {
    const btn = await this.element().findWebElement(By.css('#createBtn'));
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
      throw new Error('ProjectCreator webview not open — call open() first');
    }
    return this.webview;
  }

  /** Clear an input and type a fresh value. */
  private async setInput(css: string, value: string): Promise<void> {
    const input = await waitForSelector(this.element(), css);
    await input.clear();
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
