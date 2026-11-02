import { describe, expect, it } from "vitest";
import {
  PAGE_MAP_VERSION,
  buildPageMap,
  parsePageMap,
  resolveToNotes,
} from "./pageMap";

describe("buildPageMap", () => {
  it("records what a publish published", () => {
    const map = buildPageMap(
      [
        { url: "notes/plan.html", sourcePath: "Clients/Acme/Q3 Plan.md" },
        { url: "index.html", sourcePath: "Home.md" },
      ],
      new Date("2026-11-01T10:00:00.000Z"),
    );

    expect(map.version).toBe(PAGE_MAP_VERSION);
    expect(map.publishedAt).toBe("2026-11-01T10:00:00.000Z");
    expect(map.pages).toEqual({
      "notes/plan.html": "Clients/Acme/Q3 Plan.md",
      "index.html": "Home.md",
    });
  });

  // A generated index or a copied HTML file has no note behind it, and an
  // empty value would resolve a comment onto a link to nowhere.
  it("leaves out a page with no note behind it", () => {
    const map = buildPageMap(
      [
        { url: "browse.html", sourcePath: "" },
        { url: "notes/plan.html", sourcePath: "Plan.md" },
      ],
      new Date(),
    );

    expect(Object.keys(map.pages)).toEqual(["notes/plan.html"]);
  });
});

describe("parsePageMap", () => {
  it("reads one back", () => {
    const raw = JSON.stringify({ version: 1, pages: { "a.html": "A.md" } });
    expect(parsePageMap(raw)).toEqual({ "a.html": "A.md" });
  });

  /*
   * A vault that has never published with the overlay on has no file, which
   * is the normal case rather than a fault. The import carries on and links
   * what it can.
   */
  it("treats a missing or broken file as nothing to resolve with", () => {
    expect(parsePageMap(null)).toEqual({});
    expect(parsePageMap("")).toEqual({});
    expect(parsePageMap("not json")).toEqual({});
    expect(parsePageMap("[]")).toEqual({});
    expect(parsePageMap(JSON.stringify({ version: 1 }))).toEqual({});
    expect(parsePageMap(JSON.stringify({ pages: ["a"] }))).toEqual({});
  });

  it("drops an entry that does not name a note", () => {
    const raw = JSON.stringify({ pages: { "a.html": "", "b.html": 7, "c.html": "C.md" } });
    expect(parsePageMap(raw)).toEqual({ "c.html": "C.md" });
  });
});

describe("resolveToNotes", () => {
  const pages = { "notes/plan.html": "Clients/Acme/Q3 Plan.md" };

  it("puts the note back on a comment that came in naming a page", () => {
    const out = resolveToNotes([{ sourcePath: "notes/plan.html", id: "a" }], pages);
    expect(out[0].sourcePath).toBe("Clients/Acme/Q3 Plan.md");
  });

  // A comment made in a preview already names its note, and nothing in the
  // mapping should be able to move it.
  it("leaves a comment that already names a note alone", () => {
    const out = resolveToNotes([{ sourcePath: "Some/Other.md", id: "a" }], pages);
    expect(out[0].sourcePath).toBe("Some/Other.md");
  });

  it("leaves a page the mapping does not know about alone", () => {
    const out = resolveToNotes([{ sourcePath: "gone.html", id: "a" }], pages);
    expect(out[0].sourcePath).toBe("gone.html");
  });

  // The caller's copies are what gets written back to the review file, so a
  // resolve is for the note being written now and not a change to the record.
  it("does not edit the comments it was handed", () => {
    const original = { sourcePath: "notes/plan.html", id: "a" };
    resolveToNotes([original], pages);
    expect(original.sourcePath).toBe("notes/plan.html");
  });
});
