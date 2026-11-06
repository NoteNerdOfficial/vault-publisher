import { App, TFile } from "obsidian";
import {
  DEFAULT_OUTPUT_FOLDERS,
  isBuildOutput,
  isDependencyPath,
  isHiddenPath,
} from "./outputFolders";
import { isExcluded, parseExcludeFolders } from "./excludeFolders";

/**
 * Publishing a vault's own HTML files, exactly as they are.
 *
 * Everything else in `publish/` takes a note, renders it the way Obsidian
 * would, and assembles a page around it: shell, rail, backlinks, our
 * stylesheet. That is the whole design, and it is the wrong thing to do to a
 * file that is already a page. An HTML file in a vault was written by
 * someone who had an opinion about its markup and its styling, and the only
 * useful thing a publisher can do with it is get out of the way.
 *
 * So these files take a different path through the build:
 *
 *   - **Byte-for-byte.** The file's text is published unchanged. Nothing is
 *     parsed, nothing is reserialized, no stylesheet of ours is linked into
 *     it. A round trip through `DOMParser` would be a round trip we would
 *     have to prove lossless on markup we did not write, for no benefit.
 *
 *     One exception, and only outside a publish: a *preview* build appends
 *     the review overlay, so a page that carries its own styling can still
 *     be commented on. It is appended rather than inserted and delimited by
 *     comments, the overlay stamps its own anchors in the browser rather
 *     than having them written into the file, and `publish()` never asks for
 *     it -- see `reviewOverlayAppendix` in `page.ts`. What goes to the site
 *     is still the author's file and nothing else.
 *   - **At its own path.** `site/demo/chart.html` publishes to
 *     `demo/chart.html` -- the same scope-relative path as a note, with the
 *     extension left alone. That is what makes the next point possible.
 *   - **With what it points at.** A page that carries its own styling
 *     usually carries it in a sibling file, so the files it references are
 *     copied to their mirrored paths as well. Because both ends of the
 *     reference move the same way, `href="styles.css"` and
 *     `href="../lib/chart.js"` keep working without a single character being
 *     rewritten.
 *
 * The references are found by scanning the text rather than by walking a
 * parsed tree, which is the one place this module looks lazier than it is.
 * We are not editing the file, so we do not need a tree -- we need the list
 * of things to carry alongside it, and over-matching that list is harmless:
 * a reference that resolves to no vault file is counted and the file it
 * sits in is published regardless. Under-matching is the failure that
 * matters, and a scan over the raw text cannot miss a reference because of
 * markup we failed to anticipate.
 */

/** `.html` and `.htm`, which are the same thing to every web server. */
const HTML_EXTENSION = /\.html?$/i;

/**
 * Extensions a referenced file is never published under this rule.
 *
 * Two different reasons, and both are the kind of thing that would be a leak
 * rather than a bug:
 *
 * `.md` is the one that matters. A Markdown file published as a companion
 * would reach the site as raw source, which means with its frontmatter on
 * it -- bypassing `stripFrontmatter`, the privacy scan, and the entire
 * reason selection exists. An `<a href="notes/salary.md">` in a hand-written
 * page must not be a way to publish `notes/salary.md`.
 *
 * `.html` is subtler. An HTML file is published when the *scope* matches it,
 * and copying one because another page linked to it would publish a file the
 * user excluded. A page in scope is already being published at the path the
 * link expects, so there is nothing to do for it here either way.
 *
 * `.canvas` and `.base` are Obsidian's own data files. They are JSON
 * describing a view of the vault, they can name notes that are not
 * published, and nothing reads them on a static site.
 */
const COMPANION_DENIED = /\.(?:md|html?|canvas|base)$/i;

/**
 * The files the build writes into `assets/`, by name.
 *
 * Named rather than described, because this list *is* the rule: anything the
 * build starts writing under `assets/` has to be added here or a vault file
 * can quietly land on top of it. The test beside this holds it to the two
 * script paths `page.ts` declares, so adding a third and forgetting this
 * fails rather than publishing over the site's own JavaScript.
 */
export const SITE_ASSET_FILES = [
  "assets/site.css",
  "assets/obsidian.css",
  "assets/site.js",
  "assets/overlay.js",
];

/** And the two subfolders it fills: note media, and the MathJax fonts. */
export const SITE_ASSET_FOLDERS = ["assets/files/", "assets/mathjax/"];

/**
 * Paths the build writes itself, which nothing from the vault may claim.
 *
 * A vault with a folder called `assets` at the top of its published scope
 * would otherwise mirror `assets/site.css` straight over ours -- two entries
 * for one path, with the winner decided by whichever loop ran last.
 * `.nojekyll` and `CNAME` are single files with the same problem and a worse
 * failure: losing either one breaks the whole site rather than one page.
 *
 * **What this refuses is those paths, not the folder they are in**, and the
 * difference is the difference between publishing a built application and
 * not. Every bundler on earth writes its output to `dist/assets/`, so a site
 * scoped at a `dist` folder mirrors the app's own `assets/` onto the site
 * root -- and a folder-wide rule refused the application's entire JavaScript
 * bundle, named `assets/index-C7x1a9.js`, which collides with nothing we
 * write. The page published, the code did not, and the report said so in a
 * line about stylesheets and fonts. Hashed bundle names cannot collide with
 * a fixed list; a file genuinely called `assets/site.css` still cannot
 * through.
 *
 * The site's generated pages are not here, because they do not need to be:
 * `sitePaths` already picks names around what is published, so a vault page
 * called `browse.html` moves the build's own listing to `all-notes.html`.
 */
