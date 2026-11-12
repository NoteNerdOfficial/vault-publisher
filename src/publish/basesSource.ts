import { CAPTURE_VIEW_TYPE } from "./bases";

/**
 * Pointing a note's Bases tables at the plugin's own view type before it is
 * rendered.
 *
 * Bases builds only the rows of its grid that fit in the Obsidian window, so
 * reading a table back out of the rendered page gets as many rows as the
 * screen has room for. A view type registered by a plugin is instead handed
 * the query's full result, every row, wherever the view sits. So for a
 * publish, a table, cards or list view is rewritten as a `base` code block
 * whose one view is that type, with everything else about it -- filters,
 * formulas, column order, sort, display names, the card and list options --
 * carried over unchanged. Measured: 201 of 201 rows, at the top of a note
 * and 150 paragraphs down alike.
 *
 * Two things are added, because a registered view cannot read them any
 * other way: `osp-layout`, the layout the view had, and `osp-summaries`, a
 * copy of its summary row. A view reads its own options through the public
 * API, but the summaries live where only Bases' own views can see them.
 *
 * Only what is safe to rewrite is rewritten, and everything else is left for
 * the grid reader, which still works, just less completely:
 *
 *  - Only table, cards and list views; anything else is left as it is.
 *  - Only an embed alone on its line. A fenced block cannot sit inside a
 *    sentence, a list item or a callout without changing what surrounds it.
 *  - Nothing inside code, fenced or inline: that is text about an embed, not
 *    an embed.
 *  - Nothing that cannot be resolved: a missing file, an unparseable one, or
 *    a `#view` name the file does not have.
 *
 * A code block's `this` is the note it is in, which is what an embed's `this`
 * is when the publisher renders it, so filters on `this` mean the same thing
 * after the rewrite. Checked against Obsidian before relying on it.
 *
 * The block is written as JSON, which is valid YAML, so no YAML writer is
 * needed and nothing about the configuration is reformatted on the way.
 */

/** A `.base` file's configuration, as parsed. */
export interface BaseConfig {
  views?: BaseViewConfig[];
  [key: string]: unknown;
}

export interface BaseViewConfig {
  type?: string;
  name?: string;
  [key: string]: unknown;
}

export interface BasesSourceDeps {
  /** The parsed `.base` file a link points at, from `sourcePath`, or null. */
  loadBase(linkpath: string, sourcePath: string): Promise<BaseConfig | null>;
  /** Parses the body of a `base` code block. Throws on invalid YAML. */
  parseYaml(text: string): unknown;
}

export interface BasesSourceResult {
  markdown: string;
  /** Views pointed at the capture view. */
  rewritten: number;
}

/** The layouts the capture view can draw, by Bases' own type names. */
export const CAPTURED_LAYOUTS = ["table", "cards", "list"];

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** An embed of a `.base` file, alone on its line. */
const LONE_BASE_EMBED = /^ {0,3}!\[\[([^\]|#]+?\.base)(?:#([^\]|]*))?(?:\|[^\]]*)?\]\]\s*$/;

/** Rewrites the note's own views to be read from Bases' data. */
export async function rewriteBasesForCapture(
  markdown: string,
  sourcePath: string,
  deps: BasesSourceDeps,
): Promise<BasesSourceResult> {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let rewritten = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line);

    if (fence) {
      const marker = fence[1];
      const info = fence[2].trim().split(/\s+/)[0] ?? "";
      const close = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`);
      let end = i + 1;
      while (end < lines.length && !close.test(lines[end])) end++;

      const block = lines.slice(i, Math.min(end + 1, lines.length));
      const body = lines.slice(i + 1, end).join("\n");
      const replacement =
        info === "base" && end < lines.length ? captureBlockFor(body, deps) : null;
      if (replacement) {
        out.push(replacement);
        rewritten++;
      } else {
        out.push(...block);
      }
      i = end;
      continue;
    }

    const embed = LONE_BASE_EMBED.exec(line);
    if (embed) {
      const config = await deps.loadBase(embed[1].trim(), sourcePath);
      const replacement = config ? captureBlock(config, embed[2]?.trim() || null) : null;
      if (replacement) {
        out.push(replacement);
        rewritten++;
        continue;
      }
    }

    out.push(line);
  }

  return { markdown: out.join("\n"), rewritten };
}

/** A `base` code block's body, pointed at the capture view, or null. */
function captureBlockFor(body: string, deps: BasesSourceDeps): string | null {
  let config: unknown;
  try {
    config = deps.parseYaml(body);
  } catch {
    return null;
  }
  if (!config || typeof config !== "object") return null;
  // A code block shows its first view.
  return captureBlock(config as BaseConfig, null);
}

/**
 * The configuration with only the chosen view left, its type swapped for the
 * capture view, as a `base` code block. Null when the view is of a layout we
 * do not draw, or cannot be found.
 */
function captureBlock(config: BaseConfig, viewName: string | null): string | null {
  const views = Array.isArray(config.views) ? config.views : [];
  const view = viewName === null ? views[0] : views.find((v) => v?.name === viewName);
  if (!view || !CAPTURED_LAYOUTS.includes(view.type ?? "")) return null;
  const captured: BaseConfig = {
    ...config,
    views: [
      {
        ...view,
        type: CAPTURE_VIEW_TYPE,
        "osp-layout": view.type,
        ...(view.summaries && typeof view.summaries === "object"
          ? { "osp-summaries": view.summaries }
          : {}),
      },
    ],
  };
  return "```base\n" + JSON.stringify(captured, null, 2) + "\n```";
}
