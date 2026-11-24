/**
 * Editing an as-is page's source file from its preview: the half of the edit
 * notch that runs in the plugin.
 *
 * The browser never sends text. It names an element by where it starts in
 * the file and says what to do to it, and everything that touches the file
 * happens here, against the file as it is now. That keeps the page from
 * being able to write anything but the small, known edits below, and keeps
 * the file's own formatting: an edit replaces exactly the characters it has
 * to and no others, so a diff of the file shows the change and nothing else.
 *
 * **How an element is named.** When the server hands an as-is page to the
 * browser it adds `data-osp-src="<offset>"` to every element under `<body>`
 * whose start tag is in the file, the offset being where that start tag
 * begins. The attribute travels with the node whatever the page's scripts do
 * to the tree, which a path like "third child of the second section" would
 * not. It is added on the way out and never written to disk: the vault file
 * and the preview copy are both untouched by it.
 *
 * **Why parse5.** It builds the tree by the same algorithm the browser does,
 * so its idea of where an element starts and ends is the browser's, implied
 * end tags and all. Elements the parser invented rather than read -- the
 * `<tbody>` every table gets -- have no location, so they get no stamp and
 * cannot be edited, which is right: there is nothing in the file to change.
 *
 * Every edit is checked against a hash of the text it was made against, and
 * refused when the file has changed underneath it. Merging silently into a
 * file an AI just rewrote is the one failure here that would lose work.
 */

import { createHash } from "crypto";
import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { addRule, findRule, setDeclarations, setInlineDeclaration } from "./editCss";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
type Document = DefaultTreeAdapterMap["document"];

/** The attribute that names an element by its offset in the source. */
export const STAMP_ATTR = "data-osp-src";

/** Replace `[start, end)` of the old text with `text`. */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * What the browser is told about an edit: the range in the *old* text and
 * how long its replacement is. Enough to move every stamp on the page to the
 * new text, and no more.
 */
export interface EditShift {
  start: number;
  end: number;
  length: number;
}

/** One thing the notch asks for, naming elements by their stamps. */
export type EditRequest =
  | { op: "delete" | "hide" | "duplicate"; at: number }
  | { op: "move"; at: number; target: number; place: "before" | "after" | "inside" }
  | { op: "text"; at: number; text: string }
  | { op: "texts"; at: number; texts: string[] }
  | { op: "inline-style"; at: number; props: StyleProps }
  | { op: "rule-style"; sheet: number | string; path: number[]; selector: string; props: StyleProps }
  | { op: "add-rule"; sheet: number | null; selector: string; props: StyleProps; media?: string }
  | { op: "copy"; at: number; target: number; place: Place }
  | { op: "wrap"; at: number; last: number; props: StyleProps }
  | { op: "unwrap"; at: number }
  | { op: "insert"; at: number | null; place: Place; kind: InsertKind; src?: string; like?: InsertLike; props?: StyleProps };

export type Place = "before" | "after" | "inside";

/**
 * What Insert can put on a page: Figma's frame, rectangle, text and image,
 * and the pieces a prototype is made of, which can take the look of one
 * already on the page.
 */
export type InsertKind = "frame" | "rect" | "text" | "image" | "heading" | "button" | "link" | "input" | "divider" | "list";

export const INSERT_KINDS: readonly InsertKind[] = ["frame", "rect", "text", "image", "heading", "button", "link", "input", "divider", "list"];

/**
 * The look a new layer borrows from one on the page: its classes, and for a
 * heading its level. Classes rather than copied styles, so the new button
 * follows the page's stylesheet as the old one does.
 */
export interface InsertLike {
  cls?: string;
  tag?: string;
}

/**
 * Declarations to set, in order: a size is several at once (`width` and
 * `flex`, say), and they land together or not at all.
 */
export type StyleProps = Array<[string, string]>;

/**
 * For the two edits that put a whole element somewhere new: each stamp in
 * that element's subtree, old offset to new. The page re-stamps the subtree
 * from this instead of reloading. A list rather than one difference, because
 * a block moved to another depth is re-indented, and each of its lines moves
 * by a different amount.
 */
export type Relocation = Array<[number, number]>;

export type OpResult =
  | { ok: true; edits: TextEdit[]; relocated?: Relocation; created?: number }
  | { ok: false; error: string };

/**
 * Elements that can sit among words without changing what the words are:
 * a link, emphasis, a code span. Text holding only these can be retyped
 * with the markup kept around it.
 */
const INLINE = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em", "i", "kbd", "mark",
  "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
]);

