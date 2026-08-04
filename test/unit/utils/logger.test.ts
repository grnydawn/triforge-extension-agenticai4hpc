import { expect } from 'chai';
import * as vscode from 'vscode';

import { Logger } from '../../../src/utils/Logger';

describe('Logger.error (Error serialization)', () => {
  // BUG-6: Logger.error serializes the Error with JSON.stringify(error, null, 2).
  // Error.message and Error.stack are non-enumerable, so JSON.stringify renders
  // the Error as `{}` — the actual error text is lost from the output channel.
  //
  // The assertion is the POST-FIX expectation: the recorded output should contain
  // the error message (and/or stack), NOT an empty-object `{}` rendering.
  // BUG-6 is FIXED (T2): Logger.error now serializes Error.stack/message instead
  // of JSON.stringify(error), so this is a bare green regression guard.
  it('records the error message/stack, not an empty {}', async () => {
    // Capture the channel Logger creates during initialize() so we can read its
    // recorded lines. createOutputChannel (per the stub) returns a fresh channel
    // exposing a `lines` array.
    let capturedChannel: any;
    const originalCreate = vscode.window.createOutputChannel;
    (vscode.window as any).createOutputChannel = (name: string) => {
      capturedChannel = (originalCreate as any)(name);
      return capturedChannel;
    };

    try {
      const fakeContext: any = { subscriptions: [] };
      Logger.initialize(fakeContext);

      const error = new Error('boom');
      Logger.error('something failed', error);

      const output = capturedChannel.lines.join('\n');

      // The Error's own message should survive serialization.
      expect(output).to.contain('boom');
      // And it must NOT render as an empty object.
      expect(output).to.not.contain('{}');
    } finally {
      (vscode.window as any).createOutputChannel = originalCreate;
    }
  });
});

describe('Logger (headless-safe)', () => {
  it('logs via console fallback without an OutputChannel and never throws', () => {
    expect(() => Logger.info('hello')).to.not.throw();
    expect(() => Logger.warn('careful')).to.not.throw();
    expect(() => Logger.error('boom', new Error('x'))).to.not.throw();
  });
});
