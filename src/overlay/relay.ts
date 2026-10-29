/**
 * Turning a review comment into an issue in a tracker.
 *
 * The review loop already closes inside the vault: a comment becomes a task
 * in a review note, and the writing happens a few lines away from it. This is
 * for the other case -- where the work a comment asks for is not the
 * reviewer's to do, and the place it gets scheduled is a board somebody else
 * reads. Copying a comment there by hand is the step that quietly does not
 * happen, so the comment is the only record and the board does not know.
 *
 * Three decisions worth stating, because each of them is a thing this
 * deliberately does not do.
 *
 * **No relay server.** The name this was sketched under, but it needs none:
 * `requestUrl` goes straight to the GitHub API from inside Obsidian, past the
 * renderer's CORS rules, with the token the plugin already holds. A hosted
 * relay would only buy OAuth, which is a product rather than a feature.
 *
 * **It runs in the plugin, never in the page.** The overlay asks; the plugin
 * files. A browser doing it itself would need the credential, and the
 * credential would have to be written into a preview file sitting on disk.
 *
 * **It is a send, not a sync.** One comment goes one way, once, when someone
 * asks for it. Nothing watches the issue afterwards and nothing reconciles
 * the two: a comment and the issue filed from it are allowed to diverge,
 * because the alternative is a two-way sync nobody asked for, every one of
 * whose failures silently edits somebody's tracker.
 *
 * Everything in this file is pure. The HTTP is in `GitHubClient`, the
 * settings and the file writing are in `main.ts`, and what is left here --
 * which comment is eligible, what the issue says -- is the part worth
 * testing without a network.
 */

import { OverlayComment, OverlayExternalIssue, OverlayPriority } from "./types";

/** Trackers this knows how to file into. */
export type RelayProvider = "none" | "github";

/** Longest issue title, before the rest of the first line is left to the body. */
const TITLE_LIMIT = 72;

/**
 * The label a priority earns, or nothing.
 *
 * Normal earns nothing, matching the overlay: a comment left without a
 * thought about its priority should not arrive carrying a claim about one.
 */
const PRIORITY_LABEL: Record<OverlayPriority, string> = {
  high: "priority: high",
  normal: "",
  low: "priority: low",
};

/** Where issues go, once the settings have been resolved into a repository. */
export interface RelayTarget {
  provider: "github";
  owner: string;
  repo: string;
  /** Labels every filed issue carries, before the priority one is added. */
  labels: string[];
}

/** What the relay was told, before it is known to be usable. */
export interface RelaySettings {
  provider: RelayProvider;
  /** Blank falls back to the publish repository's owner. */
  owner: string;
  /** Blank falls back to the publish repository. */
  repo: string;
  /** Comma-separated, as the settings field holds it. */
  labels: string;
}

export const DEFAULT_RELAY_LABELS = "review";

/**
 * The repository to file into, or a sentence saying why there is none.
 *
 * A string back rather than a throw or a null: every caller has to tell
 * somebody what is missing, and "set a repository in settings" is more use
 * than a disabled button with no explanation.
 */
export function resolveTarget(
  settings: RelaySettings,
  publishRepo: { owner: string; repo: string },
): RelayTarget | string {
  if (settings.provider !== "github") return "No tracker is set up.";

  const owner = settings.owner.trim() || publishRepo.owner.trim();
  const repo = settings.repo.trim() || publishRepo.repo.trim();
  if (!owner || !repo) {
    return "Name the repository to file issues in, in settings.";
  }

  return { provider: "github", owner, repo, labels: splitLabels(settings.labels) };
}

