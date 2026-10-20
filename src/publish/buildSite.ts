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
} from "./page";
import { harvestCss, harvestToStylesheet } from "./harvestCss";
import { BasesStats, emptyBasesStats, reemitBases } from "./bases";
import {
  DriftReport,
  DriftSample,
  heapBytes,
  isControlNote,
  summarizeDrift,
} from "./drift";
import { countInvalidNesting, countLoadingPlaceholders } from "./normalize";
import { Leak, PrivacyReport, emptyPrivacyReport, scanForLeaks } from "./privacy";
import { AssetStats, assetUrl, collectAssets, emptyAssetStats } from "./assets";
import { stabilizeIds, stripDebugAttributes } from "./stableIds";
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
  /** Only notes under this folder are published. Empty means the whole vault. */
  folder: string;
  /** When set, a note must also have this frontmatter key set to true. */
  requireFrontmatterFlag: string | null;
  /** Theme name from themes.ts. Falls back to the default when unknown. */
  theme?: string;
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
}

/** Vault path to published URL. Keeps folder structure, swaps the extension. */
export function urlForNote(sourcePath: string, folder: string): string {
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
  const unpublished = new Map<string, string>();
  for (const file of app.vault.getMarkdownFiles()) {
    if (published.has(file.path)) continue;
    unpublished.set(file.basename.toLowerCase(), file.path);
  }

  const files: PublishFile[] = [];
  const pages: PageResult[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const driftSamples: DriftSample[] = [];

  // Media is deduplicated across the whole site: one picture used by forty
  // notes is uploaded once.
  const wantedAssets = new Map<string, TFile>();

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

        const title = titleFor(app, file);
        let bases = emptyBasesStats();
        let privacy = emptyPrivacyReport();
        let assets = emptyAssetStats();
        const rendered = await renderFile(app, file, host, {
          transform: (container) => {
            dropRedundantTitleHeading(container, title);
            // Before link rewriting: re-emitting moves cell nodes rather than
            // flattening them to text, so the `.internal-link` elements a
            // Bases cell contains are still there for the rewriter to find.
            bases = reemitBases(container);
            headings = assignHeadingIds(container);
            unresolvedTargets = rewriteLinks(
              container,
              resolver,
              url,
            ).unresolvedTargets;
            assets = collectAssets(app, container, file.path, url, {
              want: (asset) => wantedAssets.set(asset.path, asset),
            });
            // After rewriting, so downgraded links are visible as such.
            privacy = scanForLeaks(container, unpublished);
            // Last, so nothing downstream is holding a reference to an id
            // that is about to change.
            stabilizeIds(container);
            stripDebugAttributes(container);
          },
        });

        if (rendered.error) {
          skipped.push({
            path: file.path,
            reason: rendered.error.split("\n")[0],
          });
          continue;
        }

        files.push({
          path: url,
          content: buildPage({
            meta: { title, url, siteName: config.siteName },
            content: rendered.html,
            headings,
          }),
        });

        pages.push({
          sourcePath: file.path,
          url,
          title,
          unresolvedTargets,
          guarded: countMatches(rendered.html, "mermaid-guard-title"),
          errored: countMatches(rendered.html, "dataview-error"),
          renderMs: rendered.renderMs,
          totalMs: rendered.totalMs,
          pending: rendered.settle.pendingAtEnd,
          incomplete:
            !rendered.settle.settled && rendered.settle.pendingAtEnd > 0,
          bases,
          privacy,
          assets,
          settleReason: rendered.settle.reason,
        });

        // Control notes are identical and contain nothing asynchronous, so
        // their render time tracks the environment rather than the content.
        if (isControlNote(file.path)) {
          driftSamples.push({
            path: file.path,
            index,
            renderMs: rendered.renderMs,
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
  files.push({
    path: "assets/obsidian.css",
    content: harvestToStylesheet(harvestCss()),
  });
  files.push({ path: "assets/site.css", content: siteCss(config.theme) });
  files.push({ path: "index.html", content: buildIndex(config, pages) });
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
  };
}

function selectNotes(app: App, config: SiteConfig): TFile[] {
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
function buildIndex(config: SiteConfig, pages: PageResult[]): string {
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
        ? `<h2 class="osp-index-group">${escapeHtml(group.replace(/\//g, " / "))}</h2>`
        : "";
      const list = items
        .map(
          (page) =>
            `<li class="osp-index-item"><a href="${page.url}">${escapeHtml(page.title)}</a></li>`,
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
    content: `${lead}\n        ${sections}`,
    headings: [],
  });
}

