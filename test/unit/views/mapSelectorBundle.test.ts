import * as fs from 'fs';
import * as path from 'path';

import { expect } from 'chai';

/**
 * MAP-8 regression guard — PKG-2 (FIXED): `MapSelector` must load its webview
 * bundle from the fresh `dist/webview/map.bundle.js` (parity with `MapEditor`),
 * NOT the stale committed `media/map.bundle.js`.
 *
 * PKG-2 history: `src/panels/MapSelector.ts` used to resolve
 * `joinPath(extensionUri, 'media', 'map.bundle.js')` (a git-tracked bundle never
 * rebuilt by `build:webview`), while `MapEditor` resolved
 * `joinPath(extensionUri, 'dist', 'webview', 'map.bundle.js')` (fresh). So the
 * Pick-Simulation-Area surface ran an out-of-sync copy of the map code and future
 * map fixes silently missed MapSelector. The fix repoints MapSelector at
 * `dist/webview/map.bundle.js` (and adds `dist/webview` to its
 * `localResourceRoots`) and deletes the committed `media/*.bundle.js` dupes.
 *
 * Why a source-property UNIT: which on-disk bundle a webview panel actually loaded
 * is not reliably introspectable from E2E (the bundle is fetched as an opaque
 * `vscode-webview://` resource; its origin path is not exposed). So this guard
 * reads the `MapSelector` source directly and asserts the fixed property. It was
 * previously an `xfail('PKG-2')`; PKG-2 is now fixed so this is a bare green
 * regression guard (it fails if MapSelector ever regresses to the media/ bundle).
 */
describe('MapSelector bundle path (MAP-8 / PKG-2: dist/webview parity with MapEditor)', () => {
  const MAP_SELECTOR_SRC = path.resolve(
    process.cwd(),
    'src',
    'panels',
    'MapSelector.ts',
  );

  /** The MapSelector source text. */
  function readSource(): string {
    return fs.readFileSync(MAP_SELECTOR_SRC, 'utf8');
  }

  it('resolves its map.bundle.js from dist/webview (not the stale media/ copy)', () => {
    const src = readSource();

    // MapSelector joins the bundle from 'dist','webview' like MapEditor does —
    // i.e. it references the fresh dist/webview path AND no longer references a
    // media/<...>map.bundle.js path.
    const resolvesDistWebview =
      /joinPath\([^)]*['"]dist['"]\s*,\s*['"]webview['"]\s*,\s*['"]map\.bundle\.js['"]/.test(
        src,
      ) || /dist\/webview\/map\.bundle\.js/.test(src);

    const stillReferencesMediaBundle =
      /joinPath\([^)]*['"]media['"]\s*,\s*['"]map\.bundle\.js['"]/.test(src) ||
      /media\/map\.bundle\.js/.test(src);

    expect(
      resolvesDistWebview,
      "MapSelector must load 'dist/webview/map.bundle.js' (parity with MapEditor) — PKG-2",
    ).to.be.true;
    expect(
      stillReferencesMediaBundle,
      'MapSelector must NOT reference the stale media/map.bundle.js — PKG-2',
    ).to.be.false;
  });
});
