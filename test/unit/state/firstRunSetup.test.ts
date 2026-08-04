import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Guards the activation-time "open Global Settings when setup is missing/stale"
 * behaviour and the discoverable reset escape hatch.
 *
 * VS Code keeps the globalStorage folder across uninstall/reinstall (identical on
 * Windows, macOS, and Linux — only the path differs), so a leftover
 * global_settings.json used to suppress the setup page forever after a reinstall.
 * extension.ts must route the decision through the pure needsGlobalSetup() AND
 * probe the saved workspacePath on disk. (Source-property test: the vscode host
 * isn't introspectable here, so we assert against source text.)
 */
describe('First-run / stale-settings setup prompt', () => {
  const repoRoot = process.cwd();
  const read = (rel: string): string => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

  it('extension.ts decides via needsGlobalSetup, not a bare workspacePath check', () => {
    const src = read('src/extension.ts');
    expect(src).to.contain("from './services/globalSetup'");
    expect(src).to.match(/needsGlobalSetup\s*\(/);
  });

  it('extension.ts probes the saved workspacePath as a directory (detects a removed/stray path)', () => {
    const src = read('src/extension.ts');
    expect(src).to.match(/statSync\(\s*settings\.workspacePath\s*\)\.isDirectory\(\)/);
  });

  it('needsGlobalSetup re-opens setup for empty, stale, or incomplete settings', () => {
    const src = read('src/services/globalSetup.ts');
    expect(src).to.match(/!settings\.workspacePath/);
    expect(src).to.match(/!workspaceExists/);
    expect(src).to.match(/!settings\.userName\s*\|\|\s*!settings\.email/);
  });

  it('keeps Triforge: Reset Settings palette-reachable but OUT of the view title menus', () => {
    const pkg = JSON.parse(read('package.json'));
    // The command still exists, so the Command Palette can run it...
    const commands = pkg.contributes.commands as Array<{ command: string }>;
    expect(commands.some((c) => c.command === 'triforge.resetSettings')).to.equal(true);
    // ...and it is NOT hidden from the palette.
    const paletteHidden = (pkg.contributes.menus.commandPalette ?? []).some(
      (m: { command: string; when?: string }) =>
        m.command === 'triforge.resetSettings' && m.when === 'false',
    );
    expect(paletteHidden, 'reset must stay in the Command Palette').to.equal(false);
    // ...but it is intentionally kept OUT of the view/title (...) menus so it can't
    // be mistaken for the adjacent "Triforge Global Settings" open/edit action.
    const titleMenus = pkg.contributes.menus['view/title'] as Array<{ command: string }>;
    expect(titleMenus.some((m) => m.command === 'triforge.resetSettings')).to.equal(false);
  });
});
