/**
 * Finding and changing one declaration in CSS text, for the edit notch.
 *
 * The page knows which rule wins for an element -- the browser has already
 * done the cascade -- but not where that rule is written. The file knows
 * where everything is written but not which rule wins. So the page names a
 * rule the way the CSSOM does (which `<style>`, which rule in it, which rule
 * inside an @media) and its selector, and this finds the same rule in the
 * text and changes one value in it, leaving every other character alone.
 *
 * It is a scanner, not a parser: comments, strings and nested blocks are
 * stepped over so that a brace or a semicolon inside them is not mistaken
 * for structure, and that is all. The selector is checked against what the
 * page saw, because the CSSOM drops rules it cannot parse and the indexes
 * can disagree with the text; when they do, a rule is matched by selector
 * alone, and only if exactly one rule has it.
 */

import type { TextEdit } from "./edit";

/** One statement in a block of CSS: a rule, an at-rule with a block, or neither. */
export interface CssStatement {
  /** Where the statement's prelude (selector or at-rule) starts and ends. */
  preludeStart: number;
  preludeEnd: number;
  /** Inside the braces, or -1 for a statement with no block (`@import ...;`). */
  blockStart: number;
  blockEnd: number;
  at: boolean;
}

export interface CssDeclaration {
  name: string;
  nameStart: number;
  valueStart: number;
  /** End of the value, before any `!important` and trailing space. */
  valueEnd: number;
  important: boolean;
  /** Where the declaration ends: its `;`, or the end of the block. */
  end: number;
}

/** Index of the end of a comment or string starting at `i`, or `i` if neither. */
function skip(text: string, i: number): number {
  if (text.startsWith("/*", i)) {
    const close = text.indexOf("*/", i + 2);
    return close === -1 ? text.length : close + 2;
  }
  const quote = text[i];
  if (quote === '"' || quote === "'") {
    let j = i + 1;
    while (j < text.length && text[j] !== quote) {
      if (text[j] === "\\") j++;
      if (text[j] === "\n") break;
      j++;
    }
    return j + 1;
  }
  return i;
}

