/**
 * Universal Google Sheets Formula Injection Sanitizer (Blocker B13)
 *
 * Prepends a single apostrophe (') to any string cell beginning with formula triggers:
 * '=', '+', '-', or '@' (after trimming leading whitespace).
 *
 * This ensures that Google Sheets strictly interprets the value as raw plain text,
 * preventing formula injection and arbitrary command execution.
 *
 * @param {any} val - Cell value to sanitize
 * @returns {any} Sanitized value
 */
export function sanitizeForGoogleSheets(val) {
  if (val === null || val === undefined) return "";
  if (typeof val === "number" || typeof val === "boolean") return val;

  const str = String(val);
  const trimmed = str.trimStart();
  if (
    trimmed.startsWith("=") ||
    trimmed.startsWith("+") ||
    trimmed.startsWith("-") ||
    trimmed.startsWith("@")
  ) {
    return `'${str}`;
  }
  return str;
}
