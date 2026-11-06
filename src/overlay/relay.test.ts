import { describe, expect, it } from "vitest";
import {
  DEFAULT_RELAY_LABELS,
  RelaySettings,
  applyExternals,
  applySync,
  closableComments,
  asanaState,
  filedComments,
  githubState,
  issueRef,
  jiraState,
  withdrawnIssues,
  externalFor,
  issueDraft,
  issueKey,
  issueTitle,
  jiraDescription,
  jiraSite,
  pendingComments,
  relayable,
  resolveTarget,
  splitLabels,
  toAdf,
  toMarkdown,
  toText,
  toWiki,
} from "./relay";
import { OverlayComment, OverlayExternalIssue } from "./types";

/**
 * Everything here is the part of filing an issue that has no network in it:
 * which comment is eligible, what the issue says, and what is written back
 * onto the comment afterwards. The HTTP is `GitHubClient`'s, and the
 * settings are the plugin's.
 */

function comment(over: Partial<OverlayComment> = {}): OverlayComment {
  return {
    id: "c1",
    page: "notes/plan.html",
    sourcePath: "notes/Plan.md",
    block: "abc123",
    route: null,
    view: null,
    context: null,
    blockText: "The second paragraph.",
    x: 0,
    y: 0,
    rx: null,
    ry: null,
    cx: null,
    cy: null,
    author: "Reviewer",
    text: "Needs a citation.",
    createdAt: "2026-10-28T08:00:00.000Z",
    resolved: false,
    priority: "medium",
    agent: null,
    imported: null,
    external: null,
    replies: [],
    ...over,
  };
}

const TARGET = {
  provider: "github" as const,
  owner: "owner",
  repo: "repo",
  labels: ["review"],
};

const JIRA = {
  provider: "jira" as const,
  site: "https://acme.atlassian.net",
  browseUrl: "",
  project: "ENG",
  issueType: "Task",
  auth: "cloud" as const,
  user: "someone@example.com",
  labels: ["review"],
};

const ASANA = {
  provider: "asana" as const,
  project: "1201234567890123",
  workspace: "",
};

/** The settings as the panel holds them, with one tracker filled in. */
function settings(over: Partial<RelaySettings> = {}): RelaySettings {
  return {
    provider: "none",
    labels: DEFAULT_RELAY_LABELS,
    github: { owner: "", repo: "" },
    jira: {
      site: "",
      browseUrl: "",
      project: "",
      issueType: "",
      auth: "cloud",
      email: "",
      username: "",
    },
    asana: { project: "", workspace: "" },
    ...over,
  };
}

/** Jira settings, so a test can change the one field it is about. */
function jiraSettings(over: Partial<RelaySettings["jira"]> = {}): RelaySettings {
  return settings({
    provider: "jira",
    jira: {
      site: "jira.example.com",
      browseUrl: "",
      project: "ENG",
      issueType: "",
      auth: "cloud",
      email: "",
      username: "",
      ...over,
    },
  });
}

/** The markdown body, which is the one every assertion here reads. */
function body(draft: { blocks: Parameters<typeof toMarkdown>[0] }): string {
  return toMarkdown(draft.blocks);
}

const FILED: OverlayExternalIssue = {
  provider: "github",
  key: "owner/repo#41",
  url: "https://github.com/owner/repo/issues/41",
  filedAt: "2026-10-29T10:00:00.000Z",
  // Filed, and not closed from here: the state every record starts in.
  closedAt: null,
};

