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
import { overlayBundle } from "../overlay/overlayScript";
import {
  ShellInput,
  breadcrumb,
  commandBar,
  inPageMenu,
  jumpPanel,
  contextRail,
  statsHeader,
  icon,
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

/* --- code blocks ----------------------------------------------------- */

/**
 * What a language token is called when it is shown.
 *
 * The token is what the author typed after the fence, which is a filename
 * extension as often as it is a name. Unknown tokens are shown as written
 * rather than guessed at: a label that says `nix` is honest, and a label
 * that says nothing is a bar with a hole in it.
 */
const CODE_LANGUAGE_LABELS: Record<string, string> = {
  bash: "Shell",
  c: "C",
  console: "Shell",
  cpp: "C++",
  cs: "C#",
  css: "CSS",
  diff: "Diff",
  dockerfile: "Dockerfile",
  go: "Go",
  html: "HTML",
  ini: "INI",
  java: "Java",
  javascript: "JavaScript",
  js: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  kt: "Kotlin",
  latex: "LaTeX",
  lua: "Lua",
  markdown: "Markdown",
  md: "Markdown",
  php: "PHP",
  py: "Python",
  python: "Python",
  r: "R",
  rb: "Ruby",
  rs: "Rust",
  rust: "Rust",
  scss: "SCSS",
  sh: "Shell",
  shell: "Shell",
  sql: "SQL",
  swift: "Swift",
  toml: "TOML",
  ts: "TypeScript",
  tsx: "TSX",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
  zsh: "Shell",
};

/** `<pre>` elements that are not code and must be left exactly as they are. */
const NOT_CODE = ".frontmatter, .dataview, .mermaid-wrapper, .block-language-mermaid";

function languageToken(el: Element | null): string {
  if (!el) return "";
  for (const name of Array.from(el.classList)) {
    if (name.startsWith("language-")) return name.slice("language-".length).toLowerCase();
  }
  return "";
}

function languageLabel(token: string): string {
  if (!token) return "";
  return CODE_LANGUAGE_LABELS[token] ?? token;
}

function toolButton(
  doc: Document,
  options: { action: string; label: string; icons: string; attrs?: Record<string, string> },
): HTMLElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "osp-code-btn";
  button.setAttribute(options.action, "");
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    button.setAttribute(name, value);
  }
  button.innerHTML =
    options.icons + `<span class="osp-code-btn-label">${escapeHtml(options.label)}</span>`;
  return button;
}

/**
 * Turns Obsidian's bare `<pre><code>` into a code block a reader can use.
 *
 * Three things are wrong with the raw output on a published page. It carries
 * Obsidian's own copy button, which is wired to an app that is not there --
 * removed here rather than hidden, for the same reason frontmatter is: markup
 * that cannot work should not ship. It says nothing about what language it
 * is. And a line wider than the column scrolls with no sign that it does,
 * which on a trackpad is a discovery and on a mouse is a line that simply
 * ends.
 *
 * So each block becomes a figure with a bar: the language on the left, and on
 * the right the two controls a reader reaches for. The controls ship hidden
 * and the client script reveals them, exactly like the search field -- a copy
 * button that cannot copy is worse than no copy button.
 *
 * Returns how many blocks were prepared.
 */
export function prepareCodeBlocks(root: HTMLElement): number {
  const doc = root.ownerDocument;
  let prepared = 0;

  for (const pre of Array.from(root.querySelectorAll("pre"))) {
    if (pre.closest("[data-osp-code]") || pre.closest(NOT_CODE)) continue;
    if (pre.matches(NOT_CODE)) continue;

    const code = Array.from(pre.children).find((el) => el.tagName === "CODE");
    if (!code) continue;

    const token = languageToken(code) || languageToken(pre);
    // A failed Mermaid diagram is left as a <pre>; it is a diagnostic, not a
    // code block, and dressing it up as one would hide that.
    if (token === "mermaid") continue;

    for (const dead of Array.from(pre.querySelectorAll(".copy-code-button"))) dead.remove();

    const figure = doc.createElement("figure");
    figure.className = "osp-code";
    figure.setAttribute("data-osp-code", "");
    if (token) figure.setAttribute("data-osp-lang", token);

    const bar = doc.createElement("figcaption");
    bar.className = "osp-code-bar";
    const name = doc.createElement("span");
    name.className = "osp-code-lang";
    name.textContent = languageLabel(token);
    bar.append(name);

    const tools = doc.createElement("div");
    tools.className = "osp-code-tools";
    tools.setAttribute("data-osp-code-tools", "");
    tools.hidden = true;
    tools.append(
      toolButton(doc, {
        action: "data-osp-wrap",
        label: "Wrap",
        icons: icon("wrap", "osp-icon-sm"),
        attrs: { "aria-pressed": "false", title: "Wrap long lines" },
      }),
      toolButton(doc, {
        action: "data-osp-copy",
        label: "Copy",
        icons:
          icon("copy", "osp-icon-sm osp-code-icon-copy") +
          icon("check", "osp-icon-sm osp-code-icon-done"),
        attrs: { title: "Copy this block" },
      }),
    );
    bar.append(tools);

    pre.classList.add("osp-scroller");
    pre.replaceWith(figure);
    figure.append(bar, pre);
    prepared++;
  }

  return prepared;
}

