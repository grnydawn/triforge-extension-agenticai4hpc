import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveTriforgeDir, workspaceRootFromPath, planControlRoot, samePath } from '../../../src/services/agentContext/controlRoot';

/**
 * Mirror of AgentContextManager._canonicalize — the guarded realpath the seat
 * decision's CALL SITE applies before invoking planControlRoot. Kept inline (not
 * imported) because the real method lives on a vscode-coupled class; this is the
 * exact guard the fix added (existsSync + try/catch, literal fallback).
 */
function canonicalize(p: string): string {
  try {
    if (fs.existsSync(p)) return fs.realpathSync(p);
  } catch {
    /* fall back to the literal path, matching the production guard */
  }
  return p;
}

describe('resolveTriforgeDir', () => {
  it('appends .triforge to a plain workspace path', () => {
    expect(resolveTriforgeDir('/home/u')).to.equal(path.join('/home/u', '.triforge'));
  });
  it('uses the path as-is when it already ends in .triforge', () => {
    expect(resolveTriforgeDir('/home/u/.triforge')).to.equal('/home/u/.triforge');
  });
  it('keeps a path whose basename is .triforge even with .. noise', () => {
    expect(resolveTriforgeDir('/home/u/x/../.triforge')).to.equal('/home/u/x/../.triforge');
  });
});

describe('workspaceRootFromPath (the project folder — where projects live)', () => {
  it('returns a plain workspace path unchanged (projects are its children)', () => {
    expect(workspaceRootFromPath('/home/u/triforge-projects')).to.equal('/home/u/triforge-projects');
  });
  it('returns the PARENT when the path IS the .triforge control dir', () => {
    // The historical scatter bug: a workspacePath of ~/.triforge resolves the project
    // folder to the parent (home). resolveTriforgeDir is the exact inverse.
    expect(workspaceRootFromPath('/home/u/.triforge')).to.equal('/home/u');
  });
  it('is the inverse of resolveTriforgeDir for a plain folder', () => {
    const folder = '/home/u/triforge-projects';
    // Compare with samePath, not string equality: resolveTriforgeDir runs path.join,
    // which normalizes separators (`/` -> `\` on Windows), so the round-trip returns a
    // native-separator path. samePath normalizes both sides, so the inverse relation
    // holds on every OS.
    expect(samePath(workspaceRootFromPath(resolveTriforgeDir(folder)), folder)).to.equal(true);
  });
});

describe('planControlRoot', () => {
  const triton = '/home/u/.triforge';
  it('seats on an empty window', () => {
    expect(planControlRoot([], triton)).to.equal('seat-empty-window');
  });
  it('is a no-op when the control root is already folder[0]', () => {
    expect(planControlRoot(['/home/u/.triforge', '/home/u/proj'], triton)).to.equal('already-seated');
  });
  it('leaves a non-empty window whose folder[0] is something else', () => {
    expect(planControlRoot(['/home/u/proj'], triton)).to.equal('leave-nonempty');
  });
  it('compares folder[0] path-normalized (trailing-slash / .. noise)', () => {
    expect(planControlRoot(['/home/u/x/../.triforge'], triton)).to.equal('already-seated');
  });
});

describe('planControlRoot with symlinked control root (macOS /var → /private/var)', () => {
  let realDir: string; // the real directory backing the symlink
  let linkDir: string; // a symlink pointing at realDir
  let realTriforge: string; // <realDir>/.triforge  (what VS Code reports as folder[0])
  let linkTriforge: string; // <linkDir>/.triforge  (what the extension derives, unresolved)

  before(() => {
    // Build a real dir + a symlink to it so the two .triforge paths differ ONLY by
    // symlink resolution — exactly the macOS /var → /private/var situation.
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'triforge-ctrlroot-'));
    realDir = fs.realpathSync(base); // collapse any tmpdir symlink so realDir is canonical
    linkDir = path.join(path.dirname(realDir), `${path.basename(realDir)}-link`);
    fs.symlinkSync(realDir, linkDir, 'dir');
    realTriforge = path.join(realDir, '.triforge');
    linkTriforge = path.join(linkDir, '.triforge');
    fs.mkdirSync(realTriforge, { recursive: true });
  });

  after(() => {
    try {
      fs.rmSync(linkDir, { force: true }); // remove the symlink itself
      fs.rmSync(realDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it('reads folder[0] as leave-nonempty WITHOUT call-site canonicalization (the bug)', () => {
    // folder[0] = realpath (what VS Code reports); triforgeDir = unresolved (symlinked).
    // These string-differ, so path.resolve cannot reconcile them → leave-nonempty.
    expect(realTriforge).to.not.equal(linkTriforge);
    expect(planControlRoot([realTriforge], linkTriforge)).to.equal('leave-nonempty');
  });

  it('resolves to already-seated WITH call-site canonicalization (the fix)', () => {
    // The fix canonicalizes BOTH sides at the call site before planControlRoot runs.
    const canonFolders = [canonicalize(realTriforge)];
    const canonTriforge = canonicalize(linkTriforge);
    expect(canonFolders[0]).to.equal(canonTriforge); // symlink now collapsed on both
    expect(planControlRoot(canonFolders, canonTriforge)).to.equal('already-seated');
  });
});

describe('samePath', () => {
  it('folds case when platform is win32 (case-insensitive filesystem)', () => {
    expect(samePath('/Foo/Bar/.triforge', '/foo/bar/.triforge', 'win32')).to.equal(true);
  });
  it('is case-sensitive on non-win32 platforms', () => {
    expect(samePath('/Foo/Bar/.triforge', '/foo/bar/.triforge', 'linux')).to.equal(false);
  });
  it('normalizes .. and trailing separators before comparing', () => {
    expect(samePath('/a/b/../.triforge', '/a/.triforge', 'linux')).to.equal(true);
    expect(samePath('/a/.triforge/', '/a/.triforge', 'linux')).to.equal(true);
  });
});

describe('planControlRoot — platform-aware folder[0] compare', () => {
  it('reads already-seated under win32 ignoring case differences in folder[0]', () => {
    expect(planControlRoot(['/Foo/.triforge'], '/foo/.triforge', 'win32')).to.equal('already-seated');
  });
  it('reads leave-nonempty under linux when folder[0] differs only by case', () => {
    expect(planControlRoot(['/Foo/.triforge'], '/foo/.triforge', 'linux')).to.equal('leave-nonempty');
  });
});
