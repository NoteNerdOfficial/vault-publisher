import { App, Component, MarkdownRenderer, TFile } from "obsidian";
import { DEFAULT_SETTLE, SettleOptions, SettleResult, waitForSettle } from "./settle";
import { NormalizeStats, normalizeParagraphNesting } from "../publish/normalize";
import type { BasesStats } from "../publish/bases";
import { BasesCaptureResult, captureBasesInView } from "./basesCapture";

/**
 * Rendering one note the way Obsidian would, then taking the HTML.
 *
 * The host element has to be in the document. A detached node is tempting --
 * nothing to hide, no layout cost -- but Mermaid measures its container to
 * lay out a diagram and gets zeroes, and anything built on a UI framework
 * (Datacore's Preact trees, Bases' virtualized rows) can skip work it thinks
 * nobody will see. So the host is attached and moved off screen instead.
 *
 * `display: none` fails for the same reason as detaching: no box, no
 * measurements. We use a fixed offscreen position with a real width, which
 * costs a layout pass per note but gets correct geometry.
 */

/** Content width the host lays out at, in px. Mermaid and wide Dataview
 * tables both key off this, so it should match the published theme's measure. */
const HOST_WIDTH_PX = 900;

export interface RenderOptions {
  settle?: Partial<SettleOptions>;
  /** Width the note lays out at. Defaults to HOST_WIDTH_PX. */
  widthPx?: number;
  /** Set false to capture Obsidian's DOM exactly as built, for diagnosis. */
  normalize?: boolean;
  /**
   * Runs on the live container after it has settled and been normalized, and
   * before it is serialized. Link rewriting and heading ids belong here: both
   * need a real DOM, and doing them now avoids a parse-and-reserialize round
   * trip that would have to be proven lossless.
   */
  transform?: (container: HTMLElement) => void;
  /**
   * When given, each Bases view is brought to the top of the window, waited
   * for and converted to static markup before the general settle wait, with
   * what that did added here. See render/basesCapture.ts for why position
   * decides how many rows a view has.
   */
  bases?: BasesStats;
}

export interface RenderedNote {
  path: string;
  /** Serialized innerHTML of the rendered container. */
  html: string;
  settle: SettleResult;
  /** Time inside MarkdownRenderer.render(), before any settle wait. */
  renderMs: number;
  /** Time spent in the pre-serialization cleanup. */
  normalizeMs: number;
  /** Time spent serializing to a string. */
  serializeMs: number;
  /** Wall-clock cost of the whole render, including the settle wait. */
  totalMs: number;
  /** Thrown error, if the render failed outright. */
  error: string | null;
  /** What the pre-serialization cleanup had to fix. */
  normalize: NormalizeStats;
  /** What capturing Bases views in view did, when it ran. */
  basesCapture: BasesCaptureResult | null;
}

/**
 * Creates the offscreen host. Kept separate so a batch publish can make one
 * host and reuse it across hundreds of notes rather than thrashing layout.
 */
export function createRenderHost(widthPx = HOST_WIDTH_PX): HTMLElement {
  const host = document.body.createDiv({ cls: "osp-render-host" });
  host.setAttribute(
    "style",
    [
      "position: fixed",
      // Inside the viewport, not parked off screen at a negative offset.
      // Dataview fills its table cells, and Obsidian loads embeds, only once
      // an IntersectionObserver reports the element as visible. A host at
      // left:-20000px never intersects, so cells serialize as empty <span>s
      // and embeds never reach is-loaded -- output that looks structurally
      // right and has no content in it.
      "left: 0",
      "top: 0",
      `width: ${widthPx}px`,
      // Unbounded height, though it turned out not to be enough for Bases:
      // it builds rows only down to the bottom of the window, whatever the
      // host's height. render/basesCapture.ts moves the host to deal with it.
      "height: auto",
      "overflow: visible",
      // Invisible without being undetectable: opacity and a negative z-index
      // keep it off the screen for the user while it still has a real box,
      // real geometry and real intersection with the viewport.
      "opacity: 0",
      "pointer-events: none",
      "z-index: -1",
    ].join("; "),
  );
  return host;
}

/**
 * Renders `markdown` as if it were the note at `sourcePath`, and returns the
 * resulting HTML. `sourcePath` is what makes relative links, embeds and
 * Dataview's `this` resolve correctly, so it must be the real vault path.
 */
export async function renderMarkdownToHtml(
  app: App,
  markdown: string,
  sourcePath: string,
  host: HTMLElement,
  options: RenderOptions = {},
): Promise<RenderedNote> {
  const started = performance.now();

  // These classes are what Obsidian's own CSS and every plugin's CSS select
  // on. Rendering without them produces structurally correct but unstyled
  // output, and some plugins check for them before enhancing a block.
  const container = host.createDiv({
    cls: "markdown-preview-view markdown-rendered osp-render-target",
  });

  // A Component owns the lifecycle of every child the post-processors
  // register. Without one, nothing is unloaded and each note leaks its
  // Dataview query listeners into the next.
  const component = new Component();
  component.load();

  let error: string | null = null;
  let settle: SettleResult = {
    settled: true,
    mutations: 0,
    elapsedMs: 0,
    assetMs: 0,
    lastMutationAtMs: null,
    skipped: false,
    pendingAtEnd: 0,
    pendingReason: null,
    reason: "fast-path",
  };
  let html = "";
  let normalize: NormalizeStats = { paragraphsRewritten: 0, remaining: 0 };
  let renderMs = 0;
  let normalizeMs = 0;
  let serializeMs = 0;
  let basesCapture: BasesCaptureResult | null = null;

  try {
    const renderStart = performance.now();
    await MarkdownRenderer.render(app, markdown, container, sourcePath, component);
    renderMs = performance.now() - renderStart;

    // Before the general wait, so a view the capture could not finish is
    // still there for it to wait on, judge and name.
    if (options.bases) {
      basesCapture = await captureBasesInView(host, container, options.bases);
    }

    settle =await waitForSettle(container, { ...DEFAULT_SETTLE, ...options.settle });

    // Must happen on the live tree, before innerHTML: once serialized, the
    // information about what belonged inside which paragraph is already gone.
    const normalizeStart = performance.now();
    if (options.normalize !== false) {
      normalize = normalizeParagraphNesting(container);
    }
    normalizeMs = performance.now() - normalizeStart;

    options.transform?.(container);

    const serializeStart = performance.now();
    html = container.innerHTML;
    serializeMs = performance.now() - serializeStart;
  } catch (e) {
    error = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    // Keep whatever did render: partial output is more diagnostic than none.
    html = container.innerHTML;
  } finally {
    component.unload();
    container.remove();
  }

  return {
    path: sourcePath,
    html,
    settle,
    renderMs,
    normalizeMs,
    serializeMs,
    totalMs: performance.now() - started,
    error,
    normalize,
    basesCapture,
  };
}

/** Reads a vault file and renders it. */
export async function renderFile(
  app: App,
  file: TFile,
  host: HTMLElement,
  options: RenderOptions = {},
): Promise<RenderedNote> {
  const markdown = await app.vault.cachedRead(file);
  return renderMarkdownToHtml(app, markdown, file.path, host, options);
}
