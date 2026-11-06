import { describe, expect, it } from "vitest";
import {
  WholeFolderContext,
  entryFor,
  isInWholeFolder,
  planWholeFolders,
} from "./wholeFolders";

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
    entries: ["proto/dist"],
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
    expect(entryFor("proto/dist/assets/a.js", ["proto/dist"])).toBe("proto/dist");
    expect(entryFor("proto/dist", ["proto/dist"])).toBe("proto/dist");
  });

  it("does not match a folder whose name merely starts the same way", () => {
    expect(entryFor("proto/dist-old/a.js", ["proto/dist"])).toBe(null);
  });

  /**
   * The same case-insensitivity the exclude list has, for the same reason:
   * these are one folder on the filesystems most vaults sit on.
   */
  it("ignores case, and tidies the way an entry was typed", () => {
    expect(entryFor("Proto/Dist/a.js", ["proto/dist"])).toBe("proto/dist");
    expect(entryFor("proto/dist/a.js", ["/Proto/Dist/"])).toBe("/Proto/Dist/");
  });

  it("is null when nothing covers the path, and for an empty list", () => {
    expect(entryFor("notes/a.md", ["proto/dist"])).toBe(null);
    expect(entryFor("proto/dist/a.js", [])).toBe(null);
    expect(isInWholeFolder("proto/dist/a.js", [])).toBe(false);
    expect(isInWholeFolder("proto/dist/a.js", ["proto/dist"])).toBe(true);
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
      { entry: "proto/dist", count: 6, bytes: 191_800 },
    ]);
  });

  /** A path that matched nothing is a typo, and reads as one in the report. */
  it("reports an entry that matched nothing as a zero rather than silence", () => {
    const plan = planWholeFolders(DIST, context({ entries: ["proto/disp"] }));
    expect(plan.tallies).toEqual([{ entry: "proto/disp", count: 0, bytes: 0 }]);
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
        context({ entries: ["proto"] }),
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
        context({ entries: ["elsewhere/app"], folder: "site" }),
      );
      expect(plan.carry).toEqual([]);
      expect(plan.skipped[0]?.reason).toContain("outside the published folder");
    });

    it("refuses a path the build writes itself", () => {
      const plan = planWholeFolders(
        [{ path: "proto/dist/assets/site.css", size: 10 }],
        context({ entries: ["proto/dist"], folder: "proto/dist" }),
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
      expect(plan.tallies).toEqual([{ entry: "proto/dist", count: 1, bytes: 100 }]);
    });
  });
});
