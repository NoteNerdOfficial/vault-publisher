import { OVERLAY_CSS } from "./overlayCss";

/**
 * The review overlay, as it runs in the browser.
 *
 * Inlined per page like `CLIENT_SCRIPT`, and present only in a preview build.
 * Inlining a few tens of kilobytes into every page of a public site would be
 * wrong; into every page of a preview on local disk it costs nothing and
 * saves an asset, a fetch and a second esbuild entry point.
 *
 * The shape of it: a notch at the bottom centre of the page holding four
 * buttons -- a menu, and three modes that a sliding pill moves between.
 * **View** leaves the page alone so it can be read and clicked. **Comment**
 * lays a capture sheet over it, so a click drops a pin instead of following a
 * link. **Review** opens a panel down the right-hand side listing every
 * comment on the page. A pin opens a popup holding the comment and its
 * replies.
 *
 * A comment can also be filed as an issue in a tracker, from the popup's own
 * menu, when the plugin says one is set up. The page holds no credential and
 * talks to nothing but the plugin: it asks, and writes down the issue key
 * that comes back, which is what makes the key replace the action rather
 * than sit beside it.
 *
 * Several things here are not obvious and are the reason it looks the way it
 * does.
 *
 * **Everything visible lives in a shadow root.** The page carries harvested
 * Obsidian CSS, so an overlay in the light DOM would be restyled by it, and
 * worse, would restyle the page being reviewed. The preview has to stay a
 * faithful picture of what a publish would produce, so the article markup is
 * not touched: the overlay is appended after it and draws over the top.
 *
 * **Keystrokes stop at the shadow boundary.** Events retarget as they cross
 * it, so `document.activeElement` is the *host element* while a reviewer
 * types in a comment field, not the field. The site's own global handler
 * checks `activeElement.tagName` to decide whether a bare "/" is a shortcut
 * or a character, and would have seen a DIV and stolen the slash
 * mid-sentence -- and this script's own V / C / R shortcuts would fire on
 * every one of those letters typed. So every field stops propagation itself
 * rather than relying on anything outside being careful.
 *
 * **Pins are positioned against the host, not the viewport.** The host sits
 * at the document origin, so the difference between a point's client
 * coordinates and the host's rect is that point's position in document space
 * -- which is scroll-invariant, so pins travel with the text and need no
 * scroll handler. Measuring that difference rather than assuming the host is
 * at (0, 0) is what makes it survive a positioned or transformed `<body>`.
 *
 * **A pin lands where it was dropped, and stays there.** The drop point is
 * recorded as a fraction across and down the block underneath it, so the pin
 * is redrawn at that same fraction of the block's box every time. On the
 * build it was dropped on that is the same pixel; after a rebuild, a reflow
 * or at another window width it is the same few words, which is the thing
 * the reviewer was actually pointing at. A pin dropped where no block covers
 * the point keeps plain document coordinates instead.
 *
 * **Hit-testing turns the overlay off first.** Comment mode's capture sheet
 * is over the whole viewport, so asking what was clicked would always answer
 * "the sheet". `blockAt` drops `pointer-events` on the host for the length of
 * one `elementFromPoint` call, which takes the entire overlay -- sheet, pins,
 * notch and all -- out of hit-testing at once.
 *
 * **The block under the cursor is outlined before it is picked.** A pin lands
 * on a point but attaches to a block, and the two are not the same thing: the
 * reviewer has to be able to see which block they are about to mark. The
 * outline is drawn inside the shadow root rather than by setting a style on
 * the page's own element, which an earlier version did -- the preview has to
 * stay a faithful picture of a publish, and that includes not writing to the
 * article's inline styles while someone is reading it. Once a point is picked
 * the outline stays on that block, and the draft repeats its text, so a
 * comment is written with what it is about in view.
 *
 * DOM is built with `textContent`, never by assembling HTML strings. Not
 * because a reviewer's own words are a threat -- they are typing into their
 * own browser -- but because it makes an escaping mistake impossible rather
 * than merely unlikely.
 */
