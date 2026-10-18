import { App, Component, MarkdownRenderer, TFile } from "obsidian";
import { createRenderHost } from "./renderNote";

/**
 * Sampling a render over time.
 *
 * Dataview's table cells serialize as empty <span>s while the numeric columns
 * come out fine, which says the cells holding strings and links are filled by
 * a separate, later path than the table that contains them. Guessing at why
 * has already cost one wrong fix (moving the host into the viewport, on a
 * visibility theory that the evidence did not support).
 *
 * So this measures instead: render once, then photograph the subtree at
 * intervals and count what is still empty. If the spans fill at 2s, it is a
 * timing problem and the settle heuristic is wrong. If they never fill, it is
 * contextual and no amount of waiting will help.
 */

export interface Sample {
  atMs: number;
  emptySpans: number;
  /** Characters of text content, a rough proxy for "has anything arrived". */
  textLength: number;
  mutationsSoFar: number;
}

export interface DiagnoseResult {
  path: string;
  samples: Sample[];
  finalHtml: string;
}

const SAMPLE_POINTS_MS = [0, 100, 250, 500, 1000, 2000, 4000, 8000, 15000];

export async function diagnoseRender(
  app: App,
  file: TFile,
): Promise<DiagnoseResult> {
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

  const markdown = await app.vault.cachedRead(file);
  await MarkdownRenderer.render(app, markdown, container, file.path, component);

  const samples: Sample[] = [];
  const started = performance.now();

  for (const point of SAMPLE_POINTS_MS) {
    const wait = point - (performance.now() - started);
    if (wait > 0) await sleep(wait);
    samples.push({
      atMs: Math.round(performance.now() - started),
      emptySpans: countEmptySpans(container),
      textLength: (container.textContent ?? "").length,
      mutationsSoFar: mutations,
    });
  }

  observer.disconnect();
  const finalHtml = container.innerHTML;
  component.unload();
  host.remove();

  return { path: file.path, samples, finalHtml };
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
