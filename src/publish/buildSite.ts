import { App, TFile } from "obsidian";
import { createRenderHost, renderFile } from "../render/renderNote";
import { waitForDataviewIndex } from "../render/settle";
import { withDataviewRefreshSuspended } from "../render/dataviewRefresh";
import { LinkResolver, LinkTarget, rewriteLinks } from "./links";
import {
  assignHeadingIds,
  buildPage,
  dropRedundantTitleHeading,
  pathToRoot,
  neutralizeMermaidColours,
  prepareCodeBlocks,
  prepareCollapsibleCallouts,
  prepareTables,
  prepareTaskStatuses,
  reviewOverlayAppendix,
  stripFrontmatter,
  OVERLAY_SCRIPT_PATH,
  SITE_SCRIPT_PATH,
} from "./page";
import { CLIENT_SCRIPT } from "./clientScript";
import { overlayBundle } from "../overlay/overlayScript";
import {
  harvestCss,
  harvestToStylesheet,
  materializeMathJaxFonts,
} from "./harvestCss";
import { BasesStats, emptyBasesStats, reemitBases } from "./bases";
import {
  DriftReport,
  DriftSample,
  heapBytes,
  isControlNote,
  summarizeDrift,
} from "./drift";
import {
  countInvalidNesting,
  countLoadingPlaceholders,
  normalizeStaticPluginOutput,
} from "./normalize";
import {
  Leak,
  PrivacyReport,
  emptyPrivacyReport,
  indexUnpublished,
  scanForLeaks,
} from "./privacy";
import {
  AssetStats,
  DEFAULT_MAX_ASSET_BYTES,
  assetSkipReason,
  assetUrl,
  collectAssets,
  emptyAssetStats,
} from "./assets";
import { stabilizeIds, stripDebugAttributes } from "./stableIds";
import {
  Mention,
  OutgoingLinks,
  buildBacklinkIndex,
  relatedNotes,
} from "./backlinks";
import { buildLocalGraph } from "./graph";
import {
  NavNote,
  buildNavTree,
  collectTags,
  formatDay,
  recencyBuckets,
} from "./nav";
import { SitePaths, folderSlug } from "./shell";
import {
  LandingInput,
  LandingNote,
  TagLink,
  browseContent,
  exploreContent,
  noteExcerpt,
  overviewContent,
  sitePaths,
  tagPageContent,
  tagUrls,
  tagsIndexContent,
} from "./landing";
import { noteSource } from "./source";
import {
  DEFAULT_OUTPUT_FOLDERS,
  dependencyRoot,
  isBuildOutput,
  isDependencyPath,
  isHiddenPath,
} from "./outputFolders";
import {
  ExcludeTally,
  excludeTallies,
  isExcluded,
  parseExcludeFolders,
} from "./excludeFolders";
import {
  WholeFolderPlan,
  WholeFolderTally,
  claimsSiteRoot,
  entryFor,
  parseWholeFolders,
  planWholeFolders,
  wholeFolderUrl,
} from "./wholeFolders";
import {
  CompanionContext,
  CompanionRef,
  HtmlFileStats,
  appShellWithoutCode,
  baseHref,
  baseHrefHazard,
  countHtmlFilesBlockedByFlag,
  countHtmlFilesAvailable,
  emptyHtmlFileStats,
  hasLocalResourceUrl,
  pageTitle,
  planCompanions,
  planHtmlFiles,
  planStylesheetTree,
  selectHtmlFiles,
  urlForVaultFile,
} from "./htmlFiles";
import { stampBlockIds } from "../overlay/anchor";
import { siteCss } from "./theme";
import { readCustomCss, withCustomCss } from "./customCss";
import { PublishFile } from "../github/client";

/**
 * Turning a vault into a set of files ready to commit.
 *
 * The order of operations here is the part that matters. Every page must be
 * known before any page is rendered, because link rewriting needs to decide
 * whether a wikilink's target is being published -- and that decision is what
 * separates a working link from a 404, and a private note from a leaked one.
 * So selection happens first and completely, then rendering.
 */

/**
 * What a page's comments are grouped under, which is not the same question
 * in a preview as in a publish.
 *
 * A preview uses the vault path of the note behind the page. That is what
 * lets `importReview` put a comment back beside the writing it is about,
 * and a preview is served from the vault to the person who owns it.
 *
 * A publish uses the page's own URL. The overlay needs a key that is stable
 * across builds and unique per page, and the URL is both -- while a vault
 * path in a published page would hand every reader of the site the vault's
 * folder names, which is the class of leak `privacy.ts` exists to prevent
 * and the reason the overlay was preview-only until now.
 *
 * A function, and exported, so the guarantee has a test of its own rather
 * than living in a ternary inside a loop no test reaches.
 */
export function overlayKey(
  overlay: { published?: boolean },
  url: string,
  sourcePath: string,
): string {
  return overlay.published ? url : sourcePath;
}

