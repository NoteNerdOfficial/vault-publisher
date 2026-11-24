/**
 * A prototype embedded in a note: `![[checkout/index.html]]`.
 *
 * Obsidian has no embed for an HTML file. It draws a generic placeholder,
 * a box with the file's name in it, and that is what used to be published:
 * a note written as the spec around a prototype showed the prototype's
 * file name and nothing else. So for every embed whose target is a page
 * this build publishes as-is, the placeholder is replaced with the page
 * itself in a frame, a link to open it on its own, and a row of widths to
 * view it at. A design is presented that way, inside the writing about it.
 *
 * Keyed on the wrapper rather than on what Obsidian draws inside it. Every
 * embed is a `.internal-embed` whose `src` is the link text as written, and
 * that is the one part of the markup that has stayed put across versions;
 * the box inside is Obsidian's to change.
 *
 * Only a page that is being published is framed. An embed of an HTML file
 * the scope left out stays exactly as it was, because a frame pointing at a
 * page that is not on the site is a 404 inside the article.
 *
 * **Size** comes from the link text, the same way Obsidian sizes an image:
 * `![[proto.html|600]]` is 600 pixels tall and `|375x700` is a phone-width
 * frame 700 tall. The width is where the frame *starts*: the width buttons
 * change it, and a width wider than the column is drawn scaled down to fit
 * rather than cut off -- see `clientScript.ts`, which owns the buttons.
 */

import { LinkResolver, relativeUrl } from "./links";

/** How tall a frame is when the link text does not say. */
export const DEFAULT_EMBED_HEIGHT = 560;

/**
 * The widths offered beside a frame. Phone and tablet are the narrowest
 * common viewport in each class rather than any one device; "Fit" is the
 * width of the column, which is what a frame is before anyone touches it.
 */
export const EMBED_WIDTHS: Array<{ label: string; width: number | null }> = [
  { label: "Phone", width: 375 },
  { label: "Tablet", width: 768 },
  { label: "Desktop", width: 1280 },
  { label: "Fit", width: null },
];

export interface HtmlEmbedStats {
  /** Embeds turned into frames. */
  framed: number;
}

/** `600`, `600x400` or `x400`: the size written after the pipe. */
export function parseEmbedSize(
  alt: string | null,
): { width: number | null; height: number | null } {
  const match = /^\s*(\d+)?\s*(?:x\s*(\d+))?\s*$/i.exec(alt ?? "");
  if (!match || (!match[1] && !match[2])) return { width: null, height: null };
  // One number is a height, unlike an image, where it is a width. A frame
  // already fills the column, so the one thing worth saying is how tall.
  if (match[1] && !match[2]) return { width: null, height: Number(match[1]) };
  return {
    width: match[1] ? Number(match[1]) : null,
    height: match[2] ? Number(match[2]) : null,
  };
}

/** The link text Obsidian left on the wrapper, without a size or heading. */
function linkpathOf(wrapper: Element): string {
  const src = wrapper.getAttribute("src") ?? "";
  return src.split("|")[0].split("#")[0].trim();
}

/**
 * The size, wherever Obsidian left it.
 *
 * Obsidian takes a size it recognises out of the link text and sets it as
 * attributes: `|375x640` arrives as `width` and `height`, and `|420` as a
 * `width` alone, which here is read as a height (see `parseEmbedSize`). A
 * size it does not recognise, such as `|x300`, stays as text in `alt`.
 */
