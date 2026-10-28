/**
 * Anchoring a review comment to a block of a built page.
 *
 * The obvious way to do this is a structural CSS path -- `article >
 * p:nth-of-type(3)` -- and it is wrong here. This plugin re-renders every
 * page from the vault on every build, so inserting one paragraph shifts the
 * index of every block below it, and every comment below the insertion
 * silently reattaches to the wrong paragraph. A positional anchor cannot
 * survive a document that is regenerated from Markdown continuously, and
 * silently reattaching a comment to text somebody else wrote is worse than
 * losing it.
 *
 * So the anchor is derived from the block's own content: a hash of its text,
 * stamped onto the element at build time. What that buys:
 *
 * - Insert a paragraph above a commented one and the comment holds. Nothing
 *   renumbers.
 * - Reorder blocks and the comments travel with them.
 * - **Rewrite** a commented block and its anchor is lost. That is the point,
 *   not a shortcoming: the thing the comment was about no longer exists, and
 *   an anchor that survived would be pointing at different words. The loss is
 *   reported, with the original text, rather than hidden.
 *
 * Whitespace is normalized before hashing, so re-wrapping a paragraph in the
 * Markdown source -- which authors do constantly, and which changes nothing
 * about the rendered text -- does not move the anchor. Case is not
 * normalized: editing the words is editing the words.
 */

/** Attribute holding a block's content-derived id. */
export const BLOCK_ATTRIBUTE = "data-osp-block";

/**
 * Blocks a comment may anchor to.
 *
 * Block-level only. A pin marks a paragraph, a table or a list item, which is
 * the granularity review feedback is actually about; anchoring to a `<span>`
 * would be precision the reviewer never asked for.
 *
 * Nesting is deliberate rather than tolerated: a `<li>` and the `<p>` inside
 * it are both stamped, so clicking the paragraph anchors to the paragraph and
 * clicking the bullet's margin anchors to the bullet. The tag name goes into
 * the hash, so the two do not collide despite holding identical text.
 */
export const BLOCK_SELECTOR =
  "p, h1, h2, h3, h4, h5, h6, li, blockquote, table, figure, pre, .callout";

/** Collapses whitespace so re-wrapping the source does not move an anchor. */
export function normalizeBlockText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * FNV-1a, 32 bit, as base 36.
 *
 * Deterministic across runs, platforms and Node versions, which is the entire
 * requirement: the same paragraph has to hash the same way on every build or
 * a comment anchored to it is lost for no reason at all. A cryptographic hash
 * would be stronger than needed and is not available identically in both
 * places this has to run.
 */
export function hashBlockText(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    // The FNV prime is 16777619 = 2^24 + 2^8 + 2^7 + 2^4 + 2^1 + 1, written
    // as shifts because `hash * 16777619` leaves the range where a double
    // represents integers exactly.
    hash =
      (hash +
        ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>>
      0;
  }
  return hash.toString(36);
}

/** The id a block with this tag and text gets, before duplicate numbering. */
export function blockId(tagName: string, text: string): string {
  // The tag goes in with a separator that cannot occur in either part, so
  // `<li>` and the `<p>` it wraps do not hash the same despite identical text.
  return hashBlockText(`${tagName.toLowerCase()}\u0000${normalizeBlockText(text)}`);
}

/**
 * Stamps `BLOCK_ATTRIBUTE` on every commentable block in the subtree.
 *
 * Returns how many were stamped, like the other passes in `page.ts`.
 *
 * Blocks with no text are skipped: there is nothing to derive an id from, and
 * a spacer is not something anyone reviews. The overlay walks up to the
 * nearest stamped ancestor, so a click on one still finds an anchor.
 *
 * Two blocks with the same tag and text get a numbered suffix, the same way
 * `assignHeadingIds` handles two headings that read alike. Document order
 * decides which is which, and document order is stable for a given build.
 */
export function stampBlockIds(root: HTMLElement): number {
  const seen = new Map<string, number>();
  let stamped = 0;

  for (const el of Array.from(root.querySelectorAll(BLOCK_SELECTOR))) {
    const text = normalizeBlockText(el.textContent ?? "");
    if (!text) continue;

    const base = blockId(el.tagName, text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    el.setAttribute(BLOCK_ATTRIBUTE, count === 0 ? base : `${base}-${count}`);
    stamped++;
  }

  return stamped;
}
