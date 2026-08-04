import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { expect } from 'chai';

import { RecursiveFileNode, SimulationsView } from '../../../src/views/SimulationsView';

/**
 * VIEW-2 flipping guard — the tree directory scan + sort must run OFF the
 * extension-host thread: `RecursiveFileNode.getDirectoryChildren` must use
 * `fs.promises.readdir({ withFileTypes: true })` and pre-compute mtimes once with
 * async `fs.promises.stat`, and must NEVER call synchronous `fs.readdirSync` /
 * `fs.statSync` on the host path.
 *
 * VIEW-2 (source): `src/views/SimulationsView.ts` previously listed the directory
 * with `fs.readdirSync` + a per-entry `fs.statSync`, and the modified-time sort
 * called `fs.statSync` TWICE per comparison inside `Array.sort`. Expanding a large
 * output folder therefore froze the sidebar on the host thread.
 *
 * Why a behavioral UNIT (per test/XFAIL.md VIEW-2 CAVEAT): the original E2E
 * (SIM-9) measures wall-clock time-to-expanded via Selenium, which an async fix
 * does NOT necessarily reduce (it unblocks the UI thread but the total scan/render
 * cost is similar), so SIM-9 cannot cleanly flip. The faithful, flippable signal
 * is the source property "the scan no longer runs synchronously on the host
 * thread". This guard observes it directly: it sabotages the synchronous FS APIs
 * (`fs.readdirSync` / `fs.statSync` throw) and proves the real scan still returns
 * all children — which is only possible if it went fully through `fs.promises`.
 *
 * The earlier xfail('VIEW-2') lived on SIM-9 (now a green characterization). This
 * bare assertion replaces it as the flipping guard.
 */
describe('RecursiveFileNode.getDirectoryChildren (VIEW-2: async FS + precomputed mtimes)', () => {
  const provider = new SimulationsView();

  let tmpDir: string;
  const fileNames = ['a.out', 'b.out', 'c.out', 'sub'];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triforge-view2-'));
    fs.writeFileSync(path.join(tmpDir, 'a.out'), 'x');
    fs.writeFileSync(path.join(tmpDir, 'b.out'), 'xx');
    fs.writeFileSync(path.join(tmpDir, 'c.out'), 'xxx');
    fs.mkdirSync(path.join(tmpDir, 'sub'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Run `body` with the synchronous FS APIs sabotaged so any host-thread
   * `readdirSync`/`statSync`/`existsSync`/`openSync`/`readSync` call throws. Only
   * an async (`fs.promises`) scan can succeed under this sabotage.
   */
  async function withSyncFsSabotaged(body: () => Promise<void>): Promise<void> {
    const sync = {
      readdirSync: fs.readdirSync,
      statSync: fs.statSync,
      existsSync: fs.existsSync,
      openSync: fs.openSync,
      readSync: fs.readSync,
    };
    const boom = (name: string) => () => {
      throw new Error(`VIEW-2: synchronous fs.${name} must not be used in the tree scan`);
    };
    (fs as Record<string, unknown>).readdirSync = boom('readdirSync');
    (fs as Record<string, unknown>).statSync = boom('statSync');
    (fs as Record<string, unknown>).existsSync = boom('existsSync');
    (fs as Record<string, unknown>).openSync = boom('openSync');
    (fs as Record<string, unknown>).readSync = boom('readSync');
    try {
      await body();
    } finally {
      Object.assign(fs as Record<string, unknown>, sync);
    }
  }

  it('lists directory children without any synchronous fs call (default name sort)', async () => {
    await withSyncFsSabotaged(async () => {
      const children = await RecursiveFileNode.getDirectoryChildren(tmpDir, provider);
      const labels = children.map(c => (c as RecursiveFileNode).fullPath).map(p => path.basename(p));
      expect(labels.sort()).to.deep.equal([...fileNames].sort());
    });
  });

  it('sorts by modified time without statSync inside the comparator (mtimes precomputed)', async () => {
    // Drive the modified-time branch: this is where the old code called
    // statSync TWICE per comparison inside Array.sort. The fix pre-computes each
    // mtime once via async fs.promises.stat, so the sort runs with NO sync stat.
    provider.setFolderSort(
      new RecursiveFileNode(tmpDir, true, provider),
      'modified',
      'asc',
    );
    await withSyncFsSabotaged(async () => {
      const children = await RecursiveFileNode.getDirectoryChildren(tmpDir, provider);
      // All entries are still returned (the scan completed off the host thread).
      expect(children.length).to.equal(fileNames.length);
    });
  });

  it('getDirectoryChildren is asynchronous (returns a Promise)', () => {
    const result = RecursiveFileNode.getDirectoryChildren(tmpDir, provider);
    expect(result).to.be.an.instanceOf(Promise);
    return result; // settle it so no unhandled rejection
  });
});
