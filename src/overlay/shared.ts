/**
 * Review comments shared through a public repository's GitHub issues.
 *
 * A published site has no server, so it cannot take a comment and keep it.
 * GitHub can, and a reader already has an account there. So with sharing on,
 * a comment left on the published site is posted as an issue on the site's
 * own repository -- through GitHub's own "new issue" form, prefilled by the
 * overlay and submitted by the reader, signed in as themselves -- and every
 * visitor's overlay reads the repository's issues back and draws them as
 * pins. No token, no sign-in flow, no server.
 *
 * What makes an issue a review comment, rather than any other issue on the
 * repository, is a marker at the end of its body: an HTML comment, which
 * GitHub does not render, carrying the anchor the overlay needs to put the
 * pin back -- which page, which block, which screen. Labels cannot do this
 * job: GitHub drops labels from a prefilled form unless the person
 * submitting it can triage the repository, which a reviewer usually cannot.
 *
 * The overlay writes the marker and reads it in the browser (see
 * `overlayScript.ts`); this file is the plugin's copy, which reads it when a
 * sync brings the site's comments into the vault. The two are held together
 * by a test that feeds an issue body written by the overlay to the reader
 * here.
 *
 * **Nothing from the vault goes in.** A published page's comments are keyed
 * on its URL, and the marker carries that and nothing else: the issue is on a
 * public repository, and a folder name in it would be published by the
 * reader's click.
 */

import type { OverlayComment, OverlayPriority } from "./types";

/** The name the marker is introduced by, in the issue body. */
export const SHARED_MARKER = "osp-review";

/** The version of the marker's own shape, separate from the review schema. */
export const SHARED_MARKER_VERSION = 1;

/**
 * What the marker carries: where the pin goes, and which comment it was in
 * the reader's browser before it was an issue -- which is how the overlay
 * knows the issue it has just read is the one it was waiting for.
 */
export interface SharedPin {
  v: number;
  /** The comment's id in the reader's browser. */
  id: string;
  /** The page's URL, relative to the site, as the published build keys it. */
  page: string;
  block?: string | null;
  blockText?: string;
  route?: string | null;
  view?: string | null;
  context?: string | null;
  frame?: string | null;
  froute?: string | null;
  fview?: string;
  rx?: number | null;
  ry?: number | null;
  cx?: number | null;
  cy?: number | null;
  fx?: number | null;
  fy?: number | null;
  x?: number;
  y?: number;
  priority?: OverlayPriority;
}

/**
 * What a published page is told about where its shared comments are, in its
 * overlay configuration.
 */
export interface SharedConfig {
  owner: string;
  repo: string;
  /** The REST API: https://api.github.com, or an Enterprise Server's. */
  api: string;
  /** Where people use GitHub: https://github.com, or the Server's address. */
  web: string;
  /** The owner's sign-in Worker, when there is one. */
  signin?: string;
  /** Readers must sign in to read the comments at all. */
  private?: boolean;
}

/**
 * The web address that goes with an API address: github.com for the public
 * API, and the server itself for an Enterprise Server's `/api/v3`.
 */
export function githubWebFor(apiBase: string): string {
  const api = apiBase.replace(/\/+$/, "");
  if (/^https:\/\/api\.github\.com$/i.test(api)) return "https://github.com";
  return api.replace(/\/api\/v3$/i, "");
}

