import { describe, expect, it } from "vitest";
import {
  DEFAULT_RELAY_LABELS,
  RelaySettings,
  applyExternals,
  externalFor,
  issueDraft,
  issueKey,
  issueTitle,
  jiraSite,
  pendingComments,
  relayable,
  resolveTarget,
  splitLabels,
  toAdf,
  toMarkdown,
  toText,
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
    blockText: "The second paragraph.",
    x: 0,
    y: 0,
    rx: null,
    ry: null,
    author: "Reviewer",
    text: "Needs a citation.",
    createdAt: "2026-10-28T08:00:00.000Z",
    resolved: false,
    priority: "normal",
    agent: null,
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
  project: "ENG",
  issueType: "Task",
  email: "someone@example.com",
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
    jira: { site: "", project: "", issueType: "", email: "" },
    asana: { project: "", workspace: "" },
    ...over,
  };
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
          project: "eng",
          issueType: "",
          email: "someone@example.com",
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

  // Each of these is a field somebody has to fill in, and a sentence is the
  // only thing that tells them which.
  it.each([
    [
      "a Jira with no site",
      settings({
        provider: "jira",
        jira: { site: "", project: "ENG", issueType: "", email: "a@b.c" },
      }),
      "Jira site",
    ],
    [
      "a Jira with no project",
      settings({
        provider: "jira",
        jira: { site: "acme.atlassian.net", project: "", issueType: "", email: "a@b.c" },
      }),
      "project key",
    ],
    [
      "a Jira with no account",
      settings({
        provider: "jira",
        jira: { site: "acme.atlassian.net", project: "ENG", issueType: "", email: "" },
      }),
      "email address",
    ],
    ["an Asana with no project", settings({ provider: "asana" }), "Asana project"],
  ])("says what is missing for %s", (_why, given, said) => {
    const target = resolveTarget(given, { owner: "", repo: "" });

    expect(typeof target).toBe("string");
    expect(target).toContain(said);
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
    expect(issueDraft(comment({ priority: "normal" }), TARGET, { site: "" }).labels).toEqual(
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
