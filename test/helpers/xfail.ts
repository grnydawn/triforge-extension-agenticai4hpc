/**
 * Wrap an assertion body that currently FAILS because of a known, unfixed bug.
 * - While the bug exists: body throws -> we swallow it -> test PASSES (xfail).
 * - When the fix lands: body no longer throws -> we THROW -> test FAILS loudly,
 *   signalling "remove the xfail wrapper and let the real assertion guard the fix".
 * `finding` is the CODE_REVIEW id (e.g. 'BUG-2'); it appears in output + test/XFAIL.md.
 */
export async function xfail(finding: string, body: () => unknown | Promise<unknown>): Promise<void> {
  let threw = false;
  try {
    await body();
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error(
      `xfail[${finding}] UNEXPECTEDLY PASSED — the bug appears fixed. ` +
      `Remove the xfail() wrapper so the real assertion guards it, and delete ${finding} from test/XFAIL.md.`,
    );
  }
}
