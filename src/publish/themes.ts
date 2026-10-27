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
    name: "press",
    label: "Press",
    description:
      "Editorial. Serif throughout, warm paper, generous margins. For long-form writing that wants to be read start to finish.",
    base: {
      "--osp-font-display": SERIF,
      "--osp-font-body": SERIF,
      "--osp-font-ui": SANS,
      "--osp-font-mono": MONO,
      "--osp-measure": "66ch",
      "--osp-base-size": "1.0625rem",
      "--osp-line-height": "1.7",
      "--osp-title-size": "clamp(2rem, 1.4rem + 2.4vw, 2.9rem)",
      "--osp-title-weight": "600",
      "--osp-title-tracking": "-0.02em",
      "--osp-heading-weight": "600",
      "--osp-radius": "3px",
      "--osp-rule": "1px",
      "--osp-eyebrow-tracking": "0.1em",
      "--osp-link-underline": "1px",
    },
    light: {
      "--osp-bg": "#fdfcf9",
      "--osp-surface": "#f4f1ea",
      "--osp-border": "#e3ded2",
      "--osp-text": "#211f1b",
      "--osp-text-muted": "#6d675c",
      "--osp-link": "#8a4b2a",
      "--osp-accent": "#8a4b2a",
      "--osp-code-comment": "#6d675c",
      "--osp-code-punct": "#5e5748",
      "--osp-code-keyword": "#8a4b2a",
      "--osp-code-string": "#41663f",
      "--osp-code-number": "#7c5a1b",
    },
    dark: {
      "--osp-bg": "#17160f",
      "--osp-surface": "#1f1e16",
      "--osp-border": "#34322a",
      "--osp-text": "#ece7da",
      "--osp-text-muted": "#9d9685",
      "--osp-link": "#e0a06a",
      "--osp-accent": "#e0a06a",
      "--osp-code-comment": "#9d9685",
      "--osp-code-punct": "#b7b0a0",
      "--osp-code-keyword": "#e0a06a",
      "--osp-code-string": "#a8c08a",
      "--osp-code-number": "#e3c07a",
    },
  },
  {
    name: "grove",
    label: "Grove",
    description:
      "Digital garden. Sans headings over a serif body, soft greens, rounded edges. For a vault that is browsed and wandered rather than read in order.",
    base: {
      "--osp-font-display": SANS,
      "--osp-font-body": SERIF,
      "--osp-font-ui": SANS,
      "--osp-font-mono": MONO,
      "--osp-measure": "64ch",
      "--osp-base-size": "1.0625rem",
      "--osp-line-height": "1.75",
      "--osp-title-size": "clamp(1.8rem, 1.3rem + 2vw, 2.4rem)",
      "--osp-title-weight": "700",
      "--osp-title-tracking": "-0.025em",
      "--osp-heading-weight": "650",
      "--osp-radius": "10px",
      "--osp-rule": "1px",
      "--osp-eyebrow-tracking": "0.06em",
      "--osp-link-underline": "2px",
    },
    light: {
      "--osp-bg": "#fcfdfb",
      "--osp-surface": "#eef3ea",
      "--osp-border": "#dce5d6",
      "--osp-text": "#1c211c",
      "--osp-text-muted": "#5f6b5d",
      "--osp-link": "#2f6d4f",
      "--osp-accent": "#3f8f63",
      "--osp-code-comment": "#5f6b5d",
      "--osp-code-punct": "#4d584c",
      "--osp-code-keyword": "#2f6d4f",
      "--osp-code-string": "#7a5a24",
      "--osp-code-number": "#39627f",
    },
    dark: {
      "--osp-bg": "#101512",
      "--osp-surface": "#17201a",
      "--osp-border": "#26332a",
      "--osp-text": "#e3eae1",
      "--osp-text-muted": "#93a194",
      "--osp-link": "#7fc79b",
      "--osp-accent": "#7fc79b",
      "--osp-code-comment": "#93a194",
      "--osp-code-punct": "#a9b5a9",
      "--osp-code-keyword": "#7fc79b",
      "--osp-code-string": "#d8b982",
      "--osp-code-number": "#8fb8d8",
    },
  },
  {
    name: "ink",
    label: "Ink",
    description:
      "Technical. Sans throughout, high contrast, tight and squared off. For reference material and notes with a lot of tables and code.",
    base: {
      "--osp-font-display": SANS,
      "--osp-font-body": SANS,
      "--osp-font-ui": SANS,
      "--osp-font-mono": MONO,
      "--osp-measure": "72ch",
      "--osp-base-size": "1rem",
      "--osp-line-height": "1.62",
      "--osp-title-size": "clamp(1.7rem, 1.3rem + 1.8vw, 2.25rem)",
      "--osp-title-weight": "700",
      "--osp-title-tracking": "-0.03em",
      "--osp-heading-weight": "650",
      "--osp-radius": "0px",
      "--osp-rule": "1px",
      "--osp-eyebrow-tracking": "0.12em",
      "--osp-link-underline": "1px",
    },
    light: {
      "--osp-bg": "#ffffff",
      "--osp-surface": "#f4f5f7",
      "--osp-border": "#dfe2e7",
      "--osp-text": "#13161a",
      "--osp-text-muted": "#636b76",
      "--osp-link": "#1a56c4",
      "--osp-accent": "#1a56c4",
      "--osp-code-comment": "#636b76",
      "--osp-code-punct": "#4e5662",
      "--osp-code-keyword": "#1a56c4",
      "--osp-code-string": "#0a6b4a",
      "--osp-code-number": "#8a3fa0",
    },
    dark: {
      "--osp-bg": "#0e1013",
      "--osp-surface": "#171a1f",
      "--osp-border": "#272c33",
      "--osp-text": "#e8eaed",
      "--osp-text-muted": "#99a1ad",
      "--osp-link": "#7aa6f8",
      "--osp-accent": "#7aa6f8",
      "--osp-code-comment": "#99a1ad",
      "--osp-code-punct": "#aeb6c2",
      "--osp-code-keyword": "#7aa6f8",
      "--osp-code-string": "#7fd1a8",
      "--osp-code-number": "#d6a2e8",
    },
  },
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
      "--osp-measure": "68ch",
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
      "--osp-measure": "70ch",
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
      "--osp-measure": "68ch",
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
      "--osp-measure": "66ch",
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
      "--osp-measure": "67ch",
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

export const DEFAULT_THEME = "press";

export function getTheme(name: string | undefined): Theme {
  return (
    THEMES.find((theme) => theme.name === name) ??
    THEMES.find((theme) => theme.name === DEFAULT_THEME) ??
    THEMES[0]
  );
}

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

${block(theme.light)}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${block(theme.dark, "    ")}
  }
}

:root[data-theme="dark"] {
${block(theme.dark)}
}
`;
}
