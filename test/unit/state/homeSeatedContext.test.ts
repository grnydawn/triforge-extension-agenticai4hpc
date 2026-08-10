import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Guard for the "Open Triforge Home" title button visibility fix — SOURCE-PROPERTY
 * unit (same rationale as disposalDiscipline.test.ts): whether a `when`-clause
 * actually hides a menu item, and whether `setContext` fired, is not reliably
 * introspectable in the unit harness (no vscode host), so assert the wiring
 * against the manifest + source text directly.
 *
 * The button (`triforge.openHome`) was shown unconditionally, so in the common
 * already-seated window clicking it was a confusing no-op ("Triforge home is
 * already open..."). Fix: publish `triforge:homeSeated` and gate the menu on
 * `!triforge:homeSeated` so the icon only appears when clicking would seat the home.
 */
describe('Open Triforge Home button visibility', () => {
  const repoRoot = process.cwd();

  it('gates the openHome title button on !triforge:homeSeated (package.json)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const titleMenus: Array<{ command?: string; when?: string }> =
      pkg.contributes.menus['view/title'];
    const entry = titleMenus.find((m) => m.command === 'triforge.openHome');
    expect(entry, 'openHome view/title entry present').to.exist;
    expect(entry!.when).to.contain('view == triforge-projects');
    expect(entry!.when, 'button hidden once the home is seated').to.contain('!triforge:homeSeated');
  });

  it('AgentContextManager publishes triforge:homeSeated and tracks folder changes', () => {
    const src = fs.readFileSync(
      path.join(repoRoot, 'src/state/AgentContextManager.ts'),
      'utf8',
    );
    expect(src, 'sets the homeSeated context key').to.match(
      /setContext'\s*,\s*'triforge:homeSeated'/,
    );
    expect(src, 'recomputes on workspace folder changes').to.contain(
      'onDidChangeWorkspaceFolders',
    );
    expect(src, 'seated state derives from planControlRoot === already-seated').to.contain(
      "=== 'already-seated'",
    );
  });
});
