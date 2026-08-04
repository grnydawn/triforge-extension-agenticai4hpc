/**
 * HTML/JS escaping helpers for webview rendering (SEC-3).
 *
 * Webview HTML is built by string interpolation, so any user-controlled or
 * file-derived string (project names, on-disk file names, persisted settings)
 * must be neutralised before it is placed into markup, an attribute, or an
 * inline `<script>` payload. These helpers centralise that escaping.
 */

/**
 * Escape a string for safe interpolation into HTML text or a (quoted)
 * attribute value. Renders the input as inert literal text instead of live
 * markup.
 */
export function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Serialise a value to JSON for embedding inside an inline `<script>` block.
 * Escapes `<` / `>` (which also defuses any `</script>` sequence) so the
 * payload cannot break out of the script element and is parsed as an inert
 * JSON string literal.
 *
 * Generalises the inline pattern previously duplicated in
 * ComputationSetupHtml / ExecutionSetupHtml.
 */
export function safeJsonForScript(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}
