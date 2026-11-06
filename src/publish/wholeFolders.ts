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
import {
  isHtmlFilePath,
  reservedPathReason,
  urlForVaultFile,
  withinScope,
} from "./htmlFiles";

/**
 * Extensions that are not published as source, whatever folder they are in.
 *
 * The same list `htmlFiles.ts` keeps for a referenced file, minus `.html`:
 * an HTML file here is published, as a page, which is the point of the
 * setting. The reasons for the other three are in `COMPANION_DENIED`, and
 * they do not change because the file was discovered differently.
 */
const NOT_PUBLISHED_AS_SOURCE = /\.(?:md|canvas|base)$/i;

/**
 * One folder published whole, and where it lands on the site.
 *
 * `at` is the destination: `null` means the folder keeps its vault path, as
 * everything else published here does, and a string is a path on the site to
 * put it at instead. `""` is the root, which is what `/` in the field means.
 *
 * The destination exists because a vault path is not a URL anybody wants.
 * An application at `proto/vite-app/dist` is a site at
 * `/proto/vite-app/dist/`, which is the kind of address people apologise for
 * when they send it. It also answers the one arrangement that was otherwise
 * impossible: an application at the front of a site with the notes behind
 * it.
 */
export interface WholeFolderEntry {
  /** Vault path of the folder. */
  folder: string;
  /** Where it lands, or null to keep the vault path. `""` is the root. */
  at: string | null;
}

/**
 * The stored setting, read into entries.
 *
 * Takes three shapes, because two of them are what this setting used to be:
 * a list of objects, a list of plain paths, or the raw text of a field, one
 * path per line. A plain path becomes an entry with no destination, which is
 * exactly what it meant before destinations existed -- so a site stored
 * either way builds the same site it built yesterday.
 *
 * Deduplicated by folder, keeping the first, because the same folder twice
 * with two destinations is a contradiction with no sensible reading. The
 * *destinations* are checked separately, in `planWholeFolders`, since that
 * is where there is somewhere to report it.
 */
export function parseWholeFolders(value: unknown): WholeFolderEntry[] {
  const raw: unknown[] =
    typeof value === "string"
      ? value.split(/\r?\n/)
      : Array.isArray(value)
        ? value
        : [];

  const out: WholeFolderEntry[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const stored = typeof item === "string";
    const named =
      item && typeof item === "object" && "folder" in item
        ? (item as { folder: unknown }).folder
        : undefined;
    const folder = stored
      ? tidy(item)
      : typeof named === "string"
        ? tidy(named)
        : named === undefined && item && typeof item === "object" && "folder" in item
          ? ""
          : null;
    if (folder === null) continue;

    /*
     * A blank folder is kept, and it is kept for the settings panel: adding
     * a row stores an empty one, and parsing it away would make the button
     * look broken. The build ignores them -- `entryFor` matches nothing
     * against an empty path, and `planWholeFolders` does not give one a
     * tally -- so an unfinished row costs a site nothing. Blanks are not
     * deduplicated either, or two empty rows would collapse into one while
     * somebody was still typing into the second.
     *
     * A bare empty line in the old text shape was never a row, so only the
     * structured shape can mean "a row with nothing in it yet".
     */
    if (!folder) {
      if (!stored) out.push({ folder: "", at: null });
      continue;
    }

    const key = folder.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const at =
      item && typeof item === "object" && "at" in item
        ? storedDestination((item as { at: unknown }).at)
        : null;
    out.push({ folder, at });
  }

  return out;
}

/**
 * A destination read back out of the settings.
 *
 * Not the same rule as the field, and the difference is the whole of this
 * function. In the field an empty string is somebody who has not filled it
 * in, so it means "no destination"; in storage the key is simply absent
 * when there is none, so an empty string can only have come from `/` and
 * means the root. Reading stored data with the field's rule would turn
 * every application published at the front page back into one published at
 * its vault path, on the next load and without a word.
 */
function storedDestination(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = tidy(value);
  if (clean.split("/").some((segment) => segment === "..")) return null;
  return clean;
}

