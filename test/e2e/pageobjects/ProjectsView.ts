import { ViewItem, ViewSection } from 'vscode-extension-tester';
import { Sidebar } from './Sidebar.ts';

/**
 * Page object for the Triforge `Projects` tree view.
 *
 * Wraps the `Projects` section of the Triforge side bar and exposes the project
 * items the extension renders from `ProjectManager.getProjects()`. The active
 * project is marked by the `(Active)` description on its tree item (see
 * `ProjectsView.ProjectNode.getTreeItem` in src).
 */
export class ProjectsView {
  private readonly sidebar = new Sidebar();

  /** Open the Triforge container and return the (expanded) Projects section. */
  async openSection(): Promise<ViewSection> {
    await this.sidebar.openTriforge();
    const section = await this.sidebar.getProjectsSection();
    await section.expand();
    return section;
  }

  /** All visible project tree items in the Projects section. */
  async getItems(): Promise<ViewItem[]> {
    const section = await this.openSection();
    return section.getVisibleItems();
  }

  /** The labels of all visible project tree items. */
  async getItemLabels(): Promise<string[]> {
    const items = await this.getItems();
    return Promise.all(items.map((i) => i.getText()));
  }

  /** The project tree item with the given label, or `undefined` if absent. */
  async getItem(label: string): Promise<ViewItem | undefined> {
    const section = await this.openSection();
    return section.findItem(label);
  }

  /**
   * The first project tree item whose label CONTAINS `fragment`, or `undefined`.
   * Used when the exact label is awkward to match verbatim (e.g. a project name
   * carrying an HTML/script payload — PRJ-2 — where matching on a plain sentinel
   * prefix is more robust than the full raw string).
   */
  async getItemContaining(fragment: string): Promise<ViewItem | undefined> {
    const items = await this.getItems();
    for (const item of items) {
      const text = await item.getText();
      if (text.includes(fragment)) return item;
    }
    return undefined;
  }

  /**
   * Whether a project with the given label is present in the tree.
   *
   * Uses `findItem` (which matches on the bare tree-item LABEL) rather than the
   * visible text, so an ACTIVE project — whose visible text carries the
   * "(Active)" description suffix — is still matched by its name alone.
   */
  async hasItem(label: string): Promise<boolean> {
    const item = await this.getItem(label);
    return item !== undefined;
  }

  /**
   * Click a project item, invoking `triforge.openProject` (the item's command),
   * which sets it active and reveals its map.
   */
  async openItem(label: string): Promise<void> {
    const item = await this.getItem(label);
    if (!item) {
      throw new Error(`no project item labelled "${label}" in the Projects view`);
    }
    await (item as ViewItem & { safeClick: () => Promise<void> }).safeClick();
  }

  /**
   * Open the named project item's context menu and select an action by its
   * visible label (e.g. `Remove Project`, contributed for `triforgeProject`
   * items). The action fires its command with the ProjectNode as the argument,
   * which is the only way to invoke `triforge.removeProject` (it is hidden from
   * the command palette — see package.json `commandPalette` `when: false`).
   */
  async selectContextMenuAction(label: string, action: string): Promise<void> {
    const item = await this.getItem(label);
    if (!item) {
      throw new Error(`no project item labelled "${label}" in the Projects view`);
    }
    const menu = await (
      item as ViewItem & { openContextMenu: () => Promise<any> }
    ).openContextMenu();
    const menuItem = await menu.getItem(action);
    if (!menuItem) {
      await menu.close();
      throw new Error(`context menu for "${label}" has no "${action}" action`);
    }
    await menuItem.select();
  }

  /**
   * Whether the named project is currently the active one. The extension marks
   * the active project's tree item with an `(Active)` description.
   */
  async isActive(label: string): Promise<boolean> {
    const item = await this.getItem(label);
    if (!item) return false;
    const description = await item.getText();
    // ViewItem.getText() returns the label; the description is rendered after it
    // for tree items, so an item showing "(Active)" includes that marker.
    if (description.includes('(Active)')) return true;
    // Fall back to the dedicated description accessor when available.
    const maybeDescribed = item as ViewItem & {
      getDescription?: () => Promise<string>;
    };
    if (typeof maybeDescribed.getDescription === 'function') {
      const desc = await maybeDescribed.getDescription();
      return desc.includes('(Active)');
    }
    return false;
  }
}