/** Elements whose content is not markup, so not text a person edits here. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "template", "xmp", "iframe", "noscript"]);

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 32);
}

function parseSource(source: string): Document {
  return parse(source, { sourceCodeLocationInfo: true });
}

function isElement(node: Node): node is Element {
  return "tagName" in node && typeof (node as Element).tagName === "string";
}

function childElement(node: Node, name: string): Element | null {
  const children = "childNodes" in node ? node.childNodes : [];
  for (const child of children) {
    if (isElement(child) && child.tagName === name) return child;
  }
  return null;
}

/**
 * Every element under `<body>` that the file actually contains, in tree
 * order. Not the body itself, and nothing in `<head>`: neither is something
 * a person selects on the page, and deleting either is not an edit.
 */
export function editableElements(doc: Document): Element[] {
  const html = childElement(doc, "html");
  const body = html && childElement(html, "body");
  if (!body) return [];

  const out: Element[] = [];
  const walk = (node: Element): void => {
    for (const child of node.childNodes) {
      if (!isElement(child)) continue;
      if (child.sourceCodeLocation?.startTag) out.push(child);
      // A <template>'s children live in its content fragment, which this
      // walk does not enter: they are not on the page until a script clones
      // them, and a clone carries no stamp worth trusting.
      walk(child);
    }
  };
  walk(body);
  return out;
}

/**
 * Every `<style>` element in the file, head and body. They are stamped too,
 * so the page can say which one holds a rule; they are never selectable.
 */
export function styleElements(doc: Document): Element[] {
  const out: Element[] = [];
  const walk = (node: Node): void => {
    const children = "childNodes" in node ? node.childNodes : [];
    for (const child of children) {
      if (!isElement(child)) continue;
      if (child.tagName === "style" && child.sourceCodeLocation?.startTag && child.sourceCodeLocation.endTag) {
        out.push(child);
      }
      walk(child);
    }
  };
  walk(doc);
  return out;
}

/** Where to put a script that must run before the page's own. */
function headInsertionPoint(doc: Document): number {
  const html = childElement(doc, "html");
  const head = html && childElement(html, "head");
  const headTag = head?.sourceCodeLocation?.startTag;
  if (headTag) return headTag.endOffset;
  const htmlTag = html?.sourceCodeLocation?.startTag;
  if (htmlTag) return htmlTag.endOffset;
  // After the doctype at the very least: anything before it puts the page
  // into quirks mode, which would change the layout being edited.
  for (const child of doc.childNodes) {
    if (child.nodeName === "#documentType" && child.sourceCodeLocation) {
      return child.sourceCodeLocation.endOffset;
    }
  }
  return 0;
}

/**
 * The page as the browser gets it in an edit session: the source with every
 * editable element stamped, and `inject` placed where it runs first.
 *
 * With `stamp` false only the injection is made, for a page whose preview no
 * longer matches its file: the script still has to run, to say why the page
 * cannot be edited, but no offset into a file that has moved on is worth
 * handing out.
 */
export function prepareForEditing(
  source: string,
  inject: string,
  options: { stamp?: boolean } = {},
): string {
  const doc = parseSource(source);
  const insertions: Array<{ at: number; text: string }> = [];

  if (options.stamp !== false) {
    const body = new Set(editableElements(doc));
    for (const element of [...body, ...styleElements(doc).filter((style) => !body.has(style))]) {
      const tag = element.sourceCodeLocation!.startTag!;
      // Straight after the tag name, ahead of the element's own attributes:
      // if the file somehow already carries this attribute, the browser keeps
      // the first one, which is this.
      insertions.push({
        at: tag.startOffset + 1 + element.tagName.length,
        text: ` ${STAMP_ATTR}="${tag.startOffset}"`,
      });
    }
  }
  insertions.push({ at: headInsertionPoint(doc), text: inject });

  // Stable on ties, so two insertions at one offset keep their order.
  insertions.sort((a, b) => a.at - b.at);
  let out = "";
  let cursor = 0;
  for (const insertion of insertions) {
    out += source.slice(cursor, insertion.at) + insertion.text;
    cursor = insertion.at;
  }
  return out + source.slice(cursor);
}

/** The element whose start tag begins at `offset`, if it is editable. */
export function elementAt(doc: Document, offset: number): Element | null {
  for (const element of editableElements(doc)) {
    if (element.sourceCodeLocation!.startTag!.startOffset === offset) return element;
  }
  return null;
}

/**
 * The range to remove for an element, taking its whole line with it when it
 * has a line to itself, so a deleted element does not leave a line of
 * indentation behind.
 */
export function deletionRange(source: string, start: number, end: number): [number, number] {
  let from = start;
  while (from > 0 && (source[from - 1] === " " || source[from - 1] === "\t")) from--;
  let to = end;
  while (to < source.length && (source[to] === " " || source[to] === "\t")) to++;

  const ownsLineStart = from === 0 || source[from - 1] === "\n";
  const ownsLineEnd = to === source.length || source[to] === "\n" || source[to] === "\r";
  if (!ownsLineStart || !ownsLineEnd) return [start, end];

  if (source[to] === "\r") to++;
  if (source[to] === "\n") to++;
  return [from, to];
}