describe("the repository to file in", () => {
  it("is nothing at all while the tracker is off", () => {
    expect(resolveTarget(settings(), { owner: "o", repo: "r" })).toBe(
      "No tracker is set up.",
    );
  });

  // The usual case: one repository, named once, under GitHub.
  it("falls back to the repository the site publishes to", () => {
    const target = resolveTarget(settings({ provider: "github" }), {
      owner: "pub",
      repo: "site",
    });

    expect(target).toEqual({
      provider: "github",
      owner: "pub",
      repo: "site",
      labels: ["review"],
    });
  });

  it("prefers a repository named for issues", () => {
    const target = resolveTarget(
      settings({ provider: "github", github: { owner: "team", repo: "work" }, labels: "" }),
      { owner: "pub", repo: "site" },
    );

    expect(target).toMatchObject({ owner: "team", repo: "work", labels: [] });
  });

  // Said rather than refused silently: a disabled button with no reason on it
  // is a setting nobody finds.
  it("says what is missing when there is no repository anywhere", () => {
    expect(
      resolveTarget(settings({ provider: "github" }), { owner: "", repo: "" }),
    ).toContain("Name the repository");
  });

  it("takes a Jira site however it was pasted in", () => {
    const target = resolveTarget(
      settings({
        provider: "jira",
        jira: {
          site: "acme.atlassian.net/jira/software/projects/ENG/",
          browseUrl: "",
          project: "eng",
          issueType: "",
          auth: "cloud",
          email: "someone@example.com",
          username: "",
        },
      }),
      { owner: "", repo: "" },
    );

    expect(target).toMatchObject({
      provider: "jira",
      site: "https://acme.atlassian.net",
      // Upper-cased, because that is how a key is written everywhere else.
      project: "ENG",
      // Every Jira project has this one; a blank field is not a choice.
      issueType: "Task",
    });
  });

  it("normalises a site on its own, and refuses what is not one", () => {
    expect(jiraSite(" https://acme.atlassian.net/ ")).toBe("https://acme.atlassian.net");
    expect(jiraSite("acme.atlassian.net")).toBe("https://acme.atlassian.net");
    expect(jiraSite("")).toBe("");
    expect(jiraSite("   ")).toBe("");
  });

  /**
   * The path, which means two opposite things depending on whose Jira it is.
   * On Cloud it is a deep link into a board and has to go; on a Jira a
   * company runs it is the install root, and dropping it sends every request
   * to the front page of a reverse proxy instead of to an API.
   */
  it("keeps the path a company serves its own Jira under", () => {
    expect(jiraSite("https://jira.example.com/jira")).toBe("https://jira.example.com/jira");
    expect(jiraSite("jira.example.com/jira/")).toBe("https://jira.example.com/jira");
    expect(jiraSite("https://jira.example.com/jira/browse/ENG-14")).toBe(
      "https://jira.example.com/jira",
    );
    // Jira's own first segments are the UI, not the root.
    expect(jiraSite("https://jira.example.com/browse/ENG-14")).toBe(
      "https://jira.example.com",
    );
    expect(jiraSite("https://jira.example.com/secure/Dashboard.jspa")).toBe(
      "https://jira.example.com",
    );
    // Cloud has no context path, so everything after the host is a deep link.
    expect(jiraSite("https://acme.atlassian.net/jira/software/projects/ENG")).toBe(
      "https://acme.atlassian.net",
    );
  });

  // Each of these is a field somebody has to fill in, and a sentence is the
  // only thing that tells them which.
  it.each([
    [
      "a Jira with no site",
      settings({
        provider: "jira",
        jira: {
          site: "",
          browseUrl: "",
          project: "ENG",
          issueType: "",
          auth: "cloud",
          email: "a@b.c",
          username: "",
        },
      }),
      "Jira site",
    ],
    [
      "a Jira with no project",
      settings({
        provider: "jira",
        jira: {
          site: "acme.atlassian.net",
          browseUrl: "",
          project: "",
          issueType: "",
          auth: "cloud",
          email: "a@b.c",
          username: "",
        },
      }),
      "project key",
    ],
    [
      "a Jira with no account",
      settings({
        provider: "jira",
        jira: {
          site: "acme.atlassian.net",
          browseUrl: "",
          project: "ENG",
          issueType: "",
          auth: "cloud",
          email: "",
          username: "",
        },
      }),
      "email address",
    ],
    ["an Asana with no project", settings({ provider: "asana" }), "Asana project"],
  ])("says what is missing for %s", (_why, given, said) => {
    const target = resolveTarget(given, { owner: "", repo: "" });

    expect(typeof target).toBe("string");
    expect(target).toContain(said);
  });

  // A personal access token is the whole credential, so asking for an email
  // next to it is asking for something that does not exist.
  it("asks for no account at all alongside a personal access token", () => {
    expect(resolveTarget(jiraSettings({ auth: "pat" }), { owner: "", repo: "" })).toEqual({
      provider: "jira",
      site: "https://jira.example.com",
      browseUrl: "",
      project: "ENG",
      issueType: "Task",
      auth: "pat",
      user: "",
      labels: ["review"],
    });
  });

  it("asks for a username where there is no Atlassian account", () => {
    expect(resolveTarget(jiraSettings({ auth: "basic" }), { owner: "", repo: "" })).toContain(
      "username",
    );
    expect(
      resolveTarget(jiraSettings({ auth: "basic", username: "someone" }), {
        owner: "",
        repo: "",
      }),
    ).toMatchObject({ auth: "basic", user: "someone" });
  });

  it("carries the browser address through, normalised like the site", () => {
    expect(
      resolveTarget(jiraSettings({ auth: "pat", browseUrl: "jira.example.com/jira/" }), {
        owner: "",
        repo: "",
      }),
    ).toMatchObject({ browseUrl: "https://jira.example.com/jira" });
  });

  it("takes an Asana project, and leaves the workspace optional", () => {
    expect(
      resolveTarget(
        settings({ provider: "asana", asana: { project: "1201", workspace: "" } }),
        { owner: "", repo: "" },
      ),
    ).toEqual({ provider: "asana", project: "1201", workspace: "" });
  });

  it("reads labels as a list, trimmed and without repeats", () => {
    expect(splitLabels(" review , triage,, review ")).toEqual(["review", "triage"]);
    expect(splitLabels("")).toEqual([]);
  });
});