export interface SiteConfig {
  siteName: string;
  /**
   * Which notes to publish: a folder path, `""` for the whole vault, or
   * `null` for "the user has not chosen yet".
   *
   * The three-way distinction is the point. A publisher whose scope defaults
   * to a folder name publishes nothing when that folder does not exist, and
   * one that defaults to the whole vault publishes every private note in it
   * on the first run. Neither default is safe, so there is no default: `null`
   * means unchosen, and `isScopeChosen` is what the callers and the first-run
   * checklist both ask before anything is built.
   */
  folder: string | null;
  /** When set, a note must also have this frontmatter key set to true. */
  requireFrontmatterFlag: string | null;
  /**
   * Folders to leave out of whatever the scope took in, as vault paths.
   *
   * The subtraction the scope cannot express: publish the whole vault except
   * these three folders. Applied at every scope rather than only to a vault
   * published whole, because a folder with a private subfolder in it is the
   * same problem one level down.
   *
   * Applied after the scope and before anything else, and it beats the scope
   * where the two contradict each other -- an entry that contains the scope
   * publishes nothing, which is what it says. See `excludeFolders.ts`, and
   * note that this is a blacklist: `requireFrontmatterFlag` is the setting
   * that fails safe.
   */
  excludeFolders?: string[];
  /**
   * Publish the vault's own `.html` files, exactly as they are.
   *
   * Off by default, and that default is the point rather than caution. A
   * vault scoped to the whole vault is a common setup, and vaults are full
   * of HTML nobody wrote as a web page: saved articles, a plugin's bundled
   * help, an export somebody made once. Selection has never looked at
   * anything but Markdown, so turning this on silently would publish all of
   * it on the next build, and the user would find out from the live site.
   *
   * On, an HTML file in scope publishes byte for byte at its own path, with
   * the files it references carried beside it. See `htmlFiles.ts`.
   */
  publishHtmlFiles?: boolean;
  /**
   * Folders to publish entire, as vault paths, one per line in the setting.
   *
   * The answer to a built application, whose lazily loaded chunks are named
   * nowhere a build can read them. Everything else here travels because
   * something referenced it; a folder named here travels because it was
   * named. See `wholeFolders.ts` for what that does and does not relax --
   * in short, it changes what is found, never what is refused.
   *
   * Empty or unset means none, which is every site built before this
   * existed.
   */
  publishWholeFolders?: { folder: string; at?: string }[];
  /**
   * Folders holding this build's own output, which are never its input.
   *
   * The preview is written into the vault as HTML, so without this the next
   * build selects the last preview and publishes it inside the new site.
   * Notes were immune by accident -- `getMarkdownFiles()` cannot see an HTML
   * file -- and `publishHtmlFiles` is what removes that immunity.
   *
   * The caller owns these names because the caller is what writes to them.
   * `DEFAULT_OUTPUT_FOLDERS` covers a caller that forgets.
   */
  outputFolders?: string[];
  /** Theme name from themes.ts. Falls back to the default when unknown. */
  theme?: string;
  /**
   * A stylesheet of the author's own, as a vault path, appended to the
   * site's.
   *
   * Unset means none, which is what every site built before this existed
   * had. The whole mechanism is one join in `customCss.ts`: the file's
   * contents go on the end of `assets/site.css`, so a `:root` block in it
   * redeclaring `--osp-link` or `--osp-font-body` beats the theme's, and no
   * rule anywhere else has to know the file exists.
   *
   * Read through the vault adapter rather than the file index, so a
   * stylesheet kept in a hidden folder -- `.obsidian/snippets/`, where
   * somebody who already writes CSS for Obsidian would reasonably put it --
   * is reachable too.
   */
  customCssPath?: string;
  /**
   * Address of the repository the site came from, for a link in the bar.
   *
   * Absent means no link, which is the default. It arrives resolved: the
   * switch, the typed address and the fall back to the repository the site
   * publishes to are all settled by `sourceLink.ts` before a build starts,
   * because two of the three are questions about settings this module is
   * deliberately not given -- the publish target and its API host.
   */
  sourceUrl?: string;
  /**
   * The note to publish as the homepage, as a vault path.
   *
   * Empty or unset means: the vault's own `README.md` if it is being
   * published, then `index.md`, then `Home.md`, and failing all three a
   * generated overview. A note used as the homepage is published *at*
   * `index.html` rather than at its own URL, so every link to it -- wikilinks,
   * backlinks, the tree, the graph -- points at the front page rather than at
   * a second copy of it.
   */
  homeNote?: string;
  /** Frontmatter key holding a note's own edit date. Defaults to `updated`. */
  updatedProperty?: string;
  /**
   * Frontmatter key marking a note as one to start from. Defaults to `pinned`.
   *
   * Deliberately not Obsidian's bookmarks: those are reached through an
   * internal API, they hold folders and saved searches as well as notes, and
   * they can name notes that are not being published -- which would put a
   * private note's title on a public page, the leak `privacy.ts` exists to
   * catch.
   */
  pinnedProperty?: string;
  /** Now, injectable so a build is reproducible in a test. */
  now?: Date;
  /**
   * Custom domain for the published site, written to a CNAME file.
   *
   * GitHub Pages reads the domain from a file in the branch, not from the
   * repository settings alone, and a publish that sends a complete tree
   * without it would silently un-set a domain the user had configured in the
   * web UI. So once it is set here it is written on every publish.
   */
  customDomain?: string;
  /**
   * Refuse to publish when a page contains content from an unpublished note.
   *
   * Off by default, and that default is a judgement call rather than an
   * obvious one. A query that reaches across the whole vault is a normal and
   * wanted thing -- an index page is exactly that -- so refusing by default
   * would block the first publish of many ordinary vaults with an error the
   * user cannot act on. Instead the leak is always reported, by note, and a
   * vault that holds anything genuinely private can turn this on.
   */
  failOnPrivacyLeak?: boolean;
  /**
   * Refuse to publish when a Bases view is showing fewer rows than it found.
   *
   * Off by default, and for the same reason as the setting above: Bases only
   * builds the rows it is currently showing, so a view of any length arrives
   * short, and refusing by default meant one long base blocked an entire
   * site. The gap is now stated on the page itself, which is the honest
   * minimum. Turn this on to go back to refusing.
   */
  failOnTruncatedBase?: boolean;
  /**
   * Add the review overlay to every note page, and stamp block anchors.
   *
   * A preview-only setting, and the only one here whose default being wrong
   * would leak rather than merely annoy: the overlay carries each page's
   * vault path so an imported comment can find the note it is about, and a
   * published page carrying that would hand a reader the vault's folder
   * structure.
   *
   * So `publish()` does not thread this through at all rather than passing it
   * as false, `buildToPreview()` is the only caller that sets it, and
   * `page.test.ts` holds the test that a page built without it carries no
   * trace of either the overlay or the path.
   */
  reviewOverlay?: {
    /** Prefills the comment author in the overlay. */
    reviewer?: string;
    /**
     * Name of the tracker a comment can be filed in, e.g. "GitHub".
     *
     * Absent means no Send action at all, which is the normal case. It is a
     * name rather than a flag because the only thing the page does with it is
     * put it in a menu label, and a page that knew which provider it was
     * talking to would be a page that had to be taught about the next one.
     */
    tracker?: string;
    /**
     * This is a published build, not a preview.
     *
     * It changes one thing and it matters: the key a comment is grouped
     * under becomes the page's own public URL instead of the vault path of
     * the note behind it. A published page carrying `notes/Clients/Acme Q3.md`
     * would hand every reader of the site the vault's folder structure,
     * which is the reason the overlay was preview-only until now.
     *
     * The cost is that a review exported from a published page names pages
     * rather than notes, so `importReview` links it to the page it was left
     * on rather than to the note that produced it.
     */
    published?: boolean;
    /**
     * Whether a reader of this build may write comments.
     *
     * Defaults to true, which is what a preview is. A published build sets
     * it from a setting that is off until somebody turns it on.
     */
    comments?: boolean;
    /**
     * Where a reader should send a review they exported.
     *
     * Only useful on a published build, where there is no plugin to sync
     * to and a file is the only way back to whoever owns the site.
     */
    contact?: string;
  };
  /**
   * Largest single attachment to publish, in bytes. Defaults to 25 MiB.
   *
   * A vault can hold a 4 GB screen recording, and nothing stopped one from
   * being read into memory, base64-encoded and pushed at the Git Data API --
   * which would fail the whole publish slowly and opaquely, after everything
   * else had succeeded. Over the ceiling the file is skipped and reported, so
   * the rest of the site still publishes.
   */
  maxAssetBytes?: number;
  /**
   * Suspend Dataview's periodic refresh while rendering.
   *
   * Measured on 300 notes and the result is: no detectable effect. The run
   * with it on fell between two runs with it off (125s, against 58s and
   * 135s with identical configuration), and every per-type number did the
   * same. An earlier reading of this as "a clear loss" was wrong: it came
   * from one sample each side, and run-to-run variance here is larger than
   * the effect being measured. Bases alone moved 20x between two runs that
   * changed nothing.
   *
   * Left off. Two attempts to make Dataview more convenient to photograph by
   * reaching into its scheduling have now produced one clear loss (a 300ms
   * inter-note delay, 49.7s to 283s) and one result indistinguishable from
   * noise. What actually worked was leaving other plugins alone and getting
   * better at recognising when their output is finished.
   */
  suspendDataviewRefresh?: boolean;
  /**
   * Pause between notes, in ms. Defaults to none.
   *
   * This exists as a monument to a wrong answer. Rendering back to back
   * appeared to break dataviewjs: the same note built in 989ms alone and
   * timed out at 21s with 13 unfilled cells as one of seven. An idle pause
   * was the obvious fix and it made things worse -- 49.7s to 283s, with a
   * second note failing too.
   *
   * Neither number meant anything. In a clean vault the same seven notes
   * build in 1,690ms and dataviewjs renders in 24ms with nothing pending.
   * The failure was never batching; it was a vault degraded by roughly
   * fifteen plugin reloads, which slowed a plain prose note from 886ms to
   * 6,989ms in the same run.
   *
   * Kept, set to zero, because a 500-note publish is itself a long session
   * and may yet reproduce the degradation honestly.
   */
  interNoteDelayMs?: number;
}

export interface PageResult {
  sourcePath: string;
  url: string;
  title: string;
  /** Links pointing at notes that are not published. */
  unresolvedTargets: string[];
  /** Blocks that rendered a permission prompt instead of content. */
  guarded: number;
  /** Blocks that rendered an error instead of content. */
  errored: number;
  renderMs: number;
  totalMs: number;
  /** Elements still unfilled when the page was serialized. Informative on its
   * own: Bases renders a genuinely empty property value as an empty span, so
   * a non-zero count is not by itself a fault. */
  pending: number;
  /**
   * True only when the wait *ran out* with placeholders outstanding.
   *
   * The distinction matters. A settle that ended because the placeholder
   * count stopped changing has found elements that are legitimately empty and
   * will never fill. A settle that ended at the timeout with placeholders
   * left has given up on content that was still arriving, which is the case
   * that must not publish.
   */
  incomplete: boolean;
  /** What re-emitting the note's Bases views did. */
  bases: BasesStats;
  /** Content from unpublished notes found on this page. */
  privacy: PrivacyReport;
  /** Images and other media the page referenced. */
  assets: AssetStats;
  /** How the settle wait ended. "timeout" and "quiet" are the slow paths. */
  settleReason: string;
}

