import { describe, expect, it } from "vitest";
import type { App, TFile } from "obsidian";
import { DEFAULT_OUTPUT_FOLDERS } from "./outputFolders";
import {
  CompanionContext,
  appShellWithoutCode,
  companionVaultPath,
  countHtmlFilesAvailable,
  countHtmlFilesBlockedByFlag,
  findLocalReferences,
  findStylesheetReferences,
  hasLocalResourceUrl,
  isHtmlFilePath,
  isLocalReference,
  isStylesheet,
  baseHref,
  baseHrefHazard,
  findRootAbsoluteReferences,
  isDirectoryReference,
  mayCarryCompanion,
  pageTitle,
  planCompanions,
  planHtmlFiles,
  planStylesheetCompanions,
  planStylesheetTree,
  reservedPathReason,
  selectHtmlFiles,
  SITE_ASSET_FILES,
  SITE_ASSET_FOLDERS,
  urlForVaultFile,
  withinScope,
} from "./htmlFiles";
import { OVERLAY_SCRIPT_PATH, SITE_SCRIPT_PATH } from "./page";
import { assetUrl } from "./assets";

/** Enough of an App for selection, which reads one thing: every vault file. */
function stubApp(paths: string[]): App {
  return {
    vault: { getFiles: () => paths.map((path) => ({ path }) as TFile) },
  } as unknown as App;
}

function config(over: Record<string, unknown> = {}) {
  return {
    folder: null as string | null,
    requireFrontmatterFlag: null as string | null,
    publishHtmlFiles: true,
    outputFolders: DEFAULT_OUTPUT_FOLDERS,
    ...over,
  };
}

const VAULT = [
  "site/index.html",
  "site/demo/chart.html",
  "site/demo/chart.js",
  "site/styles.css",
  "site/notes.md",
  "clippings/saved-article.html",
  "README.md",
];

describe("isHtmlFilePath", () => {
  it("takes both spellings of the extension", () => {
    expect(isHtmlFilePath("a/b.html")).toBe(true);
    expect(isHtmlFilePath("a/b.htm")).toBe(true);
    expect(isHtmlFilePath("a/b.HTML")).toBe(true);
  });

  it("is not fooled by a name that merely contains one", () => {
    expect(isHtmlFilePath("notes/html.md")).toBe(false);
    expect(isHtmlFilePath("notes/about-html-files.md")).toBe(false);
  });
});

describe("selectHtmlFiles", () => {
  // The default that matters: a vault full of saved articles does not become
  // a published site because someone chose a folder scope once.
  it("publishes nothing until the setting is on", () => {
    const selected = selectHtmlFiles(
      stubApp(VAULT),
      config({ folder: "", publishHtmlFiles: false }),
    );
    expect(selected).toEqual([]);
  });

  it("takes the html files in the scope and leaves the rest of the vault", () => {
    const selected = selectHtmlFiles(stubApp(VAULT), config({ folder: "site" }));
    expect(selected.map((f) => f.path)).toEqual([
      "site/demo/chart.html",
      "site/index.html",
    ]);
  });

  it("takes the whole vault for an empty folder", () => {
    const selected = selectHtmlFiles(stubApp(VAULT), config({ folder: "" }));
    expect(selected.map((f) => f.path)).toEqual([
      "clippings/saved-article.html",
      "site/demo/chart.html",
      "site/index.html",
    ]);
  });

  // A folder kept out of the site is kept out whatever is in it: a page
  // published as-is is as public as a note, and the clippings folder is
  // exactly the kind of thing somebody excludes.
  it("leaves out the folders the author excluded", () => {
    const selected = selectHtmlFiles(
      stubApp(VAULT),
      config({ folder: "", excludeFolders: ["clippings"] }),
    );
    expect(selected.map((f) => f.path)).toEqual([
      "site/demo/chart.html",
      "site/index.html",
    ]);
  });

  /**
   * The recursion this feature would otherwise have shipped with. The
   * preview is written into the vault as HTML, so the second build would
   * select the first build's output and publish the site inside the site.
   */
  it("never selects the build's own output", () => {
    const vault = [
      "_site-preview/index.html",
      "_site-preview/notes/a.html",
      "_vault-publisher/report.html",
      "page.html",
    ];
    const selected = selectHtmlFiles(stubApp(vault), config({ folder: "" }));
    expect(selected.map((f) => f.path)).toEqual(["page.html"]);
  });

  // The names are passed in by the caller that writes to them; the default
  // is there so a caller that forgets still cannot feed the build its own
  // output.
  it("excludes the output folders even when the caller names none", () => {
    const selected = selectHtmlFiles(
      stubApp(["_site-preview/index.html", "page.html"]),
      config({ folder: "", outputFolders: undefined }),
    );
    expect(selected.map((f) => f.path)).toEqual(["page.html"]);
  });

  it("leaves hidden folders alone", () => {
    const selected = selectHtmlFiles(
      stubApp([".obsidian/plugins/x/help.html", "page.html"]),
      config({ folder: "" }),
    );
    expect(selected.map((f) => f.path)).toEqual(["page.html"]);
  });

  /*
   * The one that made builds fail rather than merely crawl. A prototype
   * brings its dependencies into the vault, `node_modules` has no leading
   * dot so the rule above cannot see it, and every package's bundled demo
   * page, coverage report and test fixture was read, scanned and published.
   */
  it("leaves installed dependencies alone", () => {
    const selected = selectHtmlFiles(
      stubApp([
        "proto/index.html",
        "proto/node_modules/chart.js/docs/index.html",
        "proto/node_modules/x/coverage/lcov-report/index.html",
      ]),
      config({ folder: "" }),
    );
    expect(selected.map((f) => f.path)).toEqual(["proto/index.html"]);
  });

  // Somebody reviewing a package's own demo page has said so by scoping to
  // it, and a build that matched nothing and could not say why is worse.
  it("yields to a scope aimed inside one", () => {
    const selected = selectHtmlFiles(
      stubApp(["proto/node_modules/chart.js/docs/index.html", "proto/index.html"]),
      config({ folder: "proto/node_modules/chart.js" }),
    );
    expect(selected.map((f) => f.path)).toEqual([
      "proto/node_modules/chart.js/docs/index.html",
    ]);
  });

  // An HTML file has no frontmatter, so it cannot pass the gate. Publishing
  // it anyway would apply the user's opt-in to notes and not to pages.
  it("publishes none of them when a frontmatter flag is required", () => {
    const selected = selectHtmlFiles(
      stubApp(VAULT),
      config({ folder: "", requireFrontmatterFlag: "publish" }),
    );
    expect(selected).toEqual([]);
  });

  // The other configuration that publishes nothing. Someone turned the
  // toggle on, published a page, then looked for it in the site's file tree
  // and could not tell whether it had published or whether a setting had
  // stopped it. The count is what lets the report answer that.
  it("counts what the toggle being off left out", () => {
    const app = stubApp(VAULT);
    expect(countHtmlFilesAvailable(app, config({ folder: "", publishHtmlFiles: false }))).toBe(3);
    // Nothing to report when the toggle is on: those files are in `published`.
    expect(countHtmlFilesAvailable(app, config({ folder: "" }))).toBe(0);
    // Counted even with a flag set, because the toggle is the nearer cause
    // and the flag message would send the reader to the wrong setting.
    expect(
      countHtmlFilesAvailable(
        app,
        config({ folder: "", publishHtmlFiles: false, requireFrontmatterFlag: "publish" }),
      ),
    ).toBe(3);
  });

  it("counts what the flag excluded, so the setting can say so", () => {
    const app = stubApp(VAULT);
    expect(
      countHtmlFilesBlockedByFlag(
        app,
        config({ folder: "", requireFrontmatterFlag: "publish" }),
      ),
    ).toBe(3);
    expect(countHtmlFilesBlockedByFlag(app, config({ folder: "" }))).toBe(0);
    expect(
      countHtmlFilesBlockedByFlag(
        app,
        config({ folder: "", requireFrontmatterFlag: "publish", publishHtmlFiles: false }),
      ),
    ).toBe(0);
  });
});

