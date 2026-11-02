/**
 * Which note a published page came from, kept in the vault.
 *
 * The overlay keys a published page's comments on the page's own URL, never
 * on the vault path of the note behind it -- a published page carrying
 * `Clients/Acme/Q3 Plan.md` would hand the vault's folder names to every
 * reader of the site. See `overlayKey` in `buildSite.ts`.
 *
 * That leaves a gap at the other end. A review exported from a published
 * page names pages, so an import would write a note linking to
 * `notes/plan.html` rather than to the writing it is about -- and linking
 * back to the writing is the whole point of importing.
 *
 * So the mapping is written down where it is safe to write it down: here,
 * in the vault, beside the review file. A publish records what it published
 * and the import reads it back. Nothing in this file is ever served -- it
 * lives in the review folder, which holds the reviewer's own working files
 * and is not part of the site.
 *
 * It is a record of one publish, replaced by the next, because that is what
 * it has to be: a stale entry would link a comment to a note that no longer
 * produces that page, which is a worse answer than no link at all.
 */

/** Current shape. Bumped only on a change a reader must know about. */
export const PAGE_MAP_VERSION = 1;

export interface PageMap {
  version: number;
  /** ISO 8601, so a reader can tell how old the mapping is. */
  publishedAt: string;
  /** Published URL to the vault path of the note that produced it. */
  pages: Record<string, string>;
}

/** The file this is written to, inside the review folder. */
export const PAGE_MAP_FILE = "published-pages.json";

export function buildPageMap(
  pages: Array<{ url: string; sourcePath: string }>,
  now: Date,
): PageMap {
  const map: Record<string, string> = {};
  for (const page of pages) {
    // A page with no note behind it -- a generated index, a copied HTML
    // file -- has nothing to map to, and an empty value would resolve a
    // comment onto a link to nowhere.
    if (page.url && page.sourcePath) map[page.url] = page.sourcePath;
  }
  return {
    version: PAGE_MAP_VERSION,
    publishedAt: now.toISOString(),
    pages: map,
  };
}

/**
 * Reads one back, forgivingly.
 *
 * A missing or unreadable file is not an error: it means this vault has not
 * published with the overlay on, which is the normal case. The import then
 * does what it did before -- links what it can and leaves the rest naming
 * a page -- rather than refusing to run over a file nobody promised.
 */
export function parsePageMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const pages = (parsed as { pages?: unknown }).pages;
  if (!pages || typeof pages !== "object" || Array.isArray(pages)) return {};

  const out: Record<string, string> = {};
  for (const [url, source] of Object.entries(pages as Record<string, unknown>)) {
    if (typeof source === "string" && source) out[url] = source;
  }
  return out;
}

/**
 * Puts the note back on a comment that came in naming a page.
 *
 * Only where the comment's key is a page this vault published and is not
 * already a note. A comment from a preview carries the note's own path and
 * must be left alone, and a page the mapping does not know about stays as
 * it is -- the comment is still readable, it simply links to the page.
 *
 * Returns new objects rather than editing the ones handed in: the caller's
 * copies are what gets written back to the review file, and a resolve is
 * for the note being written now, not a change to the record.
 */
export function resolveToNotes<T extends { sourcePath: string }>(
  comments: T[],
  pages: Record<string, string>,
): T[] {
  return comments.map((comment) => {
    const note = pages[comment.sourcePath];
    return note && note !== comment.sourcePath
      ? { ...comment, sourcePath: note }
      : comment;
  });
}
