/**
 * A runtime stand-in for the `obsidian` module.
 *
 * The real package ships type declarations and nothing else -- the
 * implementation lives inside the app, and esbuild marks it external. That is
 * correct for the bundle and leaves a test runner with an import it cannot
 * resolve, so this provides the few names the module graph mentions.
 *
 * Nothing here is constructed at import time by the code under test: these
 * exist so the graph loads, not so it runs. A test that needs App or TFile
 * behaviour builds its own stub and passes it in.
 */

export class Component {
  load(): void {}
  unload(): void {}
}

export class MarkdownRenderer {
  static async render(): Promise<void> {}
}

export class Notice {
  constructor(public message?: string) {}
}

export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class Modal {}
export class TFile {}
export class TFolder {}

export const apiVersion = "0.0.0-test";

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Obsidian's HTTP call, replaceable per test.
 *
 * Declared with `let` and exported directly so that `setRequestUrl` is seen
 * by modules that already imported it: an ES module export is a live binding,
 * not a copy. Anything reached through `GitHubClient` therefore uses whatever
 * the current test installed, with no seam needed in the client itself.
 */
export let requestUrl: (options: any) => Promise<any> = async () => {
  throw new Error(
    "requestUrl was called without setRequestUrl: install a fake first.",
  );
};

/** Installs a fake. Returns a function restoring the previous one. */
export function setRequestUrl(fake: (options: any) => Promise<any>): () => void {
  const previous = requestUrl;
  requestUrl = fake;
  return () => {
    requestUrl = previous;
  };
}
