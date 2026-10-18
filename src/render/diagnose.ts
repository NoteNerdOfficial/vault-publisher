import { App, Component, MarkdownRenderer, TFile } from "obsidian";
import { createRenderHost } from "./renderNote";
import {
  countPendingPlaceholders,
  incompleteReason,
  isContentComplete,
} from "./settle";

/**
 * Sampling a render over time.
 *
 * Guessing at render timing has cost two wrong fixes already: moving the host
 * into the viewport on a visibility theory the evidence did not support, and
 * a 300ms inter-note delay that tripled a build. Both times the fix came only
 * after photographing the subtree at intervals and looking at what was
 * actually there.
 *
 * What is being chased now: the same note sometimes finishes from its content
 * and sometimes falls through to the quiet timer at a cost of about five
 * seconds, and the number of notes that fall through moved from 2 to 12
 * across three runs of an identical vault. So each sample records not just
 * what has arrived but whether the completion check would pass, and if not,
 * which check is failing.
 *
 * Two details that matter for the measurement not to lie:
 *
 *  - A backgrounded window defers these sleeps badly: this tool measured a
 *    50ms sleep taking 3,485ms, which is how the throttling was pinned down.
 *    Run it with the window focused, or with background throttling suspended,
 *    or the instrument distorts what it measures.
 *  - The note is rendered several times. One render of an intermittent fault
 *    tells you nothing, which is the lesson from comparing a 58s build
 *    against a 135s build of identical configuration.
 */

export interface Sample {
  atMs: number;
  /** Elements created but never filled. */
  emptySpans: number;
  /** Characters of text content, a rough proxy for "has anything arrived". */
  textLength: number;
  mutationsSoFar: number;
  /** Whether the build would have stopped waiting at this moment. */
  complete: boolean;
  /** Which check is failing, when it is not complete. */
  reason: string | null;
  pending: number;
}

export interface DiagnoseRun {
  /** Which repeat this was, 1-based. */
  attempt: number;
  samples: Sample[];
  /** When the content first became complete, or null if it never did. */
  completeAtMs: number | null;
  /** Time inside MarkdownRenderer.render(). */
  renderMs: number;
}

export interface DiagnoseResult {
  path: string;
  runs: DiagnoseRun[];
  finalHtml: string;
}

const SAMPLE_POINTS_MS = [
  0, 50, 100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000,
  6000, 8000, 10000, 15000,
];

const DEFAULT_ATTEMPTS = 5;

export async function diagnoseRender(
  app: App,
  file: TFile,
  attempts = DEFAULT_ATTEMPTS,
): Promise<DiagnoseResult> {
  const markdown = await app.vault.cachedRead(file);
  const runs: DiagnoseRun[] = [];
  let finalHtml = "";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    // A fresh host each time. Reusing one would let an earlier attempt's
    // leftovers answer for a later one, which is the kind of contamination
    // this is trying to rule out.
    const host = createRenderHost();
    const container = host.createDiv({
      cls: "markdown-preview-view markdown-rendered osp-render-target",
    });
    const component = new Component();
    component.load();

    let mutations = 0;
    const observer = new MutationObserver((records) => {
      mutations += records.length;
    });
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    const renderStart = performance.now();
    await MarkdownRenderer.render(app, markdown, container, file.path, component);
    const renderMs = performance.now() - renderStart;

    const samples: Sample[] = [];
    const started = performance.now();
    let completeAtMs: number | null = null;

    for (const point of SAMPLE_POINTS_MS) {
      const wait = point - (performance.now() - started);
      if (wait > 0) await sleep(wait);

      const complete = isContentComplete(container);
      const atMs = Math.round(performance.now() - started);
      if (complete && completeAtMs === null) completeAtMs = atMs;

      samples.push({
        atMs,
        emptySpans: countEmptySpans(container),
        textLength: (container.textContent ?? "").length,
        mutationsSoFar: mutations,
        complete,
        reason: incompleteReason(container),
        pending: countPendingPlaceholders(container),
      });
    }

    observer.disconnect();
    finalHtml = container.innerHTML;
    component.unload();
    host.remove();

    runs.push({ attempt, samples, completeAtMs, renderMs });
  }

  return { path: file.path, runs, finalHtml };
}

/** An element with no children and no text is one that was never filled. */
function countEmptySpans(el: HTMLElement): number {
  return Array.from(el.querySelectorAll("span")).filter(
    (span) => !span.children.length && !(span.textContent ?? "").trim(),
  ).length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
