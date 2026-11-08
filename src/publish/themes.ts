/**
 * The themes a published site can be built with.
 *
 * A theme here is a set of custom properties, never a fork of the
 * stylesheet. Every rule in `theme.ts` is written against these names, so
 * adding a look means adding a palette and a type pairing rather than
 * maintaining a second copy of the layout. That constraint is what keeps
 * "a few curated themes" from degenerating into a theme API nobody can
 * support.
 *
 * Two deliberate decisions:
 *
 * **System fonts only, no webfont requests.** A published page makes zero
 * external requests. Partly it is speed and partly it is that a knowledge
 * site on a corporate network should not phone a font CDN on every page view,
 * and may not be able to. The cost is that the type pairings are chosen from
 * what ships with the OS rather than from anything distinctive.
 *
 * **Themes differ in more than colour.** Swapping a palette alone would give
 * one page in several coats of paint. These differ in type pairing, measure,
 * scale, rhythm, corner radius and rule weight, because that is what makes a
 * design feel chosen rather than tinted.
 *
 * **`--osp-measure` is a `rem`, never a `ch`.** It reads like a measure in
 * characters and it was one, but `ch` is resolved against the font of the
 * element that uses it, and the measure is applied to a good deal more than
 * the article: the stats line above a note on a narrow screen, the
 * mentions, the source pane, the generated lists, and until recently the
 * properties row. Several of those are set in the UI font, at 0.8125rem or
 * 0.6875rem, so one token produced three different column widths. The rule
 * under a note's title ended 133px short of the callout below it, and the
 * stats line 110px short, both of them written against the same number. A
 * `rem` is resolved against the root, so every consumer lands on the same
 * edge whatever type it is set in. The values below are each theme's old
 * `ch` width resolved in its own body font and rounded to the nearest
 * quarter rem, so no theme's column moved by more than about a pixel and a
 * half. They are fixed widths now rather than widths that track the
 * reader's font: that is the trade, and it is the right way round, because
 * a token applied in eight places has to mean one width.
 *
 * **Every colour clears 4.5:1 against the two surfaces it can land on.** Text
 * sits on `--osp-bg` in the article and on `--osp-surface` inside a callout,
 * a table head or a code block, so a palette that only passes against the
 * page background is half-checked. `themes.test.ts` holds that floor, which
 * is why several of these values are a shade darker than the site they were
 * drawn from.
 */

export interface Theme {
  /** Stable id, used in config and as the generated file's marker. */
  name: string;
  /** Shown when picking a theme. */
  label: string;
  description: string;
  /** Custom properties shared by both colour schemes. */
  base: Record<string, string>;
  light: Record<string, string>;
  dark: Record<string, string>;
}

const SERIF = `ui-serif, Georgia, Cambria, "Times New Roman", serif`;
const SANS = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