/* --- diagrams -------------------------------------------------------- */

/** Properties that carry a colour and nothing else. */
const COLOUR_PROPERTY = "fill|stroke|color|background|background-color|stop-color|flood-color|border-color";

/** The few colour keywords Mermaid actually emits. */
const COLOUR_KEYWORDS = new Set([
  "black", "white", "red", "green", "blue", "yellow", "purple", "orange",
  "gray", "grey", "silver", "navy", "teal", "olive", "maroon", "lime", "aqua",
]);

/**
 * A value that paints something, as opposed to one that says not to.
 *
 * `none`, `transparent` and `currentColor` are structure rather than colour:
 * an edge whose `fill: none` is removed stops being a line and becomes a
 * filled blob, which is how the first attempt at this looked.
 */
function isLiteralColour(value: string): boolean {
  const v = value.replace(/!important/gi, "").trim().toLowerCase();
  if (!v) return false;
  if (v === "none" || v === "transparent" || v === "currentcolor" || v === "inherit") {
    return false;
  }
  return /^#[0-9a-f]{3,8}$/.test(v) || /^(rgb|rgba|hsl|hsla)\(/.test(v) || COLOUR_KEYWORDS.has(v);
}

/**
 * Takes Mermaid's palette out of a diagram so the page can supply its own.
 *
 * A rendered diagram carries its colours twice: a `<style>` scoped to the
 * diagram's id, holding every hex Mermaid resolved, and presentation
 * attributes on the shapes themselves. The id selector outranks anything a
 * stylesheet can reasonably say, so a published diagram stayed lavender on
 * every theme, in light and in dark -- the one element on the page that did
 * not belong to it.
 *
 * Both are removed here rather than fought in CSS. What stays is Mermaid's
 * geometry, its stroke widths and its dash patterns, which are the parts
 * that make a diagram readable and the parts we have no business rewriting.
 * `theme.ts` then paints it, from the same tokens as everything else.
 *
 * Returns how many diagrams were cleared.
 */
export function neutralizeMermaidColours(root: HTMLElement): number {
  const declaration = new RegExp(`(?<![-\\w])(${COLOUR_PROPERTY})\\s*:\\s*([^;{}]*);?`, "gi");
  let cleared = 0;

  for (const svg of Array.from(root.querySelectorAll(".mermaid svg, .mermaid-wrapper svg"))) {
    let touched = false;

    for (const style of Array.from(svg.querySelectorAll("style"))) {
      const before = style.textContent ?? "";
      const after = before.replace(declaration, (match, _property, value: string) =>
        isLiteralColour(value) ? "" : match,
      );
      if (after !== before) {
        style.textContent = after;
        touched = true;
      }
    }

    for (const el of Array.from(svg.querySelectorAll("[fill], [stroke]"))) {
      for (const name of ["fill", "stroke"]) {
        const value = el.getAttribute(name);
        if (value && isLiteralColour(value)) {
          el.removeAttribute(name);
          touched = true;
        }
      }
    }

    if (touched) cleared++;
  }

  return cleared;
}

/* --- tasks ----------------------------------------------------------- */

/** Task characters that genuinely mean the thing is finished. */
const TASK_DONE = new Set(["x", "X"]);

/**
 * Stops a task that is not finished from publishing as if it were.
 *
 * Obsidian renders every task whose character is not a space as checked and
 * `is-checked` -- `[x]`, but also `[/]`, `[-]` and `[>]`, which mean in
 * progress, dropped and deferred. On a page that strikes finished tasks
 * through, a note saying a thing is underway publishes saying it is done.
 *
 * The character is kept on the input so the client script can show the box
 * as indeterminate, which is what a browser draws a half-done checkbox as.
 * Without scripting it is an unchecked box: still wrong, but wrong in the
 * direction that does not claim work that has not happened.
 *
 * Returns how many tasks were corrected.
 */
