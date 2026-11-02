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
 * Deliberately plain, and deliberately says nothing. No title but a
 * generic one, no description, `noindex` so a crawler does not keep a
 * record of a page it cannot read, and no mention of the site's name --
 * which is the author's wording and may itself be the thing being kept
 * quiet.
 */
export function lockShell(payload: LockedPayload & { root: string }): string {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Protected</title>
<style>
:root { color-scheme: light dark; --fg: #15181c; --fg-2: #596069; --bg: #fdfdfc; --line: #e1e4e8; --ink: #d4421e; }
@media (prefers-color-scheme: dark) { :root { --fg: #e6e9ed; --fg-2: #9ba3ac; --bg: #16181c; --line: #2e333a; --ink: #f2603a; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
  background: var(--bg); color: var(--fg);
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { width: 100%; max-width: 22rem; text-align: center; }
h1 { margin: 0 0 6px; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
p { margin: 0 0 18px; color: var(--fg-2); font-size: 13px; }
form { display: flex; gap: 8px; }
input { flex: 1; min-width: 0; height: 38px; padding: 0 12px; border: 1px solid var(--line);
  border-radius: 8px; background: var(--bg); color: var(--fg); font: inherit; font-size: 14px; }
input:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }
button { height: 38px; padding: 0 16px; border: 0; border-radius: 8px; background: var(--ink);
  color: #fff; font: inherit; font-size: 14px; font-weight: 550; cursor: pointer; }
button[disabled] { opacity: 0.6; cursor: default; }
.err { margin: 14px 0 0; color: var(--ink); font-size: 13px; }
noscript { display: block; margin-top: 14px; color: var(--fg-2); font-size: 13px; }
</style>
</head>
<body>
<main>
<h1>This page is protected</h1>
<p>Enter the password to read it.</p>
<form id="osp-unlock-form">
<input id="osp-unlock-password" type="password" autocomplete="current-password" aria-label="Password" required>
<button id="osp-unlock-button" type="submit">Unlock</button>
</form>
<p class="err" id="osp-unlock-error" hidden>That password did not work.</p>
<noscript>This page is encrypted, so reading it needs JavaScript.</noscript>
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
      const payload = await lockText(
        JSON.stringify({ html: String(file.content), assets }),
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