export interface BuildResult {
  files: PublishFile[];
  pages: PageResult[];
  /** Notes selected but skipped, with the reason. */
  skipped: { path: string; reason: string }[];
  totalMs: number;
  /** Serialized output a browser would rearrange. Must be zero. */
  invalidNesting: number;
  /**
   * Blocks that serialized still showing a plugin's loading placeholder.
   * Must be zero: three of these reached a live site as "Loading...".
   */
  loadingPlaceholders: number;
  /** Pages that serialized with unfilled content. Must be zero. */
  incompletePages: number;
  /**
   * Bases views whose rows did not all reach the page, as "name: emitted/total".
   *
   * Bases virtualizes its grid, so a base with more rows than the render host
   * is tall can have only the visible ones in the DOM. Publishing that would
   * silently truncate a table, which is why it is counted at the top level
   * rather than left in a per-page field.
   */
  basesTruncated: string[];
  /** Bases view types we do not re-emit, so they published as raw app DOM. */
  basesUnhandled: string[];
  /** Every unpublished note whose content reached a page, with where. */
  privacyLeaks: (Leak & { page: string })[];
  /**
   * The author's own stylesheet, when one was named and read.
   *
   * Null covers both "none configured" and "configured but unreadable", and
   * the second of those also puts a line in `skipped` -- a stylesheet that
   * did not load looks exactly like one whose rules do not work, and the
   * difference is not something anyone should have to guess at.
   */
  customCss: { path: string; bytes: number } | null;
  /** Media files copied into the site. */
  assetsPublished: number;
  /** Total bytes of media, so a publish can say what it is uploading. */
  assetBytes: number;
  /** References that looked like vault media but could not be resolved. */
  assetsUnresolved: string[];
  /** What publishing the vault's own HTML files did. */
  htmlFiles: HtmlFileStats;
  /**
   * HTML files the scope matched that a frontmatter flag excluded.
   *
   * Zero unless `publishHtmlFiles` is on with a flag set, which is the one
   * configuration where the toggle is on and publishes nothing. An HTML file
   * cannot carry frontmatter, so it cannot pass the gate; saying so is the
   * difference between a rule and a bug.
   */
  htmlFilesBlockedByFlag: number;
  /**
   * HTML files the scope holds while `publishHtmlFiles` is off.
   *
   * Zero when the toggle is on. Non-zero means the vault has pages that
   * would publish and a setting is the only reason they did not.
   */
  htmlFilesNotEnabled: number;
  /**
   * What each excluded folder kept out of this build, in the order written.
   *
   * Empty when nothing is excluded. An entry with a count of zero is the one
   * worth reading: it is a path that excluded nothing, which is usually a
   * typo in a setting whose whole job is keeping things out, and which has
   * no other way of announcing itself.
   */
  excluded: ExcludeTally[];
  /**
   * Installed dependencies the build skipped, as folders and a file count.
   *
   * Zero files on every vault that has none, which is most of them. The
   * report says it when there is something to say and nothing when there is
   * not -- but it has to be able to say it, because this is the one rule
   * here that keeps out files somebody put in the vault on purpose.
   */
  dependencies: DependencyTally;
  /**
   * What each folder published whole came to, and what that weighed.
   *
   * An empty list on every site that names none. An entry with a count of
   * zero is the one worth reading: it is a path that matched nothing, which
   * is a typo that would otherwise look exactly like a folder that was
   * published and happened to be empty.
   */
  wholeFolders: WholeFolderTally[];
  /**
   * Files carried because their folder was published whole.
   *
   * The non-page files only, and counted as they were read rather than as
   * they were planned. A page in one of these folders is published through
   * the as-is path like any other, so it is in `htmlFiles.published`; each
   * entry's own tally counts both, which is why this number is smaller than
   * the tallies add up to.
   */
  wholeFolderFiles: number;
  /** What those weighed, which is the number to know before a push. */
  wholeFolderBytes: number;
  /**
   * Whether the build got slower as it ran, measured from control notes.
   *
   * Null when the vault has none. A build without controls is not proof that
   * nothing degraded, only that nothing was watching.
   */
  drift: DriftReport | null;
  /**
   * How many notes the scope matched, before any of them were rendered.
   *
   * Separate from `pages.length`, which counts what survived rendering. The
   * difference is the whole question when a build comes back empty: a filter
   * that matched nothing is a misconfiguration, while a filter that matched
   * three hundred notes that all failed to render is a fault. A publish
   * sends a complete tree, so publishing an empty build would not publish
   * nothing -- it would delete the site.
   */
  selectedCount: number;
}

/**
 * True once the user has said what to publish.
 *
 * A frontmatter flag is a scope in its own right -- "every note marked
 * `publish: true`, wherever it lives" is a complete answer -- so it satisfies
 * this on its own even while the folder is unchosen.
 */
export function isScopeChosen(
  site: Pick<SiteConfig, "folder" | "requireFrontmatterFlag">,
): boolean {
  return site.folder !== null || Boolean(site.requireFrontmatterFlag);
}

/** Vault path to published URL. Keeps folder structure, swaps the extension. */
export function urlForNote(sourcePath: string, folder: string | null): string {
  const relative =
    folder && sourcePath.startsWith(`${folder}/`)
      ? sourcePath.slice(folder.length + 1)
      : sourcePath;
  return relative.replace(/\.md$/i, ".html");
}

/**
 * Names a vault will have used for its front page, in the order a reader
 * would expect them to win. Matched case-insensitively, since a vault may
 * hold `readme.md` or `README.md` and neither is more correct.
 */
const HOME_CANDIDATES = ["readme.md", "index.md", "home.md"];

export interface HomeNote {
  /** Vault path of the note to publish as the homepage, or null. */
  path: string | null;
  /**
   * A homepage the user named that no published note matches.
   *
   * Reported rather than ignored: a typo here is silent otherwise -- the
   * build falls back to the README and the user is left looking at a page
   * they thought they had replaced.
   */
  unresolved: string | null;
}

/**
 * Which note is the homepage.
 *
 * The setting wins, then the vault's own front page by convention, and a
 * vault with neither gets the generated overview. Only notes being published
 * are considered: a README outside the scope is not the site's homepage, and
 * publishing it because it is called README would publish a note the user
 * excluded.
 */
export function resolveHomeNote(
  selected: Array<{ path: string }>,
  config: Pick<SiteConfig, "folder" | "homeNote">,
): HomeNote {
  const scope = config.folder ?? "";
  const named = config.homeNote?.trim().replace(/^\/+|\/+$/g, "");

  if (named) {
    const forms = [named, /\.md$/i.test(named) ? named : `${named}.md`];
    const keys = new Set(
      [...forms, ...(scope ? forms.map((form) => `${scope}/${form}`) : [])].map(
        (form) => form.toLowerCase(),
      ),
    );
    const hit = selected.find((file) => keys.has(file.path.toLowerCase()));
    if (hit) return { path: hit.path, unresolved: null };
  }

  // A front page is one at the top of what is being published. A `README.md`
  // three folders down is documentation for that folder, not for the site.
  const top = selected.filter((file) => {
    const relative =
      scope && file.path.startsWith(`${scope}/`)
        ? file.path.slice(scope.length + 1)
        : file.path;
    return !relative.includes("/");
  });

  for (const candidate of HOME_CANDIDATES) {
    const hit = top.find(
      (file) => (file.path.split("/").pop() ?? "").toLowerCase() === candidate,
    );
    if (hit) return { path: hit.path, unresolved: named ?? null };
  }

  return { path: null, unresolved: named ?? null };
}

