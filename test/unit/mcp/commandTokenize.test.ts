import { expect } from 'chai';
import { tokenizeCommand } from '../../../src/mcp/commandTokenize';

describe('tokenizeCommand', () => {
  it('splits a plain command on whitespace', () => {
    expect(tokenizeCommand('mpirun -np 4 ./triton')).to.deep.equal(['mpirun', '-np', '4', './triton']);
  });

  it('keeps double-quoted spans together', () => {
    expect(tokenizeCommand('echo "a b c"')).to.deep.equal(['echo', 'a b c']);
  });

  it('keeps single-quoted spans together', () => {
    expect(tokenizeCommand("node -e 'x = 1'")).to.deep.equal(['node', '-e', 'x = 1']);
  });

  it('honors backslash escaping outside quotes', () => {
    expect(tokenizeCommand('a\\ b c')).to.deep.equal(['a b', 'c']);
  });

  it('returns an empty array for blank input', () => {
    expect(tokenizeCommand('   ')).to.deep.equal([]);
  });

  it('treats shell metacharacters as literal argv tokens (no shell interpretation)', () => {
    expect(tokenizeCommand('sh -c echo;rm')).to.deep.equal(['sh', '-c', 'echo;rm']);
    expect(tokenizeCommand('a | b `c` $(d)')).to.deep.equal(['a', '|', 'b', '`c`', '$(d)']);
  });
});
