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
 * Four decisions worth stating, because each of them is a thing this
 * deliberately does not do.
 *
 * **No relay server.** The name this was sketched under, but it needs none:
 * `requestUrl` goes straight to each tracker's API from inside Obsidian, past
 * the renderer's CORS rules, with a token the plugin holds. A hosted relay
 * would only buy OAuth, which is a product rather than a feature.
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
 * **The body is built as blocks, not as Markdown.** Three trackers want three
 * different things -- GitHub takes Markdown, Jira takes a JSON document it
 * calls ADF, Asana takes plain text -- and one Markdown string handed to all
 * three arrives in two of them with its asterisks showing. So the body is
 * built once as structure and rendered per tracker, which also makes a fourth
 * tracker a renderer rather than a rewrite.
 *
 * Everything in this file is pure. The HTTP is in the clients, the settings
 * and the file writing are in `main.ts`, and what is left here -- which
 * comment is eligible, what the issue says -- is the part worth testing
 * without a network.
 */

import {
  OverlayComment,
  OverlayExternalIssue,
  OverlayPriority,
  OverlayWithdrawn,
} from "./types";

/** Trackers this knows how to file into. */
export type RelayProvider = "none" | "github" | "jira" | "asana";

/** What a tracker is called, for a menu label and a sentence. */
export const TRACKER_NAME: Record<Exclude<RelayProvider, "none">, string> = {
  github: "GitHub",
  jira: "Jira",
  asana: "Asana",
};

/**
 * How a Jira is reached.
 *
 * Not a cosmetic setting: it decides the credential, the REST version and the
 * format the description has to be in. Cloud takes an email with an API token
 * over basic auth, and only Cloud has the v3 API that reads ADF. A Jira a
 * company runs itself takes a personal access token as a bearer token -- or a
 * username and a password, on a version too old to have tokens -- and its API
 * is v2, whose description field is wiki markup rather than a document.
 */
export type JiraAuth = "cloud" | "pat" | "basic";

/** What each way of signing in is called, in the panel and in a sentence. */
export const JIRA_AUTH_LABEL: Record<JiraAuth, string> = {
  cloud: "Jira Cloud: email and API token",
  pat: "Server or Data Center: personal access token",
  basic: "Server or Data Center: username and password",
};

/** The credential each one asks for, for the sentence when it is missing. */
export const JIRA_CREDENTIAL_NAME: Record<JiraAuth, string> = {
  cloud: "API token",
  pat: "personal access token",
  basic: "password",
};

/** Longest issue title, before the rest of the first line is left to the body. */
const TITLE_LIMIT = 72;

/**
 * The label a priority earns, or nothing.
 *
 * Medium earns nothing, matching the overlay: a comment left without a
 * thought about its priority should not arrive carrying a claim about one.
 */
const PRIORITY_LABEL: Record<OverlayPriority, string> = {
  high: "priority: high",
  medium: "",
  low: "priority: low",
};

/** The same thing in a sentence, for a tracker that has no labels. */
const PRIORITY_WORD: Record<OverlayPriority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * Where issues go, once the settings have been resolved into something
 * usable. One shape per tracker, because what each one needs to be told has
 * almost nothing in common with the others.
 */
export type RelayTarget =
  | { provider: "github"; owner: string; repo: string; labels: string[] }
  | {
      provider: "jira";
      /**
       * Where the API is, context path included:
       * https://acme.atlassian.net, or https://jira.acme.com/jira
       */
      site: string;
      /** Where a person opens the issue, when that is not where the API is. */
      browseUrl: string;
      /** Project key, e.g. ENG */
      project: string;
      /** Issue type name. "Task" unless somebody chose otherwise. */
      issueType: string;
      auth: JiraAuth;
      /** Email on Cloud, username on basic auth, nothing with a token. */
      user: string;
      labels: string[];
    }
  | {
      provider: "asana";
      /** Project gid tasks are created in. */
      project: string;
      /** Workspace gid. Optional, since a project implies one. */
      workspace: string;
    };