/** A sign-in Worker's address, cleaned, or empty when it is not one. */
export function normalizeSigninUrl(value: string): string {
  const text = value.trim().replace(/\/+$/, "");
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString().replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

/** The part of a GitHub issue this reads, as the REST API returns it. */
export interface SharedIssue {
  number: number;
  title?: string;
  body?: string | null;
  state?: string;
  state_reason?: string | null;
  html_url?: string;
  created_at?: string;
  comments?: number;
  user?: { login?: string } | null;
  /** Set on a pull request, which the issues API also lists. */
  pull_request?: unknown;
}

const MARKER_PATTERN = new RegExp(`<!--\\s*${SHARED_MARKER}\\s+(\\{[\\s\\S]*?\\})\\s*-->`);

/** The marker in an issue body, or null when this is not a review issue. */
export function readSharedMarker(body: string | null | undefined): SharedPin | null {
  if (!body) return null;
  const match = MARKER_PATTERN.exec(body);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const pin = parsed as Record<string, unknown>;
  if (typeof pin.id !== "string" || !pin.id) return null;
  if (typeof pin.page !== "string" || !pin.page) return null;
  return pin as unknown as SharedPin;
}

/**
 * What the reader wrote, out of an issue body: everything above the line
 * the overlay puts before its own part. A reader who deleted that line has
 * deleted the marker too, so there is nothing to read.
 */
export function sharedText(body: string | null | undefined, fallback = ""): string {
  if (!body) return fallback;
  const cut = body.search(/(^|\n)-{3,}\s*\n/);
  const above = (cut === -1 ? body.replace(MARKER_PATTERN, "") : body.slice(0, cut)).trim();
  // The quote of the block the pin was on comes after the comment, as a
  // Markdown quote. It is in the marker already.
  const lines = above.split("\n");
  while (lines.length && /^\s*>/.test(lines[lines.length - 1])) lines.pop();
  const text = lines.join("\n").trim();
  return text || fallback;
}

/** The repository a shared comment's issue is in, as a key. */
export function sharedKey(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`;
}

/**
 * A review issue as a comment the vault can hold.
 *
 * `pages` maps a published URL to the note behind it, from the page map a
 * publish writes. A page it does not know keeps its URL, which still links to
 * the page and is what a published comment is keyed on anyway.
 *
 * Its id is the issue's rather than the browser's, because the issue is the
 * thing that exists: two readers' drafts that became one issue are one
 * comment, and a sync that runs twice finds the comment it made last time.
 */
export function commentFromIssue(
  issue: SharedIssue,
  owner: string,
  repo: string,
  pages: Record<string, string>,
): OverlayComment | null {
  if (issue.pull_request) return null;
  const pin = readSharedMarker(issue.body);
  if (!pin) return null;
  const key = sharedKey(owner, repo, issue.number);
  const closed = issue.state === "closed";

  return {
    id: `gh-${owner}-${repo}-${issue.number}`,
    page: pin.page,
    sourcePath: pages[pin.page] || pin.page,
    block: pin.block ?? null,
    blockText: typeof pin.blockText === "string" ? pin.blockText : "",
    route: pin.route ?? null,
    view: pin.view ?? null,
    context: pin.context ?? null,
    ...(pin.frame
      ? {
          frame: pin.frame,
          froute: pin.froute ?? null,
          ...(typeof pin.fview === "string" && pin.fview ? { fview: pin.fview } : {}),
          fx: pin.fx ?? null,
          fy: pin.fy ?? null,
        }
      : {}),
    x: typeof pin.x === "number" ? pin.x : 0,
    y: typeof pin.y === "number" ? pin.y : 0,
    rx: pin.rx ?? null,
    ry: pin.ry ?? null,
    cx: pin.cx ?? null,
    cy: pin.cy ?? null,
    author: issue.user?.login || "Anonymous",
    text: sharedText(issue.body, issue.title ?? ""),
    createdAt: issue.created_at ?? "",
    // Done is done; closed as not planned is not, for the same reason a
    // sync leaves such a comment open (see `githubState`).
    resolved: closed && issue.state_reason !== "not_planned",
    priority: pin.priority === "high" || pin.priority === "low" ? pin.priority : "medium",
    agent: null,
    imported: "github",
    external: {
      provider: "github",
      key,
      url: issue.html_url || `https://github.com/${owner}/${repo}/issues/${issue.number}`,
      filedAt: issue.created_at ?? "",
    },
    replies: [],
  };
}

/**
 * Adds the site's review issues to a review document the vault holds.
 *
 * Only the ones it does not have: a comment already carrying an issue's key
 * is that issue, whether it came in on an earlier sync or was filed from the
 * preview, and what happens to it from here -- resolved when the issue
 * closes -- is the existing sync's job. Parsed and re-serialized, like the
 * other writers of this file, so every other field is left as the browser
 * wrote it.
 *
 * Returns null when there is nothing to add, so the caller can skip a write.
 */
export function applyShared(raw: string, incoming: OverlayComment[]): string | null {
  let document: { comments?: unknown[] } & Record<string, unknown>;
  try {
    document = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!document || !Array.isArray(document.comments)) return null;

  const have = new Set<string>();
  for (const row of document.comments) {
    const comment = row as Partial<OverlayComment>;
    if (comment?.id) have.add(comment.id);
    if (comment?.external?.key) have.add(`key:${comment.external.key}`);
  }

  const added = incoming.filter(
    (comment) =>
      !have.has(comment.id) && !(comment.external && have.has(`key:${comment.external.key}`)),
  );
  if (!added.length) return null;

  document.comments = [...document.comments, ...added];
  return JSON.stringify(document, null, 2);
}
