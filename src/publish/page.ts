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
import { encodeUrlPath } from "./urls";
import { CLIENT_SCRIPT, THEME_BOOT } from "./clientScript";
import {
  ShellInput,
  breadcrumb,
  commandBar,
  jumpPanel,
  contextRail,
  mentionsBelow,
  vaultPanel,
} from "./shell";

export interface PageMeta {
  title: string;
  /** Published URL path of this page, used to resolve relative asset paths. */
  url: string;
  description?: string;
  /** Site-wide name for the header and OG metadata. */
  siteName: string;
  /**
   * Frontmatter worth showing above the note: status, dates, tags.
   *
   * A tag carries the page it belongs to rather than just its name, because
   * the chip is a link and only the build knows where a tag lives.
   */
  properties?: Array<{
    label: string;
    value: string;
    tags?: Array<{ name: string; url: string }>;
  }>;
}

export interface Heading {
  level: number;
  text: string;
  id: string;
}

/**
 * Where Obsidian puts a note's frontmatter in rendered output.
 *
 * The site stylesheet hides these too (`theme.ts`, search for
 * `.frontmatter`). Keep the two lists in step: the stylesheet is the belt and
 * this is the braces, and the braces are the half that matters.
 */
export const FRONTMATTER_SELECTOR = ".frontmatter, .frontmatter-container";

/**
 * Removes the note's frontmatter from the page.
 *
 * `MarkdownRenderer.render` is handed the whole file, YAML and all, and emits
 * the frontmatter as an element it expects a stylesheet to hide. Hidden is not
 * the same as absent: `display: none` still serializes, so every published
 * page was carrying its note's full frontmatter in the HTML source, readable
 * by anyone who looked.
 *
 * The privacy scan does not cover this. It looks for content belonging to
 * notes that are *not* being published, which is a different question from a
 * published note's own metadata -- and a vault that uses a frontmatter flag to
 * decide what is public is, by construction, keeping decisions in exactly the
 * place this was exposing.
 *
 * Returns how many elements were removed, so a build can report it.
 */
export function stripFrontmatter(root: HTMLElement): number {
  const found = Array.from(root.querySelectorAll(FRONTMATTER_SELECTOR));
  for (const el of found) el.remove();
  return found.length;
}

/** Preserves callout fold state and supplies an accessible browser toggle. */
export function prepareCollapsibleCallouts(root: HTMLElement): number {
  let prepared = 0;
  let index = 0;

  for (const callout of Array.from(root.querySelectorAll(".callout.is-collapsible"))) {
    const content = callout.querySelector<HTMLElement>(".callout-content");
    const fold = callout.querySelector<HTMLElement>(".callout-fold");
    if (!content || !fold) continue;

    const collapsed = callout.classList.contains("is-collapsed");
    const contentId = `osp-callout-content-${index++}`;
    content.id = contentId;
    content.style.removeProperty("display");
    content.hidden = collapsed;

    const button = root.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "osp-callout-toggle";
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-controls", contentId);
    button.setAttribute("aria-label", collapsed ? "Expand callout" : "Collapse callout");
    while (fold.firstChild) button.append(fold.firstChild);
    fold.replaceWith(button);
    prepared++;
  }

  return prepared;
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
export function pathToRoot(url: string): string {
  const depth = url.split("/").length - 1;
  return depth === 0 ? "./" : "../".repeat(depth);
}

export function buildPage(options: {
  meta: PageMeta;
  /** Serialized content, already normalized and link-rewritten. */
  content: string;
  headings: Heading[];
  /**
   * Everything around the note: the vault panel, the context rail, the graph.
   *
   * Optional, and its absence is not a degraded mode -- the index page and
   * the tests build pages without it, and what comes out is the note on its
   * own, which is a complete page.
   */
  shell?: Omit<ShellInput, "url" | "title" | "root" | "headings" | "siteName">;
}): string {
  const { meta, content, headings } = options;
  const root = pathToRoot(meta.url);
  const description = meta.description ?? "";

  const shell: ShellInput | null = options.shell
    ? {
        ...options.shell,
        siteName: meta.siteName,
        url: meta.url,
        title: meta.title,
        root,
        headings,
      }
    : null;

  const article =
    `<article class="osp-article markdown-rendered">` +
    `<h1 class="osp-title">${escapeHtml(meta.title)}</h1>` +
    propertiesBlock(meta.properties, root) +
    `\n${content}\n` +
    `</article>` +
    (shell ? mentionsBelow(shell) : "");

  const body = shell
    ? `<div class="osp-shell">` +
      commandBar(shell) +
      vaultPanel(shell) +
      jumpPanel(shell) +
      `<main class="osp-main" id="osp-main">` +
      breadcrumb(shell) +
      `<div class="osp-doc">${article}</div>` +
      `</main>` +
      contextRail(shell) +
      `</div>`
    : `<div class="osp-shell osp-shell-bare">` +
      `<main class="osp-main" id="osp-main">` +
      `<div class="osp-doc">${article}</div>` +
      `</main>` +
      `</div>`;

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
<script>${THEME_BOOT}</script>
</head>
<body>
<a class="osp-skip-link" href="#osp-main">Skip to content</a>
${body}
<script>${CLIENT_SCRIPT}</script>
</body>
</html>
`;
}

/**
 * Frontmatter the author chose to show, above the note.
 *
 * Only the keys the build was asked for reach this: everything else was
 * removed by `stripFrontmatter`, which is the half that matters.
 */
function propertiesBlock(properties: PageMeta["properties"], root: string): string {
  if (!properties?.length) return "";
  return (
    `<div class="osp-meta">` +
    properties
      .map((property) =>
        property.tags?.length
          ? `<span class="osp-tagcloud">` +
            property.tags
              .map(
                (tag) =>
                  `<a class="osp-tag" href="${root}${escapeHtml(encodeUrlPath(tag.url))}">` +
                  `#${escapeHtml(tag.name)}</a>`,
              )
              .join("") +
            `</span>`
          : `<span class="osp-meta-item">${escapeHtml(property.label)} ` +
            `<span class="osp-meta-value">${escapeHtml(property.value)}</span></span>`,
      )
      .join("") +
    `</div>`
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
