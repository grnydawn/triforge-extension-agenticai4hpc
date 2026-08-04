import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Guard for click-to-seat (Task 3) — SOURCE-PROPERTY unit (same rationale as
 * homeSeatedContext.test.ts: the seat/consent flow is vscode-coupled and its
 * runtime effect — updateWorkspaceFolders + a host reload — is not introspectable
 * in the unit harness, so assert the wiring against source text).
 *
 * Clicking the Triforge activity-bar icon reveals the Projects view; that
 * visibility event now runs a consent-gated seat so users rarely need the home
 * button. It must NOT force a surprise reload: it only seats silently on an empty
 * window when AI-focus consent is already 'enabled', and otherwise asks first.
 */
describe('Click-to-seat on activity-bar engagement', () => {
  const repoRoot = process.cwd();
  const read = (rel: string): string =>
    fs.readFileSync(path.join(repoRoot, rel), 'utf8');

  it('extension.ts calls ensureSeatedFromEngagement when the Projects view becomes visible', () => {
    const src = read('src/extension.ts');
    expect(src).to.match(/onDidChangeVisibility/);
    expect(src).to.contain('ensureSeatedFromEngagement');
  });

  it('ensureSeatedFromEngagement is consent-gated and reload-safe', () => {
    const src = read('src/state/AgentContextManager.ts');
    const m = /public async ensureSeatedFromEngagement\([^)]*\)[^{]*\{([\s\S]*?)\n  \}/.exec(src);
    expect(m, 'ensureSeatedFromEngagement method present').to.exist;
    const body = m![1];
    // No-op when already seated (never reloads an already-seated window).
    expect(body, 'returns early on already-seated').to.contain("=== 'already-seated'");
    // Silent seat only on an empty window with consent already enabled.
    expect(body).to.contain("plan === 'seat-empty-window'");
    expect(body).to.contain('_resolveFocusConsent()');
    expect(body).to.contain("consent === 'enabled'");
    // Respects an explicit opt-out.
    expect(body).to.contain("consent === 'disabled'");
    // Otherwise it must ASK before seating (no surprise reload).
    expect(body, 'prompts before the disruptive seat').to.match(
      /showInformationMessage\([\s\S]*'Open Triforge Home'/,
    );
    // Prompt is once-per-session so repeated clicks do not nag.
    expect(body).to.contain('_engagementSeatOffered');
    // At most one seat-offer per session across paths: also suppressed by the startup
    // consent modal and the "catalog not visible" toast (no double prompt / double seat).
    expect(body).to.contain('_consentAskedThisSession');
    expect(body).to.contain('_catalogSignalShown');
  });

  it('the catalog-not-visible signal and the engagement offer mutually suppress', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/state/AgentContextManager.ts'),
      'utf8',
    );
    const sig = /_signalCatalogNotLoaded\(\)\s*:\s*void\s*\{([\s\S]*?)\n  \}/.exec(src);
    expect(sig, '_signalCatalogNotLoaded present').to.exist;
    expect(sig![1], 'signal bails if the engagement offer already fired').to.contain(
      '_engagementSeatOffered',
    );
  });
});
