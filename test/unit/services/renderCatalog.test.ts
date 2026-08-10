import { expect } from 'chai';
import {
  TRIFORGE_CONTEXT_MARKER,
  renderCatalog,
  cell,
  summarizeProject,
  CatalogEntry,
} from '../../../src/services/agentContext/render';
import type { TriforgeProject } from '../../../src/state/ProjectManager';

const entry = (o: Partial<CatalogEntry> = {}): CatalogEntry => ({
  reference: 'Alpha',
  name: 'Alpha',
  path: '/projects/Alpha',
  summary: 'Flood-inundation sim',
  ...o,
});

describe('cell (markdown table-cell escaper)', () => {
  it('escapes the pipe delimiter so a value cannot start a new cell', () => {
    expect(cell('a|b')).to.equal('a\\|b');
  });
  it('collapses newlines/CR to a single space so a value cannot span rows', () => {
    expect(cell('a\nb\r\nc')).to.equal('a b c');
  });
  it('swaps backticks for apostrophes so a value cannot break a code span', () => {
    expect(cell('a`b')).to.equal("a'b");
  });
  it('renders empty/nullish as (not set)', () => {
    expect(cell('')).to.equal('(not set)');
    expect(cell(undefined)).to.equal('(not set)');
  });
  it('renders whitespace-only as (not set)', () => { expect(cell('   ')).to.equal('(not set)'); });
});

describe('renderCatalog', () => {
  it('carries the marker and teaches the @-convention incl. the no-match rule', () => {
    const md = renderCatalog([entry()]);
    expect(md).to.include(TRIFORGE_CONTEXT_MARKER);
    expect(md).to.include('@<name>');
    expect(md).to.include('projects.json');
    expect(md.toLowerCase()).to.include('matches no row'); // the no-guess branch
  });
  it('lists one row per entry with @reference, name, path and summary', () => {
    const md = renderCatalog([
      entry({ reference: 'Alpha', name: 'Alpha', path: '/projects/Alpha' }),
      entry({ reference: 'Bravo', name: 'Bravo', path: '/projects/Bravo' }),
    ]);
    expect(md).to.include('`@Alpha`');
    expect(md).to.include('/projects/Alpha');
    expect(md).to.include('`@Bravo`');
    expect(md).to.include('/projects/Bravo');
  });
  it('renders an empty-state when there are no projects', () => {
    const md = renderCatalog([]);
    expect(md).to.include(TRIFORGE_CONTEXT_MARKER);
    expect(md.toLowerCase()).to.include('no triforge projects');
  });
  it('escapes pipe/newline/backtick in any field so the table stays one row per entry', () => {
    const md = renderCatalog([entry({ reference: 'a|b', name: 'x\ny', path: '/p/z`q' })]);
    const rows = md.split('\n').filter((l) => l.startsWith('| `@'));
    expect(rows).to.have.length(1); // the newline did NOT create a second row
    expect(md).to.include('a\\|b');
    expect(md).to.not.include('x\ny');
  });
});

describe('summarizeProject', () => {
  const base = (o: Partial<TriforgeProject> = {}): TriforgeProject =>
    ({ id: 'i', name: 'n', path: '/p/n', createdAt: 0, lastModified: 0, ...o }) as TriforgeProject;
  it('is a short one-liner and NEVER leaks apiKeys', () => {
    const s = summarizeProject(
      base({
        demPath: '/x/haw.tif',
        simulationStart: '2020-01-01',
        outputs: { output_directory: '/p/n/output' },
        apiKeys: { openTopography: 'SECRET-KEY' },
      }),
    );
    expect(s).to.include('Flood-inundation sim');
    expect(s).to.include('haw.tif');
    expect(s).to.include('output');
    expect(s).to.not.include('SECRET-KEY');
  });
  it('handles a sparse project without throwing', () => {
    expect(() => summarizeProject(base())).to.not.throw();
    expect(summarizeProject(base())).to.include('Flood-inundation sim');
  });
  it('handles a trailing slash in output_directory', () => {
    expect(summarizeProject(base({ outputs: { output_directory: '/p/n/output/' } }))).to.include('output');
  });
});
