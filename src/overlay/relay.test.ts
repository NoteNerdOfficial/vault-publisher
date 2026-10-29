import { describe, expect, it } from "vitest";
import {
  DEFAULT_RELAY_LABELS,
  applyExternals,
  externalFor,
  issueFor,
  issueKey,
  issueTitle,
  pendingComments,
  relayable,
  resolveTarget,
  splitLabels,
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

const FILED: OverlayExternalIssue = {
  provider: "github",
  key: "owner/repo#41",
  url: "https://github.com/owner/repo/issues/41",
  filedAt: "2026-10-29T10:00:00.000Z",
};

describe("the repository to file in", () => {
  it("is nothing at all while the tracker is off", () => {
    expect(
      resolveTarget(
        { provider: "none", owner: "o", repo: "r", labels: "" },
        { owner: "o", repo: "r" },
      ),
    ).toBe("No tracker is set up.");
  });

  // The usual case: one repository, named once, under GitHub.
  it("falls back to the repository the site publishes to", () => {
    const target = resolveTarget(
      { provider: "github", owner: "", repo: "", labels: DEFAULT_RELAY_LABELS },
      { owner: "pub", repo: "site" },
    );

    expect(target).toEqual({
      provider: "github",
      owner: "pub",
      repo: "site",
      labels: ["review"],
    });
  });

  it("prefers a repository named for issues", () => {
    const target = resolveTarget(
      { provider: "github", owner: "team", repo: "work", labels: "" },
      { owner: "pub", repo: "site" },
    );

    expect(target).toMatchObject({ owner: "team", repo: "work", labels: [] });
  });

  // Said rather than refused silently: a disabled button with no reason on it
  // is a setting nobody finds.
  it("says what is missing when there is no repository anywhere", () => {
    expect(
      resolveTarget(
        { provider: "github", owner: "", repo: "", labels: "" },
        { owner: "", repo: "" },
      ),
    ).toContain("Name the repository");
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
    const draft = issueFor(
      comment({ text: "Needs a citation.\n\nSee the style guide." }),
      TARGET,
      { site: "Handbook" },
    );

    expect(draft.body).toContain("Needs a citation.\n\nSee the style guide.");
  });

  // Without this an issue says "this paragraph is wrong" about a paragraph
  // the reader cannot see.
  it("quotes the block the comment was left on", () => {
    expect(issueFor(comment(), TARGET, { site: "Handbook" }).body).toContain(
      "> The second paragraph.",
    );
  });

  it("carries the replies, since they are the argument about the comment", () => {
    const draft = issueFor(
      comment({
        replies: [
          { id: "r1", author: "Sam", text: "Agreed.", createdAt: "" },
          { id: "r2", author: "", text: "Which one?", createdAt: "" },
        ],
      }),
      TARGET,
      { site: "Handbook" },
    );

    expect(draft.body).toContain("**Replies**");
    expect(draft.body).toContain("- **Sam**: Agreed.");
    expect(draft.body).toContain("- **Anonymous**: Which one?");
  });

  it("says where the review happened and which note it was about", () => {
    const draft = issueFor(comment(), TARGET, { site: "Handbook" });

    expect(draft.body).toContain("From a review of Handbook");
    expect(draft.body).toContain("- Note: `notes/Plan.md`");
    expect(draft.body).toContain("- Page: `notes/plan.html`");
    expect(draft.body).toContain("- Reviewer, 2026-10-28");
  });

  it("says when a comment was about the page rather than a block", () => {
    const draft = issueFor(comment({ block: null, blockText: "" }), TARGET, {
      site: "Handbook",
    });

    expect(draft.body).toContain("about the page as a whole");
    expect(draft.body).not.toContain(">");
  });

  // A name alone does not say whether anyone read the page.
  it("says which tool filed a comment, when one did", () => {
    const draft = issueFor(comment({ agent: "Claude Code" }), TARGET, { site: "" });

    expect(draft.body).toContain("- Reviewer (via Claude Code), 2026-10-28");
    expect(draft.body).toContain("From a review of the site");
  });

  it("labels it with the settings' labels", () => {
    expect(issueFor(comment(), TARGET, { site: "" }).labels).toEqual(["review"]);
  });

  // Normal priority is what a comment left without a thought about it means,
  // so it must not arrive carrying a claim about one.
  it("adds a label for a priority, and only for a stated one", () => {
    expect(issueFor(comment({ priority: "high" }), TARGET, { site: "" }).labels).toEqual([
      "review",
      "priority: high",
    ]);
    expect(issueFor(comment({ priority: "low" }), TARGET, { site: "" }).labels).toEqual([
      "review",
      "priority: low",
    ]);
    expect(issueFor(comment({ priority: "normal" }), TARGET, { site: "" }).labels).toEqual(
      ["review"],
    );
  });

  it("does not repeat a label the settings already name", () => {
    const target = { ...TARGET, labels: ["review", "priority: high"] };

    expect(issueFor(comment({ priority: "high" }), target, { site: "" }).labels).toEqual([
      "review",
      "priority: high",
    ]);
  });
});

describe("the record written back onto the comment", () => {
  it("is how a person refers to the issue", () => {
    expect(issueKey("owner", "repo", 41)).toBe("owner/repo#41");

    const external = externalFor(
      TARGET,
      { number: 41, html_url: "https://github.com/owner/repo/issues/41" },
      new Date("2026-10-29T10:00:00.000Z"),
    );

    expect(external).toEqual(FILED);
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
