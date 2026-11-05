import { callMethod, hasMethod, prop, requireModule } from "./dynamic";

/**
 * Opens a URL outside the app.
 *
 * Electron's shell first, because that hands the link to the operating
 * system's own browser, which is where someone expects a link out of a
 * desktop app to go. `window.open` inside the app opens a Chromium window
 * belonging to it: that works, but it is a browser with no bookmarks, no
 * extensions and no session, which is the wrong place to land on a sign-in
 * page or a plugin listing.
 *
 * The bridge is reached through `require` rather than imported, because it
 * only exists on the desktop app. On mobile, and in a test, the lookup comes
 * back empty and the window is the answer. See `dynamic.ts` for why none of
 * this is typed as `any`.
 */
export function openExternal(url: string): void {
  try {
    const shell = prop(requireModule("electron"), "shell");
    // The method, not just the object: a bridge that is present but has lost
    // `openExternal` has to fall through to the window like a missing one.
    if (hasMethod(shell, "openExternal")) {
      // `openExternal` returns a promise that rejects when the OS has no
      // handler for the scheme. Nothing here can do better than the window
      // fallback, and this call has already committed to the shell, so the
      // rejection is swallowed rather than left unhandled.
      const opening = callMethod(shell, "openExternal", url);
      if (opening instanceof Promise) void opening.catch(() => {});
      return;
    }
  } catch {
    // Fall through: a window is better than nothing.
  }
  window.open(url, "_blank");
}