export const THEMES: Theme[] = [
  {
    name: "studio",
    label: "Studio",
    description:
      "Product documentation. White paper, near-black type, one confident violet, soft corners. For a vault that documents something other people have to use.",
    base: {
      "--osp-font-display": SANS,
      "--osp-font-body": SANS,
      "--osp-font-ui": SANS,
      "--osp-font-mono": MONO,
      "--osp-measure": "42.75rem",
      "--osp-base-size": "1rem",
      "--osp-line-height": "1.7",
      "--osp-title-size": "clamp(1.9rem, 1.4rem + 2vw, 2.5rem)",
      "--osp-title-weight": "650",
      "--osp-title-tracking": "-0.03em",
      "--osp-heading-weight": "650",
      "--osp-radius": "8px",
      "--osp-rule": "1px",
      "--osp-eyebrow-tracking": "0.08em",
      "--osp-link-underline": "1px",
    },
    light: {
      "--osp-bg": "#ffffff",
      "--osp-surface": "#f4f4f7",
      "--osp-border": "#e4e4ea",
      "--osp-text": "#09090b",
      "--osp-text-muted": "#52525b",
      "--osp-link": "#4945ff",
      "--osp-accent": "#4945ff",
      "--osp-code-comment": "#656c7a",
      "--osp-code-punct": "#52525b",
      "--osp-code-keyword": "#4945ff",
      "--osp-code-string": "#0f766e",
      "--osp-code-number": "#b45309",
    },
    dark: {
      "--osp-bg": "#111113",
      "--osp-surface": "#1c1c20",
      "--osp-border": "#2c2c33",
      "--osp-text": "#fafafa",
      "--osp-text-muted": "#a1a1aa",
      "--osp-link": "#8d8bff",
      "--osp-accent": "#8d8bff",
      "--osp-code-comment": "#8b8fa3",
      "--osp-code-punct": "#a1a1aa",
      "--osp-code-keyword": "#a5a3ff",
      "--osp-code-string": "#5eead4",
      "--osp-code-number": "#fbbf24",
    },
  },
  {
    name: "slate",
    label: "Slate",
    description:
      "Monochrome. Tightly set sans, white panels on grey paper in light and true black in dark. For notes where colour should mean a link and nothing else.",
    base: {
      "--osp-font-display": SANS,
      "--osp-font-body": SANS,
      "--osp-font-ui": SANS,
      "--osp-font-mono": MONO,
      "--osp-measure": "44rem",
      "--osp-base-size": "1rem",
      "--osp-line-height": "1.65",
      "--osp-title-size": "clamp(1.9rem, 1.4rem + 2.2vw, 2.75rem)",
      "--osp-title-weight": "650",
      "--osp-title-tracking": "-0.045em",
      "--osp-heading-weight": "600",
      "--osp-radius": "6px",
      "--osp-rule": "1px",
      "--osp-eyebrow-tracking": "0.1em",
      "--osp-link-underline": "1px",
    },
    light: {
      "--osp-bg": "#fafafa",
      "--osp-surface": "#ffffff",
      "--osp-border": "#e6e6e6",
      "--osp-text": "#171717",
      "--osp-text-muted": "#666666",
      "--osp-link": "#0063d1",
      "--osp-accent": "#0063d1",
      "--osp-code-comment": "#737373",
      "--osp-code-punct": "#525252",
      "--osp-code-keyword": "#0063d1",
      "--osp-code-string": "#067a4e",
      "--osp-code-number": "#7e22ce",
    },
    dark: {
      "--osp-bg": "#000000",
      "--osp-surface": "#0e0e0e",
      "--osp-border": "#262626",
      "--osp-text": "#ededed",
      "--osp-text-muted": "#a1a1a1",
      "--osp-link": "#6cb6ff",
      "--osp-accent": "#6cb6ff",
      "--osp-code-comment": "#8f8f8f",
      "--osp-code-punct": "#b4b4b4",
      "--osp-code-keyword": "#6cb6ff",
      "--osp-code-string": "#4ade80",
      "--osp-code-number": "#c084fc",
    },
  },
  {
    name: "phosphor",
    label: "Phosphor",
    description:
      "Terminal, calmed down. Mono headings and a green signal over neutral paper or neutral near-black -- the green marks links, syntax and callouts, and the page itself has no cast. For a vault full of commands, configuration and output.",
    base: {
      "--osp-font-display": MONO,
      "--osp-font-body": SANS,
      "--osp-font-ui": SANS,
      "--osp-font-mono": MONO,
      "--osp-measure": "42.75rem",
      "--osp-base-size": "1rem",
      "--osp-line-height": "1.68",
      "--osp-title-size": "clamp(1.55rem, 1.25rem + 1.5vw, 2rem)",
      "--osp-title-weight": "600",
      "--osp-title-tracking": "-0.01em",
      "--osp-heading-weight": "600",
      "--osp-radius": "2px",
      "--osp-rule": "1px",
      "--osp-eyebrow-tracking": "0.14em",
      "--osp-link-underline": "1px",
    },
    light: {
      "--osp-bg": "#f7f7f7",
      "--osp-surface": "#ededed",
      "--osp-border": "#d6d6d6",
      "--osp-text": "#1a1a1a",
      "--osp-text-muted": "#5c5c5c",
      "--osp-link": "#0f7a3d",
      "--osp-accent": "#0f7a3d",
      "--osp-code-comment": "#6b6b6b",
      "--osp-code-punct": "#3f3f3f",
      "--osp-code-keyword": "#0f7a3d",
      "--osp-code-string": "#1d6a52",
      "--osp-code-number": "#7a5c00",
    },
    dark: {
      "--osp-bg": "#0a0a0a",
      "--osp-surface": "#141414",
      "--osp-border": "#272727",
      "--osp-text": "#e4e4e4",
      "--osp-text-muted": "#8f8f8f",
      "--osp-link": "#4ade80",
      "--osp-accent": "#39d353",
      "--osp-code-comment": "#828282",
      "--osp-code-punct": "#b4b4b4",
      "--osp-code-keyword": "#39d353",
      "--osp-code-string": "#a7f3d0",
      "--osp-code-number": "#d9f99d",
    },
  },
  {
    name: "solar",
    label: "Solar",
    description:
      "Low glare. Warm sand and burnt orange in light, a dark that stays warm rather than going blue. For a site read for an hour at a time.",
    base: {
      "--osp-font-display": SANS,
      "--osp-font-body": SANS,
      "--osp-font-ui": SANS,
      "--osp-font-mono": MONO,
      "--osp-measure": "44.25rem",
      "--osp-base-size": "1.0625rem",
      "--osp-line-height": "1.72",
      "--osp-title-size": "clamp(1.8rem, 1.35rem + 1.9vw, 2.4rem)",
      "--osp-title-weight": "600",
      "--osp-title-tracking": "-0.02em",
      "--osp-heading-weight": "600",
      "--osp-radius": "6px",
      "--osp-rule": "1px",
      "--osp-eyebrow-tracking": "0.09em",
      "--osp-link-underline": "1px",
    },
    light: {
      "--osp-bg": "#faf6ee",
      "--osp-surface": "#f1e9da",
      "--osp-border": "#e0d4bd",
      "--osp-text": "#2b2620",
      "--osp-text-muted": "#6d6051",
      "--osp-link": "#9c4410",
      "--osp-accent": "#b4531a",
      "--osp-code-comment": "#756654",
      "--osp-code-punct": "#5b5142",
      "--osp-code-keyword": "#9c4410",
      "--osp-code-string": "#3f6b43",
      "--osp-code-number": "#8a5a12",
    },
    dark: {
      "--osp-bg": "#17130f",
      "--osp-surface": "#201b15",
      "--osp-border": "#342c23",
      "--osp-text": "#ece1d1",
      "--osp-text-muted": "#a3927b",
      "--osp-link": "#e8a765",
      "--osp-accent": "#e8a765",
      "--osp-code-comment": "#9a8970",
      "--osp-code-punct": "#bdae97",
      "--osp-code-keyword": "#e8a765",
      "--osp-code-string": "#a8c08a",
      "--osp-code-number": "#e3c07a",
    },
  },
  {
    name: "harbor",
    label: "Harbor",
    description:
      "Expressive. Sans headings over a serif body, deep navy and a coral signal, generously rounded. For a vault with a point of view rather than a reference shelf.",
    base: {
      "--osp-font-display": SANS,
      "--osp-font-body": SERIF,
      "--osp-font-ui": SANS,
      "--osp-font-mono": MONO,
      "--osp-measure": "43.75rem",
      "--osp-base-size": "1.0625rem",
      "--osp-line-height": "1.72",
      "--osp-title-size": "clamp(1.9rem, 1.4rem + 2vw, 2.6rem)",
      "--osp-title-weight": "700",
      "--osp-title-tracking": "-0.03em",
      "--osp-heading-weight": "650",
      "--osp-radius": "12px",
      "--osp-rule": "1px",
      "--osp-eyebrow-tracking": "0.08em",
      "--osp-link-underline": "2px",
    },
    light: {
      "--osp-bg": "#f8fafc",
      "--osp-surface": "#eaf0f6",
      "--osp-border": "#d5dfea",
      "--osp-text": "#0f1b2a",
      "--osp-text-muted": "#54657a",
      "--osp-link": "#c23b4e",
      "--osp-accent": "#c23b4e",
      "--osp-code-comment": "#5c6d82",
      "--osp-code-punct": "#44576d",
      "--osp-code-keyword": "#c23b4e",
      "--osp-code-string": "#1f6f5c",
      "--osp-code-number": "#1d4ed8",
    },
    dark: {
      "--osp-bg": "#0b1320",
      "--osp-surface": "#121d2d",
      "--osp-border": "#20304a",
      "--osp-text": "#e6edf5",
      "--osp-text-muted": "#8ea2b8",
      "--osp-link": "#ff8491",
      "--osp-accent": "#ff8491",
      "--osp-code-comment": "#7e93aa",
      "--osp-code-punct": "#a7b8cb",
      "--osp-code-keyword": "#ff8491",
      "--osp-code-string": "#7fd1a8",
      "--osp-code-number": "#8ab4ff",
    },
  },
];

