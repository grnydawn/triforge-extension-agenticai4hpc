// src/lm/registerLmTools.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { configureSolverTool } from '../mcp/tools/configureSolver';
import { runLocalTool } from '../mcp/tools/runLocal';
import { exportTfpTool } from '../mcp/tools/exportTfp';
import { importTfpTool } from '../mcp/tools/importTfp';
import { createWaterSourceTool } from '../mcp/tools/createWaterSource';
import { generateDemTool } from '../mcp/tools/generateDem';
import { animateGifTool } from '../mcp/tools/animateGif';
import { diagnoseProjectTool } from '../mcp/tools/diagnoseProject';
import { explainTritonTool } from '../mcp/tools/explainTriton';
import { ProjectManager } from '../state/ProjectManager';
import { ProjectContext } from './resolveArgs';
import { makeLmTool } from './toolAdapter';

/** Register Triforge's in-editor Language Model Tools (Copilot agent mode). */
export function registerLmTools(context: vscode.ExtensionContext): void {
  // Guard: the Tools API exists on VS Code 1.95+ (our engines floor). Be defensive
  // in case the dev host is older, so activation never throws.
  if (!vscode.lm || typeof vscode.lm.registerTool !== 'function') return;

  const templatePath = path.join(context.extensionUri.fsPath, 'resources', 'triton_execution.cfg.template');
  const getProjectContext = (): ProjectContext => {
    const active = ProjectManager.instance.activeProject;
    return {
      activeProject: active as unknown as Record<string, unknown> | undefined,
      projectPath: active?.path,
      templatePath,
    };
  };
  const deps = { getProjectContext };

  context.subscriptions.push(
    vscode.lm.registerTool('triforge_configure_solver', makeLmTool(configureSolverTool, deps)),
    vscode.lm.registerTool('triforge_run_local', makeLmTool(runLocalTool, deps)),
    vscode.lm.registerTool('triforge_export_tfp', makeLmTool(exportTfpTool, deps)),
    vscode.lm.registerTool('triforge_import_tfp', makeLmTool(importTfpTool, deps)),
    vscode.lm.registerTool('triforge_create_water_source', makeLmTool(createWaterSourceTool, deps)),
    vscode.lm.registerTool('triforge_generate_dem', makeLmTool(generateDemTool, deps)),
    vscode.lm.registerTool('triforge_animate_gif', makeLmTool(animateGifTool, deps)),
    vscode.lm.registerTool('triforge_diagnose_project', makeLmTool(diagnoseProjectTool, deps)),
    vscode.lm.registerTool('triforge_explain_triton', makeLmTool(explainTritonTool, deps)),
  );
}
