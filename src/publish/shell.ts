/**
 * The page shell: command bar, vault panel, context rail.
 *
 * Markup only. Every rule that styles it lives in `theme.ts`, so a theme can
 * be swapped without touching this file, and every behaviour lives in
 * `clientScript.ts`, so the shell is complete and navigable with JavaScript
 * off -- the tree is real links, the outline is real anchors, and the search
 * field is the one thing that degrades (to a label nobody can type into,
 * which is why it is hidden when scripting is unavailable).
 */

import { Mention } from "./backlinks";
import { LocalGraph } from "./graph";
import { NavBucket, NavNode, NavNote, relativeDay } from "./nav";
import { Heading } from "./page";
import { encodeUrlPath } from "./urls";

export interface ShellInput {
  siteName: string;
  /** The page being rendered. */
  url: string;
  title: string;
  /** Path prefix back to the site root, e.g. "../". */
  root: string;
  nav: NavNode[];
  pinned: NavNote[];
  recency: NavBucket[];
  tags: Array<{ name: string; count: number }>;
  headings: Heading[];
  backlinks: Mention[];
  related: Mention[];
  graph: LocalGraph;
  /** Totals for the rail's one line of fact. */
  stats: { words: number; readingMinutes: number; sections: number };
  /** Today, for relative dates. Injected so a build is reproducible in a test. */
  today: Date;
  noteCount: number;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* --- icons ---------------------------------------------------------- */

const PATHS: Record<string, string> = {
  chevron: '<path d="m9 6 6 6-6 6"/>',
  folder:
    '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h3.8a1.5 1.5 0 0 1 1.2.6l.9 1.2h8.1A1.5 1.5 0 0 1 20 9.3v8.2A1.5 1.5 0 0 1 18.5 19h-14A1.5 1.5 0 0 1 3 17.5z"/>',
  file: '<path d="M14 3v5h5"/><path d="M14.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  pin: '<path d="M12 17v4"/><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  graph:
    '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7l8 .8M7.3 8.2 10.8 15.6M16.6 10.2 13.4 16"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  hash: '<path d="M10 3 8 21M16 3l-2 18M3.5 9h17M2.5 15h17"/>',
};

export function icon(name: string, className = "osp-icon"): string {
  return (
    `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`
  );
}

/* --- command bar ----------------------------------------------------- */

/**
 * The light/dark control is a switch rather than a button because it has two
 * states and both are destinations; a button that changes its own icon makes
 * a reader work out which icon means "now" and which means "next".
 */
export function themeSwitch(): string {
  return (
    `<button class="osp-switch" type="button" role="switch" aria-checked="false" ` +
    `data-osp-theme-toggle aria-label="Dark mode">` +
    `<span class="osp-switch-track">` +
    `<span class="osp-switch-icon osp-switch-sun">${icon("sun", "osp-icon-sm")}</span>` +
    `<span class="osp-switch-icon osp-switch-moon">${icon("moon", "osp-icon-sm")}</span>` +
    `<span class="osp-switch-thumb"></span>` +
    `</span></button>`
  );
}

export function commandBar(input: ShellInput): string {
  const initial = (input.siteName.trim()[0] ?? "V").toUpperCase();
  return (
    `<header class="osp-bar">` +
    `<a class="osp-brand" href="${input.root}index.html">` +
    `<span class="osp-mark" aria-hidden="true">${escapeHtml(initial)}</span>` +
    `<span class="osp-brand-name">${escapeHtml(input.siteName)}</span></a>` +
    searchField(`Search ${input.noteCount} notes…`, "osp-bar-search") +
    `<div class="osp-bar-actions">` +
    themeSwitch() +
    `<button class="osp-btn" type="button" data-osp-graph aria-pressed="false" ` +
    `title="Show the local graph" aria-label="Show the local graph">${icon("graph")}</button>` +
    `</div></header>`
  );
}

function searchField(placeholder: string, className: string): string {
  return (
    `<div class="osp-search ${className}" hidden data-osp-search>` +
    icon("search", "osp-icon-sm") +
    `<input type="search" placeholder="${escapeHtml(placeholder)}" ` +
    `aria-label="Search this site" autocomplete="off" spellcheck="false" ` +
    `data-osp-search-input>` +
    `<kbd>/</kbd></div>`
  );
}

/* --- breadcrumb ------------------------------------------------------ */

/** The folder anchor on the index page. Shared so the two cannot drift. */
export function folderSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Where this note sits, and the way back out.
 *
 * It stays at the top of the column while the note scrolls, because the one
 * question a long page stops answering is which note you are in. The back
 * control is scripted and ships hidden: it names the page you came from, and
 * a page nobody navigated to has nothing to name.
 */
export function breadcrumb(input: ShellInput): string {
  const segments = input.url.split("/").slice(0, -1);
  let walked = "";
  const folders = segments.map((segment) => {
    walked = walked ? `${walked}/${segment}` : segment;
    return (
      `<a href="${input.root}index.html#folder-${escapeHtml(folderSlug(walked))}">` +
      `${escapeHtml(segment)}</a>`
    );
  });

  // The front page is the first crumb, so it does not also need to be the
  // last one.
  const trail =
    input.url === "index.html"
      ? [`<span aria-current="page">${escapeHtml(input.siteName)}</span>`]
      : [
          `<a href="${input.root}index.html">${escapeHtml(input.siteName)}</a>`,
          ...folders,
          `<span aria-current="page">${escapeHtml(input.title)}</span>`,
        ];

  return (
    `<nav class="osp-crumb" data-osp-crumb aria-label="Breadcrumb">` +
    `<a class="osp-btn osp-crumb-back" data-osp-back hidden href="${input.root}index.html">` +
    icon("arrowLeft", "osp-icon-sm") +
    `<span class="osp-label" data-osp-back-label>Back</span></a>` +
    `<ol class="osp-crumb-trail">` +
    trail
      .map(
        (item, index) =>
          `<li>${index ? icon("chevron", "osp-icon-sm osp-crumb-sep") : ""}${item}</li>`,
      )
      .join("") +
    `</ol></nav>`
  );
}

/* --- vault panel ----------------------------------------------------- */

export function vaultPanel(input: ShellInput): string {
  return (
    `<aside class="osp-panel" aria-label="Browse the vault">` +
    `<div class="osp-panel-head">` +
    searchField("Search or jump to…", "osp-panel-search") +
    `</div>` +
    `<div class="osp-panel-body osp-scroll">` +
    `<h2 class="osp-group-title osp-browse-title">Browse` +
    `<span class="osp-count">${input.noteCount}</span></h2>` +
    `<ul class="osp-tree">${treeMarkup(input.nav, input, 0)}</ul>` +
    `</div></aside>`
  );
}

/**
 * The jump-to panel: the field's own answer, before and after typing.
 *
 * Before anything is typed it shows what changed and what the author put
 * first, which is the honest home for recency -- the moment a visitor has not
 * yet said what they want. Typing replaces that with matches, notes first and
 * then tags, because a tag is a place to go as much as a note is.
 *
 * It sits outside the vault panel and is positioned against the viewport,
 * because below 56rem the panel is gone and the field that needs it is the
 * one in the command bar.
 *
 * All of it is rendered at build time rather than assembled in the browser:
 * the recency buckets are fact the build knows and the script cannot, and the
 * tag index below is markup the script filters rather than data it parses.
 */
export function jumpPanel(input: ShellInput): string {
  return (
    `<div class="osp-jump" data-osp-jump hidden>` +
    `<div class="osp-jump-recent" data-osp-jump-recent>` +
    recencySection(input) +
    (input.pinned.length
      ? `<h2 class="osp-group-title">Start here</h2>` +
        `<ul class="osp-tree">` +
        input.pinned
          .map((note) => `<li>${noteRow(note, input, { icon: "pin" })}</li>`)
          .join("") +
        `</ul>`
      : "") +
    `</div>` +
    `<div class="osp-jump-results" data-osp-jump-results hidden></div>` +
    `<p class="osp-jump-hint"><span><kbd>↑</kbd><kbd>↓</kbd> move</span>` +
    `<span><kbd>enter</kbd> open</span><span><kbd>esc</kbd> close</span></p>` +
    tagIndex(input) +
    `</div>`
  );
}

/**
 * Every tag, as rows the script copies into the results.
 *
 * Hidden rather than absent so the matching is a filter over markup the build
 * produced, the same way the note matches are a filter over the tree. With
 * scripting off the tags are still reachable: the index page lists them, and
 * that is where these rows point.
 */
function tagIndex(input: ShellInput): string {
  if (!input.tags.length) return "";
  return (
    `<div class="osp-tag-index" data-osp-tag-index hidden>` +
    input.tags
      .map(
        (tag) =>
          `<a class="osp-row" href="${input.root}index.html#tag-${escapeHtml(tag.name)}">` +
          icon("hash", "osp-icon-sm") +
          `<span class="osp-label">${escapeHtml(tag.name)}</span>` +
          `<span class="osp-num">${tag.count}</span></a>`,
      )
      .join("") +
    `</div>`
  );
}

export function recencySection(input: ShellInput): string {
  if (!input.recency.length) {
    return (
      `<h2 class="osp-group-title">Recently updated</h2>` +
      `<p class="osp-empty"><b>Nothing new</b>No note has been edited lately.</p>`
    );
  }

  const total = input.recency.reduce((sum, bucket) => sum + bucket.count, 0);
  const shown = input.recency.slice(0, 2);
  let hidden = total - shown.reduce((sum, bucket) => sum + bucket.count, 0);

  const body = shown
    .map((bucket) => {
      const rows = bucket.rows.slice(0, 3);
      hidden += bucket.rows
        .slice(3)
        .reduce((sum, row) => sum + (row.kind === "batch" ? row.notes.length : 1), 0);

      return (
        `<div class="osp-bucket"><span class="osp-group-title">${bucket.label}</span>` +
        `<span class="osp-num">${bucket.count}</span></div>` +
        `<ul class="osp-tree">` +
        rows
          .map((row, index) =>
            row.kind === "batch"
              ? batchRow(row.notes, row.updated, `${bucket.id}-${index}`, input)
              : `<li>${noteRow(row.note, input, { when: true })}</li>`,
          )
          .join("") +
        `</ul>`
      );
    })
    .join("");

  return (
    `<h2 class="osp-group-title">Recently updated<span class="osp-num">${total}</span></h2>` +
    body +
    (hidden > 0
      ? `<a class="osp-row osp-row-more" href="${input.root}index.html#recent">` +
        `<span class="osp-label">Show all ${total} updated notes</span>` +
        icon("arrowRight", "osp-icon-sm") +
        `</a>`
      : "")
  );
}

/**
 * A run of notes written in the same minute, shown as the one edit it was.
 *
 * `<details>` rather than a scripted toggle: it opens with JavaScript off,
 * which matters because this row stands in for up to forty notes.
 */
function batchRow(notes: NavNote[], updated: string, key: string, input: ShellInput): string {
  return (
    `<li><details class="osp-batch" data-osp-batch="${key}">` +
    `<summary class="osp-row">` +
    icon("chevron", "osp-icon-sm osp-chev") +
    icon("layers", "osp-icon-sm") +
    `<span class="osp-label">${notes.length} notes changed together</span>` +
    `</summary>` +
    `<ul class="osp-nest">` +
    notes
      .map((note) => `<li>${noteRow(note, input, { folder: true })}</li>`)
      .join("") +
    `</ul></details></li>`
  );
}

function noteRow(
  note: NavNote,
  input: ShellInput,
  options: { icon?: string; when?: boolean; folder?: boolean } = {},
): string {
  const current = note.url === input.url;
  const trail = options.when && note.updated
    ? relativeDay(note.updated, input.today)
    : options.folder
      ? note.folder || "/"
      : "";

  return (
    `<a class="osp-row${current ? " osp-current" : ""}" href="${input.root}${escapeHtml(encodeUrlPath(note.url))}"` +
    (current ? ` aria-current="page"` : "") +
    `>` +
    (options.icon === undefined && !options.when && !options.folder
      ? icon("file", "osp-icon-sm")
      : options.icon
        ? icon(options.icon, "osp-icon-sm")
        : "") +
    `<span class="osp-label">${escapeHtml(note.title)}</span>` +
    (trail ? `<span class="osp-trail">${escapeHtml(trail)}</span>` : "") +
    `</a>`
  );
}

function treeMarkup(nodes: NavNode[], input: ShellInput, depth: number): string {
  return nodes
    .map((node) => {
      if (node.kind === "note") {
        return `<li class="osp-file${node.note.url === input.url ? " osp-current-file" : ""}">${noteRow(node.note, input)}</li>`;
      }
      // A folder holding the page being read starts open, so a reader never
      // arrives at a tree that does not show where they are.
      const open = input.url.startsWith(`${node.path}/`);
      return (
        `<li class="osp-folder"><details${open ? " open" : ""}>` +
        `<summary class="osp-row">` +
        icon("chevron", "osp-icon-sm osp-chev") +
        icon("folder", "osp-icon-sm") +
        `<span class="osp-label">${escapeHtml(node.name)}</span>` +
        `<span class="osp-num">${node.notes}</span>` +
        `</summary>` +
        `<ul class="${depth > 0 ? "osp-nest" : ""}">${treeMarkup(node.children, input, depth + 1)}</ul>` +
        `</details></li>`
      );
    })
    .join("");
}

/* --- context rail ---------------------------------------------------- */

export function contextRail(input: ShellInput): string {
  return (
    `<aside class="osp-rail osp-scroll" aria-label="About this note">` +
    `<div class="osp-rail-page" data-osp-rail-page>` +
    statsLine(input) +
    outlineSection(input) +
    mentionsSection("Linked from", input.backlinks, input, true) +
    mentionsSection("Related", input.related, input, false) +
    `</div>` +
    graphPanel(input) +
    `</aside>`
  );
}

/** One line of fact, every part of it the same size. */
function statsLine(input: ShellInput): string {
  const parts = [
    `${input.stats.readingMinutes} min`,
    `${input.stats.words} words`,
    `${input.stats.sections} ${input.stats.sections === 1 ? "section" : "sections"}`,
  ];
  return (
    `<p class="osp-stats">` +
    parts.map((part) => `<span class="osp-num">${part}</span>`).join(`<span aria-hidden="true">·</span>`) +
    `</p>`
  );
}

/**
 * The outline, as a table of contents behaves everywhere else.
 *
 * One mark on the section being read, and nothing else moving: a progress
 * instrument in the margin of a note is a second thing to watch while
 * reading the first.
 */
function outlineSection(input: ShellInput): string {
  const outline = input.headings.filter((h) => h.level === 2 || h.level === 3);
  if (!outline.length) return "";

  return (
    `<section class="osp-rail-section">` +
    `<h2 class="osp-rail-title">On this page</h2>` +
    `<ul class="osp-outline" data-osp-outline>` +
    outline
      .map(
        (heading) =>
          `<li class="osp-lvl${heading.level}">` +
          `<a href="#${heading.id}" data-osp-spy="${heading.id}">${escapeHtml(heading.text)}</a>` +
          `</li>`,
      )
      .join("") +
    `</ul></section>`
  );
}

function mentionsSection(
  title: string,
  mentions: Mention[],
  input: ShellInput,
  withCount: boolean,
): string {
  if (!mentions.length) return "";
  return (
    `<section class="osp-rail-section">` +
    `<h2 class="osp-rail-title">${title}` +
    (withCount ? `<span class="osp-num">${mentions.length}</span>` : "") +
    `</h2>` +
    mentions
      .map(
        (mention) =>
          `<a class="osp-mention" href="${input.root}${escapeHtml(encodeUrlPath(mention.url))}">` +
          `<span class="osp-mention-title">${escapeHtml(mention.title)}</span>` +
          (mention.excerpt
            ? `<span class="osp-mention-excerpt">${escapeHtml(mention.excerpt)}</span>`
            : "") +
          `</a>`,
      )
      .join("") +
    `</section>`
  );
}

/**
 * The graph, as the rail's other state.
 *
 * It replaces the rail's contents rather than opening over the page, and it
 * carries its own way back, so the control in the command bar never strands a
 * reader somewhere they cannot leave.
 */
function graphPanel(input: ShellInput): string {
  const { graph } = input;
  const label = (direction: GraphDirection): string =>
    direction === "both" ? "links both ways" : direction === "in" ? "links here" : "linked from here";

  return (
    `<div class="osp-rail-graph" data-osp-rail-graph hidden>` +
    `<div class="osp-rail-graphhead">` +
    `<button class="osp-btn" type="button" data-osp-graph-back>` +
    icon("arrowLeft", "osp-icon-sm") +
    `<span>This page</span></button>` +
    `</div>` +
    `<h2 class="osp-rail-title">Local graph<span class="osp-num">${graph.nodes.length}</span></h2>` +
    (graph.nodes.length
      ? `<svg class="osp-graph" viewBox="0 0 ${graph.width} ${graph.height}" ` +
        `role="img" aria-label="Notes linked to ${escapeHtml(input.title)}">` +
        graph.nodes
          .map(
            (node) =>
              `<line x1="${graph.centre.x}" y1="${graph.centre.y}" x2="${node.x}" y2="${node.y}" ` +
              `class="osp-graph-edge osp-graph-${node.direction}"/>`,
          )
          .join("") +
        graph.nodes
          .map(
            (node) =>
              `<a href="${input.root}${escapeHtml(encodeUrlPath(node.url))}" class="osp-graph-node">` +
              `<title>${escapeHtml(node.title)} — ${label(node.direction)}</title>` +
              `<circle cx="${node.x}" cy="${node.y}" r="4.5"/></a>`,
          )
          .join("") +
        `<circle cx="${graph.centre.x}" cy="${graph.centre.y}" r="6.5" class="osp-graph-centre"/>` +
        `</svg>` +
        `<ul class="osp-graph-key">` +
        graph.nodes
          .map(
            (node) =>
              `<li><a class="osp-row" href="${input.root}${escapeHtml(encodeUrlPath(node.url))}">` +
              `<span class="osp-graph-dot osp-graph-${node.direction}" aria-hidden="true"></span>` +
              `<span class="osp-label">${escapeHtml(node.title)}</span></a></li>`,
          )
          .join("") +
        `</ul>`
      : `<p class="osp-empty"><b>Nothing links here yet</b>This note has no links to or from other published notes.</p>`) +
    `</div>`
  );
}

type GraphDirection = "in" | "out" | "both";

/** Context the rail could not hold on a narrow screen, shown under the note. */
export function mentionsBelow(input: ShellInput): string {
  const all = [...input.backlinks, ...input.related];
  if (!all.length) return "";
  return (
    `<section class="osp-mentions" id="mentions">` +
    `<h2>Mentioned in</h2>` +
    `<div class="osp-mentions-cols">` +
    all
      .map(
        (mention) =>
          `<a class="osp-mention" href="${input.root}${escapeHtml(encodeUrlPath(mention.url))}">` +
          `<span class="osp-mention-title">${escapeHtml(mention.title)}</span>` +
          (mention.excerpt
            ? `<span class="osp-mention-excerpt">${escapeHtml(mention.excerpt)}</span>`
            : "") +
          `</a>`,
      )
      .join("") +
    `</div></section>`
  );
}
