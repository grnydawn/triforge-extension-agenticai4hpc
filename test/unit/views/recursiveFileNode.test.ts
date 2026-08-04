import * as path from 'path';

import { expect } from 'chai';

import { RecursiveFileNode, SimulationsView } from '../../../src/views/SimulationsView';

/**
 * VIEW-3 unit guard — `RecursiveFileNode.getTreeItem()` must give each rendered
 * `TreeItem` a STABLE `id` equal to the node's absolute file path.
 *
 * VIEW-3 (source): `src/views/SimulationsView.ts` `RecursiveFileNode.getTreeItem()`
 * builds the `TreeItem` from the node's basename but never sets `item.id`. Without
 * a stable id VS Code falls back to label-based identity, which the review says
 * (a) loses folder expansion across refreshes and (b) collides duplicate
 * basenames. The user-visible symptom does NOT reproduce in the ExTester / VS
 * Code 1.90 E2E harness (see test/XFAIL.md VIEW-3; SIM-6/SIM-7 are green
 * observations), so the flipping guard lives HERE at the unit level: it observes
 * the missing id directly off the rendered `TreeItem`.
 *
 * Post-fix property: `getTreeItem().id === <absolute file path>` (a stable,
 * collision-free identity). Today `id` is `undefined`, so the equality assertion
 * throws and the xfail passes; once VIEW-3 sets the stable id the assertion holds
 * and the xfail flips loudly ("UNEXPECTEDLY PASSED").
 */
describe('RecursiveFileNode.getTreeItem (VIEW-3: stable id = absolute path)', () => {
  // A real provider; getTreeItem() for a FILE node never touches it (it only
  // reads folder state on the directory branch), but constructing the genuine
  // node faithfully keeps the guard honest.
  const provider = new SimulationsView();

  it("a file node's TreeItem carries a stable id equal to its absolute path", async () => {
    const absPath = path.join(path.sep + 'tmp', 'triforge-view3', 'a', 'same.out');
    const node = new RecursiveFileNode(absPath, false, provider);

    const item = await node.getTreeItem();
    // The rendered TreeItem identifies the node by its absolute path.
    expect(
      (item as { id?: string }).id,
      'RecursiveFileNode.getTreeItem() should set a stable id equal to the absolute file path',
    ).to.equal(absPath);
  });

  it("a directory node's TreeItem carries a stable id equal to its absolute path", async () => {
    // Two distinct directories sharing a basename ('same') are exactly the
    // collision case VIEW-3's stable id prevents; guard the dir branch too.
    const absDir = path.join(path.sep + 'tmp', 'triforge-view3', 'b', 'same');
    const node = new RecursiveFileNode(absDir, true, provider);

    const item = await node.getTreeItem();
    expect(
      (item as { id?: string }).id,
      'RecursiveFileNode.getTreeItem() should set a stable id equal to the absolute folder path',
    ).to.equal(absDir);
  });
});
