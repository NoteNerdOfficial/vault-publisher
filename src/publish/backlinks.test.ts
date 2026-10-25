import { describe, expect, it } from "vitest";
import { buildBacklinkIndex, excerptAround, relatedNotes } from "./backlinks";

describe("buildBacklinkIndex", () => {
  it("maps a page to the pages linking to it", () => {
    const index = buildBacklinkIndex([
      { url: "a.html", title: "A", links: [{ url: "c.html", context: "see C" }] },
      { url: "b.html", title: "B", links: [{ url: "c.html", context: "also C" }] },
    ]);

    expect(index.get("c.html")).toEqual([
      { url: "a.html", title: "A", excerpt: "see C" },
      { url: "b.html", title: "B", excerpt: "also C" },
    ]);
  });

  it("counts a page once however often it links to the same target", () => {
    const index = buildBacklinkIndex([
      {
        url: "a.html",
        title: "A",
        links: [
          { url: "c.html", context: "first" },
          { url: "c.html", context: "second" },
        ],
      },
    ]);
    expect(index.get("c.html")).toEqual([{ url: "a.html", title: "A", excerpt: "first" }]);
  });

  it("does not report a page as linking to itself", () => {
    const index = buildBacklinkIndex([
      { url: "a.html", title: "A", links: [{ url: "a.html", context: "self" }] },
    ]);
    expect(index.get("a.html")).toBeUndefined();
  });
});

describe("relatedNotes", () => {
  it("offers what this note links to, minus what is already a backlink", () => {
    const titles = new Map([
      ["b.html", "B"],
      ["c.html", "C"],
    ]);
    const related = relatedNotes(
      "a.html",
      {
        url: "a.html",
        title: "A",
        links: [
          { url: "b.html", context: "about B" },
          { url: "c.html", context: "about C" },
        ],
      },
      [{ url: "b.html", title: "B", excerpt: "B mentions A" }],
      titles,
    );
    expect(related).toEqual([{ url: "c.html", title: "C", excerpt: "about C" }]);
  });

  it("skips targets that are not published pages", () => {
    const related = relatedNotes(
      "a.html",
      { url: "a.html", title: "A", links: [{ url: "gone.html", context: "x" }] },
      [],
      new Map(),
    );
    expect(related).toEqual([]);
  });
});

describe("excerptAround", () => {
  it("centres the excerpt on the linked phrase", () => {
    const block =
      "The unit of reuse is the note, which is the argument made in atomic notes, " +
      "and it is the reason the folder scheme matters less than it looks.";
    const excerpt = excerptAround(block, "atomic notes", 60);
    expect(excerpt).toContain("atomic notes");
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("returns nothing when the block is only the link", () => {
    expect(excerptAround("Atomic notes", "Atomic notes")).toBe("");
  });

  it("keeps whole words only", () => {
    const block =
      "Folders describe where a note lives and links describe what it has to do with anything";
    const excerpt = excerptAround(block, "links", 40);
    const words = excerpt.replace(/…/g, " ").trim().split(/\s+/);
    for (const word of words) {
      expect(block.split(/\s+/)).toContain(word);
    }
  });
});
