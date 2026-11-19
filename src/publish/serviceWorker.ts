/**
 * The service worker a locked site reads its files through.
 *
 * A locked build publishes every attachment and companion as `<name>.enc`,
 * and a decrypted page still asks for `<name>`. The unlock reader repairs
 * the references it can see when the page is written, and that is all it
 * can repair: a picture a script adds later, a `fetch()` for data, a module
 * importing a sibling chunk -- each of those asks the server for a name
 * that is not there, and gets a 404.
 *
 * A worker sees every request a page it controls makes, whenever and
 * however it is made. So this one answers a request for a locked file by
 * fetching the `.enc` beside it, decrypting it, and responding with the
 * plain bytes, and the page never knows the file was locked.
 *
 * ## It never holds the key for longer than it is alive
 *
 * The reader keeps derived key bits in `sessionStorage`, per tab, and the
 * lock screen promises no more than that. A browser stops an idle worker
 * whenever it likes, so a key kept in memory would be lost, and a key kept
 * in IndexedDB would outlive the tab. Instead, when the worker needs the key
 * it asks the page that made the request, over a `MessageChannel`, and the
 * page answers from `sessionStorage`. What the worker remembers while it is
 * alive is a cache: losing it costs one round trip, never a password.
 *
 * ## What it leaves alone
 *
 * Pages, the shell's own files, fonts, `.enc` files, other origins and
 * anything not a GET go straight to the network without a question. The
 * shell's own script in particular has to: the page cannot answer the
 * worker until that script has run, so asking about the script itself
 * would wait on an answer that is waiting on the script.
 *
 * And it is published at the root of the site, not in `assets/`, because a
 * worker controls only the pages at or below its own folder, and GitHub
 * Pages cannot send the header that would widen that.
 */

import { CRYPTO_HELPERS, MIME_HELPERS } from "./lockHelpers";

/** Where the worker is published: the root, so its scope is the site. */
export const SERVICE_WORKER_PATH = "osp-sw.js";

/** How long to wait for a page to answer before going to the network. */
const ASK_TIMEOUT_MS = 3000;

/** How long a page that never answered is left alone before being asked again. */
const SILENT_RETRY_MS = 10000;

/**
 * The worker's source, given the paths the lock leaves in the clear.
 *
 * Passed in rather than imported, because `lockSite` owns that list and
 * already imports from here.
 */
export function serviceWorkerScript(clearPaths: readonly string[]): string {
  return `(function () {
  var CLEAR = ${JSON.stringify([...clearPaths, SERVICE_WORKER_PATH])};
  var ASK_TIMEOUT = ${ASK_TIMEOUT_MS};
  var SILENT_RETRY = ${SILENT_RETRY_MS};

${CRYPTO_HELPERS}

${MIME_HELPERS}

  self.addEventListener("install", function (event) {
    event.waitUntil(self.skipWaiting());
  });

  // Claimed straight away, so the page that has just unlocked is served by
  // this worker from now on, and not only the next page it opens.
  self.addEventListener("activate", function (event) {
    event.waitUntil(self.clients.claim());
  });

  /* What each page answered: its key and its list of locked files. */
  var states = Object.create(null);
  /* Imported keys, by the bits they were made from. */
  var keys = Object.create(null);

  function scopePath() {
    return new URL(self.registration.scope).pathname;
  }

  /* A URL as a path from the root of the site, or null if it is outside. */
  function sitePathOf(url) {
    var base = scopePath();
    if (url.pathname.indexOf(base) !== 0) return null;
    try {
      return decodeURIComponent(url.pathname.slice(base.length));
    } catch (e) {
      return null;
    }
  }

  function exempt(path) {
    if (!path) return true;
    if (CLEAR.indexOf(path) !== -1) return true;
    return /\\.(enc|html?|woff2?|ttf|otf|eot)$/i.test(path);
  }

  function keyFor(bits) {
    if (!keys[bits]) {
      keys[bits] = importKey(b2u(bits)).catch(function () {
        delete keys[bits];
        return null;
      });
    }
    return keys[bits];
  }

  /*
   * The answer of the page that made a request.
   *
   * A page that is still locked answers with nothing, and that is not kept:
   * it will have a key in a moment. A page that does not answer at all --
   * a page from a site published without a password, say -- is left alone
   * for a while, so it does not pay the wait on every request it makes.
   */
  function ask(clientId) {
    if (states[clientId]) return states[clientId];
    var pending = self.clients
      .get(clientId)
      .then(function (client) {
        if (!client) return { silent: true };
        return new Promise(function (resolve) {
          var channel = new MessageChannel();
          var timer = setTimeout(function () {
            resolve({ silent: true });
          }, ASK_TIMEOUT);
          channel.port1.onmessage = function (event) {
            clearTimeout(timer);
            resolve({ reply: event.data || null });
          };
          client.postMessage({ type: "osp-sw-state" }, [channel.port2]);
        });
      })
      .then(function (outcome) {
        var reply = outcome.reply;
        if (outcome.silent) {
          setTimeout(function () {
            if (states[clientId] === pending) delete states[clientId];
          }, SILENT_RETRY);
          return null;
        }
        if (!reply || !reply.bits || !reply.assets) {
          delete states[clientId];
          return null;
        }
        return keyFor(reply.bits).then(function (key) {
          if (!key) {
            delete states[clientId];
            return null;
          }
          var wanted = Object.create(null);
          for (var i = 0; i < reply.assets.length; i++) wanted[reply.assets[i]] = true;
          return { key: key, wanted: wanted };
        });
      })
      .catch(function () {
        delete states[clientId];
        return null;
      });
    states[clientId] = pending;
    return pending;
  }

  function serve(request, url, path, state) {
    return fetch(url.origin + url.pathname + ".enc", { credentials: "same-origin" })
      .then(function (response) {
        if (!response.ok) {
          return new Response(null, { status: response.status, statusText: response.statusText });
        }
        return response
          .json()
          .then(function (blob) {
            return decrypt(state.key, blob);
          })
          .then(
            function (bytes) {
              return new Response(bytes, {
                status: 200,
                headers: { "Content-Type": mimeFor(path) },
              });
            },
            // Never the ciphertext, and never a hang: a file that will not
            // decrypt is an error the page can see.
            function () {
              return new Response(null, { status: 500 });
            },
          );
      });
  }

  self.addEventListener("fetch", function (event) {
    var request = event.request;
    if (request.method !== "GET") return;
    // A navigation has no client yet. Pages go through the lock shell.
    if (!event.clientId) return;
    var url;
    try {
      url = new URL(request.url);
    } catch (e) {
      return;
    }
    if (url.origin !== self.location.origin) return;
    var path = sitePathOf(url);
    if (path === null || exempt(path)) return;

    event.respondWith(
      ask(event.clientId).then(function (state) {
        if (!state || !state.wanted[path]) return fetch(request);
        return serve(request, url, path, state);
      }),
    );
  });
})();
`;
}

/**
 * What a site published without a password puts where the worker was.
 *
 * A browser keeps a registered worker after its script disappears from the
 * server: an update that finds a 404 fails and leaves the old one in
 * charge. So a site that was locked and no longer is would go on asking
 * every page for a key it does not have. This replaces the worker with one
 * that removes itself, and the browser's next update check installs it.
 */
export const RETIRED_SERVICE_WORKER = `self.addEventListener("install", function () {
  self.skipWaiting();
});
self.addEventListener("activate", function (event) {
  event.waitUntil(self.registration.unregister());
});
`;
