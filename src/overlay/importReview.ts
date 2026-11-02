/**
 * Turning a saved review into a note in the vault.
 *
 * This is the half of the overlay that only an Obsidian plugin can do. A
 * comment widget can collect feedback on a page; a publisher running inside
 * the vault that produced the page can put that feedback back where the
 * writing happens. The loop closes here.
 *
 * Two decisions worth stating.
 *
 * **It writes one review note, not into the annotated notes.** Appending a
 * comment to the note it is about would mean mutating a reviewer's prose from
 * an imported file, and a malformed import would then be destructive rather
 * than merely wrong. The review note links to each note instead. Worth
 * offering the other way round later, as something someone asks for
 * explicitly.
 *
 * **Comments become tasks.** A review is something you work through, not
 * something you read, and a checkbox is how that is spelled in a vault. A
 * resolved comment arrives already ticked, so the list is a true picture of
 * what is left.
 */

import {
  BLOCK_TEXT_LIMIT,
  OVERLAY_SCHEMA_VERSION,
  OverlayComment,
  OverlayExport,
  OverlayExternalIssue,
  OverlayPriority,
  OverlayReply,
} from "./types";
import { labelPaths } from "./pageLabels";

/**
 * The Tasks plugin's own priority signifiers.
 *
 * Written as the signifiers rather than as the words "high" and "low" so
 * that a priority set in the browser is a priority the vault can sort by: a
 * review note is a task list, and the plugin that reads task lists here
 * knows these two characters. Medium priority has no signifier, which is
 * exactly right -- it is what a task without one already means.
 */
const PRIORITY_MARK: Record<OverlayPriority, string> = {
  high: "\u23eb",
  medium: "",
  low: "\ud83d\udd3d",
};

/** Thrown with a message meant for a Notice, not a stack trace. */
export class ReviewImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewImportError";
  }
}

/**
 * Reads a saved review file.
 *
 * Every field is checked and the optional ones are defaulted, because the
 * input is a file a person may have hand-edited, truncated or concatenated.
 * A bad one has to be rejected with something a reader can act on, rather
 * than half-importing and leaving the vault in a state nobody chose.
 */
export function parseExport(raw: string): OverlayExport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("it is not valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail("the top level is not an object");
  }

  const data = parsed as Record<string, unknown>;

  // A missing version is treated as the first one, which is what a file
  // written before the field existed would be.
  const version = data.version ?? OVERLAY_SCHEMA_VERSION;
  if (typeof version !== "number" || version > OVERLAY_SCHEMA_VERSION) {
    return fail(
      `it was written by a newer version (${String(version)}; this one reads ${OVERLAY_SCHEMA_VERSION})`,
    );
  }

  if (!Array.isArray(data.comments)) return fail("it has no comments array");

  return {
    version: OVERLAY_SCHEMA_VERSION,
    site: typeof data.site === "string" ? data.site : "",
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "",
    comments: data.comments.map(readComment),
  };
}

function fail(why: string): never {
  throw new ReviewImportError(`That file is not a saved review: ${why}.`);
}

function readComment(value: unknown, index: number): OverlayComment {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReviewImportError(`Comment ${index + 1} is not an object.`);
  }
  const row = value as Record<string, unknown>;

  if (typeof row.sourcePath !== "string" || !row.sourcePath) {
    throw new ReviewImportError(`Comment ${index + 1} names no note.`);
  }
  if (typeof row.text !== "string" || !row.text.trim()) {
    throw new ReviewImportError(`Comment ${index + 1} has no text.`);
  }

  return {
    id: typeof row.id === "string" && row.id ? row.id : `imported-${index}`,
    page: typeof row.page === "string" ? row.page : "",
    sourcePath: row.sourcePath,
    block: typeof row.block === "string" ? row.block : null,
    // Which screen of an application the comment was left on. Absent from a
    // page the build rendered and from any review written before the field
    // existed, and null means the same thing in both: not tied to a screen.
    route: typeof row.route === "string" && row.route ? row.route : null,
    blockText:
      typeof row.blockText === "string"
        ? row.blockText.slice(0, BLOCK_TEXT_LIMIT)
        : "",
    // A file written before the drop point existed has none, and the overlay
    // falls back to the block's corner for it. Nothing here needs a position
    // at all, so a missing one is a default rather than a rejection.
    x: num(row.x),
    y: num(row.y),
    rx: typeof row.rx === "number" ? row.rx : null,
    ry: typeof row.ry === "number" ? row.ry : null,
    author: typeof row.author === "string" && row.author ? row.author : "Anonymous",
    text: row.text,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
    resolved: row.resolved === true,
    priority: readPriority(row.priority),
    // A tool may write this in; nothing refuses a review for lacking it.
    agent: typeof row.agent === "string" && row.agent ? row.agent : null,
    // Where the browser got it from, when it did not make it. Carried
    // through so a comment that came in from a file still says so after a
    // round trip through the vault.
    imported: typeof row.imported === "string" && row.imported ? row.imported : null,
    external: readExternal(row.external),
    replies: readReplies(row.replies, index),
  };
}

