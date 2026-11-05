/**
 * Taking the CSS that only Obsidian has.
 *
 * Most of the published look is ours to write, and should be: that is where
 * the design lives. But some rendered output is not styled so much as
 * *constructed* by CSS, and re-authoring it would mean reverse-engineering
 * someone else's layout and then keeping up with their changes.
 *
 * MathJax is the clearest case. It injects stylesheets at runtime that
 * position every glyph in an equation; without them a fraction collapses
 * into its numerator and denominator run together. Bases is the same story
 * with grid layout.
 *
 * The stylesheet probe established all of Obsidian's sheets are readable from
 * script, so we can lift exactly the rules we need and ship them alongside
 * our own. Everything else stays ours.
 */

import { requestUrl } from "obsidian";

export interface HarvestRule {
  /** Where it came from, for the generated file's comments. */
  origin: string;
  cssText: string;
}

export interface HarvestedAsset {
  path: string;
  content: ArrayBuffer;
}

/**
 * Selector prefixes whose rules we take. Deliberately narrow: harvesting
 * broadly would drag in Obsidian's own typography and colours and fight the
 * site's design, which is the opposite of the point.
 */
export const DEFAULT_HARVEST_PREFIXES = [
  "mjx-",        // MathJax layout, injected at runtime
  ".MJX",
  ".bases-",     // Bases grid and cell layout
  ".dataview",   // Dataview result structure
  // `.table-view-` is deliberately absent. Those rules are not structure:
  // they set the header's weight and size, a medium `currentcolor` border
  // under it, and `border-style: none` on every cell. All three outrank the
  // site's own table rules by one element in the selector, so a Dataview
  // table published with them looked like Obsidian's table in the middle of
  // our page -- a black rule, a shouting header, and no row separators.
  // A Dataview result is a real <table>; the stylesheet already knows what
  // to do with one.
  ".mermaid",
  ".callout",    // Callout internals we do not re-author
  ".internal-embed",
  ".markdown-embed",
  ".task-list",
  ".footnote",
  ".math",
];

function selectorMatchesPrefixes(selector: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => selector.includes(prefix));
}

/**
 * Custom properties a harvested rule depends on are usually *declared*
 * somewhere else entirely -- `body { --bases-table-row-height: 32px }` -- and
 * that selector matches none of our prefixes. Harvesting the rules that use a
 * variable while leaving behind the rule that defines it produces layout that
 * is subtly, confusingly wrong: Bases came out with its header overlapping
 * the first row because every sizing variable resolved to nothing.
 *
 * So a rule also qualifies when it declares a custom property named after one
 * of the prefixes, whatever it is attached to.
 */
function declaresMatchingVariable(rule: CSSStyleRule, prefixes: string[]): boolean {
  for (const property of Array.from(rule.style)) {
    if (!property.startsWith("--")) continue;
    if (prefixes.some((prefix) => property.includes(prefix.replace(/^\./, "")))) {
      return true;
    }
  }
  return false;
}

/**
 * Keeps only the custom-property declarations from a rule, so harvesting
 * `body { --bases-x: 1px; font-family: ...; color: ... }` takes the variable
 * without also importing Obsidian's typography onto the site's body.
 */
function variablesOnly(rule: CSSStyleRule, prefixes: string[]): string {
  const declarations: string[] = [];
  for (const property of Array.from(rule.style)) {
    if (!property.startsWith("--")) continue;
    if (!prefixes.some((prefix) => property.includes(prefix.replace(/^\./, "")))) continue;
    declarations.push(`${property}: ${rule.style.getPropertyValue(property).trim()};`);
  }
  return `${rule.selectorText} { ${declarations.join(" ")} }`;
}

/**
 * MathJax's layout rules refer to custom fonts such as MJXTEX and MJXZERO.
 * These are CSSFontFaceRules rather than selector rules, so they cannot be
 * found by selectorMatchesPrefixes but are still required for correct glyph
 * metrics (fractions, integrals, superscripts, and stretchy delimiters).
 */
function isMathJaxFontFace(rule: CSSFontFaceRule): boolean {
  const family = rule.style.getPropertyValue("font-family").toLowerCase();
  return family.includes("mjx");
}

/**
 * Walks the loaded stylesheets and returns the rules whose selectors mention
 * one of `prefixes`. At-rules are recursed into so media-query and supports
 * blocks are not silently dropped, and are re-emitted with their condition.
 */
export function harvestCss(
  prefixes: string[] = DEFAULT_HARVEST_PREFIXES,
): HarvestRule[] {
  const harvested: HarvestRule[] = [];

  for (const sheet of Array.from(document.styleSheets)) {
    const origin = sheet.href ?? (sheet.ownerNode as HTMLElement | null)?.id ?? "inline";

    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // A sheet we cannot read is a sheet we cannot harvest. The probe says
      // this does not currently happen, but a future Obsidian could load one
      // cross-origin and this should degrade rather than throw.
      continue;
    }

    collectRules(rules, prefixes, origin, harvested);
  }

  return harvested;
}

/**
 * Reads one harvested font, by whichever request path can reach it.
 *
 * Two paths, chosen by scheme, because neither one can do both jobs.
 *
 * `requestUrl` is the host's own request function and the right answer for
 * the network: it is not subject to the page's CORS rules, and the tests can
 * stand in for it. What it cannot do is a local resource. It is built on
 * Electron's `ClientRequest`, which refuses every other scheme with
 * "ClientRequest only supports http: and https: protocols" -- and the fonts
 * this function exists to copy are at `app://` URLs inside the app's own
 * origin, as the comment above says. Sending those through `requestUrl`
 * failed every build in a vault that had any MathJax CSS loaded.
 *
 * `fetch` reads them, because Electron registers `app:` as a standard scheme.
 * Reached as `window.fetch` rather than bare `fetch`: it is the window's, a
 * read of a local resource is not a network request, and the lint rule that
 * sends network requests through `requestUrl` is right about the case it is
 * about.
 */
