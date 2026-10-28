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
import { OverlayComment } from "./types";

const NOW = new Date("2026-10-28T09:00:00.000Z");

function comment(over: Partial<OverlayComment> = {}): OverlayComment {
  return {
    id: "c1",
    page: "notes/plan.html",
    sourcePath: "notes/Plan.md",
    block: "abc123",
    blockText: "The second paragraph.",
    author: "Reviewer",
    text: "Needs a citation.",
    createdAt: "2026-10-28T08:00:00.000Z",
    resolved: false,
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

  it("treats a missing version as the first one", () => {
    const data = parseExport(`{"comments":[]}`);

    expect(data.version).toBe(1);
  });

  it("fills the optional fields rather than carrying undefined into a note", () => {
    const data = parseExport(
      `{"comments":[{"sourcePath":"a.md","text":"Fix."}]}`,
    );

    expect(data.comments[0].author).toBe("Anonymous");
    expect(data.comments[0].block).toBeNull();
    expect(data.comments[0].resolved).toBe(false);
    expect(data.comments[0].id).toBe("imported-0");
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