/**
 * A comment's priority, with the name it used to go by read across.
 *
 * `normal` is what the middle level was called until schema 6, and a review
 * file in a vault outlives the build that wrote it, so it has to keep
 * reading. It maps to `medium` rather than being rejected, because it is the
 * same level under a worse name -- and it is also what an unrecognised value
 * falls back to, which it already was.
 */
function readPriority(value: unknown): OverlayPriority {
  return value === "high" || value === "low" ? value : "medium";
}

/**
 * The issue a comment was filed as, or null.
 *
 * Checked the same way the overlay checks it, and for the same reason: this
 * ends up as a link in a note somebody clicks, and a file that has been
 * hand-edited could carry anything. A record with no key or no http address
 * is no record.
 */
function readExternal(value: unknown): OverlayExternalIssue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.key !== "string" || !row.key) return null;
  if (typeof row.url !== "string" || !/^https?:\/\//.test(row.url)) return null;
  return {
    provider:
      row.provider === "jira" || row.provider === "asana" ? row.provider : "github",
    key: row.key,
    url: row.url,
    filedAt: typeof row.filedAt === "string" ? row.filedAt : "",
  };
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Replies, skipping anything that is not one.
 *
 * Unlike a comment, a malformed reply is dropped rather than thrown: a
 * comment with one unreadable follow-up is still worth importing, and
 * refusing the whole review over it would be a worse trade than losing a
 * line nobody can read anyway.
 */
function readReplies(value: unknown, index: number): OverlayReply[] {
  if (!Array.isArray(value)) return [];
  const out: OverlayReply[] = [];

  value.forEach((entry, position) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const row = entry as Record<string, unknown>;
    if (typeof row.text !== "string" || !row.text.trim()) return;
    out.push({
      id:
        typeof row.id === "string" && row.id
          ? row.id
          : `imported-${index}-${position}`,
      author: typeof row.author === "string" && row.author ? row.author : "Anonymous",
      text: row.text,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
    });
  });

  return out;
}

/** Vault path to the name a wikilink uses: the basename, without extension. */
export function noteName(sourcePath: string): string {
  const base = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
  return base.replace(/\.md$/i, "");
}

/**
 * A heading's link to the file its comments are about.
 *
 * `[[Plan]]` while the filename says which file that is, which is the normal
 * case and the one a reader would write by hand. `[[react-default/index.html|
 * react-default/index]]` when it does not -- and that is not only a labelling
 * problem. Obsidian resolves a short link by looking for the nearest file of
 * that name, so a vault publishing four applications as they are gets four
 * sections headed `[[index.html]]`, three of which open the wrong one. A link
 * that carries the folder resolves to exactly the file the comment was left
 * on, and the alias keeps the heading reading like the panel the comment was
 * written in.
 *
 * The extension stays on a page published as-is and comes off a note, which
 * is what each one needs to resolve: `[[library/Scope]]` finds `Scope.md`,
 * and `[[react-default/index]]` would find nothing at all.
 */
export function noteLink(sourcePath: string, label: string): string {
  const bare = noteName(sourcePath);
  if (label === bare) return `[[${bare}]]`;
  return `[[${sourcePath.replace(/\.md$/i, "")}|${label}]]`;
}

