import * as vscode from 'vscode';
import { ProjectManager } from '../state/ProjectManager';
import {
  matchProjectReferencePrefix,
  projectReference,
  summarizeProject,
} from '../services/agentContext/render';

/**
 * Completes `@<project-folder-name>` tokens in markdown/plaintext editors so a
 * user can drop a project reference into a prompt they are drafting. The list
 * comes from the live project registry; the item documentation reuses the
 * secret-free `summarizeProject()` (never emits apiKeys).
 */
export class ProjectReferenceCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const linePrefix = document.lineAt(position).text.slice(0, position.character);
    const match = matchProjectReferencePrefix(linePrefix);
    if (!match) return [];
    // Replace the already-typed `@partial` so accepting never doubles the `@`.
    const start = position.translate(0, -(match.partial.length + 1));
    const range = new vscode.Range(start, position);

    return ProjectManager.instance.getProjects().map((p) => {
      const ref = projectReference(p);
      const item = new vscode.CompletionItem(`@${ref}`, vscode.CompletionItemKind.Reference);
      item.detail = 'Triforge project';
      item.documentation = summarizeProject(p);
      item.insertText = `@${ref}`;
      item.filterText = `@${ref}`;
      item.range = range;
      return item;
    });
  }
}

/** Register the provider; caller pushes the Disposable into context.subscriptions. */
export function registerProjectReferenceCompletion(disposables: vscode.Disposable[]): void {
  disposables.push(
    vscode.languages.registerCompletionItemProvider(
      [{ language: 'markdown' }, { language: 'plaintext' }],
      new ProjectReferenceCompletionProvider(),
      '@',
    ),
  );
}
