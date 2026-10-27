/**
 * The floor every palette has to clear.
 *
 * A theme is a hand-picked set of colours, so nothing but a test stops the
 * next one from shipping grey-on-grey. The checks here are the two that
 * cannot be eyeballed reliably: that a theme defines the whole token set in
 * both schemes, and that every colour meeting the reader's eye clears
 * WCAG AA against *both* surfaces it can land on.
 *
 * Both surfaces matters. Body text sits on `--osp-bg` in the article but on
 * `--osp-surface` inside a callout, a table head or a code block, and a
 * palette checked only against the page background passes while its links
 * are unreadable in a callout.
 */

import { describe, expect, it } from "vitest";
import { THEMES, getTheme, themeTokensCss } from "./themes";

/** Relative luminance, per WCAG 2.1. */
function luminance(hex: string): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const digits = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** Tokens that carry text, and must therefore be legible. */
const INK = [
  "--osp-text",
  "--osp-text-muted",
  "--osp-link",
  "--osp-code-comment",
  "--osp-code-punct",
  "--osp-code-keyword",
  "--osp-code-string",
  "--osp-code-number",
];

/** Tokens a theme has to supply, over and above the ink above. */
const PAINT = ["--osp-bg", "--osp-surface", "--osp-border", "--osp-accent"];

const BASE = [
  "--osp-font-display",
  "--osp-font-body",
  "--osp-font-ui",
  "--osp-font-mono",
  "--osp-measure",
  "--osp-base-size",
  "--osp-line-height",
  "--osp-title-size",
  "--osp-title-weight",
  "--osp-title-tracking",
  "--osp-heading-weight",
  "--osp-radius",
  "--osp-rule",
  "--osp-eyebrow-tracking",
  "--osp-link-underline",
];

describe("every theme", () => {
  it.each(THEMES.map((theme) => [theme.name, theme] as const))(
    "%s defines the whole token set",
    (_name, theme) => {
      expect(Object.keys(theme.base).sort()).toEqual([...BASE].sort());
      for (const scheme of [theme.light, theme.dark]) {
        expect(Object.keys(scheme).sort()).toEqual([...INK, ...PAINT].sort());
      }
    },
  );

  it.each(
    THEMES.flatMap((theme) =>
      (["light", "dark"] as const).map(
        (mode) => [`${theme.name}/${mode}`, theme[mode]] as const,
      ),
    ),
  )("%s is legible on the page and inside a panel", (_label, palette) => {
    const failures = INK.flatMap((token) =>
      ["--osp-bg", "--osp-surface"]
        .map((ground) => ({
          ground,
          token,
          ratio: contrast(palette[token], palette[ground]),
        }))
        .filter((check) => check.ratio < 4.5)
        .map((check) => `${check.token} on ${check.ground}: ${check.ratio.toFixed(2)}`),
    );
    expect(failures).toEqual([]);
  });

  it("has a unique name and label", () => {
    expect(new Set(THEMES.map((t) => t.name)).size).toBe(THEMES.length);
    expect(new Set(THEMES.map((t) => t.label)).size).toBe(THEMES.length);
  });

  it("emits both ways of being dark, and pins light over a dark system", () => {
    const css = themeTokensCss(getTheme("phosphor"));
    expect(css).toContain(`@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {`);
    expect(css).toContain(`:root[data-theme="dark"] {`);
    // The dark palette appears under both, not just the media query.
    expect(css.match(/--osp-bg: #0a0a0a;/g)).toHaveLength(2);
  });
});

describe("getTheme", () => {
  it("falls back to the default rather than throwing on an unknown name", () => {
    expect(getTheme("no-such-theme").name).toBe("press");
    expect(getTheme(undefined).name).toBe("press");
  });

  it("finds every theme by its own name", () => {
    for (const theme of THEMES) expect(getTheme(theme.name)).toBe(theme);
  });
});
