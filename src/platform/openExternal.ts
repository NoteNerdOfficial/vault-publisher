/**
 * Opens a URL outside Obsidian.
 *
 * Electron's shell first, because that hands the link to the operating
 * system's own browser, which is where someone expects a link out of a
 * desktop app to go. `window.open` inside Obsidian opens a Chromium window
 * belonging to the app: it works, but it is a browser with no bookmarks, no
 * extensions and no session, which is the wrong place to land on a sign-in
 * page or a plugin listing.
 *
 * The bridge is reached through `require` rather than imported, because it
 * only exists on the desktop app. On mobile, and in a test, the lookup
 * throws or comes back empty and the window is the answer.
 */
export function openExternal(url: string): void {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const req: ((id: string) => any) | undefined =
      (globalThis as any).require ?? (window as any).require;
    const shell = req?.("electron")?.shell;
    if (shell?.openExternal) {
      void shell.openExternal(url);
      return;
    }
  } catch {
    // Fall through: a window is better than nothing.
  }
  window.open(url, "_blank");
}
