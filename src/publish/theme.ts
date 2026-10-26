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

.markdown-rendered blockquote {
  margin: 0 0 1.25rem;
  padding-left: 1.25rem;
  border-left: 2px solid var(--osp-border);
  color: var(--osp-text-muted);
}

.markdown-rendered code {
  font-family: var(--osp-font-mono);
  font-size: 0.875em;
  background: var(--osp-surface);
  padding: 0.15em 0.35em;
  border-radius: 3px;
}
.markdown-rendered pre {
  background: var(--osp-surface);
  border: 1px solid var(--osp-border);
  border-radius: 6px;
  padding: 1rem 1.1rem;
  overflow-x: auto;
  margin: 0 0 1.25rem;
  font-size: 0.875rem;
  line-height: 1.55;
}
.markdown-rendered pre code { background: none; padding: 0; font-size: 1em; }

/* Obsidian ships a copy button inside every code block; it does nothing
   here, and nothing in the page restores it. */
.markdown-rendered .copy-code-button { display: none; }

/* Frontmatter is rendered hidden by Obsidian, and must stay hidden. */
.markdown-rendered .frontmatter,
.markdown-rendered .frontmatter-container { display: none; }

.markdown-rendered table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--osp-font-ui);
  font-size: 0.875rem;
  margin: 0 0 1.5rem;
  display: block;
  overflow-x: auto;
}
.markdown-rendered th,
.markdown-rendered td {
  text-align: left;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--osp-border);
  vertical-align: top;
}
.markdown-rendered th {
  font-weight: 600;
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--osp-text-muted);
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

.markdown-rendered mjx-container {
  max-width: 100%;
}

/* Obsidian scopes its MathJax font assignment to breakable (inline) math.
   Display math has no 'breakable' attribute, so give its glyph nodes the same
   MathJax fonts or fractions and large operators fall back to serif fonts. */
.markdown-rendered mjx-container[jax="CHTML"] > mjx-math.TEX-N > * {
  font-family: MJX-TEX-ZERO, MJX-TEX-N;
}

.markdown-rendered img { max-width: 100%; height: auto; border-radius: 4px; }

/* Mermaid diagrams carry their own scoped styles and resolved colours; this
   only handles placement. */
.markdown-rendered .mermaid-wrapper,
.markdown-rendered .mermaid { margin: 0 0 1.5rem; text-align: center; }
.markdown-rendered .mermaid svg { max-width: 100%; height: auto; }

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
.markdown-rendered .internal-embed,
.markdown-rendered .markdown-embed {
  display: block;
  border-left: 2px solid var(--osp-border);
  padding-left: 1.1rem;
  margin: 0 0 1.25rem;
}
.markdown-rendered .markdown-embed-title { display: none; }

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
  /* The table, not the page, takes the overflow. */
  display: block;
  overflow-x: auto;
}

.markdown-rendered .osp-base-table thead th {
  text-align: left;
  font-weight: 600;
  color: var(--osp-text-muted);
  border-bottom: 1px solid var(--osp-border);
  padding: 0.5rem 0.9rem 0.5rem 0;
  white-space: nowrap;
}

.markdown-rendered .osp-base-table tbody td {
  border-bottom: 1px solid var(--osp-border);
  padding: 0.6rem 0.9rem 0.6rem 0;
  vertical-align: top;
}

.markdown-rendered .osp-base-table tbody tr:last-child td { border-bottom: none; }

/* Numbers read as a column when they line up on the same edge. */
.markdown-rendered .osp-base-table td[data-property$="rating"],
.markdown-rendered .osp-base-table td[data-property$="pages"] {
  font-variant-numeric: tabular-nums;
}

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
