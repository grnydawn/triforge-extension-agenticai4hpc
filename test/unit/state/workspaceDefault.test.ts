import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression guard for the default-workspace scatter bug — SOURCE-PROPERTY unit
 * (same rationale as workspaceDefault's siblings: the default lives in
 * vscode-coupled panel code, so assert it against source text).
 *
 * BUG: SettingsEditor defaulted `workspacePath` to `~/.triforge`. But
 * getTriforgeWorkspaceRoot() (src/commands/project.ts) strips a trailing
 * `.triforge` segment to its PARENT, so with that default the workspace root
 * resolved to the home directory and imported projects were written straight
 * into `~/<name>` instead of a dedicated projects folder. ProjectCreator already
 * defaulted to `~/triforge-projects`; the two disagreed.
 *
 * FIX: both defaults are `~/triforge-projects`. Projects live as its children and
 * the `.triforge` control dir is created inside it.
 */
describe('Default workspace path', () => {
  const repoRoot = process.cwd();
  const read = (rel: string): string =>
    fs.readFileSync(path.join(repoRoot, rel), 'utf8');

  it('SettingsEditor defaults workspacePath to ~/triforge-projects', () => {
    const src = read('src/panels/SettingsEditor.ts');
    expect(src, 'default uses the triforge-projects folder').to.match(
      /homedir\(\)\s*,\s*'triforge-projects'\s*\)/,
    );
  });

  it('SettingsEditor no longer defaults to the bare .triforge control dir (scatter bug)', () => {
    const src = read('src/panels/SettingsEditor.ts');
    // The only remaining `.triforge` mentions must be prose, never a homedir join
    // that would set the DEFAULT workspace path to the control dir itself.
    expect(src).to.not.match(/homedir\(\)\s*,\s*'\.triforge'\s*\)/);
  });

  it('ProjectCreator derives new-project location from the configured project folder', () => {
    const creator = read('src/panels/ProjectCreator.ts');
    // Uses the user-configured workspace root (consistent with imports)…
    expect(creator).to.contain('workspaceRootFromPath');
    expect(creator).to.match(/getSettings\(\)\.workspacePath/);
    // …falling back to ~/triforge-projects only when no workspace is configured.
    expect(creator, 'fallback matches SettingsEditor default').to.match(
      /homedir\(\)\s*,\s*'triforge-projects'\s*\)/,
    );
  });
});