describe("urlForVaultFile", () => {
  // The whole mechanism: a page and the stylesheet beside it move the same
  // way, so the reference between them is still true on the site.
  it("mirrors the path under the published folder, extension kept", () => {
    expect(urlForVaultFile("site/demo/chart.html", "site")).toBe("demo/chart.html");
    expect(urlForVaultFile("site/demo/chart.js", "site")).toBe("demo/chart.js");
  });

  it("keeps the whole path when publishing the whole vault", () => {
    expect(urlForVaultFile("site/demo/chart.html", "")).toBe("site/demo/chart.html");
    expect(urlForVaultFile("site/demo/chart.html", null)).toBe("site/demo/chart.html");
  });
});

describe("withinScope", () => {
  it("is true for everything when the scope is the vault", () => {
    expect(withinScope("a/b.css", "")).toBe(true);
    expect(withinScope("a/b.css", null)).toBe(true);
  });

  // A companion outside the scope has no honest published path: mirroring it
  // would put it outside the site root.
  it("is false for a file outside the published folder", () => {
    expect(withinScope("shared/x.css", "site")).toBe(false);
    expect(withinScope("site/x.css", "site")).toBe(true);
  });

  it("does not match a folder whose name is a prefix of another", () => {
    expect(withinScope("sitemap/x.css", "site")).toBe(false);
  });
});

describe("reservedPathReason", () => {
  it("refuses the paths the build writes itself", () => {
    for (const path of SITE_ASSET_FILES) {
      expect(reservedPathReason(path)).toMatch(/the build writes itself/);
    }
    // And the two subfolders, wholesale: note media and the MathJax fonts
    // are named from the vault, so there is no fixed list of them.
    expect(reservedPathReason("assets/files/pics/plot.png")).toMatch(
      /the build writes itself/,
    );
    expect(reservedPathReason("assets/mathjax/MathJax_Main-Regular.woff")).toMatch(
      /the build writes itself/,
    );
    expect(reservedPathReason(".nojekyll")).toMatch(/the site itself needs/);
    expect(reservedPathReason("CNAME")).toMatch(/the site itself needs/);
  });

  /*
   * The case this rule used to break, and it is the common one: every
   * bundler writes to `dist/assets/`, so a site scoped at a `dist` folder
   * mirrors the application's own `assets/` onto the site root. A
   * folder-wide rule refused the whole bundle -- a page that published with
   * none of its JavaScript -- over a collision that does not exist, since a
   * hashed name cannot be one of ours.
   */
  it("lets a built application keep its own assets folder", () => {
    expect(reservedPathReason("assets/index-C7x1a9.js")).toBe(null);
    expect(reservedPathReason("assets/index-9f2b.css")).toBe(null);
    expect(reservedPathReason("assets/logo-4de1.svg")).toBe(null);
    // A file called `assets` collides with nothing either: the build writes
    // paths inside it, and never a file by that name.
    expect(reservedPathReason("assets")).toBe(null);
  });

  it("allows everything else", () => {
    expect(reservedPathReason("demo/chart.html")).toBe(null);
    expect(reservedPathReason("assetsmith/x.css")).toBe(null);
  });

  /*
   * The list is the rule, so it has to be held to the thing it describes.
   * `page.ts` owns the two script paths because it writes the tags that
   * reference them; adding a third there and not here would mean a vault
   * file could land on top of the site's own JavaScript, silently, which is
   * exactly the failure the reservation exists for.
   */
  it("covers every asset path the rest of the build declares", () => {
    expect(SITE_ASSET_FILES).toContain(SITE_SCRIPT_PATH);
    expect(SITE_ASSET_FILES).toContain(OVERLAY_SCRIPT_PATH);
    // The two stylesheets `page.ts` links into every page.
    expect(SITE_ASSET_FILES).toContain("assets/site.css");
    expect(SITE_ASSET_FILES).toContain("assets/obsidian.css");
    // And the folder note media goes to, which `assetUrl` decides.
    expect(assetUrl("pics/plot.png").startsWith(SITE_ASSET_FOLDERS[0])).toBe(true);
  });
});

/*
 * The one blank page this report could not account for. An Angular project's
 * `src/index.html` was selected, published byte for byte, and its only
 * reference -- a favicon -- was carried; everything worked and the page was
 * always going to be empty, because what is wrong with it is what it does
 * not contain.
 */
