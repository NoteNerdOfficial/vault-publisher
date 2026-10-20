/**
 * Making Obsidian's DOM safe to serialize.
 *
 * Obsidian builds its preview DOM imperatively, so it is free to put a <div>
 * inside a <p> -- the live tree holds whatever was appended to it. HTML's
 * parser is not so free: <p> auto-closes before block content, so a browser
 * re-parsing our serialized output moves those children *out* of the
 * paragraph and leaves the wrapper empty.
 *
 * That silently breaks embeds. `![[Reading.base]]` renders as
 * <p><span class="internal-embed bases-embed">...a div tree...</span></p>,
 * and after a round trip through the parser the span is empty and the base
 * sits as a sibling. Any CSS or script written against `.internal-embed >`
 * then matches nothing, on the published page only -- it looks right in
 * Obsidian and wrong in the browser, which is the worst kind of bug to chase.
 *
 * So the fix is applied while the live tree is still authoritative: a <p>
 * holding block content becomes a <div>, keeping its attributes. A <div> is
 * styled as a block the same way, and it survives the round trip.
 */

/**
 * Elements that force a <p> closed during parsing. Inline SVG and <span> are
 * deliberately absent: both are legal paragraph content and survive intact.
 */
const BLOCK_TAGS = [
  "address", "article", "aside", "blockquote", "details", "dialog", "div",
  "dl", "dt", "dd", "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "li", "main",
  "nav", "ol", "p", "pre", "section", "table", "ul",
];

/**
 * Matches a block element anywhere below a paragraph, not just as a direct
 * child. The distinction is the whole bug: Obsidian wraps an embed in a
 * <span>, so the paragraph's only child is inline and a direct-children check
 * sees nothing wrong -- while the parser still closes the paragraph at the
 * <div> nested inside that span.
 */
const BLOCK_DESCENDANT_SELECTOR = BLOCK_TAGS.join(",");

export interface NormalizeStats {
  /** Paragraphs rewritten as divs. */
  paragraphsRewritten: number;
  /** Paragraphs still holding block content after the pass (should be 0). */
  remaining: number;
}

function hasBlockDescendant(el: Element): boolean {
  return el.querySelector(BLOCK_DESCENDANT_SELECTOR) !== null;
}

/**
 * Rewrites every <p> that holds block content as a <div>, in place.
 *
 * Runs innermost-first: rewriting an outer <p> whose descendant is also an
 * offending <p> would otherwise move the inner one into a fresh element and
 * drop it from the already-captured node list.
 */
export function normalizeParagraphNesting(root: HTMLElement): NormalizeStats {
  let paragraphsRewritten = 0;

  // Deepest first, so a nested offender is handled before its ancestor.
  const paragraphs = Array.from(root.querySelectorAll("p")).reverse();

  for (const p of paragraphs) {
    if (!hasBlockDescendant(p)) continue;

    const div = p.ownerDocument.createElement("div");
    for (const attr of Array.from(p.attributes)) {
      div.setAttribute(attr.name, attr.value);
    }
    // Marks the rewrite so the published stylesheet can give these the same
    // vertical rhythm as a real paragraph.
    div.classList.add("osp-block-paragraph");
    while (p.firstChild) div.appendChild(p.firstChild);
    p.replaceWith(div);
    paragraphsRewritten++;
  }

  const remaining = Array.from(root.querySelectorAll("p")).filter(
    hasBlockDescendant,
  ).length;

  return { paragraphsRewritten, remaining };
}

/**
 * Counts nesting that a parser would still rearrange. Run against serialized
 * HTML as a publish-time assertion: anything above zero means the page will
 * render differently in a browser than it did in Obsidian.
 */
export function countInvalidNesting(html: string): number {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  // After a round trip the offending children have already been moved out, so
  // the evidence is an empty wrapper that should have had content.
  return Array.from(doc.body.querySelectorAll(".internal-embed, .markdown-embed"))
    .filter((el) => !el.children.length && !el.textContent?.trim()).length;
}

/**
 * Counts blocks that serialized while still showing a "working on it"
 * placeholder.
 *
 * This is the standing assertion for a failure that reached a live site:
 * three Dataview queries published as `Loading...` because every in-DOM
 * check considered a populated block finished. Checking the serialized
 * output as well means the next version of that mistake cannot ship quietly,
 * whatever the live DOM claimed at the time.
 */
export function countLoadingPlaceholders(html: string): number {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

  const selector =
    ".block-language-dataview, .block-language-dataviewjs, " +
    "[class*='block-language-datacore'], " +
    ".bases-view, .osp-base, pre.dataview";

  const stillLoading = (el: Element) => {
    const text = (el.textContent ?? "").trim();
    return (
      /^\s*(loading|rendering|evaluating)\b[.\u2026\s]*$/i.test(text) ||
      // Datacore's placeholder is a sentence: "<View is rendering>".
      /^<[^<>]*\bis rendering\b[^<>]*>$/i.test(text)
    );
  };

  return Array.from(doc.body.querySelectorAll(selector))
    .filter(stillLoading)
    // One placeholder, not two: Dataview's `<pre class="dataview">` sits
    // inside `.block-language-dataview`, so both match the same failure.
    // Counting only the outermost keeps the number equal to the number of
    // blocks a reader would actually see stuck.
    .filter((el) => !el.parentElement?.closest(selector)).length;
}