function quoteAttribute(value: string): string {
  // Keep the value readable: a value with double quotes in it (a font name)
  // goes in single quotes rather than being turned into &quot;s.
  if (value.includes('"') && !value.includes("'")) return `'${value}'`;
  return `"${value.replace(/"/g, "&quot;")}"`;
}

/** The text edit that sets properties in an element's style attribute. */
function inlineStyleEdit(element: Element, source: string, props: StyleProps): TextEdit {
  const location = element.sourceCodeLocation!;
  const tag = location.startTag!;
  const existing = location.attrs?.style;
  const current = element.attrs.find((attr) => attr.name === "style");
  const next = props.reduce(
    (style, [prop, value]) => setInlineDeclaration(style, prop, value),
    current?.value ?? "",
  );

  if (existing && current) {
    if (!next.trim()) {
      // Everything in it was taken out: the attribute goes too.
      let from = existing.startOffset;
      while (from > tag.startOffset && /\s/.test(source[from - 1])) from--;
      return { start: from, end: existing.endOffset, text: "" };
    }
    return { start: existing.startOffset, end: existing.endOffset, text: `style=${quoteAttribute(next)}` };
  }
  if (!next.trim()) return { start: tag.endOffset, end: tag.endOffset, text: "" };

  // No style attribute yet: one goes at the end of the start tag, before
  // its `>` or a self-closing `/>`.
  let at = tag.endOffset - 1;
  if (source[at - 1] === "/") at--;
  while (at > tag.startOffset && /\s/.test(source[at - 1])) at--;
  return { start: at, end: at, text: ` style=${quoteAttribute(next)}` };
}

/**
 * Where an element is in the source. An element closed by implication
 * (`<p>one<p>two`) ends where the next tag begins, so it owns the newline and
 * indentation before that tag; those are the file's formatting, not the
 * element, and are left out.
 */
function rangeOf(element: Element, source: string): [number, number] {
  const location = element.sourceCodeLocation!;
  let end = location.endOffset;
  if (!location.endTag) {
    while (end > location.startTag!.endOffset && /\s/.test(source[end - 1])) end--;
  }
  return [location.startOffset, end];
}

/** An element's line, when it has one to itself. */
interface OwnLine {
  /** Where the line starts and where the next one does. */
  lineStart: number;
  lineEnd: number;
  indent: string;
  newline: string;
}

function ownLine(source: string, start: number, end: number): OwnLine | null {
  let from = start;
  while (from > 0 && (source[from - 1] === " " || source[from - 1] === "\t")) from--;
  if (from > 0 && source[from - 1] !== "\n") return null;
  let rest = end;
  while (rest < source.length && (source[rest] === " " || source[rest] === "\t")) rest++;
  if (rest < source.length && source[rest] !== "\n" && source[rest] !== "\r") return null;
  const [, to] = deletionRange(source, start, end);
  const newline = source.slice(end).match(/^[ \t]*(\r?\n)/)?.[1] ?? (source.includes("\r\n") ? "\r\n" : "\n");
  return { lineStart: from, lineEnd: to, indent: source.slice(from, start), newline };
}

/**
 * An element's text placed at `at` in the line form its neighbour uses, or
 * inline. `prefix` is what comes before the element's own first character.
 */
function placed(
  source: string,
  text: string,
  at: number,
  line: OwnLine | null,
): { at: number; text: string; prefix: number } {
  if (!line) return { at, text, prefix: 0 };
  // A line the file does not end with a newline: the newline goes first.
  if (at === source.length && !source.endsWith("\n")) {
    return { at, text: line.newline + line.indent + text, prefix: line.newline.length + line.indent.length };
  }
  return { at, text: line.indent + text + line.newline, prefix: line.indent.length };
}

/** Re-indents an element's inner lines for a new depth. */
function reindent(text: string, from: string, to: string): string {
  if (from === to || !from) return text;
  return text.split("\n" + from).join("\n" + to);
}

/**
 * Where each stamp in `[start, end)` lands when that text is placed at `to`
 * in the new file, with its inner lines re-indented from `fromIndent` to
 * `toIndent`.
 */
function relocate(
  doc: Document,
  source: string,
  start: number,
  end: number,
  to: number,
  fromIndent = "",
  toIndent = "",
): Relocation {
  const marker = "\n" + fromIndent;
  const step = fromIndent && fromIndent !== toIndent ? toIndent.length - fromIndent.length : 0;
  const out: Relocation = [];
  for (const element of editableElements(doc)) {
    const at = element.sourceCodeLocation!.startTag!.startOffset;
    if (at < start || at >= end) continue;
    const local = at - start;
    const lines = step ? source.slice(start, at).split(marker).length - 1 : 0;
    out.push([at, to + local + lines * step]);
  }
  return out;
}

