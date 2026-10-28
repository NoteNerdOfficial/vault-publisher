/**
 * Finding content from unpublished notes that reached a published page.
 *
 * This is the failure mode that makes a publisher dangerous rather than
 * merely buggy. A note is kept out of the site, and a Dataview query in a
 * published note lists it anyway: its title, its fields, its tasks. Nothing
 * in the selection logic can prevent it, because selection decides which
 * *files* become pages, while a query decides what goes *inside* a page, and
 * it runs against the whole vault.
 *
 * The test vault this was found in does exactly this. It publishes one
 * folder of notes, and its Dataview tables list every book in a second
 * folder that is not published.
 *
 * Two kinds of leak, found two ways:
 *
 * **Linked.** Generated output usually links the files it found. The link
 * rewriter already spots these -- it downgrades them to plain spans so they
 * do not 404 -- but a downgraded link is still the note's name on a public
 * page. What was a rendering detail is reported here as what it is.
 *
 * **Textual.** A query can print a title or a field value with no link at
 * all. Scanning a whole page for every unpublished note's name would drown
 * in false positives, so the search is confined to generated blocks: query
 * output is where vault-wide content enters a page, and prose that happens
 * to mention a note is the author's own choice.
 */

/** Blocks whose content was generated from a vault-wide query. */
const GENERATED_BLOCK_SELECTOR = [
  ".block-language-dataview",
  ".block-language-dataviewjs",
  ".block-language-datacore",
  ".block-language-datacorejs",
  ".bases-view",
  ".osp-base",
].join(",");

export interface Leak {
  /** Vault path of the unpublished note whose content appeared. */
  sourcePath: string;
  /** How it was found. */
  kind: "link" | "text";
  /** A short excerpt of the surrounding output, for the report. */
  context: string;
}

export interface PrivacyReport {
  leaks: Leak[];
  /** Distinct unpublished notes that appeared anywhere. */
  notes: string[];
}

export function emptyPrivacyReport(): PrivacyReport {
  return { leaks: [], notes: [] };
}

/**
 * The unpublished notes, prepared once for the whole build.
 *
 * The textual scan used to build one regex per unpublished note and test each
 * one against each generated block, so the work scaled with
 * (unpublished x blocks x pages) -- and a vault that publishes a small subset
 * of a large vault is both the shape that needs this scan most and the one the
 * 300-note scale test never exercised. Publishing 10 notes out of 2,000 with
 * four queries a page meant roughly 80,000 regex compilations.
 *
 * Instead the names go into one alternation, compiled once here and reused for
 * every page: each block is scanned in a single pass, and the matched text
 * says which note was found. Longest names first, so a note called
 * "api design" is preferred over a note called "api" where both could match.
 */
export interface UnpublishedIndex {
  /** Lower-cased basename to vault path. */
  readonly byName: Map<string, string>;
  /** Alternations over the names. Empty when nothing is unpublished. */
  readonly patterns: readonly RegExp[];
}

/**
 * Names per alternation. A regex over thousands of alternatives is slow to
 * compile and can exceed what the engine will accept, so the names are
 * batched; a handful of passes over a block is still far less work than one
 * pass per name.
 */
const NAMES_PER_PATTERN = 400;

/** A character that may not sit against a name for it to count as a match. */
const WORD_CHARACTER = "[\\p{L}\\p{N}_-]";

export function indexUnpublished(byName: Map<string, string>): UnpublishedIndex {
  const names = Array.from(byName.keys())
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));

  const patterns: RegExp[] = [];
  for (let i = 0; i < names.length; i += NAMES_PER_PATTERN) {
    const batch = names.slice(i, i + NAMES_PER_PATTERN).map(escapeRegExp);
    patterns.push(
      // Lookaround rather than capturing the neighbouring characters: a
      // consuming boundary would swallow the gap between two adjacent names
      // and miss the second one.
      new RegExp(
        `(?<!${WORD_CHARACTER})(${batch.join("|")})(?!${WORD_CHARACTER})`,
        "giu",
      ),
    );
  }

  return { byName, patterns };
}

/** Shortens a run of output to something readable in a report table. */
function excerpt(text: string, limit = 70): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/**
 * Scans a rendered page for content belonging to notes that are not being
 * published.
 *
 * Names are matched rather than paths because that is what query output
 * prints. Build the index once with `indexUnpublished` and pass it for every
 * page.
 */
export function scanForLeaks(
  root: HTMLElement,
  unpublished: UnpublishedIndex,
): PrivacyReport {
  const leaks: Leak[] = [];
  const seen = new Set<string>();

  const record = (sourcePath: string, kind: Leak["kind"], context: string) => {
    const key = `${sourcePath}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    leaks.push({ sourcePath, kind, context });
  };

  // Linked: anything the rewriter downgraded, plus any link still pointing at
  // a vault path we are not publishing.
  for (const el of Array.from(
    root.querySelectorAll("[data-osp-unresolved], [data-href], .internal-link"),
  )) {
    const target =
      el.getAttribute("data-osp-unresolved") ??
      el.getAttribute("data-href") ??
      el.textContent ??
      "";
    const name = basename(target);
    const path = unpublished.byName.get(name);
    if (path) record(path, "link", excerpt(el.textContent ?? name));
  }

  // Textual: only inside generated blocks, where vault-wide content enters.
  for (const block of Array.from(
    root.querySelectorAll(GENERATED_BLOCK_SELECTOR),
  )) {
    const text = blockText(block);
    if (!text) continue;
    for (const pattern of unpublished.patterns) {
      // Shared across pages, so the lastIndex a global regex carries between
      // calls has to be cleared rather than inherited.
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const path = unpublished.byName.get(match[1].toLowerCase());
        if (path) record(path, "text", excerpt(text));
      }
    }
  }

  return { leaks, notes: Array.from(new Set(leaks.map((l) => l.sourcePath))) };
}

/**
 * The text of a generated block, with element boundaries preserved.
 *
 * `textContent` concatenates, so a Dataview table of `<td>The Glass Bead
 * Game</td><td>1943</td>` reads as "The Glass Bead Game1943" -- and the name
 * is then followed by a digit, so a word-boundary match fails and the leak is
 * missed. Since query output is overwhelmingly tables, that was most of what
 * this scan exists to catch.
 *
 * Joined with a newline rather than a space on purpose: a space would let two
 * unrelated cells, "Design" and "Patterns", read as a note called "design
 * patterns" and report a leak that is not there. A note name cannot contain a
 * newline, so this separator can only prevent false negatives, never create
 * false positives.
 */
function blockText(block: Element): string {
  const walker = block.ownerDocument.createTreeWalker(
    block,
    NodeFilter.SHOW_TEXT,
  );
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? "";
    if (value.trim()) parts.push(value);
  }
  return parts.join("\n");
}

function basename(target: string): string {
  const withoutAnchor = target.split("#")[0].split("|")[0];
  const last = withoutAnchor.split("/").pop() ?? withoutAnchor;
  return last.replace(/\.md$/i, "").trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
