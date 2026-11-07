import { describe, expect, it } from "vitest";
import {
  WholeFolderContext,
  WholeFolderEntry,
  claimsSiteRoot,
  destination,
  entryFor,
  isInWholeFolder,
  parseWholeFolders,
  planWholeFolders,
  wholeFolderUrl,
} from "./wholeFolders";

/** An entry that keeps its vault path, which is what most of these are. */
function at(folder: string, where: string | null = null): WholeFolderEntry {
  return { folder, at: where };
}

/**
 * A built application in a vault, with the two files nothing references:
 * the lazily loaded chunk, and a JSON file the running app fetches.
 */
const DIST = [
  { path: "proto/dist/index.html", size: 500 },
  { path: "proto/dist/assets/index-abc.js", size: 140_000 },
  { path: "proto/dist/assets/index-abc.css", size: 20_000 },
  { path: "proto/dist/assets/Lazy-def.js", size: 400 },
  { path: "proto/dist/assets/inter.woff2", size: 30_000 },
  { path: "proto/dist/data/seed.json", size: 900 },
];

function context(over: Partial<WholeFolderContext> = {}): WholeFolderContext {
  return {
    entries: [at("proto/dist")],
    folder: null,
    excluded: [],
    outputFolders: ["_vault-publisher", "_site-preview"],
    maxBytes: 25 * 1024 * 1024,
    tooBigReason: (size, limit) => (size > limit ? `too big: ${size} > ${limit}` : null),
    claimedBy: () => null,
    ...over,
  };
}

describe("entryFor", () => {
  it("finds the entry a path sits under", () => {
    expect(entryFor("proto/dist/assets/a.js", [at("proto/dist")])?.folder).toBe("proto/dist");
    expect(entryFor("proto/dist", [at("proto/dist")])?.folder).toBe("proto/dist");
  });

  it("does not match a folder whose name merely starts the same way", () => {
    expect(entryFor("proto/dist-old/a.js", [at("proto/dist")])).toBe(null);
  });

  /**
   * The same case-insensitivity the exclude list has, for the same reason:
   * these are one folder on the filesystems most vaults sit on.
   */
  it("ignores case, and tidies the way an entry was typed", () => {
    expect(entryFor("Proto/Dist/a.js", [at("proto/dist")])?.folder).toBe("proto/dist");
    expect(entryFor("proto/dist/a.js", [at("/Proto/Dist/")])?.folder).toBe("/Proto/Dist/");
  });

  it("is null when nothing covers the path, and for an empty list", () => {
    expect(entryFor("notes/a.md", [at("proto/dist")])).toBe(null);
    expect(entryFor("proto/dist/a.js", [])).toBe(null);
    expect(isInWholeFolder("proto/dist/a.js", [])).toBe(false);
    expect(isInWholeFolder("proto/dist/a.js", [at("proto/dist")])).toBe(true);
  });
});