/**
 * A run of lines with an indentation step added to, or taken off, each
 * non-blank one, and where any offset in it ends up.
 */
function shiftLines(text: string, step: string, add: boolean): { text: string; map: (local: number) => number } {
  const lines = text.split("\n");
  const starts: number[] = [];
  const deltas: number[] = [];
  let out = "";
  let at = 0;
  let delta = 0;
  lines.forEach((line, i) => {
    starts.push(at);
    let next = line;
    if (add && line.trim()) next = step + line;
    else if (!add && line.startsWith(step)) next = line.slice(step.length);
    delta += next.length - line.length;
    deltas.push(delta);
    out += next + (i < lines.length - 1 ? "\n" : "");
    at += line.length + 1;
  });
  const map = (local: number): number => {
    let i = starts.length - 1;
    while (i > 0 && starts[i] > local) i--;
    return local + deltas[i];
  };
  return { text: out, map };
}

/** One step of indentation in the file's own style. */
function stepOf(indent: string): string {
  return indent.includes("\t") ? "\t" : "  ";
}

/** A style attribute for new markup, or nothing. */
function styleAttribute(props: StyleProps): string {
  const style = props.filter(([, v]) => v !== "").map(([p, v]) => `${p}: ${v}`).join("; ");
  return style ? ` style=${quoteAttribute(style)}` : "";
}

/** A class attribute for new markup, or nothing. */
function classAttribute(cls: string | undefined): string {
  return cls ? ` class=${quoteAttribute(cls)}` : "";
}

/**
 * Declarations for new markup: the kind's own, with any the request brings
 * (a size drawn on the page) taking the place of the same property. A drawn
 * height on a frame replaces its minimum height as well.
 */
function mergedProps(base: StyleProps, extra: StyleProps | undefined): StyleProps {
  if (!extra?.length) return base;
  const names = new Set(extra.map(([p]) => p));
  if (names.has("height")) names.add("min-height");
  return [...base.filter(([p]) => !names.has(p)), ...extra];
}

/** The markup Insert writes for each kind. */
export function insertMarkup(
  kind: InsertKind,
  options: { src?: string; like?: InsertLike; props?: StyleProps } = {},
): string {
  const cls = classAttribute(options.like?.cls);
  const props = options.props;
  switch (kind) {
    case "frame":
      return `<div${styleAttribute(mergedProps([
        ["display", "flex"],
        ["flex-direction", "column"],
        ["gap", "8px"],
        ["padding", "16px"],
        ["min-height", "80px"],
        ["background-color", "#ffffff"],
      ], props))}></div>`;
    case "rect":
      return `<div${styleAttribute(mergedProps([["width", "100px"], ["height", "100px"], ["background-color", "#d9d9d9"]], props))}></div>`;
    case "text":
      return "<p>Text</p>";
    case "image":
      return `<img src=${quoteAttribute(options.src ?? "")} alt=""${styleAttribute(mergedProps([["width", "240px"], ["height", "auto"]], props))}>`;
    case "heading": {
      const tag = /^h[1-6]$/.test(options.like?.tag ?? "") ? options.like!.tag! : "h2";
      return `<${tag}${cls}>Heading</${tag}>`;
    }
    case "button":
      return `<button type="button"${cls}>Button</button>`;
    case "link":
      return `<a href="#"${cls}>Link</a>`;
    case "input":
      return `<input${cls} placeholder="Placeholder">`;
    case "divider":
      return `<hr${cls}>`;
    case "list":
      return `<ul${cls}><li>Item</li><li>Item</li><li>Item</li></ul>`;
  }
}

/**
 * Where new markup goes inside an element: on a line of its own above the
 * closing tag, one step in, when the element spans lines; just before the
 * closing tag otherwise. Null for an element nothing can go inside.
 */
function insideSpot(source: string, target: Element): { at: number; indent: string | null; newline: string } | null {
  const close = target.sourceCodeLocation?.endTag;
  if (!close || RAW_TEXT.has(target.tagName)) return null;
  let lineStart = close.startOffset;
  while (lineStart > 0 && /[ \t]/.test(source[lineStart - 1])) lineStart--;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const spans =
    source.slice(target.sourceCodeLocation!.startTag!.endOffset, close.startOffset).includes("\n") &&
    (lineStart === 0 || source[lineStart - 1] === "\n");
  if (!spans) return { at: close.startOffset, indent: null, newline };
  const closeIndent = source.slice(lineStart, close.startOffset);
  return { at: lineStart, indent: closeIndent + stepOf(closeIndent), newline };
}

/**
 * Where a piece of markup goes beside or inside a target: the insertion and
 * how much comes before the piece's own first character. `text` is the
 * piece, `fromIndent` the indentation its inner lines have now.
 */