export function reservedPathReason(url: string): string | null {
  const path = url.toLowerCase();
  if (path === ".nojekyll" || path === "cname") {
    return `${url} is a file the site itself needs, so it cannot be published from the vault`;
  }
  if (
    SITE_ASSET_FILES.indexOf(path) !== -1 ||
    SITE_ASSET_FOLDERS.some((folder) => path.startsWith(folder))
  ) {
    return (
      `${url} is a path the build writes itself -- the site's own stylesheets, ` +
      `scripts, fonts and note media live there -- so publish it under a ` +
      `different name`
    );
  }
  return null;
}

export interface HtmlFileTarget {
  /** Vault path, e.g. "site/demo/chart.html". */
  sourcePath: string;
  /** Published path, e.g. "demo/chart.html". */
  url: string;
}

/** A file carried because a published page referenced it. */
export interface CompanionRef {
  /** Vault path of the referenced file. */
  sourcePath: string;
  /** Published path, mirroring the vault path the same way its page does. */
  url: string;
}

/** What one page's references came to. */
export interface CompanionPlan {
  /** Files to carry beside the page. */
  carry: CompanionRef[];
  /**
   * References that will not resolve on the site, as "page -> ref (why)".
   *
   * The page publishes anyway. A broken reference is the author's to fix,
   * and refusing the page over one would replace a missing image with a
   * missing page.
   */
  broken: string[];
  /**
   * Files this will not carry, with why, to be reported once per file.
   *
   * Distinct from `broken` because the reference is sound and the file is
   * real -- it is this publisher declining to move it, which is a thing the
   * user can act on.
   */
  refused: { path: string; reason: string }[];
}

/** What `planCompanions` has to ask about the vault around a page. */
export interface CompanionContext {
  /** The published folder, as `SiteConfig.folder`. */
  folder: string | null;
  /** Size of a vault file in bytes, or null when the path is not a file. */
  statFile: (path: string) => number | null;
  /** Whether this path is an HTML file being published as-is. */
  isPublishedPage: (path: string) => boolean;
  /**
   * Why an HTML file in the vault is not being published, when it is not.
   *
   * A link to a page that lost a collision is the case this exists for. The
   * page is not published, so the generic "this will 404" is wrong -- the
   * path is occupied by whatever won it, and the link now opens that
   * instead. Saying which is the difference between a warning someone can
   * act on and one they have to investigate.
   */
  pageRefused: (path: string) => string | null;
  /** Where a note is published, or null when it is not a published note. */
  publishedNoteUrl: (path: string) => string | null;
  /** Ceiling for one file, as `SiteConfig.maxAssetBytes`. */
  maxBytes: number;
  /** Why a file this big is not published. Supplied, so the wording is
   * identical to the one attachments get. */
  tooBigReason: (size: number, limit: number) => string | null;
  /**
   * Where a carried file lands, when its vault path is not the answer.
   *
   * A folder published whole can be given a destination, and a page in one
   * moves with it. Its companions have to move with it too, or the page
   * arrives at the new address still asking for its script at the old one
   * -- which is a site that looks published and is blank.
   *
   * Optional, and absent for every site that names no destination, in
   * which case a companion keeps the mirrored vault path it always had.
   */
  urlForFile?: (path: string) => string;
}

/**
 * Everything one page points at, sorted into carry, broken and refused.
 *
 * The decision table of this whole feature, kept away from the build's I/O
 * so it can be read and tested as a table. Every branch here is a rule about
 * what a page is allowed to drag into a published site, and two of them are
 * the difference between a feature and a leak -- see `COMPANION_DENIED`.
 */
export function planCompanions(
  page: HtmlFileTarget,
  html: string,
  context: CompanionContext,
): CompanionPlan {
  const plan: CompanionPlan = { carry: [], broken: [], refused: [] };
  collectReferences(
    page,
    {
      local: findLocalReferences(html),
      rootAbsolute: findRootAbsoluteReferences(html),
    },
    context,
    plan,
  );
  return plan;
}

