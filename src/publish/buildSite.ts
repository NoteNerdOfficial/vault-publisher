import { App, TFile } from "obsidian";
import { createRenderHost, renderFile } from "../render/renderNote";
import { waitForDataviewIndex } from "../render/settle";
import { withDataviewRefreshSuspended } from "../render/dataviewRefresh";
import { LinkResolver, LinkTarget, rewriteLinks } from "./links";
import {
  assignHeadingIds,
  buildPage,
  dropRedundantTitleHeading,
  escapeHtml,
  prepareCollapsibleCallouts,
  stripFrontmatter,
} from "./page";
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
  assetUrl,
  collectAssets,
  emptyAssetStats,
} from "./assets";
import { stabilizeIds, stripDebugAttributes } from "./stableIds";
import { Mention, OutgoingLinks, buildBacklinkIndex, relatedNotes } from "./backlinks";
import { buildLocalGraph } from "./graph";
import {
  NavNote,
  buildNavTree,
  collectTags,
  formatDay,
  recencyBuckets,
} from "./nav";
import { folderSlug } from "./shell";
import { encodeUrlPath } from "./urls";
import { siteCss } from "./theme";
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
  /** Theme name from themes.ts. Falls back to the default when unknown. */
  theme?: string;
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
  /** Media files copied into the site. */
  assetsPublished: number;
  /** Total bytes of media, so a publish can say what it is uploading. */
  assetBytes: number;
  /** References that looked like vault media but could not be resolved. */
  assetsUnresolved: string[];
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
  const targets: LinkTarget[] = selected.map((file) => ({
    sourcePath: file.path,
    url: urlForNote(file.path, config.folder),
  }));
  const resolver = new LinkResolver(targets);

  // Everything in the vault that is *not* being published, by name, so a
  // query result can be recognised as belonging to a note the reader was
  // never meant to see.
  const published = new Set(selected.map((file) => file.path));
  const unpublishedByName = new Map<string, string>();
  for (const file of app.vault.getMarkdownFiles()) {
    if (published.has(file.path)) continue;
    unpublishedByName.set(file.basename.toLowerCase(), file.path);
  }
  // Compiled once here, not once per page: see `indexUnpublished`.
  const unpublished = indexUnpublished(unpublishedByName);

  const files: PublishFile[] = [];
  const pages: PageResult[] = [];
  const skipped: { path: string; reason: string }[] = [];

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

        const url = urlForNote(file.path, config.folder);
        let headings: ReturnType<typeof assignHeadingIds> = [];
        let unresolvedTargets: string[] = [];
        let outgoing: Array<{ url: string; context: string }> = [];

        const title = titleFor(app, file);
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
            !renderedNote.settle.settled && renderedNote.settle.pendingAtEnd > 0,
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
  const navTree = buildNavTree(navNotes);
  const pinned = navNotes.filter((note) => note.pinned);
  const recency = recencyBuckets(navNotes, config.now ?? new Date());
  const tags = collectTags(rendered.map((page) => ({ url: page.url, tags: page.tags })));
  const titles = new Map(rendered.map((page) => [page.url, page.title]));

  const outgoing: OutgoingLinks[] = rendered.map((page) => ({
    url: page.url,
    title: page.title,
    links: page.outgoing,
  }));
  const backlinks = buildBacklinkIndex(outgoing);
  const outgoingByUrl = new Map(outgoing.map((page) => [page.url, page]));

  for (const page of rendered) {
    const mentions: Mention[] = backlinks.get(page.url) ?? [];
    const related = relatedNotes(page.url, outgoingByUrl.get(page.url), mentions, titles);
    const words = countWords(page.html);

    files.push({
      path: page.url,
      content: buildPage({
        meta: {
          title: page.title,
          url: page.url,
          siteName: config.siteName,
          properties: noteHeader(page, mentions.length),
        },
        content: page.html,
        headings: page.headings,
        shell: {
          nav: navTree,
          pinned,
          recency,
          tags,
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
            sections: page.headings.filter((heading) => heading.level === 2).length,
          },
          today: config.now ?? new Date(),
          noteCount: navNotes.length,
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

  // Harvested first, site.css second: ours must win where both have an
  // opinion, since the harvest is for layout we cannot re-author, not for
  // Obsidian's typography or colours.
  const harvested = await materializeMathJaxFonts(harvestCss());
  files.push(...harvested.assets);
  files.push({
    path: "assets/obsidian.css",
    content: harvestToStylesheet(harvested.rules),
  });
  files.push({ path: "assets/site.css", content: siteCss(config.theme) });
  files.push({
    path: "index.html",
    content: buildIndex(config, pages, rendered, {
      nav: navTree,
      pinned,
      recency,
      tags,
      today: config.now ?? new Date(),
      noteCount: navNotes.length,
    }),
  });
  // Pages would otherwise run the committed HTML through Jekyll, which
  // ignores files and folders whose names begin with an underscore -- and
  // Obsidian attachment folders are commonly named `_attachments`.
  files.push({ path: ".nojekyll", content: "" });

  // Pages takes the custom domain from this file. Writing a full tree every
  // time means omitting it would remove a domain the user had already set,
  // so it goes in whenever one is configured.
  const domain = config.customDomain?.trim();
  if (domain) files.push({ path: "CNAME", content: `${domain}\n` });

  const htmlFiles = files.filter((f) => f.path.endsWith(".html"));
  const invalidNesting = htmlFiles.reduce(
    (sum, f) => sum + countInvalidNesting(f.content as string),
    0,
  );
  const loadingPlaceholders = htmlFiles.reduce(
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
    assetsPublished: wantedAssets.size,
    assetBytes,
    assetsUnresolved: Array.from(
      new Set(pages.flatMap((p) => p.assets.unresolved)),
    ),
    drift: driftSamples.length ? summarizeDrift(driftSamples) : null,
    selectedCount: selected.length,
  };
}

export function selectNotes(app: App, config: SiteConfig): TFile[] {
  return app.vault
    .getMarkdownFiles()
    .filter((file) => {
      if (config.folder && !file.path.startsWith(`${config.folder}/`))
        return false;
      if (!config.requireFrontmatterFlag) return true;
      const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
      return frontmatter?.[config.requireFrontmatterFlag] === true;
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Frontmatter title wins over the filename, matching Obsidian's own habit. */
function titleFor(app: App, file: TFile): string {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  const title = frontmatter?.title;
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
    return value.length >= 16 ? value.slice(0, 16) : `${value.slice(0, 10)}T12:00`;
  }
  const mtime = file.stat?.mtime;
  if (!mtime) return null;
  return new Date(mtime).toISOString().slice(0, 16);
}

function tagsFor(app: App, file: TFile): string[] {
  const cache = app.metadataCache.getFileCache(file);
  const inline = (cache?.tags ?? []).map((tag) => tag.tag.replace(/^#/, ""));
  const front = cache?.frontmatter?.tags;
  const declared = Array.isArray(front)
    ? front.map(String)
    : typeof front === "string"
      ? front.split(/[,\s]+/).filter(Boolean)
      : [];
  return Array.from(new Set([...inline, ...declared].map((tag) => tag.replace(/^#/, "")))).filter(
    Boolean,
  );
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
 * The site's front page.
 *
 * A flat list of every file was fine for seven test notes and is useless at
 * three hundred: it tells a reader the vault has a lot in it and nothing
 * about what. So pages are grouped by the folder they came from, which is
 * the structure the author already made and the one they will recognise.
 *
 * Pages at the top level lead, because a vault's loose notes are usually its
 * entry points, and folders follow in alphabetical order.
 */
function buildIndex(
  config: SiteConfig,
  pages: PageResult[],
  tagged: Array<{ url: string; title: string; tags: string[] }>,
  shell: IndexShell,
): string {
  const groups = new Map<string, PageResult[]>();
  for (const page of pages) {
    const slash = page.url.lastIndexOf("/");
    const group = slash === -1 ? "" : page.url.slice(0, slash);
    const bucket = groups.get(group);
    if (bucket) bucket.push(page);
    else groups.set(group, [page]);
  }

  const ordered = Array.from(groups.entries()).sort(([a], [b]) => {
    if (a === "") return -1;
    if (b === "") return 1;
    return a.localeCompare(b);
  });

  const sections = ordered
    .map(([group, items]) => {
      const heading = group
        ? `<h2 class="osp-index-group" id="folder-${escapeHtml(folderSlug(group))}">${escapeHtml(group.replace(/\//g, " / "))}</h2>`
        : "";
      const list = items
        .map(
          (page) =>
            `<li class="osp-index-item"><a href="${escapeHtml(
              encodeUrlPath(page.url),
            )}">${escapeHtml(page.title)}</a></li>`,
        )
        .join("\n          ");
      return `${heading}\n        <ul class="osp-index">\n          ${list}\n        </ul>`;
    })
    .join("\n        ");

  const count = pages.length;
  const lead = `<p class="osp-index-lead">${count} ${count === 1 ? "page" : "pages"}.</p>`;

  return buildPage({
    meta: {
      title: config.siteName,
      url: "index.html",
      siteName: config.siteName,
    },
    content: `${lead}\n        ${recentIndex(shell)}${tagIndex(shell, tagged)}${sections}`,
    headings: [],
    shell: {
      ...shell,
      backlinks: [],
      related: [],
      graph: { nodes: [], edges: [], centre: { title: config.siteName, x: 0, y: 0 }, width: 0, height: 0 },
      stats: { words: 0, readingMinutes: 1, sections: 0 },
    },
  });
}

type IndexShell = Omit<
  Parameters<typeof buildPage>[0]["shell"] & object,
  "backlinks" | "related" | "graph" | "stats"
>;

/**
 * Every recently-edited note, in full.
 *
 * The panel's recency list is capped and collapsed, which is right for a
 * sidebar and wrong as the only answer: its "show all" has to land somewhere
 * that actually shows them all, and this is it.
 */
function recentIndex(shell: IndexShell): string {
  if (!shell.recency.length) return "";
  return (
    `<h2 class="osp-index-group" id="recent">Recently updated</h2>\n        ` +
    shell.recency
      .map(
        (bucket) =>
          `<h3 class="osp-index-bucket">${bucket.label}<span class="osp-num">${bucket.count}</span></h3>` +
          `<ul class="osp-index">` +
          bucket.rows
            .flatMap((row) => (row.kind === "batch" ? row.notes : [row.note]))
            .map(
              (note) =>
                `<li class="osp-index-item"><a href="${escapeHtml(encodeUrlPath(note.url))}">` +
                `${escapeHtml(note.title)}</a></li>`,
            )
            .join("") +
          `</ul>`,
      )
      .join("\n        ") +
    "\n        "
  );
}

/**
 * Where a tag goes.
 *
 * The panel offers tags as somewhere to go, and a chip that scrolls to
 * another chip is not somewhere. So each tag is a section with the notes
 * carrying it, and the cloud at the top is the way into them.
 */
function tagIndex(
  shell: IndexShell,
  tagged: Array<{ url: string; title: string; tags: string[] }>,
): string {
  if (!shell.tags.length) return "";

  const notesFor = (name: string) =>
    tagged.filter((page) => page.tags.includes(name));

  return (
    `<h2 class="osp-index-group" id="tags">Tags</h2>\n        <div class="osp-tagcloud">` +
    shell.tags
      .map(
        (tag) =>
          `<a class="osp-tag" href="#tag-${escapeHtml(tag.name)}">#${escapeHtml(tag.name)}` +
          `<span class="osp-num">${tag.count}</span></a>`,
      )
      .join("") +
    `</div>\n        ` +
    shell.tags
      .map(
        (tag) =>
          `<h3 class="osp-index-bucket" id="tag-${escapeHtml(tag.name)}">#${escapeHtml(tag.name)}` +
          `<span class="osp-num">${tag.count}</span></h3>` +
          `<ul class="osp-index">` +
          notesFor(tag.name)
            .map(
              (page) =>
                `<li class="osp-index-item"><a href="${escapeHtml(encodeUrlPath(page.url))}">` +
                `${escapeHtml(page.title)}</a></li>`,
            )
            .join("") +
          `</ul>`,
      )
      .join("\n        ") +
    "\n        "
  );
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
): Array<{ label: string; value: string; tags?: string[] }> {
  const header: Array<{ label: string; value: string; tags?: string[] }> = [];

  if (page.nav.updated) {
    const day = formatDay(page.nav.updated);
    if (day) header.push({ label: "Updated", value: day });
  }

  const outgoing = new Set(page.outgoing.map((link) => link.url)).size;
  if (incoming || outgoing) {
    header.push({ label: "Links", value: `${incoming} in \u00b7 ${outgoing} out` });
  }

  if (page.tags.length) header.push({ label: "", value: "", tags: page.tags });

  return header;
}


