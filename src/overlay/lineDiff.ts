/**
 * A line diff between two versions of a file, as hunks with a few lines of
 * context, the way `git diff` shows one. For Edit mode's Changes view: what
 * this session did to each file it touched.
 *
 * The common start and end are taken off first, so the work left is only
 * the part that changed, which for an edit made from the page is a handful
 * of lines. A middle too large to compare line by line is shown as all
 * removed and all added, which is still true, only less tidy.
 */

export interface DiffLine {
  /** " " for a line both have, "-" for one taken out, "+" for one put in. */
  kind: " " | "-" | "+";
  text: string;
}

export interface DiffHunk {
  /** `@@ -12,7 +12,8 @@`, lines counted from 1. */
  header: string;
  lines: DiffLine[];
}

const MAX_CELLS = 4_000_000;

function lines(text: string): string[] {
  if (text === "") return [];
  const out = text.split("\n");
  if (out[out.length - 1] === "") out.pop();
  return out;
}

/** The edit script for the middle: longest common subsequence, then a walk. */
function middle(a: string[], b: string[]): DiffLine[] {
  if (!a.length) return b.map((text) => ({ kind: "+", text }));
  if (!b.length) return a.map((text) => ({ kind: "-", text }));
  if (a.length * b.length > MAX_CELLS) {
    return [...a.map((text): DiffLine => ({ kind: "-", text })), ...b.map((text): DiffLine => ({ kind: "+", text }))];
  }
  const w = b.length + 1;
  const table = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * w + j] = a[i] === b[j] ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: " ", text: a[i] });
      i++;
      j++;
    } else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) {
      out.push({ kind: "-", text: a[i++] });
    } else {
      out.push({ kind: "+", text: b[j++] });
    }
  }
  while (i < a.length) out.push({ kind: "-", text: a[i++] });
  while (j < b.length) out.push({ kind: "+", text: b[j++] });
  return out;
}

/** The hunks that turn before into after, with this many lines of context. */
export function lineDiff(before: string, after: string, context = 3): DiffHunk[] {
  const a = lines(before);
  const b = lines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const all: DiffLine[] = [
    ...a.slice(0, head).map((text): DiffLine => ({ kind: " ", text })),
    ...middle(a.slice(head, a.length - tail), b.slice(head, b.length - tail)),
    ...a.slice(a.length - tail).map((text): DiffLine => ({ kind: " ", text })),
  ];

  // Group the changed lines, each with its context, merging groups that touch.
  const hunks: DiffHunk[] = [];
  let k = 0;
  let oldLine = 1;
  let newLine = 1;
  const counts: Array<[number, number]> = all.map((line) => {
    const at: [number, number] = [oldLine, newLine];
    if (line.kind !== "+") oldLine++;
    if (line.kind !== "-") newLine++;
    return at;
  });
  while (k < all.length) {
    if (all[k].kind === " ") {
      k++;
      continue;
    }
    const start = Math.max(0, k - context);
    let end = k;
    for (;;) {
      while (end < all.length && all[end].kind !== " ") end++;
      let next = end;
      while (next < all.length && all[next].kind === " " && next - end < context * 2) next++;
      if (next < all.length && all[next].kind !== " " && next - end <= context * 2) end = next;
      else break;
    }
    const stop = Math.min(all.length, end + context);
    const slice = all.slice(start, stop);
    const oldCount = slice.filter((l) => l.kind !== "+").length;
    const newCount = slice.filter((l) => l.kind !== "-").length;
    const [o, n] = counts[start];
    hunks.push({ header: `@@ -${oldCount ? o : o - 1},${oldCount} +${newCount ? n : n - 1},${newCount} @@`, lines: slice });
    k = stop;
  }
  return hunks;
}

/** A file's hunks as unified diff text, for copying. */
export function diffText(path: string, hunks: DiffHunk[]): string {
  if (!hunks.length) return "";
  const body = hunks.map((h) => [h.header, ...h.lines.map((l) => l.kind + l.text)].join("\n")).join("\n");
  return `--- a/${path}\n+++ b/${path}\n${body}\n`;
}