function sizeOf(wrapper: Element): { width: number | null; height: number | null } {
  const attr = (name: string): number | null => {
    const value = Number(wrapper.getAttribute(name));
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  const width = attr("width");
  const height = attr("height");
  if (height !== null) return { width, height };
  if (width !== null) return { width: null, height: width };

  const fromAlt = parseEmbedSize(wrapper.getAttribute("alt"));
  if (fromAlt.width !== null || fromAlt.height !== null) return fromAlt;
  const src = wrapper.getAttribute("src") ?? "";
  const pipe = src.indexOf("|");
  return pipe === -1 ? fromAlt : parseEmbedSize(src.slice(pipe + 1));
}

/**
 * Replaces each embed of a published HTML page with a framed copy of it.
 *
 * `isAsIs` says which resolved targets are HTML pages rather than notes: a
 * note embedded in a note is Obsidian's own transclusion and is left alone.
 * `titleFor` names the frame, from the page's own `<title>` where the build
 * read one.
 */
export function frameHtmlEmbeds(
  root: HTMLElement,
  resolver: LinkResolver,
  fromUrl: string,
  isAsIs: (url: string) => boolean,
  titleFor: (url: string) => string | undefined,
): HtmlEmbedStats {
  const stats: HtmlEmbedStats = { framed: 0 };
  const doc = root.ownerDocument;

  for (const wrapper of Array.from(root.querySelectorAll(".internal-embed[src]"))) {
    const linkpath = linkpathOf(wrapper);
    if (!/\.html?$/i.test(linkpath)) continue;
    const target = resolver.resolve(linkpath);
    if (!target || !isAsIs(target.url)) continue;

    const href = relativeUrl(fromUrl, target.url);
    const name = titleFor(target.url) || target.url.split("/").pop() || target.url;
    const size = sizeOf(wrapper);
    const height = size.height ?? DEFAULT_EMBED_HEIGHT;

    const figure = doc.createElement("figure");
    figure.className = "osp-html-embed";
    if (size.width !== null) figure.setAttribute("data-width", String(size.width));
    figure.setAttribute("data-height", String(height));

    const bar = doc.createElement("div");
    bar.className = "osp-html-embed-bar";

    const title = doc.createElement("span");
    title.className = "osp-html-embed-title";
    title.textContent = name;
    bar.appendChild(title);

    // The buttons are drawn by the site script, which is what makes them do
    // anything. Without it there is nothing to press, and the frame and the
    // link below are still all there.
    const widths = doc.createElement("span");
    widths.className = "osp-html-embed-widths";
    bar.appendChild(widths);

    const open = doc.createElement("a");
    open.className = "osp-html-embed-open";
    // The vault path, not the relative URL: `rewriteLinks` runs next and
    // resolves every anchor's href as link text, so it makes this relative
    // itself -- and counts it as a link from this note while it is there.
    open.setAttribute("href", target.sourcePath);
    open.setAttribute("target", "_blank");
    open.setAttribute("rel", "noopener");
    open.textContent = "Open full page";
    bar.appendChild(open);

    const stage = doc.createElement("div");
    stage.className = "osp-html-embed-stage";
    stage.setAttribute("style", `height: ${height}px`);

    const frame = doc.createElement("iframe");
    // Not `src` yet: see FRAME_SRC_ATTR.
    frame.setAttribute(FRAME_SRC_ATTR, href);
    frame.setAttribute("title", name);
    frame.setAttribute("loading", "lazy");
    frame.setAttribute("style", `height: ${height}px`);
    stage.appendChild(frame);

    figure.appendChild(bar);
    figure.appendChild(stage);

    wrapper.replaceWith(figure);
    stats.framed++;
  }

  if (stats.framed) liftFigures(root);
  return stats;
}

/**
 * Out of the paragraphs the renderer put them in.
 *
 * An embed on a line of its own is wrapped in a `<p>`, and a figure inside
 * a `<p>` is markup a browser rearranges on reparse. So a paragraph that
 * holds frames and nothing else gives up its place: to the one frame, or,
 * when there are several, to a comparison that shows them side by side --
 * `![[v1/index.html]] ![[v2/index.html]]` on one line is how two versions of
 * a design are put in front of somebody to choose between. A frame that
 * shares its paragraph with prose is left where it is.
 */
function liftFigures(root: HTMLElement): void {
  const doc = root.ownerDocument;
  // `div.osp-block-paragraph` is a `<p>` the build already rewrote because
  // Obsidian's placeholder put block markup inside it (see `normalize.ts`),
  // which is what an embed-only line looks like by the time it gets here.
  for (const paragraph of Array.from(root.querySelectorAll("p, div.osp-block-paragraph"))) {
    const figures = Array.from(paragraph.children).filter((child) =>
      child.matches("figure.osp-html-embed"),
    );
    if (!figures.length) continue;
    const onlyFrames = Array.from(paragraph.childNodes).every(
      (node) =>
        figures.includes(node as Element) ||
        (node.nodeType === 3 && !node.textContent?.trim()) ||
        (node as Element).tagName === "BR",
    );
    if (!onlyFrames) continue;
    if (figures.length === 1) {
      paragraph.replaceWith(figures[0]);
      continue;
    }
    const group = doc.createElement("div");
    group.className = "osp-html-compare";
    group.setAttribute("data-count", String(figures.length));
    for (const figure of figures) group.appendChild(figure);
    paragraph.replaceWith(group);
  }
}

/**
 * Where a frame's address waits until the page is serialized.
 *
 * The build works in Obsidian's own document, so an <iframe> with a `src`
 * starts loading the prototype inside Obsidian the moment it is attached --
 * and the build attaches each one twice (made, then lifted out of its
 * paragraph) before throwing the container away. Each of those loads is a
 * request to Obsidian's main process for an app:// page, abandoned by a
 * frame that no longer exists, and roughly one build in two lost that race:
 * the main process threw "Cannot read properties of undefined (reading
 * 'origin')" into a modal dialog that froze the whole app until it was
 * dismissed. A frame with no `src` loads nothing, so the address rides in
 * this attribute and becomes a `src` only in the serialized HTML, which no
 * live document ever loads.
 */
export const FRAME_SRC_ATTR = "data-osp-frame-src";

/** Turns parked frame addresses into real ones, in serialized HTML. */
export function armFrames(html: string): string {
  return html.split(` ${FRAME_SRC_ATTR}="`).join(` src="`);
}
