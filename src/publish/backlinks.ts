/**
 * What links to this note, and what it is near.
 *
 * The reverse index is built from the links the rewriter already resolved, so
 * it costs one pass over data the publish has in hand rather than a second
 * crawl. It is deliberately not built from the vault's own link cache: the
 * site should only ever report links *between published pages*, and the
 * vault's cache knows about the notes that were left out. Naming those is the
 * leak `privacy.ts` exists to catch.
 */

/** One note mentioning another, with the sentence it said it in. */
export interface Mention {
  url: string;
  title: string;
  excerpt: string;
}

export interface OutgoingLinks {
  url: string;
  title: string;
  /** Published URLs this page links to, with the text around each link. */
  links: Array<{ url: string; context: string }>;
}

/**
 * Maps a page's URL to the pages that link to it.
 *
 * A page linking to the same target several times appears once, carrying the
 * first context: three excerpts from one note is repetition, not evidence.
 */
export function buildBacklinkIndex(pages: OutgoingLinks[]): Map<string, Mention[]> {
  const index = new Map<string, Mention[]>();

  for (const page of pages) {
    const seen = new Set<string>();
    for (const link of page.links) {
      if (link.url === page.url || seen.has(link.url)) continue;
      seen.add(link.url);
      const mentions = index.get(link.url) ?? [];
      mentions.push({ url: page.url, title: page.title, excerpt: link.context });
      index.set(link.url, mentions);
    }
  }

  for (const mentions of Array.from(index.values())) {
    mentions.sort((a, b) => a.title.localeCompare(b.title));
  }

  return index;
}

/**
 * Notes worth reading next: the ones this note links to, then the ones that
 * link to it, minus anything already shown as a backlink.
 *
 * "Related" on most sites means "an algorithm guessed". Here it means the
 * author linked them, which is the only relation a vault actually asserts.
 */
export function relatedNotes(
  url: string,
  outgoing: OutgoingLinks | undefined,
  backlinks: Mention[],
  titles: Map<string, string>,
  limit = 4,
): Mention[] {
  if (!outgoing) return [];
  const shown = new Set(backlinks.map((mention) => mention.url));
  const related: Mention[] = [];
  const seen = new Set<string>();

  for (const link of outgoing.links) {
    if (link.url === url || shown.has(link.url) || seen.has(link.url)) continue;
    const title = titles.get(link.url);
    if (!title) continue;
    seen.add(link.url);
    related.push({ url: link.url, title, excerpt: link.context });
    if (related.length === limit) break;
  }

  return related;
}

/**
 * The text around a link, as an excerpt.
 *
 * Trimmed to whole words and centred on the phrase that was linked, because a
 * backlink list is read to answer "in what connection?" and a cut-off word is
 * noise. Returns "" when the surrounding block is itself nothing but the link,
 * which is common in a list of links and reads better as no excerpt at all.
 */
export function excerptAround(blockText: string, linkText: string, width = 150): string {
  const text = blockText.replace(/\s+/g, " ").trim();
  const phrase = linkText.replace(/\s+/g, " ").trim();
  if (!text || text === phrase) return "";

  const at = phrase ? text.indexOf(phrase) : -1;
  if (at === -1) return clamp(text, width);

  const slack = Math.max(0, width - phrase.length);
  const start = Math.max(0, at - Math.floor(slack / 2));
  const end = Math.min(text.length, start + width);
  const slice = text.slice(start, end);

  const head = start > 0 ? slice.slice(slice.indexOf(" ") + 1) : slice;
  const tail = end < text.length ? head.slice(0, head.lastIndexOf(" ")) : head;
  const body = (tail || head).trim();

  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

function clamp(text: string, width: number): string {
  if (text.length <= width) return text;
  const cut = text.slice(0, width);
  return `${cut.slice(0, cut.lastIndexOf(" ")).trim()}…`;
}
