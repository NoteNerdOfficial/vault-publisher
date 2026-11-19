/**
 * The pieces the unlock reader and the service worker both run.
 *
 * Kept as text fragments spliced into both scripts rather than written
 * twice, because the two must agree byte for byte on how a file is
 * decrypted and what type it is served as: a worker that typed a module
 * differently from the reader would fail only on the sites that use it.
 */
export const CRYPTO_HELPERS = `  function b2u(value) {
    var binary = atob(value);
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
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
  }`;

export const MIME_HELPERS = `  /*
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
  }`;
