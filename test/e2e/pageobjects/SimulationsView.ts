import { By, ContextMenu, TreeItem, VSBrowser, ViewSection } from 'vscode-extension-tester';
import { Sidebar } from './Sidebar.ts';

/**
 * Page object for the Triton `Simulations` tree view (`triton-simulations`).
 *
 * The tree shows, for the active project, an `Inputs` group (holding
 * `Static Inputs` and `Dynamic Inputs`), a `Computation` group and an `Output`
 * group whose categories (`Ascii`,
 * `Binary`, `Geotiff`) contain the project's output files as leaf
 * `RecursiveFileNode`s (see `src/views/SimulationsView.ts`). Selecting a file
 * leaf fires the tree's `onDidChangeSelection` -> `properties:update` EventBus
 * event, which the Properties webview-view renders. This page object drives that
 * file selection so Properties scenarios (PROP-1/2/3) can assert the rendered
 * panel.
 */
export class SimulationsView {
  private readonly sidebar = new Sidebar();

  /** Open the Triton container and return the (expanded) Simulations section. */
  async openSection(): Promise<ViewSection> {
    await this.sidebar.openTriton();
    const section = await this.sidebar.getSimulationsSection();
    await section.expand();
    return section;
  }

  /**
   * Expand the tree along `path` (a sequence of node labels, e.g.
   * `'Output', 'Ascii'`) and return the children of the last node — the file
   * leaves under a category. `openItem` walks the labels in order, expanding
   * each, and returns the final node's children.
   */
  async childrenOf(...path: string[]): Promise<TreeItem[]> {
    const section = await this.openSection();
    const children = await section.openItem(...path);
    return children as unknown as TreeItem[];
  }

  /**
   * Select a single file leaf at `category` (e.g. `'Ascii'`) by its basename
   * `fileLabel`. Expands the category, finds the matching leaf and clicks it,
   * which selects it in the tree and fires `properties:update` for that file.
   */
  async selectOutputFile(category: string, fileLabel: string): Promise<void> {
    const leaves = await this.childrenOf('Output', category);
    for (const leaf of leaves) {
      if ((await leaf.getLabel()) === fileLabel) {
        await this.clickLeaf(leaf);
        return;
      }
    }
    const labels = await Promise.all(leaves.map((l) => l.getLabel()));
    throw new Error(
      `no output file "${fileLabel}" under "${category}" (saw: ${labels.join(', ')})`,
    );
  }

  /**
   * Click a tree leaf to select it. ExTester's `TreeItem.select()` issues a real
   * pointer click at the element's centre, which Monaco's overlapping
   * `.monaco-icon-label-container` intercepts (`ElementClickInterceptedError`).
   * Dispatching the mouse-event sequence Monaco's list actually listens for
   * (`mousedown` -> `mouseup` -> `click`, bubbling) straight onto the row's
   * label element bypasses the pointer-occlusion check while still driving the
   * tree's selection (`onDidChangeSelection` -> `properties:update`), so the
   * Properties view updates reliably.
   */
  private async clickLeaf(leaf: TreeItem, ctrlKey = false): Promise<void> {
    await VSBrowser.instance.driver.executeScript(
      `const row = arguments[0];
       const ctrlKey = arguments[1];
       const target = row.querySelector('.monaco-icon-label, .label-name') || row;
       const r = target.getBoundingClientRect();
       const opts = {
         bubbles: true, cancelable: true, view: window,
         clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0,
         ctrlKey, metaKey: ctrlKey,
       };
       for (const type of ['mousedown', 'mouseup', 'click']) {
         target.dispatchEvent(new MouseEvent(type, opts));
       }`,
      leaf,
      ctrlKey,
    );
  }

