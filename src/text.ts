/**
 * Turning an unknown value into text without lying about it.
 *
 * `String(value)` on an object produces `"[object Object]"`, which then
 * travels as if it were data. Every use of it here was reading a field out of
 * something parsed from JSON -- a saved review, a tracker's error response,
 * frontmatter -- where a field that should hold a string can hold anything,
 * because a file on disk is not a type. The plugin review found seven of
 * them, including one that would have written `"[object ArrayBuffer]"` into a
 * locked page in place of its HTML.
 *
 * So the rule is that a non-scalar has no text, and the caller decides what
 * to do about that. An empty string is a value a caller can test; a string
 * saying `[object Object]` is one it cannot.
 */

/** The value as text when it is a scalar, and `""` for anything else. */
export function scalarText(value: unknown): string {
  switch (typeof value) {
    case "string":
      return value;
    case "number":
    case "bigint":
    case "boolean":
      return String(value);
    default:
      return "";
  }
}

/**
 * Text for a value being reported to a person, including its type when it has
 * no text of its own. For a message like "it was written by version X", where
 * `{}` is worth saying out loud rather than printing as nothing.
 */
export function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return scalarText(value) || typeof value;
}