/** The index of the brace that closes the block opened just before `from`. */
function closingBrace(text: string, from: number, limit: number): number {
  let depth = 0;
  for (let i = from; i < limit; i++) {
    const next = skip(text, i);
    if (next !== i) {
      i = next - 1;
      continue;
    }
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return limit;
}

/** The statements of the CSS in `[start, end)`, in order. */
export function statements(text: string, start = 0, end = text.length): CssStatement[] {
  const out: CssStatement[] = [];
  let i = start;
  while (i < end) {
    // Space, comments and the HTML comment markers old pages wrap CSS in.
    const skipped = skip(text, i);
    if (skipped !== i && (text.startsWith("/*", i))) {
      i = skipped;
      continue;
    }
    if (/\s/.test(text[i]) || text.startsWith("<!--", i) || text.startsWith("-->", i)) {
      i += text.startsWith("<!--", i) ? 4 : text.startsWith("-->", i) ? 3 : 1;
      continue;
    }
    const preludeStart = i;
    const at = text[i] === "@";
    let j = i;
    while (j < end && text[j] !== "{" && text[j] !== ";" && text[j] !== "}") {
      const next = skip(text, j);
      j = next !== j ? next : j + 1;
    }
    if (j >= end || text[j] === "}") break;
    if (text[j] === ";") {
      out.push({ preludeStart, preludeEnd: j, blockStart: -1, blockEnd: -1, at });
      i = j + 1;
      continue;
    }
    const blockStart = j + 1;
    const blockEnd = closingBrace(text, blockStart, end);
    out.push({ preludeStart, preludeEnd: j, blockStart, blockEnd, at });
    i = blockEnd + 1;
  }
  return out;
}

/** Selectors compared the way a browser would print them: no spacing, no case. */
export function sameSelector(a: string, b: string): boolean {
  // Quotes too: the browser prints [type=x] as [type="x"].
  const norm = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/["'\s]+/g, "").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * The rule at a CSSOM-style index path (`[3]`, or `[2, 0]` for the first rule
 * inside the third statement's @media), checked against `selector`.
 */
export function findRule(
  text: string,
  start: number,
  end: number,
  path: number[],
  selector: string,
): CssStatement | null {
  let level = statements(text, start, end);
  let found: CssStatement | undefined;
  for (let depth = 0; depth < path.length; depth++) {
    found = level[path[depth]];
    if (!found) break;
    if (depth < path.length - 1) {
      if (found.blockStart < 0) return byIndexFailed();
      level = statements(text, found.blockStart, found.blockEnd);
    }
  }
  if (found && found.blockStart >= 0 && sameSelector(text.slice(found.preludeStart, found.preludeEnd), selector)) {
    return found;
  }
  return byIndexFailed();

  // The index named something else: fall back to the selector, if it is unique.
  function byIndexFailed(): CssStatement | null {
    const all: CssStatement[] = [];
    const walk = (from: number, to: number) => {
      for (const statement of statements(text, from, to)) {
        if (statement.blockStart < 0) continue;
        if (statement.at) walk(statement.blockStart, statement.blockEnd);
        else all.push(statement);
      }
    };
    walk(start, end);
    const matches = all.filter((rule) => sameSelector(text.slice(rule.preludeStart, rule.preludeEnd), selector));
    return matches.length === 1 ? matches[0] : null;
  }
}

/** The declarations in a block of CSS text, in order. */
export function declarations(text: string, start: number, end: number): CssDeclaration[] {
  const out: CssDeclaration[] = [];
  let i = start;
  while (i < end) {
    while (i < end && (/[\s;]/.test(text[i]) || text.startsWith("/*", i))) {
      i = text.startsWith("/*", i) ? skip(text, i) : i + 1;
    }
    if (i >= end) break;
    const nameStart = i;
    let j = i;
    let depth = 0;
    let colon = -1;
    while (j < end) {
      const next = skip(text, j);
      if (next !== j) {
        j = next;
        continue;
      }
      const c = text[j];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === ":" && colon === -1 && depth === 0) colon = j;
      else if ((c === ";" || c === "{" || c === "}") && depth <= 0) break;
      j++;
    }
    // A nested block (CSS nesting) is not a declaration: step over it.
    if (text[j] === "{") {
      i = closingBrace(text, j + 1, end) + 1;
      continue;
    }
    if (colon !== -1) {
      const name = text.slice(nameStart, colon).trim();
      let valueStart = colon + 1;
      while (valueStart < j && /\s/.test(text[valueStart])) valueStart++;
      let valueEnd = j;
      while (valueEnd > valueStart && /\s/.test(text[valueEnd - 1])) valueEnd--;
      const bang = /!\s*important$/i.exec(text.slice(valueStart, valueEnd));
      let important = false;
      if (bang) {
        important = true;
        valueEnd = valueStart + bang.index;
        while (valueEnd > valueStart && /\s/.test(text[valueEnd - 1])) valueEnd--;
      }
      out.push({ name, nameStart, valueStart, valueEnd, important, end: j });
    }
    i = j + 1;
  }
  return out;
}

/**
 * The edit that sets `prop` to `value` in the block `[start, end)`.
 *
 * An existing declaration of that property has its value replaced, keeping
 * any `!important`. Otherwise a new one goes at the end of the block, which
 * also covers a value set by a shorthand: `background: url(x) #fff` is left
 * alone and `background-color` after it wins, where rewriting the shorthand
 * would have lost the image.
 */
export function setDeclaration(
  text: string,
  start: number,
  end: number,
  prop: string,
  value: string,
): TextEdit {
  const found = declarations(text, start, end).filter((d) => d.name.toLowerCase() === prop.toLowerCase());
  const last = found[found.length - 1];
  if (last) return { start: last.valueStart, end: last.valueEnd, text: value };

  const body = text.slice(start, end);
  let tail = end;
  while (tail > start && /\s/.test(text[tail - 1])) tail--;
  const needsSemicolon = tail > start && text[tail - 1] !== ";" && text[tail - 1] !== "{";
  // Written the way the block already is: `a:b;c:d` stays without spaces.
  const existing = declarations(text, start, end);
  const compact = existing.length > 0 && existing.every((d) => !/\s/.test(text.slice(d.nameStart, d.valueStart)));
  if (compact && !body.includes("\n")) {
    return { start: tail, end: tail, text: `${needsSemicolon ? ";" : ""}${prop}:${value}` };
  }

  if (body.includes("\n")) {
    // One declaration per line: the new one on its own, indented like the last.
    const lines = body.split("\n").filter((line) => line.trim());
    const indent = lines.length ? (/^\s*/.exec(lines[lines.length - 1])?.[0] ?? "  ") : "  ";
    return { start: tail, end: tail, text: `${needsSemicolon ? ";" : ""}\n${indent}${prop}: ${value};` };
  }
  return { start: tail, end: tail, text: `${needsSemicolon ? ";" : ""}${tail > start ? " " : ""}${prop}: ${value};` };
}

/**
 * One edit that sets several declarations in a block: the block's text with
 * each applied in turn, so they cannot collide at the same insertion point.
 * Only the characters that change are different; the rest is the block as
 * it was.
 */
export function setDeclarations(
  text: string,
  start: number,
  end: number,
  props: Array<[string, string]>,
): TextEdit {
  let block = text.slice(start, end);
  for (const [prop, value] of props) {
    const edit = setDeclaration(block, 0, block.length, prop, value);
    block = block.slice(0, edit.start) + edit.text + block.slice(edit.end);
  }
  return { start, end, text: block };
}

/** A style attribute's value with `prop` set to `value`. */
export function setInlineDeclaration(style: string, prop: string, value: string): string {
  const found = declarations(style, 0, style.length).filter((d) => d.name.toLowerCase() === prop.toLowerCase());
  const last = found[found.length - 1];
  if (last) return style.slice(0, last.valueStart) + value + style.slice(last.valueEnd);
  const trimmed = style.trim().replace(/;\s*$/, "");
  return trimmed ? `${trimmed}; ${prop}: ${value}` : `${prop}: ${value}`;
}

/** A CSS property name the notch will write. */
export function isPropertyName(prop: string): boolean {
  return /^(--)?[a-zA-Z][\w-]{0,63}$/.test(prop);
}

/**
 * A value the notch will write: a colour, a length, a keyword, a `var()` --
 * nothing that could end the declaration, open a block or close the tag.
 */
export function isSafeValue(value: string): boolean {
  return value.length > 0 && value.length <= 200 && /^[#\w\s(),.%/+*-]+$/.test(value);
}

/** A selector the notch will write into a stylesheet. */
export function isSafeSelector(selector: string): boolean {
  return selector.length > 0 && selector.length <= 300 && /^[#.\w\s>:+~*()[\]="'-]+$/.test(selector);
}

/** A media condition the notch writes: a single width bound in pixels. */
export function isWidthQuery(media: string): boolean {
  return /^\((?:min|max)-width:\s*\d{2,5}px\)$/.test(media);
}

/** Whether a stylesheet is written minified, so new rules can match it. */
function minified(css: string): boolean {
  // Nothing to go by in an empty sheet: write it readably.
  if (!css.includes("{")) return false;
  return !/\{\s*\n/.test(css) && !/:\s/.test(css.replace(/@media[^{]*/g, ""));
}

function ruleText(selector: string, props: Array<[string, string]>, compact: boolean, indent = ""): string {
  if (compact) return `${selector}{${props.map(([p, v]) => `${p}:${v}`).join(";")}}`;
  const inner = props.map(([p, v]) => `${indent}  ${p}: ${v};`).join("\n");
  return `${selector} {\n${inner}\n${indent}}`;
}

/**
 * The edit that adds declarations for `selector` to the CSS in `[start,
 * end)`: into an existing top-level rule with that exact selector (or the
 * same rule inside the same `@media`), or as a new rule at the end. New
 * rules follow the sheet's own style, minified or one declaration per line.
 */
export function addRule(
  text: string,
  start: number,
  end: number,
  selector: string,
  props: Array<[string, string]>,
  media?: string,
): TextEdit {
  const css = text.slice(start, end);
  const compact = minified(css);
  const top = statements(text, start, end);

  // Put a new piece of CSS on its own line before the end of the block.
  const append = (from: number, to: number, piece: string): TextEdit => {
    let at = to;
    while (at > from && /[ \t]/.test(text[at - 1])) at--;
    const lead = at > from && text[at - 1] !== "\n" ? "\n" : "";
    const trail = text[at] === "\n" ? "" : "\n";
    return { start: at, end: at, text: lead + piece + trail };
  };

  const sameRule = (list: CssStatement[]) =>
    [...list]
      .reverse()
      .find((s) => !s.at && s.blockStart >= 0 && sameSelector(text.slice(s.preludeStart, s.preludeEnd), selector));

  if (!media) {
    const existing = sameRule(top);
    if (existing) return setDeclarations(text, existing.blockStart, existing.blockEnd, props);
    return append(start, end, ruleText(selector, props, compact));
  }

  const block = [...top]
    .reverse()
    .find(
      (s) =>
        s.at &&
        s.blockStart >= 0 &&
        /^@media\s/i.test(text.slice(s.preludeStart, s.preludeEnd)) &&
        sameSelector(text.slice(s.preludeStart, s.preludeEnd).replace(/^@media/i, ""), media),
    );
  if (block) {
    const existing = sameRule(statements(text, block.blockStart, block.blockEnd));
    if (existing) return setDeclarations(text, existing.blockStart, existing.blockEnd, props);
    return append(block.blockStart, block.blockEnd, (compact ? "" : "  ") + ruleText(selector, props, compact, compact ? "" : "  "));
  }
  const piece = compact
    ? `@media ${media}{${ruleText(selector, props, true)}}`
    : `@media ${media} {\n  ${ruleText(selector, props, false, "  ")}\n}`;
  return append(start, end, piece);
}