/** What the relay was told, before it is known to be usable. */
export interface RelaySettings {
  provider: RelayProvider;
  /** Comma-separated. GitHub and Jira have labels; Asana does not. */
  labels: string;
  github: {
    /** Blank falls back to the publish repository's owner. */
    owner: string;
    /** Blank falls back to the publish repository. */
    repo: string;
  };
  jira: {
    site: string;
    /** Optional. The address a person opens Jira at, if the API is elsewhere. */
    browseUrl: string;
    project: string;
    issueType: string;
    auth: JiraAuth;
    /** The Atlassian account, on Cloud. */
    email: string;
    /** The account, with basic auth on a Jira somebody runs themselves. */
    username: string;
  };
  asana: {
    project: string;
    workspace: string;
  };
}

export const DEFAULT_RELAY_LABELS = "review";
export const DEFAULT_JIRA_ISSUE_TYPE = "Task";

/**
 * Where to file, or a sentence saying why there is nowhere.
 *
 * A string back rather than a throw or a null: every caller has to tell
 * somebody what is missing, and "name the project in settings" is more use
 * than a disabled button with no explanation.
 *
 * The credential is deliberately not checked here. It lives in memory in the
 * plugin, never in a settings object that gets passed around or written into
 * a test, and the plugin says its own sentence about it.
 */
export function resolveTarget(
  settings: RelaySettings,
  publishRepo: { owner: string; repo: string },
): RelayTarget | string {
  const labels = splitLabels(settings.labels);

  if (settings.provider === "github") {
    const owner = settings.github.owner.trim() || publishRepo.owner.trim();
    const repo = settings.github.repo.trim() || publishRepo.repo.trim();
    if (!owner || !repo) {
      return "Name the repository to file issues in, in settings.";
    }
    return { provider: "github", owner, repo, labels };
  }

  if (settings.provider === "jira") {
    const site = jiraSite(settings.jira.site);
    const project = settings.jira.project.trim().toUpperCase();
    const auth = settings.jira.auth;
    // A token is the whole credential; the other two name an account as well.
    const user =
      auth === "cloud"
        ? settings.jira.email.trim()
        : auth === "basic"
          ? settings.jira.username.trim()
          : "";
    if (!site) return "Name your Jira site in settings, e.g. acme.atlassian.net.";
    if (!project) return "Name the Jira project key to file issues in, in settings.";
    if (auth === "cloud" && !user) {
      return "Jira Cloud needs the email address its API token belongs to.";
    }
    if (auth === "basic" && !user) {
      return "Jira needs the username that password belongs to.";
    }
    return {
      provider: "jira",
      site,
      browseUrl: jiraSite(settings.jira.browseUrl),
      project,
      issueType: settings.jira.issueType.trim() || DEFAULT_JIRA_ISSUE_TYPE,
      auth,
      user,
      labels,
    };
  }

  if (settings.provider === "asana") {
    const project = settings.asana.project.trim();
    if (!project) return "Name the Asana project to file tasks in, in settings.";
    return { provider: "asana", project, workspace: settings.asana.workspace.trim() };
  }

  return "No tracker is set up.";
}

/**
 * A Jira site as a URL.
 *
 * People copy this out of a browser, so it arrives as a bare host, as a URL
 * with a path still on it, or with a trailing slash. All three name the same
 * site, and none of them should be a failure somebody has to work out.
 *
 * The part that is not obvious is the path. On Cloud there is never one, so
 * everything after the host is a deep link into a board and goes. A Jira a
 * company runs is very often served under a context path -- /jira, /itsm --
 * and there the path is the install root: throw it away and every request
 * lands on the reverse proxy's front page instead of the API. So one segment
 * is kept, unless it is a segment Jira's own UI puts there.
 *
 * The limit of the rule: a context path two segments deep has its second
 * segment dropped, which is rare enough to be worth the simplicity, and
 * visible immediately rather than subtly wrong.
 */
export function jiraSite(value: string): string {
  const raw = value.trim().replace(/\/+$/, "");
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (CLOUD_HOST.test(url.hostname)) return url.origin;
    const first = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (!first || UI_SEGMENT.has(first.toLowerCase())) return url.origin;
    return `${url.origin}/${first}`;
  } catch {
    return "";
  }
}

/** Atlassian-hosted, where a path is always a deep link and never a root. */
const CLOUD_HOST = /(^|\.)(atlassian\.net|jira\.com)$/i;

