import { describe, expect, it } from "vitest";
import type { App, TFile } from "obsidian";
import { SiteConfig, isScopeChosen, selectNotes, urlForNote } from "./buildSite";

/**
 * Enough of an App for selection, which reads two things: the list of
 * markdown files, and each one's frontmatter.
 */
function stubApp(files: { path: string; frontmatter?: Record<string, unknown> }[]): App {
  const cache = new Map(files.map((f) => [f.path, f.frontmatter]));
  return {
    vault: {
      getMarkdownFiles: () => files.map((f) => ({ path: f.path }) as TFile),
    },
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: cache.get(file.path) }),
    },
  } as unknown as App;
}

function config(over: Partial<SiteConfig> = {}): SiteConfig {
  return {
    siteName: "Notes",
    folder: null,
    requireFrontmatterFlag: null,
    ...over,
  };
}

const VAULT = [
  { path: "notes/public.md" },
  { path: "notes/nested/deep.md" },
  { path: "private/salary.md", frontmatter: { publish: true } },
  { path: "inbox.md" },
];

describe("isScopeChosen", () => {
  // The whole point of the three-way value: "not decided" has to be
  // distinguishable from "the whole vault", because the second one publishes
  // every private note in it.
  it("is false until something is chosen", () => {
    expect(isScopeChosen({ folder: null, requireFrontmatterFlag: null })).toBe(false);
  });

  it("counts the whole vault as a choice", () => {
    expect(isScopeChosen({ folder: "", requireFrontmatterFlag: null })).toBe(true);
  });

  it("counts a folder as a choice", () => {
    expect(isScopeChosen({ folder: "notes", requireFrontmatterFlag: null })).toBe(true);
  });

  it("counts a frontmatter flag alone as a choice", () => {
    expect(isScopeChosen({ folder: null, requireFrontmatterFlag: "publish" })).toBe(true);
  });
});

describe("selectNotes", () => {
  it("takes the whole vault for an empty folder", () => {
    const selected = selectNotes(stubApp(VAULT), config({ folder: "" }));
    expect(selected.map((f) => f.path)).toEqual([
      "inbox.md",
      "notes/nested/deep.md",
      "notes/public.md",
      "private/salary.md",
    ]);
  });

  it("takes only the named folder, nested notes included", () => {
    const selected = selectNotes(stubApp(VAULT), config({ folder: "notes" }));
    expect(selected.map((f) => f.path)).toEqual([
      "notes/nested/deep.md",
      "notes/public.md",
    ]);
  });

  // This is the empty build that would otherwise be committed as a complete
  // tree, replacing a live site with nothing. A typo in the folder is all it
  // takes to reach here.
  it("selects nothing for a folder that does not exist", () => {
    const selected = selectNotes(stubApp(VAULT), config({ folder: "notez" }));
    expect(selected).toEqual([]);
  });

  it("does not match a folder whose name is a prefix of another", () => {
    const selected = selectNotes(stubApp(VAULT), config({ folder: "note" }));
    expect(selected).toEqual([]);
  });

  it("applies the frontmatter flag across the whole vault", () => {
    const selected = selectNotes(
      stubApp(VAULT),
      config({ folder: "", requireFrontmatterFlag: "publish" }),
    );
    expect(selected.map((f) => f.path)).toEqual(["private/salary.md"]);
  });

  it("requires the flag to be true, not merely present", () => {
    const selected = selectNotes(
      stubApp([{ path: "a.md", frontmatter: { publish: "yes" } }]),
      config({ folder: "", requireFrontmatterFlag: "publish" }),
    );
    expect(selected).toEqual([]);
  });
});

describe("urlForNote", () => {
  it("strips the published folder from the url", () => {
    expect(urlForNote("notes/nested/deep.md", "notes")).toBe("nested/deep.html");
  });

  it("keeps the full path when publishing the whole vault", () => {
    expect(urlForNote("notes/deep.md", "")).toBe("notes/deep.html");
  });

  it("treats an unchosen scope like the whole vault", () => {
    expect(urlForNote("notes/deep.md", null)).toBe("notes/deep.html");
  });
});