  // ---------------------------------------------------------------------------
  // D2.1 extensions — drive simulations-tree actions (context menus, ordering,
  // expansion state, multi-select) against the REAL `triton-simulations` tree.
  //
  // ExTester's `ViewSection.openItem` / `TreeItem.expand` proved unreliable for
  // this tree: `expand()` issues a real twistie click that Monaco's overlapping
  // rows intercept (`ElementClickInterceptedError`), and `openItem` races the
  // virtual-list render and under-returns children. So these methods drive the
  // tree directly off the rendered DOM (`div[role=treeitem]` rows carry
  // `aria-label`, `aria-level`, and an `aria-expanded`/`monaco-tl-twistie`
  // collapse marker), expanding via the SAME synthetic mouse dispatch used to
  // click leaves (which bypasses the pointer-occlusion check) and polling until
  // the row set is stable.
  // ---------------------------------------------------------------------------

  /**
   * Snapshots of the currently-rendered tree rows, in VISUAL order.
   *
   * The Monaco virtual list absolutely-positions rows, so DOM order does NOT
   * match visual order — rows must be ordered by their `data-index` (the visual
   * row index) before any parent/child contiguity is computed off `aria-level`.
   */
  private async rowSnapshots(): Promise<RowSnapshot[]> {
    const section = await this.openSection();
    const rows = await section.findElements(By.css('div[role="treeitem"]'));
    const snaps: RowSnapshot[] = [];
    for (const el of rows) {
      // The rendered label lives in `.monaco-icon-label .label-name` (the row's
      // `aria-label` also folds in any description, so prefer the label element).
      let label = '';
      const nameEls = await el.findElements(By.css('.label-name'));
      if (nameEls.length > 0) {
        label = (await nameEls[0].getText()).trim();
      }
      if (!label) {
        label = ((await el.getAttribute('aria-label')) || '').trim();
      }
      const levelAttr = await el.getAttribute('aria-level');
      const indexAttr = await el.getAttribute('data-index');
      const expandedAttr = await el.getAttribute('aria-expanded'); // 'true'|'false'|null
      snaps.push({
        element: el,
        label,
        level: levelAttr ? parseInt(levelAttr, 10) : 0,
        index: indexAttr ? parseInt(indexAttr, 10) : Number.MAX_SAFE_INTEGER,
        expandable: expandedAttr !== null,
        expanded: expandedAttr === 'true',
      });
    }
    // Order by visual row index, not DOM order.
    snaps.sort((a, b) => a.index - b.index);
    return snaps;
  }

  /** The first visible row whose rendered label exactly equals `label`. */
  private async findRow(label: string): Promise<RowSnapshot | undefined> {
    const snaps = await this.rowSnapshots();
    return snaps.find((s) => s.label === label);
  }

  /** The three root group labels of the simulations tree, in render order. */
  private static readonly ROOT_GROUPS = ['Inputs', 'Computation', 'Output'];

  /**
   * Synthetic-toggle a row's expansion by clicking its TWISTIE
   * (`.monaco-tl-twistie`) rather than its label. Group/category rows can carry a
   * `command` (e.g. Static Inputs -> `triton.generateInput`); clicking the label
   * would FIRE that command instead of toggling, so the twistie is the only safe
   * collapse/expand target. Falls back to the label for rows without a twistie.
   */
  private async toggleRow(row: RowSnapshot): Promise<void> {
    await VSBrowser.instance.driver.executeScript(
      `const row = arguments[0];
       const target = row.querySelector('.monaco-tl-twistie')
         || row.querySelector('.monaco-icon-label, .label-name')
         || row;
       const r = target.getBoundingClientRect();
       const opts = {
         bubbles: true, cancelable: true, view: window,
         clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0,
       };
       for (const type of ['mousedown', 'mouseup', 'click']) {
         target.dispatchEvent(new MouseEvent(type, opts));
       }`,
      row.element,
    );
  }

  /** Collapse the row labelled `label` if it is currently expanded. */
  private async collapseRow(label: string): Promise<void> {
    const row = await this.findRow(label);
    if (!row || !row.expandable || !row.expanded) return;
    await this.toggleRow(row);
    const driver = VSBrowser.instance.driver;
    await driver.wait(
      async () => {
        const r = await this.findRow(label);
        return r !== undefined && !r.expanded;
      },
      15000,
      `tree row "${label}" did not collapse`,
    );
  }

