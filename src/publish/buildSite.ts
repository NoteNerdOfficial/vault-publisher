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
import { countInvalidNesting } from "./normalize";
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

  const files: PublishFile[] = [];
  const pages: PageResult[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const driftSamples: DriftSample[] = [];

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

  const invalidNesting = files
    .filter((f) => f.path.endsWith(".html"))
    .reduce((sum, f) => sum + countInvalidNesting(f.content as string), 0);

  return {
    files,
    pages,
    skipped,
    totalMs: performance.now() - started,
    invalidNesting,
    incompletePages: pages.filter((p) => p.incomplete).length,
    basesTruncated: pages.flatMap((p) =>
      p.bases.truncated.map((t) => `${p.sourcePath} ${t}`),
    ),
    basesUnhandled: Array.from(
      new Set(pages.flatMap((p) => p.bases.unhandled)),
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

function buildIndex(config: SiteConfig, pages: PageResult[]): string {
  const items = pages
    .map(
      (page) =>
        `<li><a href="${page.url}">${escapeHtml(page.title)}<span class="osp-index-path">${escapeHtml(page.url)}</span></a></li>`,
    )
    .join("\n        ");

  return buildPage({
    meta: {
      title: config.siteName,
      url: "index.html",
      siteName: config.siteName,
    },
    content: `<ul class="osp-index">\n        ${items}\n      </ul>`,
    headings: [],
  });
}
