// src/lm/resolveArgs.ts
// Pure (no vscode): resolve a Language Model Tool invocation's model input plus the
// active-project context into the exact args/ctx the reused pure handler expects.
import * as path from 'path';

/** Snapshot of the editor's project context, gathered by the vscode adapter. */
export interface ProjectContext {
  /** The active TriforgeProject (flat: sim_duration, demPath, …), or undefined. */
  activeProject?: Record<string, unknown>;
  /** activeProject.path (the project folder), or undefined when none is active. */
  projectPath?: string;
  /** Absolute path to the bundled execution template. */
  templatePath: string;
}

export type Resolution =
  | { ok: true; args: Record<string, unknown>; ctx: { cwd: string } }
  | { ok: false; error: string };

const NO_PROJECT =
  'No active Triforge project. Open or activate a project in the Triforge sidebar first.';

export function resolveInvocationArgs(
  toolName: string,
  input: Record<string, unknown>,
  pctx: ProjectContext,
): Resolution {
  // diagnose_project is read-only and path-addressable: it diagnoses ANY TRITON deck by
  // projectDir (foreign / hand-built workflows included), so it does not require an active
  // Triforge project when the caller passes an explicit projectDir. Handle it before the
  // active-project guard; without a projectDir it still falls through to the active-project default.
  if (toolName === 'diagnose_project' && typeof input.projectDir === 'string' && input.projectDir.trim()) {
    const args: Record<string, unknown> = { projectDir: input.projectDir };
    if (typeof input.cfgPath === 'string' && input.cfgPath) args.cfgPath = input.cfgPath;
    if (input.expectations && typeof input.expectations === 'object') args.expectations = input.expectations;
    return { ok: true, args, ctx: { cwd: input.projectDir } };
  }
  // explain_triton is a read-only knowledge lookup — it needs no active project. The bundled
  // knowledge dir sits next to the execution template under resources/.
  if (toolName === 'explain_triton') {
    const args: Record<string, unknown> = {
      knowledgeDir: path.join(path.dirname(pctx.templatePath), 'knowledge'),
    };
    if (typeof input.topic === 'string' && input.topic.trim()) args.topic = input.topic;
    return { ok: true, args, ctx: { cwd: pctx.projectPath ?? path.dirname(pctx.templatePath) } };
  }
  if (!pctx.activeProject || !pctx.projectPath) {
    return { ok: false, error: NO_PROJECT };
  }
  const rawProject = input.project;
  const modelProject =
    rawProject && typeof rawProject === 'object' ? (rawProject as Record<string, unknown>) : {};
  const project = { ...pctx.activeProject, ...modelProject };
  const templatePath = (input.templatePath as string | undefined) ?? pctx.templatePath;
  const ctx = { cwd: pctx.projectPath };

  if (toolName === 'configure_solver') {
    const args: Record<string, unknown> = { project, templatePath };
    if (typeof input.outPath === 'string' && input.outPath) args.outPath = input.outPath;
    return { ok: true, args, ctx };
  }

  if (toolName === 'run_local') {
    const runCommand = input.runCommand;
    if (typeof runCommand !== 'string' || !runCommand.trim()) {
      return { ok: false, error: 'runCommand is required' };
    }
    const runDir = (input.runDir as string | undefined) ?? path.join(pctx.projectPath, 'build');
    return { ok: true, args: { project, runDir, runCommand, templatePath }, ctx };
  }

  if (toolName === 'export_tfp') {
    // projectDir defaults to the active project folder; the archive path is required
    // (there's no sensible implicit destination for a portable bundle).
    const projectDir = (input.projectDir as string | undefined) ?? pctx.projectPath;
    const outPath = input.outPath;
    if (typeof outPath !== 'string' || !outPath.trim()) {
      return { ok: false, error: 'outPath is required' };
    }
    const args: Record<string, unknown> = { projectDir, outPath };
    if (typeof input.includeOutputs === 'boolean') args.includeOutputs = input.includeOutputs;
    return { ok: true, args, ctx };
  }

  if (toolName === 'import_tfp') {
    // Relative archivePath/destRoot resolve against the active project folder (ctx.cwd).
    const archivePath = input.archivePath;
    if (typeof archivePath !== 'string' || !archivePath.trim()) {
      return { ok: false, error: 'archivePath is required' };
    }
    const destRoot = input.destRoot;
    if (typeof destRoot !== 'string' || !destRoot.trim()) {
      return { ok: false, error: 'destRoot is required' };
    }
    return { ok: true, args: { archivePath, destRoot }, ctx };
  }

  if (toolName === 'create_water_source') {
    const locations = input.locations;
    if (!Array.isArray(locations) || locations.length === 0) {
      return { ok: false, error: 'locations (a non-empty array) is required' };
    }
    const hydrographs = Array.isArray(input.hydrographs) ? input.hydrographs : [];
    const projectDir = (input.projectDir as string | undefined) ?? pctx.projectPath;
    return { ok: true, args: { projectDir, locations, hydrographs }, ctx };
  }

  if (toolName === 'generate_dem') {
    const projectDir = (input.projectDir as string | undefined) ?? pctx.projectPath;
    const args: Record<string, unknown> = { projectDir };
    if (typeof input.source === 'string' && input.source) args.source = input.source;
    if (typeof input.outPath === 'string' && input.outPath) args.outPath = input.outPath;
    return { ok: true, args, ctx };
  }

  if (toolName === 'animate_gif') {
    const projectDir = (input.projectDir as string | undefined) ?? pctx.projectPath;
    const args: Record<string, unknown> = { projectDir };
    if (typeof input.variable === 'string' && input.variable) args.variable = input.variable;
    if (typeof input.outputDir === 'string' && input.outputDir) args.outputDir = input.outputDir;
    if (typeof input.colormap === 'string' && input.colormap) args.colormap = input.colormap;
    if (typeof input.fps === 'number') args.fps = input.fps;
    if (typeof input.outPath === 'string' && input.outPath) args.outPath = input.outPath;
    return { ok: true, args, ctx };
  }

  if (toolName === 'diagnose_project') {
    const projectDir = (input.projectDir as string | undefined) ?? pctx.projectPath;
    const args: Record<string, unknown> = { projectDir };
    if (typeof input.cfgPath === 'string' && input.cfgPath) args.cfgPath = input.cfgPath;
    if (input.expectations && typeof input.expectations === 'object') args.expectations = input.expectations;
    return { ok: true, args, ctx };
  }

  return { ok: false, error: `unknown tool: ${toolName}` };
}