/**
 * A destination as it is stored: tidied, or null when there is none.
 *
 * An empty field is "no destination" and `/` is the root, which are
 * different answers and have to stay different: one keeps the vault path
 * and the other takes over the front page.
 *
 * `..` is refused rather than resolved. A destination that climbs out of
 * the site has nowhere to be, and quietly reinterpreting it would publish
 * files somewhere nobody asked for.
 */
export function destination(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const clean = tidy(trimmed);
  if (!clean) return "";
  if (clean.split("/").some((segment) => segment === "..")) return null;
  return clean;
}

/** Slashes forward, none at either end. Exported so the settings field
 * stores a path in the shape this reads it back in. */
export function tidyPath(value: string): string {
  return tidy(value);
}

/** Slashes forward, none at either end. */
function tidy(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

/** What one entry came to, for the report. */
export interface WholeFolderTally {
  /** The folder as the author wrote it. */
  entry: string;
  /** Where it was published, or null for "wherever its vault path is". */
  at: string | null;
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
  /** The entries, as `parseWholeFolders` reads the setting. */
  entries: readonly WholeFolderEntry[];
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
export function isInWholeFolder(
  path: string,
  entries: readonly WholeFolderEntry[],
): boolean {
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
export function entryFor(
  path: string,
  entries: readonly WholeFolderEntry[],
): WholeFolderEntry | null {
  const target = normalize(path);
  for (const entry of entries) {
    const clean = normalize(entry.folder);
    if (!clean) continue;
    if (target === clean || target.startsWith(`${clean}/`)) return entry;
  }
  return null;
}

/**
 * Where one file in a folder published whole lands.
 *
 * With no destination this is `urlForVaultFile`, which is what every other
 * published file does and what this setting did before destinations
 * existed. With one, the part of the path *inside* the folder is kept and
 * the rest is replaced -- so `proto/app/dist/assets/x.js` published at `app`
 * is `app/assets/x.js`, and at the root it is `assets/x.js`.
 *
 * The scope is deliberately not consulted in the second case. A destination
 * is an address on the site, said outright; making it relative to the scope
 * as well would mean the same entry pointing somewhere different because a
 * setting two rows up changed.
 */
export function wholeFolderUrl(
  path: string,
  entry: WholeFolderEntry,
  scope: string | null,
): string {
  if (entry.at === null) return urlForVaultFile(path, scope);

  // The matched prefix is exactly this long, because `entryFor` compared the
  // tidied folder against the path from its first character.
  const matched = normalize(entry.folder).length;
  const inside =
    path.length > matched
      ? path.slice(matched + 1)
      : (path.split("/").pop() ?? path);
  return entry.at ? `${entry.at}/${inside}` : inside;
}

function normalize(value: string): string {
  return tidy(value).toLowerCase();
}

/**
 * Whether one of these folders publishes a page at the front of the site.
 *
 * Asked before the notes are given their URLs, because it is what decides
 * whether the homepage note keeps `index.html` -- and a note's URL is
 * settled long before there is a plan to consult.
 *
 * It reads the same `wholeFolderUrl` the plan does, so the two cannot
 * disagree about where a page lands. What it does not do is apply the
 * refusals: an `index.html` at the root of a folder published whole that is
 * then excluded, or too big to carry, would move the homepage note aside
 * and not replace it. The generated homepage is written in that case, so
 * the site still has a front page; the note is merely at a longer URL than
 * it needed to be.
 */
export function claimsSiteRoot(
  files: readonly { path: string }[],
  entries: readonly WholeFolderEntry[],
  scope: string | null,
): boolean {
  for (const file of files) {
    const entry = entryFor(file.path, entries);
    if (!entry || entry.at === null) continue;
    if (wholeFolderUrl(file.path, entry, scope).toLowerCase() === "index.html")
      return true;
  }
  return false;
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
  const plan: WholeFolderPlan = {
    carry: [],
    pages: [],
    skipped: [],
    tallies: [],
  };
  const counted = new Map<string, WholeFolderTally>();

  /*
   * Two folders cannot publish to one place. Settled before any file is
   * looked at, and reported once against the folder rather than once per
   * file, because it is a mistake about the setting and not about any of
   * the thousands of files underneath it.
   *
   * The first entry keeps the destination. Refusing both would turn one
   * typo into two missing applications.
   */
  const claimed = new Map<string, WholeFolderEntry>();
  const clashing = new Set<WholeFolderEntry>();
  for (const entry of context.entries) {
    // A row somebody is still typing into. Invisible to a build, and not
    // worth a line in a report saying a folder with no name holds nothing.
    if (!entry.folder) continue;
    plan.tallies.push({
      entry: entry.folder,
      at: entry.at,
      count: 0,
      bytes: 0,
    });
    if (entry.at === null) continue;
    const taken = claimed.get(entry.at);
    if (taken) {
      clashing.add(entry);
      plan.skipped.push({
        path: entry.folder,
        reason:
          `published whole at "${entry.at || "/"}", which \`${taken.folder}\` is ` +
          `already published at -- two folders cannot be the same place, so ` +
          `nothing in this one is published`,
      });
      continue;
    }
    claimed.set(entry.at, entry);
  }
  for (const tally of plan.tallies)
    counted.set(tally.entry.toLowerCase(), tally);

  for (const file of files) {
    const entry = entryFor(file.path, context.entries);
    if (entry === null) continue;
    if (clashing.has(entry)) continue;

    const skip = (reason: string) =>
      plan.skipped.push({ path: file.path, reason });

    // The author's own list, which beats this because it is the setting that
    // keeps things out and this is a setting that puts things in.
    if (isExcluded(file.path, context.excluded)) {
      skip(
        `in ${entry.folder}, which is published whole, but also in an excluded folder`,
      );
      continue;
    }
    // `.obsidian`, `.git`, and an `.env` sitting beside a build.
    if (isHiddenPath(file.path, entry.folder)) {
      skip(
        `in ${entry.folder}, which is published whole, but inside a hidden folder`,
      );
      continue;
    }
    // An entry naming a project root rather than its build output. Publishing
    // a dependency tree on purpose is worse than publishing one by accident.
    if (isDependencyPath(file.path, entry.folder)) {
      skip(
        `in ${entry.folder}, which is published whole, but inside installed dependencies`,
      );
      continue;
    }
    if (isBuildOutput(file.path, context.outputFolders, entry.folder)) {
      skip(
        `in ${entry.folder}, which is published whole, but this build's own output`,
      );
      continue;
    }

    if (NOT_PUBLISHED_AS_SOURCE.test(file.path)) {
      skip(
        /\.md$/i.test(file.path)
          ? `in ${entry.folder}, which is published whole, but a note is published as ` +
              `its rendered page rather than as Markdown source`
          : `in ${entry.folder}, which is published whole, but an Obsidian data file ` +
              `is not something a static site reads`,
      );
      continue;
    }

    /*
     * The scope still decides what may be published. A destination says
     * where a folder lands, not whether it is allowed out -- otherwise
     * naming a destination would quietly widen the scope, which is the
     * setting people use to keep things in.
     */
    if (!withinScope(file.path, context.folder)) {
      skip(
        `in ${entry.folder}, which is published whole, but outside the ` +
          `published folder` +
          (entry.at === null
            ? `, so it has no path inside the site -- move it in, or publish ` +
              `the folder that holds both`
            : ` -- a destination says where a folder lands, not whether it ` +
              `may be published, so widen the scope to include it`),
      );
      continue;
    }

    const url = wholeFolderUrl(file.path, entry, context.folder);

    const reserved = reservedPathReason(url);
    if (reserved) {
      skip(`in ${entry.folder}, which is published whole, but ${reserved}`);
      continue;
    }

    const claimed = context.claimedBy(url);
    if (claimed) {
      skip(
        `in ${entry.folder}, which is published whole, but ${url} is already ` +
          `published from ${claimed}`,
      );
      continue;
    }

    const tooBig = context.tooBigReason(file.size, context.maxBytes);
    if (tooBig) {
      skip(tooBig);
      continue;
    }

    const tally = counted.get(entry.folder.toLowerCase());
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