describe("appShellWithoutCode", () => {
  it("recognises the shell of each of the frameworks", () => {
    expect(appShellWithoutCode(`<body><app-root></app-root></body>`)).toBe("<app-root>");
    expect(appShellWithoutCode(`<body><router-outlet></router-outlet></body>`)).toBe(
      "<router-outlet>",
    );
    expect(appShellWithoutCode(`<body><div id="root"></div></body>`)).toBe(
      `<div id="root">`,
    );
    expect(appShellWithoutCode(`<body><div id="app"></div></body>`)).toBe(
      `<div id="app">`,
    );
    expect(appShellWithoutCode(`<body><div id="__next"></div></body>`)).toBe(
      `<div id="__next">`,
    );
  });

  // An Angular `src/index.html` as `ng new` writes one: a base href, a
  // favicon, a root element, and no code anywhere.
  it("recognises a stock project index.html", () => {
    const html =
      `<!doctype html><html><head><base href="/">` +
      `<link rel="icon" href="favicon.ico"></head>` +
      `<body><app-root></app-root></body></html>`;
    expect(appShellWithoutCode(html)).toBe("<app-root>");
  });

  /*
   * And the half that keeps it quiet. A hand-written page with no JavaScript
   * is what as-is publishing is *for*, so warning about those would put a
   * warning on the feature's main case; a built application always carries a
   * script tag, so it never trips either. Both halves are needed.
   */
  it("says nothing about a page that is not an empty shell", () => {
    // The built app: same root element, with its code.
    expect(
      appShellWithoutCode(
        `<div id="root"></div><script type="module" src="./assets/index-a1.js"></script>`,
      ),
    ).toBe(null);
    // A hand-written page, which is the whole point of this path.
    expect(appShellWithoutCode(`<h1>A page</h1><p>With no script at all.</p>`)).toBe(
      null,
    );
    // A root element by another name is not one of these.
    expect(appShellWithoutCode(`<div id="rooted"></div>`)).toBe(null);
    expect(appShellWithoutCode(`<div id="application"></div>`)).toBe(null);
    // And an attribute that merely ends in `id` is not `id`.
    expect(appShellWithoutCode(`<div data-id="app"></div>`)).toBe(null);
  });
});

describe("findLocalReferences", () => {
  it("finds a stylesheet, a script and an image", () => {
    const html = `<link rel="stylesheet" href="styles.css">
      <script src="../lib/chart.js"></script>
      <img src="pics/plot.png" alt="">`;
    expect(findLocalReferences(html)).toEqual([
      "styles.css",
      "../lib/chart.js",
      "pics/plot.png",
    ]);
  });

  it("finds references in single quotes and with no quotes at all", () => {
    expect(findLocalReferences(`<img src='a.png'><img src=b.png>`)).toEqual([
      "a.png",
      "b.png",
    ]);
  });

  /**
   * The case this module exists for. A page that carries its own styling
   * carries its fonts and background images in CSS, which no attribute scan
   * would ever see.
   */
  it("finds url() in a style block and in a style attribute", () => {
    const html = `<style>
        @font-face { font-family: X; src: url("fonts/x.woff2"); }
        body { background: url(bg.jpg); }
      </style>
      <div style="background-image: url('hero.png')"></div>`;
    expect(findLocalReferences(html)).toEqual([
      "fonts/x.woff2",
      "bg.jpg",
      "hero.png",
    ]);
  });

  it("takes every candidate in a srcset, without the descriptors", () => {
    const html = `<img srcset="small.png 1x, big.png 2x" src="small.png">`;
    expect(findLocalReferences(html)).toEqual(["small.png", "big.png"]);
  });

  it("finds an object's data and a video's poster", () => {
    const html = `<object data="doc.pdf"></object><video poster="still.jpg"></video>`;
    expect(findLocalReferences(html)).toEqual(["doc.pdf", "still.jpg"]);
  });

  it("leaves alone everything that does not name a file in the vault", () => {
    const html = `<a href="https://example.com">x</a>
      <a href="#section">y</a>
      <a href="/root.css">z</a>
      <script src="//cdn.example.com/a.js"></script>
      <img src="data:image/png;base64,AAAA">
      <a href="mailto:someone@example.com">m</a>`;
    expect(findLocalReferences(html)).toEqual([]);
  });

  it("reports each reference once however often it appears", () => {
    const html = `<img src="a.png"><img src="a.png">`;
    expect(findLocalReferences(html)).toEqual(["a.png"]);
  });
});

describe("isLocalReference", () => {
  it("rejects a scheme, a protocol-relative url and a root-absolute path", () => {
    expect(isLocalReference("https://example.com/a.css")).toBe(false);
    expect(isLocalReference("//example.com/a.css")).toBe(false);
    expect(isLocalReference("/a.css")).toBe(false);
    expect(isLocalReference("#top")).toBe(false);
    expect(isLocalReference("")).toBe(false);
  });

  it("accepts a relative path", () => {
    expect(isLocalReference("a.css")).toBe(true);
    expect(isLocalReference("../lib/a.css")).toBe(true);
    expect(isLocalReference("./a.css")).toBe(true);
  });
});

describe("companionVaultPath", () => {
  it("resolves against the page's own folder", () => {
    expect(companionVaultPath("site/demo/chart.html", "chart.js")).toBe(
      "site/demo/chart.js",
    );
    expect(companionVaultPath("site/demo/chart.html", "./chart.js")).toBe(
      "site/demo/chart.js",
    );
  });

  it("applies .. the way a browser will", () => {
    expect(companionVaultPath("site/demo/chart.html", "../styles.css")).toBe(
      "site/styles.css",
    );
    expect(companionVaultPath("site/a/b/c.html", "../../x/y.css")).toBe("site/x/y.css");
  });

  // There is no file above the vault root to carry, and guessing at what the
  // author meant would be worse than reporting it.
  it("refuses a reference that climbs above the vault root", () => {
    expect(companionVaultPath("page.html", "../outside.css")).toBe(null);
    expect(companionVaultPath("site/page.html", "../../outside.css")).toBe(null);
  });

  it("drops a query and a fragment", () => {
    expect(companionVaultPath("page.html", "a.css?v=2")).toBe("a.css");
    expect(companionVaultPath("page.html", "fonts/x.woff2#iefix")).toBe("fonts/x.woff2");
  });

  // An attachment is as free to be called "chart (final).png" as a note is,
  // and a hand-written page will have encoded that.
  it("decodes percent-encoding, since the vault path is not encoded", () => {
    expect(companionVaultPath("page.html", "pics/chart%20(final).png")).toBe(
      "pics/chart (final).png",
    );
  });

  it("returns null for encoding it cannot decode", () => {
    expect(companionVaultPath("page.html", "a%ZZ.css")).toBe(null);
  });

  it("returns null for a reference with nothing in it", () => {
    expect(companionVaultPath("page.html", "?v=2")).toBe(null);
  });
});

