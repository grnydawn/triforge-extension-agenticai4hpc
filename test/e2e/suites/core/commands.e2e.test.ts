import * as fs from 'fs';
import * as path from 'path';

import { expect } from 'chai';
import { InputBox, QuickOpenBox, VSBrowser, Workbench } from 'vscode-extension-tester';

import { resetToWorkbench } from '../../pageobjects/workbench.ts';

/**
 * PKG-CI-5 (CODE_REVIEW PKG-5) — internal commands must NOT appear in the
 * Command Palette.
 *
 * PKG-5: ~7 registered commands were never declared in `contributes.commands`,
 * and the internal/context-menu-only commands had no `commandPalette` gating, so
 * they "pollute or miss the Command Palette." T0's fix declares every command and
 * lists the internal ones in `contributes.menus.commandPalette` with
 * `"when": "false"`, which hides them from the palette while keeping their
 * context-menu/title-bar invocations.
 *
 * This suite opens the REAL Command Palette in VS Code, filters to Triforge
 * commands, and asserts:
 *   - every command declared `"when": "false"` is ABSENT, and
 *   - at least one public command IS present.
 * The internal/public split is DERIVED from package.json, not hardcoded, so the
 * assertion tracks the manifest rather than restating it.
 */
describe('PKG-CI-5 — internal commands hidden from the Command Palette', function () {
  this.timeout(120000);

  interface CommandDecl {
    command: string;
    title: string;
    category?: string;
  }

  let internalLabels: string[];
  let publicLabels: string[];

  before(async function () {
    // Derive the internal/public command lists from the manifest.
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    const commands: CommandDecl[] = pkg.contributes.commands;
    const byId = new Map<string, CommandDecl>(commands.map((c) => [c.command, c]));

    // Internal = commands listed in commandPalette with `when: "false"`.
    const palette: Array<{ command: string; when?: string }> =
      pkg.contributes.menus.commandPalette ?? [];
    const internalIds = palette
      .filter((e) => String(e.when) === 'false')
      .map((e) => e.command);

    // The palette shows a command as `category: title` when a category is set,
    // else just `title`. Build the exact display label for each declared command.
    const labelFor = (id: string): string => {
      const decl = byId.get(id);
      if (!decl) {
        throw new Error(
          `package.json: commandPalette references "${id}" which is not declared in contributes.commands`,
        );
      }
      return decl.category ? `${decl.category}: ${decl.title}` : decl.title;
    };

    internalLabels = internalIds.map(labelFor);

    // Public = declared commands that are NOT gated internal. We only assert that
    // a couple of well-known public commands are present (a public command may be
    // when-gated by other context and legitimately hidden), so pick stable ones.
    const internalSet = new Set(internalIds);
    const publicCandidates = ['triforge.openSettings', 'triforge.createProject'].filter(
      (id) => !internalSet.has(id) && byId.has(id),
    );
    publicLabels = publicCandidates.map(labelFor);

    expect(internalLabels, 'expected internal (when:false) commands in manifest').to.not.be
      .empty;
    expect(publicLabels, 'expected at least one public command to check').to.not.be.empty;

    await VSBrowser.instance.waitForWorkbench();
    await resetToWorkbench();
  });

  /**
   * Open the Command Palette in command mode (leading `>`), type `filter`, and
   * collect every quick-pick label currently shown. We filter by each command's
   * OWN label so the negative result is meaningful: a hidden command stays absent
   * even when the search text exactly matches its title, whereas a visible command
   * surfaces under its own title. Returns labels (de-duped, trimmed).
   */
  async function paletteLabelsFor(filter: string): Promise<string[]> {
    const prompt: QuickOpenBox | InputBox = await new Workbench().openCommandPrompt();
    try {
      // `>` puts the palette in command mode; the rest narrows the result set.
      await prompt.setText(`>${filter}`);
      // Let the palette settle its filtered result set.
      await VSBrowser.instance.driver.sleep(1200);

      const picks = await prompt.getQuickPicks();
      const labels = new Set<string>();
      for (const pick of picks) {
        try {
          labels.add((await pick.getLabel()).trim());
        } catch {
          /* a pick can go stale as the list re-renders; skip it */
        }
      }
      return [...labels];
    } finally {
      await prompt.cancel().catch(() => undefined);
    }
  }

  it('shows public Triforge commands in the palette', async () => {
    // Each public command must surface when searched by its own label.
    for (const label of publicLabels) {
      const labels = await paletteLabelsFor(label);
      expect(
        labels,
        `expected public command "${label}" to be in the Command Palette; ` +
          `palette showed ${JSON.stringify(labels)}`,
      ).to.include(label);
    }
  });

  it('hides every "when:false" internal command (PKG-5)', async () => {
    const leaked: string[] = [];
    for (const label of internalLabels) {
      // Filter by the command's own title; a properly gated command will NOT
      // appear even though the search text matches it exactly.
      const labels = await paletteLabelsFor(label);
      if (labels.includes(label)) {
        leaked.push(label);
      }
    }
    expect(
      leaked,
      `internal commands must be hidden from the Command Palette (PKG-5), ` +
        `but these leaked: ${JSON.stringify(leaked)}`,
    ).to.deep.equal([]);
  });
});
