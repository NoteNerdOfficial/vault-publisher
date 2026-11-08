/**
 * Turning a built site into a protected one.
 *
 * Runs over the finished file list, so it needs to know nothing about how
 * any of it was produced: every `.html` file becomes a shell holding its
 * own encrypted document, every attachment becomes a `.enc` beside the
 * name it had, and the few files that have to stay readable stay readable.
 *
 * Encrypting each page *whole* is what makes this honest. A page carries
 * its own title, its navigation, its breadcrumbs and its links to every
 * other page, so encrypting a body and leaving the document around it
 * would publish the shape of the vault while claiming to protect it. The
 * shell that remains says only that a password is needed.
 *
 * What stays in the clear, and why none of it is content: the stylesheets
 * (Obsidian's theme and ours), the site and overlay scripts, the unlock
 * reader itself, the harvested fonts, `.nojekyll` and `CNAME`. A reader
 * without the password learns that the site exists, that it was made with
 * this plugin, and nothing else.
 */

import { PublishFile } from "../github/client";
import {
  LOCK_ITERATIONS,
  LockedPayload,
  deriveKey,
  lock,
  lockText,
  newSalt,
  toBase64,
} from "./encrypt";
import { UNLOCK_SCRIPT } from "./unlockScript";
import { escapeHtml, pathToRoot } from "./page";

/** Where the reader is published. */
export const UNLOCK_SCRIPT_PATH = "assets/unlock.js";

/**
 * Files that must stay readable for the shell to work at all, plus the
 * ones that carry nothing about the vault.
 *
 * Matched exactly, not by prefix: `assets/` also holds the attachments,
 * which are the content most worth protecting.
 */
const ALWAYS_CLEAR = new Set([
  ".nojekyll",
  "CNAME",
  "assets/site.css",
  "assets/obsidian.css",
  "assets/site.js",
  "assets/overlay.js",
  UNLOCK_SCRIPT_PATH,
]);

/** A harvested webfont is Obsidian's, not the author's. */
function isFont(path: string): boolean {
  return /\.(woff2?|ttf|otf|eot)$/i.test(path);
}

export function staysClear(path: string): boolean {
  return ALWAYS_CLEAR.has(path) || isFont(path);
}

export function isPage(path: string): boolean {
  return /\.html?$/i.test(path);
}

/**
 * The shell a locked page is published as.
 *
 * It says nothing about the site. No name, no description, a generic title
 * and `noindex`, because the author's own wording may be the thing being
 * kept quiet.
 *
 * It says almost nothing about itself either, which is a decision rather
 * than an omission. A draft of this screen explained that the page is
 * ciphertext, that the password never leaves the device and that nothing is
 * sent anywhere: all true, all unusual, and all of it jargon to most of the
 * people who will ever see this page. Somebody who has been sent a link
 * wants in. So the screen now names the one thing they can act on -- the
 * person who sent the link has the password -- and gets out of the way.
 *
 * The cost is real and worth stating, in case it is ever revisited: with
 * the explanation gone this reads like a login, and it is not one. There is
 * no account, nothing is transmitted, and the decryption happens here. If
 * that ever needs saying, it belongs in a disclosure under the field rather
 * than in front of a reader who only wants to read the page.
 *
 * Three decisions, each replacing something that was wrong rather than
 * merely plain.
 *
 * **The action and the failure no longer share a colour.** They both used
 * `--ink`, so the button a reader is meant to press and the sentence
 * telling them it did not work were the same red.
 *
 * **The wait is reported.** Deriving the key is 600,000 PBKDF2 iterations:
 * close to a second on a laptop and several on a phone, and until now the
 * whole of the feedback was `opacity: 0.6` on a disabled button. The only
 * hook `unlockScript.ts` offers is `disabled` on that button, so the rest
 * is reached from there in CSS: `:has()` lifts it to the form and fills a
 * rule under the field. Where `:has()` is missing the button still dims,
 * which is exactly what the page did before.
 *
 * **The surfaces the browser draws are themed too** -- the caret, the
 * selection, the focus ring -- and the viewport is `100dvh`, because
 * `100vh` on a phone is measured through the browser chrome.
 *
 * The palette is deliberately neutral rather than accented. This page runs
 * in front of a site that may be built in any of five themes, and an
 * accent chosen here would promise a colour the site does not have. Red is
 * reserved for the one thing that is actually wrong.
 *
 * It is inlined into every locked page, so it is kept short on purpose: a
 * three-hundred-note site pays for this stylesheet three hundred times.
 */
