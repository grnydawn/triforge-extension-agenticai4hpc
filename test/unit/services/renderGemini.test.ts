import { expect } from 'chai';
import {
  TRIFORGE_CONTEXT_MARKER,
  renderGeminiPointer,
  renderAgentsMd,
} from '../../../src/services/agentContext/render';
import type { TriforgeProject } from '../../../src/state/ProjectManager';

describe('renderGeminiPointer', () => {
  it('carries the provenance marker so it is overwrite-safe', () => {
    expect(renderGeminiPointer()).to.include(TRIFORGE_CONTEXT_MARKER);
  });
  it('names Gemini and points at AGENTS.md', () => {
    const md = renderGeminiPointer();
    expect(md).to.include('Gemini');
    expect(md).to.include('AGENTS.md');
  });
});

describe('renderAgentsMd — Gemini in the other-tools footer', () => {
  it('lists GEMINI.md among the tool files that point here', () => {
    const p = { name: 'Alpha', path: '/p/Alpha' } as unknown as TriforgeProject;
    expect(renderAgentsMd(p)).to.include('GEMINI.md');
  });
});
