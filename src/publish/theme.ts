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
  scroll-margin-top: calc(var(--osp-bar-h) + var(--osp-crumb-h) + 1.25rem);
}
.markdown-rendered h2 { font-size: 1.45rem; }
.markdown-rendered h3 { font-size: 1.15rem; }
.markdown-rendered h4 { font-size: 1rem; }

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
}

/* Every rule below is written through .osp-table-wrap, which prepareTables
   puts around every table. Two classes, where a plugin's table CSS reaches
   for one class and a chain of elements -- so a Dataview or Bases result is
   styled by this page rather than by whoever generated it. */

.markdown-rendered .osp-table-wrap table {
  width: 100%;
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

/* Sized by its content, so a figure sits beside the row it belongs to
   rather than at the far edge of the measure. prepareTables marks it. */
.markdown-rendered .osp-table-wrap table[data-osp-figures] {
  width: auto;
  max-width: 100%;
}

/* --- room to breathe ------------------------------------------------- *
 * Only blocks that are children of the page's own article lean out. One
 * inside a callout or an embed stays where its container put it, or it
 * hangs off the side of it.
 *
 * Anchored to .osp-article rather than .markdown-rendered, because an embed
 * renders the embedded note into a container that carries
 * markdown-rendered too: written the other way, a table inside an embed
 * leaned 28px to the left and was clipped by the embed's own edge.
 * --------------------------------------------------------------------- */

.osp-article > .osp-code,
.osp-article > .osp-table-wrap,
.osp-article > .osp-base {
  width: calc(100% + var(--osp-bleed) * 2);
  margin-left: calc(var(--osp-bleed) * -1);
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
 * Mermaid ships its geometry and its palette together, scoped to the
 * diagram's own id. The palette is taken out at build time, so what arrives
 * here is shape, stroke width and dash pattern with no colour at all, and
 * every rule below is the page deciding what a diagram looks like.
 *
 * Shape selectors are qualified by element -- rect.actor, not .actor --
 * because Mermaid puts the same class on a box and on the text inside it,
 * and a label painted with the box fill is a label nobody can read.
 * --------------------------------------------------------------------- */

.markdown-rendered .mermaid-wrapper,
.markdown-rendered .mermaid { margin: 0 0 1.5rem; text-align: center; }
.markdown-rendered .mermaid svg { max-width: 100%; height: auto; }

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
   the page's text colour. */
.markdown-rendered .mermaid svg text,
.markdown-rendered .mermaid svg tspan,
.markdown-rendered .mermaid svg .label,
.markdown-rendered .mermaid svg .nodeLabel,
.markdown-rendered .mermaid svg .edgeLabel,
.markdown-rendered .mermaid svg foreignObject div,
.markdown-rendered .mermaid svg span {
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
   indistinguishable from a complete one. */
.markdown-rendered .osp-base-truncated {
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
  --osp-panel-w: 17rem;
  --osp-rail-w: 19rem;
  --osp-hover: color-mix(in srgb, var(--osp-text) 6%, transparent);
  --osp-press: color-mix(in srgb, var(--osp-text) 11%, transparent);
  --osp-selected: color-mix(in srgb, var(--osp-accent) 15%, transparent);
  --osp-faint: color-mix(in srgb, var(--osp-border) 60%, transparent);
  --osp-tint: color-mix(in srgb, var(--osp-accent) 8%, transparent);
  /* How far a block may lean out of the text measure. Prose keeps the
     measure; a table or a code block has no reason to be 66 characters
     wide, and the room beside it is doing nothing. Zero until the window is
     wide enough to spare it. */
  --osp-bleed: 0rem;

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
}

.osp-icon { width: 16px; height: 16px; flex: none; stroke-width: 1.75; }
.osp-icon-sm { width: 14px; height: 14px; flex: none; stroke-width: 1.75; }

/* --- command bar ----------------------------------------------------- */

.osp-bar {
  grid-area: bar;
  position: sticky;
  top: 0;
  z-index: 30;
  display: grid;
  grid-template-columns: var(--osp-panel-w) minmax(0, 1fr) auto;
  align-items: center;
  gap: 1rem;
  height: var(--osp-bar-h);
  padding: 0 0.75rem;
  background: var(--osp-surface);
  border-bottom: var(--osp-rule) solid var(--osp-border);
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

.osp-bar-actions { grid-column: 3; display: flex; align-items: center; gap: 0.5rem; }

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

/* --- theme switch ----------------------------------------------------- *
 * A switch, not a button that swaps its own icon: two states, both of them
 * visible, and the thumb says which one is on.
 * --------------------------------------------------------------------- */

.osp-switch {
  display: inline-flex;
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
.osp-search:focus-within { border-color: var(--osp-accent); background: var(--osp-bg); }
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
/* The vault's search lives in the panel. The bar keeps one only for the
   screens too narrow to show that panel. */
.osp-bar-search { display: none; }

/* --- vault panel ------------------------------------------------------ */

.osp-panel {
  grid-area: panel;
  position: sticky;
  top: var(--osp-bar-h);
  height: calc(100vh - var(--osp-bar-h));
  display: flex;
  flex-direction: column;
  background: var(--osp-surface);
  border-right: var(--osp-rule) solid var(--osp-border);
  font-family: var(--osp-font-ui);
}
.osp-panel-head { flex: none; position: relative; padding: 0.75rem 0.65rem 0.5rem; }
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

.osp-tree, .osp-tree ul, .osp-outline, .osp-outline ul, .osp-graph-key {
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
  left: 0.5rem;
  top: calc(var(--osp-bar-h) + 3.05rem);
  z-index: 40;
  width: calc(var(--osp-panel-w) - 1rem);
  max-height: min(28rem, calc(100vh - var(--osp-bar-h) - 4.5rem));
  overflow-y: auto;
  padding: 0.5rem;
  background: var(--osp-bg);
  border: var(--osp-rule) solid var(--osp-border);
  border-radius: max(7px, var(--osp-radius));
  box-shadow:
    0 1px 2px color-mix(in srgb, var(--osp-text) 10%, transparent),
    0 16px 32px -12px color-mix(in srgb, var(--osp-text) 28%, transparent);
  font-family: var(--osp-font-ui);
  animation: osp-drop 180ms var(--osp-ease);
}
@keyframes osp-drop {
  from { opacity: 0; transform: translateY(-4px); }
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

.osp-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1.25rem;
  max-width: var(--osp-measure);
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
  padding: 0 0.5rem 1.25rem;
  font-size: var(--osp-ui-xs);
  font-weight: 400;
  line-height: 1.5;
  color: var(--osp-text-muted);
}
.osp-stats span { font-size: inherit; font-weight: inherit; color: inherit; }

/* Every section in the rail is introduced the same way, "On this page"
   included -- it is a section, not a special case. What separates them is
   space: a rule between every pair turned a margin into a form. */
.osp-rail-section + .osp-rail-section { margin-top: 1.75rem; }
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

/* --- graph ------------------------------------------------------------ */

.osp-rail-graphhead { padding: 0 0 0.5rem; }
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

/* --- wide ------------------------------------------------------------- *
 * Past this, the column has room beside it that is doing nothing, and a
 * table or a code block has no reason to be 66 characters wide. Declared
 * after the shell's own :root, which sets the floor these raise.
 * --------------------------------------------------------------------- */

@media (min-width: 88rem) {
  :root { --osp-bleed: 1.75rem; }
}
@media (min-width: 110rem) {
  :root { --osp-bleed: 3.25rem; }
}

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
  /* The control would toggle a panel that is not on screen. */
  .osp-bar-actions [data-osp-graph] { display: none; }
  .osp-mentions { display: block; }
}

@media (max-width: 56rem) {
  .osp-shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "bar" "main";
  }
  .osp-panel { display: none; }
  .osp-bar {
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 0.5rem;
  }
  .osp-bar-search { display: flex; }
  .osp-bar-search kbd { display: none; }
  .osp-brand-name { display: none; }
  .osp-doc { padding: 1.5rem 1.25rem 4rem; }
  .osp-crumb { padding-left: 1.25rem; padding-right: 1.25rem; }
  /* The panel is gone, so the overlay answers to the field in the bar. */
  .osp-jump {
    left: 1rem;
    right: 1rem;
    width: auto;
    top: calc(var(--osp-bar-h) + 0.6rem);
  }
  /* The trail is a long way to say where a note is on a narrow screen, and
     the mark in the bar already leads home: the note's own name is the part
     that has to fit. */
  .osp-crumb-trail li:not(:last-child) { display: none; }
  .osp-crumb-trail li:last-child .osp-crumb-sep { display: none; }
}

/* An outline link jumps rather than teleports, so the reader keeps their
   place in the page. */
html { scroll-behavior: smooth; }

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}

@media print {
  .osp-bar, .osp-panel, .osp-rail, .osp-crumb, .osp-jump { display: none; }
  .osp-shell { display: block; }
  .osp-doc { padding: 0; }
  /* Paper does not scroll: nothing may be left outside the edge of a block,
     and no control may be printed that could not be pressed. */
  .osp-code-tools { display: none; }
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

/** The full stylesheet for a site built with the named theme. */
export function siteCss(themeName?: string): string {
  const theme = getTheme(themeName);
  return `/* Generated by vault-publisher. Theme: ${theme.name}. */\n\n${themeTokensCss(theme)}\n${STRUCTURE_CSS}`;
}

/** Backwards-compatible default, used where no theme has been chosen yet. */
export const SITE_CSS = siteCss();
