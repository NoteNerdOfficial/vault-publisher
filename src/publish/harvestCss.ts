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

export interface HarvestRule {
  /** Where it came from, for the generated file's comments. */
  origin: string;
  cssText: string;
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
  ".table-view-", // Dataview's table internals
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
