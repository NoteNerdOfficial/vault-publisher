import { App, TFile } from "obsidian";

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
  /** References that could not be resolved to a vault file. */
  unresolved: string[];
  /** Total bytes, so a publish can report what it is about to upload. */
  bytes: number;
}

export function emptyAssetStats(): AssetStats {
  return { collected: 0, rewritten: 0, external: 0, unresolved: [], bytes: 0 };
}

/** Where a copied file lives in the published site. */
export function assetUrl(vaultPath: string): string {
  return `assets/files/${vaultPath}`;
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
): AssetStats {
  const stats = emptyAssetStats();
  const base = vaultBasePath(app);

  for (const el of Array.from(root.querySelectorAll("img, video, audio, source"))) {
    const src = el.getAttribute("src") ?? "";
    if (!src) continue;

    // Data URIs are already self-contained, and an http(s) reference is the
    // author pointing somewhere deliberately.
    if (/^(data|https?):/i.test(src)) {
      if (/^https?:/i.test(src)) stats.external++;
      continue;
    }

    const file = resolveFromWrapper(app, el, sourcePath) ?? resolveFromUrl(app, src, base);
    if (!file) {
      stats.unresolved.push(src.slice(0, 80));
      continue;
    }

    host.want(file);
    stats.collected++;
    el.setAttribute("src", relativeTo(fromUrl, assetUrl(file.path)));
    // Obsidian sizes embeds with an inline width from the link text; keep it.
    el.removeAttribute("alt-src");
    stats.rewritten++;
  }

  return stats;
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
  return depth === 0 ? toUrl : "../".repeat(depth) + toUrl;
}