describe("mayCarryCompanion", () => {
  /**
   * The refusal that is a privacy rule rather than a tidiness one. A note
   * copied as a companion would reach the site as raw Markdown with its
   * frontmatter on it, which is every protection in this plugin bypassed by
   * one `<a href>`.
   */
  it("never carries a markdown file", () => {
    expect(mayCarryCompanion("notes/salary.md")).toBe(false);
  });

  // An HTML file is published when the scope matches it. Carrying one
  // because another page linked to it would publish a file the user left out.
  it("never carries another html file", () => {
    expect(mayCarryCompanion("site/other.html")).toBe(false);
    expect(mayCarryCompanion("site/other.htm")).toBe(false);
  });

  it("never carries Obsidian's own data files", () => {
    expect(mayCarryCompanion("Reading.base")).toBe(false);
    expect(mayCarryCompanion("Map.canvas")).toBe(false);
  });

  it("carries what a page actually needs", () => {
    for (const path of [
      "styles.css",
      "lib/chart.js",
      "pics/plot.png",
      "fonts/x.woff2",
      "data/series.json",
      "doc.pdf",
    ]) {
      expect(mayCarryCompanion(path)).toBe(true);
    }
  });
});

describe("baseHref", () => {
  it("reads the value a page sets", () => {
    expect(baseHref(`<head><base href="/"></head>`)).toBe("/");
    expect(baseHref(`<head><base href="./"></head>`)).toBe("./");
    expect(baseHref(`<base href='/app/'>`)).toBe("/app/");
    // Unquoted, and with another attribute in the way.
    expect(baseHref(`<base target=_blank href=./ >`)).toBe("./");
  });

  it("is null for a page that sets none", () => {
    expect(baseHref(`<head><title>x</title></head>`)).toBeNull();
  });

  // A page that documents a base tag is not a page that has one.
  it("ignores one inside a comment", () => {
    expect(baseHref(`<!-- <base href="/"> --><head></head>`)).toBeNull();
  });

  it("takes the first, which is the only one a browser honours", () => {
    expect(baseHref(`<base href="./"><base href="/">`)).toBe("./");
  });
});

describe("baseHrefHazard", () => {
  /**
   * The case that produced two byte-identical builds, one working and one
   * blank: Angular's default base. Every reference on the page is relative,
   * so every file travels, and the browser then looks for all of them at the
   * root of the domain.
   */
  it("reports a base resolved from the root of the server", () => {
    const why = baseHrefHazard("/");
    expect(why).toContain("root of the server");
    expect(why).toContain('"./"');
  });

  it("reports a base pointing anywhere else", () => {
    expect(baseHrefHazard("/app/")).toContain("root of the server");
    expect(baseHrefHazard("https://example.com/")).toContain("somewhere other than");
  });

  it("says nothing about the ones that work", () => {
    expect(baseHrefHazard("./")).toBeNull();
    expect(baseHrefHazard(".")).toBeNull();
    expect(baseHrefHazard("")).toBeNull();
    // No base at all is the commonest sound answer of the lot.
    expect(baseHrefHazard(null)).toBeNull();
  });
});

describe("findRootAbsoluteReferences", () => {
  it("finds what the local scan deliberately drops", () => {
    const html = `<script src="/assets/index-a1b2.js"></script>
      <link rel="stylesheet" href="/assets/index-c3d4.css">
      <img src="pics/plot.png">
      <script src="//cdn.example.com/x.js"></script>
      <a href="https://example.com/">out</a>`;
    expect(findRootAbsoluteReferences(html)).toEqual([
      "/assets/index-a1b2.js",
      "/assets/index-c3d4.css",
    ]);
    // The relative one is still the local scan's business, and only its.
    expect(findLocalReferences(html)).toEqual(["pics/plot.png"]);
  });

  it("does not count a base tag among them", () => {
    expect(findRootAbsoluteReferences(`<base href="/">`)).toEqual([]);
  });
});

describe("isDirectoryReference", () => {
  it("claims a path that names a folder", () => {
    expect(isDirectoryReference("charts/")).toBe(true);
    expect(isDirectoryReference("./")).toBe(true);
    expect(isDirectoryReference(".")).toBe(true);
    expect(isDirectoryReference("..")).toBe(true);
    expect(isDirectoryReference("charts/?v=2")).toBe(true);
  });

  it("leaves a file alone", () => {
    expect(isDirectoryReference("charts/trend.html")).toBe(false);
    expect(isDirectoryReference("styles.css")).toBe(false);
  });
});

describe("hasLocalResourceUrl", () => {
  // Such a URL contains the vault's absolute path, so the author's home
  // directory. The note pipeline strips these; an as-is page cannot be
  // touched, so the build reports it instead.
  it("spots an app:// url, which carries the vault's own path", () => {
    // The same fictional home path `assets.test.ts` uses, for the same
    // reason: a test about a leaking path needs a path that cannot leak.
    expect(
      hasLocalResourceUrl(`<img src="app://local/Users/somebody/vault/a.png">`),
    ).toBe(true);
    expect(hasLocalResourceUrl(`<img src="pics/a.png">`)).toBe(false);
  });
});

