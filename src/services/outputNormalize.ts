// src/services/outputNormalize.ts
// Pure helpers deciding where simulation outputs belong. TRITON writes to
// project_dir + "/" + output_folder, which (source mode) resolves to build/output;
// we pin results to the canonical <project>/output. Effectful relocation lives in
// ExecutionSetupEditor; this module is path-only so it is unit-testable.
import * as path from 'path';

export interface OutputNormalizationPlan {
  canonicalDir: string;
  sourceDir: string;
  needsRelocation: boolean;
}

export function canonicalOutputDir(project: { path: string }): string {
  return path.join(project.path, 'output');
}

export function resolveOutputNormalization(
  project: { path: string },
  foundDir: string,
): OutputNormalizationPlan {
  const canonicalDir = canonicalOutputDir(project);
  // NOTE: path.resolve does not follow symlinks; the effectful caller
  // (ExecutionSetupEditor._relocateOutputs) guards against a symlinked
  // sourceDir==canonicalDir before any rename.
  const needsRelocation = path.resolve(foundDir) !== path.resolve(canonicalDir);
  return { canonicalDir, sourceDir: foundDir, needsRelocation };
}