describe("parseWholeFolders", () => {
  it("reads the stored list of folders and destinations", () => {
    expect(parseWholeFolders([{ folder: "app/dist", at: "app" }])).toEqual([
      { folder: "app/dist", at: "app" },
    ]);
  });

  /**
   * Both older shapes still read, and both mean what they meant: a bare
   * path is a folder with no destination, which is what this setting did
   * before destinations existed.
   */
  it("still reads a plain list of paths, and the raw text of a field", () => {
    expect(parseWholeFolders(["app/dist", "docs/site"])).toEqual([
      { folder: "app/dist", at: null },
      { folder: "docs/site", at: null },
    ]);
    expect(parseWholeFolders(" app/dist \n\n/docs/site/\n")).toEqual([
      { folder: "app/dist", at: null },
      { folder: "docs/site", at: null },
    ]);
  });

  it("keeps the first of a repeated folder", () => {
    expect(
      parseWholeFolders([
        { folder: "app/dist", at: "app" },
        { folder: "APP/DIST", at: "other" },
      ]),
    ).toEqual([{ folder: "app/dist", at: "app" }]);
  });

  /**
   * A row with nothing in it yet is what the Add button stores, so parsing
   * it away would make that button look broken. Two of them stay two, or
   * they would collapse while somebody was typing into the second.
   */
  it("keeps a row with no path yet, and does not merge two of them", () => {
    expect(parseWholeFolders([{ folder: "" }, { folder: "" }])).toEqual([
      { folder: "", at: null },
      { folder: "", at: null },
    ]);
  });

  /** A blank line in the old text shape was never a row. */
  it("drops blank lines from the text shape", () => {
    expect(parseWholeFolders("app/dist\n\n\n")).toEqual([{ folder: "app/dist", at: null }]);
    expect(parseWholeFolders(["", "  "])).toEqual([]);
  });

  /** And a blank row is invisible to a build. */
  it("gives a blank row no tally and no say in what is published", () => {
    const plan = planWholeFolders(
      [{ path: "proto/dist/app.js", size: 10 }],
      {
        entries: [{ folder: "", at: null }],
        folder: null,
        excluded: [],
        outputFolders: [],
        maxBytes: 1_000,
        tooBigReason: () => null,
        claimedBy: () => null,
      },
    );
    expect(plan).toEqual({ carry: [], pages: [], skipped: [], tallies: [] });
  });

  it("reads nothing out of nothing", () => {
    expect(parseWholeFolders(undefined)).toEqual([]);
    expect(parseWholeFolders([])).toEqual([]);
    expect(parseWholeFolders(42)).toEqual([]);
  });

  /**
   * The bug the settings panel found: a stored `at: ""` is the root, and
   * reading it with the field's rule -- where empty means "not filled in"
   * -- turned every application published at the front page back into one
   * published at its vault path, on the next load and without a word.
   */
  it("reads a stored root destination back as the root", () => {
    expect(parseWholeFolders([{ folder: "app/dist", at: "" }])).toEqual([
      { folder: "app/dist", at: "" },
    ]);
    expect(parseWholeFolders([{ folder: "app/dist" }])).toEqual([
      { folder: "app/dist", at: null },
    ]);
  });

  it("refuses a stored destination that escapes the site", () => {
    expect(parseWholeFolders([{ folder: "app/dist", at: "../out" }])).toEqual([
      { folder: "app/dist", at: null },
    ]);
  });
});

describe("destination", () => {
  /**
   * The difference this has to keep: an empty field means "leave it where
   * its vault path puts it", and `/` means the front page. One of those
   * changes the homepage and the other does not.
   */
  it("tells an empty field from the root", () => {
    expect(destination("")).toBe(null);
    expect(destination("   ")).toBe(null);
    expect(destination("/")).toBe("");
    expect(destination("///")).toBe("");
  });

  it("tidies a path the way every other path here is tidied", () => {
    expect(destination(" /app/ ")).toBe("app");
    expect(destination("docs\\site")).toBe("docs/site");
  });

  /** A destination that climbs out of the site has nowhere to be. */
  it("refuses a destination that escapes the site", () => {
    expect(destination("../elsewhere")).toBe(null);
    expect(destination("app/../..")).toBe(null);
  });

  it("is null for anything that is not a string", () => {
    expect(destination(undefined)).toBe(null);
    expect(destination(7)).toBe(null);
  });
});

describe("wholeFolderUrl", () => {
  it("keeps the vault path when there is no destination", () => {
    expect(wholeFolderUrl("proto/dist/assets/a.js", at("proto/dist"), null)).toBe(
      "proto/dist/assets/a.js",
    );
    expect(wholeFolderUrl("proto/dist/assets/a.js", at("proto/dist"), "proto")).toBe(
      "dist/assets/a.js",
    );
  });

  it("puts the folder where the destination says", () => {
    expect(wholeFolderUrl("proto/dist/assets/a.js", at("proto/dist", "app"), null)).toBe(
      "app/assets/a.js",
    );
    expect(wholeFolderUrl("proto/dist/index.html", at("proto/dist", "app"), null)).toBe(
      "app/index.html",
    );
  });

  it("puts it at the front of the site for the root destination", () => {
    expect(wholeFolderUrl("proto/dist/index.html", at("proto/dist", ""), null)).toBe(
      "index.html",
    );
    expect(wholeFolderUrl("proto/dist/assets/a.js", at("proto/dist", ""), null)).toBe(
      "assets/a.js",
    );
  });

  /**
   * A destination is an address on the site, said outright. Making it
   * relative to the scope as well would move an application because a
   * setting two rows up changed.
   */
  it("ignores the scope once a destination is given", () => {
    expect(wholeFolderUrl("proto/dist/a.js", at("proto/dist", "app"), "proto")).toBe("app/a.js");
    expect(wholeFolderUrl("proto/dist/a.js", at("proto/dist", "app"), "proto/dist")).toBe(
      "app/a.js",
    );
  });

  it("matches a folder written in another case", () => {
    expect(wholeFolderUrl("proto/dist/a.js", at("/Proto/Dist/", "app"), null)).toBe("app/a.js");
  });
});

