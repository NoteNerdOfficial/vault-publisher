import { App, TFile } from "obsidian";
import { encodeUrlPath } from "./urls";

/**
 * Collecting the files a page points at.
 *
 * Obsidian renders an embedded image as an `app://` URL into the user's own
 * filesystem. That URL works in the app and nowhere else, so a page
 * serialized with it has pictures that are broken for every reader. The file
 * has to travel with the site and the reference has to be rewritten.
 *
 * Two ways in, because Obsidian produces two shapes:
 *
 * The wrapper form, `<div class="internal-embed image-embed" src="pic.png">`,
 * carries the *link text* the author wrote, which the metadata cache can
 * resolve the same way Obsidian did -- shortest unique name, folder
 * preferences and all. This is the reliable path and is tried first.
 *
 * The bare form, a plain `<img src="app://...">` from standard Markdown
 * image syntax, has no wrapper and no link text. All it has is a filesystem
 * path inside the URL, so the vault path is recovered by stripping the
 * vault's own base path off the front. That is the fallback, and it is the
 * one that breaks first if Obsidian changes how it builds resource URLs.
 */

export interface AssetStats {
  /** Files found and queued for publishing. */
  collected: number;
  /** References rewritten to point at the published copy. */
  rewritten: number;
  /** References pointing outside the vault that were left alone. */
  external: number;
  /**
   * References that could not be resolved to a vault file. Reported here and
   * removed from the page, because an unresolved local reference is an
   * `app://` URL carrying the author's home directory.
   */
  unresolved: string[];
  /** Total bytes, so a publish can report what it is about to upload. */
  bytes: number;
  /** Attachments too large to publish, with why, for the build report. */
  oversized: { path: string; reason: string }[];
}

export function emptyAssetStats(): AssetStats {
  return {
    collected: 0,
    rewritten: 0,
    external: 0,
    unresolved: [],
    bytes: 0,
    oversized: [],
  };
}

/** Where a copied file lives in the published site. */
export function assetUrl(vaultPath: string): string {
  return `assets/files/${vaultPath}`;
}

/**
 * Attributes that can hold a reference to a file in the vault.
 *
 * `src` is the ordinary one. `poster` matters because it is checked on its
 * own: a `<video>` can carry a poster frame and no `src` at all, and keying
 * the search on `src` alone meant such an element was never examined -- so
 * its `app://` URL, absolute filesystem path and all, went out unaltered.
 */
const REFERENCE_ATTRIBUTES = ["src", "poster"];

/**
 * 25 MiB. Comfortably above any sane image or PDF in a note, well under
 * GitHub's own blob ceiling, and small enough that one of them does not make
 * a publish feel broken.
 */
export const DEFAULT_MAX_ASSET_BYTES = 25 * 1024 * 1024;

/**
 * Why an attachment is not being published, or null when it is fine.
 *
 * Checked from the vault's index rather than after reading, because the point
 * is to not pull a multi-gigabyte file into memory at all. Decided here, at
 * the moment the reference would be rewritten, so a page never points at a
 * file that is not going to travel with it.
 */
