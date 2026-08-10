// Pure parser for a TRITON execution .cfg deck. No vscode / no fs — string in,
// structured accessor out, so it is trivially unit-testable and host-free.

export interface ParsedCfg {
  /** Active (uncommented) value for a key, or undefined. Quotes already stripped. */
  get(key: string): string | undefined;
  /** Active value coerced to a finite number, or undefined. */
  getNumber(key: string): number | undefined;
  /** True when the key has an active (uncommented) assignment. */
  isActive(key: string): boolean;
  /** All active keys. */
  keys: string[];
  /** All active key/value pairs (for scanning values). */
  activeEntries(): { key: string; value: string }[];
  /** The original text. */
  raw: string;
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function stripQuotes(v: string): string {
  const m = /^"(.*)"$/.exec(v);
  return m ? m[1] : v;
}

/** Drop a trailing `# comment`. A quoted value keeps everything through its closing quote. */
function stripComment(v: string): string {
  if (v.startsWith('"')) {
    const close = v.indexOf('"', 1);
    return close >= 0 ? v.slice(0, close + 1) : v;
  }
  const hash = v.indexOf('#');
  return (hash >= 0 ? v.slice(0, hash) : v).trim();
}

export function parseTritonCfg(text: string): ParsedCfg {
  const active = new Map<string, string>();
  const commented = new Set<string>();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('#')) {
      // Record a commented-out `# key=value` so callers can skip it deliberately.
      const body = trimmed.replace(/^#+\s*/, '');
      const eq = body.indexOf('=');
      if (eq > 0) {
        const k = body.slice(0, eq).trim();
        if (KEY_RE.test(k)) commented.add(k);
      }
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!KEY_RE.test(key)) continue;
    active.set(key, stripQuotes(stripComment(trimmed.slice(eq + 1).trim())));
  }

  return {
    raw: text,
    keys: [...active.keys()],
    get: (key) => active.get(key),
    getNumber: (key) => {
      const v = active.get(key);
      if (v === undefined) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    },
    isActive: (key) => active.has(key),
    activeEntries: () => [...active.entries()].map(([key, value]) => ({ key, value })),
  };
}
