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
 * Both bounds are wall-clock, and wall-clock is not the same as work done:
 * these timers only fire when the event loop is free, so a busy vault can
 * stretch a 250ms quiet period into seconds and push a 10s cap well past 10s.
 * Measured 59s on a note whose own rendering was finished in 886ms, purely
 * from contention with other plugins. The caller therefore gets `settled`
 * *and* the elapsed time, and should treat a long elapsed with few mutations
 * as a busy app rather than a slow note.
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
    };
  }

  const result = await new Promise<SettleResult>((resolve) => {
    let mutations = 0;
    let lastMutationAtMs: number | null = null;
    let quietTimer: number | null = null;
    let hardTimer: number | null = null;
    let done = false;

    const finish = (settled: boolean) => {
      if (done) return;
      done = true;
      if (quietTimer !== null) window.clearTimeout(quietTimer);
      if (hardTimer !== null) window.clearTimeout(hardTimer);
      observer.disconnect();
      resolve({
        settled,
        mutations,
        elapsedMs: performance.now() - started,
        assetMs: 0,
        lastMutationAtMs,
        skipped: false,
        pendingAtEnd: countPendingPlaceholders(el),
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
      if (quietTimer !== null) window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(() => {
        const pending = countPendingPlaceholders(el);

        if (pending > 0 && pending !== lastPendingCount) {
          lastPendingCount = pending;
          armQuietTimer();
          return;
        }

        finish(true);
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
        finish(true);
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

    hardTimer = window.setTimeout(() => finish(false), timeoutMs);
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