  /**
   * Collapse the sibling root groups so the children under `keep` fit within the
   * tree viewport. The Monaco virtual list only renders rows in view, so without
   * this a category's lower children scroll out of the DOM and enumeration
   * under-counts (e.g. only the first child of an output category is rendered).
   * No-op when `keep` is not a root group (deeper paths share the same root).
   */
  private async focusRootGroup(keep: string): Promise<void> {
    if (!SimulationsView.ROOT_GROUPS.includes(keep)) return;
    for (const group of SimulationsView.ROOT_GROUPS) {
      if (group !== keep) await this.collapseRow(group);
    }
  }

  /**
   * Ensure the row labelled `label` (at depth `expectAtLevel`, if given) is
   * expanded. Polls for the row, toggles it if collapsed, and waits until it
   * reports expanded. Throws if the row never appears / never expands.
   */
  private async expandRow(label: string): Promise<void> {
    const driver = VSBrowser.instance.driver;
    await driver.wait(
      async () => (await this.findRow(label)) !== undefined,
      30000,
      `tree row "${label}" never appeared`,
    );
    let row = (await this.findRow(label))!;
    if (!row.expandable) return; // a leaf — nothing to expand
    if (row.expanded) return;
    await this.toggleRow(row);
    await driver.wait(
      async () => {
        row = (await this.findRow(label))!;
        return row !== undefined && (!row.expandable || row.expanded);
      },
      30000,
      `tree row "${label}" did not expand`,
    );
  }

  /**
   * Walk `parentPath` (a sequence of node labels), expanding each in turn, and
   * return the DIRECT-CHILD row snapshots of the last node. The children are the
   * contiguous rows AFTER the parent whose `aria-level` is exactly one deeper,
   * stopping at the first row that returns to the parent's level or shallower.
   * Polls until the child set is stable so the virtual-list render can settle.
   */
  private async childRows(...parentPath: string[]): Promise<RowSnapshot[]> {
    // Collapse sibling root groups so the children fit the viewport, then
    // expand every node along the path.
    if (parentPath.length > 0) await this.focusRootGroup(parentPath[0]);
    for (const label of parentPath) {
      await this.expandRow(label);
    }

    const driver = VSBrowser.instance.driver;
    const compute = async (): Promise<RowSnapshot[] | undefined> => {
      const snaps = await this.rowSnapshots();
      if (parentPath.length === 0) {
        // Root nodes are at the shallowest level present.
        const minLevel = Math.min(...snaps.map((s) => s.level));
        return snaps.filter((s) => s.level === minLevel);
      }
      const parentLabel = parentPath[parentPath.length - 1];
      const parentIdx = snaps.findIndex((s) => s.label === parentLabel);
      if (parentIdx < 0) return undefined;
      const parentLevel = snaps[parentIdx].level;
      const children: RowSnapshot[] = [];
      for (let i = parentIdx + 1; i < snaps.length; i++) {
        if (snaps[i].level <= parentLevel) break;
        if (snaps[i].level === parentLevel + 1) children.push(snaps[i]);
      }
      return children;
    };

    // The tree renders children ASYNCHRONOUSLY after `aria-expanded` flips, so a
    // naive "two equal reads" can latch onto a half-rendered set (both reads see
    // the same partial list). Sample with a real delay BETWEEN reads so the
    // async render can progress, and require the signature to hold across two
    // consecutive delayed samples before accepting it as settled.
    const SETTLE_DELAY_MS = 400;
    let lastSig = ' '; // sentinel that no real signature equals
    let agreements = 0;
    let stable: RowSnapshot[] | undefined;
    await driver.wait(
      async () => {
        const current = await compute();
        const sig = JSON.stringify(current?.map((c) => c.label) ?? null);
        if (current !== undefined && sig === lastSig) {
          agreements += 1;
          if (agreements >= 2) {
            stable = current;
            return true;
          }
        } else {
          agreements = 0;
          lastSig = sig;
        }
        await driver.sleep(SETTLE_DELAY_MS);
        return false;
      },
      30000,
      `children under "${parentPath.join(' > ')}" never stabilized`,
    );

    return stable ?? [];
  }

