/**
 * Filing a review comment as a Jira issue.
 *
 * One POST, to Jira Cloud's own REST API, with basic auth made from an email
 * address and an API token. No app, no OAuth dance, no Connect descriptor:
 * an API token is something a person makes in their Atlassian account in
 * under a minute, and it is the only kind of credential this can ask for
 * without becoming a product someone has to install.
 *
 * The description travels as ADF -- Atlassian's own JSON document format --
 * which is what the v3 API takes. That is why the issue body is built as
 * blocks upstream of here: a Markdown string sent to this endpoint arrives as
 * an issue with its asterisks showing.
 */

import { FiledIssue, TrackerError, trackerRequest } from "./request";

export interface JiraConfig {
  /** Site root, e.g. https://acme.atlassian.net */
  site: string;
  /** Project key, e.g. ENG */
  project: string;
  /** Issue type name, e.g. Task */
  issueType: string;
  /** The account the API token belongs to. */
  email: string;
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
    /** The description, already in ADF. */
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
      url: `${this.config.site}/rest/api/3/issue`,
      method: "POST",
      headers: { Authorization: `Basic ${basic(this.config.email, this.config.token)}` },
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
    return { key: created.key, url: `${this.config.site}/browse/${created.key}` };
  }
}

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

function basic(email: string, token: string): string {
  const pair = `${email}:${token}`;
  // btoa is byte-oriented, and an email address is ASCII; encodeURIComponent
  // and back is the standard way to stop a non-ASCII character throwing here.
  return btoa(unescape(encodeURIComponent(pair)));
}
