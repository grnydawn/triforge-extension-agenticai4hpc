import { expect } from 'chai';
import { needsGlobalSetup } from '../../../src/services/globalSetup';

/**
 * Truth table for the activation-time "should we open Global Settings?" decision.
 * VS Code keeps the globalStorage folder across uninstall/reinstall (same on every
 * OS), so a leftover settings file must NOT suppress the setup page when the saved
 * location is stale or the setup was never completed.
 */
describe('needsGlobalSetup', () => {
  const complete = { workspacePath: '/home/u/triforge-projects', userName: 'Ada', email: 'ada@x.io' };

  it('opens setup when workspacePath is empty (never configured)', () => {
    expect(needsGlobalSetup({ ...complete, workspacePath: '' }, false)).to.equal(true);
  });

  it('opens setup when the configured workspace folder no longer exists (stale after reinstall)', () => {
    expect(needsGlobalSetup(complete, false)).to.equal(true);
  });

  it('opens setup when userName is blank (identity setup incomplete)', () => {
    expect(needsGlobalSetup({ ...complete, userName: '' }, true)).to.equal(true);
  });

  it('opens setup when email is blank (identity setup incomplete)', () => {
    expect(needsGlobalSetup({ ...complete, email: '' }, true)).to.equal(true);
  });

  it('leaves a complete, existing setup alone (no nag on a legitimate reinstall)', () => {
    expect(needsGlobalSetup(complete, true)).to.equal(false);
  });

  it('does not treat an existing folder as usable when identity is missing', () => {
    expect(needsGlobalSetup({ workspacePath: '/x', userName: '', email: '' }, true)).to.equal(true);
  });
});
