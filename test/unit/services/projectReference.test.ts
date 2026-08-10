import { expect } from 'chai';
import {
  projectReference,
  matchProjectReferencePrefix,
} from '../../../src/services/agentContext/render';
import type { TriforgeProject } from '../../../src/state/ProjectManager';

const proj = (p: string): TriforgeProject => ({ path: p } as unknown as TriforgeProject);

describe('projectReference (@-token = folder basename, pure)', () => {
  it('returns the last POSIX path segment', () => {
    expect(projectReference(proj('/home/u/triforge-projects/Alpha'))).to.equal('Alpha');
  });
  it('returns the last Windows path segment', () => {
    expect(projectReference(proj('C:\\Users\\u\\triforge-projects\\Bravo'))).to.equal('Bravo');
  });
  it('strips a trailing separator', () => {
    expect(projectReference(proj('/home/u/Alpha/'))).to.equal('Alpha');
    expect(projectReference(proj('C:\\Users\\u\\Bravo\\'))).to.equal('Bravo');
  });
  it('returns empty string for empty/undefined path', () => {
    expect(projectReference(proj(''))).to.equal('');
    expect(projectReference({} as unknown as TriforgeProject)).to.equal('');
  });
});

describe('matchProjectReferencePrefix (@-trigger boundary)', () => {
  it('matches a bare @ at line start', () => {
    expect(matchProjectReferencePrefix('@')).to.deep.equal({ partial: '' });
  });
  it('matches @ with a partial token', () => {
    expect(matchProjectReferencePrefix('@Al')).to.deep.equal({ partial: 'Al' });
  });
  it('matches after whitespace', () => {
    expect(matchProjectReferencePrefix('run sim on @Al')).to.deep.equal({ partial: 'Al' });
  });
  it('matches after an opening paren', () => {
    expect(matchProjectReferencePrefix('(@Al')).to.deep.equal({ partial: 'Al' });
  });
  it('does NOT match an @ glued to a preceding word (email-like)', () => {
    expect(matchProjectReferencePrefix('user@Al')).to.equal(null);
  });
  it('does NOT match a trailing @ after a word', () => {
    expect(matchProjectReferencePrefix('foo@')).to.equal(null);
  });
  it('does NOT match when a second @ closes the token', () => {
    expect(matchProjectReferencePrefix('@foo@')).to.equal(null);
  });
  it('matches only the last @-token on the line', () => {
    expect(matchProjectReferencePrefix('@foo bar @ba')).to.deep.equal({ partial: 'ba' });
  });
  it('matches after a backtick (markdown/chat prompt boxes)', () => {
    expect(matchProjectReferencePrefix('`@proj')).to.deep.equal({ partial: 'proj' });
  });
  it('matches after a double quote', () => {
    expect(matchProjectReferencePrefix('"@proj')).to.deep.equal({ partial: 'proj' });
  });
  it('matches after a hyphen (no whitespace)', () => {
    expect(matchProjectReferencePrefix('-@proj')).to.deep.equal({ partial: 'proj' });
  });
  it('matches after a period (non-whitelisted punctuation)', () => {
    expect(matchProjectReferencePrefix('.@proj')).to.deep.equal({ partial: 'proj' });
  });
  it('does NOT match an @ glued to a preceding accented (non-ASCII) letter', () => {
    expect(matchProjectReferencePrefix('café@x')).to.equal(null);
    expect(matchProjectReferencePrefix('café@')).to.equal(null);
  });
  it('does NOT match an @ glued to a preceding CJK letter', () => {
    expect(matchProjectReferencePrefix('日本@x')).to.equal(null);
  });
});