/**
 * First segments that belong to Jira's own UI or API rather than to the
 * install. Anything else in that position is taken for a context path.
 *
 * "jira" is deliberately not one of them. It is the first segment of Cloud's
 * own URLs, which is why those are settled by the host before this is reached,
 * and on a site a company runs it is the context path almost every time.
 */
const UI_SEGMENT = new Set([
  "browse",
  "issues",
  "login.jsp",
  "plugins",
  "projects",
  "rest",
  "secure",
  "servicedesk",
]);

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

/** One line of a list: an optional lead, then the rest. */
export interface IssueLine {
  lead?: string;
  text: string;
  /** Sets a path or an identifier apart from the prose around it. */
  code?: boolean;
}

/**
 * A piece of an issue body, before any tracker has seen it.
 *
 * Deliberately short of a document model: five shapes, which is what a
 * comment actually produces, and nothing that would need a parser.
 */
export type IssueBlock =
  | { kind: "text"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; items: IssueLine[] }
  | { kind: "rule" };

export interface IssueDraft {
  title: string;
  blocks: IssueBlock[];
  /** Ignored by a tracker that has no labels. */
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
export function issueDraft(
  comment: OverlayComment,
  target: RelayTarget,
  context: IssueContext,
): IssueDraft {
  const blocks: IssueBlock[] = [];

  for (const paragraph of comment.text.trim().split(/\n{2,}/)) {
    if (paragraph.trim()) blocks.push({ kind: "text", text: paragraph.trim() });
  }

  if (comment.blockText) {
    blocks.push({ kind: "quote", text: comment.blockText.replace(/\n+/g, " ") });
  }

  if (comment.replies.length) {
    blocks.push({ kind: "heading", text: "Replies" });
    blocks.push({
      kind: "list",
      items: comment.replies.map((reply) => ({
        lead: reply.author || "Anonymous",
        text: reply.text.trim().replace(/\n+/g, " "),
      })),
    });
  }

  blocks.push({ kind: "rule" });
  blocks.push({
    kind: "text",
    text:
      `From a review of ${context.site || "the site"}` +
      (comment.block ? "" : ", about the page as a whole") +
      ".",
  });

  const footer: IssueLine[] = [{ lead: "Note", text: comment.sourcePath, code: true }];
  if (comment.page) footer.push({ lead: "Page", text: comment.page, code: true });
  // Only where it has nowhere else to go. On a tracker with labels the
  // priority is one, which is something a board can filter on; saying it
  // twice would only be a line to read past.
  if (target.provider === "asana" && comment.priority !== "medium") {
    footer.push({ lead: "Priority", text: PRIORITY_WORD[comment.priority] });
  }
  footer.push({
    text: `${by(comment)}${comment.createdAt ? `, ${isoDay(comment.createdAt)}` : ""}`,
  });
  blocks.push({ kind: "list", items: footer });

  return { title: issueTitle(comment), blocks, labels: labelsFor(comment, target) };
}

function labelsFor(comment: OverlayComment, target: RelayTarget): string[] {
  // Asana has no labels at all. Its tags are objects with their own
  // identifiers, which would mean asking somebody to paste a second set of
  // numbers in for a thing they did not ask for.
  if (target.provider === "asana") return [];

  const labels = target.labels.slice();
  const priority = PRIORITY_LABEL[comment.priority];
  if (priority && !labels.includes(priority)) labels.push(priority);
  return labels;
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

/* --- rendering, one tracker at a time ---------------------------------- */

/** GitHub: Markdown, which is what an issue body is written in there. */
export function toMarkdown(blocks: IssueBlock[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.kind === "text") out.push(block.text);
    else if (block.kind === "quote") out.push(`> ${block.text}`);
    else if (block.kind === "heading") out.push(`**${block.text}**`);
    else if (block.kind === "rule") out.push("---");
    else {
      out.push(
        block.items
          .map((item) => {
            const body = item.code ? `\`${item.text}\`` : item.text;
            return item.lead ? `- **${item.lead}**: ${body}` : `- ${body}`;
          })
          .join("\n"),
      );
    }
  }
  return out.join("\n\n");
}

/** Asana: plain text, which is what its notes field holds. */
export function toText(blocks: IssueBlock[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.kind === "text") out.push(block.text);
    else if (block.kind === "quote") out.push(`"${block.text}"`);
    else if (block.kind === "heading") out.push(`${block.text}:`);
    // A rule is a Markdown idea. In plain text the blank line between two
    // blocks already draws the separation it stood for.
    else if (block.kind === "rule") continue;
    else {
      out.push(
        block.items
          .map((item) => `• ${item.lead ? `${item.lead}: ` : ""}${item.text}`)
          .join("\n"),
      );
    }
  }
  return out.join("\n\n");
}