export const OVERLAY_SCRIPT = `(function () {
  var holder = document.querySelector('meta[name="osp-review"]');
  if (!holder) return;

  var config;
  try {
    config = JSON.parse(holder.getAttribute("content") || "{}");
  } catch (e) {
    return;
  }
  if (!config || !config.sourcePath) return;

  var SOURCE_PATH = config.sourcePath;
  var PAGE = config.page || "";
  var SITE = config.site || "";
  /*
   * The tracker a comment can be filed in, by name, or empty for none.
   *
   * A name rather than a flag because the only thing done with it is a menu
   * label. The page is told nothing else about it -- not the repository, not
   * the token, not the endpoint -- since the plugin is what talks to it.
   */
  var TRACKER = config.tracker || "";
  var STORE_KEY = "osp-overlay-comments";
  var NAME_KEY = "osp-overlay-user";
  var PREFS_KEY = "osp-overlay-prefs";
  var BLOCK_ATTR = "data-osp-block";
  var TEXT_LIMIT = 80;
  var SCHEMA = 4;

  /*
   * The mark: a tag with three rounded corners and one sharp one, and the
   * sharp corner is the point being marked. It sits at (5, 27) in a 32 unit
   * box, which is where the offset in the stylesheet comes from.
   *
   * A tag rather than a disc or a droplet. Round marks read as people --
   * avatars, map pins, the badge on an app icon -- and a comment here is
   * not a person standing somewhere, it is a label attached to a particular
   * phrase. The square shoulders say label, and the one corner left sharp
   * says which words.
   *
   * One path, not a body plus a pointer, because the mark is ringed in the
   * overlay's ground to hold it off the reviewer's own content and two
   * ringed shapes would draw that ring down the seam between them.
   */
  var MARK = "M13 3 L21 3 A8 8 0 0 1 29 11 L29 19 A8 8 0 0 1 21 27 L5 27 L5 11 A8 8 0 0 1 13 3 Z";

  /*
   * The three priorities, highest first, which is the order the panel sorts
   * in. Each carries a mark as well as a word: a pill that said what it meant
   * only by being a different colour would say nothing at all to a reader who
   * cannot tell the two colours apart.
   */
  var PRI = {
    high: { label: "High", mark: "\\u2191" },
    normal: { label: "Normal", mark: "\\u2013" },
    low: { label: "Low", mark: "\\u2193" },
  };
  var PRI_ORDER = ["high", "normal", "low"];

  function priOf(value) {
    return value === "high" || value === "low" ? value : "normal";
  }

  function priRank(value) {
    var at = PRI_ORDER.indexOf(priOf(value));
    return at === -1 ? 1 : at;
  }

  /* Lucide's message-circle, for the comment-mode button and empty states. */
  var BUBBLE =
    "M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719";

  /* --- storage ------------------------------------------------------ */

  /*
   * Fills in what an older file does not carry.
   *
   * Comments written before the drop point existed anchor to a block and
   * nothing finer, so they come back at the block's top-left corner rather
   * than nowhere. Everything else defaults to the empty case.
   */
  function tidy(row) {
    if (!row || typeof row !== "object") return null;
    if (!row.id || typeof row.text !== "string") return null;
    row.replies = Array.isArray(row.replies) ? row.replies : [];
    row.x = typeof row.x === "number" ? row.x : 0;
    row.y = typeof row.y === "number" ? row.y : 0;
    row.rx = typeof row.rx === "number" ? row.rx : null;
    row.ry = typeof row.ry === "number" ? row.ry : null;
    row.block = typeof row.block === "string" ? row.block : null;
    row.blockText = typeof row.blockText === "string" ? row.blockText : "";
    row.resolved = row.resolved === true;
    row.priority = priOf(row.priority);
    // A comment an agent wrote into the review file by hand. Nothing in here
    // ever sets it; reading it is the whole of the support for it.
    row.agent = typeof row.agent === "string" && row.agent ? row.agent : null;
    row.external = extOf(row.external);
    return row;
  }

  /*
   * The issue a comment was filed as, checked rather than trusted.
   *
   * This arrives from a file in the vault, which a tool or a person may have
   * written by hand, and it ends up as a link somebody clicks. So a record
   * missing its key or its address is treated as no record at all, and the
   * address has to be http -- a stored "javascript:" would otherwise be a
   * script the overlay invites the reviewer to run on their own page.
   */
  function extOf(value) {
    if (!value || typeof value !== "object") return null;
    if (typeof value.key !== "string" || !value.key) return null;
    if (typeof value.url !== "string") return null;
    if (value.url.indexOf("https://") !== 0 && value.url.indexOf("http://") !== 0) {
      return null;
    }
    return {
      provider: typeof value.provider === "string" ? value.provider : "github",
      key: value.key,
      url: value.url,
      filedAt: typeof value.filedAt === "string" ? value.filedAt : "",
    };
  }

  /* "owner/repo#41" to "#41": the part that is short enough for a pill. */
  function issueMark(key) {
    var hash = key.indexOf("#");
    return hash === -1 ? key : key.slice(hash);
  }

  function readAll() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      var out = [];
      for (var i = 0; i < parsed.length; i++) {
        var row = tidy(parsed[i]);
        if (row) out.push(row);
      }
      return out;
    } catch (e) {
      // Corrupt, or storage refused. Starting empty beats refusing to run;
      // the reviewer loses notes they could not have read back anyway.
      return [];
    }
  }

  function writeAll() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(all));
    } catch (e) {}
    // localStorage first and unconditionally: it is the copy that survives
    // the plugin not running, and it must not depend on a request.
    sync();
  }

  function readName() {
    try {
      return localStorage.getItem(NAME_KEY) || config.reviewer || "";
    } catch (e) {
      return config.reviewer || "";
    }
  }

  function writeName(value) {
    try {
      localStorage.setItem(NAME_KEY, value);
    } catch (e) {}
  }

  function readPrefs() {
    try {
      var parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writePrefs() {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          theme: themeChoice,
          side: side,
          width: width,
          sort: sortBy,
        })
      );
    } catch (e) {}
  }

  var all = readAll();
  var author = readName();
  var prefs = readPrefs();
  /*
   * Light or dark, and nothing else.
   *
   * There is no "follow the page" setting, but the first run should still
   * land somewhere sensible, so the page's own theme seeds the choice once
   * and the reviewer's pick takes over from there. Seeding is not following:
   * once a value is stored, the page switching themes leaves the overlay
   * where the reviewer put it.
   */
  var themeChoice = prefs.theme === "light" || prefs.theme === "dark" ? prefs.theme : pageTheme();

  function pageTheme() {
    var theme = document.documentElement.getAttribute("data-theme");
    if (theme === "light" || theme === "dark") return theme;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  var side = prefs.side === "left" ? "left" : "right";
  var width = typeof prefs.width === "number" ? prefs.width : 280;
  var sortBy = prefs.sort === "priority" ? "priority" : "time";

  /* --- the vault, when it is reachable ------------------------------ */

  /*
   * The page is served by the plugin, so the comments can live in the vault
   * instead of only in this browser. When it is opened as a bare file
   * instead -- straight out of the preview folder, with no plugin running --
   * every call here fails and the overlay carries on against localStorage
   * alone. That is a degraded mode, not a broken one, so none of it reports
   * an error to the reader.
   */
  var API = "/api/comments";
  var served = location.protocol === "http:" || location.protocol === "https:";
  var syncing = false;
  var syncAgain = false;

  function payload() {
    return JSON.stringify({
      version: SCHEMA,
      site: SITE,
      exportedAt: new Date().toISOString(),
      comments: all,
    });
  }

  /*
   * Pushes the whole set to the vault, one request at a time.
   *
   * Serialized rather than fired per change: resolving three comments quickly
   * would otherwise race three writes of the same file against each other,
   * and the last to land would not reliably be the newest.
   */
  function sync() {
    if (!served) return;
    if (syncing) {
      syncAgain = true;
      return;
    }
    syncing = true;
    fetch(API, {
      method: "POST",
      // text/plain keeps this a simple request. application/json would earn
      // a preflight, and a preflight is a second thing that can fail.
      headers: { "Content-Type": "text/plain" },
      body: payload(),
    })
      .catch(function () {})
      .then(function () {
        syncing = false;
        if (syncAgain) {
          syncAgain = false;
          sync();
        }
      });
  }

  /*
   * Merges what the vault holds into what this browser holds.
   *
   * A comment this browser already knows about wins: the person sitting here
   * is the one who just acted on it, and their resolve should not be undone
   * by a copy saved before they did. Anything the vault has and this browser
   * does not is new here -- another browser, another machine, or this one
   * before its storage was cleared -- and is taken as is.
   */
  function adopt(incoming) {
    if (!incoming || !incoming.length) return false;
    var known = Object.create(null);
    for (var i = 0; i < all.length; i++) known[all[i].id] = true;

    var added = false;
    for (var j = 0; j < incoming.length; j++) {
      var row = tidy(incoming[j]);
      if (!row) continue;
      if (known[row.id]) {
        // One field the vault is authoritative for. Only the plugin ever
        // sets it, so a local copy without it is out of date rather than
        // disagreeing, and taking it cannot undo anything done here.
        var held = byId(row.id);
        if (held && !held.external && row.external) {
          held.external = row.external;
          added = true;
        }
        continue;
      }
      all.push(row);
      known[row.id] = true;
      added = true;
    }
    return added;
  }

  function pull() {
    if (!served) return;
    fetch(API, { headers: { Accept: "application/json" } })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data) {
        if (!data || !data.comments) return;
        var changed = adopt(data.comments);
        if (changed) {
          writeAll();
          render();
        }
        // Pushed back whether or not anything arrived, so comments made
        // against a bare file earlier reach the vault the first time the
        // page is opened through the plugin.
        if (all.length) sync();
      })
      .catch(function () {});
  }

  /* --- filing a comment in a tracker ------------------------------- */

  /*
   * Asks the plugin to file this comment, and writes down what comes back.
   *
   * The key is saved here as well as by the plugin, deliberately. This
   * browser saves the whole document every time anything changes, and a save
   * made after the issue existed but before the page knew about it would put
   * the comment back without its key -- which would mean the next Send filed
   * a second issue for the same comment.
   */
  var RELAY_API = "/api/relay";
  var relaying = null;
  var relayError = null;

  function relay(comment) {
    if (!served || !TRACKER || comment.external || relaying) return;
    relaying = comment.id;
    relayError = null;
    renderPopup();

    fetch(RELAY_API, {
      method: "POST",
      // text/plain for the same reason as the save: a simple request, with no
      // preflight to fail separately.
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ id: comment.id }),
    })
      .then(function (response) {
        // Read whatever the status, since a refusal carries its reason in the
        // body and the reason is the whole of what the reviewer needs.
        return response.json();
      })
      .catch(function () {
        return null;
      })
      .then(function (data) {
        relaying = null;
        var ext = data && data.ok ? extOf(data.external) : null;
        if (ext) {
          comment.external = ext;
          writeAll();
          render();
          return;
        }
        relayError = {
          id: comment.id,
          message: (data && data.error) || "Could not reach the plugin.",
        };
        renderPopup();
      });
  }

  function mine() {
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i] && all[i].sourcePath === SOURCE_PATH) out.push(all[i]);
    }
    out.sort(function (a, b) {
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });
    return out;
  }

  function byId(id) {
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  /* --- helpers ------------------------------------------------------ */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function squash(value) {
    return String(value == null ? "" : value).replace(/\\s+/g, " ").trim();
  }

  function clip(value) {
    var text = squash(value);
    return text.length > TEXT_LIMIT ? text.slice(0, TEXT_LIMIT - 1) + "\\u2026" : text;
  }

  function uid() {
    return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function initial(name) {
    var text = squash(name);
    return text ? text.charAt(0).toUpperCase() : "?";
  }

  function when(iso) {
    var then = new Date(iso).getTime();
    if (!then) return "";
    var mins = Math.floor((Date.now() - then) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + "h ago";
    var days = Math.floor(hours / 24);
    if (days < 7) return days + "d ago";
    return new Date(then).toLocaleDateString();
  }

  function count(n, noun) {
    return n + " " + noun + (n === 1 ? "" : "s");
  }

  /* --- icons -------------------------------------------------------- */

  var NS = "http://www.w3.org/2000/svg";

  function icon(spec, size) {
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", String(size || 16));
    svg.setAttribute("height", String(size || 16));
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    for (var i = 0; i < spec.length; i++) {
      var node = document.createElementNS(NS, spec[i][0]);
      var attrs = spec[i][1];
      for (var key in attrs) node.setAttribute(key, attrs[key]);
      svg.appendChild(node);
    }
    return svg;
  }

  var ICONS = {
    /* Lucide's settings: the gear, for the row of settings behind it. */
    gear: [
      [
        "path",
        {
          d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
        },
      ],
      ["circle", { cx: "12", cy: "12", r: "3" }],
    ],
    sort: [
      ["path", { d: "m3 16 4 4 4-4" }],
      ["path", { d: "M7 20V4" }],
      ["path", { d: "m21 8-4-4-4 4" }],
      ["path", { d: "M17 4v16" }],
    ],
    cursor: [
      [
        "path",
        {
          d: "M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z",
        },
      ],
    ],
    bubble: [
      ["path", { d: BUBBLE }],
      ["path", { d: "M8 12h.01" }],
      ["path", { d: "M12 12h.01" }],
      ["path", { d: "M16 12h.01" }],
    ],
    panel: [["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }], ["path", { d: "M15 3v18" }]],
    toLeft: [
      ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
      ["path", { d: "M9 3v18" }],
      ["path", { d: "m14 9-3 3 3 3" }],
    ],
    toRight: [
      ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
      ["path", { d: "M15 3v18" }],
      ["path", { d: "m10 15 3-3-3-3" }],
    ],
    close: [["path", { d: "M18 6 6 18" }], ["path", { d: "m6 6 12 12" }]],
    more: [
      ["circle", { cx: "12", cy: "12", r: "1" }],
      ["circle", { cx: "19", cy: "12", r: "1" }],
      ["circle", { cx: "5", cy: "12", r: "1" }],
    ],
    resolve: [["path", { d: BUBBLE }], ["path", { d: "m9 12 2 2 4-4" }]],
    send: [["path", { d: "m5 12 7-7 7 7" }], ["path", { d: "M12 19V5" }]],
    user: [
      ["path", { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" }],
      ["circle", { cx: "12", cy: "7", r: "4" }],
    ],
    trash: [
      ["path", { d: "M3 6h18" }],
      ["path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" }],
      ["path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" }],
    ],
    light: [
      ["circle", { cx: "12", cy: "12", r: "4" }],
      ["path", { d: "M12 2v2" }],
      ["path", { d: "M12 20v2" }],
      ["path", { d: "m4.93 4.93 1.41 1.41" }],
      ["path", { d: "m17.66 17.66 1.41 1.41" }],
      ["path", { d: "M2 12h2" }],
      ["path", { d: "M20 12h2" }],
      ["path", { d: "m6.34 17.66-1.41 1.41" }],
      ["path", { d: "m19.07 4.93-1.41 1.41" }],
    ],
    dark: [["path", { d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9" }]],
    hide: [
      [
        "path",
        {
          d: "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
        },
      ],
      ["path", { d: "M14.084 14.158a3 3 0 0 1-4.242-4.242" }],
      [
        "path",
        {
          d: "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
        },
      ],
      ["path", { d: "m2 2 20 20" }],
    ],
  };

  /*
   * The mark, filled in its ink and ringed in the overlay's own ground.
   *
   * A paint-order of "stroke" is what makes the ring sit outside the shape:
   * SVG paints fill then stroke by default, so a 5 unit stroke would eat
   * 2.5 units into the ink and leave a thin sliver of it. Painted first,
   * the fill covers the inner half and the visible ring is the outer 2.5.
   */
  function markSvg(ink) {
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 32 32");
    svg.setAttribute("fill", "none");
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", MARK);
    path.setAttribute("fill", ink);
    // The ring colour comes from the stylesheet, not from here: a custom
    // property in a presentation attribute is not reliably resolved.
    path.setAttribute("stroke-width", "5");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("paint-order", "stroke");
    svg.appendChild(path);
    return svg;
  }

  /* --- the shadow root --------------------------------------------- */

  var host = document.createElement("div");
  host.id = "osp-overlay-host";
  host.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;z-index:2147483000;";
  var shadow = host.attachShadow({ mode: "open" });

  var sheet = document.createElement("style");
  sheet.textContent = OSP_OVERLAY_CSS;
  shadow.appendChild(sheet);

  var wrap = el("div", "osp-overlay");
  shadow.appendChild(wrap);

  // Order matters: the capture sheet is first so everything after it paints
  // over the top and stays clickable in comment mode.
  var capture = el("div", "co-capture");
  capture.hidden = true;
  wrap.appendChild(capture);

  /*
   * The outline over the block the cursor is on, which becomes the outline
   * over the block a comment is being written about. Before the pins, so a
   * pin standing on a block is never behind its own highlight.
   */
  var aim = el("div", "co-aim");
  aim.hidden = true;
  wrap.appendChild(aim);

  var pins = el("div", "co-pins");
  wrap.appendChild(pins);

  /* --- the field shared by the draft, replies and edits -------------- */

  /*
   * One field, three jobs. A reviewer who has learned that Enter sends and
   * Escape backs out has learned it everywhere, which is the only reason
   * these are not three slightly different boxes.
   */
  function field(placeholder, onSend, onCancel) {
    var box = el("div", "co-input");
    var input = document.createElement("textarea");
    input.setAttribute("placeholder", placeholder);
    input.setAttribute("rows", "1");
    var send = el("button", "co-send");
    send.setAttribute("title", "Send");
    send.appendChild(icon(ICONS.send, 12));
    send.disabled = true;
    box.appendChild(input);
    box.appendChild(send);

    function refresh() {
      var text = input.value.trim();
      send.disabled = !text;
      input.style.height = "auto";
      input.style.height = (input.scrollHeight || 20) + "px";
      if (text) box.setAttribute("data-filled", "");
      else box.removeAttribute("data-filled");
    }

    function fire() {
      var text = input.value.trim();
      if (!text) return;
      onSend(text);
    }

    input.addEventListener("input", refresh);
    // The reason this is here and not on document: see the note at the top
    // about retargeting. Without it the site's "/" shortcut fires on every
    // slash a reviewer types, and this script's own V / C / R shortcuts fire
    // on every one of those letters.
    input.addEventListener("keydown", function (event) {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        if (onCancel) onCancel();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        fire();
      }
    });
    send.addEventListener("click", fire);

    return { box: box, input: input, refresh: refresh };
  }

  /* --- the draft ---------------------------------------------------- */

  var draft = el("div", "co-draft");
  draft.hidden = true;
  var draftPoint = null;

  /*
   * What is about to be commented on, repeated in the draft.
   *
   * The outline says where on the page it is; this says what it says. The
   * two are not redundant: the draft opens beside the point and can easily
   * cover the words it is about, and a reviewer who has to move a box to
   * remember what they were objecting to will stop reading it.
   */
  var draftQuote = el("div", "co-draft-quote");
  draft.appendChild(draftQuote);

  var draftField = field(
    "Add a comment...",
    function (text) {
      commit(text);
    },
    function () {
      closeDraft();
    }
  );
  draft.appendChild(draftField.box);

  /*
   * Priority, set while the comment is being written rather than after it is
   * filed. A reviewer knows whether something blocks the page at the moment
   * they notice it, and asking later is asking them to look at it twice.
   */
  var draftPri = "normal";
  var draftFoot = el("div", "co-draft-foot");
  var priBtns = [];
  for (var q = 0; q < PRI_ORDER.length; q++) {
    var priBtn = el("button", "co-pri-opt");
    priBtn.setAttribute("data-level", PRI_ORDER[q]);
    priBtn.setAttribute("title", PRI[PRI_ORDER[q]].label + " priority");
    priBtn.appendChild(el("span", "co-pri-mark", PRI[PRI_ORDER[q]].mark));
    priBtn.appendChild(el("span", null, PRI[PRI_ORDER[q]].label));
    draftFoot.appendChild(priBtn);
    priBtns.push(priBtn);
  }
  draft.appendChild(draftFoot);

  for (var qq = 0; qq < priBtns.length; qq++) {
    (function (level) {
      priBtns[qq].addEventListener("click", function () {
        draftPri = level;
        paintDraftPri();
        draftField.input.focus();
      });
    })(PRI_ORDER[qq]);
  }

  function paintDraftPri() {
    for (var i = 0; i < priBtns.length; i++) {
      if (PRI_ORDER[i] === draftPri) priBtns[i].setAttribute("data-on", "");
      else priBtns[i].removeAttribute("data-on");
    }
  }

  wrap.appendChild(draft);

  /* --- the popup ---------------------------------------------------- */

  var popup = el("div", "co-pop");
  popup.hidden = true;
  wrap.appendChild(popup);

  /* --- the side panel ----------------------------------------------- */

  var panel = el("div", "co-panel");
  panel.hidden = true;
  panel.setAttribute("data-side", side);
  panel.style.width = width + "px";
  wrap.appendChild(panel);

  var resizer = el("div", "co-resizer");
  panel.appendChild(resizer);

  var panelHead = el("div", "co-panel-head");
  var sideBtn = el("button", "co-icon-btn");
  var panelTitle = el("span", "co-panel-title", "Review comments");
  var panelClose = el("button", "co-icon-btn");
  panelClose.setAttribute("title", "Exit review mode");
  panelClose.appendChild(icon(ICONS.close));
  panelHead.appendChild(sideBtn);
  panelHead.appendChild(panelTitle);
  panelHead.appendChild(panelClose);
  panel.appendChild(panelHead);

  var filters = el("div", "co-filters");
  var filterSlider = el("div", "co-filter-slider");
  filters.appendChild(filterSlider);
  var FILTERS = ["all", "open", "resolved"];
  var filterBtns = [];
  var filterCounts = [];
  for (var f = 0; f < FILTERS.length; f++) {
    var btn = el("button", "co-filter");
    btn.setAttribute("data-filter", FILTERS[f]);
    btn.appendChild(
      document.createTextNode(FILTERS[f].charAt(0).toUpperCase() + FILTERS[f].slice(1) + " ")
    );
    // The count rides in the label so the size of each scope is known
    // before it is chosen, rather than discovered by choosing it.
    var tally = el("b");
    btn.appendChild(tally);
    filters.appendChild(btn);
    filterBtns.push(btn);
    filterCounts.push(tally);
  }
  panel.appendChild(filters);

  /*
   * Two orders, one button.
   *
   * Mark order is the default because it is the order the numbers on the page
   * are in, so the list and the pins can be read against each other. Priority
   * order is for working through: it answers "what is worth doing first",
   * which the pins cannot say at all.
   */
  var sortRow = el("div", "co-sortrow");
  var sortBtn = el("button", "co-sort");
  sortRow.appendChild(sortBtn);
  panel.appendChild(sortRow);

  var list = el("div", "co-list");
  panel.appendChild(list);

  /* --- the notch ---------------------------------------------------- */

  var notch = el("div", "co-notch");

  var menuBtn = el("button", "co-notch-btn");
  menuBtn.setAttribute("title", "Settings");
  menuBtn.appendChild(icon(ICONS.gear));
  notch.appendChild(menuBtn);

  notch.appendChild(el("div", "co-notch-div"));

  var modes = el("div", "co-modes");
  var modeSlider = el("div", "co-mode-slider");
  modes.appendChild(modeSlider);

  var MODES = [
    ["view", ICONS.cursor, "View mode \\u2014 read and click the page (V)"],
    ["comment", ICONS.bubble, "Comment mode \\u2014 click to drop a pin (C)"],
    ["review", ICONS.panel, "Review mode \\u2014 step through and resolve (R)"],
  ];
  var modeBtns = [];
  for (var m = 0; m < MODES.length; m++) {
    var modeBtn = el("button", "co-mode");
    modeBtn.setAttribute("data-mode", MODES[m][0]);
    modeBtn.setAttribute("title", MODES[m][2]);
    modeBtn.setAttribute("aria-label", MODES[m][2]);
    modeBtn.appendChild(icon(MODES[m][1]));
    modes.appendChild(modeBtn);
    modeBtns.push(modeBtn);
  }
  notch.appendChild(modes);
  wrap.appendChild(notch);

  var menu = null;

  /* --- the modal ---------------------------------------------------- */

  var scrim = el("div", "co-scrim");
  scrim.hidden = true;
  var modal = el("div", "co-modal");
  scrim.appendChild(modal);
  wrap.appendChild(scrim);

  document.body.appendChild(host);

  /* --- theme -------------------------------------------------------- */

  function paintTheme() {
    wrap.setAttribute("data-theme", themeChoice);
  }
  paintTheme();

  /* --- blocks ------------------------------------------------------- */

  function blockIndex() {
    var map = Object.create(null);
    var nodes = document.querySelectorAll("[" + BLOCK_ATTR + "]");
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute(BLOCK_ATTR);
      if (key && !map[key]) map[key] = nodes[i];
    }
    return map;
  }

  function nearestBlock(node) {
    var current = node;
    while (current && current !== document.body) {
      if (current.nodeType === 1 && current.hasAttribute(BLOCK_ATTR)) return current;
      current = current.parentNode;
    }
    return null;
  }

  /*
   * What is under a point, with the overlay taken out of the way.
   *
   * Comment mode's capture sheet covers the viewport and the pins sit over
   * the top of it, so without this the answer is always a piece of the
   * overlay and every pin anchors to nothing.
   *
   * It hides the host with display:none rather than dropping pointer events
   * on it. Pointer events inherit, so turning them off on the host looks
   * like it should take the whole shadow tree out of hit-testing -- and it
   * does not, because the sheet and the pins each set pointer-events to auto
   * for their own sake, and that beats the inherited value. Taking the host
   * out of rendering altogether has nothing to override it. It costs no
   * reflow worth measuring: the host is a 0x0 absolutely positioned box, so
   * the document around it does not move, and nothing is painted between
   * the two lines.
   */
  function blockAt(clientX, clientY) {
    var saved = host.style.display;
    host.style.display = "none";
    var node = document.elementFromPoint(clientX, clientY);
    host.style.display = saved;
    return nearestBlock(node);
  }

  /* --- the block under the cursor ----------------------------------- */

  /*
   * The outline follows the cursor, and measuring what is under it on every
   * mouse move would mean a hit test -- and the host hidden and
   * shown around it -- per pixel. So the block's own box is kept, and a move
   * that stays inside it answers itself without asking the document
   * anything. Only crossing out of the current block costs a hit test, which
   * is roughly once per paragraph rather than once per pixel.
   */
  var aimTarget = null;
  var aimBox = null;

  function setAim(target) {
    aimTarget = target;
    if (!target) {
      aimBox = null;
      aim.hidden = true;
      return;
    }
    var base = host.getBoundingClientRect();
    var box = target.getBoundingClientRect();
    // The measured box is kept exactly, since it is what the next mouse move
    // is tested against. What is drawn is 3px wider all round: an outline
    // hugging the glyphs reads as an error state rather than as a target.
    aimBox = box;
    aim.style.left = box.left - base.left - 3 + "px";
    aim.style.top = box.top - base.top - 3 + "px";
    aim.style.width = box.width + 6 + "px";
    aim.style.height = box.height + 6 + "px";
    aim.hidden = false;
  }

  function aimAt(clientX, clientY) {
    if (
      aimBox &&
      clientX >= aimBox.left &&
      clientX <= aimBox.right &&
      clientY >= aimBox.top &&
      clientY <= aimBox.bottom
    ) {
      return;
    }
    setAim(blockAt(clientX, clientY));
  }

  /* --- state -------------------------------------------------------- */

  var mode = "view";
  var hidden = false;
  var filter = "all";
  var selected = null;
  var blocks = blockIndex();

  /* --- where a pin goes --------------------------------------------- */

  /*
   * A comment's point in document space, or null when it has none to show.
   *
   * Anchored comments are measured off their block every time rather than
   * stored in pixels, which is what lets the pin follow the words when the
   * page is rebuilt or the window is a different width.
   */
  function spot(comment) {
    var base = host.getBoundingClientRect();
    var target = comment.block ? blocks[comment.block] : null;

    if (target) {
      var box = target.getBoundingClientRect();
      var rx = typeof comment.rx === "number" ? comment.rx : 0;
      var ry = typeof comment.ry === "number" ? comment.ry : 0;
      return {
        left: box.left - base.left + rx * box.width,
        top: box.top - base.top + ry * box.height,
      };
    }

    // An anchor that was there and is not any more: the block was rewritten,
    // so there is no honest place to draw this. It is reported in the panel
    // instead, with the text it was about.
    if (comment.block) return null;
    return { left: comment.x, top: comment.y };
  }

  function orphaned(comment) {
    return !!comment.block && !blocks[comment.block];
  }

  /*
   * A comment's number on this page, counting from one in the order the
   * comments were made. The pin, the panel row and the popup all read it
   * from here, so a mark is the same number wherever it is seen.
   */
  function markNumber(comment) {
    var rows = mine();
    for (var i = 0; i < rows.length; i++) if (rows[i].id === comment.id) return i + 1;
    return 0;
  }

  /* --- pins --------------------------------------------------------- */

  function renderPins() {
    clear(pins);
    var rows = mine();

    for (var i = 0; i < rows.length; i++) {
      var comment = rows[i];
      var at = spot(comment);
      if (!at) continue;

      var pin = el("button", "co-pin");
      pin.setAttribute("data-comment", comment.id);
      pin.setAttribute("title", squash(comment.text));
      if (comment.resolved) pin.setAttribute("data-resolved", "");
      if (comment.id === selected) pin.setAttribute("data-selected", "");
      // Correction ink while it is open, graphite once it is dealt with, so
      // what is left to do on a page is readable from the pins alone.
      pin.appendChild(markSvg(comment.resolved ? "#6b7076" : "#d4421e"));
      pin.appendChild(el("span", null, String(i + 1)));
      pin.style.left = at.left + "px";
      pin.style.top = at.top + "px";
      pin.addEventListener("click", openFromPin);
      pins.appendChild(pin);
    }
  }

  function openFromPin(event) {
    event.preventDefault();
    event.stopPropagation();
    openPopup(this.getAttribute("data-comment"));
  }

  /* --- the panel ---------------------------------------------------- */

  function passes(comment) {
    if (filter === "open") return !comment.resolved;
    if (filter === "resolved") return comment.resolved;
    return true;
  }

  /*
   * The panel's order. Only the panel's: a pin's number is its place in the
   * order the comments were made, and sorting the list must not renumber the
   * page underneath it.
   */
  function sorted(rows) {
    if (sortBy !== "priority") return rows;
    return rows.slice().sort(function (a, b) {
      var by = priRank(a.priority) - priRank(b.priority);
      if (by !== 0) return by;
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });
  }

  function renderPanel() {
    var all_ = mine();
    var open_ = 0;
    for (var t = 0; t < all_.length; t++) if (!all_[t].resolved) open_++;
    var tallies = [all_.length, open_, all_.length - open_];

    for (var i = 0; i < filterBtns.length; i++) {
      if (FILTERS[i] === filter) filterBtns[i].setAttribute("data-active", "");
      else filterBtns[i].removeAttribute("data-active");
      filterCounts[i].textContent = String(tallies[i]);
    }
    filterSlider.setAttribute("data-at", String(FILTERS.indexOf(filter)));

    clear(sortBtn);
    sortBtn.setAttribute("data-by", sortBy);
    sortBtn.setAttribute(
      "title",
      sortBy === "priority" ? "Sort by mark order" : "Sort by priority"
    );
    sortBtn.appendChild(icon(ICONS.sort, 12));
    sortBtn.appendChild(
      el("span", null, sortBy === "priority" ? "Priority" : "Mark order")
    );

    clear(sideBtn);
    sideBtn.setAttribute("title", side === "right" ? "Move to the left" : "Move to the right");
    sideBtn.appendChild(icon(side === "right" ? ICONS.toLeft : ICONS.toRight));

    clear(list);
    var rows = sorted(mine());
    var shown = 0;

    for (var j = 0; j < rows.length; j++) {
      if (!passes(rows[j])) continue;
      list.appendChild(panelRow(rows[j], markNumber(rows[j])));
      shown++;
    }

    if (!shown) {
      var empty = el("div", "co-empty");
      empty.appendChild(icon(ICONS.bubble, 26));
      if (!rows.length) {
        empty.appendChild(el("div", "co-empty-title", "Nothing marked yet"));
        empty.appendChild(
          el("div", "co-empty-text", "Press C, then click the words you want to say something about.")
        );
      } else if (filter === "open") {
        empty.appendChild(el("div", "co-empty-title", "All clear"));
        empty.appendChild(
          el("div", "co-empty-text", "Every mark on this page has been dealt with.")
        );
      } else {
        empty.appendChild(el("div", "co-empty-title", "Nothing resolved yet"));
        empty.appendChild(
          el("div", "co-empty-text", "Marks you resolve are kept here rather than deleted.")
        );
      }
      list.appendChild(empty);
    }
  }

  function panelRow(comment, number) {
    var row = el("div", "co-row");
    row.setAttribute("data-comment", comment.id);
    if (comment.resolved) row.setAttribute("data-resolved", "");
    if (comment.id === selected) row.setAttribute("data-selected", "");
    var lost = orphaned(comment);
    if (lost) row.setAttribute("data-orphan", "");

    var card = el("div", "co-row-card");
    card.appendChild(el("span", "co-num", String(number)));

    var body = el("div", "co-row-body");
    var name = el("div", "co-row-name");
    name.appendChild(el("strong", null, comment.author || "Anonymous"));
    /*
     * No priority pill in here: the panel can be put in priority order, and
     * a label repeating what the sort already says is a label the eye has to
     * read past on every row. What the panel cannot say any other way is who
     * wrote a comment without reading the page, so that is what the pill is
     * for.
     */
    if (comment.agent) {
      var tag = el("span", "co-tag", "Agent");
      tag.setAttribute("title", "Filed by " + comment.agent);
      name.appendChild(tag);
    }
    /*
     * The issue, if there is one. The other thing the sort cannot say: a
     * comment someone has already turned into work is a comment to read
     * differently, and the number is how it is referred to everywhere else.
     */
    if (comment.external) {
      var filed = el("a", "co-tag", issueMark(comment.external.key));
      filed.setAttribute("data-ext", "");
      filed.setAttribute("href", comment.external.url);
      filed.setAttribute("target", "_blank");
      filed.setAttribute("rel", "noreferrer noopener");
      filed.setAttribute("title", "Filed as " + comment.external.key);
      // The row opens the popup; the link opens the issue. Without this the
      // click would do both.
      filed.addEventListener("click", function (event) {
        event.stopPropagation();
      });
      name.appendChild(filed);
    }
    name.appendChild(el("span", "co-time", when(comment.createdAt)));
    body.appendChild(name);
    body.appendChild(el("div", "co-row-text", comment.text));

    var meta = [];
    if (comment.replies.length) {
      meta.push(comment.replies.length + (comment.replies.length === 1 ? " reply" : " replies"));
    }
    if (comment.resolved) meta.push("Resolved");
    if (meta.length) body.appendChild(el("div", "co-row-meta", meta.join(" \\u00b7 ")));

    if (lost) {
      body.appendChild(el("div", "co-warn", "Anchor lost: this block has been rewritten since."));
      if (comment.blockText) body.appendChild(el("div", "co-quote", comment.blockText));
    }

    card.appendChild(body);
    row.appendChild(card);
    row.addEventListener("click", function () {
      openPopup(comment.id);
      var pin = pins.querySelector('[data-comment="' + comment.id + '"]');
      if (pin && pin.scrollIntoView) pin.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return row;
  }

  /* --- the popup ---------------------------------------------------- */

  var editing = null;

  function openPopup(id) {
    var comment = byId(id);
    if (!comment) return;
    selected = id;
    editing = null;
    // A refusal belongs to one attempt. Opening a popup starts again.
    relayError = null;
    renderPopup();
    renderPins();
    renderPanel();
  }

  function closePopup() {
    selected = null;
    editing = null;
    popup.hidden = true;
    closePopMenu();
    renderPins();
    renderPanel();
  }

  function renderPopup() {
    var comment = selected ? byId(selected) : null;
    if (!comment) {
      popup.hidden = true;
      return;
    }

    clear(popup);
    popup.hidden = false;

    var head = el("div", "co-pop-head");
    var lost = orphaned(comment);

    head.appendChild(el("span", "co-pop-title", "Comment"));

    /*
     * The priority, said and set in the same place. A pill that showed a
     * value but needed a menu somewhere else to change it is two things to
     * learn where one would do, and this is the only popup the comment has.
     */
    var priBtn = el("button", "co-pri");
    priBtn.setAttribute("data-level", comment.priority);
    priBtn.setAttribute("title", "Priority: " + PRI[comment.priority].label);
    priBtn.appendChild(el("span", "co-pri-mark", PRI[comment.priority].mark));
    priBtn.appendChild(el("span", null, PRI[comment.priority].label));
    priBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      togglePriMenu(comment, priBtn);
    });
    head.appendChild(priBtn);

    var acts = el("div", "co-pop-acts");

    var moreBtn = el("button", "co-pop-btn");
    moreBtn.setAttribute("title", "More");
    moreBtn.appendChild(icon(ICONS.more));
    moreBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      togglePopMenu(comment, moreBtn);
    });

    var resolveBtn = el("button", "co-pop-btn");
    resolveBtn.setAttribute("title", comment.resolved ? "Reopen" : "Resolve");
    if (comment.resolved) resolveBtn.setAttribute("data-on", "");
    resolveBtn.appendChild(icon(ICONS.resolve));
    resolveBtn.addEventListener("click", function () {
      comment.resolved = !comment.resolved;
      writeAll();
      render();
    });

    var closeBtn = el("button", "co-pop-btn");
    closeBtn.setAttribute("title", "Close");
    closeBtn.appendChild(icon(ICONS.close));
    closeBtn.addEventListener("click", closePopup);

    acts.appendChild(moreBtn);
    acts.appendChild(resolveBtn);
    acts.appendChild(closeBtn);
    head.appendChild(acts);
    popup.appendChild(head);

    /*
     * What the comment is attached to, above the comment itself.
     *
     * The mark number ties this popup to the pin that opened it, and the
     * quote says what was marked. Both belong above the thread rather than
     * in the title bar: a reviewer reads what the objection is about before
     * they read the objection, and a line of quoted prose squeezed onto one
     * ellipsized line between a title and three buttons is not readable.
     */
    var sel = el("div", "co-pop-sel");
    if (comment.resolved) sel.setAttribute("data-resolved", "");
    if (lost) sel.setAttribute("data-orphan", "");
    sel.appendChild(el("span", "co-pop-mark", String(markNumber(comment))));
    sel.appendChild(
      el(
        "span",
        "co-pop-quote",
        comment.blockText || (comment.block ? "This block" : "About the page")
      )
    );
    popup.appendChild(sel);

    var threads = el("div", "co-pop-threads");
    threads.appendChild(thread(comment, comment.text, true));
    for (var i = 0; i < comment.replies.length; i++) {
      threads.appendChild(thread(comment.replies[i], comment.replies[i].text, false));
    }
    popup.appendChild(threads);

    if (orphaned(comment)) {
      var note = el("div", "co-pop-note");
      note.appendChild(el("div", "co-warn", "Anchor lost: this block has been rewritten since."));
      if (comment.blockText) note.appendChild(el("div", "co-quote", comment.blockText));
      popup.appendChild(note);
    }

    /*
     * Where this comment went, once it went somewhere.
     *
     * A row at the foot rather than a chip in the title bar: the title bar
     * holds what the comment *is*, and this is what happened to it. It is
     * also where a refusal is said, because that is where the action was
     * taken from.
     */
    var pending = relaying === comment.id;
    var failed = relayError && relayError.id === comment.id ? relayError.message : "";
    if (comment.external || pending || failed) {
      var filedRow = el("div", "co-filed");
      if (pending) {
        filedRow.setAttribute("data-pending", "");
        filedRow.appendChild(el("span", null, "Filing in " + TRACKER + "\\u2026"));
      } else if (comment.external) {
        filedRow.appendChild(el("span", null, "Filed as"));
        var issue = el("a", "co-ext", comment.external.key);
        issue.setAttribute("href", comment.external.url);
        issue.setAttribute("target", "_blank");
        issue.setAttribute("rel", "noreferrer noopener");
        filedRow.appendChild(issue);
      }
      if (failed) filedRow.appendChild(el("span", "co-warn", failed));
      popup.appendChild(filedRow);
    }

    if (comment.resolved) {
      var done = el("div", "co-resolved-row");
      var mark = el("span");
      mark.appendChild(icon(ICONS.resolve));
      done.appendChild(mark);
      done.appendChild(el("span", null, "Resolved"));
      popup.appendChild(done);
    }

    var reply = el("div", "co-pop-reply");
    reply.appendChild(el("div", "co-avatar", initial(author)));
    var replyField = field(
      "Reply...",
      function (text) {
        comment.replies.push({
          id: uid(),
          author: author || "Anonymous",
          text: text,
          createdAt: new Date().toISOString(),
        });
        writeAll();
        render();
      },
      closePopup
    );
    reply.appendChild(replyField.box);
    popup.appendChild(reply);

    placePopup(comment);
  }

  /* One row of the thread: the comment itself, or one reply to it. */
  function thread(row, text, isComment) {
    var line = el("div", "co-pop-row");
    line.appendChild(el("div", "co-avatar", initial(row.author)));

    var holder = el("div", "co-pop-wrap");
    var name = el("div", "co-pop-name");
    name.appendChild(el("strong", null, row.author || "Anonymous"));
    name.appendChild(el("span", "co-time", when(row.createdAt)));
    holder.appendChild(name);

    if (isComment && editing === row.id) {
      var editField = field(
        "Edit this comment...",
        function (next) {
          row.text = next;
          editing = null;
          writeAll();
          render();
        },
        function () {
          editing = null;
          renderPopup();
        }
      );
      editField.input.value = text;
      holder.appendChild(editField.box);
      // Measured after it is in the tree, so the box opens at the height of
      // the text it is holding rather than one line.
      window.setTimeout(function () {
        editField.refresh();
        editField.input.focus();
      }, 0);
    } else {
      holder.appendChild(el("div", "co-pop-body", text));
    }

    line.appendChild(holder);
    return line;
  }

  function placePopup(comment) {
    var at = spot(comment);
    var limit = document.documentElement.scrollWidth;

    if (!at) {
      // No pin to sit beside, so it goes where it will be read: near the top
      // of what is on screen.
      popup.style.left = Math.max(8, (limit - 360) / 2) + "px";
      popup.style.top = window.pageYOffset + 80 + "px";
      return;
    }

    var left = at.left + 41;
    if (left + 360 > limit - 8) left = at.left - 360 - 8;
    popup.style.left = Math.max(8, left) + "px";
    popup.style.top = Math.max(8, at.top - 32) + "px";
  }

  /* --- the popup's own menu ----------------------------------------- */

  var popMenu = null;

  function closePopMenu() {
    if (popMenu && popMenu.parentNode) popMenu.parentNode.removeChild(popMenu);
    popMenu = null;
  }

  function togglePopMenu(comment, anchor) {
    if (popMenu) {
      closePopMenu();
      return;
    }
    popMenu = el("div", "co-pop-menu");

    /*
     * Only when the plugin named a tracker, and only while this comment has
     * not been filed. A Send action that could file a second issue for the
     * same comment is worse than no Send action at all.
     */
    if (TRACKER && !comment.external) {
      var file = el("button", "co-pop-menu-item", "Send to " + TRACKER);
      file.addEventListener("click", function () {
        closePopMenu();
        relay(comment);
      });
      popMenu.appendChild(file);
    }

    var edit = el("button", "co-pop-menu-item", "Edit");
    edit.addEventListener("click", function () {
      closePopMenu();
      editing = comment.id;
      renderPopup();
    });

    var remove = el("button", "co-pop-menu-item", "Delete");
    remove.setAttribute("data-danger", "");
    remove.addEventListener("click", function () {
      closePopMenu();
      var index = all.indexOf(comment);
      if (index !== -1) all.splice(index, 1);
      selected = null;
      writeAll();
      popup.hidden = true;
      render();
    });

    popMenu.appendChild(edit);
    popMenu.appendChild(remove);
    popMenu.style.top = anchor.offsetTop + anchor.offsetHeight + 4 + "px";
    popMenu.style.right = "8px";
    popup.appendChild(popMenu);
  }

  /* --- the popup's priority menu ------------------------------------ */

  function togglePriMenu(comment, anchor) {
    if (popMenu) {
      closePopMenu();
      return;
    }
    popMenu = el("div", "co-pop-menu");
    popMenu.setAttribute("data-pri", "");

    for (var i = 0; i < PRI_ORDER.length; i++) {
      (function (level) {
        var row = el("button", "co-pop-menu-item");
        row.setAttribute("data-level", level);
        if (comment.priority === level) row.setAttribute("data-on", "");
        row.appendChild(el("span", "co-pri-mark", PRI[level].mark));
        row.appendChild(document.createTextNode(PRI[level].label));
        row.addEventListener("click", function () {
          closePopMenu();
          comment.priority = level;
          writeAll();
          render();
        });
        popMenu.appendChild(row);
      })(PRI_ORDER[i]);
    }

    popMenu.style.top = anchor.offsetTop + anchor.offsetHeight + 4 + "px";
    popMenu.style.left = anchor.offsetLeft + "px";
    popup.appendChild(popMenu);
  }

  /* --- dropping a pin ----------------------------------------------- */

  /*
   * Hovering says which block a click would mark. It is only wired up here,
   * on the sheet, so it exists exactly when a click would do something --
   * outlining blocks in view mode would be a page that flickers while it is
   * being read.
   */
  capture.addEventListener("mousemove", function (event) {
    // Frozen while a comment is being written: the outline is on the block
    // the draft is about, and it must not follow the cursor to the box.
    if (draftPoint) return;
    aimAt(event.clientX, event.clientY);
  });
  capture.addEventListener("mouseleave", function () {
    if (!draftPoint) setAim(null);
  });
  // A scroll under a still cursor changes which block is beneath it without
  // firing a move, so the measured box is no longer worth trusting. The
  // outline itself is positioned in document space and stays on its block.
  window.addEventListener(
    "scroll",
    function () {
      if (!draftPoint) aimBox = null;
    },
    { passive: true }
  );

  capture.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    // The sheet swallows the click, so the document handler that would have
    // dismissed an open menu never runs. Say so here instead.
    closeMenu();
    closePopMenu();
    drop(event.clientX, event.clientY);
  });

  function drop(clientX, clientY) {
    needName(function () {
      var base = host.getBoundingClientRect();
      var point = {
        x: clientX - base.left,
        y: clientY - base.top,
        block: null,
        rx: null,
        ry: null,
        text: "",
        node: null,
      };

      var target = blockAt(clientX, clientY);
      if (target) {
        var box = target.getBoundingClientRect();
        point.block = target.getAttribute(BLOCK_ATTR);
        // The fraction, not the pixel offset: a paragraph that re-wraps at a
        // different width keeps the pin on roughly the same words, where a
        // stored offset would put it past the end of a shorter line.
        point.rx = box.width ? (clientX - box.left) / box.width : 0;
        point.ry = box.height ? (clientY - box.top) / box.height : 0;
        point.text = clip(target.textContent);
        // Held so the outline can stay on this block while the comment is
        // written, and so it can be re-measured if the page reflows.
        point.node = target;
      }

      openDraft(point);
    });
  }

  var ghost = null;

  function openDraft(point) {
    closeDraft();
    draftPoint = point;

    setAim(point.node);
    if (point.node) aim.setAttribute("data-locked", "");

    draftQuote.textContent = point.text || "About the page";
    draftPri = "normal";
    paintDraftPri();

    // The pin the comment will become, drawn before it exists, so the drop
    // point is visible while the comment is being written.
    ghost = el("div", "co-pin co-ghost");
    ghost.appendChild(markSvg("#d4421e"));
    ghost.appendChild(el("span", null, String(mine().length + 1)));
    ghost.style.left = point.x + "px";
    ghost.style.top = point.y + "px";
    pins.appendChild(ghost);

    var limit = document.documentElement.scrollWidth;
    var left = point.x + 41;
    if (left + 280 > limit - 8) left = point.x - 280 - 8;
    draft.style.left = Math.max(8, left) + "px";
    draft.style.top = Math.max(8, point.y - 32) + "px";

    draftField.input.value = "";
    draftField.refresh();
    draft.hidden = false;
    draftField.input.focus();
  }

  function closeDraft() {
    draft.hidden = true;
    draftPoint = null;
    aim.removeAttribute("data-locked");
    // Not left on the block it was locked to: the cursor is wherever the
    // draft's Cancel was, and the next move re-measures from there.
    setAim(null);
    if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
    ghost = null;
  }

  function commit(text) {
    if (!draftPoint) return;
    var point = draftPoint;

    all.push({
      id: uid(),
      page: PAGE,
      sourcePath: SOURCE_PATH,
      block: point.block,
      blockText: point.text,
      x: point.x,
      y: point.y,
      rx: point.rx,
      ry: point.ry,
      author: author || "Anonymous",
      text: text,
      createdAt: new Date().toISOString(),
      resolved: false,
      priority: draftPri,
      // Left by a person, in a browser. Only a tool writing into the review
      // file ever fills this in.
      agent: null,
      // Nothing has been filed from it yet, and only the plugin can.
      external: null,
      replies: [],
    });

    writeAll();
    closeDraft();
    render();
  }

  /* --- modes -------------------------------------------------------- */

  function setMode(next) {
    mode = next;
    capture.hidden = next !== "comment";
    panel.hidden = next !== "review";
    if (next !== "comment") {
      closeDraft();
      setAim(null);
    }

    for (var i = 0; i < modeBtns.length; i++) {
      if (MODES[i][0] === next) modeBtns[i].setAttribute("data-active", "");
      else modeBtns[i].removeAttribute("data-active");
    }
    modeSlider.setAttribute("data-at", String(indexOfMode(next)));
    render();
  }

  function indexOfMode(name) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i][0] === name) return i;
    return 0;
  }

  for (var b = 0; b < modeBtns.length; b++) {
    (function (name) {
      modeBtns[b].addEventListener("click", function () {
        setMode(name);
      });
    })(MODES[b][0]);
  }

  panelClose.addEventListener("click", function () {
    setMode("view");
  });

  for (var g = 0; g < filterBtns.length; g++) {
    (function (name) {
      filterBtns[g].addEventListener("click", function () {
        filter = name;
        renderPanel();
      });
    })(FILTERS[g]);
  }

  sortBtn.addEventListener("click", function () {
    sortBy = sortBy === "priority" ? "time" : "priority";
    writePrefs();
    renderPanel();
  });

  sideBtn.addEventListener("click", function () {
    side = side === "right" ? "left" : "right";
    panel.setAttribute("data-side", side);
    writePrefs();
    renderPanel();
  });

  /* --- resizing the panel -------------------------------------------- */

  resizer.addEventListener("mousedown", function (event) {
    event.preventDefault();
    resizer.setAttribute("data-dragging", "");
    var startX = event.clientX;
    var startWidth = width;

    function move(moveEvent) {
      var delta = side === "right" ? startX - moveEvent.clientX : moveEvent.clientX - startX;
      width = Math.max(220, Math.min(520, startWidth + delta));
      panel.style.width = width + "px";
    }

    function stop() {
      resizer.removeAttribute("data-dragging");
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("mouseup", stop, true);
      writePrefs();
    }

    document.addEventListener("mousemove", move, true);
    document.addEventListener("mouseup", stop, true);
  });

  /* --- the notch menu ------------------------------------------------ */

  function closeMenu() {
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
    menu = null;
    menuBtn.removeAttribute("data-open");
  }

  function item(label, iconSpec, hint, onClick) {
    var row = el("button", "co-menu-item");
    row.appendChild(icon(iconSpec));
    row.appendChild(el("span", null, label));
    if (hint) row.appendChild(el("span", "co-menu-key", hint));
    row.addEventListener("click", function () {
      closeMenu();
      onClick();
    });
    return row;
  }

  var THEME_ICONS = { light: ICONS.light, dark: ICONS.dark };

  menuBtn.addEventListener("click", function (event) {
    event.stopPropagation();
    if (menu) {
      closeMenu();
      return;
    }
    menu = el("div", "co-menu");

    menu.appendChild(
      item("Change name", ICONS.user, null, function () {
        askName(function () {
          render();
        });
      })
    );
    menu.appendChild(
      item("Clear comments on this page", ICONS.trash, null, function () {
        confirmClear();
      })
    );
    menu.appendChild(el("div", "co-menu-rule"));
    // Named for where it goes, not for where it is: a row labelled with the
    // current theme reads as a statement, and the reviewer has to work out
    // that it is a button.
    var next = themeChoice === "dark" ? "light" : "dark";
    menu.appendChild(
      item("Switch to " + next, THEME_ICONS[next], null, function () {
        themeChoice = next;
        writePrefs();
        paintTheme();
      })
    );
    menu.appendChild(
      item("Hide the notch", ICONS.hide, "H", function () {
        setHidden(true);
      })
    );

    notch.appendChild(menu);
    menuBtn.setAttribute("data-open", "");
  });

  // Anywhere outside closes whichever menu is open. Both are attached to the
  // document rather than to the menu itself, because a click that lands on
  // the page never reaches the shadow tree at all.
  document.addEventListener("click", function (event) {
    if (event.target === host) return;
    closeMenu();
    closePopMenu();
  });
  shadow.addEventListener("click", function (event) {
    if (menu && !menu.contains(event.target) && event.target !== menuBtn && !menuBtn.contains(event.target)) {
      closeMenu();
    }
    if (popMenu && !popMenu.contains(event.target)) closePopMenu();
  });

  /* --- hiding --------------------------------------------------------- */

  /*
   * H puts the notch away and takes the overlay out of the reader's way:
   * comment mode's capture sheet, the panel, any open popup and a draft all
   * go with it, because leaving a sheet over the page with no visible way to
   * turn it off is a page that has stopped working for no stated reason. The
   * pins stay -- they are the comments, not the tool.
   */
  function setHidden(next) {
    hidden = next;
    if (next) {
      closeMenu();
      closePopMenu();
      closePopup();
      setMode("view");
    }
    notch.hidden = next;
  }

  /* --- the modal ------------------------------------------------------ */

  function closeModal() {
    scrim.hidden = true;
    clear(modal);
  }

  function openModal(title, build) {
    clear(modal);
    var head = el("div", "co-modal-head");
    head.appendChild(el("h3", null, title));
    var close = el("button", "co-icon-btn");
    close.setAttribute("title", "Close");
    close.appendChild(icon(ICONS.close));
    close.addEventListener("click", closeModal);
    head.appendChild(close);
    modal.appendChild(head);

    var body = el("div", "co-modal-body");
    build(body);
    modal.appendChild(body);
    scrim.hidden = false;
  }

  function askName(then) {
    openModal("What's your name?", function (body) {
      body.appendChild(el("p", null, "It is shown against the comments you leave."));

      var input = document.createElement("input");
      input.className = "co-field";
      input.setAttribute("type", "text");
      input.setAttribute("placeholder", "Alex");
      input.value = author;

      var save = el("button", "co-submit", "Save");
      save.disabled = !author.trim();

      function commitName() {
        var value = input.value.trim();
        if (!value) return;
        author = value;
        writeName(author);
        closeModal();
        if (then) then();
      }

      input.addEventListener("input", function () {
        save.disabled = !input.value.trim();
      });
      input.addEventListener("keydown", function (event) {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          commitName();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closeModal();
        }
      });
      save.addEventListener("click", commitName);

      body.appendChild(input);
      body.appendChild(save);
      window.setTimeout(function () {
        input.focus();
      }, 0);
    });
  }

  /* Asks once, and only when there is nothing to attribute a comment to. */
  function needName(then) {
    if (author.trim()) {
      then();
      return;
    }
    askName(then);
  }

  function confirmClear() {
    var rows = mine();
    openModal("Clear comments on this page?", function (body) {
      body.appendChild(
        el(
          "p",
          null,
          rows.length
            ? count(rows.length, "comment") +
                " on this page will be deleted, here and in the vault. Comments on other pages are left alone."
            : "There are none on this page."
        )
      );
      var go = el("button", "co-submit", "Delete");
      go.setAttribute("data-danger", "");
      go.disabled = !rows.length;
      go.addEventListener("click", function () {
        for (var i = all.length - 1; i >= 0; i--) {
          if (all[i].sourcePath === SOURCE_PATH) all.splice(i, 1);
        }
        selected = null;
        popup.hidden = true;
        writeAll();
        closeModal();
        render();
      });
      body.appendChild(go);
    });
  }

  scrim.addEventListener("click", function (event) {
    if (event.target === scrim) closeModal();
  });

  /* --- keyboard -------------------------------------------------------- */

  /*
   * Single letters, which is only safe because every field in here stops its
   * own keydown at the shadow boundary. Anything typed into the page's own
   * inputs is left alone by the same check the site's "/" handler uses.
   */
  document.addEventListener("keydown", function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    var active = document.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)
    ) {
      return;
    }

    var key = String(event.key || "").toLowerCase();

    if (key === "h") {
      event.preventDefault();
      setHidden(!hidden);
      return;
    }
    if (hidden) return;

    if (key === "escape") {
      if (!scrim.hidden) {
        closeModal();
        return;
      }
      if (menu || popMenu) {
        closeMenu();
        closePopMenu();
        return;
      }
      if (!draft.hidden) {
        closeDraft();
        return;
      }
      if (!popup.hidden) {
        closePopup();
        return;
      }
      if (mode !== "view") setMode("view");
      return;
    }

    if (key === "v" || key === "c" || key === "r") {
      event.preventDefault();
      setMode(key === "v" ? "view" : key === "c" ? "comment" : "review");
    }
  });

  /* --- rendering ------------------------------------------------------- */

  function render() {
    blocks = blockIndex();
    renderPins();
    renderPanel();
    if (selected && byId(selected)) renderPopup();
    else if (!popup.hidden) closePopup();
  }

  /* --- keeping pins where the text is ---------------------------------- */

  var pending = null;
  function reposition() {
    if (pending !== null) return;
    pending = window.requestAnimationFrame(function () {
      pending = null;
      renderPins();
      if (aimTarget) setAim(aimTarget);
      if (selected) {
        var comment = byId(selected);
        if (comment) placePopup(comment);
      }
    });
  }

  // Not scroll: positions are measured against the host, which scrolls with
  // the document, so they are already scroll-invariant. Reflow is what moves
  // a block relative to the page.
  window.addEventListener("resize", reposition, { passive: true });
  if (window.ResizeObserver) {
    new ResizeObserver(reposition).observe(document.body);
  }

  setMode("view");
  pull();
})();
`;

/**
 * Embeds a string in JavaScript source safely.
 *
 * `JSON.stringify` alone is not enough: it leaves `<` as itself, so a value
 * containing `</script>` would end the element early and spill the rest into
 * the document as markup. Nothing we emit contains one today, which is
 * exactly the kind of thing that stops being true quietly.
 */
function jsString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * The overlay as one script: its stylesheet, then the code that mounts it.
 *
 * The stylesheet travels as a JavaScript string rather than a `<style>` in
 * the head because it has to end up *inside* the shadow root. A stylesheet in
 * the document cannot reach in there -- which is the isolation the overlay
 * wants, so the way in is to hand the text to the script that builds the root.
 */
export function overlayBundle(): string {
  return `var OSP_OVERLAY_CSS=${jsString(OVERLAY_CSS)};\n${OVERLAY_SCRIPT}`;
}
