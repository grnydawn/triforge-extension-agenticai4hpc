import * as fs from 'fs';
import * as path from 'path';

import { expect } from 'chai';

/**
 * STATE-1 / API-1 regression guard (FIXED, T3) — SOURCE-PROPERTY unit.
 *
 * Mirrors the MAP-8/PKG-2 source-property pattern: read the .ts source text and
 * assert the fixed disposal-discipline property directly, because whether a
 * Disposable is actually captured into context.subscriptions is not reliably
 * introspectable from E2E (the registrations happen during activation and the
 * subscriptions array is internal to the extension host).
 *
 * STATE-1: ProjectsView / SimulationsView / PropertiesView called
 * `EventBus.instance.on(...)` and DISCARDED the returned Disposable, so the
 * singleton EventBus kept stale listeners alive past the view's lifetime and
 * fired refresh() on dead providers after re-activation. PropertiesView also
 * subscribed `onDidChangeActiveTextEditor` without capturing it. Fix: each view
 * threads a disposables array (context.subscriptions) into its constructor and
 * passes it to every `EventBus.instance.on(...)`; the editor-switch recompute is
 * dropped.
 *
 * API-1: `extension.ts` discarded the result of
 * `registerWebviewViewProvider('triforge-properties', ...)` and three tree
 * `onDidChange*` Disposables while every other registration was pushed to
 * `context.subscriptions`. Fix: wrap each in `context.subscriptions.push(...)`.
 *
 * This is a BARE GREEN guard (it passes because the code is fixed); it fails if
 * disposal discipline ever regresses.
 */
describe('Disposal discipline (STATE-1 / API-1: captured EventBus + registration Disposables)', () => {
  const SRC = path.resolve(process.cwd(), 'src');

  function read(rel: string): string {
    return fs.readFileSync(path.join(SRC, rel), 'utf8');
  }

  describe('API-1 — extension.ts captures registration + tree event Disposables', () => {
    const src = read('extension.ts');

    it('pushes the registerWebviewViewProvider result into context.subscriptions', () => {
      const captured =
        /context\.subscriptions\.push\(\s*vscode\.window\.registerWebviewViewProvider\(/.test(
          src,
        );
      expect(
        captured,
        "extension.ts must push registerWebviewViewProvider('triforge-properties', ...) into context.subscriptions — API-1",
      ).to.be.true;
    });

    it('does not discard the registerWebviewViewProvider result (no bare statement form)', () => {
      // A bare `vscode.window.registerWebviewViewProvider(...)` not preceded by a
      // push/assignment is the leaked form the fix removes.
      const bareDiscard =
        /(^|\n)\s*vscode\.window\.registerWebviewViewProvider\(/.test(src);
      expect(
        bareDiscard,
        'extension.ts must NOT discard the registerWebviewViewProvider Disposable — API-1',
      ).to.be.false;
    });

    it('captures all three tree onDidChange* Disposables into context.subscriptions', () => {
      // onDidChangeVisibility + onDidChangeSelection (projects) + onDidChangeSelection (simulations)
      const visibilityCaptured =
        /context\.subscriptions\.push\(\s*\w+\.onDidChangeVisibility\(/.test(src);
      const selectionCaptured =
        /context\.subscriptions\.push\(\s*\w+\.onDidChangeSelection\(/.test(src);

      const selectionPushCount = (
        src.match(/context\.subscriptions\.push\(\s*\w+\.onDidChangeSelection\(/g) ||
        []
      ).length;

      expect(
        visibilityCaptured,
        'extension.ts must push the tree onDidChangeVisibility Disposable into context.subscriptions — API-1',
      ).to.be.true;
      expect(
        selectionCaptured,
        'extension.ts must push the tree onDidChangeSelection Disposables into context.subscriptions — API-1',
      ).to.be.true;
      expect(
        selectionPushCount,
        'extension.ts must capture BOTH tree onDidChangeSelection Disposables (projects + simulations) — API-1',
      ).to.be.at.least(2);
    });
  });

  describe('STATE-1 — views capture their EventBus.on(...) subscriptions', () => {
    const views: Array<{ file: string; name: string }> = [
      { file: 'views/ProjectsView.ts', name: 'ProjectsView' },
      { file: 'views/SimulationsView.ts', name: 'SimulationsView' },
      { file: 'views/PropertiesView.ts', name: 'PropertiesView' },
    ];

    for (const { file, name } of views) {
      it(`${name} threads a disposables array into its constructor`, () => {
        const src = read(file);
        const hasDisposablesParam =
          /constructor\([^)]*disposables\??\s*:\s*vscode\.Disposable\[\]/.test(src);
        expect(
          hasDisposablesParam,
          `${name} must accept a disposables: vscode.Disposable[] constructor param — STATE-1`,
        ).to.be.true;
      });

      it(`${name} passes the disposables array to every EventBus.instance.on(...) call`, () => {
        const src = read(file);
        const onCalls = src.match(/EventBus\.instance\.on\(/g) || [];
        expect(
          onCalls.length,
          `${name} should have at least one EventBus.instance.on(...) subscription`,
        ).to.be.at.least(1);

        // Every .on(...) call must thread `disposables` as its trailing argument
        // (the EventBus.on signature is (event, listener, thisArgs?, disposables?)),
        // i.e. each subscription closes with `, disposables)`. There must be exactly
        // one such trailing capture per `.on(` call.
        const captures = src.match(/,\s*disposables\s*\)/g) || [];
        expect(
          captures.length,
          `${name} must pass the disposables array to every EventBus.instance.on(...) — STATE-1`,
        ).to.equal(onCalls.length);
      });
    }

    it('PropertiesView no longer subscribes onDidChangeActiveTextEditor uncaptured', () => {
      const src = read('views/PropertiesView.ts');
      const subscribesEditorSwitch = /onDidChangeActiveTextEditor\(/.test(src);
      expect(
        subscribesEditorSwitch,
        'PropertiesView must drop the un-captured onDidChangeActiveTextEditor recompute — STATE-1',
      ).to.be.false;
    });
  });
});
