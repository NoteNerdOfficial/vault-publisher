/**
 * Folders published whole: every file in them, not only the referenced ones.
 *
 * Everything else this plugin publishes travels because something asked for
 * it. A note is selected, its attachments come because the note embeds them,
 * an as-is page comes because the scope matched it, and the files beside that
 * page come because its markup -- or, since stylesheets are followed too, its
 * CSS -- names them. That rule is a good one: it is what keeps a vault's
 * private attachments out of a site, and it is cheap, because a reference is
 * a thing a build can read.
 *
 * **It cannot describe a built application.** A bundler splits code, and a
 * split chunk is named nowhere a build can read it: not in the HTML, not in
 * the CSS, but inside a string in the minified JavaScript, reached by a
 * dynamic `import()` when a route is visited. Measured on a stock Vite build
 * and a stock Angular build, each with one lazily loaded route, the chunk is
 * the only file in `dist` that nothing references -- and leaving it behind is
 * not a missing route. In React it is a dynamic import that rejects with no
 * error boundary above it, which unmounts the application: one click, and
 * the whole page goes blank. Angular keeps its shell and the route simply
 * never arrives.
 *
 * Reading minified JavaScript for module specifiers is not the answer: a
 * regular expression over a bundle cannot tell a chunk name from any other
 * string, and being wrong in either direction is worse than not looking --
 * a missed chunk is the blank page again, and a false one is a build
 * reporting broken references that do not exist.
 *
 * So this is the other answer. A folder named here is published entire, and
 * whether anything references a file in it stops being a question. That is
 * what "publish this `dist` folder as a site" has always meant, and saying
 * it outright costs nothing, because the author has named the folder.
 *
 * **What this does not relax.** Only discovery changes. Every refusal that
 * applies to a referenced file applies here too, for the same reasons:
 *
 *   - **Excluded folders still win.** That setting is how a private subfolder
 *     is kept out, and a mode that could override it would make it a setting
 *     whose meaning depended on another setting.
 *   - **Hidden paths are still skipped**, so a `.env` beside a build and the
 *     whole of `.git` stay where they are.
 *   - **Installed dependencies are still skipped**, which matters more here
 *     than anywhere: an entry naming a project root rather than its `dist`
 *     would otherwise publish `node_modules` deliberately.
 *   - **The size ceiling still applies**, per file, with the same wording an
 *     attachment gets.
 *   - **`.md` is still never published as source.** A Markdown file reaching
 *     a site raw would carry its frontmatter and bypass the privacy scan,
 *     which is the one leak this plugin has always guarded hardest. A note in
 *     a whole folder is published the way every note is -- rendered, if the
 *     scope selected it.
 *   - **`.canvas` and `.base` are skipped**, as Obsidian's own data files:
 *     JSON describing a view of the vault, able to name notes that are not
 *     published, and read by nothing on a static site.
 *
 * Each skip is reported with the file and the reason, because a folder
 * published *whole* that quietly left something out would be the worst of
 * both arrangements.
 *
 * **HTML in one of these folders is published even with the as-is toggle
 * off.** That toggle is off by default to stop a vault full of incidental
 * HTML -- saved articles, a plugin's bundled help -- from going out on the
 * next build, which is a rule about folders nobody mentioned. An entry here
 * is somebody naming a path, which is the same exemption the output, hidden
 * and dependency rules each make for a scope aimed inside them. A folder
 * published whole without its pages would not be a folder published whole.
 */

import { isExcluded } from "./excludeFolders";
import { isBuildOutput, isDependencyPath, isHiddenPath } from "./outputFolders";
import { isHtmlFilePath, reservedPathReason, urlForVaultFile, withinScope } from "./htmlFiles";

/**
 * Extensions that are not published as source, whatever folder they are in.
 *
 * The same list `htmlFiles.ts` keeps for a referenced file, minus `.html`:
 * an HTML file here is published, as a page, which is the point of the
 * setting. The reasons for the other three are in `COMPANION_DENIED`, and
 * they do not change because the file was discovered differently.
 */
const NOT_PUBLISHED_AS_SOURCE = /\.(?:md|canvas|base)$/i;

/** What one entry came to, for the report. */
export interface WholeFolderTally {
  /** The entry as the author wrote it. */
  entry: string;
  /** Files it published. Zero means a path that matched nothing. */
  count: number;
  /** Their total size, which is the thing worth knowing before a push. */
  bytes: number;
}

/** One file to publish, and where it lands. */
export interface WholeFolderFile {
  sourcePath: string;
  url: string;
}

/** What a vault's whole folders came to. */
export interface WholeFolderPlan {
  /** Files to publish byte for byte, excluding the HTML pages. */
  carry: WholeFolderFile[];
  /**
   * HTML files in these folders, which publish as pages.
   *
   * Handed back separately rather than carried, because an as-is page is
   * not a copied file: it is scanned for references, it may take the
   * review overlay in a preview, and it claims a url that a note's page
   * wins a collision over. All of that lives in the as-is path already.
   */
  pages: string[];
  /** What was left out, with why, to be reported file by file. */
  skipped: { path: string; reason: string }[];
  /** Per entry, so a path that matched nothing can be named. */
  tallies: WholeFolderTally[];
}