describe("which comments are worth filing", () => {
  it("takes an open comment nobody has filed", () => {
    expect(relayable(comment())).toBe(true);
  });

  // The work it asked for has happened. An issue for it would arrive asking
  // for something that is already done.
  it("leaves a resolved comment alone", () => {
    expect(relayable(comment({ resolved: true }))).toBe(false);
  });

  // The whole reason the record is written onto the comment.
  it("leaves a comment that already has an issue alone", () => {
    expect(relayable(comment({ external: FILED }))).toBe(false);
  });

  it("orders a batch by when the comments were left", () => {
    const rows = [
      comment({ id: "late", createdAt: "2026-10-28T12:00:00.000Z" }),
      comment({ id: "done", resolved: true }),
      comment({ id: "early", createdAt: "2026-10-28T08:00:00.000Z" }),
      comment({ id: "filed", external: FILED }),
    ];

    expect(pendingComments(rows).map((row) => row.id)).toEqual(["early", "late"]);
  });
});

describe("the issue a comment becomes", () => {
  it("titles it with the comment's first line", () => {
    expect(issueTitle(comment({ text: "Needs a citation.\n\nSee the style guide." }))).toBe(
      "Needs a citation.",
    );
  });

  // Cut at a space, since the body repeats the whole thing anyway: a title
  // ending mid-word reads as a broken tool rather than a clipped sentence.
  it("clips a long first line at a word", () => {
    const long =
      "This paragraph makes a claim about performance that the benchmark " +
      "further down the page does not actually support at all";
    const title = issueTitle(comment({ text: long }));

    expect(title.length).toBeLessThanOrEqual(73);
    expect(title.endsWith("…")).toBe(true);
    expect(long.startsWith(title.slice(0, -1))).toBe(true);
    expect(title).not.toContain("  ");
  });

  it("names the note when the comment is only whitespace and a line break", () => {
    expect(issueTitle(comment({ text: "\n \n" }))).toBe("Review comment on Plan");
  });

  it("repeats the whole comment in the body, so nothing is lost to the title", () => {
    const draft = issueDraft(
      comment({ text: "Needs a citation.\n\nSee the style guide." }),
      TARGET,
      { site: "Handbook" },
    );

    expect(body(draft)).toContain("Needs a citation.\n\nSee the style guide.");
  });

  // Without this an issue says "this paragraph is wrong" about a paragraph
  // the reader cannot see.
  it("quotes the block the comment was left on", () => {
    expect(body(issueDraft(comment(), TARGET, { site: "Handbook" }))).toContain(
      "> The second paragraph.",
    );
  });

  it("carries the replies, since they are the argument about the comment", () => {
    const draft = issueDraft(
      comment({
        replies: [
          { id: "r1", author: "Sam", text: "Agreed.", createdAt: "" },
          { id: "r2", author: "", text: "Which one?", createdAt: "" },
        ],
      }),
      TARGET,
      { site: "Handbook" },
    );

    expect(body(draft)).toContain("**Replies**");
    expect(body(draft)).toContain("- **Sam**: Agreed.");
    expect(body(draft)).toContain("- **Anonymous**: Which one?");
  });

  it("says where the review happened and which note it was about", () => {
    const draft = issueDraft(comment(), TARGET, { site: "Handbook" });

    expect(body(draft)).toContain("From a review of Handbook");
    expect(body(draft)).toContain("- **Note**: `notes/Plan.md`");
    expect(body(draft)).toContain("- **Page**: `notes/plan.html`");
    expect(body(draft)).toContain("- Reviewer, 2026-10-28");
  });

  it("says when a comment was about the page rather than a block", () => {
    const draft = issueDraft(comment({ block: null, blockText: "" }), TARGET, {
      site: "Handbook",
    });

    expect(body(draft)).toContain("about the page as a whole");
    expect(body(draft)).not.toContain(">");
  });

  // A name alone does not say whether anyone read the page.
  it("says which tool filed a comment, when one did", () => {
    const draft = issueDraft(comment({ agent: "Claude Code" }), TARGET, { site: "" });

    expect(body(draft)).toContain("- Reviewer (via Claude Code), 2026-10-28");
    expect(body(draft)).toContain("From a review of the site");
  });

  it("labels it with the settings' labels", () => {
    expect(issueDraft(comment(), TARGET, { site: "" }).labels).toEqual(["review"]);
  });

  // Normal priority is what a comment left without a thought about it means,
  // so it must not arrive carrying a claim about one.
  it("adds a label for a priority, and only for a stated one", () => {
    expect(issueDraft(comment({ priority: "high" }), TARGET, { site: "" }).labels).toEqual([
      "review",
      "priority: high",
    ]);
    expect(issueDraft(comment({ priority: "low" }), TARGET, { site: "" }).labels).toEqual([
      "review",
      "priority: low",
    ]);
    expect(issueDraft(comment({ priority: "medium" }), TARGET, { site: "" }).labels).toEqual(
      ["review"],
    );
  });

  it("does not repeat a label the settings already name", () => {
    const target = { ...TARGET, labels: ["review", "priority: high"] };

    expect(issueDraft(comment({ priority: "high" }), target, { site: "" }).labels).toEqual([
      "review",
      "priority: high",
    ]);
  });
});

