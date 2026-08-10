// test/unit/mcp/explainTritonRegistered.test.ts
import { expect } from 'chai';
import { buildRegistry } from '../../../src/mcp/registry';

describe('explain_triton registration (MCP)', () => {
  it('is present in the built registry', () => {
    const names = buildRegistry().list().map((t) => t.name);
    expect(names).to.include('explain_triton');
  });
});
