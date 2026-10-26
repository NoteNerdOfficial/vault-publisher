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
 * **Themes differ in more than colour.** Swapping a palette produces three
 * versions of the same page. These differ in type pairing, measure, scale,
 * rhythm, corner radius and rule weight, because that is what makes a design
 * feel chosen rather than tinted.
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