describe("the record written back onto the comment", () => {
  it("is how a person refers to the issue", () => {
    expect(issueKey("owner", "repo", 41)).toBe("owner/repo#41");

    const external = externalFor(
      "github",
      { key: "owner/repo#41", url: "https://github.com/owner/repo/issues/41" },
      new Date("2026-10-29T10:00:00.000Z"),
    );

    expect(external).toEqual(FILED);
  });

  // Each tracker names its own things, and the record says which one so the
  // panel can show a key that is short enough to read.
  it("keeps the tracker the issue went to", () => {
    const now = new Date("2026-10-29T10:00:00.000Z");

    expect(
      externalFor("jira", { key: "ENG-14", url: "https://acme.atlassian.net/browse/ENG-14" }, now),
    ).toMatchObject({ provider: "jira", key: "ENG-14" });
    expect(
      externalFor("asana", { key: "Asana task 1201", url: "https://app.asana.com/0/0/1201" }, now),
    ).toMatchObject({ provider: "asana", key: "Asana task 1201" });
  });

  it("goes onto the right comment and leaves the rest of the file alone", () => {
    const raw = JSON.stringify({
      version: 4,
      site: "Handbook",
      somethingNewer: true,
      comments: [
        { id: "a", text: "First.", anUnknownField: 1 },
        { id: "b", text: "Second." },
      ],
    });

    const next = applyExternals(raw, new Map([["b", FILED]]));
    const parsed = JSON.parse(next ?? "");

    expect(parsed.comments[0].external).toBeUndefined();
    expect(parsed.comments[0].anUnknownField).toBe(1);
    expect(parsed.comments[1].external).toEqual(FILED);
    expect(parsed.somethingNewer).toBe(true);
  });

  it("is a no-op when nothing was filed", () => {
    const raw = `{"comments":[]}`;

    expect(applyExternals(raw, new Map())).toBe(raw);
  });

  // The caller leaves a file it cannot read alone rather than replacing it.
  it.each([
    ["a file that is not JSON", "{ oh dear"],
    ["a document with no comments", `{"version":4}`],
  ])("refuses %s", (_why, raw) => {
    expect(applyExternals(raw, new Map([["a", FILED]]))).toBeNull();
  });
});