export async function buildSite(
  app: App,
  config: SiteConfig,
  onProgress?: (done: number, total: number, path: string) => void,
): Promise<BuildResult> {
  const started = performance.now();

  // Dataview answers from its own index. Rendering before it is ready yields
  // empty tables that look like legitimately empty results, which would
  // publish over good content without any error to notice.
  await waitForDataviewIndex(app as never);

  const selected = selectNotes(app, config);
  const home = resolveHomeNote(selected, config);
  // The vault's own pages, which take no part in rendering: they are already
  // pages. Selected here so their URLs are known before anything claims one.
  const htmlByToggle = selectHtmlFiles(app, config);

  /**
   * Where a note is published.
   *
   * The homepage note goes to `index.html` and nowhere else, so there is one
   * copy of it and every link to it -- wikilink, backlink, tree row, graph
   * node -- resolves to the front page.
   *
   * The second branch is a collision that used to be a silent overwrite: a
   * vault holding `index.md` at its root published it to `index.html` and then
   * wrote the generated index over the top of it. Now `index.md` is a
   * homepage candidate, and when something else has already claimed the front
   * page it keeps its content at a name that is still its own.
   */
  const urlFor = (path: string): string => {
    // A folder published *at the root of the site* is somebody saying what
    // the front page is, in the most explicit way the settings allow, so it
    // takes `index.html` and the note that would have had it keeps its
    // content at the name a non-home note landing there has always been
    // given. This is the one place a note does not win a collision, and it
    // loses to an instruction rather than to another file that happened to
    // be there.
    if (home.path === path) return appClaimsHome ? "index-note.html" : "index.html";
    const url = urlForNote(path, config.folder);
    return url.toLowerCase() === "index.html" ? "index-note.html" : url;
  };

  /*
   * The folders published whole, read before the notes are given their
   * URLs: one published at the root of the site takes `index.html`, and
   * `urlFor` has to know that while it is deciding where the homepage note
   * goes.
   */
  const wholeEntries = parseWholeFolders(config.publishWholeFolders);
  const vaultFiles = wholeEntries.length
    ? app.vault
        .getFiles()
        .map((file) => ({ path: file.path, size: file.stat?.size ?? 0 }))
    : [];
  const appClaimsHome = claimsSiteRoot(vaultFiles, wholeEntries, config.folder);

  const targets: LinkTarget[] = selected.map((file) => ({
    sourcePath: file.path,
    url: urlFor(file.path),
  }));
  /**
   * What those folders actually publish, now that the notes have URLs.
   *
   * Planned here because a file in one can lose a collision to a note's
   * page, which is what `targets` has just settled, and because its own
   * pages have to join the as-is selection before anything is planned
   * against a URL.
   *
   * Without a destination, a file here cannot collide with an as-is page or
   * a companion: all three derive their URL from the vault path the same
   * way, so two of them at one URL are one file, deduplicated rather than
   * refused. A destination is what makes that collidable, which is why
   * `claimedBy` is given the notes and why `planHtmlFiles` is given the
   * overrides below.
   */
  const noteUrls = new Map(
    targets.map((target) => [target.url.toLowerCase(), target.sourcePath]),
  );
  const wholePlan: WholeFolderPlan = planWholeFolders(vaultFiles, {
    entries: wholeEntries,
    folder: config.folder,
    excluded: parseExcludeFolders(config.excludeFolders),
    outputFolders: config.outputFolders ?? DEFAULT_OUTPUT_FOLDERS,
    maxBytes: config.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES,
    tooBigReason: assetSkipReason,
    claimedBy: (url) => noteUrls.get(url.toLowerCase()) ?? null,
  });
  /**
   * Every page going out as-is: the ones the toggle selected, and the ones
   * that are in a folder published whole.
   *
   * Unioned rather than handled separately so that one plan decides every
   * URL. A page is a page however it was found, and a collision between two
   * of them has to be settled in one place.
   */
  const htmlSelected = [...htmlByToggle];
  const seenHtml = new Set(htmlByToggle.map((file) => file.path));
  for (const path of wholePlan.pages) {
    if (seenHtml.has(path)) continue;
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) continue;
    seenHtml.add(path);
    htmlSelected.push(file);
  }
  htmlSelected.sort((a, b) => a.path.localeCompare(b.path));

  /**
   * The vault's HTML files, and where each one lands.
   *
   * Planned against the notes' URLs rather than beside them, because a
   * collision has to be decided by something: a note's page wins, and the
   * HTML file is reported rather than published over it.
   */
  /*
   * Where a page in a folder published whole lands, when that folder was
   * given a destination. Keyed by vault path, and empty for every site that
   * names no destination -- in which case the planner works it out from the
   * vault path exactly as it always has.
   */
  const wholeUrls = new Map<string, string>();
  for (const page of wholePlan.pages) {
    const entry = entryFor(page, wholeEntries);
    if (!entry || entry.at === null) continue;
    wholeUrls.set(page, wholeFolderUrl(page, entry, config.folder));
  }

  const htmlPlan = planHtmlFiles(
    htmlSelected,
    config.folder,
    targets.map((t) => t.url),
    wholeUrls,
  );
  const htmlByPath = new Map(htmlSelected.map((file) => [file.path, file]));

  /**
   * Each as-is page's text, read before anything needs it.
   *
   * Read here rather than in the publishing loop further down, for two
   * reasons that both come back to the vault panel. The tree is built before
   * that loop runs and it needs every row's label, which for one of these
   * pages is its own `<title>`. And a page that cannot be read must not get
   * a row: the loop reports the failure and publishes nothing, so a row
   * written in advance would point at a file that was never written -- a
   * dead link in the one place that is meant to prove the page is there.
   *
   * So the read happens once, up front, and a page that fails it is out of
   * both the tree and the site. `cachedRead` means the text is the vault's
   * own copy rather than a fresh read per use.
   */
  const htmlContent = new Map<string, string>();
  // Held separately only because `skipped` is declared below this: folded
  // into it where it is built, so a read failure is reported identically to
  // one the loop itself would have caught.
  const skippedHtmlReads: { path: string; reason: string }[] = [];
  for (const target of htmlPlan.targets) {
    const file = htmlByPath.get(target.sourcePath);
    if (!file) continue;
    try {
      htmlContent.set(target.sourcePath, await app.vault.cachedRead(file));
    } catch (error) {
      skippedHtmlReads.push({
        path: target.sourcePath,
        reason: `could not read HTML file: ${error instanceof Error ? error.message : error}`,
      });
    }
  }

  /**
   * The vault's own pages, as the file tree sees them.
   *
   * Only the tree: `navNotes` below stays the rendered notes alone, because
   * every other thing built from it -- recency, the pinned list, the note
   * count, the tag pages, the graph -- is a claim about a note. See `asIs`
   * on `NavNote`.
   */
  const htmlNavNotes: NavNote[] = htmlPlan.targets
    .filter((target) => htmlContent.has(target.sourcePath))
    .map((target) => {
      const slash = target.url.lastIndexOf("/");
      return {
        url: target.url,
        title: pageTitle(
          htmlContent.get(target.sourcePath) ?? "",
          target.sourcePath,
        ),
        folder: slash === -1 ? "" : target.url.slice(0, slash),
        updated: null,
        pinned: false,
        asIs: true,
      };
    });

  // Both kinds of page go into the resolver, so `[[chart.html]]` in a note
  // becomes a working link instead of the dead span it used to be. Nothing
  // in `LinkResolver` needed teaching: it strips `.md` and nothing else, so
  // an HTML file's key is its name with the extension still on it, which is
  // exactly how Obsidian writes a link to a file that is not a note.
  const resolver = new LinkResolver([...targets, ...htmlPlan.targets]);

  // Everything in the vault that is *not* being published, by name, so a
  // query result can be recognised as belonging to a note the reader was
  // never meant to see.
  const published = new Set(selected.map((file) => file.path));
  const unpublishedByName = new Map<string, string>();
  for (const file of app.vault.getMarkdownFiles()) {
    if (published.has(file.path)) continue;
    /*
     * A package's `README` is not a private note, and this index is a list
     * of names that must not leak. Left in, `node_modules` filled it with
     * hundreds of entries -- `readme`, `changelog`, `license`, and every
     * package name -- and the privacy scan then flagged any page that
     * happened to use one of those words as having leaked an unpublished
     * note. A check that cries wolf a hundred times is a check nobody
     * reads, which is the real cost.
     */
    if (isDependencyPath(file.path, config.folder)) continue;
    unpublishedByName.set(file.basename.toLowerCase(), file.path);
  }
  // Compiled once here, not once per page: see `indexUnpublished`.
  const unpublished = indexUnpublished(unpublishedByName);

  const files: PublishFile[] = [];
  const pages: PageResult[] = [];
  const skipped: { path: string; reason: string }[] = [
    ...htmlPlan.collisions,
    ...skippedHtmlReads,
    // Reported file by file, because a folder published *whole* that quietly
    // left something out would be the worst of both arrangements.
    ...wholePlan.skipped,
  ];

  /**
   * Rendered notes, held until the whole site is known.
   *
   * A page cannot be assembled while it is being rendered any more: its rail
   * shows what links *to* it, and that is only knowable once every other note
   * has been through the rewriter. So rendering fills this, and the pages are
   * built afterwards, in one pass.
   */
  const rendered: Array<{
    url: string;
    title: string;
    html: string;
    headings: ReturnType<typeof assignHeadingIds>;
    outgoing: Array<{ url: string; context: string }>;
    nav: NavNote;
    tags: string[];
    /** The note's Markdown, as markdown mode is allowed to show it. */
    source: string;
    /** Vault path, for the review overlay. Never reaches a published page. */
    sourcePath: string;
  }> = [];
  const driftSamples: DriftSample[] = [];

  // Media is deduplicated across the whole site: one picture used by forty
  // notes is uploaded once.
  const wantedAssets = new Map<string, TFile>();
  const oversizedAssets = new Map<string, string>();

  const host = createRenderHost();
  try {
    const renderAll = async () => {
      for (const [index, file] of selected.entries()) {
        onProgress?.(index, selected.length, file.path);

        // Let the event loop turn over before the next note, so work queued
        // by the previous one can finish rather than being left behind it.
        if (index > 0 && config.interNoteDelayMs) {
          await new Promise((resolve) =>
            window.setTimeout(resolve, config.interNoteDelayMs),
          );
        }

        const url = urlFor(file.path);
        let headings: ReturnType<typeof assignHeadingIds> = [];
        let unresolvedTargets: string[] = [];
        let outgoing: Array<{ url: string; context: string }> = [];

        const title = titleFor(app, file);
        // Read before rendering rather than returned from it: `renderFile`
        // does its own `cachedRead`, so this is a cache hit, and the render
        // path stays about rendering.
        const source = noteSource(await app.vault.cachedRead(file));
        let bases = emptyBasesStats();
        let privacy = emptyPrivacyReport();
        let assets = emptyAssetStats();
        const renderedNote = await renderFile(app, file, host, {
          transform: (container) => {
            // First, before anything else reads the tree: the frontmatter is
            // not content, and nothing downstream should be deciding what to
            // do about it.
            stripFrontmatter(container);
            prepareCollapsibleCallouts(container);
            dropRedundantTitleHeading(container, title);
            // Before link rewriting: re-emitting moves cell nodes rather than
            // flattening them to text, so the `.internal-link` elements a
            // Bases cell contains are still there for the rewriter to find.
            bases = reemitBases(container);
            // After the Bases re-emitter, so its tables are wrapped and its
            // numeric columns found by the same pass as everyone else's.
            prepareCodeBlocks(container);
            prepareTables(container);
            prepareTaskStatuses(container);
            neutralizeMermaidColours(container);
            headings = assignHeadingIds(container);
            const rewritten = rewriteLinks(container, resolver, url);
            unresolvedTargets = rewritten.unresolvedTargets;
            outgoing = rewritten.resolvedTargets;
            assets = collectAssets(
              app,
              container,
              file.path,
              url,
              { want: (asset) => wantedAssets.set(asset.path, asset) },
              config.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES,
            );
            normalizeStaticPluginOutput(container);
            for (const item of assets.oversized) {
              oversizedAssets.set(item.path, item.reason);
            }
            // After rewriting, so downgraded links are visible as such.
            privacy = scanForLeaks(container, unpublished);
            // Last, so nothing downstream is holding a reference to an id
            // that is about to change.
            stabilizeIds(container);
            stripDebugAttributes(container);
            // Last of all, and only in a preview: the anchors are derived
            // from each block's final text, so nothing may rewrite the text
            // after this runs.
            if (config.reviewOverlay) stampBlockIds(container);
          },
        });

        if (renderedNote.error) {
          skipped.push({
            path: file.path,
            reason: renderedNote.error.split("\n")[0],
          });
          continue;
        }

        rendered.push({
          url,
          title,
          html: renderedNote.html,
          headings,
          outgoing,
          nav: navNoteFor(app, file, url, title, config),
          tags: tagsFor(app, file),
          source,
          sourcePath: file.path,
        });

        pages.push({
          sourcePath: file.path,
          url,
          title,
          unresolvedTargets,
          guarded: countMatches(renderedNote.html, "mermaid-guard-title"),
          errored: countMatches(renderedNote.html, "dataview-error"),
          renderMs: renderedNote.renderMs,
          totalMs: renderedNote.totalMs,
          pending: renderedNote.settle.pendingAtEnd,
          incomplete:
            !renderedNote.settle.settled &&
            renderedNote.settle.pendingAtEnd > 0,
          bases,
          privacy,
          assets,
          settleReason: renderedNote.settle.reason,
        });

        // Control notes are identical and contain nothing asynchronous, so
        // their render time tracks the environment rather than the content.
        if (isControlNote(file.path)) {
          driftSamples.push({
            path: file.path,
            index,
            renderMs: renderedNote.renderMs,
            heapBytes: heapBytes(),
          });
        }
      }
    };

    if (config.suspendDataviewRefresh) {
      await withDataviewRefreshSuspended(app as never, renderAll);
    } else {
      await renderAll();
    }
  } finally {
    host.remove();
  }

  // Every note is rendered, so what links to what is finally knowable. The
  // shell is built once and the pages are assembled around it.
  const navNotes = rendered.map((page) => page.nav);
  // The tree is the whole published vault, notes and the vault's own pages
  // together. Everything below it is notes alone -- see `htmlNavNotes`.
  const navTree = buildNavTree([...navNotes, ...htmlNavNotes]);
  const pinned = navNotes.filter((note) => note.pinned);
  const recency = recencyBuckets(navNotes, config.now ?? new Date());
  const titles = new Map(rendered.map((page) => [page.url, page.title]));
  const today = config.now ?? new Date();

  const outgoing: OutgoingLinks[] = rendered.map((page) => ({
    url: page.url,
    title: page.title,
    links: page.outgoing,
  }));
  const backlinks = buildBacklinkIndex(outgoing);
  const outgoingByUrl = new Map(outgoing.map((page) => [page.url, page]));

  // The pages the build invents, named around what is published rather than
  // over it, and every tag's own page. The vault's own HTML counts as
  // published here: a `browse.html` in the vault keeps its name, and our
  // listing becomes `all-notes.html`.
  const paths: SitePaths = sitePaths([
    ...rendered.map((page) => page.url),
    ...htmlPlan.targets.map((target) => target.url),
  ]);
  const counted = collectTags(
    rendered.map((page) => ({ url: page.url, tags: page.tags })),
  );
  const tagUrlByName = tagUrls(counted, paths);
  const tags: TagLink[] = counted.map((tag) => ({
    ...tag,
    url: tagUrlByName.get(tag.name) ?? paths.tags,
  }));

  /** Every published page, as the homepage, the browse page and a tag page see it. */
  const landingNotes: LandingNote[] = rendered.map((page) => ({
    url: page.url,
    title: page.title,
    folder: page.nav.folder,
    updated: page.nav.updated,
    pinned: page.nav.pinned,
    tags: page.tags,
    excerpt: noteExcerpt(page.html),
    incoming: backlinks.get(page.url)?.length ?? 0,
  }));

  const landing = (url: string): LandingInput => ({
    siteName: config.siteName,
    notes: landingNotes,
    tags,
    recency,
    paths,
    today,
    root: pathToRoot(url),
  });

  /**
   * The shell for a page the build wrote rather than rendered.
   *
   * No backlinks, no related notes, no graph: those are claims about a note,
   * and these pages are not notes. The vault panel, the search and the tags
   * are the same everywhere, which is the point of them.
   */
  const sitePageShell = (
    crumbs?: Array<{ label: string; url?: string }>,
  ): NonNullable<Parameters<typeof buildPage>[0]["shell"]> => ({
    nav: navTree,
    pinned,
    recency,
    tags,
    paths,
    crumbs,
    backlinks: [],
    related: [],
    graph: {
      nodes: [],
      edges: [],
      centre: { title: config.siteName, x: 0, y: 0 },
      width: 0,
      height: 0,
    },
    stats: { words: 0, readingMinutes: 1, sections: 0 },
    today,
    noteCount: navNotes.length,
    sourceUrl: config.sourceUrl,
  });

  if (home.unresolved) {
    skipped.push({
      path: home.unresolved,
      reason: home.path
        ? `set as the homepage, but no published note matches it; using ${home.path} instead`
        : "set as the homepage, but no published note matches it",
    });
  }

  for (const page of rendered) {
    const mentions: Mention[] = backlinks.get(page.url) ?? [];
    const related = relatedNotes(
      page.url,
      outgoingByUrl.get(page.url),
      mentions,
      titles,
    );
    const words = countWords(page.html);

    files.push({
      path: page.url,
      content: buildPage({
        meta: {
          title: page.title,
          url: page.url,
          siteName: config.siteName,
          properties: noteHeader(page, mentions.length, tagUrlByName),
        },
        // The homepage note is somebody's README, so it says nothing about
        // where the rest of the vault is. Below 56rem the panel is gone too,
        // which would leave a short README with no way onward at all.
        content:
          page.url === "index.html"
            ? `${page.html}\n${exploreContent(landing(page.url))}`
            : page.html,
        headings: page.headings,
        source: page.source,
        // Only in a preview, and only here: the generated pages below have no
        // note behind them, so a comment on one could not be filed against
        // anything.
        overlay: config.reviewOverlay
          ? {
              sourcePath: overlayKey(
                config.reviewOverlay,
                page.url,
                page.sourcePath,
              ),
              reviewer: config.reviewOverlay.reviewer,
              tracker: config.reviewOverlay.tracker,
              comments: config.reviewOverlay.comments !== false,
              published: config.reviewOverlay.published,
              contact: config.reviewOverlay.contact,
            }
          : undefined,
        shell: {
          nav: navTree,
          pinned,
          recency,
          tags,
          paths,
          backlinks: mentions,
          related,
          graph: buildLocalGraph({
            url: page.url,
            title: page.title,
            out: page.outgoing.map((link) => link.url),
            in: mentions.map((mention) => mention.url),
            titles,
          }),
          stats: {
            words,
            readingMinutes: Math.max(1, Math.round(words / 220)),
            sections: page.headings.filter((heading) => heading.level === 2)
              .length,
          },
          today,
          noteCount: navNotes.length,
          sourceUrl: config.sourceUrl,
        },
      }),
    });
  }

  // Attachments `collectAssets` refused, reported once however many pages
  // referenced them.
  for (const [path, reason] of oversizedAssets) skipped.push({ path, reason });

  // Media the pages referenced, read once each and carried as binary.
  let assetBytes = 0;
  for (const [path, file] of wantedAssets) {
    try {
      const data = await app.vault.readBinary(file);
      assetBytes += data.byteLength;
      files.push({ path: assetUrl(path), content: data });
    } catch (error) {
      skipped.push({
        path,
        reason: `could not read media: ${error instanceof Error ? error.message : error}`,
      });
    }
  }

  /**
   * The vault's own HTML files, published as they are.
   *
   * Read as text and pushed unchanged. Nothing here parses the markup,
   * rewrites a reference or links a stylesheet of ours into it -- the whole
   * contract of this path is that the file a reader gets is the file the
   * author wrote. What it does do is work out which files travel with it,
   * and refuse the handful of references that cannot honestly be carried.
   */
  const htmlStats = emptyHtmlFileStats();
  // Counted as they are read rather than taken from the plan, so the report
  // says what was published rather than what was intended.
  let wholeCarried = 0;
  let wholeBytes = 0;
  const wantedCompanions = new Map<string, CompanionRef>();
  // Reported once per file rather than once per page that referenced it: one
  // shared stylesheet outside the scope would otherwise fill the report.
  const refusedCompanions = new Set<string>();

  // Which HTML files are going out, so a link from one to another is
  // recognised as the working link it is rather than reported as broken --
  // and, for one that is not going out, why, so the report says what the
  // link will actually open.
  const publishedHtml = new Set(
    htmlPlan.targets.map((target) => target.sourcePath),
  );
  const refusedPages = new Map(
    htmlPlan.collisions.map((collision) => [collision.path, collision.reason]),
  );

  /**
   * What the companion rules have to ask about the vault, built once.
   *
   * Page-independent -- every answer is about the vault and the
   * configuration rather than about one page -- and it has to be, now that
   * a stylesheet's own references go through the same rules after the page
   * loop has finished with it.
   */
  const companionContext: CompanionContext = {
    folder: config.folder,
    statFile: (path) => {
      const referenced = app.vault.getAbstractFileByPath(path);
      // `?? 0` publishes when the size is unknown rather than refusing on
      // a guess, exactly as `collectAssets` does for an attachment.
      return referenced instanceof TFile ? (referenced.stat?.size ?? 0) : null;
    },
    isPublishedPage: (path) => publishedHtml.has(path),
    pageRefused: (path) => refusedPages.get(path) ?? null,
    publishedNoteUrl: (path) => (published.has(path) ? urlFor(path) : null),
    maxBytes: config.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES,
    tooBigReason: assetSkipReason,
    // A companion of a page in a folder with a destination moves with the
    // page. Without this the page arrives at its new address still asking
    // for its script at the old one.
    urlForFile: (path) => {
      const entry = entryFor(path, wholeEntries);
      return entry && entry.at !== null
        ? wholeFolderUrl(path, entry, config.folder)
        : urlForVaultFile(path, config.folder);
    },
  };

  for (const target of htmlPlan.targets) {
    // Read and reported much earlier, because the file tree needed the
    // titles: a page missing from `htmlContent` is one whose read failed and
    // is already in `skipped`.
    const html = htmlContent.get(target.sourcePath);
    if (html === undefined) continue;

    /**
     * The review overlay, on a page we did not build.
     *
     * Appended to the preview's copy, never to a published one: the only
     * caller that sets `reviewOverlay` is `buildToPreview`, which is the
     * same structural guarantee the note pages rely on, and the meta carries
     * the vault path that must never be published.
     *
     * It costs the one thing this path otherwise promises. While the overlay
     * is on, a preview copy of an as-is page is the vault's file plus a
     * delimited block at the end of it, so a byte-for-byte check against the
     * vault has to be done with the overlay off -- or by ignoring what sits
     * between the two `osp-review` comments. A publish is unaffected either
     * way, which is where the promise actually matters.
     *
     * `stamp` is set because nothing stamped this document's blocks: there
     * was no render pass to do it in, so the overlay does it in the browser
     * from the same content-derived hash.
     */
    const overlay = config.reviewOverlay;
    const content = overlay
      ? html +
        reviewOverlayAppendix({
          sourcePath: overlayKey(overlay, target.url, target.sourcePath),
          url: target.url,
          siteName: config.siteName,
          reviewer: overlay.reviewer,
          tracker: overlay.tracker,
          stamp: true,
          comments: overlay.comments !== false,
          published: overlay.published,
          contact: overlay.contact,
        })
      : html;

    // The scans below read `html`, never `content`: what the report says
    // about a page is about the author's file, not about anything of ours
    // that a preview added to it.
    files.push({ path: target.url, content });
    htmlStats.published++;
    htmlStats.publishedPages.push(`${target.sourcePath} -> ${target.url}`);

    // An `app://` URL carries the vault's absolute path, so the author's
    // home directory. The note pipeline strips those; this one may not touch
    // the file, so the only honest thing left is to say so.
    if (hasLocalResourceUrl(html)) htmlStats.localResourceUrls.push(target.url);

    // One attribute that moves every reference on the page, so it is read
    // once for the page rather than found among the references.
    const hazard = baseHrefHazard(baseHref(html));
    if (hazard) htmlStats.baseHrefs.push(`${target.url}: ${hazard}`);

    // A framework's unbuilt `index.html`, which publishes perfectly and
    // cannot run. What is wrong with it is what it does not contain, so
    // nothing else in this report can see it.
    const shell = appShellWithoutCode(html);
    if (shell) htmlStats.appShells.push(`${target.url}: ${shell}`);

    const companions = planCompanions(target, html, companionContext);

    htmlStats.unresolved.push(...companions.broken);
    for (const refusal of companions.refused) {
      // One shared stylesheet outside the scope would otherwise be reported
      // once per page that referenced it.
      if (refusedCompanions.has(refusal.path)) continue;
      refusedCompanions.add(refusal.path);
      skipped.push(refusal);
    }
    for (const companion of companions.carry) {
      wantedCompanions.set(companion.sourcePath, companion);
    }
  }

  /*
   * And what the carried stylesheets themselves ask for: fonts, background
   * images, and whatever they `@import`. Those references live inside the
   * CSS, where the scan over a page's markup never reached them -- so a
   * built application's stylesheet used to travel and apply while its
   * webfont silently did not.
   *
   * Run after every page is planned, so a sheet shared by forty pages is
   * read once rather than forty times.
   */
  const nested = await planStylesheetTree(
    [...wantedCompanions.values()],
    companionContext,
    async (path) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return null;
      try {
        return await app.vault.read(file);
      } catch {
        return null;
      }
    },
  );
  htmlStats.unresolved.push(...nested.broken);
  for (const refusal of nested.refused) {
    if (refusedCompanions.has(refusal.path)) continue;
    refusedCompanions.add(refusal.path);
    skipped.push(refusal);
  }
  for (const companion of nested.carry) {
    wantedCompanions.set(companion.sourcePath, companion);
  }

  // Deduplicated across every page, like media: one stylesheet shared by
  // forty pages is carried once.
  for (const [path, companion] of wantedCompanions) {
    const referenced = app.vault.getAbstractFileByPath(path);
    if (!(referenced instanceof TFile)) continue;
    try {
      const data = await app.vault.readBinary(referenced);
      htmlStats.companions++;
      htmlStats.companionBytes += data.byteLength;
      files.push({ path: companion.url, content: data });
    } catch (error) {
      skipped.push({
        path,
        reason: `could not read referenced file: ${error instanceof Error ? error.message : error}`,
      });
    }
  }

  /*
   * And the folders published whole.
   *
   * After the companions, so a file that is both -- the stylesheet a page
   * links to, sitting in the folder -- is carried once, by whichever got
   * there first. They are the same bytes at the same URL either way; what
   * would be wrong is counting it twice and reporting a site larger than
   * the one that went out.
   */
  for (const file of wholePlan.carry) {
    if (wantedCompanions.has(file.sourcePath)) continue;
    const found = app.vault.getAbstractFileByPath(file.sourcePath);
    if (!(found instanceof TFile)) continue;
    try {
      const data = await app.vault.readBinary(found);
      wholeBytes += data.byteLength;
      wholeCarried++;
      files.push({ path: file.url, content: data });
    } catch (error) {
      skipped.push({
        path: file.sourcePath,
        reason: `could not read file in a folder published whole: ${
          error instanceof Error ? error.message : error
        }`,
      });
    }
  }

  // Harvested first, site.css second: ours must win where both have an
  // opinion, since the harvest is for layout we cannot re-author, not for
  // Obsidian's typography or colours.
  const harvested = await materializeMathJaxFonts(harvestCss());
  files.push(...harvested.assets);
  files.push({
    path: "assets/obsidian.css",
    content: harvestToStylesheet(harvested.rules),
  });
  // The author's own rules go last of all, which is the whole of how they
  // win: the theme's tokens are declared above them, inside a cascade layer.
  const authored = await readCustomCss(
    app.vault.adapter,
    config.customCssPath,
    config.outputFolders ?? DEFAULT_OUTPUT_FOLDERS,
    isBuildOutput,
  );
  let customCss: BuildResult["customCss"] = null;
  let siteStylesheet = siteCss(config.theme);
  if (authored.css !== null && authored.path) {
    siteStylesheet = withCustomCss(siteStylesheet, authored.css);
    customCss = { path: authored.path, bytes: authored.css.length };
  }
  if (authored.problem && authored.path) {
    skipped.push({ path: authored.path, reason: authored.problem });
  }
  files.push({ path: "assets/site.css", content: siteStylesheet });

  // One copy for the site, linked by every page, rather than a copy inside
  // each one. See `SITE_SCRIPT_PATH`.
  files.push({ path: SITE_SCRIPT_PATH, content: CLIENT_SCRIPT });

  // Wherever the overlay is on. A published build links it too now, when
  // the vault's owner asked for that; without the flag no page references
  // it and the file would be served to nobody.
  if (config.reviewOverlay) {
    files.push({ path: OVERLAY_SCRIPT_PATH, content: overlayBundle() });
  }

  /**
   * The homepage, when nothing else is standing in for it.
   *
   * A note that is -- the vault's README, or whatever the user chose -- was
   * published at `index.html` by the loop above. So was a vault's own
   * `index.html` file, and that counts for the same reason: somebody who
   * writes a front page by hand and calls it `index.html` has said what they
   * want the front page to be about as plainly as it can be said. Writing
   * the generated overview over the top of it would be the silent overwrite
   * this logic exists to prevent, one path along.
   */
  const htmlClaimsHome = htmlPlan.targets.some(
    (target) => target.url.toLowerCase() === "index.html",
  );
  if (!home.path && !htmlClaimsHome) {
    files.push({
      path: "index.html",
      content: buildPage({
        meta: {
          title: config.siteName,
          url: "index.html",
          siteName: config.siteName,
        },
        content: overviewContent(landing("index.html")),
        headings: [],
        shell: sitePageShell(),
      }),
    });
  }

  files.push({
    path: paths.browse,
    content: buildPage({
      meta: { title: "Browse", url: paths.browse, siteName: config.siteName },
      content: browseContent(landing(paths.browse), folderSlug),
      headings: [],
      shell: sitePageShell(),
    }),
  });

  files.push({
    path: paths.tags,
    content: buildPage({
      meta: { title: "Tags", url: paths.tags, siteName: config.siteName },
      content: tagsIndexContent(landing(paths.tags)),
      headings: [],
      shell: sitePageShell(),
    }),
  });

  // A tag is a page: it has a title, a count, the notes carrying it, a URL
  // worth sending someone, and a way back. An anchor in a list of hundreds
  // had none of that.
  for (const tag of tags) {
    files.push({
      path: tag.url,
      content: buildPage({
        meta: {
          title: `#${tag.name}`,
          url: tag.url,
          siteName: config.siteName,
        },
        content: tagPageContent(tag, landing(tag.url)),
        headings: [],
        shell: sitePageShell([
          { label: "Tags", url: paths.tags },
          { label: `#${tag.name}` },
        ]),
      }),
    });
  }
  // Pages would otherwise run the committed HTML through Jekyll, which
  // ignores files and folders whose names begin with an underscore -- and
  // Obsidian attachment folders are commonly named `_attachments`.
  files.push({ path: ".nojekyll", content: "" });

  // Pages takes the custom domain from this file. Writing a full tree every
  // time means omitting it would remove a domain the user had already set,
  // so it goes in whenever one is configured.
  const domain = config.customDomain?.trim();
  if (domain) files.push({ path: "CNAME", content: `${domain}\n` });

  /**
   * The two standing assertions, over our own pages only.
   *
   * A file published as-is is not ours to assert about. Its markup was
   * written by hand, so an empty `.internal-embed` in it means nothing, and
   * counting one would fail a build over a page this plugin deliberately
   * does not touch.
   */
  const publishedAsIs = new Set(htmlPlan.targets.map((target) => target.url));
  const ourPages = files.filter(
    (f) => f.path.endsWith(".html") && !publishedAsIs.has(f.path),
  );
  const invalidNesting = ourPages.reduce(
    (sum, f) => sum + countInvalidNesting(f.content as string),
    0,
  );
  const loadingPlaceholders = ourPages.reduce(
    (sum, f) => sum + countLoadingPlaceholders(f.content as string),
    0,
  );

  return {
    files,
    pages,
    skipped,
    totalMs: performance.now() - started,
    invalidNesting,
    loadingPlaceholders,
    incompletePages: pages.filter((p) => p.incomplete).length,
    basesTruncated: pages.flatMap((p) =>
      p.bases.truncated.map((t) => `${p.sourcePath} ${t}`),
    ),
    basesUnhandled: Array.from(
      new Set(pages.flatMap((p) => p.bases.unhandled)),
    ),
    privacyLeaks: pages.flatMap((p) =>
      p.privacy.leaks.map((leak) => ({ ...leak, page: p.url })),
    ),
    customCss,
    assetsPublished: wantedAssets.size,
    assetBytes,
    assetsUnresolved: Array.from(
      new Set(pages.flatMap((p) => p.assets.unresolved)),
    ),
    htmlFiles: htmlStats,
    htmlFilesNotEnabled: countHtmlFilesAvailable(app, config),
    htmlFilesBlockedByFlag: countHtmlFilesBlockedByFlag(app, config),
    excluded: excludedTally(app, config),
    dependencies: dependencyTally(app, config),
    wholeFolders: wholePlan.tallies,
    wholeFolderFiles: wholeCarried,
    wholeFolderBytes: wholeBytes,
    drift: driftSamples.length ? summarizeDrift(driftSamples) : null,
    selectedCount: selected.length,
  };
}