function placeBeside(
  source: string,
  target: Element,
  place: Place,
  text: string,
  fromIndent: string,
): { edit: TextEdit; prefix: number; indents: [string, string] } | null {
  if (place === "inside") {
    const spot = insideSpot(source, target);
    if (!spot) return null;
    if (spot.indent === null) return { edit: { start: spot.at, end: spot.at, text }, prefix: 0, indents: ["", ""] };
    const indents: [string, string] = fromIndent ? [fromIndent, spot.indent] : ["", ""];
    return {
      edit: { start: spot.at, end: spot.at, text: spot.indent + reindent(text, indents[0], indents[1]) + spot.newline },
      prefix: spot.indent.length,
      indents,
    };
  }
  const [targetStart, targetEnd] = rangeOf(target, source);
  const targetLine = ownLine(source, targetStart, targetEnd);
  const indents: [string, string] = fromIndent && targetLine ? [fromIndent, targetLine.indent] : ["", ""];
  const at = targetLine
    ? place === "before" ? targetLine.lineStart : targetLine.lineEnd
    : place === "before" ? targetStart : targetEnd;
  const put = placed(source, reindent(text, indents[0], indents[1]), at, targetLine);
  return { edit: { start: put.at, end: put.at, text: put.text }, prefix: put.prefix, indents };
}

/** Text as it may be written between tags. */
export function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\u00a0/g, "&nbsp;");
}

const GONE = "That element is not in the file any more. Reload the page to keep editing.";