/**
 * One body, three trackers.
 *
 * The blocks exist because GitHub takes Markdown, Jira takes a JSON document
 * and Asana takes plain text, and one string sent to all three arrives in two
 * of them with its punctuation showing. These are the two renderers that are
 * not Markdown; the Markdown one is read by every test above.
 */
describe("the body each tracker is sent", () => {
  const withReply = comment({
    text: "Needs a citation.",
    replies: [{ id: "r1", author: "Sam", text: "Agreed.", createdAt: "" }],
  });

  it("gives Jira a document rather than a string", () => {
    const doc = toAdf(issueDraft(withReply, JIRA, { site: "Handbook" }).blocks) as {
      type: string;
      version: number;
      content: Array<Record<string, unknown>>;
    };

    expect(doc.type).toBe("doc");
    expect(doc.version).toBe(1);
    expect(doc.content.map((node) => node.type)).toEqual([
      "paragraph",
      "blockquote",
      "heading",
      "bulletList",
      "rule",
      "paragraph",
      "bulletList",
    ]);

    // The one thing Markdown would have smuggled in: a lead is a mark on a
    // text node, not a pair of asterisks somebody has to read past.
    const list = JSON.stringify(doc.content[3]);
    expect(list).toContain('"strong"');
    expect(list).toContain("Sam");
    expect(list).not.toContain("**");
  });

  /**
   * The same body again for the Jira a company runs itself, which answers on
   * v2 and has never heard of ADF: there the description is a string of wiki
   * markup, and a document posted to it is stored as the text of its own JSON.
   */
  it("gives a company's own Jira wiki markup rather than a document", () => {
    const wiki = toWiki(
      issueDraft(withReply, { ...JIRA, auth: "pat", user: "" }, { site: "Handbook" }).blocks,
    );

    expect(wiki).toContain("{quote}The second paragraph.{quote}");
    expect(wiki).toContain("h3. Replies");
    expect(wiki).toContain("* *Sam*: Agreed.");
    expect(wiki).toContain("{{notes/Plan.md}}");
    expect(wiki).toContain("----");
    // Markdown's emphasis would be read as something else there, and its
    // backticks as nothing at all.
    expect(wiki).not.toContain("**");
    expect(wiki).not.toContain("`");
  });

  // A reviewer writing about a code block would otherwise close the block
  // their comment is sitting in, and take the rest of the issue with it.
  it("stops a brace in a comment being read as markup", () => {
    expect(toWiki([{ kind: "text", text: "The {code} block, and a [link]." }])).toBe(
      "The \\{code} block, and a \\[link].",
    );
  });

  it("hands each Jira the one it can read", () => {
    const blocks = [{ kind: "text" as const, text: "Needs a citation." }];

    expect(jiraDescription(blocks, "cloud")).toMatchObject({ type: "doc", version: 1 });
    expect(jiraDescription(blocks, "pat")).toBe("Needs a citation.");
    expect(jiraDescription(blocks, "basic")).toBe("Needs a citation.");
  });

  it("marks a path as code for Jira, rather than wrapping it in backticks", () => {
    const doc = JSON.stringify(toAdf(issueDraft(comment(), JIRA, { site: "" }).blocks));

    expect(doc).toContain('"code"');
    expect(doc).toContain("notes/Plan.md");
    expect(doc).not.toContain("`");
  });

  // An empty text node is not valid ADF, and Jira refuses the whole document
  // over one.
  it("never gives Jira an empty text node", () => {
    const doc = JSON.stringify(toAdf([{ kind: "text", text: "" }]));

    expect(doc).toContain('"paragraph"');
    expect(doc).not.toContain('"text":""');
  });

  it("gives Asana plain text, with none of the punctuation Markdown needs", () => {
    const notes = toText(issueDraft(withReply, ASANA, { site: "Handbook" }).blocks);

    expect(notes).toContain("Needs a citation.");
    expect(notes).toContain('"The second paragraph."');
    expect(notes).toContain("Replies:");
    expect(notes).toContain("• Sam: Agreed.");
    expect(notes).not.toContain("**");
    expect(notes).not.toContain("---");
    expect(notes).not.toContain("`");
  });

  // Asana has no labels, so a priority has nowhere else to be true.
  it("writes the priority into an Asana task, and labels nothing", () => {
    const draft = issueDraft(comment({ priority: "high" }), ASANA, { site: "" });

    expect(draft.labels).toEqual([]);
    expect(toText(draft.blocks)).toContain("• Priority: High");
  });

  it("leaves it to the labels on a tracker that has them", () => {
    const draft = issueDraft(comment({ priority: "high" }), JIRA, { site: "" });

    expect(draft.labels).toEqual(["review", "priority: high"]);
    expect(toMarkdown(draft.blocks)).not.toContain("Priority");
  });
});