/**
 * What the author's excluded folders cost this build, per entry.
 *
 * Counted against what the build *would* have taken with the setting empty,
 * rather than against the vault: a folder outside the scope excludes nothing,
 * and reporting it as having done work would send somebody looking for pages
 * that were never going to be published.
 *
 * Both selectors, because both publish: a folder kept out of the site has to
 * be kept out of it whether it holds notes or the vault's own HTML.
 */
/** Installed dependencies inside the scope, as the report says them. */
export interface DependencyTally {
  /** The dependency folders found, as vault paths, in path order. */
  folders: string[];
  /** How many files are inside them, of any kind. */
  files: number;
}

/**
 * What installed dependencies inside the scope came to, so the report can
 * say the build skipped them.
 *
 * Silence would be the wrong answer twice over. Somebody whose prototype's
 * README is not on the site needs to know it was a rule rather than a
 * failure -- and somebody whose build used to take twenty minutes needs to
 * know what changed, which is the same sentence read the other way.
 *
 * Counted over every file rather than only the ones a selector would have
 * taken, because the number that means something here is how much of the
 * vault is somebody else's code.
 */
export function dependencyTally(app: App, config: SiteConfig): DependencyTally {
  const folders: string[] = [];
  const seen = new Set<string>();
  let files = 0;

  for (const file of app.vault.getFiles()) {
    if (config.folder && !file.path.startsWith(`${config.folder}/`)) continue;
    if (!isDependencyPath(file.path, config.folder)) continue;
    files++;
    const root = dependencyRoot(file.path);
    if (root && !seen.has(root)) {
      seen.add(root);
      folders.push(root);
    }
  }

  folders.sort();
  return { folders, files };
}