export const DEFAULT_THEME = "studio";

/**
 * The theme a name asks for, or the default.
 *
 * Never throws and never returns undefined, because the name comes out of a
 * settings file that can outlive the theme it points at. A site configured
 * for a theme that has since been retired should rebuild looking like
 * something, and say so in the settings tab, rather than fail the build.
 */
export function getTheme(name: string | undefined): Theme {
  return (
    THEMES.find((theme) => theme.name === name) ??
    THEMES.find((theme) => theme.name === DEFAULT_THEME) ??
    THEMES[0]
  );
}

/**
 * What focus and shadow mean once the page is dark.
 *
 * The focus edge keeps the accent's lightness and gives up most of its
 * chroma, by mixing it into the muted text grey: enough hue left that the
 * live field is still recognisably this site's, not enough to glow. Removing
 * the colour outright was the other option and it reads as a disabled field
 * -- the background barely moves on focus, so the edge is the whole signal.
 *
 * The shadow becomes real black. On a dark page a shadow can only deepen
 * what is already dark, which is why the separation of a panel there is its
 * border rather than its shadow -- and why every panel here has one.
 */
const DARK_INK = (indent = "  "): string =>
  [
    `${indent}--osp-focus: color-mix(in srgb, var(--osp-accent) 38%, var(--osp-text-muted));`,
    `${indent}--osp-shadow: #000;`,
  ].join("\n");

