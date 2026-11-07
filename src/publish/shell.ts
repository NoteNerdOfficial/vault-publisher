/**
 * The page shell: command bar, vault panel, context rail.
 *
 * Markup only. Every rule that styles it lives in `theme.ts`, so a theme can
 * be swapped without touching this file, and every behaviour lives in
 * `clientScript.ts`, so the shell is complete and navigable with JavaScript
 * off -- the tree is real links, the outline is real anchors, and the search
 * field is the one thing that degrades (to a label nobody can type into,
 * which is why it is hidden when scripting is unavailable).
 *
 * There are two search fields in the markup and never two on screen: the
 * bar's, which is the one at every width that draws a bar worth the name,
 * and the panel's, which is the same field inside the drawer on a phone.
 * `theme.ts` shows one and hides the other; `clientScript.ts` wires both the
 * same way, so neither is a second implementation of the first.
 */

import { Mention } from "./backlinks";
import { LocalGraph } from "./graph";
import { NavBucket, NavNode, NavNote, relativeDay } from "./nav";
import { Heading } from "./page";
import { encodeUrlPath } from "./urls";

/**
 * Where the pages the build invents ended up.
 *
 * Not constants, because a vault may already publish a note at `browse.html`
 * or a folder called `tags`, and the note has the better claim -- the author
 * named it. `sitePaths` in `landing.ts` picks around them, and every link to
 * one of these pages reads it from here so there is one answer rather than
 * one per caller.
 */
export interface SitePaths {
  /** The full folder-by-folder listing, e.g. "browse.html". */
  browse: string;
  /** The list of every tag, e.g. "tags.html". */
  tags: string;
  /** Folder the per-tag pages are published under, e.g. "tags". */
  tagPrefix: string;
}

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
  /** Every tag in the published set, with the page each one has. */
  tags: Array<{ name: string; count: number; url: string }>;
  paths: SitePaths;
  /**
   * The breadcrumb, when the page's URL does not describe it.
   *
   * A note's trail is its folders, which the URL already carries. A tag page
   * lives at `tags/writing.html` and its trail is site / Tags / #writing --
   * no folder called "Tags" exists, so deriving it from the path would link
   * to a group on the browse page that is not there.
   */
  crumbs?: Array<{ label: string; url?: string }>;
  headings: Heading[];
  backlinks: Mention[];
  related: Mention[];
  graph: LocalGraph;
  /** Totals for the rail's one line of fact. */
  stats: { words: number; readingMinutes: number; sections: number };
  /** Today, for relative dates. Injected so a build is reproducible in a test. */
  today: Date;
  noteCount: number;
  /**
   * Whether this page carries the note's Markdown as well as its rendering.
   *
   * A note does; the browse page, the tag pages and the generated homepage do
   * not, because there is no source behind them to show. Set by `buildPage`
   * from whether it was given any, so the control and the pane cannot
   * disagree about whether there is something to switch to.
   */
  hasSource: boolean;
  /**
   * Where the site came from, as an address to link, or absent for no link.
   *
   * Resolved before the build starts -- see `sourceLink.ts` -- so there is
   * one question here rather than three: either there is an address to put in
   * the bar or there is not. A page never has to work out whether the switch
   * is on, which repository was meant, or whether what was typed is something
   * a browser should follow.
   */
  sourceUrl?: string;
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
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  hash: '<path d="M10 3 8 21M16 3l-2 18M3.5 9h17M2.5 15h17"/>',
  // The line that runs on, turns, and comes back: the shape of a wrapped
  // line rather than a generic arrow.
  wrap: '<path d="M4 7h16M4 17h5"/><path d="M4 12h13.5a3 3 0 0 1 0 6H15"/><path d="m17 15-2.5 3 2.5 3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>',
  // The two halves of a chain, for the control that copies a heading's
  // address. Not the copy glyph: the pair sit a few lines apart on a page
  // and have to be told apart at a glance, and what this one hands over is
  // a link rather than the text it is drawn beside.
  link:
    '<path d="M10.6 13.4a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 1 0-5.66-5.66l-1.1 1.1"/>' +
    '<path d="M13.4 10.6a4 4 0 0 0-5.66 0L4.9 13.4a4 4 0 1 0 5.66 5.66l1.1-1.1"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  // The two reading modes. A book for the rendering and the angle brackets
  // every editor uses for source: the buttons carry words too, so these only
  // have to tell the pair apart at a glance.
  book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 15.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h4.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
  code: '<path d="m9 17-5-5 5-5"/><path d="m15 7 5 5-5 5"/>',
  // The branch, for the way out to the repository. Deliberately not a
  // service's own mark: the address is a setting, and a vault whose source
  // is on anything other than GitHub would be wearing the wrong logo. A
  // branch is what every one of them is holding.
  branch:
    '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  // The three widths, as the same two arrows at three settings: pulled in to
  // the measure, pushed out to the column, and off the edges entirely.
  arrowsIn: '<path d="M12 4v16"/><path d="M2 12h6.5"/><path d="m4.5 8 4 4-4 4"/><path d="M22 12h-6.5"/><path d="m19.5 8-4 4 4 4"/>',
  arrowsOut: '<path d="M12 4v16"/><path d="M8.5 12H2"/><path d="m6 8-4 4 4 4"/><path d="M15.5 12H22"/><path d="m18 8 4 4-4 4"/>',
  expand: '<path d="M15 3h6v6"/><path d="m14 10 7-7"/><path d="M9 21H3v-6"/><path d="m10 14-7 7"/>',
  // Three lines. The glyph used to be a drawn panel, on the argument that a
  // hamburger means "the site's menu" and this one opens the vault tree --
  // but the button only ever exists on the screens where the panel is gone,
  // and on those screens it *is* the site's menu: the tree, the search and
  // the theme, which is the whole of the navigation. The convention is worth
  // more than the distinction.
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  // Down, not right: this one drops a panel rather than walking into a tree.
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
};

