/**
 * Wrapping rendered content in a page.
 *
 * Obsidian hands us the inside of a note and nothing else: no document, no
 * head, no stable heading ids. This module adds what a web page needs, and
 * deliberately adds no more than that -- the visual design lives in the
 * stylesheet, so a theme can be replaced without touching this file.
 *
 * Heading ids are generated here rather than reused from Obsidian, which
 * emits `data-heading` with the original text but no id. Link rewriting
 * slugifies heading fragments the same way, and the two must agree or every
 * `![[note#heading]]` anchor silently points nowhere.
 */

import { slugifyFragment } from "./links";

export interface PageMeta {
  title: string;
  /** Published URL path of this page, used to resolve relative asset paths. */
  url: string;
  description?: string;
  /** Site-wide name for the header and OG metadata. */
  siteName: string;
}

export interface Heading {
  level: number;
  text: string;
  id: string;
}

/**
 * Removes a leading <h1> that just repeats the page title.
 *
 * Writing `# Title` at the top of a note is near-universal habit, and the
 * page template prints the title too, so without this every page opens with
 * its own name twice.
 */
export function dropRedundantTitleHeading(root: HTMLElement, title: string): boolean {
  // Frontmatter renders first and hidden, so the first *visible* block is
  // what to inspect rather than the first child.
  const first = Array.from(root.children).find(
    (el) => !el.classList.contains("frontmatter") && el.tagName !== "STYLE",
  );
  if (!first || first.tagName !== "H1") return false;
  if (normalizeTitle(first.textContent ?? "") !== normalizeTitle(title)) return false;

  first.remove();
  return true;
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Gives every heading a unique id and returns the outline, which the page
 * template uses for a table of contents.
 */
export function assignHeadingIds(root: HTMLElement): Heading[] {
  const headings: Heading[] = [];
  const seen = new Map<string, number>();

  for (const el of Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6"))) {
    const text = el.textContent?.trim() ?? "";
    const base = slugifyFragment(text) || "section";

    // Two headings with the same text are common in a long note, and a
    // duplicate id would send every link to the first one.
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count}`;

    el.setAttribute("id", id);
    headings.push({ level: Number(el.tagName[1]), text, id });
  }

  return headings;
}

/** Depth of a published URL, for resolving site-root assets relatively. */
function pathToRoot(url: string): string {
  const depth = url.split("/").length - 1;
  return depth === 0 ? "./" : "../".repeat(depth);
}

export function buildPage(options: {
  meta: PageMeta;
  /** Serialized content, already normalized and link-rewritten. */
  content: string;
  headings: Heading[];
}): string {
  const { meta, content, headings } = options;
  const root = pathToRoot(meta.url);
  const description = meta.description ?? "";

  // Only h2 and h3 go in the table of contents: h1 is the page title, and
  // deeper levels make the rail unreadable on a narrow screen.
  const toc = headings
    .filter((h) => h.level === 2 || h.level === 3)
    .map(
      (h) =>
        `<li class="osp-toc-item osp-toc-h${h.level}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`,
    )
    .join("\n        ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title)} &middot; ${escapeHtml(meta.siteName)}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">` : ""}
<meta property="og:title" content="${escapeHtml(meta.title)}">
<meta property="og:type" content="article">
${description ? `<meta property="og:description" content="${escapeHtml(description)}">` : ""}
<link rel="stylesheet" href="${root}assets/obsidian.css">
<link rel="stylesheet" href="${root}assets/site.css">
</head>
<body>
<a class="osp-skip-link" href="#osp-main">Skip to content</a>
<div class="osp-shell">
  <header class="osp-header">
    <a class="osp-site-name" href="${root}index.html">${escapeHtml(meta.siteName)}</a>
  </header>
  <main class="osp-main" id="osp-main">
    <article class="osp-article markdown-rendered">
      <h1 class="osp-title">${escapeHtml(meta.title)}</h1>
${content}
    </article>
  </main>
${
  toc
    ? `  <aside class="osp-rail" aria-label="On this page">
      <nav class="osp-toc">
        <ul>
        ${toc}
        </ul>
      </nav>
    </aside>`
    : ""
}
</div>
</body>
</html>
`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
