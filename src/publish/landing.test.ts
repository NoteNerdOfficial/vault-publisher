import { describe, expect, it } from "vitest";
import {
  LandingInput,
  LandingNote,
  browseContent,
  noteExcerpt,
  overviewContent,
  sitePaths,
  tagPageContent,
  tagSlug,
  tagUrls,
  tagsIndexContent,
} from "./landing";
import { recencyBuckets } from "./nav";
import { folderSlug } from "./shell";

const TODAY = new Date("2026-10-25T12:00:00Z");

function note(over: Partial<LandingNote> & { url: string; title: string }): LandingNote {
  const slash = over.url.lastIndexOf("/");
  return {
    folder: slash === -1 ? "" : over.url.slice(0, slash),
    updated: null,
    pinned: false,
    tags: [],
    excerpt: "",
    incoming: 0,
    ...over,
  };
}

const NOTES: LandingNote[] = [
  note({
    url: "index.html",
    title: "Reading this vault",
    pinned: true,
    updated: "2026-10-20T09:15",
    excerpt: "Where to start, and what the folders mean.",
  }),
  note({
    url: "notes/atomic.html",
    title: "Atomic notes in practice",
    updated: "2026-10-24T18:40",
    incoming: 7,
    tags: ["method", "writing"],
  }),
  note({
    url: "notes/decay.html",
    title: "Why notes decay",
    updated: "2026-10-22T08:30",
    incoming: 2,
    tags: ["method"],
  }),
  note({ url: "reference/glossary.html", title: "Glossary", updated: "2026-09-30T16:25" }),
];

const PATHS = sitePaths(NOTES.map((n) => n.url));
const COUNTED = [
  { name: "method", count: 2 },
  { name: "writing", count: 1 },
];
const TAG_URLS = tagUrls(COUNTED, PATHS);
const TAGS = COUNTED.map((tag) => ({ ...tag, url: TAG_URLS.get(tag.name) as string }));

function input(root = "./"): LandingInput {
  return {
    siteName: "Notes",
    notes: NOTES,
    tags: TAGS,
    recency: recencyBuckets(
      NOTES.map((n) => ({ url: n.url, title: n.title, folder: n.folder, updated: n.updated, pinned: n.pinned })),
      TODAY,
    ),
    paths: PATHS,
    today: TODAY,
    root,
  };
}

describe("sitePaths", () => {
  it("uses the obvious names when nothing is in the way", () => {
    expect(PATHS).toEqual({ browse: "browse.html", tags: "tags.html", tagPrefix: "tags" });
  });

  // The author named the note. Taking its address and publishing something
  // else there would overwrite it in the commit.
  it("gives way to a published note with the same name", () => {
    const paths = sitePaths(["browse.html", "tags.html"]);
    expect(paths.browse).toBe("all-notes.html");
    expect(paths.tags).toBe("all-tags.html");
  });

  it("gives way to a published folder called tags", () => {
    expect(sitePaths(["tags/zettelkasten.html"]).tagPrefix).toBe("tag");
  });

  it("compares names without regard to case, as a filesystem may", () => {
    expect(sitePaths(["Browse.html"]).browse).toBe("all-notes.html");
  });
});

describe("tagSlug", () => {
  it("flattens a nested tag", () => {
    expect(tagSlug("projects/active")).toBe("projects-active");
  });

  it("survives a tag made entirely of punctuation", () => {
    expect(tagSlug("???")).toBe("tag");
  });
});

describe("tagUrls", () => {
  it("gives every tag a page under the prefix", () => {
    expect(TAG_URLS.get("method")).toBe("tags/method.html");
  });

  // A flattened nested tag can land on a name another tag already has, and
  // two tags sharing a page would show each other's notes.
  it("separates two tags that slugify the same", () => {
    const urls = tagUrls([{ name: "projects/active", count: 1 }, { name: "projects-active", count: 1 }], PATHS);
    expect(new Set(urls.values()).size).toBe(2);
  });

  // Slugs are assigned alphabetically, not in display order, so a note
  // gaining a tag cannot renumber two colliding tags and move both pages.
  it("does not depend on how often a tag is used", () => {
    const byCount = tagUrls([{ name: "projects-active", count: 9 }, { name: "projects/active", count: 1 }], PATHS);
    const byName = tagUrls([{ name: "projects/active", count: 1 }, { name: "projects-active", count: 9 }], PATHS);
    expect(byCount.get("projects/active")).toBe(byName.get("projects/active"));
  });
});

