/**
 * Turning a vault path into something safe to put in an attribute.
 *
 * A published URL is the note's own path with `.md` swapped for `.html`, so
 * whatever the author named the file ends up in an `href`. Obsidian allows
 * names that mean something else entirely in a URL:
 *
 * - `Q&A.md` — `&` starts an HTML entity, so the attribute is malformed.
 * - `Draft #2.md` — `#` starts a fragment, so the link points at the
 *   directory index with an anchor rather than at the page.
 * - `What now?.md` — `?` starts a query string, same outcome.
 * - `50% done.md` — `%` starts an escape, and `% d` is not a valid one.
 * - `My note.md` — a space is not legal in a URL; browsers paper over it,
 *   other clients do not.
 *
 * Only the first two are silent corruption rather than a broken link, which
 * is what makes this worth a module: a `#` in a filename produced a link that
 * looked fine and went nowhere.
 *
 * The published *file* keeps its real name. Encoding happens on the way into
 * an attribute, and the server decodes it back to the name in the commit, so
 * the two agree.
 */

/**
 * Percent-encodes each segment of a relative URL path.
 *
 * Separators and the `.`/`..` segments that relative paths are made of pass
 * through untouched; everything else is encoded. `encodeURIComponent` is the
 * right tool per segment precisely because it encodes `/`, which is why it
 * cannot be applied to the path as a whole.
 */
export function encodeUrlPath(path: string): string {
  return path
    .split("/")
    .map((segment) =>
      segment === "" || segment === "." || segment === ".."
        ? segment
        : encodeURIComponent(segment),
    )
    .join("/");
}

/**
 * Decodes a URL segment, returning it unchanged when it is not valid encoding.
 *
 * `decodeURIComponent` throws `URIError: URI malformed` on a `%` that does not
 * begin a valid escape -- and a note called "50% done" produces exactly that.
 * Thrown from link resolution, it failed the entire publish with a message
 * naming neither the note nor the problem.
 *
 * A name that was never encoded is the common case here, not an error, so the
 * raw value is the right answer rather than a rethrow.
 */
export function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