/** `a, b,, b` to `["a", "b"]`: trimmed, de-duplicated, empties dropped. */
export function splitLabels(value: string): string[] {
  const out: string[] = [];
  for (const part of value.split(",")) {
    const label = part.trim();
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

/**
 * Whether this comment is one to file.
 *
 * Resolved comments are out because the thing they asked for has already
 * happened, and an issue filed for it would arrive asking for work that is
 * done. Already-filed ones are out because filing twice is the failure this
 * whole field exists to prevent.
 */
export function relayable(comment: OverlayComment): boolean {
  return !comment.resolved && !comment.external && Boolean(comment.text.trim());
}

/** The comments a "send everything" run would file, in a stable order. */
export function pendingComments(comments: OverlayComment[]): OverlayComment[] {
  return comments
    .filter(relayable)
    .slice()
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export interface IssueContext {
  /** Site name, for the one line saying where the review happened. */
  site: string;
}

export interface IssueDraft {
  title: string;
  body: string;
  labels: string[];
}

/**
 * The issue a comment becomes.
 *
 * The title is the comment's first line, because that is where a reviewer
 * puts the point; the body is the whole comment again, so nothing is lost to
 * the clipping. The quoted block is what makes the issue readable by someone
 * who was not at the review: without it an issue says "this paragraph is
 * wrong" about a paragraph the reader cannot see.
 */
export function issueFor(
  comment: OverlayComment,
  target: RelayTarget,
  context: IssueContext,
): IssueDraft {
  const text = comment.text.trim();
  const labels = target.labels.slice();
  const priority = PRIORITY_LABEL[comment.priority];
  if (priority && !labels.includes(priority)) labels.push(priority);

  const lines: string[] = [];
  lines.push(text);

  if (comment.blockText) {
    lines.push("", "> " + comment.blockText.replace(/\n+/g, " "));
  }

  if (comment.replies.length) {
    lines.push("", "**Replies**", "");
    for (const reply of comment.replies) {
      const said = reply.text.trim().replace(/\n+/g, " ");
      lines.push(`- **${reply.author || "Anonymous"}**: ${said}`);
    }
  }

  lines.push("", "---", "");
  lines.push(
    `From a review of ${context.site || "the site"}${
      comment.block ? "" : ", about the page as a whole"
    }.`,
  );
  lines.push("");
  lines.push(`- Note: \`${comment.sourcePath}\``);
  if (comment.page) lines.push(`- Page: \`${comment.page}\``);
  lines.push(
    `- ${by(comment)}${comment.createdAt ? `, ${isoDay(comment.createdAt)}` : ""}`,
  );

  return { title: issueTitle(comment), body: lines.join("\n"), labels };
}

/**
 * The comment's first line, short enough to read in a list.
 *
 * Cut at a space rather than mid-word, since the body repeats the whole
 * thing anyway and a title ending "the paragraph about perfor" reads as a
 * bug in the tool rather than as a clipped sentence.
 */
export function issueTitle(comment: OverlayComment): string {
  const first =
    comment.text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  const flat = first.replace(/\s+/g, " ");
  if (!flat) return `Review comment on ${noteName(comment.sourcePath)}`;
  if (flat.length <= TITLE_LIMIT) return flat;

  const cut = flat.slice(0, TITLE_LIMIT);
  const space = cut.lastIndexOf(" ");
  return (space > TITLE_LIMIT / 2 ? cut.slice(0, space) : cut).replace(/[,;:]$/, "") + "…";
}

function by(comment: OverlayComment): string {
  const who = comment.author || "Anonymous";
  return comment.agent ? `${who} (via ${comment.agent})` : who;
}

function noteName(sourcePath: string): string {
  const base = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
  return base.replace(/\.md$/i, "");
}

function isoDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
}

/** How a person refers to an issue, which is also what the overlay shows. */
export function issueKey(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`;
}

/** The record written back onto the comment once an issue exists. */
export function externalFor(
  target: RelayTarget,
  issue: { number: number; html_url: string },
  now: Date,
): OverlayExternalIssue {
  return {
    provider: "github",
    key: issueKey(target.owner, target.repo, issue.number),
    url: issue.html_url,
    filedAt: now.toISOString(),
  };
}

/**
 * Writes issue records into a review document, without disturbing the rest.
 *
 * The file is parsed and re-serialized rather than edited as text, but only
 * the one field is set: everything else goes back exactly as the browser
 * wrote it, including fields a later version of the overlay might add that
 * this one knows nothing about. Returns null when the document cannot be
 * read, so a caller can leave a file it does not understand alone.
 *
 * Applied to a *fresh* read, immediately before the write, because the
 * browser is saving the same file as comments are left and a document read
 * before a round of HTTP calls is already out of date by the time they
 * finish.
 */
export function applyExternals(
  raw: string,
  externals: Map<string, OverlayExternalIssue>,
): string | null {
  if (!externals.size) return raw;

  let document: { comments?: unknown };
  try {
    document = JSON.parse(raw) as { comments?: unknown };
  } catch {
    return null;
  }
  if (!document || typeof document !== "object" || !Array.isArray(document.comments)) {
    return null;
  }

  for (const row of document.comments) {
    if (!row || typeof row !== "object") continue;
    const comment = row as { id?: unknown; external?: unknown };
    if (typeof comment.id !== "string") continue;
    const external = externals.get(comment.id);
    if (external) comment.external = external;
  }

  return JSON.stringify(document, null, 2);
}