/** What `planWholeFolders` has to be told about the build around it. */
export interface WholeFolderContext {
  /** The entries, parsed -- `parseExcludeFolders` reads this list too. */
  entries: readonly string[];
  /** The published folder, as `SiteConfig.folder`. */
  folder: string | null;
  /** Excluded folders, already parsed. */
  excluded: readonly string[];
  /** This build's own output folders. */
  outputFolders: readonly string[];
  /** Ceiling for one file, as `SiteConfig.maxAssetBytes`. */
  maxBytes: number;
  /** Why a file this big is not published, worded as an attachment's is. */
  tooBigReason: (size: number, limit: number) => string | null;
  /**
   * What already claims a published url, or null when it is free.
   *
   * A note's page and an as-is page are both decided before this runs, and
   * a file that landed on top of one would replace a page with a download.
   */
  claimedBy: (url: string) => string | null;
}

/** Whether a path sits in one of the folders published whole. */
export function isInWholeFolder(path: string, entries: readonly string[]): boolean {
  return entryFor(path, entries) !== null;
}

/**
 * The entry that covers a path, or null.
 *
 * Compared case-insensitively, exactly as the exclude list is and for the
 * same reason: `Proto/dist` and `proto/dist` are one folder on the two
 * filesystems most vaults sit on, and a setting that worked or did not
 * depending on which key was pressed would be worse than no setting.
 */
export function entryFor(path: string, entries: readonly string[]): string | null {
  const target = normalize(path);
  for (const entry of entries) {
    const clean = normalize(entry);
    if (!clean) continue;
    if (target === clean || target.startsWith(`${clean}/`)) return entry;
  }
  return null;
}

function normalize(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
}

/**
 * Every file in the named folders, sorted into published, pages and skipped.
 *
 * `files` is the whole vault rather than the scope: an entry pointing
 * outside the published folder has no honest url, and saying so needs the
 * file to have been seen. The order of the checks is the order of the
 * reasons -- the cheapest and most absolute first -- so a file refused for
 * two reasons is reported with the one that would still refuse it if the
 * other were fixed.
 */
export function planWholeFolders(
  files: readonly { path: string; size: number }[],
  context: WholeFolderContext,
): WholeFolderPlan {
  const plan: WholeFolderPlan = { carry: [], pages: [], skipped: [], tallies: [] };
  const counted = new Map<string, WholeFolderTally>();
  for (const entry of context.entries) {
    const tally = { entry, count: 0, bytes: 0 };
    counted.set(entry, tally);
    plan.tallies.push(tally);
  }

  for (const file of files) {
    const entry = entryFor(file.path, context.entries);
    if (entry === null) continue;

    const skip = (reason: string) => plan.skipped.push({ path: file.path, reason });

    // The author's own list, which beats this because it is the setting that
    // keeps things out and this is a setting that puts things in.
    if (isExcluded(file.path, context.excluded)) {
      skip(`in ${entry}, which is published whole, but also in an excluded folder`);
      continue;
    }
    // `.obsidian`, `.git`, and an `.env` sitting beside a build.
    if (isHiddenPath(file.path, entry)) {
      skip(`in ${entry}, which is published whole, but inside a hidden folder`);
      continue;
    }
    // An entry naming a project root rather than its build output. Publishing
    // a dependency tree on purpose is worse than publishing one by accident.
    if (isDependencyPath(file.path, entry)) {
      skip(`in ${entry}, which is published whole, but inside installed dependencies`);
      continue;
    }
    if (isBuildOutput(file.path, context.outputFolders, entry)) {
      skip(`in ${entry}, which is published whole, but this build's own output`);
      continue;
    }

    if (NOT_PUBLISHED_AS_SOURCE.test(file.path)) {
      skip(
        /\.md$/i.test(file.path)
          ? `in ${entry}, which is published whole, but a note is published as ` +
              `its rendered page rather than as Markdown source`
          : `in ${entry}, which is published whole, but an Obsidian data file ` +
              `is not something a static site reads`,
      );
      continue;
    }

    if (!withinScope(file.path, context.folder)) {
      skip(
        `in ${entry}, which is published whole, but outside the published ` +
          `folder, so it has no path inside the site -- move it in, or ` +
          `publish the folder that holds both`,
      );
      continue;
    }

    const url = urlForVaultFile(file.path, context.folder);

    const reserved = reservedPathReason(url);
    if (reserved) {
      skip(`in ${entry}, which is published whole, but ${reserved}`);
      continue;
    }

    const claimed = context.claimedBy(url);
    if (claimed) {
      skip(
        `in ${entry}, which is published whole, but ${url} is already ` +
          `published from ${claimed}`,
      );
      continue;
    }

    const tooBig = context.tooBigReason(file.size, context.maxBytes);
    if (tooBig) {
      skip(tooBig);
      continue;
    }

    const tally = counted.get(entry);
    if (tally) {
      tally.count += 1;
      tally.bytes += file.size;
    }

    if (isHtmlFilePath(file.path)) {
      plan.pages.push(file.path);
      continue;
    }
    plan.carry.push({ sourcePath: file.path, url });
  }

  return plan;
}