export function excludedTally(app: App, config: SiteConfig): ExcludeTally[] {
  const entries = parseExcludeFolders(config.excludeFolders);
  if (!entries.length) return [];

  const everything = { ...config, excludeFolders: [] };
  const paths = [
    ...selectNotes(app, everything),
    ...selectHtmlFiles(app, everything),
  ].map((file) => file.path);

  /*
   * And what a folder published whole would have taken, since the exclude
   * list beats that setting too. Counted here or this report would say an
   * entry kept nothing out while it was quietly keeping a private subfolder
   * out of a published build folder.
   */
  const wholeEntries = parseWholeFolders(config.publishWholeFolders);
  if (wholeEntries.length) {
    const plan = planWholeFolders(
      app.vault
        .getFiles()
        .map((file) => ({ path: file.path, size: file.stat?.size ?? 0 })),
      {
        entries: wholeEntries,
        folder: config.folder,
        excluded: [],
        outputFolders: config.outputFolders ?? DEFAULT_OUTPUT_FOLDERS,
        maxBytes: config.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES,
        tooBigReason: () => null,
        claimedBy: () => null,
      },
    );
    for (const file of plan.carry) paths.push(file.sourcePath);
    for (const page of plan.pages) paths.push(page);
  }

  return excludeTallies(paths, entries);
}