export function lockShell(payload: LockedPayload & { root: string }): string {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Protected</title>
<style>
:root { color-scheme: light dark;
  --bg: #fbfbfa; --fg: #14171a; --fg-2: #646b74; --line: #dcdfe3;
  --field: #fff; --ink: #15181c; --bad: #b3261e; }
@media (prefers-color-scheme: dark) { :root {
  --bg: #0f1113; --fg: #e9ecef; --fg-2: #8b949e; --line: #2a2f35;
  --field: #16191d; --ink: #e9ecef; --bad: #ff6b5e; } }
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; min-height: 100dvh; display: grid;
  place-items: center; padding: 28px; background: var(--bg); color: var(--fg);
  caret-color: var(--ink);
  font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
::selection { background: color-mix(in srgb, var(--ink) 18%, transparent); }
main { width: 100%; max-width: 22rem; }
.mark { color: var(--fg-2); margin-bottom: 18px; }
h1 { margin: 0 0 8px; font-size: 20px; font-weight: 600; letter-spacing: -0.016em; }
.lead { margin: 0 0 20px; color: var(--fg-2); font-size: 14px; }
form { position: relative; }
input { width: 100%; height: 46px; padding: 0 46px 0 14px; border: 1px solid var(--line);
  border-radius: 10px; background: var(--field); color: var(--fg); font: inherit;
  font-size: 15px; letter-spacing: 0.06em; transition: border-color 140ms ease, box-shadow 140ms ease; }
input::placeholder { color: var(--fg-2); letter-spacing: 0; }
input:focus { outline: none; border-color: var(--ink);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ink) 15%, transparent); }
button { position: absolute; top: 50%; right: 6px; transform: translateY(-50%);
  display: grid; place-items: center; width: 34px; height: 34px; border: 0;
  border-radius: 8px; background: transparent; color: var(--fg-2); cursor: pointer;
  transition: background 130ms ease, color 130ms ease; }
button:hover { background: color-mix(in srgb, var(--ink) 10%, transparent); color: var(--fg); }
button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
button:disabled { cursor: default; color: var(--fg-2); background: transparent; }
/* Busy, from the one hook the unlock script sets. */
.track { position: absolute; left: 1px; right: 1px; bottom: 1px; height: 2px;
  border-radius: 0 0 9px 9px; overflow: hidden; opacity: 0; transition: opacity 120ms ease; }
.track i { display: block; height: 100%; width: 0; background: var(--ink); }
form:has(button:disabled) .track { opacity: 1; }
form:has(button:disabled) .track i { animation: osp-fill 2.4s cubic-bezier(.16,1,.3,1) forwards; }
form:has(button:disabled) input { border-color: var(--ink); }
@keyframes osp-fill { from { width: 0 } to { width: 100% } }
@media (prefers-reduced-motion: reduce) {
  form:has(button:disabled) .track i { animation: none; width: 100%; opacity: .5 } }
/* [hidden] is a UA rule at attribute specificity; a class that sets
   display beats it, which would put the failure on screen before one. */
.err[hidden] { display: none; }
.err { display: flex; gap: 7px; align-items: flex-start; margin: 12px 0 0;
  color: var(--bad); font-size: 13px; }
.err::before { content: ""; flex: none; width: 3px; align-self: stretch;
  border-radius: 2px; background: var(--bad); }
noscript { display: block; margin-top: 14px; color: var(--fg-2); font-size: 13px; }
</style>
</head>
<body>
<main>
<div class="mark"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10.5" width="16" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg></div>
<h1>Password needed</h1>
<p class="lead">This page is locked. Ask whoever sent you the link if you don't have the password.</p>
<form id="osp-unlock-form">
<input id="osp-unlock-password" type="password" autocomplete="current-password" aria-label="Password" placeholder="Password" required autofocus>
<button id="osp-unlock-button" type="submit" aria-label="Unlock"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13"/><path d="m12 6 6 6-6 6"/></svg></button>
<span class="track" aria-hidden="true"><i></i></span>
</form>
<p class="err" id="osp-unlock-error" role="alert" hidden><span>That's not the right password. Try again.</span></p>
<noscript>This page needs JavaScript to unlock.</noscript>
</main>
<script id="osp-locked" type="application/json">${json}</script>
<script src="${payload.root}${UNLOCK_SCRIPT_PATH}"></script>
</body>
</html>
`;
}

export interface LockResult {
  files: PublishFile[];
  /** How many of each, for the publish log. */
  pages: number;
  assets: number;
}

/**
 * Encrypts a built site in place of itself.
 *
 * One salt for the whole build, a fresh IV per file, and the iteration
 * count written into every payload so raising it later does not strand a
 * site published before the change.
 */
export async function lockSite(
  files: PublishFile[],
  password: string,
  iterations: number = LOCK_ITERATIONS,
): Promise<LockResult> {
  const salt = newSalt();
  const key = await deriveKey(password, salt, iterations);

  // Named before anything is encrypted, because every page's payload
  // carries the list: a decrypted page has to know which of its own
  // references are files that are not there under the name it used.
  const assets = files
    .filter((file) => !isPage(file.path) && !staysClear(file.path))
    .map((file) => file.path);

  const out: PublishFile[] = [];
  let pages = 0;

  for (const file of files) {
    if (staysClear(file.path)) {
      out.push(file);
      continue;
    }

    if (isPage(file.path)) {
      // Decoded rather than String()-ed: a page whose content arrived as a
      // buffer would otherwise be locked as the text "[object ArrayBuffer]".
      const html =
        typeof file.content === "string"
          ? file.content
          : new TextDecoder().decode(file.content);
      const payload = await lockText(
        JSON.stringify({ html, assets }),
        key,
        salt,
        iterations,
      );
      const root = pathToRoot(file.path);
      out.push({
        path: file.path,
        content: lockShell({ ...payload, root }),
      });
      pages++;
      continue;
    }

    const bytes =
      typeof file.content === "string"
        ? new TextEncoder().encode(file.content)
        : new Uint8Array(file.content);
    const payload = await lock(bytes, key, salt, iterations);
    // Beside the name the page used, with `.enc` on the end, so the reader
    // can find it from the reference it already has.
    out.push({ path: `${file.path}.enc`, content: JSON.stringify(payload) });
  }

  out.push({ path: UNLOCK_SCRIPT_PATH, content: UNLOCK_SCRIPT });

  return { files: out, pages, assets: assets.length };
}

/** Exported for the tests, which should not have to guess the salt. */
export function saltOf(payload: LockedPayload): string {
  return payload.salt;
}

export { toBase64, escapeHtml };