/** Works out the edits for one request. */
export function planOp(source: string, request: EditRequest): OpResult {
  const doc = parseSource(source);

  if (request.op === "add-rule") {
    const sheets = styleElements(doc);
    const sheet =
      request.sheet === null
        ? sheets[sheets.length - 1]
        : sheets.find((style) => style.sourceCodeLocation!.startTag!.startOffset === request.sheet);
    if (sheet) {
      const from = sheet.sourceCodeLocation!.startTag!.endOffset;
      const to = sheet.sourceCodeLocation!.endTag!.startOffset;
      return { ok: true, edits: [addRule(source, from, to, request.selector, request.props, request.media)] };
    }
    if (request.sheet !== null) return { ok: false, error: GONE };
    // No <style> in the file yet: one goes at the end of the head.
    const html = childElement(doc, "html");
    const head = html && childElement(html, "head");
    const at = head?.sourceCodeLocation?.endTag?.startOffset ?? headInsertionPoint(doc);
    const css = addRule("\n", 0, 1, request.selector, request.props, request.media).text;
    return { ok: true, edits: [{ start: at, end: at, text: `<style>\n${css.replace(/^\n/, "")}</style>\n` }] };
  }

  if (request.op === "rule-style") {
    if (typeof request.sheet === "string") return { ok: false, error: "That rule is in another file." };
    const sheet = styleElements(doc).find(
      (style) => style.sourceCodeLocation!.startTag!.startOffset === request.sheet,
    );
    if (!sheet) return { ok: false, error: GONE };
    const from = sheet.sourceCodeLocation!.startTag!.endOffset;
    const to = sheet.sourceCodeLocation!.endTag!.startOffset;
    const rule = findRule(source, from, to, request.path, request.selector);
    if (!rule) {
      return {
        ok: false,
        error: `Couldn't find the rule for ${request.selector} in the file. Reload the page to keep editing.`,
      };
    }
    return { ok: true, edits: [setDeclarations(source, rule.blockStart, rule.blockEnd, request.props)] };
  }

  if (request.op === "insert") {
    const markup = insertMarkup(request.kind, request);
    let target: Element | null;
    let place = request.place;
    if (request.at === null) {
      // Nothing selected: at the end of the page's body.
      const html = childElement(doc, "html");
      target = html && childElement(html, "body");
      place = "inside";
      if (!target?.sourceCodeLocation?.endTag) {
        const at = source.length;
        const lead = source.endsWith("\n") ? "" : "\n";
        return { ok: true, edits: [{ start: at, end: at, text: lead + markup + "\n" }], created: at + lead.length };
      }
    } else {
      target = elementAt(doc, request.at);
    }
    if (!target) return { ok: false, error: GONE };
    const put = placeBeside(source, target, place, markup, "");
    if (!put) return { ok: false, error: "Nothing can go inside that element." };
    return { ok: true, edits: [put.edit], created: put.edit.start + put.prefix };
  }

  const element = elementAt(doc, request.at);
  if (!element) return { ok: false, error: GONE };
  const [start, end] = rangeOf(element, source);

  switch (request.op) {
    case "delete": {
      const [from, to] = deletionRange(source, start, end);
      return { ok: true, edits: [{ start: from, end: to, text: "" }] };
    }

    case "hide":
      return { ok: true, edits: [inlineStyleEdit(element, source, [["display", "none"]])] };

    case "inline-style":
      return { ok: true, edits: [inlineStyleEdit(element, source, request.props)] };

    case "duplicate": {
      const line = ownLine(source, start, end);
      const copy = placed(source, source.slice(start, end), line ? line.lineEnd : end, line);
      return {
        ok: true,
        edits: [{ start: copy.at, end: copy.at, text: copy.text }],
        relocated: relocate(doc, source, start, end, copy.at + copy.prefix),
      };
    }

    case "move": {
      const target = elementAt(doc, request.target);
      if (!target) return { ok: false, error: GONE };
      const [targetStart, targetEnd] = rangeOf(target, source);
      if (targetStart >= start && targetStart < end) {
        return { ok: false, error: "An element can't be moved inside itself." };
      }

      const own = ownLine(source, start, end);
      const [removeFrom, removeTo] = own ? [own.lineStart, own.lineEnd] : [start, end];

      if (request.place === "inside") {
        const close = target.sourceCodeLocation!.endTag;
        if (!close || RAW_TEXT.has(target.tagName)) {
          return { ok: false, error: "Nothing can go inside that element." };
        }
        // On a line of its own above the closing tag when the element spans
        // lines, indented one step further than the tag; inline otherwise.
        let lineStart = close.startOffset;
        while (lineStart > 0 && /[ \t]/.test(source[lineStart - 1])) lineStart--;
        const spans =
          source.slice(target.sourceCodeLocation!.startTag!.endOffset, close.startOffset).includes("\n") &&
          (lineStart === 0 || source[lineStart - 1] === "\n");
        let at = close.startOffset;
        let text = source.slice(start, end);
        let prefix = 0;
        let indents: [string, string] = ["", ""];
        if (spans) {
          const closeIndent = source.slice(lineStart, close.startOffset);
          const indent = closeIndent + (closeIndent.includes("\t") ? "\t" : "  ");
          if (own) indents = [own.indent, indent];
          text = indent + reindent(text, indents[0], indents[1]) + (own?.newline ?? (source.includes("\r\n") ? "\r\n" : "\n"));
          at = lineStart;
          prefix = indent.length;
        }
        const shifted = at >= removeTo ? at - (removeTo - removeFrom) : at;
        return {
          ok: true,
          edits: [
            { start: removeFrom, end: removeTo, text: "" },
            { start: at, end: at, text },
          ],
          relocated: relocate(doc, source, start, end, shifted + prefix, indents[0], indents[1]),
        };
      }

      const targetLine = ownLine(source, targetStart, targetEnd);
      const indents: [string, string] = own && targetLine ? [own.indent, targetLine.indent] : ["", ""];
      const text = reindent(source.slice(start, end), indents[0], indents[1]);

      const at = targetLine
        ? request.place === "before" ? targetLine.lineStart : targetLine.lineEnd
        : request.place === "before" ? targetStart : targetEnd;
      const put = placed(source, text, at, targetLine);
      const shifted = put.at >= removeTo ? put.at - (removeTo - removeFrom) : put.at;
      return {
        ok: true,
        edits: [
          { start: removeFrom, end: removeTo, text: "" },
          { start: put.at, end: put.at, text: put.text },
        ],
        relocated: relocate(doc, source, start, end, shifted + put.prefix, indents[0], indents[1]),
      };
    }

    case "copy": {
      const target = elementAt(doc, request.target);
      if (!target) return { ok: false, error: GONE };
      const [targetStart] = rangeOf(target, source);
      if (request.place === "inside" && targetStart >= start && targetStart < end) {
        return { ok: false, error: "A layer can't be pasted inside itself." };
      }
      const own = ownLine(source, start, end);
      const put = placeBeside(source, target, request.place, source.slice(start, end), own?.indent ?? "");
      if (!put) return { ok: false, error: "Nothing can go inside that element." };
      return {
        ok: true,
        edits: [put.edit],
        relocated: relocate(doc, source, start, end, put.edit.start + put.prefix, put.indents[0], put.indents[1]),
      };
    }

    case "wrap": {
      const last = elementAt(doc, request.last);
      if (!last) return { ok: false, error: GONE };
      if (last.parentNode !== element.parentNode || last.sourceCodeLocation!.startOffset < start) {
        return { ok: false, error: "Only layers side by side in the same frame can be framed together." };
      }
      const [, lastEnd] = rangeOf(last, source);
      const open = `<div${styleAttribute(request.props)}>`;
      const firstLine = ownLine(source, start, end);
      const lastLine = ownLine(source, last.sourceCodeLocation!.startOffset, lastEnd);
      const inside = (at: number) => at >= start && at < lastEnd;
      if (firstLine && lastLine) {
        const from = firstLine.lineStart;
        const to = lastLine.lineEnd;
        const shifted = shiftLines(source.slice(from, to), stepOf(firstLine.indent), true);
        const head = firstLine.indent + open + firstLine.newline;
        const body = shifted.text.endsWith("\n") ? shifted.text : shifted.text + firstLine.newline;
        const text = head + body + firstLine.indent + "</div>" + (to === source.length && !source.endsWith("\n") ? "" : firstLine.newline);
        const relocated: Relocation = editableElements(doc)
          .map((el) => el.sourceCodeLocation!.startTag!.startOffset)
          .filter(inside)
          .map((at) => [at, from + head.length + shifted.map(at - from)]);
        return { ok: true, edits: [{ start: from, end: to, text }], relocated, created: from + firstLine.indent.length };
      }
      const relocated: Relocation = editableElements(doc)
        .map((el) => el.sourceCodeLocation!.startTag!.startOffset)
        .filter(inside)
        .map((at) => [at, at + open.length]);
      return {
        ok: true,
        edits: [{ start, end: lastEnd, text: open + source.slice(start, lastEnd) + "</div>" }],
        relocated,
        created: start,
      };
    }

    case "unwrap": {
      const location = element.sourceCodeLocation!;
      if (!location.endTag || RAW_TEXT.has(element.tagName)) {
        return { ok: false, error: "This layer has nothing inside it to keep." };
      }
      const contentStart = location.startTag!.endOffset;
      const contentEnd = location.endTag.startOffset;
      const inner = source.slice(contentStart, contentEnd);
      const own = ownLine(source, start, end);
      const inside = (at: number) => at >= contentStart && at < contentEnd;
      const lead = /^[ \t]*\r?\n/.exec(inner);
      if (own && lead) {
        const bodyStart = contentStart + lead[0].length;
        const body = source.slice(bodyStart, contentEnd).replace(/\r?\n[ \t]*$/, "");
        const firstIndent = /^[ \t]*/.exec(body.split("\n").find((line) => line.trim()) ?? "")![0];
        const step = firstIndent.startsWith(own.indent) ? firstIndent.slice(own.indent.length) : "";
        const shifted = step ? shiftLines(body, step, false) : { text: body, map: (n: number) => n };
        const text = shifted.text.trim() ? shifted.text + own.newline : "";
        const relocated: Relocation = editableElements(doc)
          .map((el) => el.sourceCodeLocation!.startTag!.startOffset)
          .filter(inside)
          .map((at) => [at, own.lineStart + shifted.map(at - bodyStart)]);
        return { ok: true, edits: [{ start: own.lineStart, end: own.lineEnd, text }], relocated };
      }
      const relocated: Relocation = editableElements(doc)
        .map((el) => el.sourceCodeLocation!.startTag!.startOffset)
        .filter(inside)
        .map((at) => [at, start + at - contentStart]);
      return { ok: true, edits: [{ start, end, text: inner }], relocated };
    }

    case "texts": {
      // Every piece of text inside, in order, beside markup that stays put.
      const nodes: Array<{ value: string; start: number; end: number }> = [];
      let plainEnough = !RAW_TEXT.has(element.tagName);
      const walk = (node: Element): void => {
        for (const child of node.childNodes) {
          if (child.nodeName === "#text") {
            const at = child.sourceCodeLocation;
            if (!at) plainEnough = false;
            else nodes.push({ value: (child as { value: string }).value, start: at.startOffset, end: at.endOffset });
          } else if (isElement(child)) {
            if (!INLINE.has(child.tagName) || !child.sourceCodeLocation) plainEnough = false;
            walk(child);
          }
        }
      };
      walk(element);
      if (!plainEnough) {
        return { ok: false, error: "This holds more than words and inline markup. Double-click to go inside." };
      }
      if (nodes.length !== request.texts.length) {
        return {
          ok: false,
          error: "That edit changed the markup around the words, not only the words, so it can't be written. Undo it in the text and try again.",
        };
      }
      const edits: TextEdit[] = [];
      nodes.forEach((node, i) => {
        if (node.value !== request.texts[i]) {
          edits.push({ start: node.start, end: node.end, text: escapeText(request.texts[i]) });
        }
      });
      return { ok: true, edits };
    }

    case "text": {
      const location = element.sourceCodeLocation!;
      const plain = element.childNodes.every((child) => child.nodeName === "#text");
      if (!location.endTag || !plain || RAW_TEXT.has(element.tagName)) {
        return {
          ok: false,
          error: "This holds more than plain text, so its words can't be edited in one go. Double-click to go inside.",
        };
      }
      const contentStart = location.startTag!.endOffset;
      const contentEnd = location.endTag.startOffset;
      const raw = source.slice(contentStart, contentEnd);
      // The file's own spacing around the words is kept; only the words change.
      const lead = raw.match(/^\s*/)![0];
      const trail = raw.length === lead.length ? "" : raw.match(/\s*$/)![0];
      return {
        ok: true,
        edits: [{ start: contentStart, end: contentEnd, text: lead + escapeText(request.text.trim()) + trail }],
      };
    }
  }
}

