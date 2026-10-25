import { describe, expect, it } from "vitest";
import {
  NavNote,
  buildNavTree,
  calendarDaysBetween,
  collectTags,
  formatDay,
  recencyBuckets,
  relativeDay,
} from "./nav";

function note(url: string, title: string, updated: string | null = null): NavNote {
  const slash = url.lastIndexOf("/");
  return {
    url,
    title,
    folder: slash === -1 ? "" : url.slice(0, slash),
    updated,
    pinned: false,
  };
}

const TODAY = new Date("2026-10-25T12:00:00Z");

describe("buildNavTree", () => {
  it("groups notes into the folders their urls describe", () => {
    const tree = buildNavTree([
      note("home.html", "Home"),
      note("notes/atomic.html", "Atomic notes"),
      note("notes/evergreen.html", "Evergreen notes"),
      note("projects/site/design.html", "Design notes"),
    ]);

    expect(tree.map((node) => (node.kind === "folder" ? node.name : node.note.title))).toEqual([
      "notes",
      "projects",
      "Home",
    ]);

    const projects = tree.find((node) => node.kind === "folder" && node.name === "projects");
    expect(projects?.kind === "folder" && projects.children[0].kind).toBe("folder");
  });

  it("counts every note beneath a folder, not just its direct children", () => {
    const tree = buildNavTree([
      note("a/b/one.html", "One"),
      note("a/b/two.html", "Two"),
      note("a/three.html", "Three"),
    ]);
    const a = tree[0];
    expect(a.kind === "folder" && a.notes).toBe(3);
  });
});

describe("recencyBuckets", () => {
  it("collapses a run of notes sharing a timestamp into one row", () => {
    const batch = Array.from({ length: 12 }, (_, i) =>
      note(`archive/${i}.html`, `Note ${i}`, "2026-10-25T09:41"),
    );
    const buckets = recencyBuckets(
      [...batch, note("notes/one.html", "Written by hand", "2026-10-25T08:00")],
      TODAY,
    );

    expect(buckets).toHaveLength(1);
    expect(buckets[0].id).toBe("today");
    // The count is every note; the rows are the one edit plus the one note.
    expect(buckets[0].count).toBe(13);
    expect(buckets[0].rows).toHaveLength(2);
    expect(buckets[0].rows[0]).toMatchObject({ kind: "batch" });
    expect(buckets[0].rows[0].kind === "batch" && buckets[0].rows[0].notes).toHaveLength(12);
  });

  it("leaves a short run as individual notes", () => {
    const buckets = recencyBuckets(
      [
        note("a.html", "A", "2026-10-25T09:41"),
        note("b.html", "B", "2026-10-25T09:41"),
        note("c.html", "C", "2026-10-25T09:41"),
      ],
      TODAY,
    );
    expect(buckets[0].rows.every((row) => row.kind === "note")).toBe(true);
  });

  it("buckets by the calendar, not by elapsed hours", () => {
    // Saved at 22:10 last night. Thirteen hours ago, and yesterday's work.
    const buckets = recencyBuckets([note("a.html", "A", "2026-10-24T22:10")], TODAY);
    expect(buckets[0].id).toBe("week");
    expect(relativeDay("2026-10-24T22:10", TODAY)).toBe("yesterday");
  });

  it("drops anything outside the window and notes with no date", () => {
    const buckets = recencyBuckets(
      [
        note("old.html", "Old", "2025-01-01T09:00"),
        note("undated.html", "Undated", null),
        note("new.html", "New", "2026-10-25T09:00"),
      ],
      TODAY,
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0].count).toBe(1);
  });

  it("ignores a date in the future rather than inventing a bucket for it", () => {
    const buckets = recencyBuckets([note("a.html", "A", "2027-01-01T09:00")], TODAY);
    expect(buckets).toHaveLength(0);
  });
});

describe("calendarDaysBetween", () => {
  it("accepts a bare date as well as a stamp", () => {
    expect(calendarDaysBetween("2026-10-24", TODAY)).toBe(1);
    expect(calendarDaysBetween("2026-10-25T23:59", TODAY)).toBe(0);
  });
});

describe("collectTags", () => {
  it("counts each note once per tag, commonest first", () => {
    expect(
      collectTags([
        { url: "a.html", tags: ["method", "method", "writing"] },
        { url: "b.html", tags: ["method"] },
      ]),
    ).toEqual([
      { name: "method", count: 2 },
      { name: "writing", count: 1 },
    ]);
  });
});

describe("formatDay", () => {
  it("dates a note the way a reader reads provenance", () => {
    expect(formatDay("2026-10-24T18:40")).toBe("24 Oct 2026");
    expect(formatDay("2026-01-05")).toBe("5 Jan 2026");
  });

  it("says nothing about a date it cannot read", () => {
    expect(formatDay("sometime last year")).toBe("");
  });
});