/**
 * The same table again, for a stylesheet that has already been carried.
 *
 * A page's references are read out of its markup, which is every file the
 * *page* asks for and no further. A stylesheet asks for files of its own --
 * `@font-face` points at a `.woff2`, `background-image` at a `.png`,
 * `@import` at another sheet -- and those references are inside the CSS,
 * where nothing scanning HTML will ever see them.
 *
 * What that cost is worth stating, because the failure is quiet. A built
 * application's stylesheet travelled, applied, and laid the page out
 * correctly; its webfont did not travel, so the text fell back to the
 * system font, and its background images did not, so they were simply
 * missing. Neither was reported, because a reference nothing reads cannot
 * be found unresolved.
 *
 * Resolved against the stylesheet's own vault path rather than the page's,
 * which is what a browser does: a `url()` in a sheet is relative to the
 * sheet. That is the whole reason this cannot be folded into the page's
 * scan by concatenating the text -- `../fonts/a.woff2` means two different
 * files depending on which file said it.
 */
export function planStylesheetCompanions(
  sheet: CompanionRef,
  css: string,
  context: CompanionContext,
): CompanionPlan {
  const plan: CompanionPlan = { carry: [], broken: [], refused: [] };
  collectReferences(sheet, findStylesheetReferences(css), context, plan);
  return plan;
}

/**
 * Every file the carried stylesheets ask for, following `@import`.
 *
 * A worklist rather than a recursion, because a sheet reached by `@import`
 * has imports of its own, and because two sheets importing each other is
 * legal CSS and would not terminate. `carried` seeds the visited set, so a
 * file already travelling is never queued twice and a cycle costs one pass
 * over each sheet in it. There is no depth limit for the same reason: the
 * visited set is the bound.
 *
 * `carry` holds only what is *new* -- the caller already has the files it
 * passed in -- so the result can be merged without checking for duplicates.
 *
 * `readStylesheet` returns null for a file that cannot be read, which is
 * not reported here: the pass that carries a file is the one that reports
 * failing to read it, and a second entry about the same file would say the
 * same thing twice.
 */
export async function planStylesheetTree(
  carried: readonly CompanionRef[],
  context: CompanionContext,
  readStylesheet: (path: string) => Promise<string | null>,
): Promise<CompanionPlan> {
  const plan: CompanionPlan = { carry: [], broken: [], refused: [] };
  const known = new Set(carried.map((companion) => companion.sourcePath));
  const queue = carried.filter((companion) =>
    isStylesheet(companion.sourcePath),
  );

  while (queue.length) {
    const sheet = queue.shift();
    if (!sheet) break;

    const css = await readStylesheet(sheet.sourcePath);
    if (css === null) continue;

    const nested = planStylesheetCompanions(sheet, css, context);
    plan.broken.push(...nested.broken);
    plan.refused.push(...nested.refused);
    for (const companion of nested.carry) {
      if (known.has(companion.sourcePath)) continue;
      known.add(companion.sourcePath);
      plan.carry.push(companion);
      if (isStylesheet(companion.sourcePath)) queue.push(companion);
    }
  }

  return plan;
}

/** What one file points at, split by whether a vault path could hold it. */
export interface FoundReferences {
  /** Relative references, which may name a vault file. */
  local: string[];
  /** References resolved from the root of the server, which cannot. */
  rootAbsolute: string[];
}

/**
 * Everything one referrer points at, sorted into the plan.
 *
 * `referrer` is whatever said so -- a page or a stylesheet -- and is used
 * for two things: resolving its relative references, and naming it in a
 * report, so "`assets/index.css` -> `./inter.woff2` (no such file)" says
 * which file to go and look at.
 */
function collectReferences(
  referrer: { sourcePath: string; url: string },
  references: FoundReferences,
  context: CompanionContext,
  plan: CompanionPlan,
): void {
  const page = referrer;
  const seen = new Set<string>();

  const note = (reference: string, why: string) =>
    plan.broken.push(`${page.url} -> ${reference} (${why})`);

  /*
   * Named from the root of the server, so there is no vault file to carry
   * and nothing to rewrite -- but the page will go out asking for it, and a
   * reader will get nothing. Reported here rather than dropped, which is
   * what used to happen: a stock bundler build published its HTML, none of
   * its code, and a report that mentioned neither.
   */
  for (const reference of references.rootAbsolute) {
    note(
      reference,
      "resolved from the root of the server, where a site published into a " +
        "folder has nothing -- build with a relative base",
    );
  }

  for (const reference of references.local) {
    const broken = (why: string) => note(reference, why);

    // A folder, which a static host answers with its index. Nothing to
    // carry, and nothing wrong.
    if (isDirectoryReference(reference)) continue;

    const path = companionVaultPath(page.sourcePath, reference);
    if (!path) {
      broken("does not resolve to a path inside the vault");
      continue;
    }

    // Another page going out as-is. Both files mirror the same way, so the
    // reference is already true: nothing to carry, nothing to report.
    if (context.isPublishedPage(path)) continue;

    if (!mayCarryCompanion(path)) {
      const noteUrl = context.publishedNoteUrl(path);
      if (noteUrl) {
        broken(`that note is published at ${noteUrl} -- point the link there`);
      } else if (/\.md$/i.test(path)) {
        broken("a note is published as its .html page, not as Markdown");
      } else if (HTML_EXTENSION.test(path)) {
        broken(context.pageRefused(path) ?? "that page is not published");
      } else {
        broken("not a file this publishes beside a page");
      }
      continue;
    }

    const size = context.statFile(path);
    if (size === null) {
      broken("no such file in the vault");
      continue;
    }

    // Everything past here is about one file rather than one reference, so
    // it is decided once however many pages point at it.
    if (seen.has(path)) continue;
    seen.add(path);

    if (!withinScope(path, context.folder)) {
      plan.refused.push({
        path,
        reason:
          `referenced by ${page.url} but outside the published folder, so it ` +
          `has no path inside the site -- move it in, or point the page at a ` +
          `copy that is`,
      });
      continue;
    }

    const url = context.urlForFile?.(path) ?? urlForVaultFile(path, context.folder);
    const reserved = reservedPathReason(url);
    if (reserved) {
      plan.refused.push({
        path,
        reason: `referenced by ${page.url}: ${reserved}`,
      });
      continue;
    }

    const tooBig = context.tooBigReason(size, context.maxBytes);
    if (tooBig) {
      plan.refused.push({ path, reason: tooBig });
      continue;
    }

    plan.carry.push({ sourcePath: path, url });
  }
}

