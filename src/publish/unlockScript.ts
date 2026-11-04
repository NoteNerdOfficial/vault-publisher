/**
 * The reader that turns an encrypted page back into a page.
 *
 * Shipped in the clear, because it has to be: it is the only thing a
 * browser can run before the password is known. It contains no secret --
 * everything it needs beyond the password travels in the payload it is
 * decrypting.
 *
 * **It replaces the document rather than filling one in.** The shell it
 * arrives in is a form and nothing else; the real page is a whole HTML
 * document inside the payload, nav and all, because encrypting a page
 * whole is what keeps its title and its navigation out of the public
 * build. So unlocking is `document.write` of the decrypted document, which
 * keeps the URL and runs the page's own scripts as a normal load would.
 *
 * **The key is cached for the tab, not the browser.** Without it every
 * link in the site would ask for the password again, which is the thing
 * that makes people pick a short one. `sessionStorage` is per-tab and goes
 * when the tab does. It holds derived key bits rather than the password,
 * so what is sitting there cannot be typed into anything else -- and it is
 * no more exposed than the decrypted page already is, since anything that
 * can read it can read the document it unlocked.
 *
 * ## Why the files a page needs are revived in two passes
 *
 * A locked build encrypts the page's own files too, so a decrypted
 * document references names that are not on the server: `styles.css` is
 * published as `styles.css.enc`. Reviving them means fetching, decrypting
 * and handing the bytes to the document as a blob URL -- and *when* that
 * happens decides whether it works at all.
 *
 * A picture can be swapped after the page is up: setting `src` on an
 * `<img>` fetches again, so the page is readable while its images are
 * still arriving. **A script cannot.** An element whose load has already
 * been attempted does not try again when its `src` changes, so a
 * `<script>` pointing at a missing file is a script that never runs, and
 * nothing done afterwards brings it back. A `<link rel=stylesheet>` does
 * re-fetch, but by then the page has already been painted unstyled.
 *
 * So anything the parser has to have is rewritten *before* the document is
 * written -- in a detached parse of the HTML, where a script is inert and
 * setting its `src` loads nothing -- and the rest is swapped afterwards,
 * as it was.
 *
 * The regression that paid for this: an as-is React or Angular build
 * published into a locked site rendered a blank page, and a hand-written
 * page lost its stylesheet. Both files were published, encrypted, and
 * correctly named in the markup; they were being repaired one moment too
 * late.
 *
 * ## Why a blob needs its type
 *
 * `new Blob([bytes])` has no type, and a blob URL serves the blob's type
 * as its `Content-Type`. A browser refuses a stylesheet that does not
 * arrive as `text/css` and a module script that does not arrive as a
 * JavaScript type, so a typeless blob is rejected exactly where it matters
 * most. The type is derived from the file's extension, which is the only
 * thing left to derive it from once the bytes are ciphertext.
 *
 * ## What this still cannot do
 *
 * A module that imports another module resolves that import against its
 * own URL, and a blob URL has no path to resolve against -- so a build
 * split into chunks, or one that fetches its own data at runtime, has
 * references this never sees. Single-bundle output works; code-splitting
 * needs the site published without a password.
 */
