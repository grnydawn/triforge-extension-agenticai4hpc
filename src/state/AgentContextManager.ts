// src/state/AgentContextManager.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { EventBus } from './EventBus';
import { ProjectManager, TriforgeProject } from './ProjectManager';
import { Logger } from '../utils/Logger';
import {
  renderAgentsMd,
  renderClaudePointer,
  renderCopilotPointer,
  renderGeminiPointer,
  renderCatalog,
  summarizeProject,
  projectReference,
  shouldWrite,
} from '../services/agentContext/render';
import { resolveTriforgeDir, planControlRoot } from '../services/agentContext/controlRoot';
import { GlobalSettingsManager } from './GlobalSettingsManager';

/**
 * Publishes a project **catalog** so any VS Code agentic AI can resolve `@<name>`
 * project references:
 *  - writes the catalog (the same body into AGENTS.md / CLAUDE.md / GEMINI.md / the
 *    copilot pointer) into the Triforge home dir, plus each project's own
 *    provenance-guarded AGENTS.md, regenerated on `project:listChanged`,
 *  - seats the Triforge home as workspaceFolders[0] (once, consent-gated) so AI tools
 *    auto-read the catalog; `openHome` does this on explicit user request.
 */
export class AgentContextManager {
  private static _instance: AgentContextManager;
  /** True once we've shown the consent modal this session (prevents re-prompting). */
  private _consentAskedThisSession = false;
  /** True once a control-root seat has been issued this session (prevents repeat seats). */
  private _seatPending = false;
  /** True once we've shown the "catalog not visible" notification this session. */
  private _catalogSignalShown = false;
  /** True once the engagement seat-offer (activity-bar reveal) fired this session. */
  private _engagementSeatOffered = false;
  public static get instance(): AgentContextManager {
    if (!this._instance) this._instance = new AgentContextManager();
    return this._instance;
  }
  private constructor() {}

