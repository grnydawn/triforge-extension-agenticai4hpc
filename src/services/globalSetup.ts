/**
 * Pure decision for whether activation should auto-open the Global Settings page.
 * No vscode/fs imports so it can be unit-tested directly (see controlRoot.ts).
 */

export interface GlobalSetupCheck {
  workspacePath?: string;
  userName?: string;
  email?: string;
}

/**
 * Decide whether to auto-open the Global Settings page on activation.
 *
 * VS Code keeps an extension's globalStorage folder across uninstall/reinstall —
 * identical behaviour on Windows, macOS, and Linux, only the path differs — so
 * `global_settings.json` (and its saved `workspacePath`) survives a reinstall.
 * Keying the setup prompt purely on an EMPTY `workspacePath` meant a reinstall
 * never re-showed the page. Instead, treat STALE or INCOMPLETE persisted settings
 * as unconfigured:
 *
 *   - `workspacePath` empty          → never configured
 *   - `workspacePath` folder missing → configured location is gone (folder was
 *                                      deleted, or reinstalled on another machine)
 *   - `userName` or `email` blank    → identity setup was never completed
 *
 * A still-valid, complete setup is left alone, so a legitimate reinstall that
 * keeps its project folder is not nagged. Users who want a clean slate run the
 * `Triforge: Reset Settings` command.
 *
 * @param settings        the persisted global settings
 * @param workspaceExists whether `settings.workspacePath` currently exists on
 *                        disk (the caller probes this so the function stays pure)
 */
export function needsGlobalSetup(settings: GlobalSetupCheck, workspaceExists: boolean): boolean {
  if (!settings.workspacePath) {
    return true;
  }
  if (!workspaceExists) {
    return true;
  }
  if (!settings.userName || !settings.email) {
    return true;
  }
  return false;
}
