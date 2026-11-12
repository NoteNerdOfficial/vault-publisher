/**
 * The site's stylesheet: structure here, looks in themes.ts.
 *
 * Every rule below is written against custom properties, never literal
 * colours or fonts, so a theme is a palette and a type pairing rather than a
 * second copy of this file. Changing a rule here changes every theme, which
 * is the point: the layout is the product, the themes are choices within it.
 *
 * Two bits are load-bearing and easy to delete by accident:
 *
 * `--font-mermaid` (set in themes.ts) is the one theme variable Obsidian's
 * serialized Mermaid SVGs still reference. Without it every diagram's text
 * falls back to the browser default while the rest of the page uses the site
 * font.
 *
 * `.osp-block-paragraph` is the class given to paragraphs rewritten as divs
 * to survive HTML reparsing. It has to carry the same vertical rhythm as a
 * real paragraph, or embeds and Bases blocks lose their spacing.
 */

import { getTheme, themeTokensCss } from "./themes";

const STRUCTURE_CSS = `* { box-sizing: border-box; }

/* Said once, loudly: a class that sets "display" outranks the browser's own
   rule for [hidden], and the shell hides the jump panel, the graph and the
   back control that way. */
[hidden] { display: none !important; }

body {
  margin: 0;
  background: var(--osp-bg);
  color: var(--osp-text);
  font-family: var(--osp-font-body);
  font-size: var(--osp-base-size);
  line-height: var(--osp-line-height);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

.osp-skip-link {
  position: absolute;
  left: -9999px;
}
.osp-skip-link:focus {
  left: var(--osp-gutter);
  top: var(--osp-gutter);
  z-index: 10;
  background: var(--osp-surface);
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
}

/* Checkboxes and other form controls Obsidian renders inside notes. */
.markdown-rendered input[type="checkbox"] { accent-color: var(--osp-accent); }

.osp-title {
  font-family: var(--osp-font-display);
  font-size: var(--osp-title-size);
  font-weight: var(--osp-title-weight);
  line-height: 1.12;
  letter-spacing: var(--osp-title-tracking);
  margin: 0 0 1.75rem;
  text-wrap: balance;
}

/* --- rendered note content ------------------------------------------- */

.markdown-rendered h1,
.markdown-rendered h2,
.markdown-rendered h3,
.markdown-rendered h4 {
  font-family: var(--osp-font-ui);
  line-height: 1.25;
  letter-spacing: -0.01em;
  margin: 2.5rem 0 0.75rem;
}
.markdown-rendered h1,
.markdown-rendered h2,
.markdown-rendered h3,
.markdown-rendered h4 {
  font-family: var(--osp-font-display);
  font-weight: var(--osp-heading-weight);
  letter-spacing: var(--osp-title-tracking);
  text-wrap: balance;
}
.markdown-rendered h1,
.markdown-rendered h2,
.markdown-rendered h3,
.markdown-rendered h4,
.markdown-rendered h5,
.markdown-rendered h6 {
  /* The bar and the crumb both stay on screen, so an anchor that scrolls a
     heading to the top of the viewport scrolls it underneath them. */
  scroll-margin-top: calc(var(--osp-bar-h) + var(--osp-crumb-h) + var(--osp-inpage-h) + 1.25rem);
}
.markdown-rendered h2 { font-size: 1.45rem; }
.markdown-rendered h3 { font-size: 1.15rem; }
.markdown-rendered h4 { font-size: 1rem; }

/* --- a heading is an address ----------------------------------------- *
 * The heading's own words are the link, which is what makes a right-click
 * anywhere on the heading offer "Copy link address" with nothing to aim at
 * first. They are not dressed as a link: a heading is where the reader
 * already is, so the words keep the heading's colour and the text cursor,
 * and the thing that looks pressable is the icon.
 *
 * The icon sits against the last word rather than out at the right edge of
 * the column, where a short heading leaves it far from anything that
 * explains it and easy to miss. It holds its space whether or not it is
 * showing, so revealing it moves no text -- a heading that reflowed under
 * the pointer would be a heading nobody could click -- and it travels with
 * the last word in a box that cannot break, so a heading that wraps cannot
 * strand it alone on a line.
 * --------------------------------------------------------------------- */

.markdown-rendered .osp-heading-self {
  color: inherit;
  text-decoration: none;
  cursor: text;
}

.markdown-rendered .osp-heading-tail {
  white-space: nowrap;
  /* The room the icon hangs in, reserved on the word rather than taken
     from the line: an inline box the height of this one would push every
     heading's line taller to make space for it, and a box the line does
     not know about costs nothing and moves nothing. */
  position: relative;
  padding-right: max(1.6rem, 1.4em);
}

.markdown-rendered .osp-heading-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* In the room the last word reserved, centred on that word's own text
     box rather than on the line, which on a heading of two lines is not
     where the word is. */
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  /* Sized against the heading rather than in absolute pixels: an icon
     that reads as a control beside 16 point text is a speck beside a
     section title, and the same glyph now has to work beside both. The
     floor keeps it from shrinking past being worth aiming at. */
  width: max(1.4rem, 1.2em);
  height: max(1.4rem, 1.2em);
  border-radius: max(4px, calc(var(--osp-radius) - 2px));
  color: var(--osp-text-muted);
  /* It is an anchor of its own on a heading that already holds a link. */
  text-decoration: none;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
}

.markdown-rendered [data-osp-anchored]:hover .osp-heading-link,
.markdown-rendered .osp-heading-self:focus-visible .osp-heading-link,
.markdown-rendered .osp-heading-link:focus-visible,
.markdown-rendered .osp-heading-link[data-osp-said] {
  opacity: 1;
}
.markdown-rendered .osp-heading-link:hover {
  background: var(--osp-hover);
  color: var(--osp-text);
}
.markdown-rendered .osp-heading-link:active { background: var(--osp-press); }

/* No pointer, no hover: a control revealed by something the device cannot
   do is a control that is not there. Quiet rather than hidden. */
@media (hover: none) {
  .markdown-rendered .osp-heading-link { opacity: 0.5; }
}

/* Bigger than the 14 pixels every other small icon on the site is: this
   one stands in a line of large type with nothing beside it to lend it a
   scale, and the site's small icon next to a heading looks like dust. */
.markdown-rendered .osp-heading-link .osp-icon-sm {
  width: max(15px, 0.8em);
  height: max(15px, 0.8em);
}

.markdown-rendered .osp-heading-icon-done { display: none; }
.markdown-rendered .osp-heading-link[data-osp-copied] { color: var(--osp-accent); }
.markdown-rendered .osp-heading-link[data-osp-copied] .osp-heading-icon-link { display: none; }
.markdown-rendered .osp-heading-link[data-osp-copied] .osp-heading-icon-done { display: inline; }

/* What the script says back, as a pseudo-element rather than an element:
   the overlay anchors a comment to a hash of its block's text, and a word
   added inside a heading would move every anchor on every commented
   heading.

   Above the icon rather than beside it. Beside it is where the heading has
   just run out of line: on a narrow window a heading that reaches the edge
   would push the reply off the page and the page into a sideways scroll
   for as long as it showed. Above, it is centred on a control that is
   itself well inside the column, and it has nowhere to overflow to. */
.markdown-rendered .osp-heading-link[data-osp-said]::after {
  content: attr(data-osp-said);
  position: absolute;
  left: 50%;
  bottom: calc(100% + 0.15rem);
  transform: translateX(-50%);
  padding: 0.12rem 0.4rem;
  border-radius: max(4px, calc(var(--osp-radius) - 2px));
  background: var(--osp-surface);
  /* It stands over whatever the heading has above it, so it is given an
     edge rather than left to blend into the line it covers. */
  box-shadow: 0 0 0 1px var(--osp-border);
  color: var(--osp-text-muted);
  font-family: var(--osp-font-ui);
  font-size: var(--osp-ui-xs);
  font-weight: 400;
  letter-spacing: 0;
  white-space: nowrap;
  pointer-events: none;
}
.markdown-rendered .osp-heading-link[data-osp-copied]::after {
  color: var(--osp-accent);
}

.markdown-rendered p,
.markdown-rendered .osp-block-paragraph {
  margin: 0 0 1.25rem;
}

.markdown-rendered a {
  color: var(--osp-link);
  text-underline-offset: 3px;
  text-decoration-thickness: var(--osp-link-underline);
  text-decoration-color: color-mix(in srgb, var(--osp-link) 35%, transparent);
}
.markdown-rendered a:hover {
  text-decoration-color: var(--osp-link);
}

/* A link to a note that was not published. Reads as a reference without
   pretending to be navigable. */
.osp-unresolved-link {
  color: var(--osp-text-muted);
  border-bottom: 1px dotted var(--osp-border);
  cursor: help;
}

/* An embed whose file could not be resolved. The reference was removed
   rather than published, so present the alt text as a caption would read
   instead of leaving a browser's broken-image icon. */
.osp-oversized-asset,
.osp-unresolved-asset {
  display: inline-block;
  color: var(--osp-text-muted);
  font-size: 0.875rem;
  font-style: italic;
}

.markdown-rendered ul,
.markdown-rendered ol { padding-left: 1.4rem; margin: 0 0 1.25rem; }
.markdown-rendered li { margin: 0.3rem 0; }
.markdown-rendered li::marker { color: var(--osp-text-muted); }
.markdown-rendered ol > li::marker { font-variant-numeric: tabular-nums; }
/* A list inside a list is part of the same thought: tighter, not another
   block. */
.markdown-rendered li > ul,
.markdown-rendered li > ol { margin: 0.3rem 0 0; }

.markdown-rendered blockquote {
  margin: 0 0 1.25rem;
  padding-left: 1.4rem;
  border-left: var(--osp-rule) solid var(--osp-border);
  color: var(--osp-text-muted);
}
.markdown-rendered blockquote > :last-child { margin-bottom: 0; }

/* --- code ------------------------------------------------------------ *
 * Inline code is set in the surface colour with a hairline, so it reads as a
 * token inside a sentence rather than a highlighted word.
 *
 * A block is a figure: a bar naming the language, over a region that scrolls
 * on its own and says so at its edge. The two controls in the bar are the
 * ones a reader reaches for -- wrap and copy -- and both ship hidden, so a
 * page without scripting shows the language and nothing that cannot work.
 * page.ts builds the markup; this only dresses it.
 * --------------------------------------------------------------------- */

.markdown-rendered code {
  font-family: var(--osp-font-mono);
  font-size: 0.875em;
  font-variant-ligatures: none;
  background: var(--osp-surface);
  border: 1px solid color-mix(in srgb, var(--osp-border) 65%, transparent);
  padding: 0.1em 0.33em;
  border-radius: max(2px, calc(var(--osp-radius) / 2));
}
/* A link or a heading sets the colour; code inside one does not argue. */
.markdown-rendered a code,
.markdown-rendered h1 code,
.markdown-rendered h2 code,
.markdown-rendered h3 code,
.markdown-rendered h4 code { color: inherit; font-size: 0.9em; }

/* A <pre> that escaped the figure: a Dataview placeholder, a diagram that
   never rendered. Still has to look like something. */
.markdown-rendered pre {
  background: var(--osp-surface);
  border: var(--osp-rule) solid var(--osp-border);
  border-radius: max(5px, var(--osp-radius));
  padding: 1rem 1.1rem;
  overflow-x: auto;
  margin: 0 0 1.25rem;
  font-size: 0.875rem;
  line-height: 1.6;
}
.markdown-rendered pre code {
  background: none;
  border: 0;
  padding: 0;
  font-size: 1em;
}

.markdown-rendered .osp-code {
  margin: 0 0 1.5rem;
  border: var(--osp-rule) solid var(--osp-border);
  border-radius: max(5px, var(--osp-radius));
  background: var(--osp-surface);
  /* The bar sits on the block's own corner radius. */
  overflow: hidden;
}

.markdown-rendered .osp-code pre {
  margin: 0;
  border: 0;
  border-radius: 0;
  background: none;
  padding: 0.9rem 1.05rem;
  tab-size: 2;
}

.osp-code-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 2.15rem;
  padding: 0.25rem 0.35rem 0.25rem 1.05rem;
  background: color-mix(in srgb, var(--osp-text) 3.5%, transparent);
  border-bottom: var(--osp-rule) solid color-mix(in srgb, var(--osp-border) 70%, transparent);
}

.osp-code-lang {
  font-family: var(--osp-font-mono);
  font-size: var(--osp-ui-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--osp-text-muted);
}

/* Quiet by colour rather than by opacity: faded label text stops meeting
   contrast, and a control nobody can read is not restraint. */
.osp-code-tools {
  display: flex;
  align-items: center;
  gap: 0.1rem;
}

.osp-code-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: var(--osp-font-ui);
  font-size: var(--osp-ui-xs);
  color: var(--osp-text-muted);
  background: transparent;
  border: 0;
  border-radius: max(4px, calc(var(--osp-radius) - 2px));
  padding: 0.32rem 0.5rem;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.osp-code-btn:hover { background: var(--osp-hover); color: var(--osp-text); }
.osp-code-btn:active { background: var(--osp-press); }
.osp-code-btn[aria-pressed="true"] { background: var(--osp-selected); color: var(--osp-text); }

/* The wrap control is offered when there is something to wrap, and stays
   while it is on -- turning it off is the way back. */
.osp-code:not([data-osp-overflow]) [data-osp-wrap][aria-pressed="false"] { display: none; }

.osp-code-icon-done { display: none; }
.osp-code-btn[data-osp-copied] { color: var(--osp-accent); }
.osp-code-btn[data-osp-copied] .osp-code-icon-copy { display: none; }
.osp-code-btn[data-osp-copied] .osp-code-icon-done { display: inline; }

.osp-code[data-osp-wrapped="on"] pre code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* --- syntax ---------------------------------------------------------- *
 * Obsidian runs Prism over every fenced block and ships the token spans in
 * the HTML. None of its colours are harvested, so until these rules existed
 * a highlighted block published as plain text with the markup still in it.
 *
 * Five roles, not a syntax theme: what is not code (comments), what holds
 * the code together (punctuation), what the language reserves (keywords),
 * and the two kinds of literal a reader scans for. Each theme names its own
 * five, so a block belongs to the page rather than to an editor.
 * --------------------------------------------------------------------- */

.osp-code .token.comment,
.osp-code .token.prolog,
.osp-code .token.doctype,
.osp-code .token.cdata {
  color: var(--osp-code-comment);
  font-style: italic;
}
.osp-code .token.punctuation,
.osp-code .token.operator { color: var(--osp-code-punct); }
.osp-code .token.keyword,
.osp-code .token.atrule,
.osp-code .token.rule,
.osp-code .token.important,
.osp-code .token.boolean,
.osp-code .token.constant {
  color: var(--osp-code-keyword);
}
.osp-code .token.string,
.osp-code .token.char,
.osp-code .token.attr-value,
.osp-code .token.regex,
.osp-code .token.inserted {
  color: var(--osp-code-string);
}
.osp-code .token.number,
.osp-code .token.symbol,
.osp-code .token.deleted {
  color: var(--osp-code-number);
}
/* Names stay in the text colour: a block where everything is coloured is a
   block where nothing stands out. Weight is enough to find a definition. */
.osp-code .token.function,
.osp-code .token.class-name,
.osp-code .token.selector,
.osp-code .token.tag { font-weight: 600; }
.osp-code .token.attr-name,
.osp-code .token.property,
.osp-code .token.builtin,
.osp-code .token.variable { color: var(--osp-text); }
/* Prism marks the whole line; the colour it carries is not ours to keep. */
.osp-code .token.italic { font-style: italic; }
.osp-code .token.bold { font-weight: 700; }

/* --- a region that scrolls, and says so ------------------------------ *
 * A line wider than the column is the one piece of a page that can hide
 * content with no sign of it. The edge it can scroll towards is faded, both
 * edges in the middle, and neither once there is nothing more that way: the
 * fade is state, not decoration. clientScript.ts keeps data-osp-at.
 * --------------------------------------------------------------------- */

.osp-scroller { --osp-fade: 2.25rem; }
.osp-scroller[data-osp-at="start"] {
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - var(--osp-fade)), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - var(--osp-fade)), transparent);
}
.osp-scroller[data-osp-at="middle"] {
  -webkit-mask-image: linear-gradient(to right, transparent, #000 var(--osp-fade),
    #000 calc(100% - var(--osp-fade)), transparent);
  mask-image: linear-gradient(to right, transparent, #000 var(--osp-fade),
    #000 calc(100% - var(--osp-fade)), transparent);
}
.osp-scroller[data-osp-at="end"] {
  -webkit-mask-image: linear-gradient(to right, transparent, #000 var(--osp-fade));
  mask-image: linear-gradient(to right, transparent, #000 var(--osp-fade));
}

/* Obsidian's own copy button is removed in page.ts, not hidden. This is the
   belt to that pair of braces. */
.markdown-rendered .copy-code-button { display: none; }

/* Frontmatter is rendered hidden by Obsidian, and must stay hidden. */
.markdown-rendered .frontmatter,
.markdown-rendered .frontmatter-container { display: none; }

/* --- tables ---------------------------------------------------------- *
 * The wrapper scrolls, not the table: a table told to display: block stops
 * laying out as one, and a two-column table stops filling the measure.
 * --------------------------------------------------------------------- */

.markdown-rendered .osp-table-wrap {
  margin: 0 0 1.5rem;
  overflow-x: auto;
  /* Sized by the table, not by the column it sits in: a two-column table of
     short strings stretched to the full measure strands its last column in
     the middle of an empty row. Past the measure it scrolls, which is the
     only place a table is allowed to be wider than the text. */
  width: fit-content;
  max-width: 100%;
}

/* Every rule below is written through .osp-table-wrap, which prepareTables
   puts around every table. Two classes, where a plugin's table CSS reaches
   for one class and a chain of elements -- so a Dataview or Bases result is
   styled by this page rather than by whoever generated it. */

.markdown-rendered .osp-table-wrap table {
  /* auto, so the wrapper's fit-content has a natural width to measure. */
  width: auto;
  min-width: 0;
  border-collapse: collapse;
  font-family: var(--osp-font-ui);
  font-size: 0.875rem;
  margin: 0;
}
.markdown-rendered .osp-table-wrap th,
.markdown-rendered .osp-table-wrap td {
  text-align: left;
  /* Padding on the trailing edge only, so the first column keeps the text
     measure's own left edge and the table reads as part of the page. */
  padding: 0.55rem 1.1rem 0.55rem 0;
  vertical-align: top;
}
.markdown-rendered .osp-table-wrap th:last-child,
.markdown-rendered .osp-table-wrap td:last-child { padding-right: 0; }
.markdown-rendered .osp-table-wrap thead th {
  font-weight: 650;
  font-size: var(--osp-ui-xs);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--osp-text-muted);
  white-space: nowrap;
  padding-top: 0;
  border-bottom: var(--osp-rule) solid var(--osp-border);
}
.markdown-rendered .osp-table-wrap tbody td {
  border-bottom: var(--osp-rule) solid var(--osp-faint);
}
.markdown-rendered .osp-table-wrap tbody tr:last-child td { border-bottom: 0; }
.markdown-rendered .osp-table-wrap tbody tr:hover td {
  background: var(--osp-hover);
  transition: background 90ms ease;
}

/* A plugin builds its cells out of paragraphs, and a paragraph on this page
   carries a paragraph's bottom margin. Left alone, every Dataview row is
   twenty pixels taller than the text in it. */
.markdown-rendered .osp-table-wrap td p { margin: 0 0 0.4rem; }
.markdown-rendered .osp-table-wrap td p:last-child { margin-bottom: 0; }
.markdown-rendered .osp-table-wrap td ul,
.markdown-rendered .osp-table-wrap td ol { margin: 0; padding-left: 1.1rem; }

/* A header cell holds a paragraph too, and under it Dataview puts the
   number of results it found. Both belong on the header's one line. */
.markdown-rendered .osp-table-wrap th p,
.markdown-rendered .osp-table-wrap th span { display: inline; margin: 0; }
.markdown-rendered .osp-table-wrap th .dataview.small-text {
  margin-left: 0.3rem;
  font-size: inherit;
  color: var(--osp-text-muted);
  font-variant-numeric: tabular-nums;
}

/* Numbers line up on their last digit and share one width, so a column can
   be compared down rather than read across. prepareTables decides which
   columns those are. */
.markdown-rendered .osp-table-wrap th[data-osp-num],
.markdown-rendered .osp-table-wrap td[data-osp-num] {
  text-align: right;
  font-variant-numeric: tabular-nums;
  padding-left: 1.4rem;
}

.markdown-rendered .callout {
  background: var(--osp-tint);
  border: 1px solid color-mix(in srgb, var(--osp-accent) 22%, transparent);
  border-radius: max(5px, var(--osp-radius));
  padding: 0.85rem 1.05rem;
  margin: 0 0 1.25rem;
  font-family: var(--osp-font-ui);
  font-size: 0.9375rem;
}
.markdown-rendered .callout-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 650;
  margin-bottom: 0.35rem;
  color: color-mix(in srgb, var(--osp-accent) 78%, var(--osp-text));
}
.markdown-rendered .callout-title-inner { font-weight: 600; }
.markdown-rendered .callout-content > :last-child { margin-bottom: 0; }
/* A collapsed callout would publish with its body hidden and no way to open
   it, so published callouts are always expanded. */
.markdown-rendered .callout-content[hidden] { display: none; }
.markdown-rendered .osp-callout-toggle {
  display: flex;
  align-items: center;
  margin-left: auto;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.markdown-rendered .osp-callout-toggle:hover { color: var(--osp-text); }

.markdown-rendered .osp-datacore-error,
.markdown-rendered .osp-static-control {
  color: var(--osp-text-muted);
  font-family: var(--osp-font-ui);
  font-size: 0.875rem;
  font-style: italic;
}

.markdown-rendered .task-list-item { list-style: none; }
.markdown-rendered .task-list-item input { margin-right: 0.5rem; }
.markdown-rendered .task-list-item.is-checked {
  color: var(--osp-text-muted);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--osp-text-muted) 45%, transparent);
}
/* The strike belongs to the task, not to whatever hangs below it. */
.markdown-rendered .task-list-item.is-checked ul,
.markdown-rendered .task-list-item.is-checked ol {
  color: var(--osp-text);
  text-decoration: none;
}

.markdown-rendered mjx-container {
  max-width: 100%;
}

/* Obsidian scopes its MathJax font assignment to breakable (inline) math.
   Display math has no 'breakable' attribute, so give its glyph nodes the same
   MathJax fonts or fractions and large operators fall back to serif fonts. */
.markdown-rendered mjx-container[jax="CHTML"] > mjx-math.TEX-N > * {
  font-family: MJX-TEX-ZERO, MJX-TEX-N;
}

.markdown-rendered img {
  max-width: 100%;
  height: auto;
  border-radius: max(3px, var(--osp-radius));
}

/* --- the smaller marks ----------------------------------------------- *
 * A divider, a highlight, a key, a deletion, an abbreviation. Each one ships
 * with a browser default that belongs to no design system: <hr> is an inset
 * 3D groove, <mark> is Canary yellow. Four rules buy all of them back.
 * --------------------------------------------------------------------- */

.markdown-rendered hr {
  height: 0;
  border: 0;
  border-top: var(--osp-rule) solid var(--osp-border);
  margin: 2.75rem 0;
}

.markdown-rendered mark {
  background: color-mix(in srgb, var(--osp-accent) 18%, transparent);
  color: inherit;
  padding: 0.05em 0.2em;
  border-radius: 2px;
}

.markdown-rendered kbd {
  font-family: var(--osp-font-mono);
  font-size: 0.8em;
  padding: 0.12em 0.4em;
  background: var(--osp-bg);
  border: 1px solid var(--osp-border);
  border-bottom-width: 2px;
  border-radius: 4px;
}

.markdown-rendered del {
  color: var(--osp-text-muted);
  text-decoration-color: color-mix(in srgb, var(--osp-text-muted) 55%, transparent);
}

.markdown-rendered abbr[title] {
  text-decoration: underline dotted;
  text-underline-offset: 2px;
  cursor: help;
}

/* Superscripts stretch the line they sit on unless they are taken out of
   the leading. A note with footnotes is otherwise set in two rhythms. */
.markdown-rendered sup,
.markdown-rendered sub { line-height: 0; font-size: 0.75em; }

/* --- footnotes ------------------------------------------------------- */

/* Obsidian opens the section with its own <hr>, and the section already
   carries a rule: published, that was two lines with a gap between them. */
.markdown-rendered .footnotes > hr { display: none; }
.markdown-rendered .footnotes {
  margin-top: 3rem;
  padding-top: 1.25rem;
  border-top: var(--osp-rule) solid var(--osp-border);
  font-size: 0.9375rem;
  color: var(--osp-text-muted);
}
.markdown-rendered .footnotes ol { padding-left: 1.1rem; }
.markdown-rendered .footnotes li { margin: 0.5rem 0; }
.markdown-rendered .footnotes p { margin: 0; display: inline; }
.markdown-rendered .footnote-backref {
  margin-left: 0.4rem;
  text-decoration: none;
  color: var(--osp-text-muted);
}
.markdown-rendered .footnote-backref:hover { color: var(--osp-link); }
.markdown-rendered .footnote-ref a { text-decoration: none; }

/* --- diagrams -------------------------------------------------------- *
 * Two renderers, which colour themselves in two different ways.
 *
 * Classic Mermaid ships its geometry and its palette together, scoped to
 * the diagram's own id. The palette is taken out at build time, so what
 * arrives here is shape, stroke width and dash pattern with no colour at
 * all, and the rules below are the page deciding what it looks like.
 *
 * Obsidian's own renderer (svg.pele) does the opposite: it paints from
 * custom properties and holds no literal colours at all, which is why
 * neutralizeMermaidColours passes over it -- there is nothing literal in
 * it to take out. It emits fill="var(--pele-surface,#f3f3f3)", and the
 * harvested app stylesheet maps --pele-* onto --mermaid-*, which it
 * maps in turn onto --text-normal, --background-primary and the rest
 * of the app's own namespace -- none of which exists on a published page.
 * So every one of those chains collapsed to the light fallback baked into
 * the attribute, and a dark site got light boxes. Text was the half that
 * *did* get themed, by the blanket rule at the end of this section, which
 * is what made it unreadable rather than merely wrong: on a dark page the
 * labels came out near-white on near-white.
 *
 * Shape selectors are qualified by element -- rect.actor, not .actor --
 * because Mermaid puts the same class on a box and on the text inside it,
 * and a label painted with the box fill is a label nobody can read.
 * --------------------------------------------------------------------- */

/* The palette Obsidian's renderer paints from, answered in the site's own
   terms so that a diagram tracks the theme and the light/dark switch for
   free -- every value here resolves through --osp-*, which is already
   redeclared for dark.

   On body rather than on :root because the harvested stylesheet
   declares the same names on body, and a declaration on the element
   beats one inherited from its parent: at :root this would be shadowed
   and change nothing. assets/site.css is linked after
   assets/obsidian.css, so at equal specificity these win.

   Both namespaces are set deliberately. --mermaid-* is what the
   harvested mapping reads; --pele-* is what the SVG itself reads, and
   setting it directly is what keeps a diagram themed on a build whose CSS
   harvest came back empty.

   The categorical series colours are left out on purpose. They are a
   diagram's data rather than its furniture, the renderer's own defaults
   are saturated enough to read on either background, and inventing eight
   of them per theme is a palette decision this file should not be making
   on its own. Unset, they fall back to those defaults. */
body {
  --mermaid-background: var(--osp-bg);
  --mermaid-text-color: var(--osp-text);
  --mermaid-muted-color: var(--osp-text-muted);
  --mermaid-line-color: var(--osp-dgm-line);
  --mermaid-surface: var(--osp-dgm-fill);
  --mermaid-surface-alt: var(--osp-dgm-note);
  --mermaid-border-color: var(--osp-dgm-stroke);
  --mermaid-accent: var(--osp-accent);
  --mermaid-radius: var(--osp-radius);

  --pele-bg: var(--osp-bg);
  --pele-fg: var(--osp-text);
  --pele-muted: var(--osp-text-muted);
  --pele-line: var(--osp-dgm-line);
  --pele-surface: var(--osp-dgm-fill);
  --pele-surface-alt: var(--osp-dgm-note);
  --pele-border: var(--osp-dgm-stroke);
  --pele-accent: var(--osp-accent);
  --pele-radius: var(--osp-radius);
}

.markdown-rendered .mermaid-wrapper,
.markdown-rendered .mermaid { margin: 0 0 1.5rem; text-align: center; }
.markdown-rendered .mermaid svg { max-width: 100%; height: auto; }

/* --- diagrams: zoom and full screen ---------------------------------- *
 * The controls appear when a diagram is pointed at or focused, and stay
 * on a screen that cannot hover. A diagram at its normal size lets a touch
 * scroll the page; a zoomed one takes the touch for itself, to pan. */
.markdown-rendered .mermaid[data-osp-diagram] {
  position: relative;
  overflow: hidden;
  touch-action: pan-x pan-y;
}
.markdown-rendered .mermaid[data-osp-zoomed] { touch-action: none; cursor: grab; }
.markdown-rendered .mermaid[data-osp-panning],
.osp-diagram-stage[data-osp-panning] { cursor: grabbing; }
.osp-diagram-canvas { transform-origin: 0 0; }

.osp-diagram-tools {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--osp-bg);
  border: 1px solid var(--osp-border);
  border-radius: var(--osp-radius);
  opacity: 0;
  transition: opacity 120ms ease;
  z-index: 1;
}
.markdown-rendered .mermaid[data-osp-diagram]:hover .osp-diagram-tools,
.markdown-rendered .mermaid[data-osp-diagram]:focus-within .osp-diagram-tools,
.markdown-rendered .mermaid[data-osp-zoomed] .osp-diagram-tools { opacity: 1; }
@media (hover: none) {
  .osp-diagram-tools { opacity: 1; }
}

.osp-diagram-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--osp-text-muted);
  background: transparent;
  border: 0;
  border-radius: max(4px, calc(var(--osp-radius) - 2px));
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.osp-diagram-btn:hover { background: var(--osp-hover); color: var(--osp-text); }
.osp-diagram-btn:active { background: var(--osp-press); }

/* Full screen: the page is out of the way, so the wheel zooms and a drag
   pans without asking. Above the site's own layers. */
.osp-diagram-viewer {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  background: var(--osp-bg);
}
.osp-diagram-stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  touch-action: none;
  cursor: grab;
}
.osp-diagram-stage .mermaid { margin: 0; }
.osp-diagram-viewer .osp-diagram-tools {
  position: fixed;
  top: 1rem;
  right: 1rem;
  opacity: 1;
}
:root[data-osp-viewing] body { overflow: hidden; }

.markdown-rendered .mermaid rect.actor,
.markdown-rendered .mermaid rect.labelBox,
.markdown-rendered .mermaid .node rect,
.markdown-rendered .mermaid .node circle,
.markdown-rendered .mermaid .node ellipse,
.markdown-rendered .mermaid .node polygon,
.markdown-rendered .mermaid .node path,
.markdown-rendered .mermaid .classGroup rect,
.markdown-rendered .mermaid .statediagram-state rect,
.markdown-rendered .mermaid rect.entityBox {
  fill: var(--osp-dgm-fill);
  stroke: var(--osp-dgm-stroke);
}

.markdown-rendered .mermaid .edgePath .path,
.markdown-rendered .mermaid .flowchart-link,
.markdown-rendered .mermaid .relation,
.markdown-rendered .mermaid .transition,
.markdown-rendered .mermaid .messageLine0,
.markdown-rendered .mermaid .messageLine1,
.markdown-rendered .mermaid .loopLine,
.markdown-rendered .mermaid .relationshipLine,
.markdown-rendered .mermaid line {
  stroke: var(--osp-dgm-line);
  fill: none;
}

.markdown-rendered .mermaid .marker,
.markdown-rendered .mermaid marker path,
.markdown-rendered .mermaid defs path {
  fill: var(--osp-dgm-line);
  stroke: var(--osp-dgm-line);
}

/* A note and an activation are the two things in a diagram that are not
   the diagram: they carry a little more of the accent to say so. */
.markdown-rendered .mermaid rect.note,
.markdown-rendered .mermaid .note rect {
  fill: var(--osp-dgm-note);
  stroke: var(--osp-dgm-stroke);
}
.markdown-rendered .mermaid .activation0,
.markdown-rendered .mermaid .activation1,
.markdown-rendered .mermaid .activation2 {
  fill: var(--osp-dgm-cluster);
  stroke: var(--osp-dgm-stroke);
}
.markdown-rendered .mermaid .cluster rect,
.markdown-rendered .mermaid .statediagram-cluster rect {
  fill: var(--osp-dgm-cluster);
  stroke: var(--osp-border);
}
.markdown-rendered .mermaid .divider { stroke: var(--osp-border); }

/* A label on an edge sits on top of the line, so it needs the page behind
   it rather than a colour of its own. */
.markdown-rendered .mermaid .edgeLabel rect,
.markdown-rendered .mermaid rect.labelBkg,
.markdown-rendered .mermaid .labelBkg {
  fill: var(--osp-bg);
  background: var(--osp-bg);
}

/* Last, and wider than the shapes: whatever a diagram writes, it writes in
   the page's text colour.

   Classic Mermaid only. svg.pele is excluded because it has already been
   told what the page's text colour is, above, and because it uses the fill
   of a label to mean something: a pie chart paints its slice labels in the
   *background* colour so they read against a saturated wedge. Painting
   those with the text colour instead is how a blanket rule turns one
   renderer's readable diagram into another's unreadable one -- which is
   the bug this exclusion exists to not reintroduce. */
.markdown-rendered .mermaid svg:not(.pele) text,
.markdown-rendered .mermaid svg:not(.pele) tspan,
.markdown-rendered .mermaid svg:not(.pele) .label,
.markdown-rendered .mermaid svg:not(.pele) .nodeLabel,
.markdown-rendered .mermaid svg:not(.pele) .edgeLabel,
.markdown-rendered .mermaid svg:not(.pele) foreignObject div,
.markdown-rendered .mermaid svg:not(.pele) span {
  fill: var(--osp-text);
  color: var(--osp-text);
}

/* A guarded diagram means Mermaid was never allowed in the vault. It should
   not have been published, so make it unmissable rather than silent. */
.markdown-rendered .mermaid-wrapper.is-guarded {
  border: 1px dashed var(--osp-accent);
  padding: 1rem;
  font-family: var(--osp-font-ui);
  font-size: 0.875rem;
  color: var(--osp-text-muted);
}

/* Dataview and Bases inherit the table styling above; these only remove the
   interactive affordances that no longer work. */
.markdown-rendered .bases-toolbar,
.markdown-rendered .bases-view-settings { display: none; }

/* A plugin builds its list rows out of paragraphs, and a paragraph is a
   block: without this the task text lands under its checkbox rather than
   beside it. The hover cursor goes with it -- nothing here is clickable. */
.markdown-rendered .task-list-item p { display: inline; margin: 0; }
.markdown-rendered .dataview.task-list-item,
.markdown-rendered .dataview.task-list-item:hover { cursor: default; }

/* A query that found nothing. Obsidian shows that as a 150px dashed box in
   the middle of the note, which on a page that cannot be queried reads as a
   broken element. Here it is one line, in the note's own voice, left where
   the results would have been. */
.markdown-rendered .dataview-error-box {
  display: block;
  min-height: 0;
  padding: 0;
  border: 0;
}
.markdown-rendered .dataview-error-message {
  text-align: left;
  font-family: var(--osp-font-ui);
  font-size: 0.875rem;
  font-style: italic;
  color: var(--osp-text-muted);
}
.markdown-rendered .internal-embed,
.markdown-rendered .markdown-embed {
  display: block;
  border-left: var(--osp-rule) solid var(--osp-border);
  padding-left: 1.4rem;
  margin: 0 0 1.25rem;
}
.markdown-rendered .markdown-embed-title { display: none; }

/* An embedded picture is not a quotation. The rule above says "this came
   from somewhere else", which is right for a note and noise beside an
   image. */
.markdown-rendered .internal-embed.image-embed,
.markdown-rendered .internal-embed.media-embed {
  border-left: 0;
  padding-left: 0;
}

/* --- bases ----------------------------------------------------------- */

/* Our own markup, re-emitted from the Bases DOM, so none of this inherits
   Obsidian's measured pixel geometry. The table is allowed to exceed the
   text measure, because a six-column table squeezed into a reading column is
   worse than one that scrolls. */

.markdown-rendered .osp-base {
  margin: 0 0 1.75rem;
  max-width: 100%;
}

.markdown-rendered .osp-base-name {
  font-family: var(--osp-font-ui);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--osp-text-muted);
  margin-bottom: 0.5rem;
}

.markdown-rendered .osp-base-table {
  border-collapse: collapse;
  width: 100%;
  font-family: var(--osp-font-ui);
  font-size: 0.875rem;
}

/* A base table is a table: everything above it -- the head, the rules, the
   numeric columns prepareTables found -- already applies. What is left is
   the one thing a base has and a markdown table does not: a name. */

.markdown-rendered .osp-base-cards {
  /* list-style and padding are reset explicitly: a <ul> inside
     .markdown-rendered otherwise keeps Obsidian's bullets and indent, which
     is how the first attempt at this rendered a card grid as a bullet list. */
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 1rem;
}

.markdown-rendered .osp-base-cards > li::marker { content: none; }

.markdown-rendered .osp-base-card {
  border: var(--osp-rule) solid var(--osp-border);
  border-radius: var(--osp-radius);
  padding: 1rem;
}

.markdown-rendered .osp-base-card-title {
  font-family: var(--osp-font-ui);
  font-size: 0.95rem;
  font-weight: 650;
  margin: 0 0 0.6rem;
}

.markdown-rendered .osp-base-card-fields {
  margin: 0;
  font-family: var(--osp-font-ui);
  font-size: 0.8rem;
}

.markdown-rendered .osp-base-card-fields dt {
  color: var(--osp-text-muted);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.markdown-rendered .osp-base-card-fields dd {
  /* margin-inline-start kills the browser's default <dd> indent. */
  margin: 0 0 0.6rem;
  margin-inline-start: 0;
}

.markdown-rendered .osp-base-card-fields dd:last-child { margin-bottom: 0; }

/* A base that failed to evaluate. Shown rather than swallowed: a reader
   seeing nothing cannot tell an empty result from a broken query. */
.markdown-rendered .osp-base-error {
  font-family: var(--osp-font-ui);
  font-size: 0.8rem;
  color: var(--osp-text-muted);
  border-left: 2px solid var(--osp-border);
  padding-left: 0.75rem;
  margin: 0.5rem 0 0;
}

/* A view showing fewer rows than it found. Quieter than an error, because it
   is not one, but it has to be visible: a partial table that says nothing is
   indistinguishable from a complete one. The same goes for an empty result
   and for a view type the site cannot show. */
.markdown-rendered .osp-base-truncated,
.markdown-rendered .osp-base-empty,
.markdown-rendered .osp-base-unsupported-note {
  font-family: var(--osp-font-ui);
  font-size: 0.78rem;
  color: var(--osp-text-muted);
  margin: 0.5rem 0 0;
}

/* --- shell ----------------------------------------------------------- *
 * Command bar, vault panel, note, context rail. The note scrolls with the
 * document and the panels are sticky: a published page is read in a browser,
 * where the page scrollbar, find-in-page and anchor links all belong to the
 * window, and an app-style pane that scrolls on its own quietly breaks all
 * three.
 * --------------------------------------------------------------------- */

:root {
  --osp-bar-h: 3rem;
  --osp-crumb-h: 2.5rem;
  /* The in-page menu exists only below 56rem. Zero everywhere else, because
     every heading's scroll-margin is built from the sum of the sticky rows
     above it and a term that is sometimes absent has to be a number. */
  --osp-inpage-h: 0rem;
  --osp-panel-w: 17rem;
  --osp-rail-w: 19rem;
  /* The field at rest and the field being typed into, and with it the
     width of the panel that drops out of it -- one number for both, because
     a dropdown a few pixels off the box it belongs to is the detail that
     makes the pair read as two things instead of one.

     Both are clamped against the window rather than fixed: the centre
     column may not grow so far that the brand on one side and the controls
     on the other have nowhere to be. 14rem is those two plus the gaps. */
  --osp-search-w: min(24rem, calc(100vw - 20rem));
  /* The open width is also the width of the bar's middle track, which the
     field floats over rather than occupies -- so it is the number that
     decides how much room the name and the controls keep. 26rem is both of
     them with air, which is why the clamp is so much larger than the field
     itself needs. */
  --osp-search-w-open: min(36rem, calc(100vw - 26rem));
  /* How far the field drops out of the bar when it is being typed into.
     Enough to clear the bar and the rule under it with air to spare, so
     the field is plainly no longer part of the row it came from -- and not
     so far that it loses the place the reader just clicked. */
  --osp-search-drop: 4rem;
  --osp-hover: color-mix(in srgb, var(--osp-text) 6%, transparent);
  --osp-press: color-mix(in srgb, var(--osp-text) 11%, transparent);
  --osp-selected: color-mix(in srgb, var(--osp-accent) 15%, transparent);
  --osp-faint: color-mix(in srgb, var(--osp-border) 60%, transparent);
  --osp-tint: color-mix(in srgb, var(--osp-accent) 8%, transparent);
  /* Diagrams. Mermaid's own palette is removed from the SVG at build time
     (neutralizeMermaidColours in page.ts), so these are the only colours a
     diagram has. Mixed from the theme rather than named per theme: a
     diagram is the page's furniture, not a picture with a palette. */
  --osp-dgm-fill: color-mix(in srgb, var(--osp-accent) 9%, var(--osp-surface));
  --osp-dgm-stroke: color-mix(in srgb, var(--osp-accent) 50%, var(--osp-border));
  --osp-dgm-note: color-mix(in srgb, var(--osp-accent) 17%, var(--osp-surface));
  --osp-dgm-cluster: color-mix(in srgb, var(--osp-text) 4%, transparent);
  --osp-dgm-line: var(--osp-text-muted);
  --osp-ui-xs: 0.6875rem;
  --osp-ui-sm: 0.75rem;
  --osp-ui-md: 0.8125rem;
  --osp-ui-lg: 0.875rem;
  --osp-ease: cubic-bezier(0.16, 1, 0.3, 1);
}

/* The surfaces the browser draws still belong to the theme. */
::selection { background: var(--osp-selected); }
:root { accent-color: var(--osp-accent); caret-color: var(--osp-accent); }
:focus-visible { outline: 2px solid var(--osp-accent); outline-offset: 2px; border-radius: 3px; }

.osp-scroll { scrollbar-width: thin; scrollbar-color: var(--osp-border) transparent; }
.osp-scroll::-webkit-scrollbar { width: 11px; }
.osp-scroll::-webkit-scrollbar-thumb {
  background: var(--osp-border);
  border: 3.5px solid transparent;
  background-clip: content-box;
  border-radius: 99px;
}
.osp-scroll::-webkit-scrollbar-thumb:hover { background-clip: padding-box; }

.osp-num { font-variant-numeric: tabular-nums; }

.osp-shell {
  display: grid;
  grid-template-columns: var(--osp-panel-w) minmax(0, 1fr) var(--osp-rail-w);
  grid-template-areas: "bar bar bar" "panel main rail";
  align-items: start;
  min-height: 100vh;
  min-height: 100dvh;
}

.osp-icon { width: 16px; height: 16px; flex: none; stroke-width: 1.75; }
.osp-icon-sm { width: 14px; height: 14px; flex: none; stroke-width: 1.75; }

/* --- command bar ----------------------------------------------------- */

.osp-bar {
  grid-area: bar;
  position: sticky;
  top: 0;
  /* Above the scrim, which matters less than it sounds: while the search is
     open the bar gives up its background and its rule, so what is painted
     at this level is the field and two faded labels. The bar is still on
     top; there is just almost nothing left of it. */
  z-index: 30;
  display: grid;
  /* Equal fractions either side of a constant middle. The middle track is
     empty -- the field floats over it, out of flow -- and it is held at
     the field's *open* width at all times.

     This is a correctness change, not a speed one. A track sized to the
     field meant the bar rearranged itself every time someone clicked into
     a search box: the two fractions re-resolved and the brand gave up
     characters to its ellipsis, because of where the caret was. Nothing
     outside the field should move when the field is focused.

     It was worth measuring whether it was also faster, and it is not: in
     flow and out of flow both run at a 17ms median with the p95 inside a
     frame of each other. The layout is too small to cost anything. Keep
     the arrangement for the stability, and do not reintroduce the old one
     believing you are undoing an optimisation. */
  grid-template-columns: minmax(0, 1fr) var(--osp-search-w-open) minmax(0, 1fr);
  align-items: center;
  gap: 1rem;
  height: var(--osp-bar-h);
  /* Full-bleed and sticky, so on a notched phone held sideways this is the
     row the cutout lands in. The insets are zero everywhere else. */
  padding: 0 max(0.75rem, env(safe-area-inset-right)) 0 max(0.75rem, env(safe-area-inset-left));
  background: var(--osp-surface);
  border-bottom: var(--osp-rule) solid var(--osp-border);
  transition:
    background 160ms var(--osp-ease),
    border-color 160ms var(--osp-ease);
}

.osp-brand {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.25rem 0.5rem;
  border-radius: max(5px, var(--osp-radius));
  font-family: var(--osp-font-ui);
  font-size: var(--osp-ui-lg);
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--osp-text);
  text-decoration: none;
}
.osp-brand:hover { background: var(--osp-hover); }
.osp-brand, .osp-bar-actions { transition: opacity 160ms var(--osp-ease); }
.osp-mark {
  width: 1.45rem;
  height: 1.45rem;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: max(5px, var(--osp-radius));
  background: var(--osp-accent);
  color: var(--osp-bg);
  font-size: var(--osp-ui-xs);
  font-weight: 700;
}
.osp-brand-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.osp-bar .osp-brand { grid-column: 1; justify-self: start; min-width: 0; }
.osp-bar-actions {
  grid-column: 3;
  justify-self: end;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* --- the link out to the repository ----------------------------------- *
 * The one control in the bar that carries a word, because it is the one
 * whose glyph does not say where it goes: a mark says which service, and
 * only the word says that this leads to the site's own source rather than
 * to the thing that built it.
 *
 * Its height is deliberately not a number. It has to match the read/markdown
 * toggle a row below -- the two are the nearest pair of boxed controls on
 * screen, and a few pixels out between them reads as a mistake rather than
 * as a difference -- and that height is nowhere written down: it is the
 * seg's own padding, plus the padding of the button inside it, plus the rule
 * around the pair. So it is built here as the same sum. Any of the three can
 * move and both controls move with it; a measured total would have to be
 * measured again, by somebody who did not know they had to.
 * --------------------------------------------------------------------- */
.osp-bar-source {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: calc(0.13rem + 0.2rem) calc(0.13rem + 0.45rem);
  border: var(--osp-rule) solid var(--osp-border);
  border-radius: max(6px, calc(var(--osp-radius) + 1px));
  background: var(--osp-surface);
  color: var(--osp-text-muted);
  font-family: var(--osp-font-ui);
  font-size: var(--osp-ui-xs);
  line-height: 1.4;
  white-space: nowrap;
  text-decoration: none;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.osp-bar-source:hover {
  background: var(--osp-hover);
  border-color: var(--osp-accent);
  color: var(--osp-text);
}
.osp-bar-source:active { background: var(--osp-press); }

.osp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  font: inherit;
  font-family: var(--osp-font-ui);
  font-size: var(--osp-ui-md);
  color: var(--osp-text-muted);
  background: transparent;
  border: 0;
  border-radius: max(4px, var(--osp-radius));
  padding: 0.35rem 0.5rem;
  cursor: pointer;
  text-decoration: none;
  transition: background 120ms ease, color 120ms ease;
}
.osp-btn:hover { background: var(--osp-hover); color: var(--osp-text); }
.osp-btn:active { background: var(--osp-press); }
.osp-btn[aria-pressed="true"] { background: var(--osp-selected); color: var(--osp-text); }

/* A button drawn as a square.
   The controls that wear this carry no word -- the menu, the drawer's
   light/dark, the drawer's close, the link out to the repository -- and a
   bare glyph alone on a row reads as a mark rather than as something to
   press. The box is the word they do not have room to carry. Square because
   the content is one icon: a pill around a single glyph says the glyph is a
   label, and it is not.

   Three of the four are only ever visible below 56rem. The source link is
   the exception and is the reason this is written out here rather than
   inside that query: what it describes is the shape of a button, not a
   width. */
.osp-btn-sq {
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  border: var(--osp-rule) solid var(--osp-border);
  border-radius: max(7px, calc(var(--osp-radius) + 1px));
  background: var(--osp-surface);
}
.osp-btn-sq:hover { background: var(--osp-hover); border-color: var(--osp-accent); }
/* After the hover rule, because a finger that is pressing is also hovering
   and the press is the one that should be on screen. */
.osp-btn-sq:active { background: var(--osp-press); }

/* One icon, and it is the one you get by pressing.
   The page the reader is looking at is already the answer to "which theme
   is this" -- it is lit or it is not -- so an icon repeating it says
   nothing, while an icon naming the other one says what the button does.
   Light now draws the moon; dark now draws the sun.

   Both ship in the markup so the swap is a rule rather than a script
   rewriting an SVG, and the script already sets aria-checked on everything
   carrying the toggle attribute. The attribute still reports the state, not
   the destination, which is what a switch means and what a screen reader
   will say -- the icon is the only part of this that points forwards. */
.osp-theme-glyph { display: none; place-items: center; }
.osp-theme-btn[aria-checked="false"] .osp-theme-moon,
.osp-theme-btn[aria-checked="true"] .osp-theme-sun { display: grid; }

/* --- theme switch ----------------------------------------------------- *
 * A switch, not a button that swaps its own icon: two states, both of them
 * visible, and the thumb says which one is on.
 * --------------------------------------------------------------------- */

.osp-switch {
  display: inline-flex;
  /* The track is a fixed height inside this box, so without this it sits at
     the top of whatever the button grows to -- which is exactly what a 44px
     touch target does to it. */
  align-items: center;
  justify-content: center;
  padding: 0;
  background: none;
  border: 0;
  cursor: pointer;
}
.osp-switch-track {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 3.25rem;
  height: 1.6rem;
  padding: 0 0.3rem;
  border: var(--osp-rule) solid var(--osp-border);
  border-radius: 99px;
  background: color-mix(in srgb, var(--osp-bg) 60%, var(--osp-surface));
  transition: background 160ms ease, border-color 160ms ease;
}
.osp-switch:hover .osp-switch-track { border-color: var(--osp-accent); }
.osp-switch-icon {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  color: var(--osp-text-muted);
  transition: color 160ms ease, opacity 160ms ease;
}
.osp-switch-thumb {
  position: absolute;
  z-index: 0;
  top: 50%;
  left: 0.18rem;
  width: 1.15rem;
  height: 1.15rem;
  border-radius: 99px;
  background: var(--osp-accent);
  transform: translateY(-50%);
  transition: transform 260ms var(--osp-ease);
}
.osp-switch[aria-checked="true"] .osp-switch-thumb {
  transform: translateY(-50%) translateX(1.62rem);
}
/* The icon under the thumb would be unreadable, so it steps back instead. */
.osp-switch[aria-checked="false"] .osp-switch-sun,
.osp-switch[aria-checked="true"] .osp-switch-moon { color: var(--osp-bg); }
.osp-switch[aria-checked="false"] .osp-switch-moon,
.osp-switch[aria-checked="true"] .osp-switch-sun { opacity: 0.45; }

/* --- search ----------------------------------------------------------- */

.osp-search {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.6rem;
  background: color-mix(in srgb, var(--osp-bg) 65%, var(--osp-surface));
  border: var(--osp-rule) solid var(--osp-border);
  border-radius: max(5px, var(--osp-radius));
  font-family: var(--osp-font-ui);
  font-size: var(--osp-ui-md);
  color: var(--osp-text-muted);
  transition: border-color 140ms ease, background 140ms ease;
}
/* The one edge on the page that says "type here". It is the accent on a
   light page and a desaturated cousin of it on a dark one -- see --osp-focus
   in themes.ts for why the same value cannot do both. */
.osp-search:focus-within { border-color: var(--osp-focus); background: var(--osp-bg); }
.osp-search input {
  font: inherit;
  width: 100%;
  color: var(--osp-text);
  background: transparent;
  border: 0;
  outline: 0;
}
.osp-search input::placeholder { color: var(--osp-text-muted); }
.osp-search input::-webkit-search-cancel-button { appearance: none; }
.osp-search kbd {
  flex: none;
  padding: 0.05rem 0.25rem;
  border: 1px solid var(--osp-border);
  border-radius: 3px;
  font-family: var(--osp-font-mono);
  font-size: var(--osp-ui-xs);
}

/* The field's own clear. Off everywhere by default: it is drawn only in the
   narrow layout, where the slash it stands in place of is no use and the
   browser's built-in clear is either suppressed by the rule above or, on
   iOS, never offered. A mouse has Escape and a visible cancel elsewhere.

   The script owns the hidden attribute and the media query owns display,
   so neither can show a button over an empty field: it takes the attribute
   being off *and* the layout being the narrow one. */
.osp-search-clear {
  display: none;
  align-self: stretch;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 2rem;
  margin-right: -0.35rem;
  padding: 0;
  background: none;
  border: 0;
  border-radius: max(4px, var(--osp-radius));
  color: var(--osp-text-muted);
  cursor: pointer;
}
.osp-search-clear:active { color: var(--osp-text); }
/* The bar's field: the site's search, in the middle of the top row.

   It used to live at the top of the vault panel, which put it in the corner
   of the window and tied it to a column that three of the four layouts take
   away. The middle of the bar is the one place that survives every width,
   and it is where a reader looks first. The panel's copy stays in the
   markup for the drawer -- see the 56rem block -- but two of the same field
   on screen at once would be two doors into one room, so above that width
   only this one is drawn. */
.osp-bar-search {
  /* Out of flow, centred on the bar's padding box -- which is centred on
     the window, since the bar runs the full width and its padding is
     symmetric at every size that draws this field. Absolute is what makes
     the constant middle track above possible: the field can take whatever
     width it likes without the grid having an opinion about it.

     Containment states the same boundary to the engine rather than
     leaving it to be inferred. */
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  contain: layout;
  width: var(--osp-search-w);
  /* Larger than the site's other boxes on purpose: at this size the radius
     reads as a field you drop into rather than a cell in a form. */
  border-radius: max(10px, var(--osp-radius));
  /* Width is animated, which a grid item can do because the column it is in
     is intrinsic -- the two fractions either side give back what it takes.
     The shadow and the ring come along at the same pace so the lift and the
     growth are one movement. */
  /* The timings on the resting rule are the ones the field leaves on, and
     they are shorter than the ones it arrives on below: going back is not
     an event, and a dismissal that takes as long as an opening feels like
     the page is reluctant. */
  transition:
    width 170ms var(--osp-ease),
    transform 170ms var(--osp-ease),
    background 150ms var(--osp-ease),
    border-color 150ms var(--osp-ease),
    box-shadow 150ms var(--osp-ease);
}
.osp-panel-search { display: none; }

/* Typing into it is a mode, not a keystroke.

   The field leaves the bar: it grows, drops clear of the row it was sitting
   in, and lifts onto its own shadow, while everything else on the page --
   the note, the tree, the rail, and the bar it just left -- goes behind the
   scrim. What is left on screen is the field, the list under it, and a dim
   impression of where the reader was.

   The bar goes with the page rather than staying lit under the field, which
   is the correction that made this read right. A field still welded to an
   opaque bar is a widget on a toolbar however bright it is; a field floating
   over a dimmed page with the toolbar dimmed behind it is a search. So the
   bar gives up its surface and its rule, the scrim behind shows straight
   through it, and the two things it carries fade with everything else.

   This hangs off the root attribute rather than :focus-within because the
   panel can be dismissed -- clicking away, Escape -- while the caret is
   still in the field, and a field left standing open over a closed panel
   would be the widest thing on the page pointing at nothing. */
:root[data-osp-searching] .osp-bar-search {
  width: var(--osp-search-w-open);
  transform: translate(-50%, calc(-50% + var(--osp-search-drop)));
  transition:
    width 220ms var(--osp-ease),
    transform 220ms var(--osp-ease),
    background 180ms var(--osp-ease),
    border-color 180ms var(--osp-ease),
    box-shadow 180ms var(--osp-ease);
  background: var(--osp-bg);
  border-color: var(--osp-focus);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--osp-focus) 16%, transparent),
    0 1px 2px color-mix(in srgb, var(--osp-shadow) 10%, transparent),
    0 20px 40px -16px color-mix(in srgb, var(--osp-shadow) 40%, transparent);
}
:root[data-osp-searching] .osp-bar {
  background: transparent;
  border-bottom-color: transparent;
}
/* Faded, and inert with it. The scrim is behind the bar rather than over it,
   so without this the one strip of the page a reader could still click into
   would be the one strip that is meant to have stepped back. Turning them
   off hands the click to the bar underneath, which is outside the field and
   outside the panel, which is to say: it closes the search, exactly as a
   click on the dimmed note does. */
:root[data-osp-searching] .osp-brand,
:root[data-osp-searching] .osp-bar-actions {
  opacity: 0.3;
  pointer-events: none;
}
/* The slash was an invitation. Once the field is open it is a key the
   reader has already pressed, so it goes -- but it fades out where it
   stands rather than being taken out of the row. display:none relaid the
   flex line on the first frame of the move, so the input jumped twenty
   pixels wider before the field had travelled anywhere: one pop at the
   start of an animation whose whole job is to not have one. The 1.4rem it
   keeps is cheaper than that. */
.osp-bar-search kbd { transition: opacity 120ms var(--osp-ease); }
:root[data-osp-searching] .osp-bar-search kbd { opacity: 0; }

/* Dimmed in and out, not switched on and off.

   It used to arrive on an entrance animation and leave by having its
   display taken away, which is a fade in and a hard cut out -- and the cut
   landed while the field was still gliding back up, so the page snapped
   bright under a box that was still moving. Transitioning it means the two
   halves of the gesture are mirror images.

   Visibility is stepped rather than interpolated, and at which end depends
   on the direction: on in, at once, so the scrim is catching clicks from
   the first frame; on out, after the fade, or it would stop catching them
   while still visible. This is the pattern the drawer panel already uses
   below 56rem, for the same reason. */
.osp-search-scrim {
  position: fixed;
  inset: 0;
  /* Under the bar (30) and the panel it dims for (40), over everything the
     page itself draws. */
  z-index: 25;
  background: color-mix(in srgb, var(--osp-shadow) 30%, transparent);
  backdrop-filter: blur(1.5px);
  -webkit-backdrop-filter: blur(1.5px);
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 130ms var(--osp-ease),
    visibility 0s linear 130ms;
}
:root[data-osp-searching] .osp-search-scrim {
  opacity: 1;
  visibility: visible;
  transition:
    opacity 160ms var(--osp-ease),
    visibility 0s linear 0s;
}

/* --- vault panel ------------------------------------------------------ */

.osp-panel {
  grid-area: panel;
  position: sticky;
  top: var(--osp-bar-h);
  height: calc(100vh - var(--osp-bar-h));
  height: calc(100dvh - var(--osp-bar-h));
  display: flex;
  flex-direction: column;
  background: var(--osp-surface);
  border-right: var(--osp-rule) solid var(--osp-border);
  font-family: var(--osp-font-ui);
}
/* Everything this row used to hold has gone somewhere a column can reach
   more directly: the field to the middle of the bar, light/dark to the
   switch beside it. It comes back as the drawer's top row below 56rem,
   where the bar has none of that. An empty strip of padding above the tree
   is not a layout, it is a leftover. */
.osp-panel-head {
  flex: none;
  position: relative;
  display: none;
  align-items: center;
  gap: 0.4rem;
  padding: 0.75rem 0.65rem 0.5rem;
}
.osp-panel-head .osp-search { flex: 1; min-width: 0; }
/* Off wherever the panel is a column: the bar's switch is right there. */
.osp-panel-theme { display: none; flex: none; }
/* The same for the way out to the repository, and for the same reason: the
   bar above has it while the bar above has room for it. */
.osp-panel-source { display: none; flex: none; }

/* The drawer's three parts. Off at every width that keeps the panel open,
   which is why none of them carry a width of their own: the one media query
   that opens the drawer turns all three on together. */
.osp-panel-toggle,
.osp-panel-close { display: none; flex: none; }
.osp-scrim {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 55;
  background: color-mix(in srgb, var(--osp-shadow) 45%, transparent);
  animation: osp-fade 200ms var(--osp-ease);
}
@keyframes osp-fade { from { opacity: 0; } }
.osp-panel-body { flex: 1; min-height: 0; overflow-y: auto; padding: 0 0.5rem 2rem; }

.osp-group-title {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0;
  padding: 0.75rem 0.55rem 0.5rem;
  font-family: var(--osp-font-ui);
  font-size: var(--osp-ui-xs);
  font-weight: 650;
  letter-spacing: var(--osp-eyebrow-tracking);
  text-transform: uppercase;
  color: var(--osp-text-muted);
}
.osp-group-title .osp-num,
.osp-group-title .osp-count { margin-left: auto; font-weight: 600; }

/* The one label the panel keeps, held at the top of the list it names. */
.osp-browse-title {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--osp-surface);
}

/* --- Start here -------------------------------------------------------
 * The author's starting points, pinned above the tree.
 *
 * Held still by position in the flex column rather than by position:
 * sticky: the section is a sibling of .osp-panel-body, and the body is
 * the only thing in the panel that scrolls. A sticky block inside the body
 * would have to win a fight with .osp-browse-title, which is already
 * pinned at top: 0 a few rows below it and would slide underneath.
 *
 * max-height is the load-bearing line. Nothing limits how many notes an
 * author pins, the overflow expands to all of them, and flex: none with
 * thirty rows in it would push the tree out of the panel entirely. Capped
 * at a little over a third, the list scrolls inside itself and the tree
 * always keeps the rest -- which is the whole reason this sits beside the
 * tree rather than on top of it.
 * -------------------------------------------------------------------- */
.osp-pins {
  flex: 0 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 38%;
  padding: 0 0.5rem 0.35rem;
  border-bottom: var(--osp-rule) solid var(--osp-border);
}
.osp-pins-title { flex: none; }
.osp-pins-scroll { flex: 1; min-height: 0; overflow-y: auto; }

/* The toggle under the rows it reveals rather than over them. A <details>
   carries its summary first by rule, so the order a reader sees is a layout
   decision: the list, then the control that extends it. */
.osp-pins-rest { display: flex; flex-direction: column; }
.osp-pins-rest > summary { order: 2; list-style: none; }
.osp-pins-rest > summary::-webkit-details-marker { display: none; }
.osp-pins-rest > .osp-pin-list { order: 1; }

.osp-pins-toggle { color: var(--osp-link); }
.osp-pins-toggle:hover { color: var(--osp-link); }
.osp-pins-chev { transition: transform 180ms var(--osp-ease); opacity: 0.7; }
.osp-pins-rest[open] .osp-pins-chev { transform: rotate(180deg); }

/* One summary, two labels, and the stylesheet says which is true. The count
   is how many more there are, so it goes with "Show more" and not with the
   list it was counting. */
.osp-pins-less { display: none; }
.osp-pins-rest[open] .osp-pins-more { display: none; }
.osp-pins-rest[open] .osp-pins-less { display: inline; }
.osp-pins-rest[open] .osp-pins-count { display: none; }

.osp-tree, .osp-tree ul, .osp-pin-list, .osp-outline, .osp-outline ul, .osp-graph-key {
  list-style: none;
  margin: 0;
  padding: 0;
}
.osp-tree ul { padding-left: 0.8rem; }
.osp-nest { border-left: 1px solid var(--osp-faint); margin-left: 0.55rem; padding-left: 0.25rem; }

.osp-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.26rem 0.45rem;
  border-radius: max(4px, var(--osp-radius));
  font-size: var(--osp-ui-md);
  color: var(--osp-text-muted);
  text-decoration: none;
  cursor: pointer;
  transition: background 110ms ease, color 110ms ease;
}
.osp-row:hover { background: var(--osp-hover); color: var(--osp-text); }
.osp-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.osp-trail { margin-left: auto; padding-left: 0.5rem; font-size: var(--osp-ui-xs); opacity: 0.55; white-space: nowrap; }
.osp-row .osp-num { margin-left: auto; font-size: var(--osp-ui-xs); opacity: 0.6; }
.osp-row.osp-current,
.osp-current-file > .osp-row {
  background: var(--osp-selected);
  color: var(--osp-text);
  font-weight: 650;
}
.osp-row-more { color: var(--osp-link); margin-top: 0.25rem; }
.osp-row-more:hover { color: var(--osp-link); }

.osp-folder > details > summary,
.osp-batch > summary { list-style: none; }
.osp-folder > details > summary::-webkit-details-marker,
.osp-batch > summary::-webkit-details-marker { display: none; }
.osp-chev { transition: transform 180ms var(--osp-ease); opacity: 0.7; }
.osp-folder > details[open] > summary .osp-chev,
.osp-batch[open] > summary .osp-chev { transform: rotate(90deg); }

.osp-batch > summary .osp-label { font-style: italic; }
.osp-batch > .osp-nest { margin: 0 0 0.5rem 1.1rem; padding-left: 0.5rem; }

.osp-tagcloud { display: flex; flex-wrap: wrap; gap: 0.25rem; padding: 0.5rem 0.55rem; }
.osp-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.1rem 0.5rem;
  border: 1px solid color-mix(in srgb, var(--osp-accent) 20%, transparent);
  border-radius: 99px;
  background: var(--osp-tint);
  font-size: var(--osp-ui-sm);
  color: var(--osp-link);
  text-decoration: none;
  transition: background 120ms ease;
}
.osp-tag:hover { background: color-mix(in srgb, var(--osp-accent) 17%, transparent); }
.osp-tag .osp-num { opacity: 0.6; }

.osp-empty {
  padding: 1.5rem 0.75rem;
  font-size: var(--osp-ui-md);
  line-height: 1.6;
  color: var(--osp-text-muted);
  text-align: center;
}
.osp-empty b { display: block; margin-bottom: 0.25rem; color: var(--osp-text); font-weight: 650; }

/* --- jump-to ---------------------------------------------------------- */

.osp-jump {
  position: fixed;
  /* Centred the way the field is centred, and by the same arithmetic: two
     pinned edges and auto margins rather than a translate, so the drop-in
     animation below has the transform to itself. */
  left: 0;
  right: 0;
  margin-inline: auto;
  /* Pinned under the field at its dropped height, by the same two terms the
     field is moved by, so the gap between the two is a constant rather than
     something to keep in step by hand. */
  top: calc(var(--osp-bar-h) + var(--osp-search-drop) + 0.6rem);
  z-index: 40;
  width: var(--osp-search-w-open);
  max-height: min(30rem, calc(100vh - var(--osp-bar-h) - var(--osp-search-drop) - 2.5rem));
  max-height: min(30rem, calc(100dvh - var(--osp-bar-h) - var(--osp-search-drop) - 2.5rem));
  overflow-y: auto;
  padding: 0.5rem;
  background: var(--osp-bg);
  border: var(--osp-rule) solid var(--osp-border);
  /* The same radius as the open field, so the two stack as one surface
     with a seam rather than as a box under a box. */
  border-radius: max(12px, var(--osp-radius));
  box-shadow:
    0 1px 2px color-mix(in srgb, var(--osp-shadow) 10%, transparent),
    0 24px 48px -16px color-mix(in srgb, var(--osp-shadow) 32%, transparent);
  font-family: var(--osp-font-ui);
  /* Behind the field, not with it.

     The field takes 220ms to grow and drop into place. A panel that starts
     fading in at the same instant finishes first -- the easing is heavily
     front-loaded, so the field is still visibly travelling at 100ms while
     the panel is already solid underneath it -- and what that looks like is
     a panel that arrived first and dragged the field down after it, which
     is backwards.

     So it waits -- but the wait is measured against the curve the field is
     on, and this curve is quick. The field is past nine tenths of its
     travel by 70ms, so 80ms is already a field that has visibly flown and
     is settling. A longer wait does not read as a better stagger, it reads
     as the page thinking: the whole sequence lands at 240ms now, and it
     was 310ms when it was tuned against a slower curve.

     The backwards fill is what holds the panel at opacity 0 through the
     wait. Without it the panel paints in full for those 80ms and then
     fades in from nothing, which is the delay doing the opposite of what
     it is for. */
  animation: osp-drop 160ms var(--osp-ease) 80ms backwards;
}

/* On the way out it goes first and goes quickly, which is the open
   sequence read backwards: the field was last to arrive, so it is last to
   leave. The panel cannot simply have its hidden attribute set here --
   display:none cancels the frame it would have faded on -- so the script
   marks it, waits, and hides it once this has run. Pointer events go at
   once: a list that is on its way out must not still be clickable. */
.osp-jump[data-osp-leaving] {
  animation: none;
  opacity: 0;
  transform: translateY(-6px) scale(0.985);
  pointer-events: none;
  transition:
    opacity 110ms var(--osp-ease),
    transform 110ms var(--osp-ease);
}
@keyframes osp-drop {
  from { opacity: 0; transform: translateY(-8px) scale(0.98); }
  to { opacity: 1; transform: none; }
}
.osp-jump .osp-row.osp-selected { background: var(--osp-selected); color: var(--osp-text); }

/* The keys the panel answers to, said once and kept in sight while the list
   above it scrolls. */
.osp-jump-hint {
  position: sticky;
  bottom: -0.5rem;
  display: flex;
  flex-wrap: nowrap;
  gap: 0.55rem;
  margin: 0.4rem 0 -0.5rem;
  padding: 0.4rem 0.5rem 0.5rem;
  background: var(--osp-bg);
  /* It runs into the two bottom corners, so it has to carry their curve:
     a square-cornered strip inside a rounded box reads as a rendering
     mistake rather than as a footer. */
  border-radius: 0 0 max(11px, var(--osp-radius)) max(11px, var(--osp-radius));
  border-top: var(--osp-rule) solid var(--osp-faint);
  font-size: var(--osp-ui-xs);
  white-space: nowrap;
  color: var(--osp-text-muted);
}
.osp-jump-hint kbd {
  margin-right: 0.15rem;
  padding: 0 0.25rem;
  border: 1px solid var(--osp-border);
  border-radius: 3px;
  font-family: var(--osp-font-mono);
  font-size: var(--osp-ui-xs);
}
.osp-bucket {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.75rem 0.5rem 0.25rem;
}
.osp-bucket .osp-group-title { padding: 0; }
.osp-bucket .osp-num { margin-left: auto; font-size: var(--osp-ui-xs); opacity: 0.7; }
.osp-hit { background: var(--osp-selected); color: var(--osp-text); border-radius: 2px; }
.osp-jump-more {
  margin: 0.5rem 0 0;
  padding: 0.5rem 0.5rem 0;
  border-top: var(--osp-rule) solid var(--osp-faint);
  font-size: var(--osp-ui-xs);
  color: var(--osp-text-muted);
}

/* --- note ------------------------------------------------------------- */

.osp-main {
  grid-area: main;
  min-width: 0;
}
.osp-doc { padding: 2rem 2rem 6rem; }
.osp-article { max-width: var(--osp-measure); margin-inline: auto; }

/* --- breadcrumb ------------------------------------------------------- *
 * Stays with the reader: the one question a long note stops answering is
 * which note it is. The rule under it appears only once the title has
 * scrolled away, so the edge is information rather than decoration.
 * --------------------------------------------------------------------- */

.osp-crumb {
  position: sticky;
  top: var(--osp-bar-h);
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: var(--osp-crumb-h);
  padding: 0.35rem 2rem;
  background: color-mix(in srgb, var(--osp-bg) 86%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: var(--osp-rule) solid transparent;
  font-family: var(--osp-font-ui);
  font-size: var(--osp-ui-md);
  color: var(--osp-text-muted);
  transition: border-color 200ms ease;
}
.osp-crumb.osp-scrolled { border-bottom-color: var(--osp-border); }

/* The two arrows read as one control, so they sit together with no gap and
   a single rule around the pair. Disabled is the resting state of the
   forward one for most of a visit: it fades rather than disappearing, or the
   back arrow would move under the cursor every time it changed. */
.osp-crumb-nav { display: flex; flex: none; align-items: center; gap: 0.1rem; }
.osp-crumb-step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  border: 0;
  border-radius: max(5px, var(--osp-radius));
  background: transparent;
  color: var(--osp-text-muted);
  cursor: pointer;
  transition: color 120ms ease, background 120ms ease;
}
.osp-crumb-step:hover:not(:disabled) { color: var(--osp-text); background: var(--osp-hover); }
.osp-crumb-step:disabled { opacity: 0.35; cursor: default; }

.osp-crumb-trail {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  min-width: 0;
  overflow: hidden;
  margin: 0;
  padding: 0;
  list-style: none;
}
.osp-crumb-trail li { display: flex; align-items: center; gap: 0.15rem; min-width: 0; }
.osp-crumb-trail a {
  padding: 0.1rem 0.25rem;
  border-radius: max(4px, var(--osp-radius));
  color: inherit;
  text-decoration: none;
  white-space: nowrap;
}
.osp-crumb-trail a:hover { color: var(--osp-text); background: var(--osp-hover); }
.osp-crumb-trail [aria-current="page"] {
  padding: 0.1rem 0.25rem;
  color: var(--osp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.osp-crumb-sep { opacity: 0.4; }

/* --- the two controls at the end of the crumb row --------------------- *
 * Which view of the note to read, and how much of the window it gets. One
 * shape for both, because they are the same kind of thing: a short named
 * set with exactly one on. They sit at the far end so the trail keeps the
 * left edge, which is where a reader looks to find out where they are.
 * --------------------------------------------------------------------- */

.osp-crumb-tools {
  display: flex;
  flex: none;
  align-items: center;
  gap: 0.4rem;
  margin-left: auto;
  padding-left: 0.75rem;
}

.osp-seg {
  display: flex;
  align-items: center;
  gap: 0.1rem;
  padding: 0.13rem;
  border: var(--osp-rule) solid var(--osp-border);
  border-radius: max(6px, calc(var(--osp-radius) + 1px));
}

.osp-seg-btn {
  display: inline-flex;
  align-items: center;
  /* Only ever visible where the button is wider than what is in it, which
     is the icon-only case: a label and a glyph fill their own box, a glyph
     on its own in a 44px touch target does not and would sit against the
     left edge. */
  justify-content: center;
  gap: 0.3rem;
  padding: 0.2rem 0.45rem;
  border: 0;
  border-radius: max(4px, calc(var(--osp-radius) - 1px));
  background: transparent;
  font-family: var(--osp-font-ui);
  font-size: var(--osp-ui-xs);
  line-height: 1.4;
  color: var(--osp-text-muted);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.osp-seg-btn:hover { color: var(--osp-text); background: var(--osp-hover); }
.osp-seg-btn:active { background: var(--osp-press); }
/* The same mark the code block's pressed tools carry, for the same reason:
   one way of saying "this one is on" across the whole site. */
.osp-seg-btn[aria-checked="true"] { background: var(--osp-selected); color: var(--osp-text); }
.osp-seg-icon .osp-seg-btn { padding: 0.2rem 0.38rem; }

/* --- content width ---------------------------------------------------- *
 * The measure is right for prose and wrong for a nine-column Dataview
 * table, which is content this publisher exists to carry. So the reader
 * chooses, three ways.
 *
 * The --osp-measure token is the only lever pulled for the first two, because every
 * width in this stylesheet is already written against it -- the article,
 * the properties row, the mentions, the generated lists. Widening the
 * article alone would leave the rest of the page at its old width, which is
 * not a wide page but a misaligned one.
 * --------------------------------------------------------------------- */

:root[data-osp-width="wide"],
:root[data-osp-width="full"] { --osp-measure: none; }

/* Full takes the panels too, with the rules the narrow breakpoint already
   uses: a window with the panels put away is the same page as a window too
   small to hold them, and it should not be a second layout to maintain. */
:root[data-osp-width="full"] .osp-shell {
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas: "bar" "main";
}
:root[data-osp-width="full"] .osp-panel,
:root[data-osp-width="full"] .osp-rail { display: none; }
/* The bar needs no override here: its middle column is the field at every
   width, and the two fractions either side close up on their own once the
   panel under the left one is gone. */
/* And the context the rail was holding goes under the note instead, rather
   than off the page. */
:root[data-osp-width="full"] .osp-mentions { display: block; }
/* The rail is gone, so the note's own copy of the stats is the only one
   left -- the same arrangement the narrow breakpoint arrives at. */
:root[data-osp-width="full"] .osp-stats-top { display: flex; }

/* --- read, or read the markdown --------------------------------------- *
 * Two panes, one showing. Which one is an attribute on <html> that only the
 * script sets, so a page without scripting is the rendering and the control
 * that would switch it is hidden -- see sourcePane in page.ts.
 * --------------------------------------------------------------------- */

/* Wider than the article, on purpose and only here. The measure is a prose
   measure, counted in a proportional font; this pane is monospace, and a
   vault whose notes are hard wrapped at 76 to 80 columns does not fit in
   it. At the reading width the pane held 77.2 columns against source lines
   of 78, so the file's own lines were soft wrapped a word short of their
   end and the reader could not tell which breaks were the file's and which
   were the viewport's -- the one thing a source view has to get right.

   45.5rem is 80 columns of the mono stack at 0.875rem plus the block's
   padding and border. A floor rather than a width: a theme with a measure
   wider than that keeps it. It is counted in characters of a font, which
   is what ch is for and what the measure itself deliberately is not, but
   the sum is written out as a rem because only this one element uses it --
   see the note in themes.ts for why a shared token cannot be a ch. */
.osp-source { display: none; max-width: max(var(--osp-measure), 45.5rem); }
/* The floor is a floor under the measure, not under the window: wide and
   full mean no limit here as everywhere else. Stated rather than left to
   max() going invalid when --osp-measure is none, which lands on the right
   answer for the wrong reason and only until someone reads it. */
:root[data-osp-width="wide"] .osp-source,
:root[data-osp-width="full"] .osp-source { max-width: none; }
.osp-source .osp-code { margin: 0; }
/* The bar's label is a file name here, not a language token: it keeps the
   note's own capitals and reads as the file a reader could go and open. */
.osp-source .osp-code-lang { text-transform: none; letter-spacing: 0.01em; }
/* The block wraps rather than scrolls sideways. A note's source is one long
   line per paragraph when nobody hard wraps it, and a table or a long link
   even when they do -- this vault's own notes run to 227 characters. The
   reader came for the text, not its line breaks, and a paragraph they have
   to drag a scrollbar through to read is not the note back. */
.osp-source pre code { white-space: pre-wrap; overflow-wrap: anywhere; }

:root[data-osp-view="markdown"] .osp-source { display: block; }
:root[data-osp-view="markdown"] .osp-article,
:root[data-osp-view="markdown"] .osp-mentions,
/* The outline's anchors point at headings that are not on screen. */
:root[data-osp-view="markdown"] .osp-rail-outline { display: none; }

/* No measure of its own: this row is inside the article, which is already
   holding the column. Setting it here a second time was how the rule under
   a note's title came to end short of the callout below it -- the measure
   used to be in ch, and this row is set in the UI font two steps down from
   the body, so the same token resolved narrower here than it did one
   element up. The token is in rem now and the double constraint would be
   harmless, but it is still a width maintained in two places. */
.osp-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1.25rem;
  margin: 0 0 1.5rem;
  padding: 0 0 1.25rem;
  border-bottom: var(--osp-rule) solid var(--osp-border);
  font-family: var(--osp-font-ui);
  font-size: var(--osp-ui-md);
  color: var(--osp-text-muted);
}
.osp-meta .osp-meta-value { color: var(--osp-text); }
.osp-meta .osp-tagcloud { padding: 0; }

.osp-mentions {
  display: none;
  max-width: var(--osp-measure);
  margin: 3rem auto 0;
  padding-top: 1.5rem;
  border-top: var(--osp-rule) solid var(--osp-border);
}
.osp-mentions h2 {
  margin: 0 0 1rem;
  font-family: var(--osp-font-display);
  font-size: 1.1rem;
  font-weight: var(--osp-heading-weight);
  letter-spacing: var(--osp-title-tracking);
}
.osp-mentions-cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 0 1.5rem;
}

.osp-mention {
  display: block;
  padding: 0.5rem;
  border-radius: max(5px, var(--osp-radius));
  font-family: var(--osp-font-ui);
  text-decoration: none;
  transition: background 120ms ease;
}
.osp-mention:hover { background: var(--osp-hover); }
.osp-mentions-cols .osp-mention {
  padding: 0.55rem 0;
  border-top: var(--osp-rule) solid var(--osp-faint);
  border-radius: 0;
  transition: padding-left 160ms var(--osp-ease);
}
.osp-mentions-cols .osp-mention:first-of-type { border-top: 0; }
.osp-mentions-cols .osp-mention:hover { padding-left: 0.5rem; background: none; }
.osp-mention-title {
  display: block;
  font-size: var(--osp-ui-lg);
  font-weight: 650;
  color: var(--osp-text);
}
.osp-mention-excerpt {
  display: block;
  margin-top: 0.2rem;
  font-size: var(--osp-ui-md);
  line-height: 1.5;
  color: var(--osp-text-muted);
}

/* --- context rail ----------------------------------------------------- */

.osp-rail {
  grid-area: rail;
  position: sticky;
  top: var(--osp-bar-h);
  height: calc(100vh - var(--osp-bar-h));
  height: calc(100dvh - var(--osp-bar-h));
  overflow-y: auto;
  padding: 1.25rem 0.9rem 3rem;
  border-left: var(--osp-rule) solid var(--osp-border);
  background: color-mix(in srgb, var(--osp-surface) 40%, var(--osp-bg));
  font-family: var(--osp-font-ui);
}

/* One line of fact, every part of it the same size and weight. */
.osp-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.4rem;
  margin: 0;
  /* No bottom padding: the gap under this line is the rail's own spacing
     above the rule that follows it, and two of them would be one too many.
     The copy at the head of a note sets its own, below. */
  padding: 0 0.5rem;
  font-size: var(--osp-ui-xs);
  font-weight: 400;
  line-height: 1.5;
  color: var(--osp-text-muted);
}
.osp-stats span { font-size: inherit; font-weight: inherit; color: inherit; }

/* The note's copy, which only a narrow screen shows. It is set against the
   article's measure rather than the rail's gutter, so it starts on the same
   left edge as the title underneath it. */
.osp-stats-top {
  display: none;
  max-width: var(--osp-measure);
  margin-inline: auto;
  padding: 0 0 1rem;
}

/* Every section in the rail is introduced the same way, "On this page"
   included -- it is a section, not a special case.

   A rule between each pair, rather than space alone. Space was the earlier
   answer and it reads well with two sections; by the time the rail carries
   the stats, the outline, what links here, what is related and the graph,
   five blocks of small grey type down one column need a line to say where
   one ends and the next begins.

   The rule is drawn on the section box, so it stops where the rail's own
   padding does and never reaches either edge of the column: a divider that
   runs into the panel's border is a second border. The section titles carry
   half a rem of their own padding, so it runs a little wider than the words
   above and below it, which is the proportion that reads as a divider
   rather than as an underline.

   Every child of the rail takes part, not only the sections, because the
   stats line is a block in this column like any other -- it is spelled with
   the universal selector for that reason, and the narrow layout has to undo
   it where it hides a child. */
.osp-rail > * + * {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: var(--osp-rule) solid var(--osp-faint);
}
.osp-rail-title {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0 0 0.5rem;
  padding: 0 0.5rem;
  font-family: var(--osp-font-ui);
  font-size: var(--osp-ui-xs);
  font-weight: 650;
  letter-spacing: var(--osp-eyebrow-tracking);
  text-transform: uppercase;
  color: var(--osp-text-muted);
}
.osp-rail-title .osp-num { margin-left: auto; font-weight: 600; }

/* A table of contents, behaving as one: a rail down the margin with the
   section being read marked on it, and nothing else moving while the note is
   being read. The mark is a segment of the rail rather than a colour on the
   text, so the eye can find the place in the list without reading it. */
.osp-outline {
  margin-left: 0.5rem;
  border-left: var(--osp-rule) solid var(--osp-border);
}
.osp-outline a {
  display: block;
  margin-left: calc(var(--osp-rule) * -1);
  padding: 0.3rem 0.5rem 0.3rem 0.75rem;
  border-left: 2px solid transparent;
  border-radius: 0 max(4px, var(--osp-radius)) max(4px, var(--osp-radius)) 0;
  font-size: var(--osp-ui-md);
  color: var(--osp-text-muted);
  text-decoration: none;
  transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
}
.osp-outline a:hover { color: var(--osp-text); background: var(--osp-hover); }
.osp-outline a.osp-active {
  border-left-color: var(--osp-accent);
  color: var(--osp-text);
  font-weight: 650;
}
.osp-outline .osp-lvl3 a { padding-left: 1.75rem; font-size: var(--osp-ui-sm); }

/* --- the in-page menu ------------------------------------------------- *
 * The outline as a pinned row, for the screens with no margin to put a rail
 * in. Off entirely at every width where the rail is on screen, because
 * there the same list is already standing beside the note.
 * --------------------------------------------------------------------- */

.osp-inpage { display: none; }

.osp-inpage-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 2.6rem;
  padding: 0 max(1.25rem, env(safe-area-inset-left));
  list-style: none;
  font-family: var(--osp-font-ui);
  font-size: var(--osp-ui-md);
  color: var(--osp-text-muted);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.osp-inpage-head::-webkit-details-marker { display: none; }
.osp-inpage-head:active { background: var(--osp-hover); }

/* Shut, the row's subject is the section being read and "On this page" is
   the label on it. Open, the list underneath is the subject and naming a
   single section would be naming one row of it. */
.osp-inpage-label { flex: none; }
.osp-inpage-now {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--osp-text);
}
/* The colon belongs to the label, not to the section: set on the row it
   would be a flex item with the row's gap on either side of it, which reads
   as a colon that has come loose from the word in front of it. */
.osp-inpage:not([open]) .osp-inpage-label::after { content: ":"; }
.osp-inpage[open] .osp-inpage-now { display: none; }

.osp-inpage-chev {
  margin-left: auto;
  flex: none;
  opacity: 0.7;
  transition: transform 180ms var(--osp-ease);
}
.osp-inpage[open] .osp-inpage-chev { transform: rotate(180deg); }

/* The list drops over the note rather than pushing it down the page: a
   reader opening a table of contents has not asked for the thing they were
   reading to move. */
.osp-inpage-body {
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  z-index: 1;
  max-height: calc(100dvh - var(--osp-bar-h) - var(--osp-crumb-h) - var(--osp-inpage-h));
  overflow-y: auto;
  padding: 0.35rem max(1.25rem, env(safe-area-inset-left)) 1.25rem
    max(1.25rem, env(safe-area-inset-right));
  background: var(--osp-bg);
  border-bottom: var(--osp-rule) solid var(--osp-border);
  box-shadow: 0 16px 24px -16px color-mix(in srgb, var(--osp-shadow) 35%, transparent);
}
.osp-inpage-body .osp-outline { margin-left: 0; }

/* --- graph ------------------------------------------------------------ */

.osp-graph { width: 100%; height: auto; display: block; margin: 0.25rem 0 0.75rem; }
.osp-graph-edge { stroke: var(--osp-border); stroke-width: 1; }
.osp-graph-node circle {
  fill: var(--osp-text-muted);
  opacity: 0.7;
  transition: fill 120ms ease, opacity 120ms ease, r 120ms ease;
}
.osp-graph-node:hover circle { fill: var(--osp-accent); opacity: 1; r: 6; }
.osp-graph-centre { fill: var(--osp-accent); }
.osp-graph-dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 99px;
  background: var(--osp-text-muted);
  opacity: 0.6;
}
.osp-graph-dot.osp-graph-both { background: var(--osp-accent); opacity: 1; }
.osp-graph-key { margin-top: 0.25rem; }

/* --- narrow ----------------------------------------------------------- *
 * The rail goes first and its contents reappear under the note, then the
 * panel. The note is what has to survive.
 * --------------------------------------------------------------------- */

@media (max-width: 80rem) {
  .osp-shell {
    grid-template-columns: var(--osp-panel-w) minmax(0, 1fr);
    grid-template-areas: "bar bar" "panel main";
  }
  .osp-rail { display: none; }
  .osp-mentions { display: block; }
  /* The rail took the stats with it; the note's own copy stands in. */
  .osp-stats-top { display: flex; }
}

@media (max-width: 56rem) {
  /* The rail stops being a column and becomes the end of the page. Its
     contents are what the note is attached to -- its outline, what links
     here, what it is near -- and on a phone that reads as a section after
     the note rather than as furniture beside it. */
  .osp-shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "bar" "main" "rail";
  }
  .osp-rail {
    display: block;
    position: static;
    height: auto;
    overflow: visible;
    border-left: 0;
    border-top: var(--osp-rule) solid var(--osp-border);
    padding: 1.75rem max(1.25rem, env(safe-area-inset-right)) 3.5rem
      max(1.25rem, env(safe-area-inset-left));
  }
  /* The rail carries the mentions itself now, so the copy under the note
     would be the second one on the page. */
  .osp-mentions { display: none; }

  /* The two children this width takes away are still siblings, so the rule
     meant to sit between sections would be drawn above whichever section
     now leads the list -- a line under the rail's own top edge, separating
     nothing from nothing. Taken off whatever follows either of them; both
     are named because the outline is absent on a note with no headings, and
     then the stats are what the first section follows. */
  .osp-rail > .osp-stats-rail + *,
  .osp-rail > .osp-rail-outline + * {
    margin-top: 0;
    padding-top: 0;
    border-top: 0;
  }
  /* And the stats go the other way: the rail is the foot of the page here,
     which is the one place a reading time is no use. */
  .osp-stats-top { display: flex; }
  .osp-stats-rail { display: none; }

  /* The menu takes the screen, rather than leaving a sliver of the note
     down one side. On a phone that sliver is not a view of anything -- it
     is four characters of a sentence -- and what it costs is the width the
     tree needs most: a note four folders deep is a long name in a narrow
     column, and the drawer was ellipsing the only part that identifies it.

     Capped so that a tablet, which is also under 56rem, gets a menu rather
     than a page of one. Above the cap the scrim comes back and with it the
     tap-anywhere way out; below it, the close button and Escape are the two
     ways out, which is why the button is the first thing focus lands on.

     Fixed rather than a transformed grid child: it has to sit over the note
     at full height, and the grid cell it came from is a row in the flow.

     It comes in from the right, which is the side the button that opens it
     is on. A drawer that flies out from the opposite edge to its handle
     makes the reader's finger cross the screen to a panel that arrived
     behind it, and the close button -- the last item in the drawer's top
     row -- then lands at the far end from the menu button it replaced.
     From the right, the close appears exactly where the menu was pressed,
     which is the one piece of continuity a drawer can offer. */
  .osp-panel {
    display: flex;
    position: fixed;
    z-index: 60;
    top: 0;
    bottom: 0;
    right: 0;
    left: auto;
    width: min(100vw, 26rem);
    height: auto;
    padding-right: env(safe-area-inset-right);
    border-right: 0;
    border-left: var(--osp-rule) solid var(--osp-border);
    box-shadow: 0 0 40px -8px color-mix(in srgb, var(--osp-shadow) 40%, transparent);
    transform: translateX(102%);
    visibility: hidden;
    /* Visibility is stepped rather than interpolated, and which end of the
       slide it steps at differs by direction: on the way in, at once, so
       the drawer is focusable in the same tick the attribute is set -- a
       field inside something still computing as hidden cannot take the
       caret, and the whole point of the bar's search button is that it
       lands there. On the way out, after the slide, or the panel would
       vanish and then take a quarter second to leave. */
    transition: transform 240ms var(--osp-ease), visibility 0s linear 240ms;
  }
  :root[data-osp-panel="open"] .osp-panel {
    transform: none;
    visibility: visible;
    transition: transform 240ms var(--osp-ease), visibility 0s linear 0s;
  }
  /* The drawer's own top row, which is the bar it is covering: the field
     first and at full width, then the two controls a reader should not have
     to close the menu to reach. */
  .osp-panel-head {
    display: flex;
    gap: 0.5rem;
    padding: 0.6rem max(0.75rem, env(safe-area-inset-right)) 0.6rem 0.75rem;
    border-bottom: var(--osp-rule) solid var(--osp-faint);
  }
  /* The bar is the site's name and the way into the drawer and nothing
     else at this width, so the field changes places: out of the middle of
     the bar, which no longer has a middle, and back into the drawer's top
     row where it was before. One field on screen either way. */
  .osp-panel-search { display: flex; }
  /* The field in the drawer is the whole of the search here, and there is
     no key to press to empty it. */
  .osp-search-clear:not([hidden]) { display: inline-flex; }
  .osp-panel-theme { display: block; }
  /* The drawer's chrome is a trio at this width rather than a pair. The
     field keeps the room it is given -- it is the thing most readers opened
     the drawer for -- so the squares are laid out after it and shrink
     nothing: three 44px targets and whatever is left is the field's, which
     on the narrowest phone is still wider than the placeholder it holds. */
  .osp-panel-source { display: block; }
  .osp-panel-close { display: inline-flex; }
  .osp-panel-toggle { display: inline-flex; }
  .osp-scrim { display: block; }
  .osp-panel-body { padding-left: 0.4rem; padding-right: 0.4rem; }
  .osp-pins { padding-left: 0.4rem; padding-right: 0.4rem; }

  /* Name, then menu. Two things, one at each end.
     The field that used to hold the middle of this row is in the drawer, so
     the site gets its name back: on a page reached from a link somewhere
     else, the one thing the bar should say is whose site this is. And the
     menu goes to the right, where the hand holding the phone already is. */
  .osp-bar {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.4rem;
    /* The same gutter the crumb and the outline row use, so the three rows
       stack against one left edge and one right edge. The bar used to sit
       at 0.75rem and make the difference up out of the brand's own padding,
       which lined the *name* up with the rows below while leaving the menu
       button's box eight pixels proud of the view control under it -- two
       drawn boxes, one above the other, not quite on the same line. */
    padding-left: max(1.25rem, env(safe-area-inset-left));
    padding-right: max(1.25rem, env(safe-area-inset-right));
  }
  /* The name takes the whole left column so the menu is pushed to the far
     edge, but it is set against the start of it: a touch pointer gives the
     brand a 44px floor and centres what is in it, which in a column that
     now takes the free space would float the name into the middle. */
  /* The name takes the whole left column so the menu is pushed to the far
     edge, but it is set against the start of it: a touch pointer gives the
     brand a 44px floor and centres what is in it, which in a column that
     now takes the free space would float the name into the middle. */
  .osp-brand { grid-column: 1; justify-self: start; padding-left: 0; padding-right: 0; }
  .osp-panel-toggle { grid-column: 2; }
  /* Both of its children are already off at this width -- the graph toggles
     a rail that is not on screen, and light/dark has moved into the drawer
     -- so what is left is an empty box taking a grid cell. */
  .osp-bar-actions { display: none; }
  .osp-bar-search { display: none; }
  /* The drawer brings a scrim of its own, and the field is inside it, so
     none of what the open field does to the bar applies here: the bar keeps
     its surface, the name stays lit, and the whole lot is behind the
     drawer's scrim anyway. */
  /* Written at the same weight as the rule that turns it on, because that
     one carries the root attribute and a bare class here would lose to it
     -- a media query is not specificity. Two scrims over one page is not a
     subtle bug: it is visibly twice as dark. */
  :root[data-osp-searching] .osp-search-scrim { display: none; }
  :root[data-osp-searching] .osp-bar {
    background: var(--osp-surface);
    border-bottom-color: var(--osp-border);
  }
  :root[data-osp-searching] .osp-brand { opacity: 1; pointer-events: auto; }
  .osp-doc { padding: 1.5rem 1.25rem 4rem; }
  .osp-crumb { padding-left: 1.25rem; padding-right: 1.25rem; }

  /* The outline leaves the rail and becomes the row under the crumb. */
  .osp-inpage {
    display: block;
    position: sticky;
    /* Plus the rule, because the crumb above is a row of 44px controls with
       a hairline under them, and border-box sizing cannot make those 45 pixels
       into 44. A pin set to the token alone lands one pixel high and the
       first thing it covers is that hairline -- which is the one part of
       the crumb that carries information, since it appears only once the
       title has scrolled away. */
    top: calc(var(--osp-bar-h) + var(--osp-crumb-h) + var(--osp-rule));
    z-index: 15;
    background: var(--osp-bg);
    border-bottom: var(--osp-rule) solid var(--osp-faint);
  }
  :root { --osp-inpage-h: 2.6rem; }
  /* It is the same list, so only one copy of it may be on the page. */
  .osp-rail-outline { display: none; }
  /* In markdown mode its anchors point at headings that are not on screen,
     the same reason the rail's copy goes with them. */
  :root[data-osp-view="markdown"] .osp-inpage { display: none; }
  :root[data-osp-view="markdown"] { --osp-inpage-h: 0rem; }

  /* The field this answers to is in the drawer, so the overlay belongs over
     the drawer -- the same panel under the same field as on a desktop,
     which is the whole of that experience worth carrying across. */
  .osp-jump {
    right: max(0.75rem, env(safe-area-inset-right));
    left: auto;
    margin-inline: 0;
    /* Nothing to fall in behind here: the drawer's field is already where
       it is going to be, so the wait would be a pause rather than a
       stagger. */
    animation-delay: 0s;
    width: calc(min(100vw, 26rem) - 1.5rem);
    top: 3.9rem;
    max-height: calc(100dvh - 4.75rem);
    z-index: 70;
  }
  /* The trail is a long way to say where a note is on a narrow screen, and
     the mark in the bar already leads home: the note's own name is the part
     that has to fit. */
  .osp-crumb-trail li:not(:last-child) { display: none; }
  .osp-crumb-trail li:last-child .osp-crumb-sep { display: none; }
  /* What is left of the trail is the note's own name, which is text rather
     than a link: the padding that keeps a hover highlight off the words is
     four pixels nothing presses, and it was pushing the title out of line
     with the row above and the row below. */
  .osp-crumb-trail [aria-current="page"] { padding-left: 0; }
  /* Both panels are already gone and the measure is already the column, so
     all three width settings would land on the same page. The view control
     stays: that one still has two things to show. */
  .osp-crumb-tools [data-osp-widths] { display: none; }

  /* The view control: the desktop's control with the words taken off.
     It used to be redrawn here -- track removed, the pressed tint painted
     on an inset of the button -- on the argument that a bordered segment
     was the loudest thing on a 390px screen. What that bought in quiet it
     spent on recognition: two icons sitting loose in a row, one of them
     faintly tinted, do not read as a pair of alternatives at all. A reader
     who has seen this site on a laptop knows the segmented track, and the
     same object in the same place is worth more than a few pixels of ink.

     So the only difference from the desktop control is the one the width
     actually forces: the labels go, and the icons stand in for them. The
     names survive on title and aria-label, which is where they already
     were for the width control beside it. */
  .osp-seg-btn span { display: none; }
  /* Back and forward are the phone's own, by gesture or by its chrome, and
     this row has one note title and two controls to fit across 390px. The
     browser's affordance is better than ours and costs no room. */
  .osp-crumb-nav { display: none; }
  /* Held sideways, a notched phone eats the left or right edge of both. */
  .osp-doc {
    padding-left: max(1.25rem, env(safe-area-inset-left));
    padding-right: max(1.25rem, env(safe-area-inset-right));
  }
  .osp-crumb {
    padding-left: max(1.25rem, env(safe-area-inset-left));
    padding-right: max(1.25rem, env(safe-area-inset-right));
  }
}

/* --- touch ------------------------------------------------------------ *
 * Keyed to the pointer, not to the width: a 380px browser window on a
 * desktop still has a mouse, and a tablet at 1024px does not. What changes
 * is everything a finger makes untrue -- targets sized for a cursor, labels
 * that live in a tooltip nothing can hover, hints naming keys there is no
 * keyboard for, and a text field small enough that iOS zooms the page to
 * meet it and never zooms back.
 * --------------------------------------------------------------------- */

@media (pointer: coarse) {
  /* Taller controls make a taller crumb row, and this variable is what
     every heading's scroll-margin is built from. Left at the pointer-sized
     value, an anchor jump lands the heading just under the sticky edge --
     two pixels, which is enough to read as the link having missed. */
  :root { --osp-crumb-h: 3.9rem; }

  /* 44px is the floor, and it is a floor on the hit area rather than on the
     ink: the controls keep their drawn size and grow the box around it. */
  .osp-seg-btn,
  .osp-crumb-step,
  .osp-code-btn,
  .osp-btn,
  .osp-callout-toggle {
    min-height: 44px;
    min-width: 44px;
  }

  /* The three squares grow with everything else, but as squares: a floor on
     one side alone would make them oblong. */
  .osp-btn-sq { width: 44px; height: 44px; }

  .osp-row,
  .osp-tree summary,
  .osp-mention {
    min-height: 44px;
  }

  /* The mark is the way home, and on these screens the name beside it is
     gone, so the square is the whole target. */
  .osp-brand { min-height: 44px; min-width: 44px; justify-content: center; }

  .osp-switch { min-height: 44px; min-width: 44px; }

  /* Icons alone, as on every other control in this row. The names live on
     aria-label rather than in a tooltip no finger can ask for, so the
     buttons are still named to a screen reader. */
  .osp-seg-icon .osp-seg-btn { min-width: 44px; }

  /* Under 16px, Safari zooms the page to the field on focus and leaves it
     there. On these screens the field in the bar is the whole navigation.

     The input stretches to fill the box rather than sitting inside it on a
     cushion of padding: the padding is not a tap target, so a 44px-tall
     field that only listens across the middle 29 is still a miss. */
  /* The bar has to hold a 44px field with room left over, or the field
     becomes the bar. */
  :root { --osp-bar-h: 3.5rem; }

  /* 16px on the whole field, not just the input: at 13px Safari zooms the
     page to meet it and never zooms back, and setting it on the input alone
     left a 16px value sitting in a box scaled for 13 -- the icon, the
     placeholder and the text all disagreeing by two points. */
  .osp-search {
    font-size: 1rem;
    padding-top: 0;
    padding-bottom: 0;
  }
  .osp-search input { align-self: stretch; min-height: 2.75rem; }

  /* And the glyphs at either end come up to meet it.
     16px text beside a 14px icon reads as text that is too big rather than
     as an icon that is too small, so the obvious fix is to shrink the
     words -- but the 16 above is not a design choice, it is the number
     below which iOS zooms the page to a focused field and leaves it there.
     The glyphs carry no such rule, so they are the side that moves.

     Scoped to the field rather than set on the icon class: at this size
     these two sit beside sixteen-point text, and every other osp-icon-sm on
     a touch screen still sits beside the UI scale. */
  .osp-search .osp-icon-sm { width: 16px; height: 16px; }

  /* Keys nobody has. */
  .osp-jump-hint,
  .osp-search kbd { display: none; }

  /* The grey box iOS paints over a tap belongs to no theme. The controls
     all carry a pressed state of their own, which is the honest feedback. */
  a, button, summary, [role="radio"], [role="switch"] {
    -webkit-tap-highlight-color: transparent;
  }
}

/* --- narrow and touched ----------------------------------------------- *
 * Where the two previous blocks meet: a phone. The coarse-pointer rules
 * grew every control to 44px, which is right, and grew the crumb row to
 * 62px along with them, which is not -- the row holds one note title and
 * one two-state control, and the height it needs is the height of the
 * control. Padding was the difference, so the padding goes and the row
 * becomes exactly its tallest child.
 * --------------------------------------------------------------------- */

@media (max-width: 56rem) and (pointer: coarse) {
  /* Exactly what the row is: the view control's own height, plus the air
     above and below it. The row is a min-height and the in-page menu is
     pinned at the same number, so a value short of the content would put
     the outline row over the last few pixels of the crumb rather than
     under it.

     The track is 2rem of button and the 0.13rem of padding and the rule
     that draw it -- shorter than a 44px button would make it, which is the
     one place this stylesheet spends a touch target on appearance. Grown to
     the floor, the track filled the row edge to edge and read as a second
     bar rather than as a control sitting in one; the width, which is what a
     thumb actually aims at here, keeps its 44. */
  :root { --osp-crumb-h: calc(2rem + 0.26rem + var(--osp-rule) * 2 + 0.6rem); }
  .osp-crumb { padding-top: 0.3rem; padding-bottom: 0.3rem; }
  .osp-crumb-tools .osp-seg-btn { min-height: 2rem; }
  /* The gap is the track's own now; the row only has to stand clear of the
     note's title. */
  .osp-crumb-tools { gap: 0; padding-left: 0.5rem; }
  .osp-inpage-head { min-height: 2.75rem; }
  :root { --osp-inpage-h: 2.75rem; }
  :root[data-osp-view="markdown"] { --osp-inpage-h: 0rem; }
  /* A row of links in a drawer the size of the screen: the whole width is
     the target, and the text inside it is read at the size the note is. */
  .osp-panel .osp-row { padding-left: 0.6rem; padding-right: 0.6rem; }
  .osp-inpage-body .osp-outline a { min-height: 44px; display: flex; align-items: center; }

}

/* A phone held sideways has 390px of height, and 110 of it was chrome the
   reader could not scroll past: a bar, a trail and two controls standing
   between them and a quarter of the page. The bar stays -- it holds the
   search and the way home, and it is the smaller half. The trail gives up
   its sticky position, which costs a reader who scrolls back up a moment
   and gives every reader a quarter of their screen. */
@media (max-height: 30rem) and (orientation: landscape) {
  .osp-crumb { position: static; }
  /* The outline row goes the same way and for the same arithmetic. Pinned,
     it would hold 44px of a 390px screen for the whole of a note -- and it
     is the row a reader can most afford to scroll back for, because unlike
     the trail it answers a question they have already answered by being
     where they are. */
  .osp-inpage { position: static; }
  /* Nothing sticky below the bar any more, so a heading only has to clear
     the bar. */
  :root { --osp-crumb-h: 0rem; --osp-inpage-h: 0rem; }
}

/* An outline link jumps rather than teleports, so the reader keeps their
   place in the page. */
html { scroll-behavior: smooth; }

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    /* A delay outlives a duration that has been zeroed, and on its own it
       is not motion -- it is a wait for motion that is no longer coming. */
    animation-delay: 0s !important;
    transition-delay: 0s !important;
  }
  /* The search's reduced path, and the reason it is one line: the drop is
     the only part of opening the field that is travel across the screen,
     and every other measurement is built from the same token. Zero it and
     the field grows where it stands, the panel stays pinned under it, and
     what is left -- the page dimming, the bar stepping back, the list
     appearing -- is state the reader still needs told. Reduced motion is
     less movement, not less feedback. */
  :root { --osp-search-drop: 0rem; }
}

@media print {
  .osp-bar, .osp-panel, .osp-rail, .osp-crumb, .osp-jump, .osp-inpage { display: none; }
  /* Paper gets the note, whichever view the screen was showing. */
  .osp-source { display: none !important; }
  .osp-article { display: block !important; }
  .osp-shell { display: block; }
  .osp-doc { padding: 0; }
  /* Paper does not scroll: nothing may be left outside the edge of a block,
     and no control may be printed that could not be pressed. */
  .osp-code-tools { display: none; }
  .osp-diagram-tools { display: none; }
  .osp-heading-link { display: none; }
  .osp-code pre code { white-space: pre-wrap; overflow-wrap: anywhere; }
  .osp-scroller {
    overflow: visible;
    -webkit-mask-image: none;
    mask-image: none;
  }
}

/* --- index ----------------------------------------------------------- */

.markdown-rendered .osp-index-lead {
  font-family: var(--osp-font-ui);
  font-size: 0.8rem;
  letter-spacing: var(--osp-eyebrow-tracking);
  text-transform: uppercase;
  color: var(--osp-text-muted);
  margin: 0 0 2.5rem;
}

.markdown-rendered .osp-index-group {
  font-family: var(--osp-font-ui);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: var(--osp-eyebrow-tracking);
  text-transform: uppercase;
  color: var(--osp-text-muted);
  margin: 2.5rem 0 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: var(--osp-rule) solid var(--osp-border);
}

.markdown-rendered .osp-index {
  list-style: none;
  margin: 0;
  padding: 0;
  max-width: var(--osp-measure);
}

.markdown-rendered .osp-index-item {
  margin: 0;
  padding: 0;
}

.markdown-rendered .osp-index-item a {
  display: block;
  padding: 0.55rem 0;
  color: var(--osp-text);
  text-decoration: none;
  font-family: var(--osp-font-display);
  font-size: 1.05rem;
  border-bottom: var(--osp-rule) solid transparent;
  transition: color 90ms ease;
}

.markdown-rendered .osp-index-item a:hover {
  color: var(--osp-link);
}

/* A wide index reads better in columns than as one long ribbon. */
@media (min-width: 60rem) {
  .markdown-rendered .osp-index {
    columns: 2;
    column-gap: 3rem;
  }
  .markdown-rendered .osp-index-item {
    break-inside: avoid;
  }
}

.markdown-rendered .osp-index-group .osp-num,
.markdown-rendered .osp-index-bucket .osp-num {
  margin-left: 0.5rem;
  font-weight: 600;
  opacity: 0.75;
}
.markdown-rendered .osp-index-item .osp-num {
  margin-left: 0.5rem;
  font-family: var(--osp-font-ui);
  font-size: var(--osp-ui-md);
  color: var(--osp-text-muted);
}

/* --- the homepage, and the pages shaped like it ----------------------- */

/* A list meant to be read rather than scanned: title, one fact, first line.
   Rows are separated by a rule rather than boxed, because a page of cards is
   a page of frames competing with the words inside them. */

.markdown-rendered .osp-home-section { margin: 0; }

.markdown-rendered .osp-home-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-width: var(--osp-measure);
}

.markdown-rendered .osp-home-item { margin: 0; padding: 0; }

.markdown-rendered .osp-home-item > a {
  display: block;
  padding: 0.7rem 0;
  border-top: var(--osp-rule) solid var(--osp-faint);
  color: inherit;
  text-decoration: none;
  transition: padding-left 160ms var(--osp-ease);
}
.markdown-rendered .osp-home-item:first-child > a { border-top: 0; }
.markdown-rendered .osp-home-item > a:hover { padding-left: 0.5rem; }
.markdown-rendered .osp-home-item > a:hover .osp-home-title { color: var(--osp-link); }

.osp-home-title {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  font-family: var(--osp-font-display);
  font-size: 1.05rem;
  font-weight: var(--osp-heading-weight);
  color: var(--osp-text);
  transition: color 90ms ease;
}

/* The one fact, pushed to the end of the line and sized down: it answers
   "which of these?" after the title has answered "what?". */
.osp-home-trail {
  margin-left: auto;
  flex: none;
  font-family: var(--osp-font-ui);
  font-size: var(--osp-ui-sm);
  font-weight: 500;
  color: var(--osp-text-muted);
  white-space: nowrap;
}

.osp-home-excerpt {
  display: block;
  margin-top: 0.15rem;
  font-family: var(--osp-font-ui);
  font-size: var(--osp-ui-md);
  line-height: 1.5;
  color: var(--osp-text-muted);
}

.markdown-rendered .osp-home-more {
  margin: 1rem 0 0;
  font-family: var(--osp-font-ui);
  font-size: var(--osp-ui-md);
}
.markdown-rendered .osp-home-more a {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--osp-link);
  text-decoration: none;
  font-weight: 550;
}
.markdown-rendered .osp-home-more a .osp-icon-sm {
  transition: transform 160ms var(--osp-ease);
}
.markdown-rendered .osp-home-more a:hover .osp-icon-sm { transform: translateX(3px); }

.markdown-rendered .osp-home-section .osp-tagcloud { padding: 0; }

/* Under a homepage somebody wrote: clearly the site's furniture rather than
   a continuation of their note. */
.markdown-rendered .osp-home-explore {
  max-width: var(--osp-measure);
  margin: 3.5rem 0 0;
  padding-top: 0.5rem;
  border-top: var(--osp-rule) solid var(--osp-border);
}
`;