export function prepareTaskStatuses(root: HTMLElement): number {
  let corrected = 0;

  for (const item of Array.from(root.querySelectorAll("li.task-list-item[data-task]"))) {
    const task = item.getAttribute("data-task") ?? "";
    if (task.trim() === "" || TASK_DONE.has(task)) continue;

    const box = item.querySelector("input[type=checkbox]");
    if (!box) continue;

    item.classList.remove("is-checked");
    box.removeAttribute("checked");
    (box as HTMLInputElement).checked = false;
    box.setAttribute("data-osp-task", task);
    corrected++;
  }

  return corrected;
}

/* --- tables ---------------------------------------------------------- */

/**
 * A cell holding a number rather than a word.
 *
 * Deliberately narrow. A date (`2026-10-24`), a version (`1.2.3`) and a range
 * (`3-5`) are all text that happens to contain digits, and right-aligning a
 * column of them would be worse than leaving it alone.
 */
const NUMERIC_CELL = /^[-+(]?[$€£¥]?\s?\d{1,3}(?:[,\s]?\d{3})*(?:\.\d+)?\s?[%kKmMbB]?\)?$/;

/** Cells an author aligned by hand, in the markdown table's own syntax. */
function explicitlyAligned(cell: Element): boolean {
  return (
    cell.hasAttribute("align") ||
    !!(cell as HTMLElement).style?.textAlign ||
    (cell.getAttribute("style") ?? "").includes("text-align")
  );
}

function cells(row: Element): Element[] {
  return Array.from(row.children).filter((el) => el.tagName === "TD" || el.tagName === "TH");
}

/**
 * Gives a table somewhere to scroll and tells its numbers apart from its
 * words.
 *
 * The table itself used to be the scrolling element (`display: block`), which
 * works and costs the table its own layout: a two-column table stops filling
 * the measure, and `width: 100%` stops meaning anything. A wrapper scrolls
 * instead, so the table is a table again.
 *
 * Numeric columns are marked here rather than guessed at in CSS. The
 * stylesheet cannot see a column -- only a cell -- so a rule written there
 * can only key off a property name, which is how the Bases table ended up
 * right-aligning anything called `rating`. Reading the column and marking
 * every cell in it is the same work done once, in the one place that can see
 * all of them.
 *
 * Returns how many tables were wrapped.
 */
