import { expect } from 'chai';
import { xfail } from '../../helpers/xfail';

describe('xfail() helper', () => {
  it('resolves when the body throws (bug still present -> test passes)', async () => {
    await xfail('TEST-THROWS', () => {
      throw new Error('the bug is still here');
    });
    // Reaching here without a thrown error means xfail swallowed the failure.
  });

  it('rejects with UNEXPECTEDLY PASSED when the body does NOT throw (bug appears fixed)', async () => {
    let caught: Error | undefined;
    try {
      await xfail('TEST-NOTHROW', () => {
        // No throw: simulates the post-fix assertion now holding.
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught, 'xfail should have thrown').to.be.instanceOf(Error);
    expect(caught!.message).to.contain('UNEXPECTEDLY PASSED');
    expect(caught!.message).to.contain('TEST-NOTHROW');
  });
});