export function selectNotes(app: App, config: SiteConfig): TFile[] {
  const excluded = config.outputFolders ?? DEFAULT_OUTPUT_FOLDERS;
  const leftOut = parseExcludeFolders(config.excludeFolders);

  return app.vault
    .getMarkdownFiles()
    .filter((file) => {
      if (config.folder && !file.path.startsWith(`${config.folder}/`))
        return false;
      // The author's own list, which beats the scope where they disagree:
      // both are things somebody typed, and the more specific of the two is
      // the one that says "not this".
      if (isExcluded(file.path, leftOut)) return false;
      // The build's own folders are output, not input. A vault published
      // whole otherwise publishes `_vault-publisher/build-report.md` as a
      // page of the site that build just made, along with the publish log
      // and every imported review -- none of which anyone chose to publish.
      // A scope aimed inside one of those folders is exempt, which is the
      // one case where somebody asked for it by name.
      if (isBuildOutput(file.path, excluded, config.folder)) return false;
      // Obsidian hides a dot-folder and indexes it anyway, so a note in
      // `.archive` or `.trash` was invisible in the app and published by a
      // vault published whole. HTML selection has always skipped these;
      // notes never did, which was an asymmetry rather than a decision.
      if (isHiddenPath(file.path, config.folder)) return false;
      // Every package ships a README, so a vault with a prototype in it has
      // hundreds of Markdown files nobody wrote and nobody wants rendered.
      // `node_modules` has no leading dot, so the rule above cannot see it.
      // See `isDependencyPath`.
      if (isDependencyPath(file.path, config.folder)) return false;
      if (!config.requireFrontmatterFlag) return true;
      const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
      return frontmatter?.[config.requireFrontmatterFlag] === true;
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Frontmatter title wins over the filename, matching Obsidian's own habit. */
function titleFor(app: App, file: TFile): string {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  // Obsidian types frontmatter as `any`, so this is the boundary where that
  // stops: `unknown` forces the check below to be the thing that decides.
  const title: unknown = frontmatter?.title;
  return typeof title === "string" && title.trim()
    ? title.trim()
    : file.basename;
}

/**
 * A note as navigation sees it.
 *
 * `updated` prefers a frontmatter date over the file's own mtime, and the
 * reason is that mtime is not a record of editing: sync, a plugin rewriting
 * frontmatter, or a vault copied to a new machine all touch it. A date the
 * author wrote is a claim about the note; an mtime is a claim about the
 * filesystem.
 */
function navNoteFor(
  app: App,
  file: TFile,
  url: string,
  title: string,
  config: SiteConfig,
): NavNote {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  const slash = url.lastIndexOf("/");

  return {
    url,
    title,
    folder: slash === -1 ? "" : url.slice(0, slash),
    updated: stampFor(frontmatter?.[config.updatedProperty ?? "updated"], file),
    pinned: frontmatter?.[config.pinnedProperty ?? "pinned"] === true,
  };
}

/** `YYYY-MM-DDTHH:MM`, which is the resolution batch detection needs. */
function stampFor(value: unknown, file: TFile): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.length >= 16
      ? value.slice(0, 16)
      : `${value.slice(0, 10)}T12:00`;
  }
  const mtime = file.stat?.mtime;
  if (!mtime) return null;
  return new Date(mtime).toISOString().slice(0, 16);
}

function tagsFor(app: App, file: TFile): string[] {
  const cache = app.metadataCache.getFileCache(file);
  const inline = (cache?.tags ?? []).map((tag) => tag.tag.replace(/^#/, ""));
  const front: unknown = cache?.frontmatter?.tags;
  const declared = Array.isArray(front)
    ? front.map(String)
    : typeof front === "string"
      ? front.split(/[,\s]+/).filter(Boolean)
      : [];
  return Array.from(
    new Set([...inline, ...declared].map((tag) => tag.replace(/^#/, ""))),
  ).filter(Boolean);
}

/** Words in the rendered note, for the rail's one line of fact. */
export function countWords(html: string): number {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");
  return text.split(/\s+/).filter(Boolean).length;
}

function countMatches(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

/**
 * The few facts a note carries about itself.
 *
 * Only what the build was asked for: the date key the user named, the links
 * it actually resolved, and the tags already in the vault. Everything else in
 * the frontmatter was removed before this ran, which is the half that
 * matters -- see `stripFrontmatter`.
 */
function noteHeader(
  page: { nav: NavNote; tags: string[]; outgoing: Array<{ url: string }> },
  incoming: number,
  tagUrlByName: Map<string, string>,
): Array<{
  label: string;
  value: string;
  tags?: Array<{ name: string; url: string }>;
}> {
  const header: Array<{
    label: string;
    value: string;
    tags?: Array<{ name: string; url: string }>;
  }> = [];

  if (page.nav.updated) {
    const day = formatDay(page.nav.updated);
    if (day) header.push({ label: "Updated", value: day });
  }

  const outgoing = new Set(page.outgoing.map((link) => link.url)).size;
  if (incoming || outgoing) {
    header.push({
      label: "Links",
      value: `${incoming} in \u00b7 ${outgoing} out`,
    });
  }

  // A tag with no page is one no published note carries, which cannot happen
  // -- the counts are built from these same notes. Dropped rather than linked
  // nowhere, because "cannot happen" is not a reason to emit a broken link.
  const tags = page.tags
    .map((name) => ({ name, url: tagUrlByName.get(name) }))
    .filter((tag): tag is { name: string; url: string } => Boolean(tag.url));
  if (tags.length) header.push({ label: "", value: "", tags });

  return header;
}