export function assetSkipReason(
  size: number,
  limit: number = DEFAULT_MAX_ASSET_BYTES,
): string | null {
  if (size <= limit) return null;
  return (
    `attachment is ${formatBytes(size)}, over the ${formatBytes(limit)} ` +
    `limit -- the page will publish without it`
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

interface AssetHost {
  /** Queues a vault file for publishing. Deduplicated by the caller. */
  want(file: TFile): void;
}

/**
 * Rewrites media references in a rendered page and queues the files.
 *
 * `fromUrl` is the page's own published URL, so links can be made relative
 * and the site keeps working in a subdirectory.
 */
export function collectAssets(
  app: App,
  root: HTMLElement,
  sourcePath: string,
  fromUrl: string,
  host: AssetHost,
  maxBytes: number = DEFAULT_MAX_ASSET_BYTES,
): AssetStats {
  const stats = emptyAssetStats();
  const base = vaultBasePath(app);

  for (const el of Array.from(root.querySelectorAll("img, video, audio, source"))) {
    for (const attribute of REFERENCE_ATTRIBUTES) {
      const src = el.getAttribute(attribute) ?? "";
      if (!src) continue;

      // Data URIs are already self-contained, and an http(s) reference is the
      // author pointing somewhere deliberately.
      if (/^(data|https?):/i.test(src)) {
        if (/^https?:/i.test(src)) stats.external++;
        continue;
      }

      const file = resolveFromWrapper(app, el, sourcePath) ?? resolveFromUrl(app, src, base);
      if (!file) {
        stats.unresolved.push(src.slice(0, 200));
        // Clears every reference on the element, so the remaining attributes
        // are already empty when the loop reaches them.
        disarm(el);
        continue;
      }

      // Decided before the reference is rewritten. Rewriting first and
      // skipping the upload later left the page pointing at a file that was
      // never published -- a broken image with nothing explaining it.
      // `?? 0` publishes when the size is unknown, rather than skipping on a
      // guess: an unreadable stat is not evidence the file is too large.
      const tooBig = assetSkipReason(file.stat?.size ?? 0, maxBytes);
      if (tooBig) {
        stats.oversized.push({ path: file.path, reason: tooBig });
        disarm(el, "osp-oversized-asset");
        continue;
      }

      host.want(file);
      stats.collected++;
      el.setAttribute(attribute, relativeTo(fromUrl, assetUrl(file.path)));
      // Obsidian sizes embeds with an inline width from the link text; keep it.
      el.removeAttribute("alt-src");
      stats.rewritten++;
    }
  }

  return stats;
}

/**
 * Strips a reference that could not be resolved to a vault file.
 *
 * What is left in `src` at this point is whatever Obsidian put there, and for
 * a local embed that is an `app://` URL containing the vault's absolute path
 * -- which starts with the author's home directory, and so their account
 * name. Leaving it in place published that, in exchange for an image that
 * was broken for every reader anyway. The reference is reported in
 * `stats.unresolved` for the author instead, and the element keeps its `alt`
 * text so the page still says something was meant to be here.
 */
function disarm(el: Element, className = "osp-unresolved-asset"): void {
  for (const name of ["src", "srcset", "poster", "alt-src", "data-src"]) {
    el.removeAttribute(name);
  }
  el.classList.add(className);
}

/** The link text Obsidian recorded on the embed wrapper, resolved its way. */
function resolveFromWrapper(
  app: App,
  el: Element,
  sourcePath: string,
): TFile | null {
  const wrapper = el.closest(".internal-embed[src], .media-embed[src]");
  const linkpath = wrapper?.getAttribute("src");
  if (!linkpath) return null;
  return app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath) ?? null;
}

/** Recovers a vault path from an `app://` resource URL. */
function resolveFromUrl(app: App, src: string, base: string | null): TFile | null {
  if (!base) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(src.split("?")[0]);
  } catch {
    return null;
  }

  const index = decoded.indexOf(base);
  if (index === -1) return null;

  const relative = decoded.slice(index + base.length).replace(/^\/+/, "");
  const file = app.vault.getAbstractFileByPath(relative);
  return file instanceof TFile ? file : null;
}

function vaultBasePath(app: App): string | null {
  const adapter = app.vault.adapter as unknown as { basePath?: string };
  return typeof adapter.basePath === "string" ? adapter.basePath : null;
}

/** A relative URL from one published path to another. */
function relativeTo(fromUrl: string, toUrl: string): string {
  const depth = fromUrl.split("/").length - 1;
  // An attachment is as free to be called "chart (final).png" as a note is.
  const encoded = encodeUrlPath(toUrl);
  return depth === 0 ? encoded : "../".repeat(depth) + encoded;
}