export function icon(name: string, className = "osp-icon"): string {
  return (
    `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`
  );
}

/**
 * GitHub's own mark, which is the one glyph here that is not ours to draw.
 *
 * It needs its own emitter rather than a line in `PATHS`: every other icon on
 * this site is a stroked outline on a 24 unit grid, and this is a filled
 * shape on a 16 unit one. Passing it through `icon` would hand it
 * `fill="none"` and paint nothing at all.
 *
 * Octicons' `mark-github`, unaltered. A logo redrawn to match a set is a logo
 * that no longer is one, and the whole value of putting it in the bar is that
 * a reader recognises it without reading the word beside it.
 */
export function githubMark(className = "osp-icon"): string {
  return (
    `<svg class="${className}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">` +
    `<path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 ` +
    `0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 ` +
    `0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 ` +
    `0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 ` +
    `2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 ` +
    `1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 ` +
    `8c0-4.42 3.58-8 8-8Z"/></svg>`
  );
}

/**
 * Whether an address is one GitHub serves, so the mark and the word are true.
 *
 * Only github.com and its subdomains answer yes. A link the user typed at any
 * other host -- a GitLab project, a self-hosted Forgejo, an Enterprise Server
 * on a company domain -- gets the branch glyph and a neutral word instead,
 * because a logo on the wrong service is worse than no logo at all. An
 * Enterprise Server is the one case this is pessimistic about: there is
 * nothing in `https://github.acme.com/team/notes` that says what is running
 * there, and guessing from a hostname is how you end up putting GitHub's mark
 * on somebody's intranet.
 */
function isGitHubAddress(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "github.com" || host.endsWith(".github.com");
  } catch {
    return false;
  }
}

/* --- command bar ----------------------------------------------------- */

