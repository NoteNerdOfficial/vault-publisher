import { describe, expect, it } from "vitest";
import {
  NavNote,
  buildNavTree,
  calendarDaysBetween,
  collectTags,
  formatDay,
  readPin,
  recencyBuckets,
  relativeDay,
  sortPinned,
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

describe("readPin", () => {
  it("takes true as a place in the list with nothing said about where", () => {
    expect(readPin(true)).toEqual({ pinned: true });
  });

  it("takes a positive number as the place itself", () => {
    expect(readPin(1)).toEqual({ pinned: true, pinOrder: 1 });
    expect(readPin(12)).toEqual({ pinned: true, pinOrder: 12 });
  });

  it("allows a fraction, so a note can be slipped in without renumbering", () => {
    expect(readPin(1.5)).toEqual({ pinned: true, pinOrder: 1.5 });
  });

  it("reads zero and below as off, not as the zeroth place", () => {
    // Somebody writing `pinned: 0` means "no", and the places a reader
    // counts in start at one.
    expect(readPin(0)).toEqual({ pinned: false });
    expect(readPin(-1)).toEqual({ pinned: false });
  });

  it("ignores anything that is neither true nor a number", () => {
    for (const value of [false, undefined, null, "", "1", "true", "yes", [], {}, NaN, Infinity]) {
      expect(readPin(value)).toEqual({ pinned: false });
    }
  });
});

describe("sortPinned", () => {
  const pin = (title: string, pinOrder?: number) => ({ title, pinOrder });

  it("puts the numbered ones in their numbers", () => {
    expect(
      sortPinned([pin("third", 3), pin("first", 1), pin("second", 2)]).map((n) => n.title),
    ).toEqual(["first", "second", "third"]);
  });

  it("lets a fraction land between two whole numbers", () => {
    expect(
      sortPinned([pin("b", 2), pin("a", 1), pin("between", 1.5)]).map((n) => n.title),
    ).toEqual(["a", "between", "b"]);
  });

  it("leads with what the author numbered, then what they only marked", () => {
    // A number says where the note goes; `true` does not, so it follows.
    expect(
      sortPinned([pin("aaa"), pin("ranked", 2), pin("zzz"), pin("leads", 1)]).map((n) => n.title),
    ).toEqual(["leads", "ranked", "aaa", "zzz"]);
  });

  it("falls back to the title, which is what the tree sorts by too", () => {
    // The order used to come from the vault path, so a folder decided it.
    // `sortLevel` above reads titles; these two no longer disagree.
    expect(sortPinned([pin("Beta"), pin("Alpha")]).map((n) => n.title)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("breaks a tie on the title rather than leaving it to chance", () => {
    expect(
      sortPinned([pin("Beta", 1), pin("Alpha", 1)]).map((n) => n.title),
    ).toEqual(["Alpha", "Beta"]);
  });

  it("leaves the caller's array alone", () => {
    const input = [pin("b", 2), pin("a", 1)];
    sortPinned(input);
    expect(input.map((n) => n.title)).toEqual(["b", "a"]);
  });

  it("is the order the old path sort got wrong", () => {
    // The case from the plugin's own guide vault: five pins whose vault
    // paths sorted the note called "Start here" last and the most advanced
    // topic first. Numbered, it reads the way it was meant to.
    const pins = [
      { title: "Publishing to GitHub Pages", pinOrder: 5 },
      { title: "The note header", pinOrder: 4 },
      { title: "Choosing what gets published", pinOrder: 2 },
      { title: "Install and first build", pinOrder: 3 },
      { title: "Start here", pinOrder: 1 },
    ];
    expect(sortPinned(pins).map((n) => n.title)).toEqual([
      "Start here",
      "Choosing what gets published",
      "Install and first build",
      "The note header",
      "Publishing to GitHub Pages",
    ]);
  });
});
