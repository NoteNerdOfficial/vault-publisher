import { sharedScheduler } from "./scheduler";

/**
 * Waiting for asynchronous plugin output to finish.
 *
 * Obsidian's MarkdownRenderer.render() resolves when the *markdown* has been
 * turned into DOM, not when the code-block post-processors that plugins
 * register have finished. Dataview resolves a query, Mermaid lays out a
 * diagram and Bases builds a table well after that promise settles, each on
 * its own schedule and with no shared completion signal.
 *
 * So we watch the subtree instead and treat "nothing changed for a while" as
 * done. A quiet period is a heuristic, not a guarantee: too short and we
 * serialize a half-built table, too long and a 500-note publish crawls. The
 * numbers in DEFAULT_SETTLE live here so they can be tuned from measurements
 * rather than guessed at each call site.
 */

export interface SettleOptions {
  /** No mutations for this long means the subtree is considered settled. */
  quietMs: number;
  /** Hard cap on waiting, whether or not it ever goes quiet. */
  timeoutMs: number;
  /** Also wait for <img> loads and webfonts before returning. */
  waitForAssets: boolean;
}

export const DEFAULT_SETTLE: SettleOptions = {
  // Measured: Dataview builds a table's structure at ~1s and fills its cells
  // at ~2.7s, with a gap of well over a second in between. A 250ms quiet
  // period declared the render finished inside that gap and serialized a
  // table of empty <span>s -- structurally perfect, entirely contentless.
  // The quiet period alone cannot tell "paused" from "finished", which is why
  // `hasPendingPlaceholders` now has the final say.
  quietMs: 400,
  timeoutMs: 20_000,
  waitForAssets: true,
};

/**
 * Markup that is present but visibly unfinished.
 *
 * Dataview creates a cell's <span> and fills it from a second async pass, so
 * an empty one inside a result block means the render is still in flight.
 * Obsidian's embeds announce the same thing through a missing `is-loaded`,
 * and a Mermaid wrapper with no <svg> has not been handed to Mermaid yet.
 */
export function countPendingPlaceholders(el: HTMLElement): number {
  let pending = 0;

  for (const block of Array.from(
    el.querySelectorAll(".block-language-dataview, .block-language-dataviewjs, .bases-embed, .bases-view"),
  )) {
    for (const span of Array.from(block.querySelectorAll("span"))) {
      if (!span.children.length && !(span.textContent ?? "").trim()) pending++;
    }
  }

  pending += el.querySelectorAll(
    ".internal-embed:not(.is-loaded):not(.bases-embed)",
  ).length;

  for (const wrapper of Array.from(el.querySelectorAll(".mermaid-wrapper"))) {
    // A guarded diagram is finished, just not permitted; waiting changes
    // nothing and the probe reports it separately.
    if (wrapper.classList.contains("is-guarded")) continue;
    if (!wrapper.querySelector("svg")) pending++;
  }

  return pending;
}

/**
 * Markup that says a block has not been processed yet.
 *
 * Obsidian hands a fenced block to its post-processor and the original
 * `<pre><code>` is replaced. While it is still there, the plugin has not run,
 * so a completeness check that only looked at rendered output would call the
 * note finished before anything had started.
 */
const UNPROCESSED_SELECTOR = [
  "pre > code.language-mermaid",
  "pre > code.language-dataview",
  "pre > code.language-dataviewjs",
  "pre > code.language-datacore",
  "pre > code.language-datacorejs",
  "pre > code.language-base",
]
  // `is-loaded` is Obsidian saying it has finished with the block. A fenced
  // mermaid block can legitimately stay a code block -- shown as source
  // rather than drawn -- and the first version of this selector matched those
  // forever, so the note could never complete from content and waited out the
  // full timer. The exact bug this function exists to remove.
  .map((selector) => `${selector}:not(.is-loaded)`)
  .join(",");

/** Blocks whose content arrives asynchronously and whose state we can read. */
const RESULT_BLOCK_SELECTOR = [
  ".block-language-dataview",
  ".block-language-dataviewjs",
  ".block-language-datacore",
  ".block-language-datacorejs",
  ".block-language-base",
  ".bases-embed",
  ".bases-view",
].join(",");

/**
 * True when every asynchronous block in the subtree has reached a state it
 * will not leave.
 *
 * This is the difference between finishing because the content is ready and
 * finishing because a clock ran out, and it is the whole fix for a
 * backgrounded publish. `waitForSettle` previously had only one content-aware
 * exit: "we saw placeholders, and now there are none." That cannot fire for a
 * block which never produces a placeholder at all.
 *
 * A guarded Mermaid diagram is exactly that case, and the worst one. It is
 * *terminal* -- consent was refused, the wrapper will never gain an `<svg>` --
 * yet `countPendingPlaceholders` rightly does not count it as pending, so the
 * early exit stayed dead and the note waited out the full timer. The block
 * that most deserved an instant answer was the slowest in the build.
 *
 * Embeds had a quieter version of the same problem: one already loaded when
 * the wait began registered no placeholder either, so a note that was finished
 * on arrival still paid the quiet period.
 */
