/**
 * Replacing Obsidian's per-render random ids with deterministic ones.
 *
 * Rendering the same note twice does not produce the same HTML. Obsidian
 * gives footnotes an id like `fnref-1-bcc468be79eac663` and Mermaid names its
 * `<svg>` `m8cff92452404fbc7`, both regenerated every time. Nothing about the
 * page has changed, but every byte after that point has.
 *
 * That was discovered through incremental publishing: three pages reported as
 * changed on every publish of an untouched vault, which would have made the
 * feature pointless while looking like it worked. It matters on its own too.
 * A footnote's anchor is a URL someone can link to, and one that is different
 * on every publish is a link that breaks for no reason.
 *
 * Rewriting an id means rewriting everything that points at it, which inside
 * an SVG includes `url(#...)` in presentation attributes and styles. So the
 * rename is done as a map built first and applied to every attribute, rather
 * than element by element.
 */

/** Ids that are regenerated per render, and the stable prefix to use. */
const VOLATILE_PATTERNS: { test: RegExp; prefix: string }[] = [
  // Obsidian footnotes: fn-1-<hex> and fnref-1-<hex>.
  { test: /^fnref-(\d+)-[0-9a-f]{8,}$/i, prefix: "fnref" },
  { test: /^fn-(\d+)-[0-9a-f]{8,}$/i, prefix: "fn" },
  // Mermaid's diagram root, and the ids it mints inside a diagram.
  { test: /^m[0-9a-f]{12,}$/i, prefix: "diagram" },
  { test: /^[a-z][\w-]*-[0-9a-f]{8,}$/i, prefix: "ref" },
  // Mermaid sequence diagrams number their actors from a counter that lives
  // in the library and keeps climbing for the lifetime of the app, so the
  // same diagram rendered twice produces actor98 and then actor104. Nothing
  // about the diagram changed; the app had simply drawn more of them.
  { test: /^actor\d+$/i, prefix: "actor" },
  { test: /^root-\d+$/i, prefix: "node" },
  // Class diagrams number their nodes from the same kind of app-lifetime
  // counter: classId-Publisher-4 becomes classId-Publisher-8 on the next
  // render of an identical diagram.
  { test: /^(classId-.+)-\d+$/i, prefix: "class" },
];

/**
 * Attributes that mean nothing on a published page, and should not be in one.
 *
 * Datacore builds its views with JSX, and the transform it ships adds
 * `__self` and `__source` to every element for debugging. They serialize as
 * `__self="[object Object]"`, which is noise in the output and a small
 * amount of information about the author's file paths.
 *
 * `data-osp-unresolved` is ours: `rewriteLinks` records the original target
 * of a link that pointed at an unpublished note, and `scanForLeaks` reads it
 * to report what the page gestures at. Both have finished by the time this
 * runs, and the value is the name of a note the author chose not to publish,
 * so it must not survive into the HTML.
 */
const DEBUG_ATTRIBUTES = ["__self", "__source", "data-osp-unresolved"];

/** Removes framework debug attributes from the whole subtree. */
export function stripDebugAttributes(root: HTMLElement): number {
  let removed = 0;
  for (const el of Array.from(root.querySelectorAll("*"))) {
    for (const name of DEBUG_ATTRIBUTES) {
      if (el.hasAttribute(name)) {
        el.removeAttribute(name);
        removed++;
      }
    }
  }
  return removed;
}

export interface StableIdStats {
  renamed: number;
  referencesUpdated: number;
}

/**
 * Makes every volatile id in the subtree deterministic.
 *
 * Numbering is by document order within the page, so the same note always
 * produces the same ids, and two notes never collide because ids only have
 * to be unique within their own page.
 */
export function stabilizeIds(root: HTMLElement): StableIdStats {
  const rename = new Map<string, string>();
  const counters = new Map<string, number>();

  for (const el of Array.from(root.querySelectorAll("[id]"))) {
    const id = el.getAttribute("id") ?? "";
    if (!id || rename.has(id)) continue;

    for (const { test, prefix } of VOLATILE_PATTERNS) {
      const match = id.match(test);
      if (!match) continue;

      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      // Keep the footnote's own number when it has one: `fnref-1` reads as
      // the first footnote, which is what a reader linking to it expects.
      // A capture group means the id carries something meaningful -- a
      // footnote's number, a class diagram's name -- and keeping it makes
      // the resulting anchor readable rather than merely stable.
      rename.set(id, match[1] ? `${prefix}-${match[1]}` : `${prefix}-${next}`);
      break;
    }
  }

  if (!rename.size) return { renamed: 0, referencesUpdated: 0 };

  // Replace the random token wherever it appears, not just where it is a
  // whole id. Mermaid builds compound names out of its diagram id -- a marker
  // ends up called `m8cff…-m8cff…-pointEnd` -- so matching whole ids renamed
  // the diagram and left every arrowhead pointing at a name that was gone.
  // Longest first, so a token that contains another is handled before it.
  const tokens = Array.from(rename.entries()).sort(
    (a, b) => b[0].length - a[0].length,
  );

  const substitute = (value: string): string => {
    let updated = value;
    for (const [from, to] of tokens) {
      if (updated.includes(from)) updated = updated.split(from).join(to);
    }
    return updated;
  };

  let referencesUpdated = 0;

  for (const el of Array.from(root.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      if (!attr.value) continue;
      const updated = substitute(attr.value);
      if (updated !== attr.value) {
        attr.value = updated;
        referencesUpdated++;
      }
    }
  }

  // Mermaid writes a <style> block inside its <svg> that selects on the
  // diagram's own id, so rewriting attributes alone left the stylesheet
  // pointing at a name that no longer existed and the diagram lost every
  // rule it had.
  for (const style of Array.from(root.querySelectorAll("style"))) {
    const text = style.textContent ?? "";
    if (!text) continue;
    const updated = substitute(text);
    if (updated !== text) {
      style.textContent = updated;
      referencesUpdated++;
    }
  }

  return { renamed: rename.size, referencesUpdated };
}
