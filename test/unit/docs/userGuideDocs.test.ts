import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Source-property guard for the two user-guide sections added for project
 * sharing (export/import) and AI-agent integration. Asserts the load-bearing,
 * code-verified facts are present so a future edit can't silently drop or
 * mangle them. (Reads the rendered Markdown source; there is no vscode host to
 * introspect here — same style as firstRunSetup.test.ts.)
 *
 * Multi-word prose is checked against a whitespace-normalized copy (`flat`) so a
 * soft line-wrap inside a phrase — e.g. "...API keys are\nnever written..." — does
 * not cause a false failure. Exact heading lines and single tokens (filenames,
 * `.tfp`, `@<folder-name>`) are checked against the raw source.
 */
describe('user-guide: share + AI-agents sections', () => {
  const repoRoot = process.cwd();
  const doc = fs.readFileSync(path.join(repoRoot, 'docs/user-guide.md'), 'utf8');
  const flat = doc.replace(/\s+/g, ' ');
  // The AI-agents material is promoted to its own top-level page (docs/ai-agents.md).
  const ai = fs.readFileSync(path.join(repoRoot, 'docs/ai-agents.md'), 'utf8');
  const aiFlat = ai.replace(/\s+/g, ' ');

  describe('Share a project (export/import)', () => {
    it('has the section heading', () => {
      expect(doc).to.include('## Share a project: export and import');
    });
    it('names both commands and the archive extension', () => {
      expect(flat).to.include('Export Project');
      expect(flat).to.include('Import Project');
      expect(doc).to.include('.tfp');
    });
    it('documents the two export choices and the Merge fold-back', () => {
      expect(flat).to.include('Inputs only');
      expect(flat).to.include('Inputs + outputs');
      expect(doc).to.include('Merge');
    });
    it('walks the Windows <-> macOS round-trip', () => {
      expect(flat).to.match(/On Windows/);
      expect(flat).to.match(/On macOS/);
    });
  });

  // Promoted to its own top-level page: docs/ai-agents.md.
  describe('Work with AI agents (ai-agents.md)', () => {
    it('is a top-level page with the H1 heading', () => {
      expect(ai).to.include('# Work with AI agents');
    });
    it('covers both surfaces: in-editor Copilot and the MCP server', () => {
      expect(aiFlat).to.include('GitHub Copilot');
      expect(aiFlat).to.include('MCP server');
      expect(ai).to.include('npm run mcp:build');
    });
    it('names the agent-callable capabilities', () => {
      expect(aiFlat).to.include('Configure the solver');
      expect(aiFlat).to.include('Run TRITON locally');
      expect(aiFlat).to.include('Diagnose a project');
    });
    it('documents the @name reference and the home catalog button', () => {
      expect(ai).to.include('@<folder-name>');
      expect(aiFlat).to.include('Open Triforge Home (AI Catalog)');
    });
    it('maps each AI tool to the file it auto-reads', () => {
      expect(ai).to.include('CLAUDE.md');
      expect(ai).to.include('GEMINI.md');
      expect(ai).to.include('AGENTS.md');
      expect(ai).to.include('.github/copilot-instructions.md');
    });
    it('states API keys are never written into catalog files', () => {
      expect(aiFlat).to.match(/API keys are never/i);
    });
  });
});
