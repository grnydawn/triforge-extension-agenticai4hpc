import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { VSBrowser } from 'vscode-extension-tester';

import { ProjectsView } from '../../pageobjects/ProjectsView.ts';
import { reloadWindow } from '../../pageobjects/workbench.ts';
import { withTempWorkspace } from '../../helpers/seed.ts';

const MARKER = 'triforge:auto-generated';

/**
 * AI-context generation: opening a Triforge project writes a provenance-marked
 * AGENTS.md (+ CLAUDE.md / copilot pointer) describing the project, so any agentic
 * AI in VS Code can answer questions about it. The provenance guard must never
 * clobber a user's own context file. (Workspace-folder addition is intentionally
 * skipped on an empty window, which is how ExTester launches VS Code, so it is not
 * asserted here.)
 */
describe('AI context — AGENTS.md generation & sync', function () {
  this.timeout(180000);

  it('writes AGENTS.md + pointers (marked, no secrets) referencing the project dirs', async () => {
    await withTempWorkspace(async ({ projectPath, projectName }) => {
      await reloadWindow();
      await VSBrowser.instance.driver.sleep(4000);

      const projects = new ProjectsView();
      await VSBrowser.instance.driver.wait(
        async () => projects.hasItem(projectName),
        30000,
        `"${projectName}" never appeared in the Projects tree after reload`,
      );
      await projects.openItem(projectName);

      const agents = path.join(projectPath, 'AGENTS.md');
      await VSBrowser.instance.driver.wait(
        async () => fs.existsSync(agents),
        10000,
        'AGENTS.md was not created within 10s of opening the project',
      );

      const claude = path.join(projectPath, 'CLAUDE.md');
      const copilot = path.join(projectPath, '.github', 'copilot-instructions.md');

      expect(fs.existsSync(agents), 'AGENTS.md should exist').to.be.true;
      expect(fs.existsSync(claude), 'CLAUDE.md should exist').to.be.true;
      expect(fs.existsSync(copilot), 'copilot-instructions.md should exist').to.be.true;

      const md = fs.readFileSync(agents, 'utf8');
      expect(md, 'manifest carries the provenance marker').to.include(MARKER);
      expect(md, 'manifest references the project root').to.include(projectPath);
      expect(md, 'manifest references the output directory').to.include(path.join(projectPath, 'output'));
      expect(md.toLowerCase(), 'manifest must not leak secrets').to.not.include('apikey');

      // Pointers reference AGENTS.md and carry the marker.
      const claudeContent = fs.readFileSync(claude, 'utf8');
      expect(claudeContent).to.include('AGENTS.md');
      expect(claudeContent).to.include(MARKER);
      expect(fs.readFileSync(copilot, 'utf8')).to.include(MARKER);
    });
  });

  it('does NOT overwrite a user-authored AGENTS.md that lacks the marker', async () => {
    await withTempWorkspace(async ({ projectPath, projectName }) => {
      const agents = path.join(projectPath, 'AGENTS.md');
      const userContent = '# My own notes — keep me\n';
      fs.writeFileSync(agents, userContent);

      await reloadWindow();
      await VSBrowser.instance.driver.sleep(4000);

      const projects = new ProjectsView();
      await VSBrowser.instance.driver.wait(
        async () => projects.hasItem(projectName),
        30000,
        `"${projectName}" never appeared in the Projects tree after reload`,
      );
      await projects.openItem(projectName);

      // CLAUDE.md (no user version) IS written by the manager; its appearance proves
      // the context-write handler ran, so we can now assert the guard left AGENTS.md alone.
      await VSBrowser.instance.driver.wait(
        async () => fs.existsSync(path.join(projectPath, 'CLAUDE.md')),
        10000,
        'context-write handler did not run within 10s of opening the project',
      );

      expect(fs.readFileSync(agents, 'utf8'), 'user AGENTS.md must be preserved').to.equal(userContent);
    });
  });
});