describe("noteExcerpt", () => {
  it("reads the words out of the markup", () => {
    expect(noteExcerpt("<p>A note is <em>one</em> idea.</p>")).toBe("A note is one idea.");
  });

  it("leaves scripts and styles out of the prose", () => {
    expect(noteExcerpt("<style>p{color:red}</style><p>Prose.</p>")).toBe("Prose.");
  });

  it("decodes what the renderer escaped", () => {
    expect(noteExcerpt("<p>Notes &amp; links</p>")).toBe("Notes & links");
  });

  it("cuts at a word, not mid-word", () => {
    const excerpt = noteExcerpt(`<p>${"alpha ".repeat(60)}</p>`, 40);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).not.toMatch(/alph…$/);
  });
});

describe("the generated homepage", () => {
  const html = overviewContent(input());

  it("opens with what the vault is, not how big it is", () => {
    expect(html).toContain("4 notes · 2 tags · updated 24 Oct 2026");
  });

  it("leads with the notes the author marked", () => {
    expect(html).toContain('id="start"');
    expect(html).toContain("Reading this vault");
  });

  // The vault's own structure read back: the notes it keeps pointing at.
  it("shows what the vault links to most, with the count", () => {
    expect(html).toContain('id="linked"');
    expect(html).toContain("7 links in");
    expect(html).toContain("2 links in");
  });

  it("does not repeat a pinned note under most linked", () => {
    const linked = html.slice(html.indexOf('id="linked"'), html.indexOf('id="recent"'));
    expect(linked).not.toContain("Reading this vault");
  });

  it("shows what changed lately, in days rather than dates", () => {
    expect(html).toContain("yesterday");
  });

  it("sends the tags to their own pages", () => {
    expect(html).toContain('href="./tags/method.html"');
  });

  // Straight recency would fill the front page with one afternoon's find and
  // replace: forty rows, same minute, nothing a reader can use.
  it("counts a mass edit as the one edit it was", () => {
    const touched = Array.from({ length: 14 }, (_, i) =>
      note({ url: `archive/n${i}.html`, title: `Archived idea ${i}`, updated: "2026-10-25T09:41" }),
    );
    const notes = [...NOTES, ...touched];
    const html = overviewContent({
      ...input(),
      notes,
      recency: recencyBuckets(
        notes.map((n) => ({
          url: n.url,
          title: n.title,
          folder: n.folder,
          updated: n.updated,
          pinned: n.pinned,
        })),
        TODAY,
      ),
    });
    expect(html).toContain("14 notes changed together");
    expect(html).not.toContain("Archived idea 2");
    // And the row goes where all fourteen are listed.
    expect(html).toContain('href="./browse.html#recent"');
  });

  it("always offers the way to the full listing", () => {
    expect(html).toContain("./browse.html");
  });

  // The whole point of the change: on a vault of any size the front page is
  // a way in rather than the directory itself.
  it("stops at the newest few and hands the rest to the browse page", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      note({
        url: `notes/n${i}.html`,
        title: `Note ${i}`,
        updated: `2026-10-${String((i % 25) + 1).padStart(2, "0")}T09:00`,
      }),
    );
    const html = overviewContent({ ...input(), notes: many });
    expect(html).toContain("Browse all 30 notes");
    // Eight rows, not thirty.
    expect(html.match(/class="osp-home-item"/g)).toHaveLength(8);
  });
});

describe("the browse page", () => {
  const html = browseContent(input(), folderSlug);

  it("keeps the anchors the breadcrumb and the panel point at", () => {
    expect(html).toContain('id="folder-notes"');
    expect(html).toContain('id="recent"');
  });

  it("lists every note, which is what it is for", () => {
    for (const note of NOTES) expect(html).toContain(note.title);
  });
});

describe("a tag page", () => {
  const method = TAGS[0];
  const html = tagPageContent(method, input("../"));

  it("says how many notes carry the tag", () => {
    expect(html).toContain("2 notes tagged #method");
  });

  it("lists only those notes", () => {
    expect(html).toContain("Atomic notes in practice");
    expect(html).not.toContain("Glossary");
  });

  it("resolves its links from one folder down", () => {
    expect(html).toContain('href="../notes/atomic.html"');
  });

  it("offers the tags those notes also carry", () => {
    expect(html).toContain("Often alongside");
    expect(html).toContain("../tags/writing.html");
  });

  it("carries the way back to every tag", () => {
    expect(html).toContain("../tags.html");
  });
});

describe("the tags page", () => {
  it("lists every tag twice: by use, then by name", () => {
    const html = tagsIndexContent(input());
    expect(html).toContain("2 tags across 4 notes");
    expect(html).toContain("Most used");
    expect(html).toContain("A to Z");
  });

  it("says so plainly when a vault has no tags", () => {
    const html = tagsIndexContent({ ...input(), tags: [] });
    expect(html).toContain("No tags yet");
  });
});