/**
 * Catching up on comments that were filed, which is the one thing that reads
 * back from a tracker. Everything here is the part with no network in it:
 * which comment to ask about, which issue to ask about, and what an answer
 * means once each tracker's own vocabulary is dropped.
 */
describe("the issue a filed comment refers to", () => {
  function externalFrom(over: Partial<OverlayExternalIssue>): OverlayExternalIssue {
    return { ...FILED, ...over };
  }

  it("reads a GitHub issue back out of its key", () => {
    expect(issueRef(FILED)).toEqual({
      provider: "github",
      owner: "owner",
      repo: "repo",
      number: 41,
    });
  });

  it("reads a Jira key, and a Jira key is already the whole reference", () => {
    expect(issueRef(externalFrom({ provider: "jira", key: "ENG-14" }))).toEqual({
      provider: "jira",
      key: "ENG-14",
    });
    // Written lower case by hand, perhaps, but a key is upper case to Jira.
    expect(issueRef(externalFrom({ provider: "jira", key: "eng-14" }))).toMatchObject({
      key: "ENG-14",
    });
  });

  it("reads the identifier out of what was written down for Asana", () => {
    expect(
      issueRef(externalFrom({ provider: "asana", key: "Asana task 1201234567890123" })),
    ).toEqual({ provider: "asana", gid: "1201234567890123" });
  });

  // A record written by some other version of this, with no number in the
  // key: the permalink carries the same identifier.
  it("falls back to the Asana link when the key has no number in it", () => {
    expect(
      issueRef(
        externalFrom({
          provider: "asana",
          key: "Asana task",
          url: "https://app.asana.com/0/1201/1209",
        }),
      ),
    ).toEqual({ provider: "asana", gid: "1209" });
  });

  // Nothing can be asked about a record this cannot read, and a wrong guess
  // would be a question about somebody else's issue.
  it("refuses a record it cannot read, rather than guessing", () => {
    expect(issueRef(externalFrom({ key: "" }))).toBeNull();
    expect(issueRef(externalFrom({ key: "issue 41" }))).toBeNull();
    expect(issueRef(externalFrom({ provider: "jira", key: "14" }))).toBeNull();
    expect(issueRef(externalFrom({ provider: "asana", key: "x", url: "x" }))).toBeNull();
  });

  it("asks about the filed comments that are still open, oldest first", () => {
    const rows = [
      comment({ id: "late", external: FILED, createdAt: "2026-10-28T09:00:00.000Z" }),
      comment({ id: "early", external: FILED, createdAt: "2026-10-28T08:00:00.000Z" }),
      // Nothing to ask: never filed, already resolved, or unreadable.
      comment({ id: "unfiled", external: null }),
      comment({ id: "done", external: FILED, resolved: true }),
      comment({ id: "unreadable", external: externalFrom({ key: "?" }) }),
    ];

    expect(filedComments(rows).map((row) => row.id)).toEqual(["early", "late"]);
  });
});

describe("what a tracker's answer means", () => {
  it("counts a closed GitHub issue as done, unless it was not planned", () => {
    expect(githubState({ state: "open", state_reason: null })).toBe("open");
    expect(githubState({ state: "closed", state_reason: "completed" })).toBe("done");
    expect(githubState({ state: "closed", state_reason: null })).toBe("done");
    // The work was decided against. The comment asking for it stays up.
    expect(githubState({ state: "closed", state_reason: "not_planned" })).toBe("declined");
  });

  it("reads Jira's status category, and qualifies it with the resolution", () => {
    expect(jiraState({ category: "indeterminate" })).toBe("open");
    expect(jiraState({ category: "new", resolution: "" })).toBe("open");
    expect(jiraState({ category: "done", resolution: "Done" })).toBe("done");
    expect(jiraState({ category: "done", resolution: "Fixed" })).toBe("done");
    expect(jiraState({ category: "done", resolution: "Won't Do" })).toBe("declined");
    expect(jiraState({ category: "done", resolution: "Duplicate" })).toBe("declined");
    expect(jiraState({ category: "done", resolution: "Cannot Reproduce" })).toBe("declined");
    // A resolution somebody at that company invented. Done rather than
    // limbo: the board treats the category as finished, and a name nobody
    // here has seen is not evidence of a refusal.
    expect(jiraState({ category: "done", resolution: "Shipped in 4.2" })).toBe("done");
  });

  it("takes Asana at its word, which is all it has to say", () => {
    expect(asanaState({ completed: true })).toBe("done");
    expect(asanaState({ completed: false })).toBe("open");
    expect(asanaState({})).toBe("open");
  });
});

