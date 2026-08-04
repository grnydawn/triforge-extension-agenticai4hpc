import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { VSBrowser } from 'vscode-extension-tester';

import { reloadWindow } from '../../pageobjects/workbench.ts';
import { withTempMultiWorkspace, setExtensionGlobalSettings } from '../../helpers/seed.ts';

const MARKER = 'triforge:auto-generated';

/**
 * AI project catalog: on startup the extension writes the SAME catalog body into
 * `<triforgeDir>/AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `.github/copilot-instructions.md`,
 * listing EVERY registered project with its `@`-reference and absolute path, and
 * teaching the `@<name>` convention. Consent is forced `disabled` so no
 * seat/reload fires in the empty ExTester window.
 */
describe('AI project catalog — all projects listed for @-reference', function () {
  this.timeout(180000);

  it('writes a marked catalog into all four files, listing every project + @refs + paths', async () => {
    await withTempMultiWorkspace(async ({ workspacePath, seed, register }) => {
      const alpha = seed('Alpha', { name: 'Alpha' });
      const bravo = seed('Bravo', { name: 'Bravo' });
      register([alpha.projectPath, bravo.projectPath]);
      setExtensionGlobalSettings({ aiProjectFocus: 'disabled' });

      await reloadWindow();
      await VSBrowser.instance.driver.sleep(4000);

      const triforgeDir = path.join(workspacePath, '.triforge');
      const files = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', path.join('.github', 'copilot-instructions.md')];

      for (const rel of files) {
        const file = path.join(triforgeDir, rel);
        await VSBrowser.instance.driver.wait(
          async () =>
            fs.existsSync(file) &&
            fs.readFileSync(file, 'utf8').includes('@Alpha') &&
            fs.readFileSync(file, 'utf8').includes('@Bravo'),
          15000,
          `catalog ${rel} never listed both projects`,
        );
        const md = fs.readFileSync(file, 'utf8');
        expect(md, `${rel} carries the marker`).to.include(MARKER);
        expect(md, `${rel} teaches the @-convention`).to.include('@<name>');
        expect(md, `${rel} references projects.json`).to.include('projects.json');
        expect(md, `${rel} names Alpha with its @ref`).to.include('`@Alpha`');
        expect(md, `${rel} names Bravo with its @ref`).to.include('`@Bravo`');
        expect(md, `${rel} embeds Alpha's path`).to.include(alpha.projectPath);
        expect(md, `${rel} embeds Bravo's path`).to.include(bravo.projectPath);
      }

      for (const proj of [alpha, bravo]) {
        const g = path.join(proj.projectPath, 'GEMINI.md');
        await VSBrowser.instance.driver.wait(
          async () => fs.existsSync(g),
          20000,
          `expected per-project GEMINI.md at ${g}`,
        );
        expect(fs.readFileSync(g, 'utf8')).to.include('Gemini');
      }
    });
  });

  it('does NOT overwrite a user-authored catalog AGENTS.md lacking the marker', async () => {
    await withTempMultiWorkspace(async ({ workspacePath, seed, register }) => {
      const alpha = seed('Alpha', { name: 'Alpha' });
      register([alpha.projectPath]);

      const triforgeDir = path.join(workspacePath, '.triforge');
      const agents = path.join(triforgeDir, 'AGENTS.md');
      const userContent = '# My own .triforge notes — keep me\n';
      fs.mkdirSync(triforgeDir, { recursive: true });
      fs.writeFileSync(agents, userContent);

      await reloadWindow();
      await VSBrowser.instance.driver.sleep(4000);

      // CLAUDE.md (no user version) appearing proves the catalog handler ran.
      await VSBrowser.instance.driver.wait(
        async () => fs.existsSync(path.join(triforgeDir, 'CLAUDE.md')),
        15000,
        'catalog handler did not run within 15s of reload',
      );
      expect(fs.readFileSync(agents, 'utf8'), 'user AGENTS.md must be preserved').to.equal(userContent);
    });
  });
});