export interface HtmlFileStats {
  /** Pages published as-is. */
  published: number;
  /** Files carried because a page referenced them. */
  companions: number;
  /** Total bytes of those companions. */
  companionBytes: number;
  /**
   * References that resolved to no vault file, as "page -> reference".
   *
   * Reported rather than repaired. The file is published either way, because
   * a broken reference is the author's to fix and refusing the page over one
   * would be worse than the broken image it causes.
   */
  unresolved: string[];
  /**
   * Pages holding an `app://` URL, which is Obsidian's own resource scheme.
   *
   * Worth saying out loud, because such a URL contains the absolute path of
   * the vault -- so the author's home directory, so their account name --
   * and it works in the app and nowhere else. The note pipeline strips these
   * (see `disarm` in `assets.ts`); this one cannot, because this file is
   * published as written. So it is reported instead, and loudly.
   */
  localResourceUrls: string[];
  /**
   * Pages that are an application's shell with none of its code, with the
   * root element each one would have mounted into.
   *
   * The one blank page this report could not account for: everything about
   * publishing the file worked, and the file was never going to run. See
   * `appShellWithoutCode`.
   */
  appShells: string[];
  /**
   * Pages whose `<base href>` will not resolve their own files, with why.
   *
   * Page-level rather than per-reference, because that is what it is: one
   * attribute that moves every other reference on the page at once.
   */
  baseHrefs: string[];
  /**
   * Every page published as-is, as "vault/path.html -> published/url.html".
   *
   * A count was not enough, and the list outlived the reason it was added.
   * These pages used to be absent from the navigation entirely, so from the
   * built site a page that published correctly and a page that was never
   * published looked exactly alike: someone looked for an HTML file in the
   * file tree, did not find it, and had no way to tell which had happened.
   *
   * They are in the tree now -- see `asIs` on `NavNote` -- which is the
   * better answer to that, and the list stays regardless. It says where each
   * page landed, which the tree does not, and it is the only place the
   * mapping from vault path to published URL is written down.
   */
  publishedPages: string[];
}

export function emptyHtmlFileStats(): HtmlFileStats {
  return {
    published: 0,
    companions: 0,
    companionBytes: 0,
    unresolved: [],
    localResourceUrls: [],
    appShells: [],
    baseHrefs: [],
    publishedPages: [],
  };
}

export function isHtmlFilePath(path: string): boolean {
  return HTML_EXTENSION.test(path);
}

/**
 * Where a vault file lands in the site, keeping its name and its extension.
 *
 * The same rule `urlForNote` uses, minus the extension swap: the path
 * relative to the published folder. Keeping the structure is not tidiness
 * here, it is the mechanism -- a page and the stylesheet beside it stay
 * beside each other, so the reference between them is still true.
 */
export function urlForVaultFile(
  sourcePath: string,
  folder: string | null,
): string {
  return folder && sourcePath.startsWith(`${folder}/`)
    ? sourcePath.slice(folder.length + 1)
    : sourcePath;
}

/**
 * Whether a file is inside what is being published.
 *
 * A companion outside the scope has no honest published path: mirroring it
 * would put it outside the site root, and putting it inside the root would
 * break the very relative reference we are trying to preserve. So it is
 * refused and reported rather than published somewhere that cannot work.
 */
export function withinScope(path: string, folder: string | null): boolean {
  if (!folder) return true;
  return path.startsWith(`${folder}/`);
}

/**
 * The HTML files the scope matches.
 *
 * `getFiles()` rather than `getMarkdownFiles()`, which is the first time
 * anything in this plugin has looked at the rest of the vault, so the
 * filtering is deliberately conservative: the scope folder, the build's own
 * output folders, nothing hidden, and nothing installed by a package
 * manager.
 *
 * **A frontmatter flag excludes every one of them.** An HTML file has no
 * frontmatter to carry the flag, so there is no way for it to opt in, and
 * publishing it anyway would mean the user's gate applied to notes and not
 * to pages. The caller reports the count -- a toggle that silently does
 * nothing is its own kind of bug.
 */
