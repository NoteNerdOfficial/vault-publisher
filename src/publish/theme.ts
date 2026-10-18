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

.osp-shell {
  display: grid;
  /* The text column is sized to the reading measure rather than to the
     available space, so the table of contents sits beside the text instead
     of being pushed to the window edge with a dead gap between them. */
  grid-template-columns: minmax(0, var(--osp-measure)) minmax(0, 14rem);
  grid-template-areas: "header header" "main rail";
  gap: 0 3.5rem;
  justify-content: center;
  max-width: 76rem;
  margin: 0 auto;
  padding: 0 var(--osp-gutter) 6rem;
}

.osp-header {
  grid-area: header;
  padding: 2rem 0 3rem;
}

.osp-site-name {
  font-family: var(--osp-font-ui);
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: var(--osp-eyebrow-tracking);
  text-transform: uppercase;
  color: var(--osp-text-muted);
  text-decoration: none;
}
.osp-site-name:hover { color: var(--osp-accent); }

.osp-main { grid-area: main; min-width: 0; }
.osp-article { max-width: var(--osp-measure); }

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

.osp-rail { grid-area: rail; }
.osp-toc {
  position: sticky;
  top: 2rem;
  font-family: var(--osp-font-ui);
  font-size: 0.8125rem;
  line-height: 1.5;
  border-left: var(--osp-rule) solid var(--osp-border);
  padding-left: 1rem;
}
.osp-toc ul { list-style: none; margin: 0; padding: 0; }
.osp-toc-item { margin: 0.4rem 0; }
.osp-toc-h3 { padding-left: 0.85rem; }
.osp-toc a { color: var(--osp-text-muted); text-decoration: none; }
.osp-toc a:hover { color: var(--osp-text); }

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
  background: var(--osp-surface);
  border: 1px solid var(--osp-border);
  border-left: 3px solid var(--osp-accent);
  border-radius: 4px;
  padding: 0.9rem 1.1rem;
  margin: 0 0 1.25rem;
  font-family: var(--osp-font-ui);
  font-size: 0.9375rem;
}
.markdown-rendered .callout-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  margin-bottom: 0.35rem;
}
.markdown-rendered .callout-title-inner { font-weight: 600; }
.markdown-rendered .callout-content > :last-child { margin-bottom: 0; }
/* A collapsed callout would publish with its body hidden and no way to open
   it, so published callouts are always expanded. */
.markdown-rendered .callout.is-collapsed .callout-content { display: block; }
.markdown-rendered .callout-fold { display: none; }

.markdown-rendered .task-list-item { list-style: none; }
.markdown-rendered .task-list-item input { margin-right: 0.5rem; }

.markdown-rendered mjx-container { overflow-x: auto; max-width: 100%; }

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

@media (max-width: 60rem) {
  .osp-shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "header" "main" "rail";
    gap: 0;
  }
  .osp-rail { margin-top: 3rem; }
  .osp-toc { position: static; }
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

/* --- index ----------------------------------------------------------- */

.osp-index { list-style: none; margin: 0; padding: 0; max-width: var(--osp-measure); }
.osp-index li { border-bottom: 1px solid var(--osp-border); }
.osp-index a {
  display: block;
  padding: 0.9rem 0;
  color: var(--osp-text);
  text-decoration: none;
  font-family: var(--osp-font-ui);
}
.osp-index a:hover { color: var(--osp-link); }
.osp-index-path {
  display: block;
  font-size: 0.75rem;
  color: var(--osp-text-muted);
  margin-top: 0.15rem;
}
`;

/** The full stylesheet for a site built with the named theme. */
export function siteCss(themeName?: string): string {
  const theme = getTheme(themeName);
  return `/* Generated by vault-publisher. Theme: ${theme.name}. */\n\n${themeTokensCss(theme)}\n${STRUCTURE_CSS}`;
}

/** Backwards-compatible default, used where no theme has been chosen yet. */
export const SITE_CSS = siteCss();