/**
 * The light/dark control is a switch rather than a button because it has two
 * states and both are destinations; a button that changes its own icon makes
 * a reader work out which icon means "now" and which means "next".
 *
 * That argument holds where there is room to draw both states at once. In the
 * drawer there is not -- see `themeButton`.
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

/**
 * The way out to the repository the site came from.
 *
 * Two shapes for one control, because the two places it appears have
 * different amounts of room and a different question to answer.
 *
 * In the bar it carries its name: at desktop width there is space for a word,
 * and a word is what tells a reader whether this leads to the site's source
 * or to the project that built the site. It is drawn to the same height as
 * the view toggle a row below it -- see `.osp-bar-source` in `theme.ts`,
 * where the height is written as that control's own sum rather than as a
 * number copied off it.
 *
 * In the drawer it is a square carrying only the mark, like the close and the
 * light/dark beside it. The drawer's top row is the search field and its
 * chrome, and a labelled link in it would be taking width off the one thing
 * most people opened the drawer for.
 *
 * It leaves the site, so it says so the way a link off a site should --
 * `rel="noreferrer noopener"`, and a new tab. A reader who clicks it is
 * going to look at the source and then come back to the page they were on,
 * and losing their place in the vault to do that is the one outcome worth
 * spending a tab to avoid.
 *
 * Returns nothing at all when there is no address, which is the normal case:
 * the setting is off by default, and a button that leads nowhere would be
 * worse than no button. See `sourceLink.ts` for what resolves it.
 */
export function sourceButton(url: string | undefined, where: "bar" | "drawer"): string {
  if (!url) return "";

  const github = isGitHubAddress(url);
  const name = github ? "GitHub repo" : "Source repo";
  const glyph = (className: string) =>
    github ? githubMark(className) : icon("branch", className);

  if (where === "drawer") {
    return (
      `<a class="osp-btn osp-btn-sq osp-panel-source-btn" href="${escapeHtml(url)}" ` +
      `target="_blank" rel="noreferrer noopener" ` +
      `aria-label="${name}" title="${name}">${glyph("osp-icon")}</a>`
    );
  }

  // `title` as well as the word, because the word says what it is and the
  // title says where it goes -- and where it goes is the thing a reader
  // checks before clicking a link off the site they are reading.
  return (
    `<a class="osp-bar-source" href="${escapeHtml(url)}" target="_blank" ` +
    `rel="noreferrer noopener" title="${escapeHtml(url)}">` +
    glyph("osp-icon-sm") +
    `<span>${name}</span></a>`
  );
}

/**
 * The bar reads left to right in the order a reader needs it: where you are,
 * then what you can do about it. The menu button is last in the markup as
 * well as last on the row -- it is the only control the narrow bar keeps, and
 * a tab order that reached it before the site's own name would be describing
 * a different row than the one on screen.
 *
 * The field sits between the two, in the middle of the window rather than the
 * middle of the free space: search is the one control on this page that is
 * used more than everything else combined, and the centre of the top row is
 * where a reader looks for it without being told. See `.osp-bar` in
 * `theme.ts` for the grid that holds it there -- the two side columns are
 * equal fractions so the field is centred on the viewport, not on whatever
 * the brand happens to leave over.
 */
export function commandBar(input: ShellInput): string {
  const initial = (input.siteName.trim()[0] ?? "V").toUpperCase();
  return (
    `<header class="osp-bar">` +
    `<a class="osp-brand" href="${input.root}index.html">` +
    `<span class="osp-mark" aria-hidden="true">${escapeHtml(initial)}</span>` +
    `<span class="osp-brand-name">${escapeHtml(input.siteName)}</span></a>` +
    searchField(`Search ${input.noteCount} notes…`, "osp-bar-search") +
    // Source first, then light and dark. The switch stays against the end of
    // the row where it has always been, and the one control that leaves the
    // site is next to it rather than past it.
    `<div class="osp-bar-actions">` +
    sourceButton(input.sourceUrl, "bar") +
    themeSwitch() +
    `</div>` +
    panelToggle() +
    `</header>`
  );
}