describe("claimsSiteRoot", () => {
  const files = [{ path: "proto/dist/index.html" }, { path: "proto/dist/app.js" }];

  it("is true when a folder published at the root has an index", () => {
    expect(claimsSiteRoot(files, [at("proto/dist", "")], null)).toBe(true);
  });

  it("is false for a destination that is not the root", () => {
    expect(claimsSiteRoot(files, [at("proto/dist", "app")], null)).toBe(false);
  });

  it("is false with no destination, whatever the scope makes the url", () => {
    expect(claimsSiteRoot(files, [at("proto/dist")], "proto/dist")).toBe(false);
  });

  it("is false when the folder has no index page at its root", () => {
    expect(claimsSiteRoot([{ path: "proto/dist/app.js" }], [at("proto/dist", "")], null)).toBe(
      false,
    );
  });
});

describe("planWholeFolders", () => {
  /** The whole point: a file nothing references is published anyway. */
  it("publishes every file in the folder, referenced or not", () => {
    const plan = planWholeFolders(DIST, context());
    expect(plan.pages).toEqual(["proto/dist/index.html"]);
    expect(plan.carry.map((file) => file.url)).toEqual([
      "proto/dist/assets/index-abc.js",
      "proto/dist/assets/index-abc.css",
      "proto/dist/assets/Lazy-def.js",
      "proto/dist/assets/inter.woff2",
      "proto/dist/data/seed.json",
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("mirrors paths against the scope, as every other published file does", () => {
    const plan = planWholeFolders(DIST, context({ folder: "proto/dist" }));
    expect(plan.carry.map((file) => file.url)).toContain("assets/Lazy-def.js");
    expect(plan.pages).toEqual(["proto/dist/index.html"]);
  });

  it("counts what each entry published, and the bytes", () => {
    const plan = planWholeFolders(DIST, context());
    expect(plan.tallies).toEqual([
      { entry: "proto/dist", at: null, count: 6, bytes: 191_800, hasIndex: true },
    ]);
  });

  /** A path that matched nothing is a typo, and reads as one in the report. */
  it("reports an entry that matched nothing as a zero rather than silence", () => {
    const plan = planWholeFolders(DIST, context({ entries: [at("proto/disp")] }));
    expect(plan.tallies).toEqual([{ entry: "proto/disp", at: null, count: 0, bytes: 0, hasIndex: false }]);
    expect(plan.carry).toEqual([]);
  });

  it("leaves a file outside the named folders alone", () => {
    const plan = planWholeFolders(
      [...DIST, { path: "Journal/private.png", size: 10 }],
      context(),
    );
    expect(plan.carry.map((file) => file.sourcePath)).not.toContain("Journal/private.png");
    expect(plan.skipped).toEqual([]);
  });

  describe("with a destination", () => {
    it("publishes the folder where the destination says", () => {
      const plan = planWholeFolders(DIST, context({ entries: [at("proto/dist", "app")] }));
      expect(plan.pages).toEqual(["proto/dist/index.html"]);
      expect(plan.carry.map((file) => file.url)).toEqual([
        "app/assets/index-abc.js",
        "app/assets/index-abc.css",
        "app/assets/Lazy-def.js",
        "app/assets/inter.woff2",
        "app/data/seed.json",
      ]);
    });

    it("puts it at the front of the site for the root", () => {
      const plan = planWholeFolders(DIST, context({ entries: [at("proto/dist", "")] }));
      expect(plan.carry.map((file) => file.url)).toContain("assets/Lazy-def.js");
    });

    it("records where each folder went, for the report", () => {
      const plan = planWholeFolders(DIST, context({ entries: [at("proto/dist", "app")] }));
      expect(plan.tallies).toEqual([
        { entry: "proto/dist", at: "app", count: 6, bytes: 191_800, hasIndex: true },
      ]);
    });

    /**
     * Two folders at one address has no sensible reading. The first keeps
     * it, because refusing both would turn one typo into two missing
     * applications.
     */
    it("refuses the second of two folders published at the same place", () => {
      const plan = planWholeFolders(
        [
          { path: "a/dist/index.html", size: 10 },
          { path: "b/dist/index.html", size: 10 },
        ],
        context({ entries: [at("a/dist", "app"), at("b/dist", "app")] }),
      );
      expect(plan.pages).toEqual(["a/dist/index.html"]);
      expect(plan.skipped[0]?.path).toBe("b/dist");
      expect(plan.skipped[0]?.reason).toContain("two folders cannot be the same place");
      expect(plan.tallies[1]).toEqual({ entry: "b/dist", at: "app", count: 0, bytes: 0, hasIndex: false });
    });

    it("lets two folders keep their vault paths without calling it a clash", () => {
      const plan = planWholeFolders(
        [
          { path: "a/dist/index.html", size: 10 },
          { path: "b/dist/index.html", size: 10 },
        ],
        context({ entries: [at("a/dist"), at("b/dist")] }),
      );
      expect(plan.pages).toEqual(["a/dist/index.html", "b/dist/index.html"]);
      expect(plan.skipped).toEqual([]);
    });

    /**
     * A destination says where a folder lands, not whether it is allowed
     * out -- otherwise naming one would quietly widen the scope.
     */
    it("still refuses a folder outside the scope, and says why differently", () => {
      const plan = planWholeFolders(
        [{ path: "elsewhere/app/main.js", size: 10 }],
        context({ entries: [at("elsewhere/app", "app")], folder: "site" }),
      );
      expect(plan.carry).toEqual([]);
      expect(plan.skipped[0]?.reason).toContain("widen the scope");
    });

    it("refuses a destination that lands on a note's page", () => {
      const plan = planWholeFolders(
        [{ path: "proto/dist/index.html", size: 10 }],
        context({
          entries: [at("proto/dist", "")],
          claimedBy: (url) => (url === "index.html" ? "notes/Home.md" : null),
        }),
      );
      expect(plan.pages).toEqual([]);
      expect(plan.skipped[0]?.reason).toContain("already published from notes/Home.md");
    });
  });

  describe("what it still refuses", () => {
    /**
     * The exclude list is the setting that keeps things out, and this is a
     * setting that puts things in. A mode able to override it would make a
     * privacy setting conditional on another setting.
     */
    it("obeys an excluded folder inside it", () => {
      const plan = planWholeFolders(
        [...DIST, { path: "proto/dist/private/keys.txt", size: 10 }],
        context({ excluded: ["proto/dist/private"] }),
      );
      expect(plan.carry.map((file) => file.sourcePath)).not.toContain(
        "proto/dist/private/keys.txt",
      );
      expect(plan.skipped[0]?.reason).toContain("excluded folder");
    });

    it("skips a hidden file sitting beside the build", () => {
      const plan = planWholeFolders(
        [...DIST, { path: "proto/dist/.env", size: 40 }],
        context(),
      );
      expect(plan.carry.map((file) => file.sourcePath)).not.toContain("proto/dist/.env");
      expect(plan.skipped[0]?.reason).toContain("hidden folder");
    });

    /**
     * The case this matters most for: an entry naming a project root rather
     * than its build output would otherwise publish the dependency tree
     * deliberately, which is worse than doing it by accident.
     */
    it("skips installed dependencies, even named deliberately", () => {
      const plan = planWholeFolders(
        [
          { path: "proto/index.html", size: 10 },
          { path: "proto/node_modules/react/index.js", size: 10 },
          { path: "proto/node_modules/react/README.md", size: 10 },
        ],
        context({ entries: [at("proto")] }),
      );
      expect(plan.pages).toEqual(["proto/index.html"]);
      expect(plan.carry).toEqual([]);
      expect(plan.skipped.map((skip) => skip.path)).toContain(
        "proto/node_modules/react/index.js",
      );
      expect(plan.skipped[0]?.reason).toContain("installed dependencies");
    });

    it("skips this build's own output", () => {
      const plan = planWholeFolders(
        [{ path: "proto/dist/_site-preview/index.html", size: 10 }],
        context({ outputFolders: ["proto/dist/_site-preview"] }),
      );
      expect(plan.pages).toEqual([]);
      expect(plan.skipped[0]?.reason).toContain("own output");
    });

    /**
     * The leak this plugin guards hardest: raw Markdown reaches a site with
     * its frontmatter on it and never passes the privacy scan.
     */
    it("never publishes a note as Markdown source", () => {
      const plan = planWholeFolders(
        [{ path: "proto/dist/notes/salary.md", size: 10 }],
        context(),
      );
      expect(plan.carry).toEqual([]);
      expect(plan.skipped[0]?.reason).toContain("rendered page rather than as Markdown");
    });

    it("skips Obsidian's own data files", () => {
      const plan = planWholeFolders(
        [
          { path: "proto/dist/board.canvas", size: 10 },
          { path: "proto/dist/table.base", size: 10 },
        ],
        context(),
      );
      expect(plan.carry).toEqual([]);
      expect(plan.skipped).toHaveLength(2);
      expect(plan.skipped[0]?.reason).toContain("Obsidian data file");
    });

    it("refuses a file outside the published folder", () => {
      const plan = planWholeFolders(
        [{ path: "elsewhere/app/main.js", size: 10 }],
        context({ entries: [at("elsewhere/app")], folder: "site" }),
      );
      expect(plan.carry).toEqual([]);
      expect(plan.skipped[0]?.reason).toContain("outside the published folder");
    });

    it("refuses a path the build writes itself", () => {
      const plan = planWholeFolders(
        [{ path: "proto/dist/assets/site.css", size: 10 }],
        context({ entries: [at("proto/dist")], folder: "proto/dist" }),
      );
      expect(plan.carry).toEqual([]);
      expect(plan.skipped[0]?.reason).toContain("a path the build writes itself");
    });

    /** A file landing on a page would replace it with a download. */
    it("refuses a url a page has already claimed, and says what has it", () => {
      const plan = planWholeFolders(
        [{ path: "proto/dist/about.pdf", size: 10 }],
        context({
          folder: "proto/dist",
          claimedBy: (url) => (url === "about.pdf" ? "notes/About.md" : null),
        }),
      );
      expect(plan.carry).toEqual([]);
      expect(plan.skipped[0]?.reason).toContain("already published from notes/About.md");
    });

    it("applies the size ceiling one file at a time", () => {
      const plan = planWholeFolders(
        [
          { path: "proto/dist/small.js", size: 10 },
          { path: "proto/dist/huge.mp4", size: 99 * 1024 * 1024 },
        ],
        context(),
      );
      expect(plan.carry.map((file) => file.sourcePath)).toEqual(["proto/dist/small.js"]);
      expect(plan.skipped[0]?.reason).toContain("too big");
    });

    /** A refused file is not a published one, so it is not in the count. */
    it("counts only what it actually published", () => {
      const plan = planWholeFolders(
        [
          { path: "proto/dist/app.js", size: 100 },
          { path: "proto/dist/notes.md", size: 50 },
        ],
        context(),
      );
      expect(plan.tallies).toEqual([{ entry: "proto/dist", at: null, count: 1, bytes: 100, hasIndex: false }]);
    });
  });
});

/**
 * The near miss: a folder pointed one level above the build.
 *
 * `dist/app` where the build wrote `dist/app/browser` publishes every file
 * correctly and still serves nothing at its own address, because the page
 * is one folder further down. The count is healthy and the destination is
 * a 404, so nothing else in the build can see it.
 */
describe("whether a folder published a front page", () => {
  const AT_ROOT = [
    { path: "dist/app/browser/index.html", size: 10 },
    { path: "dist/app/browser/main-GHI789.js", size: 20 },
  ];

  function tally(files: { path: string; size: number }[], folder: string, dest: string | null) {
    const plan = planWholeFolders(files, context({ entries: [{ folder, at: dest }] }));
    return plan.tallies[0];
  }

  it("sees the index at the top of the folder", () => {
    expect(tally(AT_ROOT, "dist/app/browser", "app").hasIndex).toBe(true);
  });

  // Pointed one level too high: the files travel, the address does not work.
  it("does not count an index one folder down", () => {
    expect(tally(AT_ROOT, "dist/app", "app").hasIndex).toBe(false);
    // ...and the count is healthy, which is what makes this invisible.
    expect(tally(AT_ROOT, "dist/app", "app").count).toBe(2);
  });

  // The question is about the folder, so the destination cannot change it.
  it("answers the same whatever the destination", () => {
    for (const at of ["app", "", null]) {
      expect(tally(AT_ROOT, "dist/app/browser", at).hasIndex).toBe(true);
    }
  });
});
