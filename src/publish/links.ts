/**
 * Turning Obsidian's links into web links.
 *
 * Obsidian resolves a wikilink at display time against the whole vault, so
 * the rendered anchor carries the link *text*, not a path:
 * `<a href="the-glass-bead-game" class="internal-link">`. On the web there is
 * no resolver, so each href has to become a real relative URL, decided
 * against the set of notes actually being published.
 *
 * Which makes the interesting case the link that points somewhere we are not
 * publishing. Leaving it live produces a 404; dropping it loses the reader's
 * context. So an unresolved link degrades to a span that still reads as
 * emphasis, and the publish reports how many there were -- a private note
 * linked from a public one is the single easiest way to leak, and silence
 * about it would be the wrong default.
 */

import { decodeUrlComponent, encodeUrlPath } from "./urls";

export interface LinkTarget {
  /** Vault path of a note being published, e.g. "library/pattern-language.md". */
  sourcePath: string;
  /** Published URL path for it, e.g. "library/pattern-language.html". */
  url: string;
}

export interface LinkRewriteStats {
  resolved: number;
  /** Links whose target is not being published; downgraded to spans. */
  unresolved: number;
  /** The distinct link texts that could not be resolved, for reporting. */
  unresolvedTargets: string[];
  external: number;
}

/**
 * Resolves a link the way Obsidian does: shortest unique name wins, so a
 * link written as `[[pattern-language]]` finds `library/pattern-language.md`
 * without needing the folder. Ambiguity is resolved by taking the shorter
 * path, which matches Obsidian's own preference for the closer match.
 */
export class LinkResolver {
  private readonly byBasename = new Map<string, LinkTarget[]>();
  private readonly byPath = new Map<string, LinkTarget>();

  constructor(targets: LinkTarget[]) {
    for (const target of targets) {
      this.byPath.set(normalizeKey(stripExtension(target.sourcePath)), target);

      const basename = stripExtension(target.sourcePath.split("/").pop() ?? "");
      const key = normalizeKey(basename);
      const list = this.byBasename.get(key) ?? [];
      list.push(target);
      this.byBasename.set(key, list);
    }

    for (const list of this.byBasename.values()) {
      list.sort((a, b) => a.sourcePath.length - b.sourcePath.length);
    }
  }

  resolve(linkText: string): LinkTarget | null {
    // A heading or block reference points at a place inside a note, so the
    // note is what resolves and the fragment is carried through separately.
    const [pathPart] = splitFragment(linkText);
    const key = normalizeKey(stripExtension(pathPart));

    return this.byPath.get(key) ?? this.byBasename.get(key)?.[0] ?? null;
  }
}

/**
 * Rewrites every link in `root`, in place. Runs on the live DOM before
 * serialization, for the same reason the paragraph fix does: the structure is
 * still trustworthy here.
 *
 * `fromUrl` is the published URL of the page being rewritten, so hrefs come
 * out relative and the site works from a subdirectory -- which GitHub Pages
 * serves from unless a custom domain is set.
 */
export function rewriteLinks(
  root: HTMLElement,
  resolver: LinkResolver,
  fromUrl: string,
): LinkRewriteStats {
  const stats: LinkRewriteStats = {
    resolved: 0,
    unresolved: 0,
    unresolvedTargets: [],
    external: 0,
  };
  const unresolved = new Set<string>();

  for (const anchor of Array.from(root.querySelectorAll("a"))) {
    const href = anchor.getAttribute("href") ?? "";

    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
      // Already absolute. Open off-site links in a new tab, which readers of
      // a reference site generally want.
      if (!href.startsWith("#")) {
        anchor.setAttribute("rel", "noopener");
        stats.external++;
      }
      continue;
    }

    if (href.startsWith("#")) continue;

    const target = resolver.resolve(href);
    if (!target) {
      unresolved.add(splitFragment(href)[0]);
      stats.unresolved++;
      replaceWithSpan(anchor);
      continue;
    }

    const [, fragment] = splitFragment(href);
    anchor.setAttribute(
      "href",
      relativeUrl(fromUrl, target.url) + (fragment ? `#${slugifyFragment(fragment)}` : ""),
    );
    stats.resolved++;
  }

  stats.unresolvedTargets = Array.from(unresolved);
  return stats;
}

/**
 * Keeps the text and the styling hook, drops the navigation. A reader sees
 * the phrase the author wrote, marked as a reference that is not public,
 * rather than a link into a 404.
 */
function replaceWithSpan(anchor: HTMLAnchorElement): void {
  const span = anchor.ownerDocument.createElement("span");
  span.className = "osp-unresolved-link";
  span.textContent = anchor.textContent ?? "";
  // The target names a note that is not being published, so this is written
  // only for `scanForLeaks` to report on. `stripDebugAttributes` removes it
  // afterwards -- it must not reach the published HTML.
  span.setAttribute("data-osp-unresolved", anchor.getAttribute("href") ?? "");
  anchor.replaceWith(span);
}

/** Relative path from one published URL to another. */
export function relativeUrl(fromUrl: string, toUrl: string): string {
  const from = fromUrl.split("/").slice(0, -1);
  const to = toUrl.split("/");
  const file = to.pop() ?? "";

  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) {
    shared++;
  }

  const up = from.length - shared;
  const segments = [...Array(up).fill(".."), ...to.slice(shared), file];
  // Encoded here because this is the last point before the value becomes an
  // href: a note named "Draft #2" otherwise produces a link to nowhere.
  const joined = encodeUrlPath(segments.join("/"));
  // "./" keeps a bare filename from being read as a protocol-relative or
  // scheme-like reference when a note's name contains a colon.
  return joined.startsWith("..") ? joined : `./${joined}`;
}

function splitFragment(link: string): [string, string] {
  const hash = link.indexOf("#");
  if (hash === -1) return [link, ""];
  return [link.slice(0, hash), link.slice(hash + 1)];
}

function stripExtension(path: string): string {
  return path.replace(/\.md$/i, "");
}

/** Obsidian link matching ignores case and treats separators loosely. */
function normalizeKey(value: string): string {
  return decodeUrlComponent(value).trim().toLowerCase();
}

/** Heading anchors have to match the ids the page generator emits. */
export function slugifyFragment(fragment: string): string {
  return fragment
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}