/**
 * The way back to the vault tree on a screen too narrow to keep it open.
 *
 * Below 56rem the panel is not merely narrow, it is gone -- and with it the
 * only view of how the vault is actually arranged. Search answers "take me to
 * the note I can name", which is a different question from "show me what is
 * here", and a reader who cannot answer the second one is reading a pile of
 * pages rather than a vault.
 *
 * So the panel stays in the document at every width and becomes a drawer at
 * the narrow end. Same markup, same tree, same links: nothing here is a
 * second mobile copy of the navigation that could drift from the first.
 *
 * It sits at the right-hand end of the bar and in a drawn square, which is
 * two decisions rather than one. Right, because the bar's other end is the
 * site's name and a phone is held by its bottom corners -- the thumb that
 * reaches this is on the same side as the hand. Enclosed, because the bar
 * now holds exactly one control: a bare glyph floating at the end of an
 * otherwise empty row reads as decoration, and a box says it is a button
 * without a word.
 *
 * Ships hidden, like the search field. A drawer is the script's doing from
 * end to end, and a button that opens nothing is worse than no button.
 */
export function panelToggle(): string {
  return (
    `<button class="osp-btn osp-btn-sq osp-panel-toggle" type="button" data-osp-panel-toggle hidden ` +
    `aria-expanded="false" aria-controls="osp-panel" ` +
    `aria-label="Menu" title="Menu">${icon("menu")}</button>`
  );
}

/**
 * Light or dark, in the drawer, as one square beside the way out.
 *
 * The bar's control is a switch: two states drawn at once, with the thumb
 * saying which is on. That costs a 3.25rem track, and the drawer's top row
 * has the search field across it -- a field that gives up a third of its
 * width to a control stops being the thing a reader opened the drawer for.
 *
 * So here it is a button the same size and shape as the close beside it,
 * carrying one icon rather than two: the sun while the page is light, the
 * moon while it is dark. A single icon is ambiguous about whether it names
 * the state or the destination, and the honest answer for a control this
 * small is the state -- it is the same reading as the page the reader is
 * looking at, so there is nothing to work out. `role="switch"` and
 * `aria-checked` carry that same fact for a screen reader, which is what the
 * client script is already setting on every control that has this attribute.
 */
export function themeButton(): string {
  return (
    `<button class="osp-btn osp-btn-sq osp-theme-btn" type="button" role="switch" ` +
    `aria-checked="false" data-osp-theme-toggle aria-label="Dark mode" title="Dark mode">` +
    `<span class="osp-theme-glyph osp-theme-sun">${icon("sun", "osp-icon")}</span>` +
    `<span class="osp-theme-glyph osp-theme-moon">${icon("moon", "osp-icon")}</span>` +
    `</button>`
  );
}

/**
 * The field, with the two things that stand at either end of it.
 *
 * The slash on the right is a keyboard's way in and is taken away from a
 * touch pointer, which has no key to press. What replaces it there is the
 * clear button: `type="search"` has a clear of its own, but the stylesheet
 * turns it off -- it is drawn by the browser rather than by this site, and
 * on iOS it does not appear at all. So the field carries its own.
 *
 * It ships hidden and the script shows it once there is something to clear,
 * which is also what keeps it honest with scripting off: a button that
 * cannot empty the field would be a button that does nothing.
 */
