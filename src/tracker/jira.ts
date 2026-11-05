/**
 * Filing a review comment as a Jira issue.
 *
 * One POST to Jira's own REST API. No app, no OAuth dance, no Connect
 * descriptor: a token is something a person makes in their own account in
 * under a minute, and it is the only kind of credential this can ask for
 * without becoming a product someone has to install.
 *
 * Which Jira, though, is the whole difficulty. Cloud and the Jira a company
 * runs itself are two APIs wearing one name, and the setting that says which
 * decides three things at once:
 *
 * - **The credential.** Cloud has no personal access tokens: an API token is
 *   half a credential there and only works alongside the account's email, as
 *   basic auth. A Server or Data Center token is a bearer token on its own.
 *   A version too old for tokens leaves a username and a password, which some
 *   companies have also turned off -- hence three ways in rather than two.
 * - **The API version.** v3 is Cloud's. A company's own Jira answers on v2.
 * - **The description.** v3 takes ADF, Atlassian's JSON document format; v2
 *   takes a string of wiki markup. Which is why the issue body is built as
 *   blocks upstream of here and rendered per Jira, rather than being one
 *   Markdown string that would arrive with its asterisks showing.
 */

import type { JiraAuth } from "../overlay/relay";
import { FiledIssue, TrackerError, trackerRequest } from "./request";

export interface JiraConfig {
  /**
   * Where the API is, context path included: https://acme.atlassian.net, or
   * https://jira.acme.com/jira
   */
  site: string;
  /** Where a person opens the issue, if that is not where the API is. */
  browseUrl?: string;
  /** Project key, e.g. ENG */
  project: string;
  /** Issue type name, e.g. Task */
  issueType: string;
  auth: JiraAuth;
  /** The email on Cloud, the username with basic auth, nothing with a token. */
  user: string;
  token: string;
}

export class JiraClient {
  constructor(private readonly config: JiraConfig) {}

  /**
   * Creates one issue and returns it.
   *
   * A refusal about the request itself is retried once without labels, which
   * is the one field a project can be configured to refuse: Jira drops
   * `labels` from a create screen more often than anyone expects, and an
   * issue with no labels is worth a great deal more than no issue.
   */
  async createIssue(options: {
    summary: string;
    /** Already rendered: ADF on Cloud, a wiki markup string elsewhere. */
    description: unknown;
    labels?: string[];
  }): Promise<FiledIssue> {
    const labels = jiraLabels(options.labels ?? []);

    try {
      return await this.post(options.summary, options.description, labels);
    } catch (e) {
      if (!labels.length || !(e instanceof TrackerError) || e.status !== 400) throw e;
      return this.post(options.summary, options.description, []);
    }
  }

  private async post(
    summary: string,
    description: unknown,
    labels: string[],
  ): Promise<FiledIssue> {
    const created = await trackerRequest<{ key?: string }>({
      url: `${this.config.site}/rest/api/${this.config.auth === "cloud" ? 3 : 2}/issue`,
      method: "POST",
      // The cross-site header in `headers()` is why a POST works at all on
      // Server and Data Center: both refuse anything that changes data
      // unless the request says it is an API client rather than somebody's
      // browser being made to act for them. Cloud ignores it.
      headers: this.headers(),
      body: {
        fields: {
          project: { key: this.config.project },
          issuetype: { name: this.config.issueType },
          summary,
          description,
          ...(labels.length ? { labels } : {}),
        },
      },
    });

    if (!created.key) {
      throw new TrackerError("Jira created the issue but did not say which.", 0);
    }
    // The link is for a person, so it is built from the address they open Jira
    // at. Those are the same thing until a company puts the API behind a
    // gateway nobody browses to, which is the case this field exists for.
    const base = (this.config.browseUrl || this.config.site).replace(/\/+$/, "");
    return { key: created.key, url: `${base}/browse/${created.key}` };
  }

  /**
   * Closes one issue, by moving it through its own workflow.
   *
   * Jira has no "close this" call. A status is not a field to set: it is the
   * other end of a transition, the transitions are whatever the project's
   * workflow defines, and their names and ids differ per project -- so the
   * ones available are asked for first and one of them is chosen.
   *
   * `prefer` says which kind to look for when the workflow offers both: a
   * resolved comment wants the transition that means done, a deleted one
   * wants the transition that means it will not be done. Either is better
   * than the other where only one exists, and neither existing is reported
   * rather than guessed at -- a workflow can genuinely refuse to let this
   * account finish an issue.
   */
  async closeIssue(key: string, prefer: "done" | "declined"): Promise<void> {
    const available = await trackerRequest<{ transitions?: JiraTransition[] }>({
      url: this.issueUrl(key, "/transitions?expand=transitions.fields"),
      method: "GET",
      headers: this.headers(),
    });

    const transition = pickTransition(available.transitions ?? [], prefer);
    if (!transition) {
      throw new TrackerError(
        `${key} has no transition this account can use to close it.`,
        0,
      );
    }

    await trackerRequest({
      url: this.issueUrl(key, "/transitions"),
      method: "POST",
      headers: this.headers(),
      body: { transition: { id: transition.id } },
    });
  }