export function selectHtmlFiles(
  app: App,
  config: {
    folder: string | null;
    requireFrontmatterFlag: string | null;
    publishHtmlFiles?: boolean;
    outputFolders?: string[];
    excludeFolders?: string[];
  },
): TFile[] {
  if (!config.publishHtmlFiles) return [];
  if (config.requireFrontmatterFlag) return [];

  const excluded = config.outputFolders ?? DEFAULT_OUTPUT_FOLDERS;
  const leftOut = parseExcludeFolders(config.excludeFolders);

  return app.vault
    .getFiles()
    .filter((file) => {
      if (!isHtmlFilePath(file.path)) return false;
      if (config.folder && !file.path.startsWith(`${config.folder}/`))
        return false;
      // The author's own list. A folder kept out of the site is kept out
      // whatever is in it: a page published as-is is as public as a note.
      if (isExcluded(file.path, leftOut)) return false;
      if (isBuildOutput(file.path, excluded, config.folder)) return false;
      // `.obsidian/plugins/**` alone holds a great deal of HTML that is
      // nobody's web page. Shared with note selection, which needed the same
      // rule and did not have it.
      if (isHiddenPath(file.path, config.folder)) return false;
      // A prototype's `node_modules` is the worst case this selector has:
      // every package's demo page, coverage report and test fixture, each
      // one read, scanned and published. See `isDependencyPath`.
      if (isDependencyPath(file.path, config.folder)) return false;
      return true;
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * How many HTML files the scope would have matched but for the flag.
 *
 * Counted separately from selection so the caller can say why a toggle that
 * is on published nothing, which is the one thing the user cannot work out
 * from the result.
 */
/**
 * How many HTML files the scope holds while the toggle is off.
 *
 * The mirror of the function below, for the other configuration that
 * publishes nothing: `selectHtmlFiles` returns an empty list the moment
 * `publishHtmlFiles` is false, so a vault full of pages and a vault with
 * none are the same answer. The report says which, because "my HTML file is
 * not on the site" has two causes and only one of them is a setting.
 */
export function countHtmlFilesAvailable(
  app: App,
  config: {
    folder: string | null;
    requireFrontmatterFlag: string | null;
    publishHtmlFiles?: boolean;
    outputFolders?: string[];
    excludeFolders?: string[];
  },
): number {
  if (config.publishHtmlFiles) return 0;
  return selectHtmlFiles(app, {
    ...config,
    publishHtmlFiles: true,
    requireFrontmatterFlag: null,
  }).length;
}

export function countHtmlFilesBlockedByFlag(
  app: App,
  config: {
    folder: string | null;
    requireFrontmatterFlag: string | null;
    publishHtmlFiles?: boolean;
    outputFolders?: string[];
    excludeFolders?: string[];
  },
): number {
  if (!config.publishHtmlFiles || !config.requireFrontmatterFlag) return 0;
  return selectHtmlFiles(app, { ...config, requireFrontmatterFlag: null })
    .length;
}

/* --- what a page points at -------------------------------------------- */

/**
 * Attribute values that can name a file: `src`, `href`, `poster` and the
 * `data` of an `<object>`.
 *
 * Unquoted values are matched too, because hand-written HTML has them and a
 * reference we do not see is a file that does not travel.
 */
const ATTRIBUTE_REFERENCE =
  /\b(?:src|href|poster|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>=`]+))/gi;

/** `srcset`, whose value is a comma-separated list of candidates. */
const SRCSET = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/**
 * `url(...)` anywhere in the text.
 *
 * One pattern covers both places CSS can live in a self-contained page: a
 * `<style>` block and a `style` attribute. Neither is reachable by scanning
 * attributes alone, and a page that carries its own styling is precisely the
 * page whose fonts and background images are referenced this way.
 */
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi;

/**
 * `@import "sheet.css"`, the quoted form.
 *
 * The `@import url("sheet.css")` form needs nothing: `CSS_URL` already has
 * it. Only the bare-string form is invisible to that pattern, and both are
 * legal, so both have to be read.
 *
 * Whatever follows the string -- `layer(base)`, a media query,
 * `supports(...)` -- is a condition on when the sheet applies rather than
 * part of its path, and is left where it is.
 */
const CSS_IMPORT = /@import\s+(?:"([^"]*)"|'([^']*)')/gi;

/**
 * A CSS comment, removed before a stylesheet is scanned.
 *
 * A commented-out `background-image` is a file the author decided not to
 * use. Carrying it would be harmless; reporting it as a broken reference
 * when the file has since been deleted would not, because the page is
 * correct and the report would say otherwise.
 */
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;

/** `app://`, Obsidian's resource scheme, which embeds the vault's own path. */
const APP_URL = /app:\/\//i;

/** Any `<base>` tag, removed before the reference scan. */
const BASE_TAG = /<base\b[^>]*>/gi;

/** The `href` of the first `<base>` tag, which is the only one that counts. */
const BASE_HREF =
  /<base\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>=`]+))/i;

/**
 * The page's `<base href>`, or null when it sets none.
 *
 * Worth reading on its own because it is the one reference that decides
 * every other one. A page whose scripts are all named relatively, and whose
 * files therefore all travel, is still blank if its base points somewhere
 * else -- and the two cases are indistinguishable in what gets published,
 * which is how an Angular build with the default base came to produce output
 * byte-identical to a working one.
 */
export function baseHref(html: string): string | null {
  const match = BASE_HREF.exec(html.replace(/<!--[\s\S]*?-->/g, " "));
  if (!match) return null;
  return (match[1] ?? match[2] ?? match[3] ?? "").trim();
}

/**
 * Why a `<base href>` will not work on a published site, or null if it will.
 *
 * `./` and `.` resolve against the page's own folder, which is where its
 * files are, so those are the sound answers. Everything else is reported
 * rather than refused: `/` is right for a site served from the root of a
 * domain and wrong for one served from a folder, and this cannot tell which
 * is being published -- only that the author should look.
 */
export function baseHrefHazard(value: string | null): string | null {
  if (value === null) return null;
  const base = value.trim();
  if (base === "./" || base === "." || base === "") return null;
  if (isRootAbsolute(base)) {
    return (
      `base href="${base}" resolves every reference from the root of the ` +
      `server, so the page's own files are only found when the site is ` +
      `served from there -- build with a base of "./" to publish into a folder`
    );
  }
  return (
    `base href="${base}" resolves every reference somewhere other than ` +
    `beside the page -- build with a base of "./" unless that is meant`
  );
}

/** The first `<title>`, which is the only one a browser honours. */
const TITLE_TAG = /<title\b[^>]*>([\s\S]*?)<\/title>/i;

/**
 * The named entities a page title realistically carries.
 *
 * Not a general entity table, and deliberately not: a title is one short
 * line of text, the five XML names plus a non-breaking space cover what
 * anybody writes in one, and numeric escapes are handled by rule below. An
 * entity this does not know is left as it was found, which renders as the
 * literal `&hellip;` rather than as a wrong character.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * A page's own name for itself, for the row the vault panel gives it.
 *
 * The tree needs a label, and the file has one: its `<title>` is what the
 * author already decided this page is called, and it is what a browser tab
 * and a search engine will say. Falling straight back to the filename would
 * fill the tree with rows called "index" -- true of every built application
 * in a vault, and useless for telling them apart.
 *
 * Read with a regex rather than a parse, like every other scan in this
 * module: we are not editing the file, so there is no tree to need. A title
 * holding markup is markup the title does not want, so tags inside it are
 * dropped and the whitespace collapsed -- a `<title>` written across three
 * indented lines is one line of text to a browser, and has to be one here
 * too or the row carries the author's indentation.
 *
 * The result is plain text, so it is escaped on the way into the markup like
 * any other title. Decoding here and escaping there is not a round trip
 * through nothing: without the decode a title written `Sales &amp; Ops`
 * would reach the page as `Sales &amp;amp; Ops`.
 */
export function pageTitle(html: string, sourcePath: string): string {
  const match = TITLE_TAG.exec(html.replace(/<!--[\s\S]*?-->/g, " "));
  const text = (match?.[1] ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const title = text ? decodeEntities(text) : "";
  if (title) return title;

  // No title, or an empty one. The filename is what Obsidian's own explorer
  // would show for the file, which is the least surprising fallback.
  const name = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
  return name.replace(HTML_EXTENSION, "") || name;
}

/** Entity references in a page title, resolved to the text they stand for. */
function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, body: string) => {
      const named = NAMED_ENTITIES[body.toLowerCase()];
      if (named) return named;
      if (!body.startsWith("#")) return whole;

      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(
        hex ? body.slice(2) : body.slice(1),
        hex ? 16 : 10,
      );
      // A code point outside Unicode, or a surrogate half, is not a character
      // `fromCodePoint` will give back -- it throws. Left as written.
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return whole;
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      return String.fromCodePoint(code);
    },
  );
}

