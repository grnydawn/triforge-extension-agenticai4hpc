// test/unit/lm/resolveArgsExplainTriton.test.ts
import { expect } from 'chai';
import { resolveInvocationArgs } from '../../../src/lm/resolveArgs';

const PCTX = { templatePath: '/ext/resources/triton_execution.cfg.template' };

describe('resolveInvocationArgs: explain_triton', () => {
  it('needs no active project and derives the knowledge dir from the template path', () => {
    const r = resolveInvocationArgs('explain_triton', {}, PCTX);
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.args.knowledgeDir).to.equal('/ext/resources/knowledge');
  });

  it('passes through a topic when provided', () => {
    const r = resolveInvocationArgs('explain_triton', { topic: 'runoff map' }, PCTX);
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.args.topic).to.equal('runoff map');
  });

  it('omits topic when blank', () => {
    const r = resolveInvocationArgs('explain_triton', { topic: '   ' }, PCTX);
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.args.topic).to.equal(undefined);
  });
});