/**
 * The name of the cascade layer the theme's tokens are declared in.
 *
 * The one reason it exists: an unlayered declaration beats every layered one
 * whatever its specificity, so an author's own stylesheet -- appended to the
 * end of this file and in no layer -- can override a token with a plain
 * `:root { --osp-link: ... }` and have it hold in dark mode too.
 *
 * Without the layer it would not. Dark values are emitted under
 * `:root[data-theme="dark"]` and `:root:not([data-theme="light"])`, both of
 * which outrank a bare `:root`, so an override written the obvious way would
 * work in light mode and quietly stop working when a reader's system went
 * dark -- and the fix would be three blocks of selector ceremony copied out
 * of this repo. See `customCss.ts`.
 *
 * Measured in Chromium against the generated stylesheet, with an author's
 * `:root { --osp-link: #ff0000 }` on the end. Layered: the override holds in
 * all six states -- light and dark system, each with the theme unpinned,
 * pinned dark and pinned light. The same file with the layer stripped out
 * and nothing else changed: the override holds in light and loses to the
 * theme's `#8d8bff` on a dark system, pinned or not. `@layer` is also an
 * older feature than the `color-mix()` this stylesheet already uses in
 * thirty places, so it asks nothing new of a reader's browser.
 *
 * Only the tokens are layered. `STRUCTURE_CSS` stays unlayered because it
 * has to keep beating the harvested `assets/obsidian.css`, which is
 * unlayered and loaded first; putting it in a layer would hand every
 * disagreement to Obsidian's own rules. That split is safe because no
 * custom property is declared in both halves, which `themes.test.ts` holds.
 */
export const THEME_LAYER = "osp.theme";

/** The full stylesheet for a site built with the named theme. */
export function siteCss(themeName?: string): string {
  const theme = getTheme(themeName);
  return (
    `/* Generated by vault-publisher. Theme: ${theme.name}. */\n\n` +
    `@layer ${THEME_LAYER} {\n${themeTokensCss(theme)}}\n\n` +
    `${STRUCTURE_CSS}`
  );
}

/** Backwards-compatible default, used where no theme has been chosen yet. */
export const SITE_CSS = siteCss();