/** Edits in order, an insertion ahead of a removal that starts where it does. */
function ordered(edits: TextEdit[]): TextEdit[] {
  return [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Applies edits given in the old text's coordinates, which must not overlap. */
export function applyEdits(source: string, edits: TextEdit[]): string {
  let out = "";
  let cursor = 0;
  for (const edit of ordered(edits)) {
    out += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return out + source.slice(cursor);
}

/** The edits that take the edited text back to `source`. */
export function invertEdits(source: string, edits: TextEdit[]): TextEdit[] {
  const out: TextEdit[] = [];
  let delta = 0;
  for (const edit of ordered(edits)) {
    const start = edit.start + delta;
    out.push({ start, end: start + edit.text.length, text: source.slice(edit.start, edit.end) });
    delta += edit.text.length - (edit.end - edit.start);
  }
  return out;
}

export function shiftsOf(edits: TextEdit[]): EditShift[] {
  return ordered(edits).map((edit) => ({ start: edit.start, end: edit.end, length: edit.text.length }));
}

/**
 * Where a stamp moves to after `shifts`, or null when the element it named
 * was inside text that was replaced. The same rule the browser runs over
 * every stamp on the page after an edit; kept here so it can be tested.
 */
export function shiftStamp(offset: number, shifts: EditShift[]): number | null {
  let delta = 0;
  for (const shift of shifts) {
    if (offset >= shift.end) delta += shift.length - (shift.end - shift.start);
    else if (offset >= shift.start) return null;
  }
  return offset + delta;
}

/** The edit to a rule in a stylesheet file, named the way the page names it. */
export function planCssRule(
  css: string,
  path: number[],
  selector: string,
  props: StyleProps,
): OpResult {
  const rule = findRule(css, 0, css.length, path, selector);
  if (!rule) {
    return { ok: false, error: `Couldn't find the rule for ${selector} in the stylesheet. Reload the page to keep editing.` };
  }
  return { ok: true, edits: [setDeclarations(css, rule.blockStart, rule.blockEnd, props)] };
}

/**
 * The stylesheets a page links, as paths beside the page: `href`s of
 * `<link rel="stylesheet">` resolved against the page's own path. Remote
 * sheets and anything that climbs out are left out.
 */
export function linkedStylesheets(source: string, pagePath: string): string[] {
  const doc = parseSource(source);
  const out: string[] = [];
  const base = pagePath.includes("/") ? pagePath.slice(0, pagePath.lastIndexOf("/") + 1) : "";
  const walk = (node: Node): void => {
    const children = "childNodes" in node ? node.childNodes : [];
    for (const child of children) {
      if (!isElement(child)) continue;
      if (child.tagName === "link") {
        const rel = child.attrs.find((a) => a.name === "rel")?.value.toLowerCase().split(/\s+/) ?? [];
        const href = child.attrs.find((a) => a.name === "href")?.value ?? "";
        if (rel.includes("stylesheet") && href && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) {
          const clean = href.split(/[?#]/)[0];
          const joined = clean.startsWith("/") ? clean.slice(1) : base + clean;
          const parts: string[] = [];
          let bad = false;
          for (const part of joined.split("/")) {
            if (part === "" || part === ".") continue;
            if (part === "..") {
              if (!parts.length) bad = true;
              parts.pop();
            } else parts.push(part);
          }
          if (!bad && parts.length) {
            try {
              out.push(decodeURIComponent(parts.join("/")));
            } catch {
              // A broken escape names nothing we can find.
            }
          }
        }
      }
      walk(child);
    }
  };
  walk(doc);
  return out;
}

/** The 1-based line and column of an offset in a file. */
export function lineAt(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const lines = before.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/**
 * Where a rule starts in a page's own <style> block, named the way the page
 * names it for an edit: the block's stamp, the CSSOM path, the selector.
 */
export function ruleStart(source: string, sheet: number, path: number[], selector: string): number | null {
  const doc = parseSource(source);
  const style = styleElements(doc).find((s) => s.sourceCodeLocation!.startTag!.startOffset === sheet);
  if (!style) return null;
  const rule = findRule(
    source,
    style.sourceCodeLocation!.startTag!.endOffset,
    style.sourceCodeLocation!.endTag!.startOffset,
    path,
    selector,
  );
  return rule ? rule.preludeStart : null;
}

/** The same for a rule in a stylesheet file. */
export function cssRuleStart(css: string, path: number[], selector: string): number | null {
  const rule = findRule(css, 0, css.length, path, selector);
  return rule ? rule.preludeStart : null;
}
