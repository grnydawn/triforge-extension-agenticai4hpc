// src/services/tritonKnowledge.ts
// Pure (no vscode, no MCP SDK): load human-authored TRITON/Triforge knowledge articles from a
// directory of Markdown files and serve them by topic. The Markdown IS the human-verifiable
// source of truth; this module only parses and looks up.
import * as fs from 'fs';
import * as path from 'path';

export interface KnowledgeArticle {
  id: string;
  title: string;
  keywords: string[];
  body: string;
}

/** Parse one article's Markdown (frontmatter + body). Returns null when it lacks a `---`-fenced
 *  frontmatter block with at least an `id`. */
export function parseArticle(md: string): KnowledgeArticle | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!m) return null;
  const head = m[1];
  const body = m[2].trim();
  const field = (key: string): string | undefined => {
    const fm = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm').exec(head);
    return fm ? fm[1].trim() : undefined;
  };
  const id = field('id');
  if (!id) return null;
  const title = field('title') ?? id;
  const keywords = (field('keywords') ?? '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return { id, title, keywords, body };
}

/** Load every `*.md` in `dir` as an article, sorted by id. Malformed files (no frontmatter) are
 *  skipped; a missing directory yields an empty array. */
export function loadKnowledge(dir: string): KnowledgeArticle[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'));
  } catch {
    return [];
  }
  const articles: KnowledgeArticle[] = [];
  for (const name of names) {
    const parsed = parseArticle(fs.readFileSync(path.join(dir, name), 'utf8'));
    if (parsed) articles.push(parsed);
  }
  return articles.sort((a, b) => a.id.localeCompare(b.id));
}

/** Serve knowledge: no topic → an index; a topic → the body of every article whose id/title/
 *  keyword matches it (case-insensitive substring, either direction); no match → index + notice. */
export function lookupKnowledge(articles: KnowledgeArticle[], topic?: string): string {
  if (articles.length === 0) return 'No knowledge articles are available.';
  const index = (): string =>
    ['TRITON/Triforge knowledge topics (call explain_triton with a `topic` to read one):', '',
      ...articles.map((a) => `- ${a.id} — ${a.title}`)].join('\n');
  const q = (topic ?? '').trim().toLowerCase();
  if (!q) return index();
  const hits = articles.filter(
    (a) => a.id.toLowerCase().includes(q) || a.title.toLowerCase().includes(q) ||
      a.keywords.some((k) => k.includes(q) || q.includes(k)),
  );
  if (hits.length === 0) return `No knowledge article matches "${topic}".\n\n${index()}`;
  return hits.map((a) => `# ${a.title} (${a.id})\n\n${a.body}`).join('\n\n---\n\n');
}