export const UNLOCK_SCRIPT = `(function () {
  var holder = document.getElementById("osp-locked");
  if (!holder) return;

  var payload;
  try {
    payload = JSON.parse(holder.textContent || "{}");
  } catch (e) {
    return;
  }
  if (!payload || !payload.data) return;

  var KEY_PREFIX = "osp-unlocked:";
  var ROOT = payload.root || "";
  var form = document.getElementById("osp-unlock-form");
  var field = document.getElementById("osp-unlock-password");
  var error = document.getElementById("osp-unlock-error");
  var button = document.getElementById("osp-unlock-button");

  function b2u(value) {
    var binary = atob(value);
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function u2b(bytes) {
    var binary = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  /*
   * Derived bits rather than a key object, because a CryptoKey cannot be
   * put in sessionStorage and asking for the password once per page is
   * what makes people choose a password worth guessing.
   */
  function deriveBits(password) {
    return crypto.subtle
      .importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"])
      .then(function (base) {
        return crypto.subtle.deriveBits(
          {
            name: "PBKDF2",
            salt: b2u(payload.salt),
            iterations: payload.iterations,
            hash: "SHA-256",
          },
          base,
          256
        );
      })
      .then(function (bits) {
        return new Uint8Array(bits);
      });
  }

  function importKey(bits) {
    return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, [
      "decrypt",
    ]);
  }

  function decrypt(key, blob) {
    return crypto.subtle
      .decrypt({ name: "AES-GCM", iv: b2u(blob.iv) }, key, b2u(blob.data))
      .then(function (plain) {
        return new Uint8Array(plain);
      });
  }

  /*
   * The type a blob URL will serve its bytes as.
   *
   * A stylesheet is refused unless it arrives as text/css and a module
   * script unless it arrives as a JavaScript type, so this is not a
   * nicety -- a typeless blob fails in exactly the two places that
   * decide whether a page renders. The extension is all there is to go
   * on once the bytes are ciphertext.
   */
  var TYPES = {
    js: "text/javascript",
    mjs: "text/javascript",
    css: "text/css",
    json: "application/json",
    map: "application/json",
    wasm: "application/wasm",
    html: "text/html",
    htm: "text/html",
    txt: "text/plain",
    xml: "application/xml",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    bmp: "image/bmp",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    wav: "audio/wav",
    flac: "audio/flac",
    m4a: "audio/mp4",
    pdf: "application/pdf"
  };

  function mimeFor(path) {
    var at = String(path).lastIndexOf(".");
    var ext = at === -1 ? "" : String(path).slice(at + 1).toLowerCase();
    return TYPES[ext] || "application/octet-stream";
  }

  /*
   * The site's own root, as an absolute URL.
   *
   * Every path in the payload's asset list is written from the root of the
   * site, and every reference on the page is written from wherever the thing
   * holding it sits -- \`../assets/files/pic.png\` from a note two folders
   * down, a bare \`styles.css\` from an as-is page beside its own stylesheet,
   * and \`art/panel.svg\` from inside that stylesheet, which is a third
   * place again. Comparing the two means resolving the reference properly
   * rather than trimming \`../\` off the front of it: the trimming version
   * matched the note pages and silently missed every reference an as-is page
   * makes to a file in its own folder.
   */
  var ROOT_URL = null;
  try {
    ROOT_URL = new URL(ROOT || "./", location.href);
  } catch (e) {
    ROOT_URL = null;
  }

  /*
   * A reference as a path from the root of the site, or null if it is not one.
   *
   * \`base\` is what the reference is relative *to*, which is not always the
   * page: a \`url()\` inside a stylesheet resolves against the stylesheet.
   */
  function sitePath(raw, base) {
    if (!raw || !ROOT_URL) return null;
    if (/^(data|blob|mailto|tel|javascript|#):/i.test(raw)) return null;
    if (String(raw).charAt(0) === "#") return null;
    var url;
    try {
      url = new URL(raw, base || location.href);
    } catch (e) {
      return null;
    }
    if (url.origin !== ROOT_URL.origin) return null;
    if (url.pathname.indexOf(ROOT_URL.pathname) !== 0) return null;
    try {
      return decodeURIComponent(url.pathname.slice(ROOT_URL.pathname.length));
    } catch (e) {
      return null;
    }
  }

  /*
   * Where a file published at this site path is served from. Each segment is
   * encoded, because a vault file may be called anything a filesystem allows.
   */
  function siteUrl(path) {
    var parts = String(path).split("/");
    for (var i = 0; i < parts.length; i++) parts[i] = encodeURIComponent(parts[i]);
    return ROOT + parts.join("/");
  }

  /** The encrypted copy: beside the name the page used, with \`.enc\` on it. */
  function encUrl(path) {
    return siteUrl(path) + ".enc";
  }

  /** Absolute, for resolving what a file of our own refers to. */
  function siteBase(path) {
    try {
      return new URL(siteUrl(path), location.href).href;
    } catch (e) {
      return location.href;
    }
  }

  /*
   * One blob URL per file, however many times the site refers to it.
   *
   * A stylesheet named by a page and by another stylesheet, or an image used
   * twice, is fetched and decrypted once -- and every pass below shares this,
   * so a stylesheet revived before the write is not fetched again by the
   * sweep afterwards.
   */
  var made = {};

  /*
   * Stylesheets whose own references are being rewritten right now.
   *
   * A sheet that imports itself, or two that import each other, would
   * otherwise wait for a blob URL that is waiting for them -- and the page
   * would never be written at all. A reference back into the chain is left
   * as it stands, which is a broken url() in a pathological stylesheet
   * rather than a page that never arrives.
   */
  var rewriting = {};

  function load(key, path, wanted) {
    if (made[path]) return made[path];
    made[path] = fetch(encUrl(path))
      .then(function (response) {
        return response && response.ok ? response.json() : null;
      })
      .then(function (blob) {
        return blob ? decrypt(key, blob) : null;
      })
      .then(function (bytes) {
        if (!bytes) return null;
        if (!/\\.css$/i.test(path)) {
          return URL.createObjectURL(new Blob([bytes], { type: mimeFor(path) }));
        }
        /*
         * A stylesheet is rewritten before it is handed over, and it has to
         * be: its own \`url()\` references resolve against *its* URL, and a
         * blob URL has no folder for a relative reference to resolve
         * against. So they are made absolute here or they do not resolve at
         * all.
         */
        rewriting[path] = true;
        return rewriteCss(
          new TextDecoder().decode(bytes),
          key,
          wanted || {},
          siteBase(path),
        ).then(function (text) {
          delete rewriting[path];
          return URL.createObjectURL(new Blob([text], { type: "text/css" }));
        });
      })
      .catch(function () {
        delete rewriting[path];
        return null;
      });
    return made[path];
  }

  /*
   * What a stylesheet asks for, which no attribute mentions.
   *
   * \`background-image: url(art/texture.svg)\` is a reference to a file like
   * any other, and the only pass that would ever have seen it is this one:
   * it is in the text of a rule, not in a \`src\` or an \`href\`. The same
   * function does a \`<style>\` block, a \`style\` attribute and the body of
   * a decrypted .css, because in all three the thing being read is a list of
   * declarations.
   */
  var CSS_URL = /url\\(\\s*(['"]?)([^'")]*)\\1\\s*\\)/gi;

  function rewriteCss(text, key, wanted, base) {
    var body = String(text);
    var swaps = Object.create(null);
    var jobs = [];

    body.replace(CSS_URL, function (whole, quote, raw) {
      if (swaps[raw] !== undefined) return whole;
      var path = sitePath(raw, base);
      if (!path || !wanted[path] || rewriting[path]) return whole;
      swaps[raw] = null;
      jobs.push(
        load(key, path, wanted).then(function (url) {
          swaps[raw] = url;
        }),
      );
      return whole;
    });

    if (!jobs.length) return Promise.resolve(body);
    return Promise.all(jobs).then(function () {
      return body.replace(CSS_URL, function (whole, quote, raw) {
        return swaps[raw] ? 'url("' + swaps[raw] + '")' : whole;
      });
    });
  }

  /*
   * A candidate list, rewritten whole or not at all.
   *
   * \`srcset\` is comma-separated "url descriptor" pairs and it beats \`src\`
   * wherever the browser can use it -- so a picture whose \`src\` was swapped
   * and whose \`srcset\` was left alone is a picture still pointing at a file
   * that is not there, which is the one case where repairing half of it is
   * worse than repairing none.
   */
  function rewriteSrcset(value, key, wanted, base) {
    var parts = String(value).split(",");
    var jobs = [];
    for (var i = 0; i < parts.length; i++) {
      (function (at) {
        var bits = parts[at].trim().split(/\\s+/);
        var path = sitePath(bits[0], base);
        if (!path || !wanted[path]) return;
        jobs.push(
          load(key, path, wanted).then(function (url) {
            if (!url) return;
            bits[0] = url;
            parts[at] = bits.join(" ");
          }),
        );
      })(i);
    }
    if (!jobs.length) return Promise.resolve(null);
    return Promise.all(jobs).then(function () {
      return parts.join(", ");
    });
  }

  /*
   * Whether a value names a locked file, as a single reference or as a list
   * of candidates. One function for both, because \`srcset\` is the only
   * difference between them and a comma is all it takes to tell.
   */
  function namesLocked(value, wanted) {
    var parts = String(value).split(",");
    for (var i = 0; i < parts.length; i++) {
      var first = parts[i].trim().split(/\\s+/)[0];
      var path = sitePath(first);
      if (path && wanted[path]) return true;
    }
    return false;
  }

  /** Where a stripped reference waits for the sweep to come back for it. */
  var HELD = "data-osp-enc-";

  function wantedSet(assets) {
    var wanted = Object.create(null);
    for (var i = 0; i < (assets || []).length; i++) wanted[assets[i]] = true;
    return wanted;
  }

  /*
   * The files the parser has to have, put in place before it runs.
   *
   * Done in a detached parse rather than on the live document, which is the
   * whole point: a script in a document from \`DOMParser\` is inert, so its
   * \`src\` can be pointed at a blob URL and it will load that -- once --
   * when the document is written. A script in the live document has already
   * tried and failed, and nothing brings it back.
   *
   * Scripts and stylesheets only. A stylesheet's own images are waited for
   * too, because a sheet applied with a dead \`url()\` in it is a wrong
   * stylesheet rather than a slow one; everything else is left to the sweep
   * afterwards, so a page is readable before its pictures have arrived.
   *
   * The doctype is written back by hand. \`documentElement.outerHTML\` does
   * not carry one, and a document written without it is in quirks mode.
   */
  function reviveCritical(html, key, assets) {
    if (!assets || !assets.length) return Promise.resolve(html);
    var wanted = wantedSet(assets);

    var doc;
    try {
      doc = new DOMParser().parseFromString(html, "text/html");
    } catch (e) {
      return Promise.resolve(html);
    }
    if (!doc || !doc.documentElement) return Promise.resolve(html);

    var jobs = [];

    var linked = doc.querySelectorAll("script[src], link[href]");
    for (var n = 0; n < linked.length; n++) {
      (function (node) {
        var attr = node.tagName === "SCRIPT" ? "src" : "href";
        var path = sitePath(node.getAttribute(attr) || "");
        if (!path || !wanted[path]) return;
        jobs.push(
          load(key, path, wanted).then(function (url) {
            if (url) node.setAttribute(attr, url);
          }),
        );
      })(linked[n]);
    }

    var blocks = doc.querySelectorAll("style");
    for (var b = 0; b < blocks.length; b++) {
      (function (node) {
        var text = node.textContent || "";
        if (text.indexOf("url(") === -1) return;
        jobs.push(
          rewriteCss(text, key, wanted, location.href).then(function (out) {
            if (out && out !== text) node.textContent = out;
          }),
        );
      })(blocks[b]);
    }

    /*
     * Pictures, taken off the page before the parser asks for them.
     *
     * They are deliberately not revived here -- that would hold the page
     * back until its images had arrived, which is the whole reason there is
     * a second pass. But the reference has to come out of the attribute the
     * browser fetches and into one it ignores, or every locked image is a
     * request for a name that is not on the server: a 404 in the console
     * and a broken-image icon on the page until the sweep replaces it.
     *
     * Scripts are left alone: they were dealt with above, and a script with
     * its \`src\` taken away is a script that never runs.
     */
    var media = doc.querySelectorAll("[src], [poster], [srcset], [imagesrcset]");
    var holding = ["src", "poster", "srcset", "imagesrcset"];
    for (var m = 0; m < media.length; m++) {
      (function (node) {
        if (node.tagName === "SCRIPT") return;
        for (var a = 0; a < holding.length; a++) {
          var attr = holding[a];
          if (!node.hasAttribute(attr)) continue;
          var value = node.getAttribute(attr) || "";
          if (!namesLocked(value, wanted)) continue;
          node.setAttribute(HELD + attr, value);
          node.removeAttribute(attr);
        }
      })(media[m]);
    }

    if (!jobs.length && !doc.querySelector("[" + HELD + "src], [" + HELD + "srcset]")) {
      return Promise.resolve(html);
    }
    return Promise.all(jobs).then(function () {
      return "<!doctype html>\\n" + doc.documentElement.outerHTML;
    });
  }

  /*
   * Everything else, swapped in after the page is up.
   *
   * Media re-fetches when its \`src\` changes, so a picture can arrive late
   * and the page is readable in the meantime -- which is why this stayed a
   * second pass rather than joining the first and making every page wait for
   * its images.
   */
  function swapAssets(doc, key, assets) {
    if (!assets || !assets.length) return;
    var wanted = wantedSet(assets);

    var nodes = doc.querySelectorAll(
      "[src], [href], [poster], [srcset], [imagesrcset], [style]," +
        "[" + HELD + "src], [" + HELD + "poster]," +
        "[" + HELD + "srcset], [" + HELD + "imagesrcset]",
    );
    for (var n = 0; n < nodes.length; n++) {
      (function (node) {
        var plain = ["src", "poster", "href"];
        for (var p = 0; p < plain.length; p++) {
          (function (attr) {
            // What the first pass put aside, or what is still on the page:
            // an \`href\` is never stripped, and a reference the first pass
            // did not recognise is still where the author wrote it.
            var held = node.getAttribute(HELD + attr);
            var raw = held !== null ? held : node.getAttribute(attr);
            if (!raw) return;
            var path = sitePath(raw);
            if (!path || !wanted[path]) return;
            load(key, path, wanted).then(function (url) {
              // The original back if the file could not be had, so the page
              // shows a reference that failed rather than no reference at
              // all -- which is the difference between a broken picture and
              // a missing one, and the first is the honest answer.
              node.setAttribute(attr, url || raw);
              node.removeAttribute(HELD + attr);
            });
          })(plain[p]);
        }

        var lists = ["srcset", "imagesrcset"];
        for (var l = 0; l < lists.length; l++) {
          (function (attr) {
            var held = node.getAttribute(HELD + attr);
            var raw = held !== null ? held : node.getAttribute(attr);
            if (!raw) return;
            rewriteSrcset(raw, key, wanted, location.href).then(function (out) {
              node.setAttribute(attr, out || raw);
              node.removeAttribute(HELD + attr);
            });
          })(lists[l]);
        }

        if (node.hasAttribute("style")) {
          var style = node.getAttribute("style") || "";
          if (style.indexOf("url(") !== -1) {
            rewriteCss(style, key, wanted, location.href).then(function (out) {
              if (out && out !== style) node.setAttribute("style", out);
            });
          }
        }
      })(nodes[n]);
    }
  }

  function reveal(key, bits) {
    return decrypt(key, payload).then(function (bytes) {
      var document_ = JSON.parse(new TextDecoder().decode(bytes));
      try {
        sessionStorage.setItem(KEY_PREFIX + payload.salt, u2b(bits));
      } catch (e) {}

      return reviveCritical(document_.html, key, document_.assets).then(function (html) {
        /*
         * Written whole: the payload is a document, not a fragment, so this
         * is the same thing the browser would have done with the real page.
         *
         * Only once the parser has finished, though. \`document.open\` is
         * specified to do nothing while a parser is still active, and the
         * automatic unlock -- the one that runs when the key is already in
         * this tab -- starts during parsing. It failed silently: no error,
         * no page, just the form still sitting there. Typing the password
         * worked, because a submit always happens after the load.
         */
        var write = function () {
          document.open();
          document.write(html);
          document.close();
          swapAssets(document, key, document_.assets);
        };
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", write);
        } else {
          write();
        }
      });
    });
  }

  function attempt(password) {
    if (error) error.hidden = true;
    if (button) button.disabled = true;
    return deriveBits(password)
      .then(function (bits) {
        return importKey(bits).then(function (key) {
          return reveal(key, bits);
        });
      })
      .catch(function () {
        // A wrong password and a damaged file fail identically here, because
        // AES-GCM authenticates and there is no way to tell them apart.
        try {
          sessionStorage.removeItem(KEY_PREFIX + payload.salt);
        } catch (e) {}
        if (error) error.hidden = false;
        if (button) button.disabled = false;
        if (field) {
          field.value = "";
          field.focus();
        }
      });
  }

  if (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (field && field.value) attempt(field.value);
    });
  }

  // Already unlocked in this tab, so no form: the reader clicked a link and
  // should simply arrive at the page.
  var held = null;
  try {
    held = sessionStorage.getItem(KEY_PREFIX + payload.salt);
  } catch (e) {}
  if (held) {
    var bits = b2u(held);
    importKey(bits)
      .then(function (key) {
        return reveal(key, bits);
      })
      .catch(function () {
        try {
          sessionStorage.removeItem(KEY_PREFIX + payload.salt);
        } catch (e) {}
        if (field) field.focus();
      });
  } else if (field) {
    field.focus();
  }
})();
`;
