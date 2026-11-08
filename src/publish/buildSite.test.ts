import { describe, expect, it } from "vitest";
import type { App, TFile } from "obsidian";
import {
  SiteConfig,
  dependencyTally,
  isScopeChosen,
  navNoteFor,
  resolveHomeNote,
  selectNotes,
  urlForNote,
  overlayKey,
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
  // Hidden from Obsidian's own interface, indexed by it all the same.
  { path: ".trash/deleted.md" },
  { path: ".archive/old-note.md" },
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

  /**
   * Published by a vault published whole until now, and invisible in the app
   * that published it -- which is the worst combination for a leak.
   */
  it("leaves hidden folders out of the whole vault", () => {
    const selected = selectNotes(stubApp(VAULT), config({ folder: "" }));
    expect(selected.map((f) => f.path)).not.toContain(".trash/deleted.md");
    expect(selected.map((f) => f.path)).not.toContain(".archive/old-note.md");
  });

  it("publishes a hidden folder when the scope is aimed at it", () => {
    const selected = selectNotes(stubApp(VAULT), config({ folder: ".archive" }));
    expect(selected.map((f) => f.path)).toEqual([".archive/old-note.md"]);
  });

  /*
   * A prototype in the vault brings its dependencies with it, and every
   * package ships a README. This repository's own `node_modules` holds 753
   * Markdown files; each one used to go through Obsidian's renderer, the
   * link rewriter and the privacy scan, be assembled into a page, and then
   * appear as a row in the vault listing inlined into every other page.
   */
  it("leaves installed dependencies out of the whole vault", () => {
    const selected = selectNotes(
      stubApp([
        { path: "proto/notes.md" },
        { path: "proto/node_modules/left-pad/README.md" },
        { path: "proto/node_modules/vue/CHANGELOG.md" },
      ]),
      config({ folder: "" }),
    );
    expect(selected.map((f) => f.path)).toEqual(["proto/notes.md"]);
  });

  it("publishes a package's own notes when the scope is aimed at it", () => {
    const selected = selectNotes(
      stubApp([
        { path: "proto/notes.md" },
        { path: "proto/node_modules/left-pad/README.md" },
      ]),
      config({ folder: "proto/node_modules/left-pad" }),
    );
    expect(selected.map((f) => f.path)).toEqual([
      "proto/node_modules/left-pad/README.md",
    ]);
  });

  /*
   * The subtraction the scope cannot express. A vault that keeps everything
   * in one tree had two answers before this -- publish all of it including
   * the folders nobody should see, or ask every note to opt in -- and
   * neither describes "all of it except these three".
   */
  it("leaves out the folders the author excluded", () => {
    const selected = selectNotes(
      stubApp(VAULT),
      config({ folder: "", excludeFolders: ["private"] }),
    );
    expect(selected.map((f) => f.path)).toEqual([
      "inbox.md",
      "notes/nested/deep.md",
      "notes/public.md",
    ]);
  });

  it("excludes a subfolder of the scope as readily as a folder of the vault", () => {
    const selected = selectNotes(
      stubApp(VAULT),
      config({ folder: "notes", excludeFolders: ["notes/nested"] }),
    );
    expect(selected.map((f) => f.path)).toEqual(["notes/public.md"]);
  });

  // Both are paths somebody typed, and the more specific of the two is the
  // one that says "not this". The settings screen warns before it happens.
  it("beats the scope where the two contradict each other", () => {
    const selected = selectNotes(
      stubApp(VAULT),
      config({ folder: "notes", excludeFolders: ["notes"] }),
    );
    expect(selected).toEqual([]);
  });

  it("does not catch a folder that merely starts the same way", () => {
    const selected = selectNotes(
      stubApp([{ path: "notes/a.md" }, { path: "notebook/b.md" }]),
      config({ folder: "", excludeFolders: ["notes"] }),
    );
    expect(selected.map((f) => f.path)).toEqual(["notebook/b.md"]);
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

/*
 * The one thing that must never reach a published page: the vault's own
 * folder names. A preview keys comments on the note; a publish keys them
 * on the page's public URL.
 */
describe("overlayKey", () => {
  it("keys a preview on the note, so an import can find the writing", () => {
    expect(overlayKey({}, "notes/plan.html", "Clients/Acme/Q3 Plan.md")).toBe(
      "Clients/Acme/Q3 Plan.md",
    );
  });

  it("keys a publish on the page, so no vault path is published", () => {
    const key = overlayKey({ published: true }, "notes/plan.html", "Clients/Acme/Q3 Plan.md");
    expect(key).toBe("notes/plan.html");
    expect(key).not.toContain("Clients");
    expect(key).not.toContain(".md");
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

/*
 * What the report says about dependencies, which has to be said. Silence
 * would be wrong twice: somebody whose prototype's README is not on the site
 * needs to know it was a rule and not a failure, and somebody whose build
 * used to take twenty minutes needs to know what changed.
 */
describe("dependencyTally", () => {
  /** Enough of an App for the tally, which reads every file in the vault. */
  function filesApp(paths: string[]): App {
    return {
      vault: { getFiles: () => paths.map((path) => ({ path }) as TFile) },
    } as unknown as App;
  }

  it("counts the files and names the trees", () => {
    const tally = dependencyTally(
      filesApp([
        "proto/index.html",
        "proto/node_modules/a/README.md",
        "proto/node_modules/a/index.js",
        "proto/node_modules/b/README.md",
        "other/node_modules/c/README.md",
        "notes/plan.md",
      ]),
      config({ folder: "" }),
    );
    expect(tally.files).toBe(4);
    expect(tally.folders).toEqual(["other/node_modules", "proto/node_modules"]);
  });

  // One row per tree, not one per package that nests its own copy.
  it("names the outermost tree only", () => {
    const tally = dependencyTally(
      filesApp(["node_modules/a/node_modules/b/README.md"]),
      config({ folder: "" }),
    );
    expect(tally.folders).toEqual(["node_modules"]);
  });

  it("says nothing about a vault that has none", () => {
    const tally = dependencyTally(
      filesApp(["notes/plan.md", "notes/node modules.md"]),
      config({ folder: "" }),
    );
    expect(tally).toEqual({ folders: [], files: 0 });
  });

  // Outside the scope is outside the build, and reporting it would send
  // somebody looking for a slowdown that is not in their site.
  it("ignores dependencies outside the scope", () => {
    const tally = dependencyTally(
      filesApp(["other/node_modules/a/README.md", "site/page.md"]),
      config({ folder: "site" }),
    );
    expect(tally).toEqual({ folders: [], files: 0 });
  });
});

describe("the start-here key, read off a note", () => {
  const nav = (frontmatter: Record<string, unknown>, over: Partial<SiteConfig> = {}) => {
    const app = stubApp([{ path: "notes/a.md", frontmatter }]);
    const file = { path: "notes/a.md" } as TFile;
    return navNoteFor(app, file, "notes/a.html", "A note", config(over));
  };

  it("marks a note the author said true to", () => {
    const note = nav({ pinned: true });
    expect(note.pinned).toBe(true);
    expect(note.pinOrder).toBeUndefined();
  });

  it("carries the number through as the note's place", () => {
    expect(nav({ pinned: 2 })).toMatchObject({ pinned: true, pinOrder: 2 });
  });

  it("leaves a note alone when the key is absent or off", () => {
    expect(nav({}).pinned).toBe(false);
    expect(nav({ pinned: false }).pinned).toBe(false);
    expect(nav({ pinned: 0 }).pinned).toBe(false);
  });

  it("reads whichever key the author renamed it to", () => {
    // The setting renames the key; it has never had anything to do with
    // the order, and now the one key carries both facts.
    expect(nav({ start: 3 }, { pinnedProperty: "start" })).toMatchObject({
      pinned: true,
      pinOrder: 3,
    });
    expect(nav({ pinned: 3 }, { pinnedProperty: "start" }).pinned).toBe(false);
  });
});
