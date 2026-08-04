// src/services/agentContext/controlRoot.ts
// Pure helpers for locating + seating the Triforge control root. Path-only — no
// `vscode`/`fs` — so the seating DECISION is unit-testable without the editor host.
import * as path from 'path';

/**
 * Normalize a configured workspace path to the `.triforge` control dir, mirroring
 * ProjectManager's resolution (ProjectManager.ts:442-444): if the path already
 * ends in `.triforge`, use it; otherwise append `.triforge`.
 */
export function resolveTriforgeDir(workspacePath: string): string {
  return path.basename(workspacePath) === '.triforge'
    ? workspacePath
    : path.join(workspacePath, '.triforge');
}

/**
 * The project folder — the single "project folder" the user configures, holding
 * every project as a direct child and the `.triforge` control dir inside it. It is
 * the inverse of {@link resolveTriforgeDir}: if the configured path already IS the
 * `.triforge` control dir, the project folder is its parent; otherwise the
 * configured path already IS the project folder. Both `getTriforgeWorkspaceRoot`
 * (import destination + delete validation) and ProjectCreator's default project
 * location derive from this, so created + imported projects always land together.
 */
export function workspaceRootFromPath(workspacePath: string): string {
  return path.basename(workspacePath) === '.triforge'
    ? path.dirname(workspacePath)
    : workspacePath;
}

/**
 * Compare two paths for equality, platform-aware. PURE: assumes the caller has
 * already symlink-canonicalized the inputs (this module stays `fs`-free so the
 * decision is unit-testable without the editor host). On Windows the filesystem
 * is case-insensitive, so fold case there; elsewhere compare exactly. The
 * `platform` param defaults to the host but is injectable for tests.
 */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  return platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

export type ControlRootPlan = 'already-seated' | 'seat-empty-window' | 'leave-nonempty';

/**
 * Decide how to seat the control root given the current workspace folder paths.
 * - `seat-empty-window`: no folders — adding the control root makes it folder[0]
 *   (one documented reload). Caller gates this behind consent.
 * - `already-seated`: folder[0] is the control root — nothing to do, no reload.
 * - `leave-nonempty`: folders exist but folder[0] is something else — we do NOT
 *   force a reorder-reload; the catalog is written but not auto-loaded until a
 *   future empty-window session (or `triforge.openHome`) seats it.
 */
export function planControlRoot(
  folderPaths: string[],
  triforgeDir: string,
  platform: NodeJS.Platform = process.platform,
): ControlRootPlan {
  if (folderPaths.length === 0) return 'seat-empty-window';
  if (samePath(folderPaths[0], triforgeDir, platform)) return 'already-seated';
  return 'leave-nonempty';
}
