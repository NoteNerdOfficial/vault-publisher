import type { App } from "obsidian";
import { callMethod, hasMethod, prop } from "./dynamic";

/**
 * The Terminus plugin's browser, when it is installed.
 *
 * Terminus is a terminal plugin with a browser pane of its own, inside
 * Obsidian, which Claude sessions running in Terminus can drive. The preview
 * server only answers requests that carry the token it hands the browser it
 * opens, so neither a person typing its port into that pane nor an agent
 * that found the port could ever get in. Registering the preview with
 * Terminus fixes both: Terminus asks this plugin for the address when it
 * opens the preview, token and all, and never shows the address to anyone.
 *
 * Neither plugin needs the other. Without Terminus every function here
 * reports that it is not there and does nothing, and the preview opens in
 * the system browser exactly as it always has. Without this plugin,
 * Terminus has no preview to offer. Terminus's API is reached at run time
 * and checked hop by hop, because it may be missing, disabled, or older.
 */

/** Terminus fires this once its API is ready, so a plugin that loaded first can register then. */
export const TERMINUS_READY_EVENT = "terminus:api-ready";

/** What this plugin registers. Mirrors Terminus's `BrowserSite`. */
export interface TerminusSite {
  id: string;
  name: string;
  description: string;
  open(): Promise<string>;
  sourceFor(pageUrl: string): string | null;
}

/** Terminus's API, version 1 or later, or null. */
function terminusApi(app: App): unknown {
  const plugin = callMethod(prop(app, "plugins"), "getPlugin", "terminus");
  const api = prop(plugin, "api");
  const version = prop(api, "version");
  return typeof version === "number" && version >= 1 ? api : null;
}

/** Whether the Terminus browser can open the preview here. */
export function terminusBrowserAvailable(app: App): boolean {
  const api = terminusApi(app);
  if (!api || !hasMethod(api, "browserAvailable")) return false;
  return callMethod(api, "browserAvailable") === true;
}

/**
 * Offers the preview to Terminus. Returns a function that withdraws it, or
 * null when Terminus is not there to offer it to.
 */
export function registerWithTerminus(app: App, site: TerminusSite): (() => void) | null {
  const api = terminusApi(app);
  if (!api || !hasMethod(api, "registerSite")) return null;
  const unregister = callMethod(api, "registerSite", site);
  return typeof unregister === "function" ? () => void (unregister as () => unknown)() : null;
}

/** Opens a registered site in a Terminus browser tab. */
export async function openInTerminus(app: App, siteId: string): Promise<void> {
  const api = terminusApi(app);
  if (!api || !hasMethod(api, "openInBrowser")) {
    throw new Error("Terminus isn't installed or enabled.");
  }
  await callMethod(api, "openInBrowser", { siteId });
}

/**
 * The preview path an address points at, as the preview's page list keys
 * it: no leading slash, decoded, and `index.html` for a folder.
 */
export function previewPathOf(pageUrl: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(new URL(pageUrl).pathname);
  } catch {
    return null;
  }
  path = path.replace(/^\/+/, "");
  if (path === "" || path.endsWith("/")) path += "index.html";
  return path;
}

/**
 * The note a built page would have come from: the reverse of `urlForNote`,
 * which keeps the folder structure and swaps the extension. A guess the
 * caller checks against the vault, since an index or tag page has no note.
 */
export function notePathForPreview(previewPath: string, folder: string | null): string | null {
  if (!/\.html$/i.test(previewPath)) return null;
  const note = previewPath.replace(/\.html$/i, ".md");
  return folder ? `${folder}/${note}` : note;
}