  /**
   * The labels of the direct children under `parentPath`, in tree order.
   * `parentPath` is a sequence of node labels (empty = the root nodes).
   */
  async childLabels(...parentPath: string[]): Promise<string[]> {
    const rows = await this.childRows(...parentPath);
    return rows.map((r) => r.label);
  }

  /**
   * Locate the rendered row for the node at full label `path` (each ancestor
   * expanded in order). Returns an ExTester {@link TreeItem} wrapping the row, or
   * throws if it is missing. Used to target a node for a context-menu / inline
   * action.
   */
  async getNode(...path: string[]): Promise<TreeItem> {
    await this.openSection();
    await this.focusRootGroup(path[0]);
    if (path.length > 1) {
      for (const label of path.slice(0, -1)) {
        await this.expandRow(label);
      }
    }
    const label = path[path.length - 1];
    const driver = VSBrowser.instance.driver;
    await driver.wait(
      async () => (await this.findRow(label)) !== undefined,
      30000,
      `no simulations node "${label}" (path: ${path.join(' > ')})`,
    );
    const section = await this.openSection();
    const item = await section.findItem(label);
    if (!item) {
      throw new Error(`no simulations node "${label}" (path: ${path.join(' > ')})`);
    }
    return item as unknown as TreeItem;
  }

  /**
   * Open the context menu on the node at `path` and return the LABELS of the
   * actions it offers. Closes the menu before returning. Lets a scenario assert
   * which actions are reachable from a given item's context menu (SIM-1/2).
   */
  async contextMenuActionLabels(...path: string[]): Promise<string[]> {
    const node = await this.getNode(...path);
    const menu = (await (
      node as TreeItem & { openContextMenu: () => Promise<ContextMenu> }
    ).openContextMenu()) as ContextMenu;
    try {
      // Read labels sequentially with a stale-element retry: VS Code's native
      // context menu re-renders/scrolls its rows, so a parallel `getLabel()` over
      // element handles snapshotted by `getItems()` can race the DOM and throw
      // StaleElementReferenceError. Re-fetching the items on a stale read yields
      // the same set of action labels deterministically.
      const isStale = (e: unknown): boolean =>
        e instanceof Error && e.name === 'StaleElementReferenceError';
      for (let attempt = 0; ; attempt++) {
        try {
          const items = await menu.getItems();
          const labels: string[] = [];
          for (const item of items) {
            labels.push(await item.getLabel());
          }
          return labels;
        } catch (e) {
          if (isStale(e) && attempt < 3) {
            continue;
          }
          throw e;
        }
      }
    } finally {
      await menu.close().catch(() => undefined);
    }
  }

  /**
   * Open the context menu on the node at `path` and select the action whose
   * visible label is `action`. Throws (without leaving an orphaned menu) if the
   * action is not present — so a missing/unreachable action surfaces as a real
   * failure rather than a silent no-op.
   */
  async selectContextMenuAction(action: string, ...path: string[]): Promise<void> {
    const node = await this.getNode(...path);
    const menu = (await (
      node as TreeItem & { openContextMenu: () => Promise<ContextMenu> }
    ).openContextMenu()) as ContextMenu;
    const menuItem = await menu.getItem(action);
    if (!menuItem) {
      await menu.close().catch(() => undefined);
      throw new Error(
        `context menu for "${path.join(' > ')}" has no "${action}" action`,
      );
    }
    await menuItem.select();
  }

  /**
   * The LABELS of the inline action buttons (`"group": "inline"` menu
   * contributions) on the node at `path`. Inline actions render as hover icons
   * on the tree row and are NOT part of the right-click context menu, so a
   * scenario asserts/drives them through this accessor rather than the menu.
   */
  async inlineActionLabels(...path: string[]): Promise<string[]> {
    const node = await this.getNode(...path);
    const buttons = await node.getActionButtons();
    return Promise.all(buttons.map((b) => b.getLabel()));
  }