  public initialize(disposables: vscode.Disposable[]): void {
    EventBus.instance.on('project:listChanged', () => this._syncCatalog(), this, disposables);
    disposables.push(vscode.commands.registerCommand('triforge.openHome', () => this.openHome()));
    // Keep `triforge:homeSeated` current so the "Open Triforge Home" title button hides
    // once the home is folder[0] (clicking would be a no-op) and reappears if the
    // user removes/reorders folders so it is no longer seated.
    disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this._refreshHomeSeatedContext()),
    );
    // Write the catalog once at startup (projects are already loaded by ProjectManager).
    this._syncCatalog();
    this._refreshHomeSeatedContext();
  }

  /**
   * Publish `triforge:homeSeated`: true when the Triforge home is already
   * workspaceFolders[0], so the "Open Triforge Home" title button (gated
   * `!triforge:homeSeated`) only shows when clicking it would actually seat the home.
   * False when no workspace path is configured yet, so the button stays available as
   * the entry point that prompts the user to set one.
   */
  private _refreshHomeSeatedContext(): void {
    const triforgeDir = this._resolveHomeDir();
    let seated = false;
    if (triforgeDir) {
      const folders = vscode.workspace.workspaceFolders ?? [];
      const canonFolders = folders.map((f) => this._canonicalize(f.uri.fsPath));
      seated = planControlRoot(canonFolders, this._canonicalize(triforgeDir)) === 'already-seated';
    }
    void vscode.commands.executeCommand('setContext', 'triforge:homeSeated', seated);
  }

  /**
   * Called when the user engages Triforge (the Projects view becomes visible, e.g.
   * they click the activity-bar icon). Seat the home so `@project` references
   * resolve — consent-gated, so we never reload the window by surprise:
   *  - already seated, or no workspace path configured → no-op;
   *  - empty window + AI-focus consent 'enabled' → seat silently (same as startup);
   *  - AI focus 'disabled' → no-op (respect the opt-out);
   *  - otherwise → one actionable prompt per session; on confirm, enable consent
   *    (empty-window case) and seat (the single documented reload).
   * At most ONE seat-offer surfaces per session across all paths: it is suppressed if
   * the startup consent modal already asked (`_consentAskedThisSession`) or the startup
   * "catalog not visible" toast already offered (`_catalogSignalShown`) — those already
   * carry an "Open Triforge Home" action, and stacking a second toast/seat would be a
   * double prompt (and could double-seat). So this mainly helps a user who opened a
   * non-empty window with no prior offer this session: clicking the icon offers the
   * seat instead of making them hunt for the home button.
   */
  public async ensureSeatedFromEngagement(): Promise<void> {
    const triforgeDir = this._resolveHomeDir();
    if (!triforgeDir) return;
    const folders = vscode.workspace.workspaceFolders ?? [];
    const canonFolders = folders.map((f) => this._canonicalize(f.uri.fsPath));
    const plan = planControlRoot(canonFolders, this._canonicalize(triforgeDir));
    if (plan === 'already-seated') return;

    const consent = this._resolveFocusConsent();
    // Empty window with consent already granted: seat silently, no prompt.
    if (plan === 'seat-empty-window' && consent === 'enabled') {
      this._seatControlRoot(triforgeDir);
      return;
    }
    // Respect an explicit opt-out; the home button stays for a manual seat.
    if (consent === 'disabled') return;

    // Otherwise seating causes a (possibly disruptive) reload — ask once per session,
    // and only if no other seat-offer already surfaced this session (the startup modal
    // set _consentAskedThisSession, or _signalCatalogNotLoaded's toast set
    // _catalogSignalShown). This keeps exactly one offer on screen and closes the
    // double-seat race where two "Open Triforge Home" actions each call _seatControlRoot.
    if (this._consentAskedThisSession || this._engagementSeatOffered || this._catalogSignalShown) {
      return;
    }
    this._engagementSeatOffered = true;
    const detail =
      plan === 'leave-nonempty'
        ? 'Add the Triforge home as the first workspace folder so AI tools see your ' +
          'project catalog and @project references resolve? VS Code will reload once.'
        : 'Enable AI project access? VS Code will reload once so AI tools (Claude Code, ' +
          'Codex, Copilot, Gemini) can see your Triforge project catalog.';
    const choice = await vscode.window.showInformationMessage(detail, 'Open Triforge Home', 'Not now');
    if (choice !== 'Open Triforge Home') return;
    if (plan === 'seat-empty-window') {
      GlobalSettingsManager.instance.updateSettings({ aiProjectFocus: 'enabled' });
    }
    this._seatPending = false; // explicit user action → force exactly one seat now
    this._seatControlRoot(triforgeDir);
  }

  /** Render + write AGENTS.md and the two pointer files, each isolated + guarded. */
  public writeContextFiles(project: TriforgeProject): void {
    const root = project.path;
    if (!root || !fs.existsSync(root)) return;
    const githubDir = path.join(root, '.github');
    this._tryWrite(path.join(root, 'AGENTS.md'), renderAgentsMd(project));
    this._tryWrite(path.join(root, 'CLAUDE.md'), renderClaudePointer());
    this._tryWrite(path.join(root, 'GEMINI.md'), renderGeminiPointer());
    this._tryWrite(path.join(githubDir, 'copilot-instructions.md'), renderCopilotPointer(), githubDir);
  }

  /** Resolve the Triforge home (`.triforge`) dir from the persisted workspace path. */
  private _resolveHomeDir(): string | undefined {
    const workspacePath = GlobalSettingsManager.instance.getSettings().workspacePath;
    if (!workspacePath) return undefined;
    return resolveTriforgeDir(workspacePath);
  }

  /**
   * Regenerate the catalog and seat the Triforge home. `project:listChanged` /
   * startup entry point: write the catalog, then consent-gated auto-seat.
   */
  private _syncCatalog(): void {
    const triforgeDir = this._resolveHomeDir();
    if (!triforgeDir) return;
    this._writeCatalog(triforgeDir);
    this._ensureControlRootSeated(triforgeDir);
  }

  /**
   * Write the catalog body (the SAME content into AGENTS.md, CLAUDE.md, GEMINI.md,
   * and .github/copilot-instructions.md in the Triforge home so each tool's
   * auto-loaded file carries the whole catalog) plus each project's own manifest.
   * No seating.
   */
  private _writeCatalog(triforgeDir: string): void {
    if (!fs.existsSync(triforgeDir)) fs.mkdirSync(triforgeDir, { recursive: true });
    const projects = ProjectManager.instance.getProjects();
    const entries = projects.map((p) => ({
      reference: projectReference(p),
      name: p.name,
      path: p.path,
      summary: summarizeProject(p),
    }));
    const body = renderCatalog(entries);
    const githubDir = path.join(triforgeDir, '.github');
    this._tryWrite(path.join(triforgeDir, 'AGENTS.md'), body);
    this._tryWrite(path.join(triforgeDir, 'CLAUDE.md'), body);
    this._tryWrite(path.join(triforgeDir, 'GEMINI.md'), body);
    this._tryWrite(path.join(githubDir, 'copilot-instructions.md'), body, githubDir);
    for (const p of projects) this.writeContextFiles(p);
  }

  /**
   * Explicit user action (`triforge.openHome`): write the catalog, then seat the
   * Triforge home as workspaceFolders[0] with exactly ONE updateWorkspaceFolders —
   * even in a non-empty window, where automatic seating is intentionally skipped.
   * Bypasses the consent gate (invoking the command IS the consent). Does NOT go
   * through `_syncCatalog`/`_ensureControlRootSeated`, so it can never double-seat.
   */
  public openHome(): void {
    const triforgeDir = this._resolveHomeDir();
    if (!triforgeDir) {
      void vscode.window.showWarningMessage(
        'Set a Triforge workspace path in Triforge Global Settings first.',
      );
      return;
    }
    this._writeCatalog(triforgeDir);
    const folders = vscode.workspace.workspaceFolders ?? [];
    const canonFolders = folders.map((f) => this._canonicalize(f.uri.fsPath));
    if (planControlRoot(canonFolders, this._canonicalize(triforgeDir)) === 'already-seated') {
      void vscode.window.showInformationMessage('Triforge home is already open in this window.');
      return;
    }
    this._seatPending = false; // explicit user action → force exactly one seat now
    this._seatControlRoot(triforgeDir); // single updateWorkspaceFolders → one reload
  }

  /**
   * Seat the control root as workspaceFolders[0] so AI tools (which key off
   * folder[0]) treat it as the working directory. Only acts on an empty window
   * (adding the first folder makes it folder[0]); a non-empty window is left
   * alone to avoid a reorder reload. Gated by prompt-once consent.
   */
  private _ensureControlRootSeated(triforgeDir: string): void {
    const folders = vscode.workspace.workspaceFolders ?? [];
    // Canonicalize at the CALL SITE so planControlRoot stays path-only/pure. VS Code
    // reports folder fsPaths as realpaths (e.g. macOS /private/var/...), while triforgeDir
    // is derived from the unresolved configured path (/var/...).
    const canonFolders = folders.map((f) => this._canonicalize(f.uri.fsPath));
    const plan = planControlRoot(canonFolders, this._canonicalize(triforgeDir));
    if (plan === 'already-seated') return;
    if (plan === 'leave-nonempty') {
      this._signalCatalogNotLoaded(); // written but not auto-loaded; offer to seat
      return;
    }
    // seat-empty-window:
    const consent = this._resolveFocusConsent();
    if (consent === 'disabled') {
      this._signalCatalogNotLoaded();
      return;
    }
    if (consent === 'enabled') {
      this._seatControlRoot(triforgeDir);
      return;
    }
    // 'prompt': ask at most once per session.
    if (this._consentAskedThisSession) return;
    this._consentAskedThisSession = true; // set BEFORE awaiting so concurrent events skip
    void this._promptAndSeat(triforgeDir);
  }

  /**
   * When the catalog was written but the Triforge home is NOT seated (so no AI tool
   * auto-loads it) and projects exist, tell the user once — with a button to seat
   * the home. Non-modal so it never blocks the workbench (incl. E2E).
   */
  private _signalCatalogNotLoaded(): void {
    if (this._catalogSignalShown || this._engagementSeatOffered) return;
    if (ProjectManager.instance.getProjects().length === 0) return;
    this._catalogSignalShown = true;
    void vscode.window
      .showInformationMessage(
        "Triforge's project catalog isn't visible to AI tools in this window. " +
          'Open the Triforge home so @project references resolve.',
        'Open Triforge Home',
      )
      .then((choice) => {
        if (choice === 'Open Triforge Home') void vscode.commands.executeCommand('triforge.openHome');
      });
  }

  private _resolveFocusConsent(): 'prompt' | 'enabled' | 'disabled' {
    const v = GlobalSettingsManager.instance.getSettings().aiProjectFocus;
    return v === 'enabled' || v === 'disabled' ? v : 'prompt';
  }

  private async _promptAndSeat(triforgeDir: string): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      'Enable AI project access? VS Code will reload once so AI tools (Claude Code, ' +
        'Codex, Copilot, Gemini) can see your Triforge project catalog and resolve @project ' +
        'references. Switching projects afterward needs no reload.',
      { modal: true },
      'Enable',
      'Not now',
    );
    if (choice === 'Enable') {
      GlobalSettingsManager.instance.updateSettings({ aiProjectFocus: 'enabled' });
      this._seatControlRoot(triforgeDir); // triggers the one documented reload
      return;
    }
    // 'Not now' / dismissed: leave consent at 'prompt' (re-offer next session) and
    // tell the user the catalog isn't visible, with a button to seat it now.
    this._signalCatalogNotLoaded();
  }

  /**
   * Add the control root as the first workspace folder. On an empty window this
   * becomes workspaceFolders[0] and VS Code reloads the host once (documented
   * behavior of updateWorkspaceFolders). The catalog files are written before
   * this call, so they exist immediately after the reload. Code after this call
   * may not run (the host restarts), so callers must not depend on it.
   */
  private _seatControlRoot(triforgeDir: string): void {
    if (this._seatPending) return; // seat already issued this session
    this._seatPending = true;
    const ok = vscode.workspace.updateWorkspaceFolders(0, 0, {
      uri: vscode.Uri.file(triforgeDir),
      name: 'Triforge',
    });
    if (ok === false) {
      this._seatPending = false; // seat rejected — allow a later retry
      Logger.warn('[AgentContext] updateWorkspaceFolders rejected the control-root seat');
    }
  }

  /**
   * Resolve a path to its real (symlink-collapsed) form for comparison. Guarded
   * exactly like the existing precedent (animation.ts:117-126,
   * ExecutionSetupEditor.ts:613-627): only realpath when the path exists, and fall
   * back to the literal path on any throw. Never an unguarded `realpathSync`.
   * VS Code reports workspace folder fsPaths as realpaths while configured paths
   * stay unresolved, so call sites canonicalize both sides before comparing.
   */
  private _canonicalize(p: string): string {
    try {
      if (fs.existsSync(p)) return fs.realpathSync(p);
    } catch (err) {
      Logger.warn(`[AgentContext] realpath failed for ${p}, using literal path: ${err}`);
    }
    return p;
  }

  /** Write one context file, isolating its failure so the others still get written. */
  private _tryWrite(filePath: string, contents: string, ensureDir?: string): void {
    try {
      this._writeGuarded(filePath, contents, ensureDir);
    } catch (err) {
      Logger.warn(`[AgentContext] Failed writing ${filePath}: ${err}`);
    }
  }

  private _writeGuarded(filePath: string, contents: string, ensureDir?: string): void {
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined;
    if (!shouldWrite(existing)) {
      Logger.info(`[AgentContext] Skipping ${filePath} — user-authored file (no Triforge marker).`);
      return;
    }
    if (existing === contents) return;
    if (ensureDir && !fs.existsSync(ensureDir)) fs.mkdirSync(ensureDir, { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, contents);
    try {
      fs.renameSync(tmp, filePath); // atomic on same FS (BUG-10 pattern)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // Windows: rename over a destination held open (AI tool reading the file, or
      // antivirus scanning the .tmp) throws EPERM/EACCES/EEXIST. Fall back to an
      // in-place write (non-atomic — fine for these small text files) rather than
      // silently dropping the update and leaving a stale catalog.
      if (code === 'EPERM' || code === 'EACCES' || code === 'EEXIST') {
        try {
          fs.writeFileSync(filePath, contents);
        } finally {
          try {
            fs.rmSync(tmp, { force: true });
          } catch {
            /* best-effort temp cleanup */
          }
        }
        return;
      }
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* best-effort temp cleanup */
      }
      throw err;
    }
  }
}