export function isContentComplete(el: HTMLElement): boolean {
  // Anything still in its source form means the post-processor has not run.
  if (el.querySelector(UNPROCESSED_SELECTOR)) return false;

  for (const wrapper of Array.from(el.querySelectorAll(".mermaid-wrapper"))) {
    // Guarded is a finished state, not a pending one: waiting cannot change
    // it, and the probe reports it separately.
    if (wrapper.classList.contains("is-guarded")) continue;
    if (!wrapper.querySelector("svg")) return false;
  }

  if (el.querySelector(".internal-embed:not(.is-loaded):not(.bases-embed)")) {
    return false;
  }

  for (const block of Array.from(el.querySelectorAll(RESULT_BLOCK_SELECTOR))) {
    // A block with nothing in it yet has been created but not filled, which
    // looks identical to a finished empty result from the outside. Treating
    // it as unfinished costs a wait; treating it as finished would publish a
    // blank table, which is the failure this whole module exists to prevent.
    if (!block.childElementCount && !(block.textContent ?? "").trim()) {
      return false;
    }
  }

  return countPendingPlaceholders(el) === 0;
}

export interface SettleResult {
  /** False means we hit timeoutMs with the subtree still changing. */
  settled: boolean;
  /** Mutation records seen. A useful smell: 0 means nothing rendered async. */
  mutations: number;
  /** Total wait, including the trailing quiet period and asset wait. */
  elapsedMs: number;
  /** Of which was spent waiting on images and webfonts. */
  assetMs: number;
  /** When the last mutation landed, relative to the start of the wait. */
  lastMutationAtMs: number | null;
  /** True when the wait was skipped because nothing renders asynchronously. */
  skipped: boolean;
  /** How the wait ended. Tells a fast publish from a lucky one. */
  reason: "fast-path" | "content-complete" | "quiet" | "timeout";
  /** Placeholders still unfilled when the wait ended. Above zero means the
   * page serialized with visibly incomplete content. */
  pendingAtEnd: number;
}

/**
 * Markup that signals a block whose content arrives after the render promise.
 * A note containing none of these has already finished, so waiting on it only
 * spends time -- and most notes in a vault are plain prose.
 */
const ASYNC_BLOCK_SELECTOR = [
  ".block-language-dataview",
  ".block-language-dataviewjs",
  ".block-language-datacore",
  ".block-language-datacorejs",
  ".block-language-base",
  ".bases-embed",
  ".bases-view",
  ".mermaid-wrapper",
  ".mermaid",
  ".internal-embed",
  ".markdown-embed",
  "pre > code.language-mermaid",
  "img:not([src^='data:'])",
].join(",");

/** True when the subtree holds nothing known to finish asynchronously. */
export function isAlreadyComplete(el: HTMLElement): boolean {
  return el.querySelector(ASYNC_BLOCK_SELECTOR) === null;
}

/**
 * Resolves once `el`'s subtree has stopped changing for `quietMs`, or at
 * `timeoutMs`, whichever comes first.
 *
 * Both bounds are wall-clock, and wall-clock is not the same as work done.
 * The timers run in a worker (see scheduler.ts) because a hidden window
 * clamps the page's own timers to roughly one wake-up a minute, which turned
 * a 20s cap into 60s and made a 300-note build spend 99% of its time waiting.
 *
 * The timers are the fallback, not the mechanism. `isContentComplete` ends
 * most waits the moment the content is actually ready, and `reason` on the
 * result says which path a note took, so a fast publish can be told apart
 * from a lucky one.
 */