async function readFontBytes(source: string): Promise<ArrayBuffer> {
  let scheme = "";
  try {
    scheme = new URL(source).protocol;
  } catch {
    // Not a URL this can classify; the local path is the safer guess, since
    // a relative or opaque reference is not going out to the network.
  }

  if (scheme === "http:" || scheme === "https:") {
    const response = await requestUrl({ url: source, throw: false });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Could not fetch MathJax font ${source}: HTTP ${response.status}`);
    }
    return response.arrayBuffer;
  }

  const response = await window.fetch(source);
  if (!response.ok) {
    throw new Error(`Could not fetch MathJax font ${source}: HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

/**
 * Copies MathJax's built-in fonts into the published tree and rewrites the
 * harvested @font-face rules to point at them. The original `/lib/mathjax`
 * URLs only exist inside Obsidian's app:// origin; they are not available to
 * a browser opening the generated site.
 */
export async function materializeMathJaxFonts(
  rules: HarvestRule[],
): Promise<{ rules: HarvestRule[]; assets: HarvestedAsset[] }> {
  const bySource = new Map<string, { path: string; content: ArrayBuffer }>();
  const rewritten = rules.map((rule) => {
    if (!rule.cssText.startsWith("@font-face")) return rule;

    const cssText = rule.cssText.replace(
      /url\((['"]?)([^'")]+)\1\)/g,
      (_match, quote: string, source: string) => {
        const absolute = new URL(source, document.baseURI).href;
        let asset = bySource.get(absolute);
        if (!asset) {
          // Filled below after all URLs have been discovered. Keeping this
          // placeholder makes the rewrite deterministic across rules.
          asset = { path: `assets/mathjax/${fontFileName(source)}`, content: new ArrayBuffer(0) };
          bySource.set(absolute, asset);
        }
        return `url(${quote}${relativeMathJaxPath(asset.path)}${quote})`;
      },
    );
    return { ...rule, cssText };
  });

  for (const [source, asset] of bySource) {
    asset.content = await readFontBytes(source);
  }

  return { rules: rewritten, assets: Array.from(bySource.values()) };
}

function fontFileName(source: string): string {
  const pathname = new URL(source, document.baseURI).pathname;
  const name = pathname.slice(pathname.lastIndexOf("/") + 1);
  return name || "font.woff2";
}

function relativeMathJaxPath(assetPath: string): string {
  return assetPath.replace(/^assets\//, "");
}

function collectRules(
  rules: CSSRuleList,
  prefixes: string[],
  origin: string,
  out: HarvestRule[],
  wrap?: string,
): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      if (selectorMatchesPrefixes(rule.selectorText, prefixes)) {
        out.push({
          origin,
          cssText: wrap ? `${wrap} { ${rule.cssText} }` : rule.cssText,
        });
      } else if (declaresMatchingVariable(rule, prefixes)) {
        const cssText = variablesOnly(rule, prefixes);
        out.push({ origin, cssText: wrap ? `${wrap} { ${cssText} }` : cssText });
      }
      continue;
    }

    if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
      const condition =
        rule instanceof CSSMediaRule
          ? `@media ${rule.conditionText}`
          : `@supports ${rule.conditionText}`;
      collectRules(rule.cssRules, prefixes, origin, out, condition);
      continue;
    }

    // Keyframes and font-face carry no selector to match, so they come along
    // only when something we kept might reference them. Keyframes used by
    // Mermaid's own inline styles are already inside its SVG.
    if (rule instanceof CSSKeyframesRule) {
      if (selectorMatchesPrefixes(rule.name, prefixes)) {
        out.push({ origin, cssText: rule.cssText });
      }
      continue;
    }

    // MathJax's glyph fonts are not optional decoration: without them the
    // browser falls back to ordinary serif fonts while retaining MathJax's
    // measured layout, which makes equations visibly misaligned.
    if (rule instanceof CSSFontFaceRule && isMathJaxFontFace(rule)) {
      out.push({
        origin,
        cssText: wrap ? `${wrap} { ${rule.cssText} }` : rule.cssText,
      });
    }
  }
}

/** Renders harvested rules as a stylesheet, deduplicated and labelled. */
export function harvestToStylesheet(rules: HarvestRule[]): string {
  const seen = new Set<string>();
  const byOrigin = new Map<string, string[]>();

  for (const rule of rules) {
    if (seen.has(rule.cssText)) continue;
    seen.add(rule.cssText);
    const list = byOrigin.get(rule.origin) ?? [];
    list.push(rule.cssText);
    byOrigin.set(rule.origin, list);
  }

  const sections = Array.from(byOrigin.entries()).map(
    ([origin, cssTexts]) =>
      `/* --- harvested from ${origin} (${cssTexts.length} rules) --- */\n${cssTexts.join("\n")}`,
  );

  return [
    "/* Harvested from the running Obsidian instance by vault-publisher.",
    "   These rules construct layout that would otherwise have to be",
    "   reverse-engineered: MathJax glyph positioning, Bases grids, Dataview",
    "   table internals. Site design lives in site.css, not here. */",
    "",
    ...sections,
  ].join("\n");
}
