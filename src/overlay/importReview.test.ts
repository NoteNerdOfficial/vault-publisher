import { describe, expect, it } from "vitest";
import {
  ReviewImportError,
  flattenForList,
  groupByNote,
  noteName,
  parseExport,
  reviewNote,
  reviewNoteName,
  splitReviewInputs,
} from "./importReview";
import { OVERLAY_SCHEMA_VERSION, OverlayComment } from "./types";

const NOW = new Date("2026-10-28T09:00:00.000Z");

function comment(over: Partial<OverlayComment> = {}): OverlayComment {
  return {
    id: "c1",
    page: "notes/plan.html",
    sourcePath: "notes/Plan.md",
    block: "abc123",
    blockText: "The second paragraph.",
    route: null,
    view: null,
    x: 300,
    y: 230,
    rx: 0.5,
    ry: 0.5,
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

function exported(comments: OverlayComment[]): string {
  return JSON.stringify({
    version: 1,
    site: "Handbook",
    exportedAt: NOW.toISOString(),
    comments,
  });
}

describe("parseExport", () => {
  it("reads a well-formed export", () => {
    const data = parseExport(exported([comment()]));

    expect(data.site).toBe("Handbook");
    expect(data.comments).toHaveLength(1);
    expect(data.comments[0].text).toBe("Needs a citation.");
  });

  // A file written before the field existed, which is what a missing
  // version means. It reads, and comes back stamped with the shape this
  // build actually hands on.
  it("accepts a file with no version at all", () => {
    const data = parseExport(`{"comments":[]}`);

    expect(data.version).toBe(OVERLAY_SCHEMA_VERSION);
  });

  it("fills the optional fields rather than carrying undefined into a note", () => {
    const data = parseExport(
      `{"comments":[{"sourcePath":"a.md","text":"Fix."}]}`,
    );

    expect(data.comments[0].author).toBe("Anonymous");
    expect(data.comments[0].block).toBeNull();
    expect(data.comments[0].resolved).toBe(false);
    expect(data.comments[0].id).toBe("imported-0");
    expect(data.comments[0].replies).toEqual([]);
    expect(data.comments[0].rx).toBeNull();
  });

  it("keeps the point a pin was dropped on", () => {
    const data = parseExport(
      `{"version":2,"comments":[{"sourcePath":"a.md","text":"Fix.","x":300,"y":230,"rx":0.5,"ry":0.25}]}`,
    );

    expect(data.comments[0].x).toBe(300);
    expect(data.comments[0].rx).toBe(0.5);
    expect(data.comments[0].ry).toBe(0.25);
  });

  it("reads the replies on a comment", () => {
    const data = parseExport(
      `{"version":2,"comments":[{"sourcePath":"a.md","text":"Fix.","replies":[` +
        `{"id":"r1","author":"Sam","text":"Agreed.","createdAt":"2026-10-28T09:00:00Z"}]}]}`,
    );

    expect(data.comments[0].replies).toHaveLength(1);
    expect(data.comments[0].replies[0].text).toBe("Agreed.");
    expect(data.comments[0].replies[0].author).toBe("Sam");
  });

  // A comment with one unreadable follow-up is still worth importing, so a
  // bad reply is dropped where a bad comment is refused.
  it("drops a reply it cannot read rather than refusing the review", () => {
    const data = parseExport(
      `{"version":2,"comments":[{"sourcePath":"a.md","text":"Fix.","replies":[` +
        `"nope",{"text":"   "},{"text":"Kept."}]}]}`,
    );

    expect(data.comments[0].replies).toHaveLength(1);
    expect(data.comments[0].replies[0].text).toBe("Kept.");
  });

  it("reads a priority, and defaults one it does not recognise to medium", () => {
    const data = parseExport(
      `{"comments":[{"sourcePath":"a.md","text":"Fix.","priority":"high"},` +
        `{"sourcePath":"a.md","text":"Also.","priority":"urgent"},` +
        `{"sourcePath":"a.md","text":"And.","priority":"low"}]}`,
    );

    expect(data.comments.map((row) => row.priority)).toEqual([
      "high",
      "medium",
      "low",
    ]);
  });

  // The middle level was "normal" until schema 6, and a review file in a
  // vault outlives the build that wrote it. It is the same level under a
  // worse name, so it reads across rather than falling over.
  it("reads the priority that used to be called normal as medium", () => {
    const data = parseExport(
      `{"comments":[{"sourcePath":"a.md","text":"Fix.","priority":"normal"}]}`,
    );

    expect(data.comments[0].priority).toBe("medium");
  });

  // A comment a tool wrote into the review file. Nothing in the overlay sets
  // this, so reading it is the whole of the support for it.
  it("keeps the agent that filed a comment", () => {
    const data = parseExport(
      `{"comments":[{"sourcePath":"a.md","text":"Fix.","agent":"Claude Code"},` +
        `{"sourcePath":"a.md","text":"Also.","agent":""},` +
        `{"sourcePath":"a.md","text":"And.","agent":9}]}`,
    );

    expect(data.comments.map((row) => row.agent)).toEqual([
      "Claude Code",
      null,
      null,
    ]);
  });

  // The issue a comment was filed as. Written by the plugin, read back here,
  // and checked on the way in: this ends up as a link in a note somebody
  // clicks, and the file can be edited by hand.
  it("keeps the issue a comment was filed as", () => {
    const data = parseExport(
      `{"comments":[{"sourcePath":"a.md","text":"Fix.","external":` +
        `{"provider":"github","key":"o/r#41","url":"https://github.com/o/r/issues/41",` +
        `"filedAt":"2026-10-29T10:00:00.000Z"}}]}`,
    );

    expect(data.comments[0].external).toEqual({
      provider: "github",
      key: "o/r#41",
      url: "https://github.com/o/r/issues/41",
      filedAt: "2026-10-29T10:00:00.000Z",
    });
  });

  it("keeps which tracker the issue went to", () => {
    const data = parseExport(
      `{"comments":[` +
        `{"sourcePath":"a.md","text":"Fix.","external":{"provider":"jira","key":"ENG-14","url":"https://acme.atlassian.net/browse/ENG-14"}},` +
        `{"sourcePath":"a.md","text":"Fix.","external":{"provider":"asana","key":"Asana task 1","url":"https://app.asana.com/0/0/1"}},` +
        `{"sourcePath":"a.md","text":"Fix.","external":{"provider":"what","key":"k","url":"https://x/1"}}` +
        `]}`,
    );

    expect(data.comments.map((row) => row.external?.provider)).toEqual([
      "jira",
      "asana",
      // Not a tracker this knows. Read as the one it started with rather
      // than refused: the link still goes where it goes.
      "github",
    ]);
  });

  it.each([
    ["no key", `{"url":"https://x/1"}`],
    ["no address", `{"key":"o/r#1"}`],
    ["an address that is not a web address", `{"key":"o/r#1","url":"javascript:alert(1)"}`],
    ["nothing recognisable", `"o/r#1"`],
  ])("reads an issue record with %s as no issue at all", (_why, external) => {
    const data = parseExport(
      `{"comments":[{"sourcePath":"a.md","text":"Fix.","external":${external}}]}`,
    );

    expect(data.comments[0].external).toBeNull();
  });

  // Each of these is a file someone could plausibly be holding: a truncated
  // download, the wrong file entirely, an export from a later version. The
  // point is that none of them half-import.
  it.each([
    ["not JSON at all", "{ oh dear"],
    ["an array at the top level", "[]"],
    ["no comments array", `{"version":1}`],
    ["a newer schema", `{"version":99,"comments":[]}`],
    ["a comment with no note", `{"comments":[{"text":"Fix."}]}`],
    ["a comment with no text", `{"comments":[{"sourcePath":"a.md"}]}`],
    ["a comment that is blank", `{"comments":[{"sourcePath":"a.md","text":"  "}]}`],
    ["a comment that is not an object", `{"comments":["nope"]}`],
  ])("refuses %s", (_why, raw) => {
    expect(() => parseExport(raw)).toThrow(ReviewImportError);
  });

  it("says what was wrong, in a sentence worth showing someone", () => {
    expect(() => parseExport("{ oh dear")).toThrow(/not valid JSON/);
    expect(() => parseExport(`{"version":99,"comments":[]}`)).toThrow(
      /newer version/,
    );
  });
});

describe("noteName", () => {
  it("takes the basename a wikilink uses", () => {
    expect(noteName("notes/deep/Q3 planning.md")).toBe("Q3 planning");
    expect(noteName("Plan.md")).toBe("Plan");
  });

  it("leaves a name that has no extension alone", () => {
    expect(noteName("notes/Plan")).toBe("Plan");
  });
});

describe("groupByNote", () => {
  it("groups by note and orders each group by time", () => {
    const groups = groupByNote([
      comment({ id: "b", sourcePath: "b.md", createdAt: "2026-10-28T10:00:00Z" }),
      comment({ id: "a2", sourcePath: "a.md", createdAt: "2026-10-28T11:00:00Z" }),
      comment({ id: "a1", sourcePath: "a.md", createdAt: "2026-10-28T09:00:00Z" }),
    ]);

    expect(groups.map((g) => g.sourcePath)).toEqual(["a.md", "b.md"]);
    expect(groups[0].comments.map((c) => c.id)).toEqual(["a1", "a2"]);
  });

  it("returns nothing for nothing", () => {
    expect(groupByNote([])).toEqual([]);
  });
});

describe("flattenForList", () => {
  // A reviewer writing "- [ ] also this" means those characters. Left alone
  // they would become a nested task and the import would be misquoting them.
  it("escapes block syntax that would restructure the list", () => {
    expect(flattenForList("- [ ] also this")).toBe("\\- [ ] also this");
    expect(flattenForList("# not a heading")).toBe("\\# not a heading");
    expect(flattenForList("1. not a step")).toBe("\\1. not a step");
    expect(flattenForList("> not a quote")).toBe("\\> not a quote");
  });

  it("leaves ordinary prose alone", () => {
    expect(flattenForList("This is fine, mostly.")).toBe("This is fine, mostly.");
  });

  it("escapes every line, not just the first", () => {
    expect(flattenForList("Fine\n- not a bullet")).toBe("Fine\n\\- not a bullet");
  });
});

describe("reviewNote", () => {
  it("writes one section per note and one task per comment", () => {
    const note = reviewNote({
      site: "Handbook",
      now: NOW,
      comments: [
        comment({ id: "a", text: "Needs a citation." }),
        comment({
          id: "b",
          sourcePath: "notes/Onboarding.md",
          text: "Step 4 is out of date.",
        }),
      ],
    });

    expect(note).toContain("# Review 2026-10-28");
    expect(note).toContain("## [[Plan]]");
    expect(note).toContain("## [[Onboarding]]");
    expect(note).toContain("- [ ] Needs a citation.");
    expect(note).toContain("- [ ] Step 4 is out of date.");
    expect(note).toContain("2 comments on 2 notes, 2 still open, from Handbook.");
  });

  /*
   * A heading is a link somebody clicks to go and fix the thing. Obsidian
   * resolves a short link by finding the nearest file of that name, so four
   * applications published as they are would give four sections headed
   * `[[index.html]]`, three of which open the wrong one.
   */
  it("carries the folder in the link when the filename does not decide", () => {
    const note = reviewNote({
      site: "Handbook",
      now: NOW,
      comments: [
        comment({
          id: "a",
          sourcePath: "react-default/index.html",
          text: "Blank page.",
        }),
        comment({
          id: "b",
          sourcePath: "angular-default/index.html",
          text: "Also blank.",
        }),
      ],
    });

    expect(note).toContain("## [[react-default/index.html|react-default/index]]");
    expect(note).toContain("## [[angular-default/index.html|angular-default/index]]");
    expect(note).not.toContain("## [[index.html]]");
  });

  // One "index" is no clearer than four, so it is qualified too -- and the
  // link has to resolve, which for a note means the extension comes off and
  // for a page published as it was found means it stays on.
  it("qualifies a lone index, and links each kind the way it resolves", () => {
    const note = reviewNote({
      site: "Handbook",
      now: NOW,
      comments: [
        comment({ id: "a", sourcePath: "react-relative/index.html", text: "Good." }),
        comment({ id: "b", sourcePath: "library/Scope.md", text: "Tighten this." }),
      ],
    });

    expect(note).toContain("## [[react-relative/index.html|react-relative/index]]");
    // Unambiguous, so it stays the short link somebody would write by hand.
    expect(note).toContain("## [[Scope]]");
  });

  // The signifiers the Tasks plugin reads, so a priority set in the browser
  // is one the vault can sort by rather than a word in a sentence.
  it("marks a high or low priority with the signifier the vault reads", () => {
    const note = reviewNote({
      site: "",
      now: NOW,
      comments: [
        comment({ id: "a", text: "A blocker.", priority: "high" }),
        comment({ id: "b", text: "A question." }),
        comment({ id: "c", text: "A nit.", priority: "low" }),
      ],
    });

    expect(note).toContain("- [ ] \u23eb A blocker.");
    expect(note).toContain("- [ ] A question.");
    expect(note).toContain("- [ ] \ud83d\udd3d A nit.");
  });

  it("says when a comment came from a tool rather than a person", () => {
    const note = reviewNote({
      site: "",
      now: NOW,
      comments: [
        comment({ id: "a", author: "Claude", agent: "Claude Code" }),
        comment({ id: "b", author: "Reviewer", text: "Typed by hand." }),
      ],
    });

    expect(note).toContain("*Claude (via Claude Code), 2026-10-28*");
    expect(note).toContain("*Reviewer, 2026-10-28*");
  });

  it("nests the replies under the comment they answer", () => {
    const note = reviewNote({
      site: "",
      now: NOW,
      comments: [
        comment({
          text: "Needs a citation.",
          replies: [
            { id: "r1", author: "Sam", text: "Added one.", createdAt: "2026-10-28T08:30:00.000Z" },
          ],
        }),
      ],
    });

    expect(note).toContain("- [ ] Needs a citation.");
    expect(note).toContain("      - Added one. *Sam, 2026-10-28*");
  });

  it("escapes a reply that would have become Markdown of its own", () => {
    const note = reviewNote({
      site: "",
      now: NOW,
      comments: [
        comment({
          replies: [{ id: "r1", author: "Sam", text: "- not a bullet", createdAt: "" }],
        }),
      ],
    });

    expect(note).toContain("      - \\- not a bullet *Sam*");
  });

  it("ticks a resolved comment, so the list is what is left", () => {
    const note = reviewNote({
      site: "",
      now: NOW,
      comments: [
        comment({ id: "a", text: "Done already.", resolved: true }),
        comment({ id: "b", text: "Still open." }),
      ],
    });

    expect(note).toContain("- [x] Done already.");
    expect(note).toContain("- [ ] Still open.");
    expect(note).toContain("1 still open");
  });

  it("quotes the block, which is the only record of what an orphan meant", () => {
    const note = reviewNote({
      site: "",
      now: NOW,
      comments: [comment({ blockText: "Revenue by segment, Q3 only" })],
    });

    expect(note).toContain("> Revenue by segment, Q3 only");
  });

  it("says when a comment was about the page rather than a block", () => {
    const note = reviewNote({
      site: "",
      now: NOW,
      comments: [comment({ block: null, blockText: "" })],
    });

    expect(note).toContain("about the page");
  });

  it("indents a multi-line comment so it stays inside its task", () => {
    const note = reviewNote({
      site: "",
      now: NOW,
      comments: [comment({ text: "First line.\nSecond line." })],
    });

    expect(note).toContain("- [ ] First line.\n      Second line.");
  });

  it("carries frontmatter so the note is findable as a review", () => {
    const note = reviewNote({ site: "", now: NOW, comments: [comment()] });

    expect(note.startsWith("---\ncreated: 2026-10-28\n")).toBe(true);
    expect(note).toContain("  - review");
  });

  it("does not fall over on a comment with no timestamp", () => {
    const note = reviewNote({
      site: "",
      now: NOW,
      comments: [comment({ createdAt: "" })],
    });

    expect(note).toContain("*Reviewer*");
  });
});

describe("reviewNoteName", () => {
  it("names a note for the day it was imported", () => {
    expect(reviewNoteName(NOW, () => false)).toBe("Review 2026-10-28.md");
  });

  // Two reviews in one day is the normal case, not the odd one: you export,
  // import, fix some of it and go round again.
  it("does not overwrite an earlier import on the same day", () => {
    const taken = new Set(["Review 2026-10-28.md", "Review 2026-10-28 2.md"]);

    expect(reviewNoteName(NOW, (name) => taken.has(name))).toBe(
      "Review 2026-10-28 3.md",
    );
  });
});

describe("splitReviewInputs", () => {
  const FILES = [
    "r/comments.json",
    "r/comment-overlay.json",
    "r/comment-overlay (1).json",
    "r/Review 2026-10-28.md",
    "r/old.imported.json",
  ];

  it("picks out the live store the server writes to", () => {
    expect(splitReviewInputs(FILES, "comments.json").live).toEqual([
      "r/comments.json",
    ]);
  });

  it("treats hand-dropped exports as drops", () => {
    expect(splitReviewInputs(FILES, "comments.json").drops).toEqual([
      "r/comment-overlay.json",
      "r/comment-overlay (1).json",
    ]);
  });

  // The one that would hurt: renaming the live file mid-review orphans every
  // comment made so far and the next one starts a fresh, empty store.
  it("never puts the live store among the files to be renamed", () => {
    const { drops } = splitReviewInputs(FILES, "comments.json");

    expect(drops).not.toContain("r/comments.json");
  });

  it("ignores notes and files already imported", () => {
    const { live, drops } = splitReviewInputs(FILES, "comments.json");

    expect([...live, ...drops]).not.toContain("r/Review 2026-10-28.md");
    expect([...live, ...drops]).not.toContain("r/old.imported.json");
  });

  it("copes with a folder that has nothing in it", () => {
    expect(splitReviewInputs([], "comments.json")).toEqual({ live: [], drops: [] });
  });
});

describe("a comment that has been filed as an issue", () => {
  // Outside the italics, because it is a link, and a link nobody can tell
  // from the prose around it is a link nobody clicks.
  it("links to the issue from the task it became", () => {
    const note = reviewNote({
      site: "Handbook",
      now: NOW,
      comments: [
        comment({
          text: "Needs a citation.",
          external: {
            provider: "github",
            key: "owner/repo#41",
            url: "https://github.com/owner/repo/issues/41",
            filedAt: "2026-10-29T10:00:00.000Z",
          },
        }),
      ],
    });

    expect(note).toContain(
      "*Reviewer, 2026-10-28* [owner/repo#41](https://github.com/owner/repo/issues/41)",
    );
  });

  it("says nothing extra about a comment nobody filed", () => {
    const note = reviewNote({ site: "", now: NOW, comments: [comment()] });

    expect(note).toContain("      *Reviewer, 2026-10-28*\n");
    expect(note).not.toContain("](");
  });
});