export async function waitForSettle(
  el: HTMLElement,
  options: Partial<SettleOptions> = {},
): Promise<SettleResult> {
  const { quietMs, timeoutMs, waitForAssets } = { ...DEFAULT_SETTLE, ...options };
  const started = performance.now();

  // The fast path. Nothing in the subtree renders asynchronously, so there is
  // nothing to wait for and the quiet period would be pure latency.
  if (isAlreadyComplete(el)) {
    return {
      settled: true,
      mutations: 0,
      elapsedMs: performance.now() - started,
      assetMs: 0,
      lastMutationAtMs: null,
      skipped: true,
      pendingAtEnd: 0,
      reason: "fast-path",
    };
  }

  // Already finished before the first observer callback: an embed that was
  // cached, or a diagram the vault refuses to render. Waiting on these was
  // pure latency, paid once per note across the whole vault.
  if (isContentComplete(el)) {
    return {
      settled: true,
      mutations: 0,
      elapsedMs: performance.now() - started,
      assetMs: 0,
      lastMutationAtMs: null,
      skipped: false,
      pendingAtEnd: 0,
      reason: "content-complete",
    };
  }

  const timers = sharedScheduler();

  const result = await new Promise<SettleResult>((resolve) => {
    let mutations = 0;
    let lastMutationAtMs: number | null = null;
    let quietTimer: number | null = null;
    let hardTimer: number | null = null;
    let done = false;

    const finish = (settled: boolean, reason: SettleResult["reason"]) => {
      if (done) return;
      done = true;
      if (quietTimer !== null) timers.clearTimeout(quietTimer);
      if (hardTimer !== null) timers.clearTimeout(hardTimer);
      observer.disconnect();
      resolve({
        settled,
        mutations,
        elapsedMs: performance.now() - started,
        assetMs: 0,
        lastMutationAtMs,
        skipped: false,
        pendingAtEnd: countPendingPlaceholders(el),
        reason,
      });
    };

    // Placeholder count at the previous quiet moment. Comparing across quiet
    // windows is what makes this terminate: a count that is still falling
    // means work is happening and we keep waiting, while a count that has not
    // moved means those elements are legitimately empty and never will.
    let lastPendingCount = -1;

    // Whether a placeholder has been seen at any point, not just at the
    // start. Sampling once was a bug: a dataviewjs block has not created its
    // cells yet when the wait begins, so the count was zero, the early exit
    // was disabled for the whole render, and the note fell back to waiting
    // out the clock. "Have we ever seen one?" is the question that makes the
    // signal usable for blocks that appear late.
    let sawPlaceholders = countPendingPlaceholders(el) > 0;

    const armQuietTimer = () => {
      if (quietTimer !== null) timers.clearTimeout(quietTimer);
      quietTimer = timers.setTimeout(() => {
        const pending = countPendingPlaceholders(el);

        if (pending > 0 && pending !== lastPendingCount) {
          lastPendingCount = pending;
          armQuietTimer();
          return;
        }

        finish(true, "quiet");
      }, quietMs);
    };

    const observer = new MutationObserver((records) => {
      mutations += records.length;
      lastMutationAtMs = performance.now() - started;

      // Dataview re-runs its queries on a timer -- `refreshInterval`, 2500ms
      // by default -- so a note containing one is never finished and its
      // subtree never goes quiet. Waiting for calm there just runs out the
      // clock. Once every placeholder we have seen has filled, the content is
      // complete and there is nothing left to wait for.
      const pendingNow = countPendingPlaceholders(el);
      if (pendingNow > 0) {
        sawPlaceholders = true;
      } else if (sawPlaceholders) {
        finish(true, "content-complete");
        return;
      }

      // The broader test: every async block has reached a state it will not
      // leave. This catches the blocks that never register as pending at all,
      // which is what left guarded diagrams waiting out the full timer.
      if (isContentComplete(el)) {
        finish(true, "content-complete");
        return;
      }

      armQuietTimer();
    });

    // attributes and characterData matter as much as childList here: Dataview
    // mutates cell text in place, and Mermaid sets width/height on its <svg>
    // after the element is already in the tree.
    observer.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    hardTimer = timers.setTimeout(() => finish(false, "timeout"), timeoutMs);
    armQuietTimer();
  });

  let assetMs = 0;
  if (waitForAssets) {
    const assetStart = performance.now();
    await waitForPendingAssets(el);
    assetMs = performance.now() - assetStart;
  }
  return { ...result, assetMs, elapsedMs: performance.now() - started };
}

/**
 * Images that are still loading would serialize with no intrinsic size, which
 * breaks any layout that depends on their aspect ratio. Fonts matter for the
 * same reason on anything we later measure.
 */
async function waitForPendingAssets(el: HTMLElement): Promise<void> {
  const pending: Promise<unknown>[] = [];

  for (const img of Array.from(el.querySelectorAll("img"))) {
    if (img.complete) continue;
    pending.push(
      new Promise<void>((resolve) => {
        // Resolve on error too: a broken image is a rendering problem to
        // report, not a reason to stall the whole publish.
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      }),
    );
  }

  if (document.fonts?.status === "loading") pending.push(document.fonts.ready);
  if (pending.length) await Promise.all(pending);
}

/**
 * Dataview answers queries from its own index, which it builds on load. A
 * query rendered before the index is ready returns nothing, silently, so a
 * publish started too early would push empty tables over good ones. Resolves
 * true once the index is ready, false if Dataview is absent or never signals.
 */
export async function waitForDataviewIndex(
  app: {
    plugins?: { plugins?: Record<string, unknown> };
    metadataCache: {
      on(name: string, cb: () => void): unknown;
      offref(ref: unknown): void;
    };
  },
  timeoutMs = 30_000,
): Promise<boolean> {
  const dataview = app.plugins?.plugins?.["dataview"] as
    | { index?: { initialized?: boolean }; api?: { index?: { initialized?: boolean } } }
    | undefined;
  if (!dataview) return false;

  const initialized =
    dataview.index?.initialized ?? dataview.api?.index?.initialized ?? false;
  if (initialized) return true;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const ref = app.metadataCache.on("dataview:index-ready", () => {
      if (settled) return;
      settled = true;
      app.metadataCache.offref(ref);
      resolve(true);
    });
    window.setTimeout(() => {
      if (settled) return;
      settled = true;
      app.metadataCache.offref(ref);
      resolve(false);
    }, timeoutMs);
  });
}