export function prepareTables(root: HTMLElement): number {
  const doc = root.ownerDocument;
  let wrapped = 0;

  for (const table of Array.from(root.querySelectorAll("table"))) {
    if (table.closest(".osp-table-wrap")) continue;

    const bodyRows = Array.from(table.querySelectorAll("tbody tr")).filter(
      (row) => cells(row).length > 0,
    );
    const headRows = Array.from(table.querySelectorAll("thead tr"));
    const width = Math.max(
      0,
      ...bodyRows.map((row) => cells(row).length),
      ...headRows.map((row) => cells(row).length),
    );

    for (let column = 0; column < width; column++) {
      const column_cells = bodyRows
        .map((row) => cells(row)[column])
        .filter((cell): cell is Element => !!cell);
      const filled = column_cells.filter((cell) => {
        const value = (cell.textContent ?? "").trim();
        return value !== "" && value !== "-" && value !== "\u2014";
      });
      if (!filled.length) continue;
      if (!filled.every((cell) => NUMERIC_CELL.test((cell.textContent ?? "").trim()))) continue;

      const header = headRows.map((row) => cells(row)[column]).filter(Boolean) as Element[];
      if ([...column_cells, ...header].some(explicitlyAligned)) continue;
      for (const cell of [...column_cells, ...header]) cell.setAttribute("data-osp-num", "");
    }

    const wrap = doc.createElement("div");
    wrap.className = "osp-table-wrap osp-scroller";
    table.replaceWith(wrap);
    wrap.append(table);
    wrapped++;
  }

  return wrapped;
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
   * The note's own Markdown, for the reader who wants the text rather than
   * the rendering. Run through `noteSource` first, which is where the
   * decision about what a source view may show is made and explained.
   *
   * Absent for the pages the build invents, which have no source: they are
   * assembled markup, and a "Markdown" view of them would be a view of this
   * program's output rather than of anything anyone wrote.
   */
  source?: string;
  /**
   * Everything around the note: the vault panel, the context rail, the graph.
   *
   * Optional, and its absence is not a degraded mode -- the index page and
   * the tests build pages without it, and what comes out is the note on its
   * own, which is a complete page.
   */
  shell?: Omit<
    ShellInput,
    "url" | "title" | "root" | "headings" | "siteName" | "hasSource"
  >;
  /**
   * Present only in a preview build, and only on a page a note produced.
   *
   * Its presence is what turns the review overlay on for this page, and
   * `sourcePath` is what lets an imported comment find the note it is about.
   *
   * It must never be set on a publish. A published page carrying the vault
   * path it was built from would hand a reader the vault's folder structure,
   * which is the class of leak `privacy.ts` exists to prevent -- so the
   * publish path does not pass this through rather than passing it as false,
   * and `page.test.ts` asserts a page built without it carries no trace.
   */
  overlay?: {
    /** Vault path of the note this page was built from. */
    sourcePath: string;
    /** Prefills the comment author, from settings. */
    reviewer?: string;
    /** Tracker a comment can be filed in, by name, when one is set up. */
    tracker?: string;
  };
}): string {
  const { meta, content, headings } = options;
  const root = pathToRoot(meta.url);
  const description = meta.description ?? "";
  const source = options.source?.trim() ?? "";
  const overlay = options.overlay;

  const shell: ShellInput | null = options.shell
    ? {
        ...options.shell,
        siteName: meta.siteName,
        url: meta.url,
        title: meta.title,
        root,
        headings,
        hasSource: source !== "",
      }
    : null;

  const article =
    `<article class="osp-article markdown-rendered">` +
    `<h1 class="osp-title">${escapeHtml(meta.title)}</h1>` +
    propertiesBlock(meta.properties, root) +
    `\n${content}\n` +
    `</article>` +
    (shell ? mentionsBelow(shell) : "");

  // The stats lead the document rather than the article, so markdown mode
  // keeps them: how long a note is and how many sections it has are facts
  // about the note, not about which of its two renderings is on screen.
  // Off above 56rem, where the rail's copy is beside the note already.
  const doc =
    `<div class="osp-doc">` +
    (shell ? statsHeader(shell) : "") +
    article +
    sourcePane(source, meta.title) +
    `</div>`;

  const body = shell
    ? `<div class="osp-shell">` +
      commandBar(shell) +
      vaultPanel(shell) +
      jumpPanel(shell) +
      `<main class="osp-main" id="osp-main">` +
      breadcrumb(shell) +
      inPageMenu(shell) +
      doc +
      `</main>` +
      contextRail(shell) +
      `</div>`
    : `<div class="osp-shell osp-shell-bare">` +
      `<main class="osp-main" id="osp-main">` +
      doc +
      `</main>` +
      `</div>`;

  return `<!doctype html>
<html lang="en"${source ? ` data-osp-source` : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(meta.title)} &middot; ${escapeHtml(meta.siteName)}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">` : ""}
<meta property="og:title" content="${escapeHtml(meta.title)}">
<meta property="og:type" content="article">
${description ? `<meta property="og:description" content="${escapeHtml(description)}">` : ""}
<link rel="stylesheet" href="${root}assets/obsidian.css">
<link rel="stylesheet" href="${root}assets/site.css">
${overlay ? `<meta name="osp-review" content="${escapeHtml(JSON.stringify({ sourcePath: overlay.sourcePath, page: meta.url, site: meta.siteName, reviewer: overlay.reviewer ?? "", tracker: overlay.tracker ?? "" }))}">` : ""}
<script>${THEME_BOOT}</script>
</head>
<body>
<a class="osp-skip-link" href="#osp-main">Skip to content</a>
${body}
<script>${CLIENT_SCRIPT}</script>
${overlay ? `<script>${overlayBundle()}</script>` : ""}
</body>
</html>
`;
}

/**
 * The note's Markdown, as the other thing this page can show.
 *
 * It sits in the document rather than being fetched, like everything else
 * here: a published page makes no external requests, and a second file per
 * note would double the site's object count for a view most readers never
 * open.
 *
 * No `hidden` attribute on it. Which pane is showing is decided by a rule
 * keyed to `data-osp-view`, an attribute only the script sets, so the
 * default state of the page is the rendering and markdown mode is
 * unreachable without scripting -- which is correct, because the control
 * that reaches it is hidden then too. The cost is a page with no CSS at all
 * showing both, one after the other. That is a fair reading of the document
 * rather than a broken one.
 *
 * The copy button is the point of the view as much as the text is. Reading
 * Markdown on screen is nobody's goal; taking it is.
 */
function sourcePane(source: string, title: string): string {
  if (!source) return "";
  return (
    `<div class="osp-source markdown-rendered" data-osp-source-pane>` +
    `<figure class="osp-code osp-source-block">` +
    `<figcaption class="osp-code-bar">` +
    `<span class="osp-code-lang">${escapeHtml(title)}.md</span>` +
    `<div class="osp-code-tools">` +
    `<button class="osp-code-btn" type="button" data-osp-copy ` +
    `title="Copy this note's Markdown">` +
    icon("copy", "osp-icon-sm osp-code-icon-copy") +
    icon("check", "osp-icon-sm osp-code-icon-done") +
    `<span class="osp-code-btn-label">Copy</span></button>` +
    `</div></figcaption>` +
    `<pre><code>${escapeHtml(source)}</code></pre>` +
    `</figure></div>`
  );
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