  /**
   * Click the inline action button labelled `action` on the node at `path`
   * (e.g. "Remove Category" / "Sort Folder..." / "Filter Folder..." on an output
   * category). Throws if the node has no such inline action — so a missing inline
   * action surfaces as a real failure, not a silent no-op.
   */
  async invokeInlineAction(action: string, ...path: string[]): Promise<void> {
    const node = await this.getNode(...path);
    const button = await node.getActionButton(action);
    if (!button) {
      const labels = await this.inlineActionLabels(...path);
      throw new Error(
        `node "${path.join(' > ')}" has no inline action "${action}" ` +
          `(saw: ${labels.join(', ') || 'none'})`,
      );
    }
    await (button as unknown as { click: () => Promise<void> }).click();
  }

  /**
   * Whether a row labelled the last segment of `path` is currently rendered
   * (ancestors expanded first). A lightweight presence check that avoids the
   * full child-set stabilization.
   */
  async hasNode(...path: string[]): Promise<boolean> {
    await this.openSection();
    await this.focusRootGroup(path[0]);
    if (path.length > 1) {
      for (const label of path.slice(0, -1)) {
        await this.expandRow(label);
      }
    }
    return (await this.findRow(path[path.length - 1])) !== undefined;
  }

  /**
   * Whether the node at `path` is currently expanded (reads the rendered row's
   * `aria-expanded`). False for a leaf / absent row.
   */
  async isExpanded(...path: string[]): Promise<boolean> {
    await this.openSection();
    await this.focusRootGroup(path[0]);
    if (path.length > 1) {
      for (const label of path.slice(0, -1)) {
        await this.expandRow(label);
      }
    }
    const row = await this.findRow(path[path.length - 1]);
    return row !== undefined && row.expandable && row.expanded;
  }

  /**
   * Expand the node at `path` (its ancestors first, then itself). Throws if the
   * node is missing.
   */
  async expandNode(...path: string[]): Promise<void> {
    await this.openSection();
    await this.focusRootGroup(path[0]);
    for (const label of path) {
      await this.expandRow(label);
    }
  }

  /** Select (single-click) the node at `path`, firing the tree's selection. */
  async selectNode(...path: string[]): Promise<void> {
    await this.openSection();
    await this.focusRootGroup(path[0]);
    if (path.length > 1) {
      for (const label of path.slice(0, -1)) {
        await this.expandRow(label);
      }
    }
    const row = await this.findRow(path[path.length - 1]);
    if (!row) {
      throw new Error(`no simulations node "${path[path.length - 1]}" to select`);
    }
    await this.clickLeaf(row.element as unknown as TreeItem);
  }

  /**
   * Multi-select the two file leaves `firstLabel` and `secondLabel` under
   * `category` (both clicked; the second with Ctrl held), so the tree reports a
   * 2-item selection and the Properties view receives the multi-selection. Used
   * by SIM-8 to prove the Properties view handles multi-selection sensibly.
   */
  async multiSelectFiles(
    category: string,
    firstLabel: string,
    secondLabel: string,
  ): Promise<void> {
    const rows = await this.childRows('Output', category);
    const byLabel: Record<string, RowSnapshot> = {};
    for (const row of rows) byLabel[row.label] = row;
    const first = byLabel[firstLabel];
    const second = byLabel[secondLabel];
    if (!first || !second) {
      throw new Error(
        `multi-select needs both "${firstLabel}" and "${secondLabel}" under ` +
          `"${category}" (saw: ${Object.keys(byLabel).join(', ')})`,
      );
    }
    // First selection: a plain synthetic click on the row (avoids Monaco's
    // pointer-occlusion intercept, fires the tree's selection).
    await this.clickLeaf(first.element as unknown as TreeItem);
    // Second selection: the SAME synthetic dispatch but with ctrlKey set, which
    // Monaco's list reads to EXTEND the selection set — so the tree reports a
    // 2-item selection without needing a real (interceptable) pointer click.
    await this.clickLeaf(second.element as unknown as TreeItem, true);
  }
}

/** A snapshot of one rendered `div[role=treeitem]` row in the simulations tree. */
interface RowSnapshot {
  element: import('vscode-extension-tester').WebElement;
  label: string;
  level: number;
  /** Visual row index (`data-index`); rows are ordered by this, not DOM order. */
  index: number;
  expandable: boolean;
  expanded: boolean;
}
