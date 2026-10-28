/**
 * A note's Markdown, as the published page is allowed to show it.
 *
 * Markdown mode puts the source next to the rendering, which sounds like it
 * costs nothing -- the page is built from that source, so the reader is
 * seeing what they were already given. That is not quite true, and the gap
 * is the whole reason this module exists: three things are in a note's text
 * and *not* in its rendered output.
 *
 * **Frontmatter.** `stripFrontmatter` in `page.ts` removes it from every
 * page, and the comment there says why at length: hidden is not absent, and
 * a vault that uses a frontmatter flag to decide what is public is keeping
 * its decisions in exactly the place that was leaking. Publishing the source
 * verbatim would put all of it back, in a `<pre>` nobody even has to view
 * the HTML to read.
 *
 * **`%%Obsidian comments%%`.** Invisible in reading view, which is precisely
 * what people use them for: a note to self in the middle of a note to
 * everyone.
 *
 * **`<!-- HTML comments -->`.** Same thing by another syntax, and the one a
 * reader is likelier to assume the publisher already handled.
 *
 * So the source shown is the source minus those three. Everything else is
 * the author's text, character for character -- the point of the view is
 * that you can take it away and have the note back.
 *
 * The one piece of care worth the lines it costs: comment removal is
 * fence-aware. `%%` opens a comment in Erlang and `<!--` appears in any note
 * that documents HTML, and a code block is content rather than commentary.
 * Stripping inside one would silently corrupt the published source of the
 * notes most likely to be read in this view.
 */

/** The frontmatter block, which only counts at the very top of the file. */
const FRONTMATTER = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** An opening or closing code fence, with up to three spaces of indent. */
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\r\n]*)/;

/**
 * The source for a published page.
 *
 * Returns an empty string when nothing survives, which the caller reads as
 * "this page has no Markdown view" -- a note that is pure frontmatter has no
 * source worth showing, and an empty pane is worse than an absent control.
 */
export function noteSource(markdown: string): string {
  const body = markdown.replace(FRONTMATTER, "");
  return tidy(stripComments(body));
}

/**
 * Removes comments that the rendered page does not show, leaving code alone.
 *
 * Walks the text once, tracking three things: whether we are inside a fenced
 * code block, whether we are inside an inline code span, and whether we are
 * at the start of a line (a fence only counts there).
 */
function stripComments(text: string): string {
  let out = "";
  let i = 0;
  /** The opening fence, when inside one. Closing needs the same character. */
  let fence: string | null = null;

  while (i < text.length) {
    const atLineStart = i === 0 || text[i - 1] === "\n";

    if (atLineStart) {
      const line = text.slice(i, lineEnd(text, i));
      const match = FENCE.exec(line);
      if (match) {
        const marker = match[1];
        if (fence === null) {
          fence = marker;
        } else if (marker[0] === fence[0] && marker.length >= fence.length && !match[2]) {
          // A closing fence carries no info string. An opener of a different
          // character, or a shorter run, is content inside this block.
          fence = null;
        }
        out += line;
        i += line.length;
        continue;
      }
    }

    // Inside a fenced block nothing is a comment, so copy to the line's end
    // in one go rather than inspecting every character of it.
    if (fence !== null) {
      const end = lineEnd(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }

    const char = text[i];

    if (char === "`") {
      const span = codeSpan(text, i);
      if (span > i) {
        out += text.slice(i, span);
        i = span;
        continue;
      }
    }

    if (char === "%" && text[i + 1] === "%") {
      const close = text.indexOf("%%", i + 2);
      // An unterminated `%%` is not a comment -- Obsidian renders it as text,
      // and dropping the rest of the note on a stray pair would be worse
      // than any leak this is guarding against.
      if (close !== -1) {
        i = close + 2;
        continue;
      }
    }

    if (char === "<" && text.startsWith("<!--", i)) {
      const close = text.indexOf("-->", i + 4);
      if (close !== -1) {
        i = close + 3;
        continue;
      }
    }

    out += char;
    i++;
  }

  return out;
}

/** The index just past this line's newline, or the end of the text. */
function lineEnd(text: string, from: number): number {
  const next = text.indexOf("\n", from);
  return next === -1 ? text.length : next + 1;
}

/**
 * The end of the code span opening at `start`, or `start` if there is none.
 *
 * A span closes on a backtick run of the same length. It may wrap a line but
 * not a blank one, which is where the search stops -- without that bound a
 * single stray backtick would swallow the rest of the note.
 */
function codeSpan(text: string, start: number): number {
  let open = start;
  while (text[open] === "`") open++;
  const length = open - start;

  for (let i = open; i < text.length; i++) {
    if (text[i] === "\n" && /^[ \t]*(\r?\n|$)/.test(text.slice(i + 1))) return start;
    if (text[i] !== "`") continue;
    let close = i;
    while (text[close] === "`") close++;
    if (close - i === length) return close;
    i = close - 1;
  }

  return start;
}

/**
 * Closes the holes the removals left.
 *
 * A comment on a line of its own leaves that line behind as whitespace, and
 * enough of them turn a note into a column of gaps. Runs of blank lines
 * collapse to one, which is the only separation Markdown gives meaning to
 * anyway.
 */
function tidy(text: string): string {
  return text
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
