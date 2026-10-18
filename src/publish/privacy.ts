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
 * The demo site built from the spike vault does exactly this. It publishes
 * `spike-notes/` only, and its Dataview tables list every book in
 * `library/`, which is not published.
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

/** Shortens a run of output to something readable in a report table. */
function excerpt(text: string, limit = 70): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/**
 * Scans a rendered page for content belonging to notes that are not being
 * published.
 *
 * `unpublished` maps a lower-cased basename to the note's vault path. Names
 * are matched rather than paths because that is what query output prints.
 */
export function scanForLeaks(
  root: HTMLElement,
  unpublished: Map<string, string>,
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
    const path = unpublished.get(name);
    if (path) record(path, "link", excerpt(el.textContent ?? name));
  }

  // Textual: only inside generated blocks, where vault-wide content enters.
  for (const block of Array.from(
    root.querySelectorAll(GENERATED_BLOCK_SELECTOR),
  )) {
    const text = block.textContent ?? "";
    if (!text.trim()) continue;
    for (const [name, path] of unpublished) {
      // Word-ish boundaries: a note called "api" should not match "rapid".
      const pattern = new RegExp(
        `(^|[^\\p{L}\\p{N}_-])${escapeRegExp(name)}([^\\p{L}\\p{N}_-]|$)`,
        "iu",
      );
      if (pattern.test(text)) record(path, "text", excerpt(text));
    }
  }

  return { leaks, notes: Array.from(new Set(leaks.map((l) => l.sourcePath))) };
}

function basename(target: string): string {
  const withoutAnchor = target.split("#")[0].split("|")[0];
  const last = withoutAnchor.split("/").pop() ?? withoutAnchor;
  return last.replace(/\.md$/i, "").trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
