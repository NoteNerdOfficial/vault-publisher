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
 * comment in the review -- not just this page's, since what a reviewer
 * cannot already see is what is open on the pages they are not looking at;
 * a row belonging to another page is a link that opens it there. A pin opens
 * a popup holding the comment and its replies. **H** takes the whole overlay
 * off the page, pins and all, so the build can be read as a reader will see
 * it.
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
  /*
   * How the panel asks another page to open one of its comments.
   *
   * A query parameter rather than a fragment. The fragment belongs to the
   * site -- it is how a heading is linked -- and an id in there would be
   * read by the page's own anchor handling as a heading that does not
   * exist. A query is ignored by a file:// URL and dropped by the plugin's
   * server before it resolves a path, so the same link works both ways a
   * preview is opened.
   */
  var DEEP_PARAM = "osp-comment";
  var BLOCK_ATTR = "data-osp-block";
  var TEXT_LIMIT = 80;
  var SCHEMA = 10;
  /*
   * Whether this page's blocks are ours to mark, and keep marking.
   *
   * True for a page the build published without rendering it -- the vault's
   * own HTML, which may be an application. It changes three things: the
   * marking happens here rather than at build time, it happens again every
   * time the document changes, and a comment records which screen of the
   * application it was left on.
   */
  var STAMP_AT_RUNTIME = config.stamp === true;

  /*
   * Whether the reader of this page may write comments.
   *
   * False on a published build whose owner has not invited the public to
   * write into it, which is the default. The overlay is still here and
   * still worth having: the pins and the panel show whatever review was
   * imported, and the import and export in the settings menu are how a
   * review gets in and out of a site with no plugin behind it.
   *
   * What it turns off is authoring, in all four places it happens --
   * dropping a pin, replying, editing, and setting a priority -- rather
   * than only hiding the mode button and leaving the rest reachable by
   * keyboard. Resolving stays: it is triage of comments that already
   * exist, it writes nothing a reader did not already have, and it is what
   * makes an imported review usable as a checklist.
   *
   * Absent means true, which is what every page built before this existed
   * meant by saying nothing.
   */
  var CAN_COMMENT = config.comments !== false;

  /*
   * This page is part of a published site rather than a preview.
   *
   * It exists for one reason, and it is a mistake worth describing. Whether
   * the plugin is on the other end used to be decided from the protocol
   * alone -- http or https meant served, file: meant not. That was true
   * while the overlay shipped in previews only. A published site is https
   * too, so the same test said "served" about a static host with no plugin
   * anywhere near it, and every save would POST the reader's entire review
   * to /api/comments on the site's own origin. It would 404 and nothing
   * would appear to be wrong, which is exactly the problem: a reader's
   * private notes leaving their browser on every keystroke, into whatever
   * logs the host keeps.
   *
   * So the page says which kind of build it is, and the protocol is only
   * consulted for the kind that can have a plugin behind it.
   */
  var PUBLISHED = config.published === true;

  /*
   * Where a reader should send a review they have exported.
   *
   * A published site has no way back. The file is the whole channel, and a
   * file in somebody's Downloads folder with no idea where to send it is
   * not a channel at all -- so whoever published the site says here who to
   * send it to, and the export repeats it at the moment it matters.
   */
  var CONTACT = typeof config.contact === "string" ? config.contact : "";

  /*
   * Stamping block anchors here, for a page the build did not render.
   *
   * A note's page arrives with every block already carrying BLOCK_ATTR,
   * stamped by \`stampBlockIds\` while the rendered DOM was still live. A page
   * published as-is arrives with none: it was never parsed, which is the
   * whole point of that path, so there was no DOM to stamp.
   *
   * It can be done here instead because the anchor is derived from content
   * rather than position -- a hash of the block's tag and its normalized
   * text. That is computable from the live document in the browser, and it
   * agrees with what the build would have produced because it is the same
   * function over the same text in the same document order. \`anchor.ts\` holds
   * the other copy, and a test asserts the two agree; if they ever drift, a
   * pin on an as-is page reattaches to nothing.
   *
   * Runs before anything reads BLOCK_ATTR, so a restored pin finds its block.
   *
   * \`squash\` further down does the same thing to a string and is
   * deliberately not used here. That one is for display -- clipping a line of
   * context to fit a panel -- and this one is half of the anchor contract, so
   * sharing them would mean a tweak made for a tooltip silently moving every
   * anchor on every as-is page. The TypeScript side keeps them apart for the
   * same reason.
   */
  function normalizeBlockText(value) {
    return value.replace(/\\s+/g, " ").trim();
  }

  function hashBlockText(value) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash =
        (hash +
          ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>>
        0;
    }
    return hash.toString(36);
  }

  /*
   * What a pin may anchor to on a page the build did not render.
   *
   * The first line is \`BLOCK_SELECTOR\` from \`anchor.ts\`, character for
   * character, and has to stay that way: a note's page is stamped by that
   * copy and this one, and an anchor stored by either must resolve in the
   * other.
   *
   * The second line is the part a prototype needs, and it exists because
   * the first line is a vocabulary for prose. A hand-written page is
   * paragraphs and headings; an application prototype is buttons, fields,
   * cards, a dialog and a nav, and not one of those is a \`p\`. So a pin
   * dropped on a prototype found no block to hold on to -- \`nearestBlock\`
   * walked up to the body and gave up -- and the comment was stored as a
   * pair of document coordinates with nothing attached to it. A point
   * cannot be hidden with the thing it was about, because a point is not
   * about anything, which is how a comment on a dialog stayed on screen
   * after the dialog closed.
   *
   * Only ever added to, never reordered, and the runtime side only: a
   * block's id is a hash of its tag and its text, so a tag that was not
   * stamped before cannot change the id of one that was, and duplicate
   * numbering counts per hash, so it cannot renumber one either. That is
   * what makes widening this safe for reviews already written.
   *
   * \`div\` and \`span\` are deliberately absent. They name nothing, they nest
   * without limit, and stamping them would hash most of the document
   * several times over for anchors that move whenever a wrapper is added.
   * \`[role]\` covers the ones that do say what they are.
   */
  var PROSE_BLOCKS =
    "p, h1, h2, h3, h4, h5, h6, li, blockquote, table, figure, pre, .callout";
  var UI_BLOCKS =
    "main, header, footer, nav, aside, section, article, dialog, form, " +
    "fieldset, details, summary, button, a, label, td, th, [role]";

  function stampBlocks() {
    var selector = PROSE_BLOCKS + ", " + UI_BLOCKS;
    var nodes = document.querySelectorAll(selector);
    var seen = {};
    for (var i = 0; i < nodes.length; i++) {
      var text = normalizeBlockText(nodes[i].textContent || "");
      if (!text) continue;
      /* The tag joins the text through a separator that cannot occur in
         either, so an <li> and the <p> it wraps do not hash alike. */
      var base = hashBlockText(nodes[i].tagName.toLowerCase() + "\\u0000" + text);
      var key = "k" + base;
      var count = Object.prototype.hasOwnProperty.call(seen, key) ? seen[key] : 0;
      seen[key] = count + 1;
      nodes[i].setAttribute(BLOCK_ATTR, count === 0 ? base : base + "-" + count);
    }
  }

  if (STAMP_AT_RUNTIME) stampBlocks();

  /*
   * Which screen of an application a comment belongs to.
   *
   * A single-page application is one published file, so every screen in it
   * shares one URL as far as the build is concerned -- and \`page\` therefore
   * cannot tell them apart. Ten comments from five screens would all come
   * back on whichever screen happened to load.
   *
   * What does tell them apart is the address bar, which every router writes
   * to whatever it is built on. Reading \`location\` rather than asking a
   * framework is the whole point: there is nothing here that knows one from
   * another, and nothing to keep up with when the next one arrives.
   *
   * Recorded only on a page stamped at runtime. A page the build rendered is
   * one document at one URL, and recording a route for it would mean a
   * comment made while reading the preview through the review server was
   * hidden when the same file was opened from disk, where the path differs.
   */
  function currentRoute() {
    if (!STAMP_AT_RUNTIME) return null;
    var search = location.search;
    if (search) {
      // Our own deep link is how one page's panel opens a comment on
      // another, so a pin must not be hidden by the link that points at it.
      var kept = [];
      var parts = search.slice(1).split("&");
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] && parts[i].split("=")[0] !== DEEP_PARAM) kept.push(parts[i]);
      }
      search = kept.length ? "?" + kept.join("&") : "";
    }
    return location.pathname + search + location.hash;
  }

  /*
   * A comment with no route is from a page that is one document, or from a
   * review written before routes were recorded. Both are shown everywhere,
   * which is what they meant when they were written.
   */
  function onThisRoute(comment) {
    if (!comment.route) return true;
    return comment.route === currentRoute();
  }

  /* --- which page of a deck that is one file ------------------------- */

  /*
   * A deck or a prototype whose pages are not URLs.
   *
   * \`currentRoute\` above covers the applications that route through the
   * address bar, and misses the commonest single-file deck entirely: every
   * slide is in the document at once and one of them is shown, by a class,
   * a \`hidden\` attribute or a style. The address bar never moves, so every
   * comment in the file carried the same route, \`onThisRoute\` said yes to
   * all of them, and every pin in the deck drew at once -- over whichever
   * slide was up, and at the top-left corner for all the ones whose blocks
   * were hidden, since a \`display:none\` block measures as a zero box at the
   * document origin. That is the pile-up on the first page.
   *
   * What tells the pages apart is the thing the deck is already doing:
   * exactly one of a run of siblings is laid out and the rest are not. That
   * is a structural signature rather than a convention, so it reads a deck
   * built by hand, by a generator or by a framework without knowing which --
   * the same reason \`currentRoute\` reads \`location\` instead of asking a
   * router. Where the signature does not hold, nothing here fires and the
   * overlay behaves exactly as it did.
   */

  /*
   * A node's element children, as an array, without our own.
   *
   * The exclusion belongs here rather than at the two call sites, which is
   * the lesson of getting it wrong once: the scan skipped the host and the
   * naming did not, so a deck was found and then named \`div:0/3\` for two
   * slides. Both questions are asked of the same list, so there is one list.
   *
   * What it excludes is the overlay's host, a \`div\` appended to the body. On
   * a deck whose slides are also \`div\`s at the top level it would otherwise
   * sit in their group as a second shown member and one-of-many would never
   * hold -- the overlay would have hidden the pins by being there.
   */
  function childElements(node) {
    var kids = node && node.children ? node.children : [];
    var out = [];
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].id === "osp-overlay-host") continue;
      out.push(kids[i]);
    }
    return out;
  }

  /*
   * Whether there is any layout here to measure.
   *
   * A box of no size is a good second opinion about a hidden element in a
   * browser and a wrong answer everywhere else: a document without a layout
   * engine reports no boxes for anything, so measuring would call every
   * element on the page hidden and suppress every pin. So the measurement
   * is only consulted where a measurement means something.
   *
   * Latched on rather than sampled each time, because the answer only ever
   * goes one way: a document that has been laid out once does not stop
   * being laid out, and an element that genuinely has no box would
   * otherwise keep the question open forever.
   */
  var sawLayout = false;
  /** Latched by \`showing\` when a pin's anchor turns out not to scroll. */
  var sawFixed = false;
  function hasLayout() {
    if (sawLayout) return true;
    var body = document.body;
    sawLayout = !!(
      body &&
      (body.offsetWidth || body.offsetHeight || body.getClientRects().length)
    );
    return sawLayout;
  }

  /*
   * Whether this element itself is shown, saying nothing about its parents.
   *
   * A deck hides a page in several ways that do not answer each other --
   * \`display:none\`, the \`hidden\` attribute, \`aria-hidden\`, a page faded out
   * with \`visibility\` or \`opacity\` -- and the faded one is why the computed
   * style has to be read at all: it has boxes in exactly the usual place and
   * would otherwise read as the page on screen.
   *
   * Self only, because the one caller that walks over many elements already
   * knows the parent is shown: it only ever descends into shown children.
   * An ancestor walk per element would multiply the whole scan by the depth
   * of the document for an answer already in hand.
   */
  function shownSelf(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute("hidden")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;

    if (window.getComputedStyle) {
      var style = window.getComputedStyle(el);
      if (style) {
        if (style.display === "none") return false;
        if (style.visibility === "hidden" || style.visibility === "collapse") {
          return false;
        }
        if (style.opacity === "0") return false;
      }
    }

    if (hasLayout()) {
      if (!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)) {
        return false;
      }
    }

    return true;
  }

  /*
   * Whether this element is shown, parents included.
   *
   * For the one place that asks about a single element out of context -- a
   * pin's own block, which may be anywhere -- where a slide hidden three
   * levels up is exactly the case that matters.
   */
  function showing(el) {
    for (var node = el; node && node.nodeType === 1; node = node.parentNode) {
      if (!shownSelf(node)) return false;
      if (!sawFixed && heldToViewport(node)) sawFixed = true;
    }
    return true;
  }

  /*
   * Whether anything a pin hangs from is held to the viewport rather than to
   * the page.
   *
   * The pins are drawn in document space, and the comment on the listener
   * for reflow says positions are "already scroll-invariant" because the
   * layer scrolls with the document. That is true of a paragraph and false
   * of a dialog: \`position: fixed\` means the element does not move in the
   * window and therefore *does* move on the page, so a pin on a modal
   * stayed where the page said while the modal stayed where the window said,
   * and the two came apart by exactly the scroll distance. Measured in a
   * browser: a dialog sitting still at 189px while its two pins went from
   * 302 and 300 down to -139 and -141.
   *
   * Noticed here because this walk is already happening -- \`showing\` reads
   * the computed style of every ancestor of every pin's anchor -- and
   * latched, so the question is asked until the answer is yes and never
   * again. A page with nothing fixed on it never pays for the scroll
   * listener below, which is most pages the overlay is on.
   */
  function heldToViewport(node) {
    if (!window.getComputedStyle) return false;
    var style = window.getComputedStyle(node);
    if (!style) return false;
    return style.position === "fixed" || style.position === "sticky";
  }

  /*
   * What a page of a deck is called, preferring whatever the author wrote.
   *
   * An \`id\` first, because that is what a deck gives its slides and what a
   * link to one uses, so it survives the edits a hash of the slide's own
   * words would not -- a pin should not be lost because a typo on the slide
   * got fixed. Then the attributes generators write.
   *
   * The position is the last resort and the only positional thing in here,
   * which the rest of this file is at some pains to avoid. It carries the
   * tag and the sibling count beside it so that inserting a slide above
   * changes every key below rather than quietly handing one slide's name to
   * the next: a lost pin is reported, and a pin moved onto somebody else's
   * slide is not.
   */
  var VIEW_ATTRS = [
    "data-osp-view",
    "data-slide",
    "data-page",
    "data-view",
    "data-step",
    "data-index",
    "name",
    "aria-label",
  ];

  function viewKeyOf(el) {
    if (el.id) return "#" + el.id;
    for (var i = 0; i < VIEW_ATTRS.length; i++) {
      var value = el.getAttribute(VIEW_ATTRS[i]);
      if (value) return VIEW_ATTRS[i] + "=" + value;
    }
    var kids = childElements(el.parentNode);
    var at = 0;
    for (var k = 0; k < kids.length; k++) if (kids[k] === el) at = k;
    return el.tagName.toLowerCase() + ":" + at + "/" + kids.length;
  }

  /*
   * How much of somebody else's document this will walk before giving up.
   *
   * It runs on a timer over a page nobody here wrote, so it has to have a
   * ceiling. Breadth first, so the ceiling costs the right thing: a deck's
   * pages are siblings a level or two down and are always reached, and what
   * a budget runs out on is the depths of the one page that is open, where
   * there is nothing left to find.
   */
  var VIEW_SCAN_LIMIT = 600;

  /*
   * The page showing now, as a key, or "" when this document is not a deck.
   *
   * Every level with one child shown and at least one hidden contributes its
   * shown child's name, so a deck inside a tab panel reads as both and the
   * two are told apart. Anything less clear-cut than one-of-many is not a
   * deck: a list with one hidden row is a list, and guessing at it would
   * hide pins on an ordinary page, which is a worse bug than the one this
   * fixes.
   */
  /*
   * Every run of siblings in the document that behaves like a deck.
   *
   * Returns \`{ members, shown }\` per run: the pages, and the one of them
   * that is up. Both questions the overlay asks about pages are answered
   * from this one walk -- which page is showing, and which element is a
   * given page -- so the two cannot disagree about what a deck is.
   */
  function deckGroups() {
    if (!STAMP_AT_RUNTIME) return [];

    var found = [];
    var queue = [document.body];
    var seen = 0;

    while (queue.length && seen < VIEW_SCAN_LIMIT) {
      var kids = childElements(queue.shift());

      /*
       * Grouped by tag name before anything is decided.
       *
       * A deck's pages are alike -- a run of \`section\`s, a run of \`div\`s --
       * and what sits beside them is not: the footer that stays put, the
       * nav, the progress bar. Asking the question of a whole level failed
       * exactly there, because two shown children is not one-of-many, so a
       * deck with a persistent footer read as no deck at all. Asking it of
       * each run of same-tag siblings separately puts the footer in a group
       * of its own, where it is ignored for being alone.
       */
      var groups = Object.create(null);
      var order = [];
      var shown = [];

      for (var i = 0; i < kids.length; i++) {
        seen++;
        // Self only: this level's parent is already known to be shown,
        // since the walk never descends into one that is not.
        var up = shownSelf(kids[i]);
        if (up) shown.push(kids[i]);

        var tag = "t" + kids[i].tagName.toLowerCase();
        if (!groups[tag]) {
          groups[tag] = { shown: [], members: [] };
          order.push(tag);
        }
        groups[tag].members.push(kids[i]);
        if (up) groups[tag].shown.push(kids[i]);
      }

      for (var g = 0; g < order.length; g++) {
        var group = groups[order[g]];
        var hidden = group.members.length - group.shown.length;
        if (group.shown.length === 1 && hidden >= 1) {
          found.push({ members: group.members, shown: group.shown[0] });
        }
      }

      for (var j = 0; j < shown.length; j++) queue.push(shown[j]);
    }

    return found;
  }

  function currentViewKey() {
    if (!STAMP_AT_RUNTIME) return "";

    var groups = deckGroups();
    var parts = [];
    for (var i = 0; i < groups.length; i++) parts.push(viewKeyOf(groups[i].shown));

    // Sorted, so the key is about which pages are open and not about the
    // order a walk happened to meet them in.
    parts.sort();
    return parts.join(">");
  }

  /** The key as of the last check. Read by everything; written by \`checkView\`. */
  var viewKey = currentViewKey();

  /** True when the page on screen changed, having recorded that it did. */
  function checkView() {
    var next = currentViewKey();
    if (next === viewKey) return false;
    viewKey = next;
    return true;
  }

  /*
   * A comment belongs to the page of the deck that was showing when it was
   * dropped -- not to the page its block happens to sit in. The two differ
   * for a block the deck shows on every page, a footer or a slide number,
   * and the page that was on screen is the honest answer there: the comment
   * was about the footer *on slide three*.
   *
   * No view means a document that was not a deck when the pin was dropped,
   * or a review written before this existed. Both are shown wherever their
   * page is shown, which is what they meant at the time.
   */
  function onThisView(comment) {
    if (!comment.view) return true;
    if (comment.view === viewKey) return true;
    return viewPagesShowing(comment.view);
  }

  /*
   * Whether the pages a view key names are on screen, asked of the document
   * rather than of the key.
   *
   * The key is a comparison of *sets*: which pages are up, all of them, in
   * one string. That is the right thing for turning a deck and the wrong
   * thing for deciding whether one pin belongs here, and a prototype is
   * where the difference shows. Two dialogs as siblings of the screen are a
   * run of same-tag siblings with one of them shown, so they read as a deck
   * -- and the moment the reviewer opens the second one, two are shown, the
   * run stops looking like a deck, the key goes empty, and a pin on a panel
   * that is plainly open in front of them disappears. Found in a browser;
   * jsdom cannot show it, since it was the second dialog opening that did it.
   *
   * So a key that does not match is asked the narrower question: is the
   * element each part of it names in the document and on screen? Only ever
   * turning a no into a yes, and only on the evidence of the element itself.
   *
   * A positional part -- \`section:1/7\`, a slide nobody named -- cannot be
   * resolved on its own, which is as it should be: the whole reason that
   * form carries the tag and the count is that an index is not an identity.
   * Those keep the comparison they had.
   */
  function viewPagesShowing(key) {
    var parts = String(key).split(">");
    for (var i = 0; i < parts.length; i++) {
      if (!contextNode(parts[i])) return false;
    }
    return true;
  }

  /* --- what a comment is inside ------------------------------------- */

  /*
   * The thing a pin was dropped inside, which is what it shows and hides
   * with.
   *
   * \`view\` above answers this for a deck, where the pages are siblings and
   * exactly one of them is up. A prototype is not shaped like that. A
   * dialog, a side panel, a menu, a sheet, a toast: each one is shown *over*
   * the screen rather than instead of it, so two things are laid out at once
   * and nothing in the deck signature fires. Then it closes, and it closes
   * in one of two ways -- hidden where it stands, or taken out of the
   * document altogether -- and a pin left in it used to survive both:
   *
   *   - A pin anchored to a block inside it was already handled for the
   *     first way, since \`showing\` walks the ancestors. The second way fell
   *     through to the point the pin was dropped on, because a block that is
   *     not in the document reads exactly like a block whose text has
   *     changed, and that is a case we deliberately keep the pin for.
   *   - A pin on a *control* had no anchor at all, which was the larger
   *     half: the vocabulary we stamped was prose, and a dialog is buttons.
   *     \`UI_BLOCKS\` is the other half of this fix.
   *
   * So a comment records what it was inside as well as what it was on: the
   * nearest ancestor that can be named without counting siblings -- an
   * \`id\`, or one of the attributes a generator writes. Named rather than
   * positional because a context has to be found again in a document that
   * has been re-rendered since, where an index is a different element and a
   * name is the same one.
   *
   * The rule that follows is the whole feature, and it is one line in
   * \`spot\`: **a pin draws only while its context is in the document and on
   * screen.** Hidden in place, hidden three levels up, or unmounted -- all
   * three are "not showing" to the same function.
   *
   * It is also what makes the stored point meaningful again. A point in
   * document space is a claim about where the page was, and a dialog is
   * centred in the viewport rather than placed on the page -- so the
   * coordinates of a pin in one are wrong as soon as anything scrolls. The
   * fraction across its context is not, which is \`cx\`/\`cy\`, and it is the
   * same reasoning as \`rx\`/\`ry\` against a block one level up.
   *
   * A comment with no context behaves exactly as it did: either nothing
   * above it could be named, or it was written before this existed.
   */

  /*
   * How far up to look. A context is a dialog or a panel, which is a handful
   * of levels above whatever was clicked; walking to the root of a deeply
   * wrapped application would find the outermost frame every time, which
   * names a context that can never close and is therefore no context at all.
   */
  var CONTEXT_LIMIT = 12;

  function contextKeyOf(el) {
    if (el.id) return "#" + el.id;
    for (var i = 0; i < VIEW_ATTRS.length; i++) {
      var value = el.getAttribute(VIEW_ATTRS[i]);
      if (value) return VIEW_ATTRS[i] + "=" + value;
    }
    return "";
  }

  /*
   * What a point is inside, as a key, or null for a point inside nothing
   * that can be named.
   *
   * Recorded only on a page stamped at runtime, like \`route\` and \`view\`:
   * a page the build rendered is one document that is all on screen at once,
   * and there is nothing in it that opens and closes.
   */
  function contextOf(node) {
    if (!STAMP_AT_RUNTIME) return null;
    var up = 0;
    for (var el = node; el && el.nodeType === 1; el = el.parentNode) {
      if (el === document.body || el === document.documentElement) break;
      if (++up > CONTEXT_LIMIT) break;
      var key = contextKeyOf(el);
      if (key) return key;
    }
    return null;
  }

  /*
   * The element a context key names and that is on screen now, or null.
   *
   * Matched by reading the attribute rather than by building a selector
   * from the key: a value may hold a quote, a bracket or a space, and
   * escaping somebody else's attribute value into CSS correctly is a job
   * with no upside here.
   *
   * Where a key names more than one element -- two panels with the same
   * \`aria-label\`, which is somebody else's bug and not ours to fail on --
   * the one that is showing wins. Erring that way on purpose: a pin drawn
   * for a context that is open somewhere is the behaviour this had before,
   * and a pin wrongly hidden is a comment the reviewer cannot find.
   */
  function contextNode(key) {
    if (!key) return null;
    var text = String(key);
    var nodes = [];

    if (text.charAt(0) === "#") {
      var one = document.getElementById(text.slice(1));
      if (one) nodes.push(one);
    } else {
      var eq = text.indexOf("=");
      if (eq === -1) return null;
      var name = text.slice(0, eq);
      var value = text.slice(eq + 1);
      var found = document.querySelectorAll("[" + name + "]");
      for (var i = 0; i < found.length; i++) {
        if (found[i].getAttribute(name) === value) nodes.push(found[i]);
      }
    }

    for (var j = 0; j < nodes.length; j++) if (showing(nodes[j])) return nodes[j];
    return null;
  }

  /** Whether a comment's context is on screen, or it has none to be in. */
  function contextOpen(comment) {
    if (!comment.context) return true;
    return !!contextNode(comment.context);
  }

  /** The one case a reviewer needs told: it is in something, and it is shut. */
  function contextClosed(comment) {
    return !!comment.context && !contextOpen(comment);
  }

  /*
   * Which contexts are open, as a key, so a change can be noticed.
   *
   * The same shape as \`viewKey\` and for the same reason: a dialog opening
   * is a change to what the overlay should be drawing, and nothing in the
   * document tells us so directly. Only the contexts comments were actually
   * left in are asked about, so a page with no comments in anything costs
   * nothing per check.
   */
  function contextSignature() {
    var rows = mine();
    var keys = [];
    var seenKey = Object.create(null);

    for (var i = 0; i < rows.length; i++) {
      var key = rows[i].context;
      if (!key || seenKey[key]) continue;
      seenKey[key] = true;
      keys.push(key);
    }

    keys.sort();
    var out = [];
    for (var k = 0; k < keys.length; k++) {
      out.push(keys[k] + (contextNode(keys[k]) ? "+" : "-"));
    }
    return out.join(">");
  }

  var contextState = "";

  /** True when something a comment was left in opened or closed. */
  function checkContexts() {
    var next = contextSignature();
    if (next === contextState) return false;
    contextState = next;
    return true;
  }

  /*
   * Turning the deck to one of its pages.
   *
   * The overlay cannot ask the deck to do this. A deck is somebody else's
   * script with its own idea of which slide is up, and there is no method
   * to call: the only thing it ever does is change an attribute on the
   * pages themselves. So that is what this does -- it reproduces the change
   * rather than inventing one.
   *
   * The state is **swapped** rather than written. Whatever makes the page
   * that is up shown becomes the target's, and whatever makes the target
   * hidden becomes the old one's, across the handful of attributes a deck
   * carries it on. Two things follow from doing it that way and neither
   * holds if the overlay writes its own \`display\` instead. The vocabulary
   * is the deck's own, so nothing here has to know whether this deck hides
   * a page with a class, a style, an attribute or \`aria-hidden\`. And the
   * result is a state the deck itself could have produced, so the deck is
   * not broken by having been moved: its own counter is now out of step,
   * and the reviewer's next Prev or Next rewrites every page and puts it
   * back in step. An inline \`display\` of ours would outrank a class the
   * deck toggles and break its navigation for good.
   *
   * What it costs: where two pages differ in some *other* way carried on
   * one of these attributes -- a theme class on the same \`class\` attribute
   * -- that swaps too. A deck that does this is rare, the effect is visible
   * rather than silent, and the next page turn clears it.
   */
  var VIEW_STATE_ATTRS = [
    "class",
    "style",
    "hidden",
    "open",
    "aria-hidden",
    "aria-selected",
    "aria-current",
    "aria-expanded",
    "data-active",
    "data-state",
    "data-current",
    "data-visible",
  ];

  function swapAttr(a, b, name) {
    var from = a.getAttribute(name);
    var to = b.getAttribute(name);
    if (from === to) return;
    if (to === null) a.removeAttribute(name);
    else a.setAttribute(name, to);
    if (from === null) b.removeAttribute(name);
    else b.setAttribute(name, from);
  }

  function swapViewState(from, to) {
    for (var i = 0; i < VIEW_STATE_ATTRS.length; i++) {
      swapAttr(from, to, VIEW_STATE_ATTRS[i]);
    }
  }

  /*
   * Shows the page a key names, and says whether it got there.
   *
   * A round per level, because a page nested inside another deck cannot be
   * reached until the deck holding it is on the right page: showing the
   * outer one is what puts the inner group in the document's shown tree,
   * where the next round finds it. Four is more levels of deck than anyone
   * builds, and the loop stops early the moment a round changes nothing.
   */
  function turnToView(target) {
    if (!target) return true;
    checkView();
    if (viewKey === target) return true;

    var wanted = String(target).split(">");

    for (var round = 0; round < 4; round++) {
      var groups = deckGroups();
      var moved = false;

      for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        // Already showing one of the pages asked for: this level is done.
        if (wanted.indexOf(viewKeyOf(group.shown)) !== -1) continue;

        for (var m = 0; m < group.members.length; m++) {
          var member = group.members[m];
          if (member === group.shown) continue;
          if (wanted.indexOf(viewKeyOf(member)) === -1) continue;
          swapViewState(group.shown, member);
          moved = true;
          break;
        }
      }

      if (!moved) break;
      checkView();
      if (viewKey === target) return true;
    }

    checkView();
    return viewKey === target;
  }

  /*
   * A deck's page, in as few characters as name it.
   *
   * The key is built to be compared, not read: \`#slide-3\` where the author
   * named the slide, \`section:2/7\` where nobody did. Both have a readable
   * form and the second one is the reason this exists -- "3 of 7" is a page
   * of a deck, and "section:2/7" is a bug report.
   */
  function viewLabel(key) {
    var parts = String(key).split(">");
    var out = [];

    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (part.charAt(0) === "#") {
        out.push(part.slice(1));
        continue;
      }
      var eq = part.indexOf("=");
      if (eq !== -1) {
        out.push(part.slice(eq + 1));
        continue;
      }
      var colon = part.indexOf(":");
      var slash = part.indexOf("/");
      if (colon !== -1 && slash > colon) {
        var at = parseInt(part.slice(colon + 1, slash), 10);
        if (!isNaN(at)) {
          out.push(at + 1 + " of " + part.slice(slash + 1));
          continue;
        }
      }
      out.push(part);
    }

    return out.join(" / ");
  }

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
    medium: { label: "Medium", mark: "\\u2013" },
    low: { label: "Low", mark: "\\u2193" },
  };
  var PRI_ORDER = ["high", "medium", "low"];

  /*
   * The middle level was called "normal" until schema 6. A browser carries
   * comments in localStorage and a vault carries them in a file, so both can
   * hand one back long after this build replaced it -- and it is the same
   * level under a worse name, so it is read across rather than dropped. It
   * doubles as the fallback for anything unrecognised, which it already was.
   */
  function priOf(value) {
    return value === "high" || value === "low" ? value : "medium";
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
    // Which screen of an application this was left on, when it was one.
    row.route = typeof row.route === "string" && row.route ? row.route : null;
    // Which page of a single-file deck, for the screens the address bar
    // does not tell apart.
    row.view = typeof row.view === "string" && row.view ? row.view : null;
    row.blockText = typeof row.blockText === "string" ? row.blockText : "";
    row.resolved = row.resolved === true;
    row.priority = priOf(row.priority);
    // A comment an agent wrote into the review file by hand. Nothing in here
    // ever sets it; reading it is the whole of the support for it.
    row.agent = typeof row.agent === "string" && row.agent ? row.agent : null;
    // Where a comment came in from, for one this browser did not make.
    row.imported = typeof row.imported === "string" && row.imported ? row.imported : null;
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
  /* The trackers a record may name. Anything else is read as GitHub. */
  var PROVIDERS = { github: true, jira: true, asana: true };

  function extOf(value) {
    if (!value || typeof value !== "object") return null;
    if (typeof value.key !== "string" || !value.key) return null;
    if (typeof value.url !== "string") return null;
    if (value.url.indexOf("https://") !== 0 && value.url.indexOf("http://") !== 0) {
      return null;
    }
    return {
      provider: PROVIDERS[value.provider] ? value.provider : "github",
      key: value.key,
      url: value.url,
      filedAt: typeof value.filedAt === "string" ? value.filedAt : "",
    };
  }

  /*
   * What the pill says.
   *
   * A GitHub issue is spoken as "#41" and a Jira issue as its key, both of
   * which are short enough to sit in a row of a panel. An Asana task has no
   * short name at all -- what identifies it is sixteen digits -- so the pill
   * says where it went and the tooltip says which one.
   */
  function issueMark(ext) {
    if (ext.provider === "asana") return "Asana";
    var hash = ext.key.indexOf("#");
    return hash === -1 ? ext.key : ext.key.slice(hash);
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
  /*
   * 320 rather than the 280 it was. The panel carries a filter row, a
   * labelled order row and rows that now say which page they are on, and at
   * 280 the order control had nowhere to go but a corner. A reviewer who has
   * dragged it to a width of their own keeps that width; this is only where
   * it starts.
   */
  var width = typeof prefs.width === "number" ? prefs.width : 320;
  var sortBy = prefs.sort === "priority" ? "priority" : "time";

  /* --- the vault, when it is reachable ------------------------------ */

  /*
   * The page is served by the plugin, so the comments can live in the vault
   * instead of only in this browser. When it is opened as a bare file
   * instead -- straight out of the preview folder, with no plugin running --
   * every call here fails and the overlay carries on against localStorage
   * alone. That is a degraded mode, not a broken one, so none of it reports
   * an error to the reader.
   *
   * A published build is never served, whatever its protocol: there is no
   * plugin behind a static host, and asking anyway would send the reader's
   * review to somebody else's origin. See PUBLISHED above.
   */
  var API = "/api/comments";
  var served =
    !PUBLISHED && (location.protocol === "http:" || location.protocol === "https:");
  var syncing = false;
  var syncAgain = false;

  /*
   * Issues whose comment has just been deleted here.
   *
   * The plugin closes them and then drops them from the document, so this is
   * a handover and not a record: it is held only until a save lands, and it
   * is in memory because the save goes out in the same tick as the delete.
   * A page closed in between loses the deletion and the comment with it,
   * which is the same outcome as never having deleted anything.
   */
  var withdrawn = [];

  function withdraw(comment) {
    if (!comment || !comment.external) return;
    withdrawn.push({
      id: comment.id,
      external: comment.external,
      at: new Date().toISOString(),
    });
  }

  function payload() {
    return JSON.stringify({
      version: SCHEMA,
      site: SITE,
      exportedAt: new Date().toISOString(),
      comments: all,
      withdrawn: withdrawn,
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
    // What this save is handing over. Anything deleted while the request is
    // in flight is appended after these, and goes with the next one.
    var handed = withdrawn.length;
    fetch(API, {
      method: "POST",
      // text/plain keeps this a simple request. application/json would earn
      // a preflight, and a preflight is a second thing that can fail.
      headers: { "Content-Type": "text/plain" },
      body: payload(),
    })
      .then(function (response) {
        // Kept on a failure, so a deletion that never reached the vault is
        // still waiting to be handed over.
        if (response && response.ok) withdrawn.splice(0, handed);
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
   * by a copy saved before they did. The two exceptions are the fields only
   * the plugin writes -- the issue a comment was filed as, and a resolve
   * that came from that issue being finished -- and neither can undo
   * anything done here. Anything the vault has and this browser does not is
   * new here -- another browser, another machine, or this one before its
   * storage was cleared -- and is taken as is.
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
        // Two fields the vault is authoritative for. Only the plugin ever
        // sets them, so a local copy without one is out of date rather than
        // disagreeing, and taking either cannot undo anything done here.
        var held = byId(row.id);
        if (held && !held.external && row.external) {
          held.external = row.external;
          added = true;
        }
        // A resolve travels one way only. The plugin sets this when the
        // tracker says the work is done, and a resolve cannot undo a
        // resolve; reopening stays the decision of whoever is looking at
        // the page.
        if (held && !held.resolved && row.resolved) {
          held.resolved = true;
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
        // The comment a link asked for may have arrived only just now.
        showWanted();
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

  function byAge(a, b) {
    return String(a.createdAt).localeCompare(String(b.createdAt));
  }

  /*
   * The comments on one page, oldest first, which is the order its pins are
   * numbered in.
   *
   * Keyed on the note rather than on the built URL. A URL can change under a
   * comment -- a note renamed, a homepage promoted to index.html -- and the
   * note the comment was written about does not.
   */
  function pageRows(sourcePath) {
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i] && all[i].sourcePath === sourcePath) out.push(all[i]);
    }
    out.sort(byAge);
    return out;
  }

  /** The comments on the page being read. The pins are drawn from these. */
  function mine() {
    return pageRows(SOURCE_PATH);
  }

  /** Every comment in the review, oldest first. The panel lists these. */
  function everything() {
    return all.slice().sort(byAge);
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
    /* Lucide's file, for the row that says which page a comment is on. */
    note: [
      ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" }],
      ["path", { d: "M14 2v5h6" }],
    ],
    /*
     * Lucide's app-window, for a page the build copied rather than rendered.
     *
     * A browser chrome rather than a file, because that is the difference the
     * glyph is carrying: the row above it is a note somebody wrote, and this
     * one is a page that arrived finished -- a prototype, an export, an
     * application with its own screens inside it.
     */
    app: [
      ["rect", { x: "2", y: "4", width: "20", height: "16", rx: "2" }],
      ["path", { d: "M2 9h20" }],
      ["path", { d: "M6 6.5h.01" }],
      ["path", { d: "M9 6.5h.01" }],
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
    /* Chevrons for the two arrows that walk this page's marks. */
    chevUp: [["path", { d: "m18 15-6-6-6 6" }]],
    chevDown: [["path", { d: "m6 9 6 6 6-6" }]],
    /* A plain tick for the labelled Resolve, where the bubble-and-tick of
       \`resolve\` was carrying "this is about a comment" that the button it
       now sits in says in words. */
    check: [["path", { d: "M20 6 9 17l-5-5" }]],
    /* Out of the browser, and back into it: the two halves of carrying a
       review between builds. */
    download: [
      ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
      ["path", { d: "m7 10 5 5 5-5" }],
      ["path", { d: "M12 15V3" }],
    ],
    upload: [
      ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
      ["path", { d: "m17 8-5-5-5 5" }],
      ["path", { d: "M12 3v12" }],
    ],
    /* Out of the page: the one action here that ends up somewhere else. */
    issue: [
      ["path", { d: "M15 3h6v6" }],
      ["path", { d: "M10 14 21 3" }],
      ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }],
    ],
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
  var draftPri = "medium";
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
  var panelTally = el("h2", "co-panel-tally");
  var panelMeta = el("p", "co-panel-meta");
  panelHead.appendChild(panelTally);
  panelHead.appendChild(panelMeta);
  var panelActs = el("div", "co-panel-acts");
  var sideBtn = el("button", "co-icon-btn");
  var panelClose = el("button", "co-icon-btn");
  panelClose.setAttribute("title", "Exit review mode");
  panelClose.appendChild(icon(ICONS.close));
  panelActs.appendChild(sideBtn);
  panelActs.appendChild(panelClose);
  panelHead.appendChild(panelActs);
  panel.appendChild(panelHead);

  var controls = el("div", "co-controls");
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
  controls.appendChild(filters);

  /*
   * Two orders, in one chip on the end of the filter row.
   *
   * Mark order is the default because it is the order the numbers on the
   * page are in, so the list and the pins can be read against each other;
   * it groups by page, since those numbers only count within one. Priority
   * order is for working through: one queue over the whole review,
   * answering "what is worth doing first", which the pins cannot say at all.
   *
   * The chip names the order in force rather than the one it would switch
   * to -- see the stylesheet for the three shapes this control has had and
   * why it is not a labelled pair any more.
   */
  var ORDERS = [
    ["time", "Mark order", "Grouped by page, in the order that page's pins are numbered"],
    ["priority", "Priority", "One queue across every page, blockers first"],
  ];

  var sortBtn = el("button", "co-sort");
  controls.appendChild(sortBtn);
  panel.appendChild(controls);

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

  var MODES = CAN_COMMENT
    ? [
        ["view", ICONS.cursor, "View mode \\u2014 read and click the page (V)"],
        ["comment", ICONS.bubble, "Comment mode \\u2014 click to drop a pin (C)"],
        ["review", ICONS.panel, "Review mode \\u2014 step through and resolve (R)"],
      ]
    : [
        ["view", ICONS.cursor, "View mode \\u2014 read and click the page (V)"],
        ["review", ICONS.panel, "Review mode \\u2014 read the comments (R)"],
      ];
  // The sliding chip is sized off this, so it has to be told how many stops
  // it has rather than assuming three.
  modes.setAttribute("data-modes", String(MODES.length));
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
  function hitAt(clientX, clientY) {
    var saved = host.style.display;
    host.style.display = "none";
    var node = document.elementFromPoint(clientX, clientY);
    host.style.display = saved;
    return node;
  }

  function blockAt(clientX, clientY) {
    return nearestBlock(hitAt(clientX, clientY));
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

    /*
     * Inside something that is not on screen: a dialog that has been
     * dismissed, a side panel that has slid shut, a menu that has closed --
     * whether it was hidden where it stood or taken out of the document
     * altogether. There is nowhere honest to draw this, and drawing it
     * anyway is the bug: a comment about a dialog stayed on the page after
     * the dialog was gone, over whatever the dialog had been covering. The
     * panel still lists it, under the name of the thing it is in.
     */
    if (!contextOpen(comment)) return null;

    var target = anchorFor(comment);

    /*
     * The block is in the document but not on the page being shown: it is
     * on another slide of the deck, or inside something collapsed on this
     * one. A hidden element measures as a zero box, so drawing this would
     * put the pin at the document's top-left corner -- which is precisely
     * how a deck's pins came to pile up on the first page. The panel still
     * lists it, under its own page.
     */
    if (target && !showing(target)) return null;

    if (target) {
      var box = target.getBoundingClientRect();
      var rx = typeof comment.rx === "number" ? comment.rx : 0;
      var ry = typeof comment.ry === "number" ? comment.ry : 0;
      return {
        left: box.left - base.left + rx * box.width,
        top: box.top - base.top + ry * box.height,
      };
    }

    /*
     * An anchor that was there and is not any more.
     *
     * On a page the build rendered, that means the block was rewritten:
     * there is no honest place to draw this, so it is reported in the panel
     * instead, with the text it was about.
     *
     * On a page stamped at runtime the document belongs to an application,
     * where a block's text changes for reasons that have nothing to do with
     * anyone editing it -- a counter, a filter, a field somebody typed in.
     * Dropping the pin there would mean a reviewer watching their comments
     * disappear as they used the thing they were reviewing, so the point it
     * was dropped on is shown instead. It is still reported as lost in the
     * panel, which is the honest half: the pin says where, and the panel
     * says the text it was about has changed.
     */
    if (comment.block && !STAMP_AT_RUNTIME) return null;

    /*
     * The same reasoning, for a deck that mounts one page at a time rather
     * than hiding the others: the block is not in the document at all, and
     * the point stored beside it is a point on a page that is not the one
     * on screen. Falling back to it is what put slide five's pin on slide
     * one. A comment with no view predates this and keeps the old
     * behaviour, which is the right one for the application that case was
     * written for -- a pin that stays put while a counter it was left on
     * ticks.
     */
    if (!onThisView(comment)) return null;

    /*
     * Measured off the context instead, where the pin has one and the block
     * it was on is gone.
     *
     * This is the case a stored point is worst at. A dialog is placed
     * against the viewport rather than on the page, so the document
     * coordinates of a pin inside one describe where the window happened to
     * be scrolled to when it was dropped -- and a prototype re-renders the
     * contents of a panel constantly, so a pin in one reaches here often.
     * The fraction across the context survives all of that, exactly as
     * \`rx\`/\`ry\` do for a block.
     */
    if (comment.context && typeof comment.cx === "number") {
      var holder = contextNode(comment.context);
      if (holder) {
        var area = holder.getBoundingClientRect();
        return {
          left: area.left - base.left + comment.cx * area.width,
          top: area.top - base.top + comment.cy * area.height,
        };
      }
    }

    return { left: comment.x, top: comment.y };
  }

  /*
   * A block id without its occurrence suffix.
   *
   * \`stampBlocks\` numbers blocks whose text is identical: \`H\`, \`H-1\`,
   * \`H-2\`, in document order. The hash is what the text is; the suffix is
   * only which of several identical ones this was at the moment of the
   * pass, so stripping it leaves the part that means something.
   */
  function baseOf(id) {
    var cut = id.lastIndexOf("-");
    return cut === -1 ? id : id.slice(0, cut);
  }

  /*
   * The block a comment is about, looking past a suffix that renumbered.
   *
   * The problem this solves: the suffix depends on how many identical
   * blocks sit *earlier in the document*, so a block's id changes when a
   * sibling it has nothing to do with appears or disappears. Remove the
   * first of two "Continue" buttons and the survivor restamps from \`H-1\`
   * to \`H\` -- the comment on \`H-1\` is orphaned, and nothing about the
   * block it was left on changed. On an application, where lists grow and
   * shrink on every render, this happens constantly.
   *
   * So a miss is retried against the base hash. Same hash means same tag
   * and same text, which is the whole of what the anchor ever asserted;
   * the suffix was always bookkeeping.
   *
   * **Only one candidate counts.** If two blocks with that text are still
   * on the page and unclaimed, there is no way to tell which one the
   * reviewer meant, and picking either would silently move a comment onto
   * the wrong paragraph. That case stays orphaned and is reported as the
   * ambiguity it is, rather than guessed at.
   *
   * Candidates already claimed by another comment's exact id are taken out
   * first, so two comments on two identical blocks do not both recover
   * onto the same one.
   */
  function recovered(comment) {
    if (!comment.block) return null;
    var base = baseOf(comment.block);
    var claimed = Object.create(null);
    for (var i = 0; i < all.length; i++) {
      if (all[i].block && blocks[all[i].block]) claimed[all[i].block] = true;
    }
    var found = null;
    for (var key in blocks) {
      if (!Object.prototype.hasOwnProperty.call(blocks, key)) continue;
      if (baseOf(key) !== base && key !== base) continue;
      if (claimed[key]) continue;
      // A second candidate is an ambiguity, not a better answer.
      if (found) return null;
      found = key;
    }
    return found;
  }

  /*
   * The element a comment points at, or null.
   *
   * One lookup for the pin and the warning both, so the two can never
   * disagree -- a pin drawn on a block the panel calls lost is a bug that
   * only shows up to the person using it.
   */
  function anchorFor(comment) {
    if (!comment.block) return null;
    var direct = blocks[comment.block];
    if (direct) return direct;
    var moved = recovered(comment);
    return moved ? blocks[moved] : null;
  }

  function orphaned(comment) {
    return !!comment.block && !anchorFor(comment);
  }

  /*
   * Why an anchor could not be placed, for a reviewer who has to act on it.
   *
   * "This block has been rewritten since" was the only answer, and on a
   * page that renders itself it is frequently untrue: the text is still
   * there, in two places, and the comment could not be put on either
   * without guessing. Sending somebody to look for an edit that nobody
   * made is worse than saying nothing.
   *
   * So the two cases are told apart by the thing that distinguishes them,
   * which is whether the text is still on the page at all.
   */
  function whyLost(comment) {
    if (!comment.block) return "";
    var base = baseOf(comment.block);
    var copies = 0;
    for (var key in blocks) {
      if (!Object.prototype.hasOwnProperty.call(blocks, key)) continue;
      if (baseOf(key) === base || key === base) copies++;
    }
    return copies > 1
      ? "Anchor lost: this text is now on the page more than once, so the comment could not be placed."
      : "Anchor lost: this block has been rewritten since.";
  }

  /*
   * Whether any comment's anchor has found or lost its block since the last
   * time this was asked.
   *
   * The panel decides \`lost\` once, when it builds a row. On a page the
   * build rendered that is the end of it, because the document never
   * changes underneath. On a page that renders itself the document changes
   * constantly, and the row's answer goes stale the moment the application
   * mounts -- so the restamp path asks this, and redraws only when the
   * answer somebody is looking at has actually stopped being true.
   *
   * A signature rather than a count: two comments, one finding its block in
   * the same pass as the other loses its own, is a change the panel has to
   * show and a count would miss.
   *
   * Only anchored comments are in it. A comment about the page as a whole
   * has no block to lose and would add a constant to every signature.
   *
   * Erring towards a redraw is deliberate. Another path may have rebuilt
   * the panel without asking -- \`viewTurned\` and \`contextsTurned\` both do
   * -- which leaves this holding an older signature and costs one redundant
   * redraw the next time something moves. The opposite error is the bug
   * this exists to fix.
   */
  var lastAnchors = null;

  function anchorsChanged() {
    var parts = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].block) parts.push(all[i].id + (anchorFor(all[i]) ? "1" : "0"));
    }
    var now = parts.join(",");
    if (now === lastAnchors) return false;
    lastAnchors = now;
    return true;
  }

  /*
   * A comment's number on its own page, counting from one in the order the
   * comments were made. The pin, the panel row and the popup all read it
   * from here, so a mark is the same number wherever it is seen.
   *
   * The comment's page, not this one: the panel lists the whole review, and
   * a comment from another page has to show the number it wears over there
   * rather than a position in a list it is only visiting.
   */
  function markNumber(comment) {
    var rows = pageRows(comment.sourcePath);
    for (var i = 0; i < rows.length; i++) if (rows[i].id === comment.id) return i + 1;
    return 0;
  }

  /* --- the other pages ---------------------------------------------- */

  function elsewhere(comment) {
    return comment.sourcePath !== SOURCE_PATH;
  }

  /*
   * Whether a row can lead anywhere.
   *
   * A comment carries the page it was left on, but one written into the
   * review file by hand may not, and a link built from a missing page is a
   * link to this page's own folder. So a row without one is listed and
   * labelled like any other and simply does not go anywhere: it is still the
   * reviewer's note, and a dead link would be a worse answer than none.
   */
  function reachable(comment) {
    return elsewhere(comment) && !!comment.page;
  }

  /*
   * The file a comment is held against, which is what names its page.
   *
   * The note rather than the built URL, for the reason \`pageRows\` keys on
   * the same thing: a URL can change under a comment and the file it was
   * written about does not.
   */
  function pageKey(comment) {
    return comment.sourcePath || comment.page || "";
  }

  /** A path as segments, with the extension off the last one. */
  function keyParts(key) {
    var parts = String(key).split("/");
    var out = [];
    for (var i = 0; i < parts.length; i++) if (parts[i]) out.push(parts[i]);
    if (!out.length) return [];
    out[out.length - 1] = out[out.length - 1].replace(/\\.(md|html?)$/i, "");
    return out;
  }

  /** The last \`take\` segments of a path, joined. */
  function tail(parts, take) {
    return parts.slice(Math.max(0, parts.length - take)).join("/");
  }

  /*
   * Filenames that name nothing on their own.
   *
   * \`index\` is the one that matters and the rest are the same mistake by
   * other spellings. Every application built for the web produces one, so a
   * review of a site that publishes four of them had four pages called
   * "index" and no way to tell which thread was about which -- and the
   * folder above each one is exactly what a person calls them: the React
   * one, the Angular one, the demo.
   *
   * So a page with one of these names is always qualified by its folder,
   * whether or not anything else in the review shares the name. One "index"
   * in a list is no clearer than four: it still does not say what it is the
   * index of.
   */
  var VAGUE = {
    index: 1,
    home: 1,
    main: 1,
    app: 1,
    page: 1,
    readme: 1,
    "default": 1,
    untitled: 1,
  };

  /*
   * What to call each page in the review.
   *
   * The shortest tail of its path that no other page in the review wears --
   * the filename alone where that is enough, \`charts/trend\` where it is
   * not. It is computed over the whole review rather than per comment,
   * because being ambiguous is not a property of a page: it is a property of
   * a page sitting in a list beside another one.
   *
   * This is the same rule an editor uses for two tabs with one name, and it
   * is right here for the same reason. A filename is what the reviewer knows
   * a note as, so paying path segments for every row would be a panel full
   * of folders nobody needed; paying them only where the name does not
   * decide is a label that is as short as it can be and still true.
   */
  var labels = Object.create(null);

  function relabel(rows) {
    var keys = [];
    var parts = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
      var key = pageKey(rows[i]);
      if (parts[key] === undefined) {
        parts[key] = keyParts(key);
        keys.push(key);
      }
    }

    labels = Object.create(null);
    for (var k = 0; k < keys.length; k++) {
      var mine_ = parts[keys[k]];
      if (!mine_.length) {
        labels[keys[k]] = "Untitled";
        continue;
      }
      // A vague filename starts one folder up, so it is qualified even when
      // it is the only one of its name here.
      var from = VAGUE[mine_[mine_.length - 1].toLowerCase()] && mine_.length > 1 ? 2 : 1;
      var label = tail(mine_, mine_.length);
      for (var take = from; take <= mine_.length; take++) {
        var candidate = tail(mine_, take);
        var clash = false;
        for (var o = 0; o < keys.length; o++) {
          if (o === k) continue;
          // The other page's tail at the same depth, or all of it when it is
          // shallower -- a shorter path cannot collide with a longer tail.
          if (tail(parts[keys[o]], take) === candidate) clash = true;
        }
        if (!clash) {
          label = candidate;
          break;
        }
      }
      labels[keys[k]] = label;
    }
  }

  /*
   * What to call the page a comment is on.
   *
   * Read from the labels computed over the review. The fallback is the bare
   * filename, for a caller that asks before the panel has been drawn: a
   * label that is ambiguous is better than no label at all.
   */
  function pageName(comment) {
    var key = pageKey(comment);
    if (labels[key]) return labels[key];
    var parts = keyParts(key);
    return parts.length ? parts[parts.length - 1] : "Untitled";
  }

  /*
   * Whether a page is one the build rendered or one it copied as it found it.
   *
   * The file's own extension says it: a note is Markdown, and a page
   * published as-is is the \`.html\` file somebody put in the vault. It is
   * worth a different glyph in the panel because the two are different
   * things to go and look at -- one is a note to edit, the other is an
   * application to open -- and because it is the as-is pages that collide by
   * name, so the icon is also a hint about why a row carries a folder.
   */
  function pageKind(comment) {
    return /\\.html?$/i.test(pageKey(comment)) ? "app" : "note";
  }

  /*
   * Which screen of an application a comment was left on, in as few
   * characters as say it.
   *
   * \`route\` is the whole address the pin was dropped at, which is mostly the
   * path to the page -- and the page is already named beside it. What is left
   * once that is taken away is the part that differs between two threads on
   * one published file: the fragment a hash router writes, the query a
   * framework reads, or the last path segment where routing is done on the
   * path.
   *
   * Empty for a page the build rendered, which has no screens, and for an
   * application sitting on its own entry point, where there is no second
   * screen to be told apart from.
   */
  function screenName(comment) {
    var route = comment.route ? String(comment.route) : "";

    /*
     * The deck's page first, where there is one.
     *
     * It beats the address bar because it cannot be wrong: a view is only
     * ever recorded for a document that really was a deck, and it names the
     * page that really was on screen. What is in the address bar may be a
     * router's answer or may be noise -- a cache-busting query, a tracking
     * parameter, the fragment of a heading somebody linked -- and nothing
     * here can tell those apart. Tried the other way round first, and a
     * deck opened with a \`?\` on the end of its URL labelled every comment
     * in it with that query instead of the slide it was left on.
     */
    /*
     * The deck's page, then -- only while it is shut -- the thing on the
     * page the comment is inside.
     *
     * The context earns a place here for one reason: it is the only answer
     * to "why is there no pin for this row". A closed dialog's comments are
     * listed like any others and draw nothing, and without the name of the
     * dialog beside them that reads as the overlay having lost them.
     *
     * And only while it is shut, which is the other half. A context is the
     * nearest ancestor that could be named, so on a page where everything
     * sits in one wrapper that is the wrapper -- true, useless, and on
     * every row. Naming it only when it is closed says the one thing the
     * reviewer cannot see for themselves, and says nothing the rest of the
     * time. \`contextOpen\` is read live rather than stored, and the panel is
     * redrawn when the answer changes -- see \`contextsTurned\`.
     */
    var where = [];
    if (comment.view) where.push(viewLabel(comment.view));
    if (contextClosed(comment)) {
      where.push(viewLabel(comment.context) + " (closed)");
    }
    if (where.length) return where.join(" / ");

    // A router's own address, which for a page that is not a deck is the
    // one thing that separates two threads on it.
    if (route) {
      var at = route.search(/[?#]/);
      if (at !== -1) return route.slice(at);
    }

    // Routing done on the path, where the last segment is the screen and
    // the file it sits in is already named beside this.
    if (route) {
      var parts = route.split("/");
      var last = parts[parts.length - 1];
      var file = String(pageKey(comment)).split("/").pop();
      if (last && last !== file) return "/" + last;
    }

    return "";
  }

  /*
   * A link from here to another page, aimed at one comment on it.
   *
   * Relative, because a preview is opened two ways -- served by the plugin,
   * or straight off disk -- and only a relative href works in both. The
   * depth comes from this page's own URL, which is the one thing a page
   * knows about where it sits in the site. Each segment of the target is
   * encoded, since a note may be called anything a filesystem allows.
   */
  function pageHref(comment) {
    var depth = PAGE.split("/").length - 1;
    var up = "";
    for (var i = 0; i < depth; i++) up += "../";
    var parts = String(comment.page || "").split("/");
    for (var j = 0; j < parts.length; j++) parts[j] = encodeURIComponent(parts[j]);
    return up + parts.join("/") + "?" + DEEP_PARAM + "=" + encodeURIComponent(comment.id);
  }

  /* --- pins --------------------------------------------------------- */

  function renderPins() {
    clear(pins);
    var rows = mine();

    for (var i = 0; i < rows.length; i++) {
      var comment = rows[i];
      // A comment from another screen of the same application: its pin
      // belongs over there, and drawing it here would put it over whatever
      // happens to be in the same place now.
      if (!onThisRoute(comment)) continue;
      // And the same for a deck, whose pages one URL cannot tell apart.
      if (!onThisView(comment)) continue;
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
      // \`markNumber\` rather than this loop's index, so a mark keeps the
      // number the panel gives it even when the screen shows only some of
      // the page's comments. The two were the same list until routes.
      pin.appendChild(el("span", null, String(markNumber(comment))));
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
  function queued(rows) {
    return rows.slice().sort(function (a, b) {
      var by = priRank(a.priority) - priRank(b.priority);
      if (by !== 0) return by;
      return byAge(a, b);
    });
  }

  /*
   * The comments split by the page they are on, the page being read first
   * and the rest by name.
   *
   * Mark order is a per-page order -- it is the numbers on the pins -- so a
   * flat list of every page's comments in it would run 1, 2, 1, 2, 3 with
   * nothing saying why. Grouping is what makes the order mean something
   * again: inside a group it is the order that page's pins are numbered in,
   * and this page leads because its pins are the ones on screen.
   */
  function groupByPage(rows) {
    var groups = [];
    var at = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
      var key = pageKey(rows[i]);
      if (at[key] === undefined) {
        at[key] = groups.length;
        groups.push({
          key: key,
          here: key === SOURCE_PATH,
          name: pageName(rows[i]),
          kind: pageKind(rows[i]),
          url: rows[i].page || "",
          rows: [],
        });
      }
      groups[at[key]].rows.push(rows[i]);
    }
    groups.sort(function (a, b) {
      if (a.here !== b.here) return a.here ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return groups;
  }

  /*
   * A group's heading: what the page is, what it is called, and how many.
   *
   * The glyph is the kind, which is the part a heading cannot say in words
   * at this size -- a note to edit or a page that was copied in whole. The
   * page being read is still "This page" rather than its name, because it is
   * the one group that needs no identifying; the glyph beside it is not
   * redundant even there, since an application published as-is and a note
   * look identical from inside the panel.
   *
   * The title carries both the vault path and the published URL. That is the
   * long answer to "which index is this", and a heading narrow enough to
   * ellipsis is exactly where somebody will go looking for it.
   */
  function groupHead(group) {
    var head = el("div", "co-group");
    head.setAttribute("data-kind", group.kind);
    if (group.here) head.setAttribute("data-here", "");
    head.setAttribute("title", group.url ? group.key + "\\n" + group.url : group.key);
    head.appendChild(icon(ICONS[group.kind === "app" ? "app" : "note"], 11));
    head.appendChild(el("span", "co-group-name", group.here ? "This page" : group.name));
    head.appendChild(el("span", "co-group-count", String(group.rows.length)));
    return head;
  }

  /*
   * What the list says when it has nothing to show, which depends on whether
   * there is nothing or merely nothing matching.
   *
   * Said of the whole review rather than of this page, since that is what the
   * panel now lists: "all clear" with four open comments one page over would
   * be a lie told confidently.
   */
  function emptyState(total) {
    var empty = el("div", "co-empty");
    empty.appendChild(icon(ICONS.bubble, 26));
    if (!total) {
      empty.appendChild(el("div", "co-empty-title", "Nothing marked yet"));
      empty.appendChild(
        el("div", "co-empty-text", "Press C, then click the words you want to say something about.")
      );
    } else if (filter === "open") {
      empty.appendChild(el("div", "co-empty-title", "All clear"));
      empty.appendChild(
        el("div", "co-empty-text", "Every mark in this review has been dealt with.")
      );
    } else {
      empty.appendChild(el("div", "co-empty-title", "Nothing resolved yet"));
      empty.appendChild(
        el("div", "co-empty-text", "Marks you resolve are kept here rather than deleted.")
      );
    }
    return empty;
  }

  /*
   * The panel, which lists the whole review rather than the page it is open
   * on.
   *
   * It used to show this page's comments only, which made it a second way of
   * reading the pins already on screen. The thing a reviewer actually wants
   * from a list is the part they cannot see: what is still open on the nine
   * pages they are not looking at. So the counts, the filters and the rows
   * are all over every page, and a row belonging to somewhere else is a link
   * to that page rather than to a pin that is not here.
   */
  /*
   * The second line of the head: how far the review reaches, and how fresh.
   *
   * The pages are counted over the whole review rather than this page, for
   * the reason the panel lists the whole review: what a reviewer cannot
   * already see is the part worth saying out loud. The newest mark is the
   * last of \`rows\`, which arrives oldest first.
   */
  function panelSummary(rows) {
    var keys = [];
    for (var i = 0; i < rows.length; i++) {
      var key = pageKey(rows[i]);
      if (keys.indexOf(key) === -1) keys.push(key);
    }
    var said = "Across " + count(keys.length, "page");
    var last = rows.length ? when(rows[rows.length - 1].createdAt) : "";
    return last ? said + " \u00b7 last mark " + last : said;
  }

  function renderPanel() {
    var rows = everything();
    // Before anything is labelled: which pages need a folder to tell them
    // apart is a fact about the whole list, so it is settled once per draw
    // rather than asked per row.
    relabel(rows);
    var open_ = 0;
    for (var t = 0; t < rows.length; t++) if (!rows[t].resolved) open_++;
    var tallies = [rows.length, open_, rows.length - open_];

    for (var i = 0; i < filterBtns.length; i++) {
      if (FILTERS[i] === filter) filterBtns[i].setAttribute("data-active", "");
      else filterBtns[i].removeAttribute("data-active");
      filterCounts[i].textContent = String(tallies[i]);
    }
    filterSlider.setAttribute("data-at", String(FILTERS.indexOf(filter)));

    panelTally.textContent = rows.length
      ? open_ + " open, " + (rows.length - open_) + " resolved"
      : "Nothing marked yet";
    panelMeta.textContent = panelSummary(rows);
    panelMeta.hidden = !rows.length;

    var now = sortBy === "priority" ? ORDERS[1] : ORDERS[0];
    var other = sortBy === "priority" ? ORDERS[0] : ORDERS[1];
    clear(sortBtn);
    sortBtn.appendChild(icon(ICONS.sort, 13));
    sortBtn.appendChild(el("span", null, now[1]));
    sortBtn.setAttribute("data-order", now[0]);
    sortBtn.setAttribute("title", now[2] + " \u2014 switch to " + other[1].toLowerCase());

    clear(sideBtn);
    sideBtn.setAttribute("title", side === "right" ? "Move to the left" : "Move to the right");
    sideBtn.appendChild(icon(side === "right" ? ICONS.toLeft : ICONS.toRight));

    clear(list);
    var shown = [];
    for (var j = 0; j < rows.length; j++) if (passes(rows[j])) shown.push(rows[j]);

    if (!shown.length) {
      list.appendChild(emptyState(rows.length));
      return;
    }

    if (sortBy === "priority") {
      // One queue over the whole review, so each row has to say for itself
      // which page it is on.
      var queue = queued(shown);
      for (var q = 0; q < queue.length; q++) {
        list.appendChild(panelRow(queue[q], markNumber(queue[q]), true));
      }
      return;
    }

    // Grouped, so the heading says the page and the rows need not repeat it.
    var groups = groupByPage(shown);
    for (var g = 0; g < groups.length; g++) {
      list.appendChild(groupHead(groups[g]));
      for (var r = 0; r < groups[g].rows.length; r++) {
        list.appendChild(panelRow(groups[g].rows[r], markNumber(groups[g].rows[r]), false));
      }
    }
  }

  /*
   * One row of the panel.
   *
   * showPage is set when the list is one flat queue, where a row is the only
   * thing that can say which page it belongs to. Under a group heading it is
   * off, because the heading has just said it.
   */
  function panelRow(comment, number, showPage) {
    var away = elsewhere(comment);
    var leads = reachable(comment);
    /*
     * A row for another page is a real link, not a div that navigates when
     * clicked. A pin over there cannot be opened from here, so the row's job
     * is to go to the page -- and written as an anchor it also behaves like
     * one: the browser shows where it leads, and a middle- or command-click
     * opens that page in a tab of its own, which is exactly how someone
     * works through a list of things to fix.
     */
    var row = el(leads ? "a" : "div", "co-row");
    row.setAttribute("data-comment", comment.id);
    if (comment.resolved) row.setAttribute("data-resolved", "");
    if (comment.id === selected && !away) row.setAttribute("data-selected", "");
    if (away) row.setAttribute("data-away", "");
    if (leads) {
      row.setAttribute("href", pageHref(comment));
      row.setAttribute("title", "Go to " + pageName(comment));
    }
    var lost = !away && orphaned(comment);
    if (lost) row.setAttribute("data-orphan", "");

    var card = el("div", "co-row-card");
    card.appendChild(el("span", "co-num", String(number)));

    var body = el("div", "co-row-body");

    /*
     * Where the comment is: which page, when the list is not already grouped
     * by it, and which screen of it whenever the comment names one.
     *
     * The screen is shown under a group heading too, where the page is not.
     * Grouping is by published file, and an application is one file however
     * many screens it has -- so the rows a heading gathers are exactly the
     * ones the heading cannot tell apart, and the fragment is the only thing
     * that does.
     */
    var screen = screenName(comment);
    if ((showPage && away) || screen) {
      var where = el("div", "co-row-page");
      if (showPage && away) {
        where.setAttribute("data-kind", pageKind(comment));
        where.appendChild(icon(ICONS[pageKind(comment) === "app" ? "app" : "note"], 11));
        where.appendChild(el("span", null, pageName(comment)));
      }
      if (screen) {
        var at = el("span", "co-row-screen", screen);
        // A deck's page is not in the route -- the route is the same line
        // for the whole file -- so repeating it here would answer a
        // different question than the label asks.
        // Mirrors whichever of the two the label came from, so the
        // tooltip cannot describe a different thing than the row shows.
        at.setAttribute(
          "title",
          contextClosed(comment)
            ? "Left inside " +
              viewLabel(comment.context) +
              ", which is closed -- open it to see the pin"
            : comment.view && screen === viewLabel(comment.view)
              ? "Left on this page of the deck: " + viewLabel(comment.view)
              : "Left on this screen: " + comment.route,
        );
        where.appendChild(at);
      }
      body.appendChild(where);
    }

    var name = el("div", "co-row-name");
    /*
     * Who said it, then how much they are asking for, then -- pushed to the
     * far edge -- when. A row answers in the order the questions are asked,
     * and the timestamp is the one part nobody reads deliberately, so it
     * sits in a column of its own at the right rather than in the middle of
     * the line where it pushes the pills about as the dates age.
     */
    name.appendChild(el("strong", null, comment.author || "Anonymous"));
    /*
     * How much it is asking for, beside the name.
     *
     * It spent a while in the foot against the quote, which read well on
     * its own and badly beside the popup: that card puts the level in its
     * title bar, at the top, and a reviewer moving between the list and the
     * card should not have to look in two different places for the same
     * fact. So the list says it where the card says it.
     *
     * Only when it is one: a chip on every row saying "MEDIUM" is a word
     * the eye reads past on every row to find the two that are not.
     */
    if (comment.priority !== "medium") {
      var level = el("span", "co-row-pri");
      level.setAttribute("data-level", comment.priority);
      level.setAttribute("title", PRI[comment.priority].label + " priority");
      level.appendChild(el("span", "co-pri-mark", PRI[comment.priority].mark));
      level.appendChild(el("span", null, PRI[comment.priority].label));
      name.appendChild(level);
    }
    /*
     * Who wrote a comment without reading the page, which nothing else in a
     * row says.
     */
    if (comment.agent) {
      var tag = el("span", "co-tag", "Agent");
      tag.setAttribute("title", "Filed by " + comment.agent);
      name.appendChild(tag);
    }
    /*
     * A comment that came in from a file rather than from this browser.
     *
     * Worth saying for the same reason the agent pill is: the author field
     * carries a name either way, and a name does not say whether the person
     * was looking at this build. An imported comment may have been written
     * against a different one, which is the difference between "this is
     * wrong" and "this was wrong when they read it".
     */
    if (comment.imported) {
      var came = el("span", "co-tag", "Imported");
      came.setAttribute("title", "Imported from " + comment.imported);
      name.appendChild(came);
    }
    name.appendChild(el("span", "co-time", when(comment.createdAt)));
    body.appendChild(name);
    body.appendChild(el("div", "co-row-text", comment.text));

    /*
     * Where it went, and what it is about.
     *
     * The issue, if there is one: a comment someone has already turned into
     * work is a comment to read differently, and the number is how it is
     * referred to everywhere else. It sat on the top line until the
     * priority took that place; down here it is still the one thing in a
     * row that leads off the page, and it no longer competes with the name
     * for the width the dates leave over.
     *
     * The quote on every row that has one, because a list of the whole
     * review is read without the pins beside it -- a comment on another page
     * is read here and nowhere else, so the row has to say what it points at.
     */
    var foot = el("div", "co-row-foot");
    if (comment.external) {
      var filed = el("a", "co-tag", issueMark(comment.external));
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
      foot.appendChild(filed);
    }
    // Not on an orphan: the warning underneath shows the same text, and the
    // point of showing it there is that it is all that is left of the anchor.
    if (comment.blockText && !lost) {
      foot.appendChild(el("span", "co-quote", comment.blockText));
    }
    if (foot.childNodes.length) body.appendChild(foot);

    var meta = [];
    if (comment.replies.length) {
      meta.push(comment.replies.length + (comment.replies.length === 1 ? " reply" : " replies"));
    }
    if (comment.resolved) meta.push("Resolved");
    if (meta.length) body.appendChild(el("div", "co-row-meta", meta.join(" \\u00b7 ")));

    if (lost) {
      body.appendChild(el("div", "co-warn", whyLost(comment)));
      if (comment.blockText) body.appendChild(el("div", "co-quote", comment.blockText));
    }

    card.appendChild(body);
    row.appendChild(card);
    // Only this page's rows get a handler. The others are links, and the
    // overlay on the page they land on opens the comment they named.
    if (!away) {
      // Through \`goToMark\`, not straight to the card. These three lines
      // were the whole of what a row did, which is why a row for a comment
      // on another page of a deck opened its card over the page being read:
      // the one thing it never did was go there.
      row.addEventListener("click", function () {
        goToMark(comment);
      });
    }
    return row;
  }

  /* --- the popup ---------------------------------------------------- */

  var editing = null;
  var selectedContextOpen = true;

  function openPopup(id) {
    var comment = byId(id);
    if (!comment) return;
    selected = id;
    editing = null;
    /*
     * Whether the thing this comment is in was open at the moment the card
     * was opened, so that the card can follow it shut.
     *
     * A latch rather than a live question, because the two cases have to be
     * told apart: a dialog dismissed while its comment is being read, which
     * should take the card with it, and a comment deliberately opened from
     * the panel while its dialog is closed, which should stay open and be
     * readable. Both look identical to a check made after the fact.
     */
    selectedContextOpen = contextOpen(comment);
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
    var siblings = pageRows(comment.sourcePath);

    /*
     * Which mark this is, out of how many the page has. The first number is
     * the pin's own -- both are a comment's place in its page by age -- so
     * the card, the pin under it and the panel row all say the same thing,
     * and the arrows beside it walk the same order the pins are numbered in.
     */
    var pos = el("span", "co-pop-pos");
    pos.appendChild(document.createTextNode(String(markNumber(comment))));
    pos.appendChild(el("span", null, " of " + siblings.length));
    head.appendChild(pos);

    /*
     * The priority, said and set in the same place. A pill that showed a
     * value but needed a menu somewhere else to change it is two things to
     * learn where one would do, and this is the only popup the comment has.
     */
    // A span rather than a button where nothing here may be changed: a
    // control that opens a menu to set a value, on a build that cannot set
    // it, is worse than the plain statement of the value.
    var priBtn = el(CAN_COMMENT ? "button" : "span", "co-pri");
    priBtn.setAttribute("data-level", comment.priority);
    priBtn.setAttribute("title", "Priority: " + PRI[comment.priority].label);
    priBtn.appendChild(el("span", "co-pri-mark", PRI[comment.priority].mark));
    priBtn.appendChild(el("span", null, PRI[comment.priority].label));
    if (CAN_COMMENT) {
      priBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        togglePriMenu(comment, priBtn);
      });
    }
    head.appendChild(priBtn);

    var acts = el("div", "co-pop-acts");

    /*
     * The arrows walk the whole review, not only this page.
     *
     * A reviewer stepping through what they marked is working through a
     * list, and that list does not end at the foot of a page -- it ended
     * there only because the arrows were built from the page's own pins. The
     * last mark on a page was a dead end with more of the review still
     * waiting behind it, and the only way on was the panel.
     *
     * Where the next mark is on another page the step is a navigation, and
     * the title says so before it is pressed: leaving the page is a bigger
     * thing than moving down it, and an arrow that does it silently is an
     * arrow that loses the reviewer's place.
     */
    var queue = reviewOrder();
    var behind = neighbour(comment, -1, queue);
    var ahead = neighbour(comment, 1, queue);

    var prevBtn = el("button", "co-pop-btn");
    prevBtn.setAttribute("title", stepTitle(behind, "Previous"));
    prevBtn.appendChild(icon(ICONS.chevUp));
    prevBtn.addEventListener("click", function () {
      stepMark(-1);
    });

    var nextBtn = el("button", "co-pop-btn");
    nextBtn.setAttribute("title", stepTitle(ahead, "Next"));
    nextBtn.appendChild(icon(ICONS.chevDown));
    nextBtn.addEventListener("click", function () {
      stepMark(1);
    });

    // One mark in the whole review is not a queue, and an arrow that can
    // only land where it started is a control that lies about having
    // somewhere to go. Each side is asked separately, because a review of
    // two has one of each and neither arrow should be dead.
    if (!behind) prevBtn.disabled = true;
    if (!ahead) nextBtn.disabled = true;

    // Which page the step leaves for, for a reader rather than a pointer.
    if (behind && elsewhere(behind)) prevBtn.setAttribute("data-away", "");
    if (ahead && elsewhere(ahead)) nextBtn.setAttribute("data-away", "");

    var closeBtn = el("button", "co-pop-btn");
    closeBtn.setAttribute("title", "Close");
    closeBtn.appendChild(icon(ICONS.close));
    closeBtn.addEventListener("click", closePopup);

    acts.appendChild(prevBtn);
    acts.appendChild(nextBtn);
    acts.appendChild(closeBtn);
    head.appendChild(acts);
    popup.appendChild(head);

    /*
     * What the comment is attached to, above the comment itself.
     *
     * The quote says what was marked, and it belongs above the thread
     * rather than in the title bar: a reviewer reads what the objection is
     * about before they read the objection, and a line of quoted prose
     * squeezed onto one ellipsized line between a title and three buttons
     * is not readable. The mark number that used to sit beside it is in the
     * head now, where it is also the position the arrows move through.
     */
    var sel = el("div", "co-pop-sel");
    if (comment.resolved) sel.setAttribute("data-resolved", "");
    if (lost) sel.setAttribute("data-orphan", "");
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
      note.appendChild(el("div", "co-warn", whyLost(comment)));
      if (comment.blockText) note.appendChild(el("div", "co-quote", comment.blockText));
      popup.appendChild(note);
    }

    /*
     * Why the filing did not happen, when it did not.
     *
     * Where it *did* go is the foot's own button now -- it carries the
     * issue key in the ink and leads to it -- so a row reading "Filed as
     * VP-118" under a button reading VP-118 says the same thing twice, and
     * a row reading "Filing in Linear..." under a button already saying so
     * says it twice while it is happening. A refusal has nowhere else to
     * go, so it stays here, beside the control the attempt was made from.
     */
    var pending = relaying === comment.id;
    var failed = relayError && relayError.id === comment.id ? relayError.message : "";
    if (failed) {
      var filedRow = el("div", "co-filed");
      filedRow.appendChild(el("span", "co-warn", failed));
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

    /*
     * The box to answer in, where answering is allowed at all. On a
     * published build with commenting off there is nothing to put in it,
     * and an input that discards what is typed into it is worse than no
     * input.
     */
    if (CAN_COMMENT) {
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
    }

    /*
     * The foot: every action on this comment, as words.
     *
     * Resolve and the overflow were icons in the title bar, where the one
     * button that ends a comment's life sat beside the one that merely
     * dismisses the card and looked exactly like it. Filing was a line
     * inside that overflow, so whether an issue already existed could only
     * be found by opening a menu. Down here they are a labelled primary, a
     * labelled filing button that becomes the issue it made, and a quiet
     * overflow for the two things that are neither.
     */
    var foot = el("div", "co-pop-foot");

    // Resolving steps to the next mark, because that is what is done next.
    // Reopening does not: it is a correction to this comment, and moving
    // away from it would be answering a question nobody asked.
    var onward = !comment.resolved && siblings.length > 1;
    var resolveBtn = el("button", "co-act");
    resolveBtn.setAttribute("data-primary", "");
    resolveBtn.setAttribute("title", comment.resolved ? "Reopen" : "Resolve");
    resolveBtn.appendChild(icon(ICONS.check, 15));
    resolveBtn.appendChild(
      el("span", null, comment.resolved ? "Reopen" : onward ? "Resolve & next" : "Resolve")
    );
    resolveBtn.addEventListener("click", function () {
      resolveAndNext(comment);
    });
    foot.appendChild(resolveBtn);

    /*
     * The filing action and its result, as one button.
     *
     * Once an issue exists the button becomes that issue: the key, the ink
     * stroke, and a link to it. There is no state in which it would file a
     * second issue for the same comment, which is the thing that made this
     * a menu item hidden behind a condition before.
     */
    if (comment.external) {
      var filedBtn = el("a", "co-act co-ext");
      filedBtn.setAttribute("data-filed", "");
      filedBtn.setAttribute("href", comment.external.url);
      filedBtn.setAttribute("target", "_blank");
      filedBtn.setAttribute("rel", "noreferrer noopener");
      filedBtn.setAttribute("title", "Open " + comment.external.key);
      filedBtn.appendChild(icon(ICONS.issue, 14));
      /*
       * The short name, the same one the panel's pill wears.
       *
       * A GitHub key is \`owner/repo#41\` in full, which is as wide as the
       * whole card on a repository with a real name -- and a button that
       * wide pushed the overflow menu off the end of a foot that does not
       * wrap. The repository is not the question being answered here
       * anyway: the button says there is an issue and leads to it, and the
       * full key is in the tooltip for whoever wants it.
       */
      filedBtn.appendChild(el("span", null, issueMark(comment.external)));
      foot.appendChild(filedBtn);
    } else if (TRACKER) {
      var sendBtn = el("button", "co-act");
      sendBtn.setAttribute("title", "Send to " + TRACKER);
      sendBtn.appendChild(icon(ICONS.issue, 14));
      sendBtn.appendChild(el("span", null, pending ? "Filing..." : "Send to " + TRACKER));
      if (pending) sendBtn.disabled = true;
      sendBtn.addEventListener("click", function () {
        relay(comment);
      });
      foot.appendChild(sendBtn);
    }

    if (CAN_COMMENT) {
      var moreBtn = el("button", "co-pop-btn");
      moreBtn.setAttribute("title", "More");
      moreBtn.appendChild(icon(ICONS.more));
      moreBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        togglePopMenu(comment, moreBtn);
      });
      foot.appendChild(moreBtn);
    }

    popup.appendChild(foot);

    placePopup(comment);
  }

  /*
   * Every comment in the review, in the order the arrows walk them.
   *
   * Grouped by page and ordered by age inside a page, which is the order the
   * pins are numbered in and the order the panel lists them in. Pages are
   * ordered by the name the panel shows them under.
   *
   * **The order does not depend on which page is being read.** The panel
   * hoists the current page to the top, because a list is read from the top
   * and the rows for the page in front of you are the ones you want first.
   * A walk cannot be hoisted the same way: the page would change under the
   * sequence at every step, so pressing next three times could land back
   * where it started. So this is the one ordering in the overlay that is the
   * same from every page, and stepping through a review from any comment in
   * it reaches every other one exactly once.
   *
   * Deliberately not filtered. The arrows walk the marks, and a mark exists
   * whatever the panel has been filtered to -- so stepping never skips one
   * the reviewer can see.
   */
  function reviewOrder() {
    // So \`pageName\` can answer for every row. The same set the panel labels,
    // so this computes the labels it would have computed anyway.
    relabel(all);

    var byPage = Object.create(null);
    var keys = [];
    for (var i = 0; i < all.length; i++) {
      if (!all[i]) continue;
      var key = pageKey(all[i]);
      if (byPage[key] === undefined) {
        byPage[key] = [];
        keys.push(key);
      }
      byPage[key].push(all[i]);
    }

    keys.sort(function (a, b) {
      var byName = String(labels[a] || a).localeCompare(String(labels[b] || b));
      // The key itself as a tiebreak, so two pages that happen to be called
      // the same thing still have one order rather than whichever one the
      // sort happened to leave first.
      return byName !== 0 ? byName : String(a).localeCompare(String(b));
    });

    var out = [];
    for (var k = 0; k < keys.length; k++) {
      var rows = byPage[keys[k]];
      rows.sort(byAge);
      for (var r = 0; r < rows.length; r++) out.push(rows[r]);
    }
    return out;
  }

  /*
   * Where one step from here lands, or null when there is nowhere to go.
   *
   * It walks rather than adding one, because a comment can be a mark with
   * nothing behind it: one written into the review file by hand may name no
   * page, and a step onto it would be a step that visibly did nothing. Those
   * are passed over, so an arrow either moves or is disabled -- it never
   * looks broken.
   *
   * Null when the only comment it could reach is the one already open, which
   * is what disables the arrows rather than leaving a control that can only
   * land where it started.
   */
  function neighbour(comment, step, rows) {
    var len = rows.length;
    if (len < 2) return null;

    var at = -1;
    for (var i = 0; i < len; i++) if (rows[i].id === comment.id) at = i;
    if (at === -1) return null;

    for (var n = 1; n <= len; n++) {
      var next = rows[(((at + step * n) % len) + len) % len];
      if (next.id === comment.id) return null;
      if (!elsewhere(next) || reachable(next)) return next;
    }
    return null;
  }

  /** What an arrow says it will do, which depends on where it goes. */
  function stepTitle(target, which) {
    if (!target) return which + " mark";
    return elsewhere(target)
      ? which + " mark \u2014 on " + pageName(target)
      : which + " mark on this page";
  }

  function stepMark(step) {
    var comment = selected ? byId(selected) : null;
    if (!comment) return;
    var next = neighbour(comment, step, reviewOrder());
    if (next) goToMark(next);
  }

  /*
   * The next mark on this page alone, for resolving.
   *
   * Resolving moves to what is done next, and what is done next is on the
   * page in front of you. Carrying the walk across a page boundary here
   * would mean a click on Resolve could navigate the browser, which is not
   * what that button offers to do -- the arrows are where somebody asks to
   * leave the page.
   */
  function stepWithinPage(step) {
    var comment = selected ? byId(selected) : null;
    if (!comment) return;
    var rows = pageRows(comment.sourcePath);
    if (rows.length < 2) return;
    var at = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i].id === comment.id) at = i;
    goToMark(rows[(at + step + rows.length) % rows.length]);
  }

  /*
   * Arriving at a mark, as a move rather than a cut.
   *
   * The arrows used to swap the card's contents where they stood and leave
   * the page exactly where it was, which asked the reviewer to work out
   * from scratch, every time, which words on the page the new card was
   * about -- often words that were not on screen at all. So the page comes
   * to the mark and the card travels to it: \`co-pop[data-gliding]\` in the
   * stylesheet puts a transition on the card's position for as long as the
   * step lasts, and the scroll underneath it is the browser's own smooth
   * one, so the two move together.
   *
   * Both are dropped under \`prefers-reduced-motion\`, where the honest
   * answer is to be somewhere else immediately.
   */
  var glideTimer = null;

  function glide() {
    // Nothing to glide from. A card opening for the first time rises into
    // place where it is wanted; one asked to travel would set off from
    // wherever the last one happened to be standing.
    if (popup.hidden || !moving()) return;
    popup.setAttribute("data-gliding", "");
    if (glideTimer !== null) window.clearTimeout(glideTimer);
    glideTimer = window.setTimeout(function () {
      glideTimer = null;
      popup.removeAttribute("data-gliding");
    }, 600);
  }

  /** Whether this reviewer has asked for animation at all. */
  function moving() {
    if (!window.matchMedia) return true;
    try {
      return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      return true;
    }
  }

  /**
   * Bring a mark's pin into view. False when there is no pin to bring --
   * the comment belongs to a screen this one is not showing yet.
   */
  function revealMark(comment) {
    var pin = pins.querySelector('[data-comment="' + comment.id + '"]');
    if (!pin || !pin.scrollIntoView) return false;
    pin.scrollIntoView({ behavior: moving() ? "smooth" : "auto", block: "center" });
    return true;
  }

  function goToMark(next) {
    /*
     * Another page is a navigation, whatever its route says.
     *
     * This is the order the two checks have to be in. A comment with no
     * route reads as "show this wherever its page is shown", which
     * \`onThisRoute\` answers true for -- correctly, for a mark on the page
     * being read, and disastrously for one on a different page, where it
     * would open a card over a document that has no such pin on it. The
     * page is the coarser question and is therefore asked first.
     */
    if (elsewhere(next)) {
      leaveFor(next);
      return;
    }

    /*
     * Another page of a deck, which is this document and not a navigation.
     *
     * Asked before the route, and that order matters as much as the one
     * above. Every comment in a deck carries the same route -- the deck's
     * pages were never in the address bar -- so \`onThisRoute\` says yes to
     * all of them and this used to fall straight into the branch below: the
     * card opened over whichever page happened to be up, \`revealMark\` found
     * no pin to scroll to, and nothing turned the deck. The pin the
     * reviewer had just clicked was on another page the whole time.
     */
    /*
     * The same question the pin is drawn by, so the two cannot disagree. It
     * used to be a comparison of the key, which on a prototype meant that
     * clicking a comment in a panel the reviewer could see -- open, with no
     * pin on it, because of the bug above -- asked the overlay to *turn* to
     * it, and a turn swaps visibility between siblings. On a page whose
     * siblings are two dialogs that is state nobody asked for.
     */
    if (!onThisView(next)) {
      turnToDeckPage(next);
      return;
    }

    if (onThisRoute(next)) {
      glide();
      openPopup(next.id);
      revealMark(next);
      return;
    }
    crossTo(next);
  }

  /*
   * Off to a mark on another page of this deck.
   *
   * The turn, then the redraw, then the card. \`viewTurned\` is what moves
   * the pins onto the page now showing, and it has to run here rather than
   * being waited for: the attribute watcher would get to it, in its own
   * time, and the reviewer would watch the card arrive over a page with no
   * pin on it and then the pin appear underneath a tenth of a second later.
   *
   * \`chaseMark\` afterwards for the deck that animates its turn. The pages
   * swap state immediately, so the pin is there to be scrolled to -- but a
   * deck mid-transition moves it again as the slide settles, and chasing is
   * already how the overlay waits out a screen drawing itself.
   */
  function turnToDeckPage(next) {
    var arrived = turnToView(next.view);
    // Unconditionally, not through \`viewTurned\`: the turn above has
    // already recorded the key it moved to, so the change detection would
    // find nothing changed and skip the one redraw this exists to cause.
    redrawForView();
    glide();
    openPopup(next.id);
    if (!revealMark(next) || !arrived) chaseMark(next);
  }

  /*
   * Off to a mark on another page.
   *
   * \`pageHref\` is the relative link the panel's own rows use, and it
   * carries the comment in the query so the overlay on the other side opens
   * it on arrival. The route's fragment goes on the end, after the query, so
   * a step onto a particular screen of an application lands on that screen
   * rather than on the application's first one.
   */
  function leaveFor(next) {
    // Nothing to navigate to. A comment that names no page is not a place.
    if (!reachable(next)) return;
    location.href = pageHref(next) + splitRoute(next.route).hash;
  }

  /*
   * The next mark is on another screen of the same application.
   *
   * One published file can be any number of screens, so stepping through a
   * page's marks steps across them -- and a card opened over a screen that
   * has no such pin on it is the seam this is here to close. Where the two
   * differ by the fragment alone the router is listening to the address bar
   * and will draw the other screen without a reload, so the step stays on
   * this document and waits for the pin to appear. Where they differ by
   * more than that it is a real navigation, and the comment is asked for in
   * the link: the overlay on the other side opens it on arrival.
   */
  function crossTo(next) {
    var there = splitRoute(next.route);
    var here = splitRoute(currentRoute());
    if (there.base !== here.base) {
      location.href = there.base + deepQuery(there.base, next.id) + there.hash;
      return;
    }
    glide();
    openPopup(next.id);
    location.hash = there.hash;
    chaseMark(next);
  }

  function splitRoute(route) {
    var text = String(route || "");
    var cut = text.indexOf("#");
    return cut === -1
      ? { base: text, hash: "" }
      : { base: text.slice(0, cut), hash: text.slice(cut) };
  }

  function deepQuery(base, id) {
    return (
      (base.indexOf("?") === -1 ? "?" : "&") + DEEP_PARAM + "=" + encodeURIComponent(id)
    );
  }

  /*
   * Waiting for a screen to draw itself.
   *
   * The router is told where to go by the address bar and answers in its
   * own time, and the pin cannot be scrolled to before it exists. The
   * watcher that follows the document would get there eventually; this
   * looks a little sooner and a few times over, so the step reads as one
   * movement rather than a jump and then a correction.
   */
  function chaseMark(comment) {
    var tries = 0;
    (function look() {
      // The reviewer moved on, or the card was closed while the screen was
      // still drawing. Either way nothing here is wanted any more.
      if (popup.hidden || selected !== comment.id || !byId(comment.id)) return;
      // A deck mid-transition may only settle on its new page after a frame
      // or two, so which page is up is re-asked on every look.
      checkView();
      blocks = blockIndex();
      renderPins();
      if (selected === comment.id) placePopup(comment);
      if (revealMark(comment)) return;
      if (++tries > 8) return;
      window.setTimeout(look, 70);
    })();
  }

  function resolveAndNext(comment) {
    var reopening = comment.resolved;
    comment.resolved = !comment.resolved;
    writeAll();
    render();
    if (!reopening) stepWithinPage(1);
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
     * Editing and deleting are authoring, so a build with commenting off
     * has neither -- and with the tracker's Send now a button in the foot,
     * that leaves nothing at all for this menu to hold. The button that
     * opens it is left off in that case rather than opening an empty card.
     */
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
      if (index !== -1) {
        withdraw(comment);
        all.splice(index, 1);
      }
      selected = null;
      writeAll();
      popup.hidden = true;
      render();
    });

    popMenu.appendChild(edit);
    popMenu.appendChild(remove);
    popup.appendChild(popMenu);
    // Opened upward, now that the button that opens it is in the foot: a
    // menu hung below that would fall outside a card which clips what
    // overflows it. Measured rather than guessed, since the menu's height
    // is whatever its rows come to.
    popMenu.style.top = Math.max(4, anchor.offsetTop - popMenu.offsetHeight - 4) + "px";
    popMenu.style.right = "8px";
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
        context: null,
        cx: null,
        cy: null,
      };

      /*
       * Taken from what was under the cursor rather than from the block,
       * and the two differ exactly where it matters. A point on a dialog's
       * own padding is inside the dialog and on no block at all, which is
       * the pin that used to have nothing holding it.
       */
      var hit = hitAt(clientX, clientY);
      point.context = contextOf(hit);
      if (point.context) {
        var holder = contextNode(point.context);
        if (holder) {
          var area = holder.getBoundingClientRect();
          point.cx = area.width ? (clientX - area.left) / area.width : 0;
          point.cy = area.height ? (clientY - area.top) / area.height : 0;
        }
      }

      var target = nearestBlock(hit);
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
    draftPri = "medium";
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
    // Read fresh rather than trusted from the last check: the pin is about
    // to be filtered by this value, and a stale one would hide the comment
    // the moment it was written.
    checkView();

    all.push({
      id: uid(),
      page: PAGE,
      sourcePath: SOURCE_PATH,
      block: point.block,
      blockText: point.text,
      route: currentRoute(),
      view: viewKey || null,
      context: point.context,
      x: point.x,
      y: point.y,
      rx: point.rx,
      ry: point.ry,
      cx: point.cx,
      cy: point.cy,
      author: author || "Anonymous",
      text: text,
      createdAt: new Date().toISOString(),
      resolved: false,
      priority: draftPri,
      // Left by a person, in a browser. Only a tool writing into the review
      // file ever fills this in.
      agent: null,
      imported: null,
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
    // A build with no comment mode must not be put into one by a keystroke,
    // a deep link, or anything else that calls this with a name it has no
    // button for: the capture sheet would go over the page with no visible
    // way to take it off again.
    if (next === "comment" && !CAN_COMMENT) return;
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
      // The floor is where the order row stops fitting beside its label.
      width = Math.max(260, Math.min(560, startWidth + delta));
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
      if (row.hasAttribute("disabled")) return;
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

    // The name prefills the author of a comment, so on a build where no
    // comment can be written it is a setting with nothing to set.
    if (CAN_COMMENT) {
      menu.appendChild(
        item("Change name", ICONS.user, null, function () {
          askName(function () {
            render();
          });
        })
      );
    }
    menu.appendChild(el("div", "co-menu-rule"));

    /*
     * The two halves of carrying a review somewhere else. In the settings
     * menu rather than in the panel because they are about the review as a
     * whole, not about the list the panel is showing: exporting while a
     * filter is on still writes every comment out.
     */
    var out = item("Export comments", ICONS.download, null, exportComments);
    if (!all.length) out.setAttribute("disabled", "");
    out.setAttribute(
      "title",
      all.length
        ? "Write every comment in this review to a file"
        : "Nothing to export yet"
    );
    menu.appendChild(out);
    menu.appendChild(
      item("Import comments", ICONS.upload, null, function () {
        importComments();
      })
    );

    menu.appendChild(el("div", "co-menu-rule"));
    menu.appendChild(
      item("Clear all comments", ICONS.trash, null, function () {
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
      item("Hide the overlay", ICONS.hide, "H", function () {
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
   * H takes the whole overlay off the page, pins included.
   *
   * The pins used to stay, on the reasoning that they are the comments
   * rather than the tool. In practice they are the thing most in the way:
   * the reason to press H is to look at the page as a reader will see it,
   * and a page with eleven tags hanging off its paragraphs is not that page.
   * So the hiding is done on the wrapper every visible part lives inside,
   * which means nothing can be left behind by having been forgotten here.
   *
   * The modes are still closed down on the way out rather than merely
   * covered: a capture sheet over the page with no visible way to turn it
   * off is a page that has stopped working for no stated reason, and a
   * sheet is still over it whether or not it can be seen. H brings
   * everything back, and so does the menu row that offers it, which is why
   * that row names the key.
   */
  function setHidden(next) {
    hidden = next;
    if (next) {
      closeMenu();
      closePopMenu();
      closePopup();
      setMode("view");
    }
    wrap.hidden = next;
    notch.hidden = next;
  }

  /* --- carrying a review between builds ------------------------------- */

  /*
   * Why this exists at all.
   *
   * A review lives in this browser's localStorage, and in the vault when the
   * preview is being served by the plugin. A published build has neither:
   * the site is static files on someone else's hosting, so there is nothing
   * to sync to and the comments live only in whichever browser made them.
   * Clear the site data, open the site on a laptop instead, or hand your
   * notes to the person who has to act on them, and they are gone.
   *
   * A file is the answer that needs no server. The document written here is
   * the same shape the plugin's own review file has -- \`payload()\` builds
   * both -- so an export from a published site imports into a preview, and
   * the plugin's import command reads it as it reads its own.
   */

  /** A filename a person can find again: the site, and the day. */
  function exportName() {
    var stem = squash(SITE).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    var day = new Date().toISOString().slice(0, 10);
    return "review-" + (stem || "site") + "-" + day + ".json";
  }

  /*
   * Whether what the publisher wrote down is somewhere to click or
   * somewhere to copy.
   *
   * An address and a web address are the two things anyone actually puts
   * here, and both are worth making clickable: a reader who has to retype
   * an email address out of a dialog is a reader who does not send the
   * file. Anything else is shown as the words it is.
   */
  function contactHref(value) {
    // Spelled out rather than matched with a pattern: this file is a
    // template literal, where a backslash belongs to the template before it
    // belongs to the regular expression, and two escapes deep is not where
    // anyone should have to reason about an email address.
    var low = value.toLowerCase();
    if (low.indexOf("http://") === 0 || low.indexOf("https://") === 0) return value;
    var at = value.indexOf("@");
    var dot = value.indexOf(".", at);
    if (at > 0 && dot > at + 1 && dot < value.length - 1 && value.indexOf(" ") === -1) {
      return "mailto:" + value;
    }
    return "";
  }

  function exportComments() {
    if (!all.length) return;
    var name = exportName();
    var blob = new Blob([payload()], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = name;
    // Appended before the click: a link not in the document does not
    // download in every browser, and removing it immediately after is
    // enough because the click has already been dispatched.
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Deferred, because revoking the URL in the same tick cancels the
    // download it was handed to in some browsers.
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);

    reportExport(name);
  }

  /*
   * What to do with the file, said at the moment it is saved.
   *
   * A silent download is the right behaviour for a preview, where the
   * vault already has the comments and the file is a convenience. It is
   * the wrong behaviour for a published site, where the file is the only
   * way the review reaches anybody: a reviewer who finds a .json in their
   * Downloads folder and does not know who wants it has not fed back, they
   * have made a file.
   */
  function reportExport(name) {
    openModal("Review saved", function (body) {
      body.appendChild(
        el("p", null, count(all.length, "comment") + " saved as " + name + ".")
      );

      if (CONTACT) {
        var line = el("p", null, "Send it to ");
        var href = contactHref(CONTACT);
        if (href) {
          var link = el("a", "co-ext", CONTACT);
          link.setAttribute("href", href);
          link.setAttribute("target", "_blank");
          link.setAttribute("rel", "noreferrer noopener");
          line.appendChild(link);
        } else {
          line.appendChild(el("strong", null, CONTACT));
        }
        line.appendChild(document.createTextNode("."));
        body.appendChild(line);
      }

      // Only where there is no plugin behind the page. In a preview the
      // comments are already in the vault and the file is a spare copy,
      // which is a different thing to be told.
      /*
       * The two situations are different and the note says which. On a
       * published page the file is the only copy that leaves the browser,
       * and it also says what the person receiving it should do with it --
       * the review folder is the door that puts the comments back on their
       * notes, and a file sitting in an inbox is not a review.
       */
      body.appendChild(
        el(
          "p",
          "co-modal-note",
          served
            ? "Your comments are already saved in the vault. This file is a copy to keep or pass on."
            : "Comments live in this browser only, so this file is the only copy that leaves it."
        )
      );
      if (!served) {
        body.appendChild(
          el(
            "p",
            "co-modal-note",
            "Whoever receives it can drop it in their vault's review folder and run Import review comments."
          )
        );
      }

      var done = el("button", "co-submit", "Done");
      done.addEventListener("click", closeModal);
      body.appendChild(done);
    });
  }

  /*
   * Taking a review in from a file.
   *
   * Additive, never destructive. A comment whose id this browser already
   * holds is left exactly as it is: the file may be older than what is on
   * screen, and there is no way to tell from here which copy is right. So
   * an import can only ever add, which means importing the same file twice
   * changes nothing the second time and a reviewer cannot lose work by
   * picking the wrong file.
   */
  /*
   * The page-to-note mapping the plugin holds, when there is one.
   *
   * Asked for at the moment of an import and never otherwise, so an
   * ordinary page load costs nothing. A published build has no plugin to
   * ask and gets an empty mapping, which is the right answer: there is no
   * vault on the other side of it to map into.
   */
  var PAGES_API = "/api/pages";

  function withPages(then) {
    if (!served) {
      then({});
      return;
    }
    fetch(PAGES_API, { headers: { Accept: "application/json" } })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data) {
        var pages = data && data.pages;
        then(pages && typeof pages === "object" ? pages : {});
      })
      .catch(function () {
        then({});
      });
  }

  function ingest(raw, fallbackName, pages) {
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { error: "That file is not JSON." };
    }
    if (!parsed || typeof parsed !== "object" || !parsed.comments) {
      return { error: "That file is not a review: it has no comments in it." };
    }
    if (!parsed.comments.length && !Object.prototype.hasOwnProperty.call(parsed, "comments")) {
      return { error: "That file is not a review: it has no comments in it." };
    }
    if (Object.prototype.toString.call(parsed.comments) !== "[object Array]") {
      return { error: "That file is not a review: its comments are not a list." };
    }

    var from = typeof parsed.site === "string" && parsed.site ? parsed.site : fallbackName;
    var known = Object.create(null);
    for (var i = 0; i < all.length; i++) known[all[i].id] = true;

    var added = 0;
    var already = 0;
    var unreadable = 0;
    var matched = 0;
    for (var j = 0; j < parsed.comments.length; j++) {
      var row = tidy(parsed.comments[j]);
      if (!row) {
        unreadable++;
        continue;
      }
      if (known[row.id]) {
        already++;
        continue;
      }
      /*
       * A review that came back from the published site keys its comments
       * on page URLs, because a published page must not carry vault paths.
       * Put the notes back, so the comments land on the pages they are
       * about rather than looking like they belong somewhere this build
       * has never heard of -- which is what they did before: listed under
       * a heading named after a URL, with no pin and a link that opened
       * nothing.
       */
      var note = pages && pages[row.sourcePath];
      if (note && note !== row.sourcePath) {
        row.sourcePath = note;
        matched++;
      }
      // Only on a comment that did not already name a source. One carried
      // through two imports came from wherever it was first written, and
      // saying it came from the file it most recently travelled in would
      // overwrite the true answer with a less useful one.
      if (!row.imported) row.imported = from;
      all.push(row);
      known[row.id] = true;
      added++;
    }

    if (added) {
      writeAll();
      render();
    }
    return {
      added: added,
      already: already,
      unreadable: unreadable,
      matched: matched,
      from: from,
    };
  }

  /*
   * The picker, made once and reused.
   *
   * In the shadow root but outside the overlay's own wrapper: the wrapper is
   * hidden wholesale by H, and the picker has to stay clickable from the
   * menu regardless. Not in the page's own DOM, which this overlay does not
   * write to -- the preview has to stay a faithful picture of a publish.
   */
  var picker = document.createElement("input");
  picker.setAttribute("type", "file");
  picker.setAttribute("accept", "application/json,.json");
  picker.style.display = "none";
  shadow.appendChild(picker);
  picker.addEventListener("change", function () {
    var file = picker.files && picker.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || "");
      withPages(function (pages) {
        reportImport(ingest(text, file.name, pages));
      });
      // Cleared so that picking the same file again fires another change.
      picker.value = "";
    };
    reader.onerror = function () {
      reportImport({ error: "That file could not be read." });
      picker.value = "";
    };
    reader.readAsText(file);
  });

  function importComments() {
    picker.click();
  }

  function reportImport(result) {
    openModal(result.error ? "That did not work" : "Comments imported", function (body) {
      if (result.error) {
        body.appendChild(el("p", null, result.error));
        return;
      }
      body.appendChild(
        el(
          "p",
          null,
          result.added
            ? "Added " + count(result.added, "comment") + " from " + result.from + "."
            : "Nothing new: every comment in that file is already here."
        )
      );
      var notes = [];
      // Worth saying, because it is the difference between a review that
      // landed on the pages it is about and one that merely arrived.
      if (result.matched) {
        notes.push(
          count(result.matched, "comment") + " came from the published site and were matched to their notes"
        );
      }
      // Said rather than quietly dropped: a reviewer who imports a file and
      // sees a smaller number than they expected is owed the difference.
      if (result.already) {
        notes.push(count(result.already, "comment") + " already here, left alone");
      }
      if (result.unreadable) {
        notes.push(count(result.unreadable, "row") + " could not be read");
      }
      if (notes.length) body.appendChild(el("p", "co-modal-note", notes.join(". ") + "."));
      var done = el("button", "co-submit", "Done");
      done.addEventListener("click", closeModal);
      body.appendChild(done);
    });
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

  /*
   * Clears the whole review, not only the page being looked at. The row says
   * "all", so the dialog counts what is about to go and names the part that
   * is out of sight: a reviewer should not have to find out afterwards that
   * comments on pages they were not looking at went with it.
   */
  function confirmClear() {
    var total = all.length;
    var elsewhere = total - mine().length;
    openModal("Clear all comments?", function (body) {
      body.appendChild(
        el(
          "p",
          null,
          total
            ? count(total, "comment") +
                " will be deleted, here and in the vault" +
                (elsewhere
                  ? ", including " +
                    count(elsewhere, "comment") +
                    " on other pages."
                  : ".")
            : "There are none to delete."
        )
      );
      var go = el("button", "co-submit", "Delete");
      go.setAttribute("data-danger", "");
      go.disabled = !total;
      go.addEventListener("click", function () {
        for (var i = 0; i < all.length; i++) withdraw(all[i]);
        all.length = 0;
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

    if (key === "c" && !CAN_COMMENT) return;
    if (key === "v" || key === "c" || key === "r") {
      event.preventDefault();
      setMode(key === "v" ? "view" : key === "c" ? "comment" : "review");
    }
  });

  /* --- rendering ------------------------------------------------------- */

  function render() {
    blocks = blockIndex();
    // Latched here rather than only in the watchers: a comment just written
    // may be the first one in some dialog, and the signature has to know
    // about it before the next tick calls that a change.
    checkContexts();
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

  /*
   * Except for the pins that are not scroll-invariant, which is the ones
   * anchored inside something \`fixed\` or \`sticky\` -- a modal, a drawer, a
   * bar that stays. Those move on the page precisely because they do not
   * move in the window, so they have to be re-measured as it scrolls. See
   * \`heldToViewport\`: until a pin's anchor turns out to be one of these,
   * this listener does nothing at all, and \`reposition\` is a frame apart
   * from itself whatever calls it.
   */
  window.addEventListener(
    "scroll",
    function () {
      if (sawFixed) reposition();
    },
    { passive: true },
  );
  if (window.ResizeObserver) {
    new ResizeObserver(reposition).observe(document.body);
  }

  /*
   * Marking the page again when it changes under us.
   *
   * The first marking runs the moment this script does, which for the
   * vault's own HTML is the right time and for an application is far too
   * early: nothing has rendered, so there is nothing to mark, and a pin
   * dropped afterwards anchors to no block at all. Everything an
   * application does after that -- mounting, routing, filtering, a field
   * being typed in -- replaces the nodes that were marked.
   *
   * So the marking repeats. It can, because an anchor is a hash of a
   * block's own text rather than a position, so marking the same content
   * again produces the same anchors and a pin finds its block where it left
   * it.
   *
   * Three things make this safe to leave running on somebody else's page.
   * Attributes are deliberately not watched, so our own marking cannot
   * trigger another round -- only new nodes and changed text do. The first
   * change arms a timer and the rest are ignored until it fires, so a page
   * that mutates continuously costs one pass per interval rather than one
   * per mutation. And it ends at \`reposition\`, which moves the pins and
   * leaves the panel and any half-written comment alone; a full \`render\`
   * would rebuild the draft out from under whoever was typing in it.
   */
  /*
   * One watcher per page, whatever else is going on.
   *
   * A watcher outlives the overlay that made it: it holds the document, not
   * the host element, so clearing the page leaves it running. Two copies of
   * this script on one page would then leave the first still walking the
   * document and marking blocks for an overlay nobody can see. Replacing it
   * is one line and it makes the behaviour testable, since a test starts the
   * script more than once in a document jsdom keeps between tests.
   */
  if (window.ospStampWatcher) window.ospStampWatcher.stop();
  window.ospStampWatcher = null;

  /*
   * Redrawing when the deck turns a page.
   *
   * Both halves of the overlay's idea of a page have to be rechecked here,
   * and neither used to be. A full \`render\` is deliberately not called: it
   * rebuilds the popup, and a reviewer reading a comment while the deck
   * animates should not have the card torn out from under them. The pins
   * move and the panel regroups, which is the whole of what a page turn
   * changes.
   */
  function redrawForView() {
    blocks = blockIndex();
    checkContexts();
    renderPins();
    renderPanel();
  }

  function viewTurned() {
    if (!checkView()) return false;
    redrawForView();
    return true;
  }

  /*
   * Redrawing when a dialog, a panel or a menu opens or closes.
   *
   * The sibling of \`viewTurned\`, for the half of a prototype the deck
   * signature cannot see. Nothing in the document announces this either, so
   * it is noticed the same way: a key naming which of the contexts
   * comments were left in are on screen, compared with the last one.
   *
   * The card goes with the pin. A reviewer reading a comment about a dialog
   * that is then dismissed is left holding a card pointing at nothing, and
   * the honest thing is for it to close with the thing it was about -- but
   * only when it was open to begin with, which is what the latch in
   * \`openPopup\` is for.
   */
  function contextsTurned() {
    if (!checkContexts()) return false;

    blocks = blockIndex();
    var open = selected ? byId(selected) : null;
    if (open && selectedContextOpen && !contextOpen(open)) {
      // Draws the pins and the panel itself.
      closePopup();
      return true;
    }

    renderPins();
    renderPanel();
    return true;
  }

  /*
   * A router that answers the address bar, noticed when it answers.
   *
   * \`onThisRoute\` has filtered by \`location\` since routes existed, but
   * nothing ever told it to look again: the only way a navigation got
   * redrawn was the stamping timer below happening to fire because the
   * router had also changed the DOM. A hash-routed deck that moves by CSS
   * alone changes no nodes at all, so its pins never re-filtered.
   */
  if (STAMP_AT_RUNTIME) {
    var navigated = function () {
      checkView();
      blocks = blockIndex();
      renderPins();
      renderPanel();
    };
    window.addEventListener("hashchange", navigated);
    window.addEventListener("popstate", navigated);
  }

  if (STAMP_AT_RUNTIME && window.MutationObserver) {
    var restamp = null;
    var watcher = new MutationObserver(function () {
      // A record queued before the page was navigated away from, delivered
      // after it was: there is no window left to arm a timer on.
      if (typeof window === "undefined" || !window) return;
      if (restamp !== null) return;
      restamp = window.setTimeout(function () {
        restamp = null;
        stampBlocks();
        blocks = blockIndex();
        // A page turn that replaced the nodes rather than restyling them.
        if (!viewTurned() && !contextsTurned()) {
          reposition();
          /*
           * The panel's own copy of what \`reposition\` has just corrected.
           *
           * A pin is drawn from \`blocks\` every time it moves, so it was
           * always right. A panel row is not: \`lost\` is decided when the
           * row is built, and this path rebuilt neither the row nor the
           * popup -- so on a page that renders itself, the panel kept
           * whatever it decided before the application had mounted.
           *
           * That is the whole of "Anchor lost" appearing on a block that is
           * plainly on the screen. The overlay runs while \`<app-root>\` is
           * still empty, so the first stamp marks nothing and every
           * anchored comment is an orphan; the application then renders,
           * this timer re-stamps, and nothing told the panel. Leaving the
           * page and coming back rebuilt it from current state and the
           * warning went; the next route change emptied the document and
           * brought it back.
           *
           * Redrawn only when an anchor actually changed state, which keeps
           * the reason this path avoided \`renderPanel\` in the first place:
           * an application that mutates continuously must not have its
           * review panel rebuilt on a timer.
           */
          if (anchorsChanged()) renderPanel();
        }
      }, 150);
    });
    watcher.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    /*
     * The second watcher, for the page turn that is one class name.
     *
     * The watcher above cannot do this job. It must not look at attributes
     * at all -- it marks blocks, marking sets an attribute, and watching
     * attributes would have it wake itself forever -- and a deck that shows
     * one slide at a time turns the page by writing exactly one attribute.
     *
     * So this one watches attributes and only the ones a deck toggles, by
     * name. \`data-osp-block\` is not among them, which is what keeps the two
     * from feeding each other: our own marking cannot wake either watcher.
     *
     * It is also nearly free on a page that does none of this. A turn is
     * only a turn if the key changed, so a class animating every frame
     * costs one scan per interval and no redraw at all.
     */
    var recheck = null;
    var viewWatcher = new MutationObserver(function () {
      if (typeof window === "undefined" || !window) return;
      if (recheck !== null) return;
      recheck = window.setTimeout(function () {
        recheck = null;
        /*
         * \`reposition\` at the end, which the deck half of this never
         * needed. A pin inside something that hides in place is suppressed
         * by \`showing\` whether or not anything can name what it is in, and
         * without a redraw it is suppressed only the next time something
         * else repaints. It costs one pass over the pins per interval on a
         * page that animates, which is what that function is for.
         */
        if (!viewTurned() && !contextsTurned()) reposition();
      }, 120);
    });
    viewWatcher.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: [
        "class",
        "style",
        "hidden",
        "open",
        "aria-hidden",
        "aria-selected",
        "aria-current",
        "aria-expanded",
        "data-active",
        "data-state",
        "data-current",
        "data-visible",
      ],
    });
    // Disconnecting is not enough on its own: a pass already armed would
    // still fire afterwards, through this instance's closure, and mark the
    // document for an overlay that had been replaced.
    window.ospStampWatcher = {
      stop: function () {
        watcher.disconnect();
        viewWatcher.disconnect();
        if (restamp !== null) {
          window.clearTimeout(restamp);
          restamp = null;
        }
        if (recheck !== null) {
          window.clearTimeout(recheck);
          recheck = null;
        }
      },
    };
  }

  /* --- arriving from another page's panel ---------------------------- */

  /*
   * The comment a link asked for, if a link asked for one.
   *
   * Tried twice. Once now, for a comment this browser already holds, and
   * again when the vault answers, for one it does not: a review opened on a
   * second machine, or in a browser whose storage has been cleared, has its
   * comments in the file and nowhere else, and the row that was clicked was
   * drawn from exactly that. It is cleared once it has been honoured, so a
   * reviewer who has started reading something else is not pulled back to
   * it by a request that has already been met.
   */
  var wanted = askedFor();

  function askedFor() {
    var query = String(location.search || "");
    var at = query.indexOf(DEEP_PARAM + "=");
    if (at === -1) return "";
    var raw = query.slice(at + DEEP_PARAM.length + 1).split("&")[0];
    try {
      return decodeURIComponent(raw);
    } catch (e) {
      return raw;
    }
  }

  function showWanted() {
    if (!wanted) return;
    var comment = byId(wanted);
    // Not here: either the id is stale, or it names a comment on a third
    // page. Neither is worth saying anything about -- the page is the page
    // the reviewer asked for either way.
    if (!comment || elsewhere(comment)) return;
    wanted = "";
    // In review mode, because that is the mode they left: the panel they
    // clicked the row in should still be open when they arrive.
    setMode("review");
    openPopup(comment.id);
    revealMark(comment);
  }

  setMode("view");
  showWanted();
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
