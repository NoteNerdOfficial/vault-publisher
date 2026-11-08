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
import { DEFAULT_THEME, THEMES, getTheme, themeTokensCss } from "./themes";
import { THEME_LAYER, siteCss } from "./theme";

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
    expect(getTheme("no-such-theme").name).toBe(DEFAULT_THEME);
    expect(getTheme(undefined).name).toBe(DEFAULT_THEME);
  });

  // Sites built before a theme was retired still carry its name.
  it("survives a name that used to be a theme", () => {
    for (const retired of ["press", "grove", "ink"]) {
      expect(getTheme(retired).name).toBe(DEFAULT_THEME);
    }
  });

  it("names a default that exists", () => {
    expect(THEMES.map((theme) => theme.name)).toContain(DEFAULT_THEME);
  });

  it("finds every theme by its own name", () => {
    for (const theme of THEMES) expect(getTheme(theme.name)).toBe(theme);
  });
});

/**
 * What makes an author's own stylesheet able to win.
 *
 * The tokens are declared inside a cascade layer and nothing else is, so an
 * unlayered `:root { --osp-link: ... }` appended to the end of the file beats
 * them in both colour schemes without a word of selector ceremony. The two
 * halves of that arrangement are load-bearing in opposite directions, which
 * is what these hold.
 */
describe("the theme layer", () => {
  /** The at-rule and its contents, found by counting braces. */
  function layerBlock(css: string, name: string): string {
    const open = css.indexOf(`@layer ${name} {`);
    expect(open).toBeGreaterThan(-1);
    let depth = 0;
    for (let at = css.indexOf("{", open); at < css.length; at++) {
      if (css[at] === "{") depth++;
      else if (css[at] === "}" && --depth === 0) return css.slice(open, at + 1);
    }
    throw new Error("the theme layer is never closed");
  }

  const css = siteCss(DEFAULT_THEME);
  const inLayer = layerBlock(css, THEME_LAYER);
  const outside = css.replace(inLayer, "");

  it("declares the tokens inside the layer", () => {
    expect(css).toContain(`@layer ${THEME_LAYER} {`);
    expect(inLayer).toContain("--osp-link:");
    expect(inLayer).toContain("--osp-font-body:");
  });

  // The other half: the structural rules have to stay out of any layer,
  // because they are what beats the harvested `assets/obsidian.css`, which
  // is unlayered and loaded first. Layer them and Obsidian's own rules win
  // every disagreement about the site's typography.
  it("leaves the structural rules unlayered", () => {
    expect(outside).toContain(".osp-article");
    expect(outside).not.toContain("@layer");
  });

  /*
   * And the reason the split is safe. Layered and unlayered declarations of
   * the same property no longer resolve by specificity, so a token declared
   * in both halves would silently change which one wins. None is, and this
   * is what notices if one ever is.
   */
  it("declares no custom property in both halves", () => {
    const declared = (text: string) =>
      new Set(
        Array.from(text.matchAll(/^\s*(--osp-[a-z0-9-]+):/gm)).map((hit) => hit[1]),
      );
    const both = [...declared(inLayer)].filter((name) => declared(outside).has(name));
    expect(both).toEqual([]);
  });
});

/*
 * Obsidian's own diagram renderer, which colours itself from custom
 * properties instead of from literal values.
 *
 * It emits `fill="var(--pele-surface,#f3f3f3)"` and leaves the names to the
 * page. The harvested app stylesheet maps those onto `--mermaid-*` and then
 * onto `--text-normal` and friends, none of which exists once the page is
 * published -- so unanswered, every chain falls back to the light default
 * baked into the attribute. A dark site then got light boxes with the
 * blanket text rule painting near-white labels on them, which is a diagram
 * nobody can read rather than a diagram with the wrong palette.
 *
 * Both halves of the answer are held here because both are easy to undo by
 * accident: the names below look unused to anything that greps this repo
 * for them, and the exclusion looks like a selector that could be
 * simplified.
 */
describe("diagram variables", () => {
  const css = siteCss(DEFAULT_THEME);

  const COLOURS = [
    "background",
    "text-color",
    "muted-color",
    "line-color",
    "surface",
    "surface-alt",
    "border-color",
    "accent",
  ];

  it("answers both namespaces the renderer might read", () => {
    for (const name of COLOURS) {
      expect(css, `--mermaid-${name}`).toContain(`--mermaid-${name}: var(--osp-`);
    }
    for (const name of ["bg", "fg", "muted", "line", "surface", "surface-alt", "border", "accent"]) {
      expect(css, `--pele-${name}`).toContain(`--pele-${name}: var(--osp-`);
    }
  });

  /*
   * On `body`, not on `:root`. The harvested stylesheet declares the same
   * names on `body`, and a declaration on the element beats one inherited
   * from its parent -- so at `:root` these would be shadowed and the fix
   * would quietly do nothing. This is the whole reason it works.
   */
  it("declares them where they beat the harvested stylesheet", () => {
    // Comments first: they hold braces and prose about these very names,
    // and a selector read out of the raw text picks up whichever sentence
    // happens to precede the rule.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

    /** The selector of the rule a declaration sits in. */
    const selectorOf = (declaration: string): string => {
      const at = bare.indexOf(declaration);
      expect(at, declaration).toBeGreaterThan(-1);
      const open = bare.lastIndexOf("{", at);
      const from = Math.max(bare.lastIndexOf("}", open), bare.lastIndexOf(";", open));
      return bare.slice(from + 1, open).trim();
    };

    expect(selectorOf("--mermaid-text-color:")).toBe("body");
    expect(selectorOf("--pele-fg:")).toBe("body");
  });

  /*
   * Every value resolves through `--osp-*`, which is already redeclared for
   * dark -- that indirection is what makes a diagram follow the light/dark
   * switch without a second copy of this block under a media query.
   */
  it("resolves every value through a theme token", () => {
    for (const hit of css.matchAll(/^\s*--(?:mermaid|pele)-[a-z-]+:\s*([^;]+);/gm)) {
      expect(hit[1].trim(), hit[0].trim()).toMatch(/^var\(--osp-[a-z-]+\)$/);
    }
  });

  /*
   * And the blanket text rule stays off this renderer, which uses the fill
   * of a label to mean something: a pie paints its slice labels in the
   * background colour so they read against a saturated wedge.
   */
  it("keeps the blanket text rule away from it", () => {
    const rule = css.slice(css.indexOf(".markdown-rendered .mermaid svg:not(.pele) text"));
    expect(css).toContain(".markdown-rendered .mermaid svg:not(.pele) text");
    expect(rule.slice(0, rule.indexOf("}"))).not.toMatch(/\.mermaid svg (?!:not)/);
  });

  /*
   * The categorical series colours are deliberately not answered: they are
   * a diagram's data rather than its furniture, and the renderer's own
   * defaults read on either background. If a palette is ever added, it
   * belongs in themes.ts per theme rather than mixed from one accent here.
   */
  it("leaves the series palette to the renderer", () => {
    expect(css).not.toContain("--mermaid-color-1");
    expect(css).not.toContain("--pele-series-1");
  });
});