/** Comments grouped by the note they are about, each group in time order. */
export function groupByNote(
  comments: OverlayComment[],
): Array<{ sourcePath: string; comments: OverlayComment[] }> {
  const groups = new Map<string, OverlayComment[]>();
  for (const comment of comments) {
    const row = groups.get(comment.sourcePath) ?? [];
    row.push(comment);
    groups.set(comment.sourcePath, row);
  }

  return [...groups.entries()]
    .map(([sourcePath, rows]) => ({
      sourcePath,
      comments: [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }))
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

/**
 * Escapes the characters that would turn a comment into Markdown.
 *
 * A reviewer writing "- [ ] do this" or "# heading" means those literally,
 * and a comment that silently became a nested task or a section break would
 * misreport what they said. Only the leading characters matter, since that is
 * where Markdown's block syntax is read.
 */
export function flattenForList(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^(\s*)([-*+>#]|\d+\.)/, "$1\\$2"))
    .join("\n");
}

export interface ReviewNoteInput {
  comments: OverlayComment[];
  /** Site name from the export, for the one line of provenance. */
  site: string;
  /** Now, injectable so a test is reproducible. */
  now: Date;
}

/**
 * The review note.
 *
 * One section per annotated note, one task per comment, the block's own text
 * quoted beneath it. The quote is what makes an orphan useful: when a comment
 * has no anchor any more it is because the text it was about was rewritten,
 * and the old text is the only way to tell what the objection referred to.
 */
export function reviewNote(input: ReviewNoteInput): string {
  const { comments, site, now } = input;
  const day = isoDay(now);
  const groups = groupByNote(comments);
  const open = comments.filter((comment) => !comment.resolved).length;

  const lines: string[] = [];
  lines.push("---");
  lines.push(`created: ${day}`);
  lines.push("tags:");
  lines.push("  - review");
  lines.push("---");
  lines.push("");
  lines.push(`# Review ${day}`);
  lines.push("");
  lines.push(
    `${count(comments.length, "comment")} on ${count(groups.length, "note")}` +
      `, ${open} still open` +
      (site ? `, from ${site}` : "") +
      ".",
  );
  lines.push("");

  // Over the whole set at once, because whether a filename needs its folder
  // is a fact about the list it is in rather than about the file. The same
  // rule the overlay's own panel labels by, so a heading here and the group
  // it was read under over there say the same thing.
  const labels = labelPaths(groups.map((group) => group.sourcePath));

  for (const group of groups) {
    const label = labels.get(group.sourcePath) ?? noteName(group.sourcePath);
    lines.push(`## ${noteLink(group.sourcePath, label)}`);
    lines.push("");
    for (const comment of group.comments) {
      const box = comment.resolved ? "x" : " ";
      const body = flattenForList(comment.text.trim())
        .split("\n")
        .map((line, index) => (index === 0 ? line : `      ${line}`))
        .join("\n");
      // The signifier leads the line rather than trailing it: a comment can
      // run to several lines, and what is being asked for should be readable
      // from the left edge of the list without reading to the end of one.
      const mark = PRIORITY_MARK[comment.priority];
      lines.push(`- [${box}] ${mark ? `${mark} ` : ""}${body}`);
      if (comment.blockText) {
        lines.push(`      > ${comment.blockText}`);
      }
      lines.push(`      ${attribution(comment)}`);
      // Replies as a nested list rather than more tasks: a reply is part of
      // the argument about one comment, not a second thing to do.
      for (const reply of comment.replies) {
        const text = flattenForList(reply.text.trim())
          .split("\n")
          .map((line, index) => (index === 0 ? line : `        ${line}`))
          .join("\n");
        lines.push(`      - ${text} ${said(reply.author, reply.createdAt)}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function attribution(comment: OverlayComment): string {
  // Said, because a name alone does not tell anyone whether a person read
  // the page or a tool was handed the file.
  const who = comment.agent
    ? `${comment.author} (via ${comment.agent})`
    : comment.author;
  const parts = [who];
  if (comment.createdAt) parts.push(isoDay(new Date(comment.createdAt)));
  // Said plainly rather than left for someone to work out from a missing pin.
  if (!comment.block) parts.push("about the page");
  // Outside the italics: it is a link, and a link nobody can tell from the
  // prose around it is a link nobody clicks.
  const filed = comment.external
    ? ` [${comment.external.key}](${comment.external.url})`
    : "";
  return `*${parts.join(", ")}*${filed}`;
}

function said(author: string, createdAt: string): string {
  const parts = [author];
  if (createdAt) parts.push(isoDay(new Date(createdAt)));
  return `*${parts.join(", ")}*`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function isoDay(date: Date): string {
  const valid = Number.isNaN(date.getTime()) ? new Date(0) : date;
  return valid.toISOString().slice(0, 10);
}

/** Filename for a review note, unique within the day it was imported. */
export function reviewNoteName(now: Date, taken: (name: string) => boolean): string {
  const base = `Review ${isoDay(now)}`;
  if (!taken(`${base}.md`)) return `${base}.md`;
  for (let n = 2; n < 100; n++) {
    if (!taken(`${base} ${n}.md`)) return `${base} ${n}.md`;
  }
  return `${base} ${Date.now()}.md`;
}

/**
 * Sorts the review folder's files into the live store and one-off drops.
 *
 * The distinction matters more than it looks. The live file is the one the
 * review server is writing to as someone works; renaming it -- which is what
 * an import does to everything it consumes -- would pull the store out from
 * under a review in progress, and the next comment would land in a new, empty
 * file with everything before it gone. So the live file is read and left
 * exactly where it is, and only the hand-dropped files are renamed.
 */
export function splitReviewInputs(
  files: string[],
  liveName: string,
): { live: string[]; drops: string[] } {
  const candidates = files.filter(
    (path) => path.endsWith(".json") && !path.endsWith(".imported.json"),
  );
  const isLive = (path: string) => path.split("/").pop() === liveName;
  return {
    live: candidates.filter(isLive),
    drops: candidates.filter((path) => !isLive(path)),
  };
}