/**
 * Whether a reference names a folder rather than a file.
 *
 * A static host answers `charts/` with `charts/index.html`, so there is
 * nothing to carry and nothing broken. Before this, such a reference was
 * resolved as a path, found to be a folder rather than a file, and reported
 * as missing -- a broken reference on a page that was working.
 */
export function isDirectoryReference(value: string): boolean {
  const [withoutFragment] = value.split("#");
  const [raw] = withoutFragment.split("?");
  if (!raw) return true;
  return raw.endsWith("/") || raw === "." || raw === "..";
}

/**
 * An application's root element, where a page has one.
 *
 * These are the handful of names the frameworks mount into, and they are
 * worth recognising for one reason: a page that has one and no code at all
 * is a source file rather than a site. See `appShellWithoutCode`.
 */
const APP_ROOTS: { pattern: RegExp; name: string }[] = [
  { pattern: /<app-root[\s>]/i, name: "<app-root>" },
  { pattern: /<router-outlet[\s>]/i, name: "<router-outlet>" },
  // `\sid=` rather than `id=`, so `data-id="app"` is not read as `id="app"`.
  { pattern: /<div[^>]*\sid=["']?root["'\s>]/i, name: `<div id="root">` },
  { pattern: /<div[^>]*\sid=["']?app["'\s>]/i, name: `<div id="app">` },
  { pattern: /<div[^>]*\sid=["']?__next["'\s>]/i, name: `<div id="__next">` },
  { pattern: /<div[^>]*\sid=["']?__nuxt["'\s>]/i, name: `<div id="__nuxt">` },
];

/**
 * The element an application would have mounted into, on a page that
 * carries no code to mount anything -- or null, which is every other page.
 *
 * This exists because of the one failure in this whole feature that the
 * report could not explain. Somebody opened the `index.html` of an Angular
 * project on the published site and got a blank page. Everything had worked:
 * the file was selected, published byte for byte, and its one reference --
 * `favicon.ico` -- was carried. There was nothing to warn about, because the
 * page makes no reference that could be broken. The problem is what the page
 * *does not* contain. A framework's `src/index.html` is an empty shell;
 * `main.ts` is named in `angular.json` or `vite.config`, never in the HTML,
 * so this publisher cannot see it and would not know what to do with it if
 * it could -- nothing here compiles anything, by design.
 *
 * So the signal is the absence: a root element with no `<script>` anywhere
 * in the document. Both halves are needed and the second is what keeps this
 * quiet. A hand-written page with no JavaScript is exactly what as-is
 * publishing is *for*, and warning about those would be noise on the
 * feature's main case; a built application always carries a script tag, so
 * it never trips this either. What is left is the file nobody could have
 * published successfully.
 */
export function appShellWithoutCode(html: string): string | null {
  if (/<script[\s>]/i.test(html)) return null;
  for (const root of APP_ROOTS) {
    if (root.pattern.test(html)) return root.name;
  }
  return null;
}

/** True when a page's text holds an `app://` URL. */
export function hasLocalResourceUrl(html: string): boolean {
  return APP_URL.test(html);
}

/**
 * Every reference in the text that could name a file beside the page.
 *
 * Absolute URLs, protocol-relative URLs, `data:` URIs, root-absolute paths
 * and bare fragments are all dropped here: none of them names a file in the
 * vault, and each one is the author pointing somewhere deliberately. What
 * comes back is relative references, deduplicated, in the order found.
 */
export function findLocalReferences(html: string): string[] {
  return everyReference(html).filter(isLocalReference);
}

/**
 * References the page makes from the root of the server.
 *
 * Collected separately because they are the commonest reason a published
 * application is a blank page, and because dropping them quietly is how that
 * blank page came to have no explanation. Every bundler writes them by
 * default -- Vite's `base` and Angular's `baseHref` are both `/` until
 * somebody changes them -- and `/assets/index-a1b2.js` resolves to the root
 * of the domain, which a site published into a folder is not.
 *
 * They cannot be carried: there is no vault file at a server path. So they
 * are reported, which is all that was ever needed and is what the comment on
 * `isLocalReference` used to claim happened.
 */
export function findRootAbsoluteReferences(html: string): string[] {
  return everyReference(html).filter(isRootAbsolute);
}

/**
 * Every file a stylesheet asks for, split the same way a page's are.
 *
 * Only the two things CSS can name a file with: `url(...)`, which covers
 * fonts, images, masks, cursors and the `url()` form of `@import`; and a
 * quoted `@import`. Deliberately not a CSS parser -- a reference that is
 * only reachable by understanding the cascade is not one a browser resolves
 * either, because a browser resolves the same two spellings.
 */
export function findStylesheetReferences(css: string): FoundReferences {
  const text = css.replace(CSS_COMMENT, " ");
  const found = new Set<string>();

  const take = (raw: string | undefined) => {
    const value = (raw ?? "").trim();
    if (value) found.add(value);
  };

  for (const match of text.matchAll(CSS_URL)) {
    take(match[1] ?? match[2] ?? match[3]);
  }
  for (const match of text.matchAll(CSS_IMPORT)) {
    take(match[1] ?? match[2]);
  }

  const references = Array.from(found);
  return {
    local: references.filter(isLocalReference),
    rootAbsolute: references.filter(isRootAbsolute),
  };
}

/**
 * Whether a carried file is a stylesheet, and so has references of its own.
 *
 * By extension, because that is what the reference said and there is no
 * file content to go on at the point this is asked. A bundler writes `.css`
 * and so does everything else.
 */
export function isStylesheet(path: string): boolean {
  return /\.css$/i.test(path);
}

/** Whether a reference is resolved from the root of the server. */
export function isRootAbsolute(value: string): boolean {
  // `//host/path` is protocol-relative, which is a different thing: it names
  // another server rather than the root of this one.
  return value.startsWith("/") && !value.startsWith("//");
}

/**
 * Every reference in the text, deduplicated, in the order found.
 *
 * `<base>` is removed before the scan rather than filtered afterwards. Its
 * `href` is not a file the page wants -- it is the rule for resolving every
 * other reference -- and treating it as one made the build report a page
 * whose base was the sound `./` as having a broken reference to `./`. It is
 * read separately, by `baseHref`.
 */
function everyReference(html: string): string[] {
  const text = html.replace(BASE_TAG, " ");
  const found = new Set<string>();

  const take = (raw: string | undefined) => {
    const value = (raw ?? "").trim();
    if (value) found.add(value);
  };

  for (const match of text.matchAll(ATTRIBUTE_REFERENCE)) {
    take(match[1] ?? match[2] ?? match[3]);
  }

  for (const match of text.matchAll(CSS_URL)) {
    take(match[1] ?? match[2] ?? match[3]);
  }

  for (const match of text.matchAll(SRCSET)) {
    const value = match[1] ?? match[2] ?? "";
    for (const candidate of value.split(",")) {
      // "pic.png 2x" -- the descriptor is not part of the path.
      take(candidate.trim().split(/\s+/)[0]);
    }
  }

  return Array.from(found);
}

/** Whether a reference could name a file in the vault at all. */
export function isLocalReference(value: string): boolean {
  if (!value) return false;
  if (value.startsWith("#")) return false;
  // A scheme of any kind, `//cdn...`, and a root-absolute path. The last one
  // is not resolvable to a vault file, and on a project site it does not
  // resolve to anything on the server either -- reported by its absence
  // rather than guessed at.
  if (value.startsWith("//")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  if (value.startsWith("/")) return false;
  return true;
}

/**
 * The vault path a reference points at, or null if it does not point at one.
 *
 * Resolved against the page's own folder, with `.` and `..` applied, because
 * that is what a browser will do with the same string once both files are
 * published. A reference that climbs above the vault root is null: there is
 * no file there to carry, and a `..` that escapes is the author's mistake
 * rather than ours to interpret.
 */
export function companionVaultPath(
  htmlPath: string,
  reference: string,
): string | null {
  const [withoutFragment] = reference.split("#");
  const [raw] = withoutFragment.split("?");
  if (!raw) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // A reference that is not valid percent-encoding is not a path we can
    // look up. Left alone in the file and reported unresolved.
    return null;
  }

  const base = htmlPath.split("/").slice(0, -1);
  const segments: string[] = [...base];

  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  const path = segments.join("/");
  return path || null;
}

/** Whether a referenced file may be carried beside the page. */
export function mayCarryCompanion(path: string): boolean {
  return !COMPANION_DENIED.test(path);
}

/**
 * Which published paths an HTML file may not claim.
 *
 * A note's page wins every collision. Markdown is what this plugin is for,
 * the note was already rendered by the time we get here, and an HTML file
 * quietly overwriting a note's page is the same silent overwrite the
 * homepage logic in `buildSite` exists to prevent -- discovered there as a
 * vault whose `index.md` was replaced by the generated index.
 *
 * Compared case-insensitively. GitHub Pages serves case-sensitively, so
 * `Page.html` and `page.html` are two URLs there, but they are one file on
 * the two filesystems most vaults live on -- and a collision that depends on
 * which machine built the site is not one to resolve by being clever.
 */
export function planHtmlFiles(
  files: Array<{ path: string }>,
  folder: string | null,
  takenUrls: Iterable<string>,
  /**
   * Where a page lands when its vault path is not the answer.
   *
   * A folder published whole can be given a destination, and its pages
   * have to go to the same place its other files do. Supplied rather than
   * worked out here, so this stays the one place that decides which page
   * wins a URL and is not also a place that knows about that setting.
   */
  urlOverrides?: ReadonlyMap<string, string>,
): {
  targets: HtmlFileTarget[];
  collisions: { path: string; reason: string }[];
} {
  const taken = new Map<string, string>();
  for (const url of takenUrls) taken.set(url.toLowerCase(), url);

  const targets: HtmlFileTarget[] = [];
  const collisions: { path: string; reason: string }[] = [];

  for (const file of files) {
    const url =
      urlOverrides?.get(file.path) ?? urlForVaultFile(file.path, folder);
    const key = url.toLowerCase();
    const claimed = taken.get(key);

    const reserved = reservedPathReason(url);
    if (reserved) {
      collisions.push({ path: file.path, reason: reserved });
      continue;
    }

    if (claimed !== undefined) {
      collisions.push({
        path: file.path,
        reason:
          `would publish to ${url}, which ${claimed} already occupies -- ` +
          `a note's page wins, so the HTML file is not published`,
      });
      continue;
    }

    taken.set(key, url);
    targets.push({ sourcePath: file.path, url });
  }

  return { targets, collisions };
}
