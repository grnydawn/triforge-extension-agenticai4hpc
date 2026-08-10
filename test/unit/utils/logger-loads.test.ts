import { expect } from 'chai';
import { Logger } from '../../../src/utils/Logger';

describe('Logger (loads under vscode stub)', () => {
  it('imports without throwing and exposes logging methods', () => {
    expect(typeof Logger.info).to.equal('function');
    expect(typeof Logger.error).to.equal('function');
  });
});