  /**
   * The status of one issue, as a category and a resolution.
   *
   * Only those two fields are asked for. An issue's whole representation is
   * a large document on a busy project, and nothing here reads any of the
   * rest of it.
   */
  async issueStatus(key: string): Promise<{ category: string; resolution: string }> {
    const issue = await trackerRequest<{
      fields?: {
        status?: { statusCategory?: { key?: string } };
        resolution?: { name?: string } | null;
      };
    }>({
      url: this.issueUrl(key, "?fields=status,resolution"),
      method: "GET",
      headers: this.headers(),
    });

    return {
      category: issue.fields?.status?.statusCategory?.key ?? "",
      resolution: issue.fields?.resolution?.name ?? "",
    };
  }

  /** One issue's URL, on whichever API version this Jira answers on. */
  private issueUrl(key: string, suffix: string): string {
    const version = this.config.auth === "cloud" ? 3 : 2;
    return `${this.config.site}/rest/api/${version}/issue/${encodeURIComponent(key)}${suffix}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: this.authorization(),
      "X-Atlassian-Token": "no-check",
    };
  }

  /**
   * The credential, in the one form this Jira accepts.
   *
   * A token sent the wrong way is a 401 with nothing in it to suggest that the
   * token is fine and the scheme is not, which is the failure this setting
   * exists to make impossible.
   */
  private authorization(): string {
    if (this.config.auth === "pat") return `Bearer ${this.config.token}`;
    return `Basic ${basic(this.config.user, this.config.token)}`;
  }
}

/** One way out of an issue's current status, as Jira describes it. */
export interface JiraTransition {
  id: string;
  name?: string;
  to?: { statusCategory?: { key?: string }; name?: string };
}

/**
 * The transition to use, or nothing if none of them will do.
 *
 * Only transitions into the `done` category are candidates: a workflow's
 * transitions include "Start progress" and "Reopen", and moving an issue
 * sideways would be worse than leaving it alone. Among those, the name is
 * all there is to tell "Done" from "Won't Do" -- Jira marks neither -- so a
 * preference for one kind is a name match, falling back to any transition
 * that finishes the issue.
 */
export function pickTransition(
  transitions: JiraTransition[],
  prefer: "done" | "declined",
): JiraTransition | null {
  const finishing = transitions.filter(
    (transition) =>
      transition &&
      typeof transition.id === "string" &&
      (transition.to?.statusCategory?.key ?? "").toLowerCase() === "done",
  );
  if (!finishing.length) return null;

  const declined = finishing.filter((transition) => isDeclining(transition));
  const done = finishing.filter((transition) => !isDeclining(transition));
  const wanted = prefer === "declined" ? [...declined, ...done] : [...done, ...declined];
  return wanted[0] ?? null;
}

function isDeclining(transition: JiraTransition): boolean {
  const words = `${transition.name ?? ""} ${transition.to?.name ?? ""}`
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
  return DECLINING.some((word) => words.includes(word));
}

/** Names that mean an issue is being finished without the work being done. */
const DECLINING = [
  "won t do",
  "won t fix",
  "wont do",
  "wont fix",
  "will not",
  "decline",
  "duplicate",
  "cannot reproduce",
  "can t reproduce",
  "abandon",
  "reject",
  "discard",
];

/**
 * Labels Jira will accept.
 *
 * A Jira label cannot contain a space -- the whole request is refused over
 * one -- so "priority: high" has to become something else before it is sent.
 * The colon goes with the space rather than being left stranded in front of a
 * hyphen, which is how "priority:-high" would otherwise reach a board.
 */
export function jiraLabels(labels: string[]): string[] {
  const out: string[] = [];
  for (const label of labels) {
    const clean = label
      .trim()
      .replace(/:\s*/g, "-")
      .replace(/\s+/g, "-");
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

function basic(user: string, secret: string): string {
  const pair = `${user}:${secret}`;
  // btoa is byte-oriented. An email address is ASCII, but a password need not
  // be, so the pair is encoded to UTF-8 bytes first. TextEncoder in place of
  // the old `unescape(encodeURIComponent(...))`, which did the same thing
  // through two deprecated functions.
  const bytes = new TextEncoder().encode(pair);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
