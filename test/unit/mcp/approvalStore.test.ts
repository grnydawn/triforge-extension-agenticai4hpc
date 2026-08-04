import { expect } from 'chai';
import { ApprovalStore, approvalArgsKey } from '../../../src/mcp/approvalStore';

describe('approvalArgsKey', () => {
  it('is stable regardless of key order', () => {
    expect(approvalArgsKey({ a: 1, b: 2 })).to.equal(approvalArgsKey({ b: 2, a: 1 }));
  });

  it('excludes approvalToken so the key matches across the two calls', () => {
    expect(approvalArgsKey({ x: 1, approvalToken: 'tok' })).to.equal(approvalArgsKey({ x: 1 }));
  });

  it('differs when a real argument differs', () => {
    expect(approvalArgsKey({ x: 1 })).to.not.equal(approvalArgsKey({ x: 2 }));
  });
});

describe('ApprovalStore', () => {
  it('consume() succeeds once for the matching tool + args, then fails (single-use)', () => {
    const s = new ApprovalStore();
    const key = approvalArgsKey({ runDir: '/tmp/x' });
    const token = s.issue('run_local', key);
    expect(s.consume(token, 'run_local', key)).to.equal(true);
    expect(s.consume(token, 'run_local', key)).to.equal(false);
  });

  it('consume() rejects a wrong tool name', () => {
    const s = new ApprovalStore();
    const key = approvalArgsKey({ a: 1 });
    const token = s.issue('run_local', key);
    expect(s.consume(token, 'build', key)).to.equal(false);
  });

  it('consume() rejects a mismatched args key', () => {
    const s = new ApprovalStore();
    const token = s.issue('run_local', approvalArgsKey({ a: 1 }));
    expect(s.consume(token, 'run_local', approvalArgsKey({ a: 2 }))).to.equal(false);
  });

  it('consume() rejects an unknown token', () => {
    const s = new ApprovalStore();
    expect(s.consume('nope', 'run_local', approvalArgsKey({}))).to.equal(false);
  });
});
