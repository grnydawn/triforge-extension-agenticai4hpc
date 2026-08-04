// Minimal stub of the VS Code API for unit tests that import vscode-touching modules.
// Extend as unit tests need more surface.
class EventEmitter {
  constructor() { this.event = () => ({ dispose() {} }); }
  fire() {}
  dispose() {}
}
// Recording output channel: appendLine/append push into an in-memory `lines`
// array so unit tests can assert what was written. Each createOutputChannel
// call returns a fresh channel with its own buffer.
function createRecordingChannel(name) {
  const lines = [];
  return {
    name: name || 'stub',
    lines,
    appendLine(value) { lines.push(String(value)); },
    append(value) { lines.push(String(value)); },
    show() {},
    clear() { lines.length = 0; },
    dispose() {},
  };
}
// In-memory Memento backing globalState/workspaceState (vscode.ExtensionContext).
// Mirrors the vscode Memento contract: get(key[, default]) + async update(key, value).
function createMemento() {
  const store = new Map();
  return {
    get(key, defaultValue) {
      return store.has(key) ? store.get(key) : defaultValue;
    },
    update(key, value) {
      if (value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
      return Promise.resolve();
    },
    keys() {
      return Array.from(store.keys());
    },
  };
}
module.exports = {
  window: {
    createOutputChannel: (name) => createRecordingChannel(name),
    showErrorMessage: () => Promise.resolve(undefined),
    showWarningMessage: () => Promise.resolve(undefined),
    showInformationMessage: () => Promise.resolve(undefined),
  },
  workspace: {
    getConfiguration: () => ({ get: () => undefined, update: () => Promise.resolve() }),
    workspaceFolders: undefined,
  },
  commands: { executeCommand: () => Promise.resolve(), registerCommand: () => ({ dispose() {} }) },
  Uri: { file: (p) => ({ fsPath: p, path: p, scheme: 'file' }), joinPath: (base, ...segs) => ({ fsPath: [base.fsPath, ...segs].join('/') }) },
  EventEmitter,
  Disposable: { from: (...items) => ({ dispose: () => items.forEach((i) => i && i.dispose && i.dispose()) }) },
  // Minimal TreeItem: stores label + collapsibleState (the two constructor args
  // VS Code's TreeItem takes) so unit tests can observe what getTreeItem() builds.
  // `id` is intentionally left unset (undefined) — exactly as real VS Code does
  // until a node assigns one — so the VIEW-3 guard can observe its absence.
  TreeItem: class {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  ThemeIcon: (() => {
    class ThemeIcon {
      constructor(id) { this.id = id; }
    }
    ThemeIcon.File = new ThemeIcon('file');
    ThemeIcon.Folder = new ThemeIcon('folder');
    return ThemeIcon;
  })(),
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  // Factory so tests can construct a fresh ExtensionContext-like object with
  // independent in-memory globalState/workspaceState Mementos.
  createMemento,
};
