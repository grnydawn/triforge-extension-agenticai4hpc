import { expect } from 'chai';
import * as path from 'path';
import { canonicalOutputDir, resolveOutputNormalization } from '../../../src/services/outputNormalize';

describe('outputNormalize (pin results to <project>/output)', () => {
  const project = { path: '/abs/proj' };

  it('canonical output dir is <project>/output', () => {
    expect(canonicalOutputDir(project)).to.equal(path.join('/abs/proj', 'output'));
  });

  it('flags relocation when triton wrote to build/output', () => {
    const plan = resolveOutputNormalization(project, '/abs/proj/build/output');
    expect(plan.canonicalDir).to.equal(path.join('/abs/proj', 'output'));
    expect(plan.sourceDir).to.equal('/abs/proj/build/output');
    expect(plan.needsRelocation).to.equal(true);
  });

  it('no relocation when already canonical (even with a trailing slash / .. noise)', () => {
    expect(resolveOutputNormalization(project, '/abs/proj/output').needsRelocation).to.equal(false);
    expect(resolveOutputNormalization(project, '/abs/proj/build/../output').needsRelocation).to.equal(false);
  });
});
