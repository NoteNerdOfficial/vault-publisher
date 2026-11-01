import { describe, expect, it } from "vitest";
import type { App, TFile } from "obsidian";
import {
  SiteConfig,
  isScopeChosen,
  resolveHomeNote,
  selectNotes,
  urlForNote,
} from "./buildSite";

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
  // What the plugin itself writes into the vault.
  { path: "_vault-publisher/build-report.md" },
  { path: "_vault-publisher/review/notes-on-the-review.md" },
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
  /**
   * The whole vault means the vault's content, not the build's own output.
   * Publishing it whole otherwise put `_vault-publisher/build-report.md` on
   * the site as a page of the build that had just made it, along with the
   * publish log and every imported review.
   */
  it("takes the whole vault for an empty folder, minus the build's output", () => {
    const selected = selectNotes(stubApp(VAULT), config({ folder: "" }));
    expect(selected.map((f) => f.path)).toEqual([
      "inbox.md",
      "notes/nested/deep.md",
      "notes/public.md",
      "private/salary.md",
    ]);
  });

  it("takes the caller's output folders over the default", () => {
    const selected = selectNotes(
      stubApp([{ path: "out/report.md" }, { path: "notes/a.md" }]),
      config({ folder: "", outputFolders: ["out"] }),
    );
    expect(selected.map((f) => f.path)).toEqual(["notes/a.md"]);
  });

  // Somebody who points the scope at that folder has asked for it by name,
  // and a build that silently matched nothing would be worse.
  it("publishes an output folder when the scope is aimed at it", () => {
    const selected = selectNotes(
      stubApp(VAULT),
      config({ folder: "_vault-publisher" }),
    );
    expect(selected.map((f) => f.path)).toEqual([
      "_vault-publisher/build-report.md",
      "_vault-publisher/review/notes-on-the-review.md",
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

  it("keeps the output folders out even with a frontmatter flag set", () => {
    // The flag is not a way back in: a report that happened to carry the
    // flag in its frontmatter is still the build's own output.
    const selected = selectNotes(
      stubApp([
        { path: "_vault-publisher/build-report.md", frontmatter: { publish: true } },
        { path: "notes/a.md", frontmatter: { publish: true } },
      ]),
      config({ folder: "", requireFrontmatterFlag: "publish" }),
    );
    expect(selected.map((f) => f.path)).toEqual(["notes/a.md"]);
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

describe("resolveHomeNote", () => {
  const files = (...paths: string[]) => paths.map((path) => ({ path }));

  it("takes the vault's README when nothing is set", () => {
    const home = resolveHomeNote(files("README.md", "inbox.md"), { folder: "" });
    expect(home).toEqual({ path: "README.md", unresolved: null });
  });

  it("does not care how the README is capitalised", () => {
    expect(resolveHomeNote(files("readme.md"), { folder: "" }).path).toBe("readme.md");
  });

  it("prefers the README over index.md and Home.md", () => {
    const home = resolveHomeNote(files("Home.md", "index.md", "README.md"), { folder: "" });
    expect(home.path).toBe("README.md");
  });

  // A README three folders down is documentation for that folder.
  it("only looks at the top of what is published", () => {
    expect(resolveHomeNote(files("notes/README.md"), { folder: "" }).path).toBe(null);
  });

  it("reads the top as the top of the published folder, not the vault", () => {
    const home = resolveHomeNote(files("notes/README.md", "notes/deep/README.md"), {
      folder: "notes",
    });
    expect(home.path).toBe("notes/README.md");
  });

  it("takes the note the user named, over the README", () => {
    const home = resolveHomeNote(files("README.md", "welcome.md"), {
      folder: "",
      homeNote: "welcome.md",
    });
    expect(home).toEqual({ path: "welcome.md", unresolved: null });
  });

  it("accepts a name without the extension, and a path inside the folder", () => {
    expect(
      resolveHomeNote(files("notes/welcome.md"), { folder: "notes", homeNote: "welcome" }).path,
    ).toBe("notes/welcome.md");
    expect(
      resolveHomeNote(files("notes/welcome.md"), { folder: "notes", homeNote: "notes/welcome.md" })
        .path,
    ).toBe("notes/welcome.md");
  });

  // The typo that is otherwise silent: the build falls back to the README and
  // the user is left looking at a page they thought they had replaced.
  it("reports a homepage that is not being published, and falls back", () => {
    const home = resolveHomeNote(files("README.md"), { folder: "", homeNote: "welcome.md" });
    expect(home).toEqual({ path: "README.md", unresolved: "welcome.md" });
  });

  it("reports it with nothing to fall back to as well", () => {
    const home = resolveHomeNote(files("inbox.md"), { folder: "", homeNote: "welcome.md" });
    expect(home).toEqual({ path: null, unresolved: "welcome.md" });
  });

  it("leaves a vault with no front page to the generated overview", () => {
    expect(resolveHomeNote(files("inbox.md", "notes/a.md"), { folder: "" }).path).toBe(null);
  });
});
