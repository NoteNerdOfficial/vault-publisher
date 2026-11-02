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
   * The attachments, swapped in after the page is up.
   *
   * An encrypted image cannot be fetched by the browser as an image, so the
   * page's own markup points at files that are not there any more. The
   * payload lists what was encrypted -- inside the ciphertext, so the list
   * is not public either -- and each one is fetched, decrypted and handed
   * to the document as a blob URL.
   *
   * Done after the write and not before it, so the page is readable while
   * its pictures are still arriving rather than after.
   */
  function swapAssets(doc, key, assets, root) {
    if (!assets || !assets.length) return;
    var wanted = {};
    for (var i = 0; i < assets.length; i++) wanted[assets[i]] = true;

    var nodes = doc.querySelectorAll("[src], [href]");
    for (var n = 0; n < nodes.length; n++) {
      (function (node) {
        var attr = node.hasAttribute("src") ? "src" : "href";
        var raw = node.getAttribute(attr) || "";
        // Only this site's own files, and only the ones that were locked.
        var path = raw.replace(/^(\\.\\.\\/)+/, "").split("?")[0].split("#")[0];
        if (!wanted[path]) return;
        fetch(root + path + ".enc")
          .then(function (response) {
            return response.ok ? response.json() : null;
          })
          .then(function (blob) {
            return blob ? decrypt(key, blob) : null;
          })
          .then(function (bytes) {
            if (!bytes) return;
            var url = URL.createObjectURL(new Blob([bytes]));
            node.setAttribute(attr, url);
          })
          .catch(function () {});
      })(nodes[n]);
    }
  }

  function reveal(key, bits) {
    return decrypt(key, payload).then(function (bytes) {
      var document_ = JSON.parse(new TextDecoder().decode(bytes));
      try {
        sessionStorage.setItem(KEY_PREFIX + payload.salt, u2b(bits));
      } catch (e) {}

      var root = payload.root || "";
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
        document.write(document_.html);
        document.close();
        swapAssets(document, key, document_.assets, root);
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", write);
      } else {
        write();
      }
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
