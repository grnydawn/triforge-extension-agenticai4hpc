// test/helpers/bannedTokens.ts
//
// Shared banned-token pattern for the genericity guards. These guards assert that no
// deployment-specific token from the real operational site leaks into shipped source,
// evaluation fixtures, or the knowledge base.
//
// The token list is stored base64-encoded so this repository — which is public — carries
// no plaintext copy of the site's name or its pipeline-internal identifiers. This is
// deliberate obfuscation, NOT secrecy: anyone running the tests can trivially decode it.
// The point is to keep the tokens out of grep, GitHub code search, and search-engine
// indexes, which is the realistic exposure.
//
// Do not inline the decoded value anywhere, and do not add a new plaintext token here —
// extend the encoded string instead.

const SITE_TOKENS_B64 = 'b3NhbnxvdGFifGx1c3RyZXx0eXBob29ufExJU19VbmlxdWVJZHxUUklUT05fUnVu';

/** The site-specific alternation, decoded at run time. Never log this. */
export function siteTokens(): string {
  return Buffer.from(SITE_TOKENS_B64, 'base64').toString('utf8');
}

/**
 * Case-insensitive pattern matching any site-specific token.
 *
 * The site tokens are word-bounded (`\b…\b`). Two of them are short enough to sit inside
 * ordinary English — one is a substring of "Notably" — so an unanchored match flags clean
 * prose as a leak. `scripts/eval/build-artifact-bundle.sh` anchors for the same reason;
 * keep the two in agreement, since that script gates the immutable Zenodo deposit.
 *
 * @param extra Additional alternatives to append, e.g. `'|session_|scratch'`. Pass generic
 *              (non-identifying) patterns in plaintext here; they need no obfuscation.
 *              Must begin with `|`. These are appended OUTSIDE the word boundaries and keep
 *              their unanchored meaning on purpose: callers pass affix patterns such as
 *              `session_` and `\/home\/`, which `\b` would silently neuter (`_` is a word
 *              character, `/` is not).
 */
export function bannedSitePattern(extra = ''): RegExp {
  return new RegExp('\\b(?:' + siteTokens() + ')\\b' + extra, 'i');
}