describe("planCompanions", () => {
  const page = { sourcePath: "site/demo/chart.html", url: "demo/chart.html" };

  /**
   * The vault around a page, as the planner asks about it: which paths are
   * files and how big, which are pages going out as-is, which are notes.
   */
  function context(over: Partial<CompanionContext> = {}): CompanionContext {
    const sizes: Record<string, number> = {
      "site/demo/chart.js": 400,
      "site/styles.css": 200,
      "site/demo/pics/plot.png": 900,
      "shared/outside.css": 100,
      "site/assets/site.css": 100,
      "site/huge.css": 99 * 1024 * 1024,
    };
    return {
      folder: "site",
      statFile: (path) => sizes[path] ?? null,
      isPublishedPage: () => false,
      pageRefused: () => null,
      publishedNoteUrl: () => null,
      maxBytes: 25 * 1024 * 1024,
      tooBigReason: (size, limit) => (size > limit ? `too big: ${size} > ${limit}` : null),
      ...over,
    };
  }

  it("carries the files a page references, at mirrored paths", () => {
    const html = `<link rel="stylesheet" href="../styles.css">
      <script src="chart.js"></script>
      <img src="pics/plot.png">`;
    const plan = planCompanions(page, html, context());
    expect(plan.carry).toEqual([
      { sourcePath: "site/styles.css", url: "styles.css" },
      { sourcePath: "site/demo/chart.js", url: "demo/chart.js" },
      { sourcePath: "site/demo/pics/plot.png", url: "demo/pics/plot.png" },
    ]);
    expect(plan.broken).toEqual([]);
    expect(plan.refused).toEqual([]);
  });

  /*
   * The deliberate hole in the dependency rule, and it has to be a hole.
   * Selection refuses to *publish* anything inside `node_modules` -- a
   * package's README is not a note and its demo is not a page -- but a
   * prototype that loads a library from there with a `<script src>` is
   * pointing at it on purpose, and the published prototype is broken
   * without it. One file per reference, so it cannot run away with the
   * build the way selecting the tree did.
   */
  it("still carries a library a page asks for by name", () => {
    const html = `<script src="../node_modules/chart.js/dist/chart.umd.js"></script>`;
    const plan = planCompanions(page, html, {
      ...context(),
      statFile: (path) =>
        path === "site/node_modules/chart.js/dist/chart.umd.js" ? 2000 : null,
    });
    expect(plan.carry).toEqual([
      {
        sourcePath: "site/node_modules/chart.js/dist/chart.umd.js",
        url: "node_modules/chart.js/dist/chart.umd.js",
      },
    ]);
    expect(plan.broken).toEqual([]);
  });

  it("says which references will 404, and still carries the rest", () => {
    const html = `<link rel="stylesheet" href="../styles.css"><img src="gone.png">`;
    const plan = planCompanions(page, html, context());
    expect(plan.carry.map((c) => c.url)).toEqual(["styles.css"]);
    expect(plan.broken).toEqual([
      "demo/chart.html -> gone.png (no such file in the vault)",
    ]);
  });

  // The link that works and used to be reported as broken: both files
  // mirror the same way, so the reference between them is already true.
  it("says nothing about a link to another page going out as-is", () => {
    const html = `<a href="../index.html">home</a>`;
    const plan = planCompanions(
      page,
      html,
      context({ isPublishedPage: (path) => path === "site/index.html" }),
    );
    expect(plan.broken).toEqual([]);
    expect(plan.carry).toEqual([]);
  });

  /**
   * The report this got wrong first time round. The page lost a collision,
   * so it is not published -- but its path is occupied by whatever won, and
   * the link opens that. "Will 404" was the one thing that was not true.
   */
  it("says why a link to an unpublished page is wrong, not merely that it is", () => {
    const html = `<a href="../about.html">about</a>`;
    const plan = planCompanions(
      page,
      html,
      context({
        pageRefused: (path) =>
          path === "site/about.html" ? "a note's page occupies about.html" : null,
      }),
    );
    expect(plan.broken).toEqual([
      "demo/chart.html -> ../about.html (a note's page occupies about.html)",
    ]);
  });

  it("falls back to saying a page is not published when there is no reason", () => {
    const plan = planCompanions(page, `<a href="../elsewhere.html">x</a>`, context());
    expect(plan.broken).toEqual([
      "demo/chart.html -> ../elsewhere.html (that page is not published)",
    ]);
  });

  it("sends a link to a note at the page that note was published as", () => {
    const html = `<a href="../basics.md">basics</a>`;
    const plan = planCompanions(
      page,
      html,
      context({
        publishedNoteUrl: (path) => (path === "site/basics.md" ? "basics.html" : null),
      }),
    );
    expect(plan.broken).toEqual([
      "demo/chart.html -> ../basics.md (that note is published at basics.html -- point the link there)",
    ]);
    expect(plan.carry).toEqual([]);
  });

  // The leak this table exists for: raw Markdown on the site, frontmatter
  // and all, from a vault file nobody chose to publish.
  it("never carries a note, published or not", () => {
    const html = `<a href="../secret.md">x</a>`;
    const plan = planCompanions(page, html, context());
    expect(plan.carry).toEqual([]);
    expect(plan.broken).toEqual([
      "demo/chart.html -> ../secret.md (a note is published as its .html page, not as Markdown)",
    ]);
  });

  it("refuses a file outside the published folder, since it has no path inside", () => {
    const html = `<link rel="stylesheet" href="../../shared/outside.css">`;
    const plan = planCompanions(page, html, context());
    expect(plan.carry).toEqual([]);
    expect(plan.refused).toEqual([
      {
        path: "shared/outside.css",
        reason:
          "referenced by demo/chart.html but outside the published folder, so it " +
          "has no path inside the site -- move it in, or point the page at a " +
          "copy that is",
      },
    ]);
  });

  it("refuses a file that would land where the build writes its own", () => {
    const html = `<link rel="stylesheet" href="../assets/site.css">`;
    const plan = planCompanions(page, html, context());
    expect(plan.carry).toEqual([]);
    expect(plan.refused[0].path).toBe("site/assets/site.css");
    expect(plan.refused[0].reason).toMatch(/assets\//);
  });

  it("refuses a file over the size ceiling, in the words attachments get", () => {
    const html = `<link rel="stylesheet" href="../huge.css">`;
    const plan = planCompanions(page, html, context());
    expect(plan.carry).toEqual([]);
    expect(plan.refused[0]).toEqual({
      path: "site/huge.css",
      reason: `too big: ${99 * 1024 * 1024} > ${25 * 1024 * 1024}`,
    });
  });

  it("decides a file once however many times a page names it", () => {
    const html = `<img src="pics/plot.png"><img src="./pics/plot.png">
      <div style="background: url(pics/plot.png)"></div>`;
    const plan = planCompanions(page, html, context());
    expect(plan.carry).toHaveLength(1);
  });

  it("refuses an out-of-scope file once, not once per reference", () => {
    const html = `<link href="../../shared/outside.css" rel="stylesheet">
      <div style="background: url(../../shared/outside.css)"></div>`;
    const plan = planCompanions(page, html, context());
    expect(plan.refused).toHaveLength(1);
  });

  it("leaves a reference to somewhere else entirely alone", () => {
    const html = `<link rel="stylesheet" href="https://cdn.example.com/a.css">
      <script src="//cdn.example.com/b.js"></script>`;
    const plan = planCompanions(page, html, context());
    expect(plan).toEqual({ carry: [], broken: [], refused: [] });
  });

  /**
   * The silence this exists to end. Every bundler writes root-absolute
   * references by default, there is no vault file at a server path to carry,
   * and dropping them quietly is how a stock build came to publish its HTML,
   * none of its code, and a report that mentioned neither.
   */
  it("reports a reference resolved from the root of the server", () => {
    const html = `<script type="module" src="/assets/index-a1b2c3.js"></script>
      <link rel="stylesheet" href="/assets/index-d4e5f6.css">`;
    const plan = planCompanions(page, html, context());
    expect(plan.carry).toEqual([]);
    expect(plan.broken).toHaveLength(2);
    expect(plan.broken[0]).toContain("/assets/index-a1b2c3.js");
    expect(plan.broken[0]).toContain("root of the server");
    expect(plan.broken[0]).toContain("relative base");
  });

  // A static host answers a folder with its index, so there is nothing to
  // carry and nothing broken. This used to be reported as a missing file.
  it("says nothing about a reference to a folder", () => {
    const html = `<a href="charts/">charts</a><a href="./">here</a>
      <a href="..">up</a>`;
    const plan = planCompanions(page, html, context());
    expect(plan).toEqual({ carry: [], broken: [], refused: [] });
  });

  /**
   * The false positive that prompted all of this. A page whose base is the
   * sound `./` was reported as having a broken reference to `./`, because the
   * scanner matched `href` on any element and then tried to resolve it as a
   * file.
   */
  it("does not treat a base tag as a reference of its own", () => {
    const html = `<base href="./"><link rel="stylesheet" href="../styles.css">`;
    const plan = planCompanions(page, html, context());
    expect(plan.broken).toEqual([]);
    expect(plan.carry.map((c) => c.url)).toEqual(["styles.css"]);
  });

  // With the whole vault in scope the mirror is exact, so nothing can be
  // outside the site root.
  it("carries anything in the vault when the scope is the whole vault", () => {
    const plan = planCompanions(
      { sourcePath: "site/demo/chart.html", url: "site/demo/chart.html" },
      `<link rel="stylesheet" href="../../shared/outside.css">`,
      context({ folder: "" }),
    );
    expect(plan.carry).toEqual([
      { sourcePath: "shared/outside.css", url: "shared/outside.css" },
    ]);
  });
});

describe("findStylesheetReferences", () => {
  it("finds the files a stylesheet asks for, however they are spelled", () => {
    const css = `@font-face { src: url("fonts/inter.woff2") format("woff2"); }
      .hero { background-image: url('pics/hero.png'); }
      .mask { -webkit-mask-image: url(masks/fade.svg); }
      @import "reset.css";
      @import url(tokens.css);`;
    expect(findStylesheetReferences(css).local).toEqual([
      "fonts/inter.woff2",
      "pics/hero.png",
      "masks/fade.svg",
      "tokens.css",
      "reset.css",
    ]);
  });

  it("keeps a quoted @import with a layer or a media query after it", () => {
    const css = `@import "base.css" layer(reset);
      @import "print.css" print and (min-width: 40em);`;
    expect(findStylesheetReferences(css).local).toEqual(["base.css", "print.css"]);
  });

  /**
   * A commented-out background is a file the author decided not to use.
   * Carrying it would be harmless, but reporting it as broken once the file
   * is deleted would say a correct page is wrong.
   */
  it("ignores what is inside a comment", () => {
    const css = `/* .old { background: url(gone.png); } */
      .new { background: url(here.png); }`;
    expect(findStylesheetReferences(css).local).toEqual(["here.png"]);
  });

  it("drops what cannot name a vault file, and splits off server paths", () => {
    const css = `.a { background: url(data:image/gif;base64,R0lGOD); }
      .b { background: url(https://cdn.example.com/x.png); }
      .c { background: url(//cdn.example.com/y.png); }
      .d { background: url(/assets/absolute.png); }
      .e { background: url(relative.png); }`;
    const found = findStylesheetReferences(css);
    expect(found.local).toEqual(["relative.png"]);
    expect(found.rootAbsolute).toEqual(["/assets/absolute.png"]);
  });

  it("finds nothing in a stylesheet that asks for nothing", () => {
    expect(findStylesheetReferences(".a { color: red; }").local).toEqual([]);
  });
});

describe("isStylesheet", () => {
  it("is true for a stylesheet and false for everything else", () => {
    expect(isStylesheet("assets/index-abc.css")).toBe(true);
    expect(isStylesheet("assets/INDEX.CSS")).toBe(true);
    expect(isStylesheet("assets/index-abc.js")).toBe(false);
    expect(isStylesheet("assets/inter.woff2")).toBe(false);
    expect(isStylesheet("css")).toBe(false);
  });
});

/**
 * The second hop: what a carried stylesheet asks for on its own account.
 *
 * The case this exists for is a built application. Its stylesheet travelled
 * and applied, and its webfont did not travel at all -- so the page laid out
 * correctly in a fallback font, with its background images missing, and
 * nothing in the report said so because nothing had read the CSS.
 */
describe("planStylesheetCompanions", () => {
  const sheet = { sourcePath: "site/app/assets/index-abc.css", url: "app/assets/index-abc.css" };

  function context(over: Partial<CompanionContext> = {}): CompanionContext {
    const sizes: Record<string, number> = {
      "site/app/assets/inter.woff2": 30_000,
      "site/app/assets/hero.png": 90_000,
      "site/app/fonts/mono.woff2": 20_000,
      "site/app/assets/tokens.css": 400,
      "site/shared/outside.png": 100,
      "site/app/assets/huge.png": 99 * 1024 * 1024,
      "outside/sheet.png": 100,
    };
    return {
      folder: "site",
      statFile: (path) => sizes[path] ?? null,
      isPublishedPage: () => false,
      pageRefused: () => null,
      publishedNoteUrl: () => null,
      maxBytes: 25 * 1024 * 1024,
      tooBigReason: (size, limit) => (size > limit ? `too big: ${size} > ${limit}` : null),
      ...over,
    };
  }

  it("carries the font and the image the stylesheet asks for", () => {
    const css = `@font-face { src: url(./inter.woff2); }
      .hero { background-image: url("hero.png"); }`;
    const plan = planStylesheetCompanions(sheet, css, context());
    expect(plan.carry).toEqual([
      { sourcePath: "site/app/assets/inter.woff2", url: "app/assets/inter.woff2" },
      { sourcePath: "site/app/assets/hero.png", url: "app/assets/hero.png" },
    ]);
    expect(plan.broken).toEqual([]);
    expect(plan.refused).toEqual([]);
  });

  /**
   * The whole reason this cannot be done by scanning the page's text and the
   * stylesheet's together: `../fonts/mono.woff2` names a different file
   * depending on which of them said it, and a browser resolves it against
   * the sheet.
   */
  it("resolves a reference against the stylesheet, not against any page", () => {
    const plan = planStylesheetCompanions(
      sheet,
      `@font-face { src: url(../fonts/mono.woff2); }`,
      context(),
    );
    expect(plan.carry).toEqual([
      { sourcePath: "site/app/fonts/mono.woff2", url: "app/fonts/mono.woff2" },
    ]);
  });

  it("names the stylesheet when one of its references resolves to nothing", () => {
    const plan = planStylesheetCompanions(
      sheet,
      `@font-face { src: url(./missing.woff2); }`,
      context(),
    );
    expect(plan.carry).toEqual([]);
    expect(plan.broken).toEqual([
      "app/assets/index-abc.css -> ./missing.woff2 (no such file in the vault)",
    ]);
  });

  it("reports a stylesheet asking for a file from the root of the server", () => {
    const plan = planStylesheetCompanions(
      sheet,
      `@font-face { src: url(/assets/inter.woff2); }`,
      context(),
    );
    expect(plan.carry).toEqual([]);
    expect(plan.broken[0]).toContain("/assets/inter.woff2");
    expect(plan.broken[0]).toContain("relative base");
  });

  it("refuses a file the stylesheet reaches outside the published folder", () => {
    const plan = planStylesheetCompanions(
      { sourcePath: "site/sheet.css", url: "sheet.css" },
      `.a { background: url(../outside/sheet.png); }`,
      context(),
    );
    expect(plan.carry).toEqual([]);
    expect(plan.refused[0]?.path).toBe("outside/sheet.png");
    expect(plan.refused[0]?.reason).toContain("outside the published folder");
  });

  it("applies the size ceiling a page's references get", () => {
    const plan = planStylesheetCompanions(
      sheet,
      `.a { background: url(./huge.png); }`,
      context(),
    );
    expect(plan.carry).toEqual([]);
    expect(plan.refused[0]?.reason).toContain("too big");
  });

  it("carries an imported stylesheet, which is then scanned in its turn", () => {
    const plan = planStylesheetCompanions(sheet, `@import "tokens.css";`, context());
    expect(plan.carry).toEqual([
      { sourcePath: "site/app/assets/tokens.css", url: "app/assets/tokens.css" },
    ]);
  });
});

describe("planStylesheetTree", () => {
  const SHEETS: Record<string, string> = {
    "site/app/index.css": `@import "theme.css";
      @font-face { src: url(fonts/inter.woff2); }`,
    "site/app/theme.css": `@import "tokens.css";
      .hero { background: url(../pics/hero.png); }`,
    "site/app/tokens.css": `:root { --a: 1px; }`,
    // Two sheets importing each other, which is legal and must terminate.
    "site/loop/a.css": `@import "b.css";`,
    "site/loop/b.css": `@import "a.css";`,
    "site/unreadable.css": "",
  };

  function context(): CompanionContext {
    const sizes: Record<string, number> = {
      "site/app/index.css": 500,
      "site/app/theme.css": 400,
      "site/app/tokens.css": 100,
      "site/app/fonts/inter.woff2": 30_000,
      "site/pics/hero.png": 90_000,
      "site/loop/a.css": 50,
      "site/loop/b.css": 50,
    };
    return {
      folder: "site",
      statFile: (path) => sizes[path] ?? null,
      isPublishedPage: () => false,
      pageRefused: () => null,
      publishedNoteUrl: () => null,
      maxBytes: 25 * 1024 * 1024,
      tooBigReason: () => null,
    };
  }

  const read = async (path: string) => SHEETS[path] ?? null;

  /**
   * Breadth first, and within one sheet its `url()` references come before
   * its `@import`s -- which is the order they are read in rather than a
   * rule about anything. It only decides the order files appear in the
   * report, so it is pinned here to notice a change rather than because
   * anything depends on it.
   */
  it("follows an @import chain to the end of it", async () => {
    const plan = await planStylesheetTree(
      [{ sourcePath: "site/app/index.css", url: "app/index.css" }],
      context(),
      read,
    );
    expect(plan.carry.map((companion) => companion.url)).toEqual([
      "app/fonts/inter.woff2",
      "app/theme.css",
      "pics/hero.png",
      "app/tokens.css",
    ]);
    expect(plan.broken).toEqual([]);
  });

  /**
   * The reason this is a worklist with a visited set rather than a walk: a
   * pair of sheets importing each other is legal, happens by accident, and
   * would otherwise not terminate.
   */
  it("terminates on a cycle, carrying each sheet once", async () => {
    const plan = await planStylesheetTree(
      [{ sourcePath: "site/loop/a.css", url: "loop/a.css" }],
      context(),
      read,
    );
    expect(plan.carry.map((companion) => companion.url)).toEqual(["loop/b.css"]);
  });

  it("returns only what is new, since the caller already has the rest", async () => {
    const plan = await planStylesheetTree(
      [
        { sourcePath: "site/app/index.css", url: "app/index.css" },
        { sourcePath: "site/app/theme.css", url: "app/theme.css" },
        { sourcePath: "site/app/tokens.css", url: "app/tokens.css" },
      ],
      context(),
      read,
    );
    expect(plan.carry.map((companion) => companion.url)).toEqual([
      "app/fonts/inter.woff2",
      "pics/hero.png",
    ]);
  });

  it("looks at stylesheets and leaves every other carried file alone", async () => {
    const seen: string[] = [];
    const plan = await planStylesheetTree(
      [
        { sourcePath: "site/app/index-abc.js", url: "app/index-abc.js" },
        { sourcePath: "site/app/fonts/inter.woff2", url: "app/fonts/inter.woff2" },
      ],
      context(),
      async (path) => {
        seen.push(path);
        return SHEETS[path] ?? null;
      },
    );
    expect(seen).toEqual([]);
    expect(plan.carry).toEqual([]);
  });

  /**
   * Reported by the pass that carries the file, not twice. A sheet that
   * cannot be read is already in `skipped` with the reason.
   */
  it("says nothing extra about a stylesheet it could not read", async () => {
    const plan = await planStylesheetTree(
      [{ sourcePath: "site/missing.css", url: "missing.css" }],
      context(),
      read,
    );
    expect(plan).toEqual({ carry: [], broken: [], refused: [] });
  });

  it("carries nothing when nothing was carried", async () => {
    const plan = await planStylesheetTree([], context(), read);
    expect(plan).toEqual({ carry: [], broken: [], refused: [] });
  });
});

describe("planHtmlFiles", () => {
  const files = (...paths: string[]) => paths.map((path) => ({ path }));

  it("mirrors each file to its own path", () => {
    const plan = planHtmlFiles(files("site/a.html", "site/demo/b.html"), "site", []);
    expect(plan.targets).toEqual([
      { sourcePath: "site/a.html", url: "a.html" },
      { sourcePath: "site/demo/b.html", url: "demo/b.html" },
    ]);
    expect(plan.collisions).toEqual([]);
  });

  /**
   * The silent overwrite this is here to prevent. A note at `site/about.md`
   * publishes to `about.html`, and so would a file at `site/about.html`.
   */
  it("gives a note's page the win, and reports the file", () => {
    const plan = planHtmlFiles(files("site/about.html"), "site", ["about.html"]);
    expect(plan.targets).toEqual([]);
    expect(plan.collisions).toHaveLength(1);
    expect(plan.collisions[0].path).toBe("site/about.html");
    expect(plan.collisions[0].reason).toMatch(/a note's page wins/);
  });

  // One file on most vaults' filesystems, two URLs on GitHub Pages. Not a
  // collision to resolve by being clever.
  it("treats a difference of case as a collision", () => {
    const plan = planHtmlFiles(files("site/About.html"), "site", ["about.html"]);
    expect(plan.targets).toEqual([]);
    expect(plan.collisions).toHaveLength(1);
  });

  it("reports the second of two html files that want one path", () => {
    const plan = planHtmlFiles(files("site/a.html", "site/A.html"), "site", []);
    expect(plan.targets.map((t) => t.sourcePath)).toEqual(["site/a.html"]);
    expect(plan.collisions.map((c) => c.path)).toEqual(["site/A.html"]);
  });

  it("refuses a file that would land on a path the build writes itself", () => {
    const plan = planHtmlFiles(files("site/assets/files/a.html"), "site", []);
    expect(plan.targets).toEqual([]);
    expect(plan.collisions[0].reason).toMatch(/the build writes itself/);
  });

  // And publishes one that merely sits in a folder of the same name, which
  // is where a built application's own code lives.
  it("publishes a page beside a built application's assets", () => {
    const plan = planHtmlFiles(files("site/assets/a.html"), "site", []);
    expect(plan.targets).toEqual([
      { sourcePath: "site/assets/a.html", url: "assets/a.html" },
    ]);
  });

  // Somebody who writes a front page by hand and calls it index.html has
  // said what they want the front page to be.
  it("lets a vault's own index.html claim the front page", () => {
    const plan = planHtmlFiles(files("site/index.html"), "site", ["notes/a.html"]);
    expect(plan.targets).toEqual([
      { sourcePath: "site/index.html", url: "index.html" },
    ]);
  });
});

/**
 * The label the file tree gives one of these pages.
 *
 * The filename alone is not enough and that is the whole reason this exists:
 * every built application in a vault is called `index.html`, so a tree of
 * them is a tree of rows called "index". The `<title>` is what the author
 * already decided the page is called.
 */
describe("pageTitle", () => {
  it("takes the page's own title", () => {
    expect(pageTitle("<html><head><title>AngularApp</title></head></html>", "app/index.html")).toBe(
      "AngularApp",
    );
  });

  it("collapses a title written over several lines", () => {
    const html = "<title>\n  Revenue\n  trend\n</title>";
    expect(pageTitle(html, "charts/trend.html")).toBe("Revenue trend");
  });

  it("decodes the entities a title carries", () => {
    expect(pageTitle("<title>Sales &amp; Ops &#8212; Q3</title>", "a.html")).toBe(
      "Sales & Ops — Q3",
    );
    expect(pageTitle("<title>Caf&#xe9;</title>", "a.html")).toBe("Café");
  });

  it("leaves an entity it does not know as written", () => {
    // Better a visible `&hellip;` in one row than a wrong character, and
    // better than carrying a full entity table for one line of text.
    expect(pageTitle("<title>Wait&hellip;</title>", "a.html")).toBe("Wait&hellip;");
  });

  it("leaves a code point that is not a character as written", () => {
    // A lone surrogate half: `fromCodePoint` throws on it, so the rule has
    // to refuse it rather than find out at build time.
    expect(pageTitle("<title>x&#xd800;</title>", "a.html")).toBe("x&#xd800;");
  });

  it("drops markup from inside the title", () => {
    expect(pageTitle("<title>Revenue <b>trend</b></title>", "a.html")).toBe("Revenue trend");
  });

  it("ignores a title inside a comment", () => {
    const html = "<!-- <title>Old name</title> --><title>New name</title>";
    expect(pageTitle(html, "a.html")).toBe("New name");
  });

  it("takes the first title when a page sets two", () => {
    expect(pageTitle("<title>First</title><title>Second</title>", "a.html")).toBe("First");
  });

  it("falls back to the filename without its extension", () => {
    expect(pageTitle("<html><body>no title</body></html>", "app/dist/index.html")).toBe("index");
    expect(pageTitle("<title>   </title>", "charts/trend.htm")).toBe("trend");
  });

  it("falls back for a page with no head at all", () => {
    // A stock `ng new` src/index.html has a title; a hand-written fragment
    // may not, and it is still published.
    expect(pageTitle("<app-root></app-root>", "my-app/src/index.html")).toBe("index");
  });
});