/**
 * Jira: the Atlassian Document Format its API takes.
 *
 * A JSON document rather than a string, which is the whole reason the body
 * is built as blocks: handing Jira Markdown files an issue with its
 * asterisks and backticks showing.
 */
export function toAdf(blocks: IssueBlock[]): unknown {
  const content: unknown[] = [];
  for (const block of blocks) {
    if (block.kind === "text") content.push(paragraph(block.text));
    else if (block.kind === "quote") {
      content.push({ type: "blockquote", content: [paragraph(block.text)] });
    } else if (block.kind === "heading") {
      content.push({
        type: "heading",
        attrs: { level: 3 },
        content: [{ type: "text", text: block.text }],
      });
    } else if (block.kind === "rule") content.push({ type: "rule" });
    else {
      content.push({
        type: "bulletList",
        content: block.items.map((item) => ({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                ...(item.lead
                  ? [
                      { type: "text", text: item.lead, marks: [{ type: "strong" }] },
                      { type: "text", text: ": " },
                    ]
                  : []),
                {
                  type: "text",
                  text: item.text,
                  ...(item.code ? { marks: [{ type: "code" }] } : {}),
                },
              ],
            },
          ],
        })),
      });
    }
  }
  return { type: "doc", version: 1, content };
}

/**
 * Jira Server and Data Center: wiki markup.
 *
 * ADF and the v3 API that reads it are Cloud's. A company's own Jira answers
 * on v2, whose description is a string in Atlassian's wiki markup, and an ADF
 * document posted there is stored as the text of its own JSON.
 */
export function toWiki(blocks: IssueBlock[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.kind === "text") out.push(wikiSafe(block.text));
    else if (block.kind === "quote") out.push(`{quote}${wikiSafe(block.text)}{quote}`);
    else if (block.kind === "heading") out.push(`h3. ${wikiSafe(block.text)}`);
    else if (block.kind === "rule") out.push("----");
    else {
      out.push(
        block.items
          .map((item) => {
            const body = item.code ? `{{${wikiSafe(item.text)}}}` : wikiSafe(item.text);
            return item.lead ? `* *${wikiSafe(item.lead)}*: ${body}` : `* ${body}`;
          })
          .join("\n"),
      );
    }
  }
  return out.join("\n\n");
}

/**
 * Text that will not be read as markup.
 *
 * A brace or a bracket in a comment is markup to Jira, and the one that
 * matters is a brace: a reviewer who writes "{code}" or "{quote}" in a
 * sentence would otherwise close the block it sits in and take the rest of
 * the issue with it. A backslash is Jira's own escape.
 */
