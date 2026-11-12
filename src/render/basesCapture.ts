import {
  BasesStats,
  basesDataRowCount,
  isBasesViewUnfinished,
  reemitBasesView,
} from "../publish/bases";

/**
 * Capturing each Bases view while it is inside the window.
 *
 * Measured, not assumed: Bases builds only the rows that fit between a view's
 * top edge and the bottom of the Obsidian window, about 30px each. The render
 * host has no height limit, but that does not matter, because the window is
 * the limit. With a 200-row base, a view at the top of a note captured 32 rows
 * in a full-height window and 9 in a 400px one; the same view 600px down captured
 * 12 and 0; one far down the page captured nothing in either. So what a
 * publish captured depended on the size of the window it ran in.
 *
 * So each view is brought to the top of the window in turn, given time to
 * build its rows, and converted to static markup straight away. Converting at
 * once matters: once the host moves on to the next view, this one is above
 * the window, and nothing promises Bases keeps rows it no longer shows.
 *
 * This fixes position, not length. A view still gets only as many rows as the
 * window has room for, so a long base is still published shortened, with the
 * truncation note saying by how much.
 */

export interface BasesCaptureOptions {
  /** How long a view's row count must hold still to count as built. */
  quietMs: number;
  /** Most time to spend on one view before leaving it to the normal wait. */
  timeoutMs: number;
  /** How often to look. */
  pollMs: number;
}

export const DEFAULT_BASES_CAPTURE: BasesCaptureOptions = {
  quietMs: 300,
  timeoutMs: 8_000,
  pollMs: 50,
};

export interface BasesCaptureResult {
  /** Views converted while positioned at the top of the window. */
  captured: number;
  /** Views that never finished in their turn, left for the normal wait. */
  leftUnfinished: number;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * The next thing to bring into view: an embed that has not built a view yet,
 * or a view, whichever comes first in the document. Skips the ones already
 * tried, so an embed that never builds does not stall the loop.
 */
function nextTarget(container: HTMLElement, tried: Set<Element>): Element | null {
  for (const el of Array.from(container.querySelectorAll(".bases-embed, .bases-view"))) {
    if (tried.has(el)) continue;
    // An embed that already holds a view is represented by that view.
    if (el.matches(".bases-embed") && el.querySelector(".bases-view")) continue;
    return el;
  }
  return null;
}

/** The view for a target, once it exists. */
function viewOf(target: Element): Element | null {
  if (target.matches(".bases-view")) return target;
  return target.querySelector(".bases-view");
}

/**
 * Waits for one view to finish building its rows, and returns it, or null if
 * it never did within the time allowed.
 */
async function waitForRows(
  target: Element,
  options: BasesCaptureOptions,
): Promise<Element | null> {
  const started = performance.now();
  let lastRows = -1;
  let stableSince = started;

  while (performance.now() - started < options.timeoutMs) {
    const view = viewOf(target);
    if (view && !isBasesViewUnfinished(view)) {
      const rows = basesDataRowCount(view);
      const now = performance.now();
      if (rows !== lastRows) {
        lastRows = rows;
        stableSince = now;
      } else if (now - stableSince >= options.quietMs) {
        return view;
      }
    } else {
      lastRows = -1;
    }
    await sleep(options.pollMs);
  }
  return null;
}

/**
 * Brings each Bases view in `container` to the top of the window in turn,
 * waits for its rows and converts it, adding to `stats`.
 *
 * `host` is the fixed-position render host. It is moved by changing its
 * `top`, and put back where it was before returning, whatever happens.
 */
export async function captureBasesInView(
  host: HTMLElement,
  container: HTMLElement,
  stats: BasesStats,
  options: Partial<BasesCaptureOptions> = {},
): Promise<BasesCaptureResult> {
  const settings = { ...DEFAULT_BASES_CAPTURE, ...options };
  const result: BasesCaptureResult = { captured: 0, leftUnfinished: 0 };
  if (!container.querySelector(".bases-embed, .bases-view")) return result;

  const originalTop = host.style.top;
  const tried = new Set<Element>();
  try {
    for (let target = nextTarget(container, tried); target; target = nextTarget(container, tried)) {
      tried.add(target);

      // Where the target sits inside the host, whatever the host's own
      // position is right now, and then the host moved so that point is at
      // the top of the window.
      const offset =
        target.getBoundingClientRect().top - host.getBoundingClientRect().top;
      host.style.top = `${-Math.max(0, offset)}px`;

      const view = await waitForRows(target, settings);
      if (view) {
        reemitBasesView(view, stats);
        result.captured++;
      } else {
        // Had its turn. A view that appears in an embed after the embed's
        // turn ran out is not given a second one; the normal wait has it.
        const late = viewOf(target);
        if (late) tried.add(late);
        result.leftUnfinished++;
      }
    }
  } finally {
    host.style.top = originalTop;
  }
  return result;
}