function searchField(placeholder: string, className: string): string {
  return (
    `<div class="osp-search ${className}" hidden data-osp-search>` +
    icon("search", "osp-icon-sm") +
    `<input type="search" placeholder="${escapeHtml(placeholder)}" ` +
    `aria-label="Search this site" autocomplete="off" spellcheck="false" ` +
    `data-osp-search-input>` +
    `<button class="osp-search-clear" type="button" data-osp-search-clear hidden ` +
    `aria-label="Clear search" title="Clear search">${icon("close", "osp-icon-sm")}</button>` +
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
 * question a long page stops answering is which note you are in.
 *
 * The pair of arrows is the browser's own history, the way Obsidian's is: a
 * reader who opened four notes wants the fourth, third, fourth again without
 * reading a label each time. They ship disabled, and the script enables
 * whichever direction this tab can actually go -- a control that says it can
 * do nothing is better than one that does nothing when pressed.
 *
 * The far end of the row holds the two controls that change the note rather
 * than leave it: which view of it to read, and how much of the window it
 * gets. They belong here rather than in the command bar because both are
 * about this page, and the bar is about the site.
 */
export function breadcrumb(input: ShellInput): string {
  const segments = input.url.split("/").slice(0, -1);
  let walked = "";
  const folders = segments.map((segment) => {
    walked = walked ? `${walked}/${segment}` : segment;
    return (
      `<a href="${input.root}${escapeHtml(encodeUrlPath(input.paths.browse))}` +
      `#folder-${escapeHtml(folderSlug(walked))}">${escapeHtml(segment)}</a>`
    );
  });

  // The front page is the first crumb, so it does not also need to be the
  // last one.
  const trail = input.crumbs
    ? [
        `<a href="${input.root}index.html">${escapeHtml(input.siteName)}</a>`,
        ...input.crumbs.map((crumb, index) =>
          crumb.url && index < (input.crumbs?.length ?? 0) - 1
            ? `<a href="${input.root}${escapeHtml(encodeUrlPath(crumb.url))}">${escapeHtml(crumb.label)}</a>`
            : `<span aria-current="page">${escapeHtml(crumb.label)}</span>`,
        ),
      ]
    : input.url === "index.html"
      ? [`<span aria-current="page">${escapeHtml(input.siteName)}</span>`]
      : [
          `<a href="${input.root}index.html">${escapeHtml(input.siteName)}</a>`,
          ...folders,
          `<span aria-current="page">${escapeHtml(input.title)}</span>`,
        ];

  return (
    `<nav class="osp-crumb" data-osp-crumb aria-label="Breadcrumb">` +
    `<div class="osp-crumb-nav" role="group" aria-label="History">` +
    historyButton("back", "arrowLeft", "Go back") +
    historyButton("forward", "arrowRight", "Go forward") +
    `</div>` +
    `<ol class="osp-crumb-trail">` +
    trail
      .map(
        (item, index) =>
          `<li>${index ? icon("chevron", "osp-icon-sm osp-crumb-sep") : ""}${item}</li>`,
      )
      .join("") +
    `</ol>` +
    `<div class="osp-crumb-tools">` +
    (input.hasSource ? viewModes() : "") +
    widthControl() +
    `</div></nav>`
  );
}

/**
 * Read the note, or read what it was written in.
 *
 * Markdown mode is not a developer's curiosity on a site like this. The whole
 * promise of the project is that the vault is the source and the site is a
 * rendering of it, and a reader who wants to quote a passage, lift a table or
 * keep a note of their own is better served by the text than by a selection
 * dragged out of styled HTML.
 *
 * A radiogroup rather than a toggle button, because both states are
 * destinations and each one is named. A button that swaps its own label makes
 * the reader work out whether it is saying where they are or where they would
 * go -- the same reason the light/dark control upstairs is a switch.
 *
 * It ships hidden and the script reveals it, like the search field: the pane
 * it switches to is shown by a rule keyed to an attribute only the script
 * sets, so with scripting off the control could not do anything it says.
 */
export function viewModes(): string {
  return (
    `<div class="osp-seg" role="radiogroup" aria-label="View mode" data-osp-views hidden>` +
    viewButton("read", "book", "Read", true) +
    viewButton("markdown", "code", "Markdown", false) +
    `</div>`
  );
}

/**
 * Labelled twice on purpose. Below 56rem the words are taken away and the
 * buttons are icons, and a name that is `display: none` is a name no screen
 * reader reports -- so the one that survives is on the attribute.
 */
function viewButton(mode: string, glyph: string, label: string, on: boolean): string {
  const name = `${label} view`;
  return (
    `<button type="button" class="osp-seg-btn" role="radio" data-osp-view-mode="${mode}" ` +
    `aria-checked="${on}" tabindex="${on ? 0 : -1}" title="${name}" aria-label="${name}">` +
    icon(glyph, "osp-icon-sm") +
    `<span>${label}</span></button>`
  );
}

/**
 * How much of the window the note is allowed to use.
 *
 * The default measure is right for prose and wrong for the output this
 * publisher exists to carry: a Dataview table with nine columns, a Bases
 * view, a wide Mermaid diagram. Those are the notes where a reader needs the
 * room, and they are also the notes where a fixed measure is most obviously
 * somebody else's decision. So the reader gets to make it, three ways: the
 * measure, the whole column, or the whole window with the panels out of it.
 *
 * Icon-only, with the names in `title` and `aria-label`. Three words beside
 * the mode buttons would crowd a row that already carries the trail, and
 * unlike the modes these three are a scale -- the arrows say which end of it
 * each one is, which a label would only repeat.
 */
export function widthControl(): string {
  return (
    `<div class="osp-seg osp-seg-icon" role="radiogroup" aria-label="Content width" ` +
    `data-osp-widths hidden>` +
    widthButton("reading", "arrowsIn", "Reading width", true) +
    widthButton("wide", "arrowsOut", "Wide", false) +
    widthButton("full", "expand", "Full width", false) +
    `</div>`
  );
}

function widthButton(mode: string, glyph: string, label: string, on: boolean): string {
  return (
    `<button type="button" class="osp-seg-btn" role="radio" data-osp-width-mode="${mode}" ` +
    `aria-checked="${on}" tabindex="${on ? 0 : -1}" title="${label}" aria-label="${label}">` +
    // At the smaller size these three collapse into one another: the whole
    // difference between them is which way five arrowheads point.
    icon(glyph, "osp-icon") +
    `</button>`
  );
}

/**
 * One arrow. Disabled in the markup, because without the script there is no
 * history to move through and a live-looking control would be a lie.
 */
function historyButton(direction: "back" | "forward", glyph: string, label: string): string {
  return (
    `<button type="button" class="osp-crumb-step" data-osp-${direction} disabled ` +
    `aria-label="${label}" title="${label}">${icon(glyph, "osp-icon-sm")}</button>`
  );
}

/* --- vault panel ----------------------------------------------------- */

export function vaultPanel(input: ShellInput): string {
  return (
    // The scrim is a sibling rather than a layer inside the panel: it covers
    // the page the drawer is sitting over, and tapping it is the way out
    // that needs no aim.
    `<div class="osp-scrim" data-osp-scrim hidden></div>` +
    `<aside class="osp-panel" id="osp-panel" aria-label="Browse the vault">` +
    `<div class="osp-panel-head">` +
    // The drawer's copy of the bar's field, and the only one on screen at a
    // width where the bar has room for the site's name and nothing else.
    searchField("Search or jump to…", "osp-panel-search") +
    // Light or dark lives here and only here on a phone: the bar no longer
    // carries it below 56rem, where the bar is the site's name and the way
    // into this drawer and nothing else. It is the setting a reader most
    // often wants at the moment they are already in the furniture, and the
    // pair it makes with the close is the whole of the drawer's chrome.
    // Hidden at every width that keeps the panel open, where the bar's
    // switch is a few inches away and two of the same control would be one
    // too many.
    // And the same for the source link, for the same reason: below 56rem the
    // bar carries the site's name and the way into this drawer, so a control
    // that is not here is not anywhere. It keeps the order it has in the bar
    // -- source, then light and dark -- and is absent entirely when no
    // address is set, like its copy up there.
    (input.sourceUrl
      ? `<div class="osp-panel-source">${sourceButton(input.sourceUrl, "drawer")}</div>`
      : "") +
    `<div class="osp-panel-theme">${themeButton()}</div>` +
    `<button class="osp-btn osp-btn-sq osp-panel-close" type="button" data-osp-panel-close ` +
    `aria-label="Close" title="Close">${icon("close", "osp-icon")}</button>` +
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
 * because the field it answers to is in the command bar and the panel it
 * would otherwise live in is gone at the widths where that matters most.
 * Centred under the field, at the field's own open width, so the two read as
 * one surface that grew downwards rather than as a box that appeared.
 *
 * The scrim in front of it is what makes the field feel like a mode rather
 * than a widget: the page behind steps back, the bar does not, and the one
 * lit thing left on screen is the thing being typed into. It is drawn by CSS
 * off `data-osp-searching` on the root, so with scripting off it is a div that
 * never paints.
 *
 * All of it is rendered at build time rather than assembled in the browser:
 * the recency buckets are fact the build knows and the script cannot, and the
 * tag index below is markup the script filters rather than data it parses.
 */
export function jumpPanel(input: ShellInput): string {
  return (
    `<div class="osp-search-scrim" data-osp-search-scrim aria-hidden="true"></div>` +
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
 * scripting off the tags are still reachable: each row is a link to that
 * tag's own page, which is where a tag goes from everywhere else too.
 */
function tagIndex(input: ShellInput): string {
  if (!input.tags.length) return "";
  return (
    `<div class="osp-tag-index" data-osp-tag-index hidden>` +
    input.tags
      .map(
        (tag) =>
          `<a class="osp-row" href="${input.root}${escapeHtml(encodeUrlPath(tag.url))}">` +
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
      ? `<a class="osp-row osp-row-more" href="${input.root}${escapeHtml(encodeUrlPath(input.paths.browse))}#recent">` +
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
        // The angle brackets for one of the vault's own HTML files: the row
        // opens a page the site did not render, and the icon is the only
        // warning a reader gets that the shell around it will be gone.
        const row = noteRow(node.note, input, node.note.asIs ? { icon: "code" } : {});
        return `<li class="osp-file${node.note.url === input.url ? " osp-current-file" : ""}">${row}</li>`;
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

/* --- in-page menu ---------------------------------------------------- *
 * The outline, on a screen with no margin to put it in.
 *
 * On a wide window "On this page" is a section of the rail, standing beside
 * the note the whole time it is read. Below 56rem the rail is gone from the
 * side of the page and its contents are appended under the note -- which is
 * the right home for what links here and what this is near, because those
 * are read after the note. An outline read after the note is a table of
 * contents for a journey already made.
 *
 * So the outline alone leaves the rail on these screens and becomes a row
 * pinned under the breadcrumb: shut, it names the section being read, which
 * is a fact worth a permanent line on a long note; open, it is the same list
 * of anchors, over the note rather than shoving it down the page.
 *
 * `<details>`, so it opens with scripting off -- the summary and the anchors
 * are the whole control. What the script adds is the name of the current
 * section and shutting it again once a link has been followed.
 * -------------------------------------------------------------------- */

export function inPageMenu(input: ShellInput): string {
  const outline = input.headings.filter((h) => h.level === 2 || h.level === 3);
  if (!outline.length) return "";

  return (
    `<details class="osp-inpage" data-osp-inpage>` +
    `<summary class="osp-inpage-head">` +
    `<span class="osp-inpage-label">On this page</span>` +
    `<span class="osp-inpage-now" data-osp-inpage-now>` +
    escapeHtml(outline[0].text) +
    `</span>` +
    icon("chevronDown", "osp-icon-sm osp-inpage-chev") +
    `</summary>` +
    `<div class="osp-inpage-body osp-scroll">` +
    `<ul class="osp-outline">` +
    outline
      .map(
        (heading) =>
          `<li class="osp-lvl${heading.level}">` +
          `<a href="#${heading.id}" data-osp-spy="${heading.id}">${escapeHtml(heading.text)}</a>` +
          `</li>`,
      )
      .join("") +
    `</ul></div></details>`
  );
}

/* --- context rail ---------------------------------------------------- */

export function contextRail(input: ShellInput): string {
  return (
    `<aside class="osp-rail osp-scroll" aria-label="About this note">` +
    statsLine(input, "osp-stats-rail") +
    outlineSection(input) +
    mentionsSection("Linked from", input.backlinks, input, true) +
    mentionsSection("Related", input.related, input, false) +
    // Last, because it is the widest view and the least specific: the
    // outline is this note, what links here is this note's neighbours, and
    // the graph is the shape they make. Reading down the rail is reading
    // outward from the page.
    graphSection(input) +
    `</aside>`
  );
}

/**
 * One line of fact, every part of it the same size.
 *
 * Emitted twice, like the outline: once in the rail, which on a wide window
 * stands beside the note, and once at the head of the note itself, which is
 * where it has to be when the rail has become the foot of the page. The
 * stylesheet shows one or the other and never both, and both come out of
 * this function so the two cannot say different numbers.
 */
function statsLine(input: ShellInput, className: string): string {
  // The pages the build invents -- browse, the tag index, a tag's own page --
  // carry a zeroed count, because nobody wrote them and there is nothing to
  // count. In the rail that read as "1 min / 0 words / 0 sections", which
  // was already wrong and became louder once this line moved to the head of
  // the note on a narrow screen. A page with no prose has no stats.
  if (input.stats.words === 0) return "";

  const parts = [
    `${input.stats.readingMinutes} min`,
    `${input.stats.words} words`,
    `${input.stats.sections} ${input.stats.sections === 1 ? "section" : "sections"}`,
  ];
  return (
    `<p class="osp-stats ${className}">` +
    parts.map((part) => `<span class="osp-num">${part}</span>`).join(`<span aria-hidden="true">·</span>`) +
    `</p>`
  );
}

/**
 * The note's stats at the head of the note.
 *
 * The rail's copy is above the fold on a wide window and at the very bottom
 * of the page on a narrow one, which is the one place a reader cannot use
 * it: how long something takes to read is a question asked before reading,
 * not after. So on these screens it leads the page instead.
 */
export function statsHeader(input: ShellInput): string {
  return statsLine(input, "osp-stats-top");
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

  // Marked, because it is the one rail section that describes the rendering
  // rather than the note: in markdown mode its anchors point at headings
  // that are not on screen, so the stylesheet takes it away with them.
  return (
    `<section class="osp-rail-section osp-rail-outline">` +
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
 * The graph, as the last section of the rail.
 *
 * It used to be the rail's other state, reached by a control in the command
 * bar: press it and the rail's contents were replaced, press "This page" and
 * they came back. That is a lot of apparatus for a picture. The bar is about
 * the site and the rail is about the note, so a control in the bar that
 * rewrote the rail was reaching across the page to do it -- and a reader had
 * to know the button existed, press it, and then find their way back, to see
 * something that was never going to need the whole column.
 *
 * So it is simply a section now, and the bar is one control lighter. On a
 * narrow screen the rail is the foot of the page, which puts the graph at
 * the very bottom -- the right place for the widest, least urgent view of
 * where a note sits.
 *
 * Nothing at all when nothing links here. The empty state existed because a
 * reader who pressed a button had to be told why the panel they asked for
 * was blank; a section nobody asked for owes no such explanation, and a
 * heading over the words "no links" is two lines spent saying nothing.
 */
function graphSection(input: ShellInput): string {
  const { graph } = input;
  if (!graph.nodes.length) return "";
  const label = (direction: GraphDirection): string =>
    direction === "both" ? "links both ways" : direction === "in" ? "links here" : "linked from here";

  return (
    `<section class="osp-rail-section osp-rail-graph">` +
    `<h2 class="osp-rail-title">Local graph<span class="osp-num">${graph.nodes.length}</span></h2>` +
    `<svg class="osp-graph" viewBox="0 0 ${graph.width} ${graph.height}" ` +
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
    `</ul>` +
    `</section>`
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