function wikiSafe(text: string): string {
  return text.replace(/([{[])/g, "\\$1");
}

/**
 * The description, in the form the Jira at the other end can read.
 *
 * Paired with the API version the client picks from the same setting, because
 * the two are one decision: v3 refuses a string, and v2 cannot make sense of
 * a document.
 */
export function jiraDescription(blocks: IssueBlock[], auth: JiraAuth): unknown {
  return auth === "cloud" ? toAdf(blocks) : toWiki(blocks);
}

function paragraph(text: string): unknown {
  // An empty text node is not valid ADF, and the whole document is refused
  // over one.
  return { type: "paragraph", content: text ? [{ type: "text", text }] : [] };
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

/** How a person refers to a GitHub issue, which is also what the pill shows. */
export function issueKey(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`;
}

/** The record written back onto the comment once the issue exists. */
export function externalFor(
  provider: Exclude<RelayProvider, "none">,
  filed: { key: string; url: string },
  now: Date,
): OverlayExternalIssue {
  return {
    provider,
    key: filed.key,
    url: filed.url,
    filedAt: now.toISOString(),
    closedAt: null,
  };
}

/* --- asking a tracker whether the work is done ------------------------- */

/**
 * Catching up on comments that were filed.
 *
 * Filing is a send, not a sync, and this does not change that: nothing
 * watches an issue, nothing is written to anybody's tracker, and nothing
 * here can reopen a comment. What it does is answer the one question a
 * reviewer actually asks later -- "is that one dealt with?" -- by asking the
 * tracker once, when somebody wants to know.
 *
 * The direction is the whole safety argument. A tracker can only resolve a
 * comment, never reopen one, so the worst a wrong answer can do is tick off
 * something that was already ticked off locally, and a mistake is undone by
 * clicking Resolve off.
 */

/** What a tracker said about an issue, once its own vocabulary is dropped. */
export type IssueState =
  /** Still open, or in progress. Nothing to do. */
  | "open"
  /** Done. The comment can be resolved. */
  | "done"
  /**
   * Closed without the work being done: won't do, duplicate, not planned.
   * Deliberately not treated as done -- quietly resolving a comment nobody
   * acted on is the one failure this whole feature could cause.
   */
  | "declined";

/** An issue to ask about, recovered from what was written on the comment. */
export type IssueRef =
  | { provider: "github"; owner: string; repo: string; number: number }
  | { provider: "jira"; key: string }
  | { provider: "asana"; gid: string };

/**
 * The issue a comment was filed as, as something a client can look up.
 *
 * Recovered from the key rather than stored separately, because the key is
 * already there on every comment filed by any version of this: a second
 * field would be empty for exactly the comments this is for. Each format is
 * one this file wrote, so parsing it is reading our own handwriting.
 */
export function issueRef(external: OverlayExternalIssue): IssueRef | null {
  const key = String(external.key ?? "").trim();

  if (external.provider === "github") {
    const parts = /^([^/\s]+)\/([^/#\s]+)#(\d+)$/.exec(key);
    if (!parts) return null;
    return {
      provider: "github",
      owner: parts[1],
      repo: parts[2],
      number: Number(parts[3]),
    };
  }

  if (external.provider === "jira") {
    if (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(key)) return null;
    return { provider: "jira", key: key.toUpperCase() };
  }

  if (external.provider === "asana") {
    // "Asana task 1209" is what gets written down, since a task has no short
    // name of its own. The permalink carries the same number, and is the
    // fallback for a record written by some other version of this.
    const fromKey = /(\d{3,})\s*$/.exec(key);
    if (fromKey) return { provider: "asana", gid: fromKey[1] };
    const fromUrl = /(\d{3,})(?:\/f)?\/?$/.exec(String(external.url ?? "").trim());
    return fromUrl ? { provider: "asana", gid: fromUrl[1] } : null;
  }

  return null;
}

/**
 * The comments whose issue should be closed: resolved here, filed, and not
 * closed from here already.
 *
 * The other direction of the same idea. A comment resolved in the browser is
 * a statement that the work is done, and an issue still open for it is the
 * board being out of date -- so this is the list that fixes that, once per
 * comment ever, which is what `closedAt` is for.
 */
export function closableComments(comments: OverlayComment[]): OverlayComment[] {
  return comments
    .filter(
      (comment) =>
        comment.resolved &&
        comment.external &&
        !comment.external.closedAt &&
        issueRef(comment.external),
    )
    .slice()
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

/**
 * The deleted comments whose issue is still open, one entry per issue.
 *
 * A tombstone can arrive twice -- a save that did not land, a page that was
 * reopened -- and closing an issue twice is a request nobody needed, so the
 * key is what makes an entry unique rather than the comment id.
 */
export function withdrawnIssues(withdrawn: OverlayWithdrawn[] | undefined): OverlayWithdrawn[] {
  const out: OverlayWithdrawn[] = [];
  const seen = new Set<string>();
  for (const row of withdrawn ?? []) {
    if (!row || !row.external || row.external.closedAt) continue;
    if (!issueRef(row.external)) continue;
    const key = `${row.external.provider}:${row.external.key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/** The comments worth asking about: filed, still open, still identifiable. */
export function filedComments(comments: OverlayComment[]): OverlayComment[] {
  return comments
    .filter((comment) => !comment.resolved && comment.external && issueRef(comment.external))
    .slice()
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

/**
 * GitHub: closed is not the same as done.
 *
 * `state_reason` is the field that tells them apart, and it is why this is
 * not simply a boolean: an issue closed as "not planned" is a decision not
 * to do the work, and the comment that asked for it should stay up.
 */
export function githubState(issue: { state?: string; state_reason?: string | null }): IssueState {
  if (issue.state !== "closed") return "open";
  return issue.state_reason === "not_planned" ? "declined" : "done";
}

/**
 * Jira: the status category, qualified by the resolution.
 *
 * A category of "done" covers everything a board treats as finished, which
 * includes Won't Do and Duplicate. Those have no structured marker the way
 * GitHub's do -- the resolution is a name somebody typed when the project
 * was set up -- so the names that mean "not done" are matched by hand, and
 * anything unrecognised counts as done rather than being left in limbo.
 */
export function jiraState(fields: { category?: string; resolution?: string }): IssueState {
  if ((fields.category ?? "").toLowerCase() !== "done") return "open";
  const resolution = (fields.resolution ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
  return DECLINED_RESOLUTIONS.some((word) => resolution.includes(word)) ? "declined" : "done";
}

/** Resolutions that mean the work was not done. The common Jira defaults. */
const DECLINED_RESOLUTIONS = [
  "won t do",
  "won t fix",
  "wont do",
  "wont fix",
  "will not",
  "declined",
  "duplicate",
  "cannot reproduce",
  "can t reproduce",
  "incomplete",
  "abandoned",
  "rejected",
];

/**
 * Asana: completed, and nothing else.
 *
 * A task has no resolution and no reason, so there is no declined state to
 * find. Asana's own answer is the whole answer.
 */
export function asanaState(task: { completed?: boolean }): IssueState {
  return task.completed === true ? "done" : "open";
}

/** Everything one sync changed, as the document needs to record it. */
export interface SyncResults {
  /** Comments the tracker says are done. */
  resolved: Set<string>;
  /** Comments whose issue this closed, and when. */
  closed: Set<string>;
  /** ISO 8601, for the `closedAt` those get. */
  at: string;
  /** Tombstones whose issue has now been closed, by `provider:key`. */
  settled: Set<string>;
}

/**
 * Writes what a sync did into a review document, without disturbing the rest.
 *
 * The sibling of `applyExternals`, with the same reasoning: parsed and
 * re-serialized rather than edited as text, only the fields named here set,
 * and everything else handed back exactly as the browser wrote it --
 * including fields a later version of the overlay might add that this one
 * knows nothing about. One function rather than three because it is one
 * write: a document read, changed and written three times is three chances
 * for the browser to save over the middle of it.
 *
 * `resolved` only ever goes to true. A document is never un-resolved from
 * here, whatever a tracker says, because the person in the browser is
 * allowed to disagree with the board.
 */
export function applySync(raw: string, results: SyncResults): string | null {
  if (!results.resolved.size && !results.closed.size && !results.settled.size) {
    return raw;
  }

  let document: { comments?: unknown; withdrawn?: unknown };
  try {
    document = JSON.parse(raw) as { comments?: unknown; withdrawn?: unknown };
  } catch {
    return null;
  }
  if (!document || typeof document !== "object" || !Array.isArray(document.comments)) {
    return null;
  }

  for (const row of document.comments) {
    if (!row || typeof row !== "object") continue;
    const comment = row as {
      id?: unknown;
      resolved?: unknown;
      external?: { closedAt?: unknown } | null;
    };
    if (typeof comment.id !== "string") continue;
    if (results.resolved.has(comment.id)) comment.resolved = true;
    if (results.closed.has(comment.id) && comment.external) {
      comment.external.closedAt = results.at;
    }
  }

  // A tombstone whose issue is closed has done its job. The ones left are
  // the ones whose tracker could not be reached, and they are tried again.
  if (Array.isArray(document.withdrawn) && results.settled.size) {
    document.withdrawn = document.withdrawn.filter((row) => {
      if (!row || typeof row !== "object") return false;
      const entry = row as { external?: { provider?: unknown; key?: unknown } };
      const key = `${String(entry.external?.provider ?? "")}:${String(entry.external?.key ?? "")}`;
      return !results.settled.has(key);
    });
  }

  return JSON.stringify(document, null, 2);
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