/**
 * The other direction: comments resolved or deleted here, whose issue is
 * still open in the tracker.
 */
describe("the issues a review wants closed", () => {
  const filed = { ...FILED, closedAt: null };

  it("takes a comment resolved here whose issue was never closed", () => {
    const rows = [
      comment({ id: "resolve-me", resolved: true, external: filed }),
      // Already done from here: closing it again is a request nobody needed.
      comment({
        id: "already",
        resolved: true,
        external: { ...filed, closedAt: "2026-10-29T10:00:00.000Z" },
      }),
      // Still open here, so nothing to say about it yet.
      comment({ id: "open", resolved: false, external: filed }),
      // Never filed: there is no issue to close.
      comment({ id: "unfiled", resolved: true, external: null }),
    ];

    expect(closableComments(rows).map((row) => row.id)).toEqual(["resolve-me"]);
  });

  it("takes each withdrawn issue once, however many times it was handed over", () => {
    const at = "2026-10-29T11:00:00.000Z";
    const entries = withdrawnIssues([
      { id: "gone", external: filed, at },
      // The same issue again: a save that did not land, or a page reopened.
      { id: "gone", external: filed, at },
      { id: "other", external: { ...filed, key: "owner/repo#42" }, at },
      // Already closed from here.
      { id: "settled", external: { ...filed, key: "owner/repo#43", closedAt: at }, at },
      // A record nothing can be asked about.
      { id: "unreadable", external: { ...filed, key: "??" }, at },
    ]);

    expect(entries.map((row) => row.external.key)).toEqual([
      "owner/repo#41",
      "owner/repo#42",
    ]);
  });
});

describe("writing what a sync did into the review document", () => {
  const at = "2026-10-29T12:00:00.000Z";
  const filed = { provider: "github", key: "owner/repo#41", url: "u", filedAt: "f" };
  const document = JSON.stringify({
    site: "Handbook",
    comments: [
      { id: "a", text: "one", resolved: false },
      { id: "b", text: "two", resolved: false, note: "kept", external: { ...filed } },
    ],
    withdrawn: [
      { id: "gone", external: { ...filed, key: "owner/repo#42" }, at },
      { id: "stuck", external: { ...filed, key: "owner/repo#43" }, at },
    ],
  });

  const nothing = { resolved: new Set<string>(), closed: new Set<string>(), settled: new Set<string>(), at };

  it("resolves, records the close, and drops the tombstone it dealt with", () => {
    const next = applySync(document, {
      ...nothing,
      resolved: new Set(["a"]),
      closed: new Set(["b"]),
      settled: new Set(["github:owner/repo#42"]),
    });

    expect(JSON.parse(next as string)).toEqual({
      site: "Handbook",
      comments: [
        { id: "a", text: "one", resolved: true },
        // The field this version knows nothing about is still here.
        {
          id: "b",
          text: "two",
          resolved: false,
          note: "kept",
          external: { ...filed, closedAt: at },
        },
      ],
      // The one whose tracker could not be reached stays, and is tried again.
      withdrawn: [{ id: "stuck", external: { ...filed, key: "owner/repo#43" }, at }],
    });
  });

  it("hands the document back untouched when nothing happened", () => {
    expect(applySync(document, nothing)).toBe(document);
  });

  it("leaves a document it cannot read alone", () => {
    expect(applySync("not json", { ...nothing, resolved: new Set(["a"]) })).toBeNull();
    expect(
      applySync(JSON.stringify({ site: "x" }), { ...nothing, resolved: new Set(["a"]) }),
    ).toBeNull();
  });
});