function block(vars: Record<string, string>, indent = "  "): string {
  return Object.entries(vars)
    .map(([key, value]) => `${indent}${key}: ${value};`)
    .join("\n");
}

/**
 * The custom-property layer for a theme.
 *
 * Dark mode is emitted twice on purpose: once under a media query for
 * visitors whose system is dark, and once under an explicit attribute so a
 * site can be pinned. The media query is guarded against `data-theme="light"`
 * so pinning to light actually wins on a dark system.
 */
export function themeTokensCss(theme: Theme): string {
  return `/* Theme: ${theme.label} -- ${theme.description} */

:root {
${block(theme.base)}

  /* Obsidian's serialized Mermaid SVGs reference this variable by name. */
  --font-mermaid: var(--osp-font-ui);

  --osp-gutter: 1.5rem;

  /* Two values a light palette gets for free and a dark one does not.

     The edge a focused field draws is the accent, which on white is a
     confident line and on near-black is a lit one: the same hue at the same
     chroma against a background twenty times darker blooms, and the field
     ends up the brightest object on the page.

     A shadow is worse, because it is not a colour at all -- it is the
     absence of light. Built out of the text colour it comes out near-black
     on a white page, which is right by accident, and near-white on a dark
     one, which is a halo. Same for the scrim the drawer sits over.

     So both are named here rather than written into the rules, defaulted to
     what light mode was already doing, and given a dark answer below. A
     theme that wants its own can set either in its own block, which comes
     after these. */
  --osp-focus: var(--osp-accent);
  --osp-shadow: var(--osp-text);

${block(theme.light)}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${DARK_INK("    ")}
${block(theme.dark, "    ")}
  }
}

:root[data-theme="dark"] {
${DARK_INK()}
${block(theme.dark)}
}
`;
}
