/**
 * Edit mode's Insert palette, as it runs in the browser. Spliced into
 * `EDIT_SCRIPT`'s closure after the panel.
 *
 * The bar's Insert opens a palette above the bar of what the page is
 * already made of: its text styles (an h1 like "Pick a plan", a price like
 * "$0") and its components (a plan card, a button, a quote), each shown as
 * a live preview. It is found from the page, never set up: a component is
 * something interactive, something with a component-ish class, or a layer
 * that holds others and appears more than once.
 *
 * The list leads with what is used where the selection is, "In Plan card",
 * so the usual next thing is first. The rest sits in categories worked out
 * from what each thing is (Headings, Body, Small text; Buttons, Cards,
 * Lists & content, Forms, Navigation, Badges & media), then the plain
 * Basics that Insert has always had. Search covers all of it.
 *
 * A click adds one by the selection: a component beside its own kind when
 * the selection is inside one. A drag places it where it is let go, with
 * the drop line moving layers already shows. A text style or component is
 * a copy of the page's own element, the same edit Alt-drag makes, so it
 * keeps the page's classes and follows the page's stylesheet; a basic is
 * today's insert.
 *
 * Raw string, like the other chunks: no backtick, and no dollar sign
 * followed by a brace.
 */
export const EDIT_ASSETS = String.raw`
  /* --- the Insert palette ---------------------------------------------- */

  var assetsOpen = false;
  /* The category shown: "here", one of ASSET_CATS's ids, or "basics". */
  var assetCat = "here";
  var assetQuery = "";
  /* What the palette was last drawn for, so a refresh redraws only on a change. */
  var assetSig = "";
  /* Ends the drag under way: the drop, from wherever the release lands. */
  var assetDrop = null;
  /* The last page reading, kept for the search box between redraws. */
  var assetList = [];

  var ASSET_CATS = [
    ["Text", [["headings", "Headings"], ["body", "Body"], ["small", "Small text"]]],
    ["Components", [["buttons", "Buttons"], ["cards", "Cards"], ["lists", "Lists & content"], ["forms", "Forms"], ["nav", "Navigation"], ["badges", "Badges & media"]]],
    ["", [["basics", "Basics"]]],
  ];
  var ASSET_NAMES = {};
  ASSET_CATS.forEach(function (g) {
    g[1].forEach(function (c) {
      ASSET_NAMES[c[0]] = c[1];
    });
  });

  /* Never offered: the page's frame, and what holds no look of its own. */
  var NOT_ASSET = {
    HTML: 1, HEAD: 1, BODY: 1, MAIN: 1, HEADER: 1, FOOTER: 1, SECTION: 1, ARTICLE: 1, ASIDE: 1,
    SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, TITLE: 1, TEMPLATE: 1, NOSCRIPT: 1, BR: 1, WBR: 1,
    OPTION: 1, OPTGROUP: 1, SOURCE: 1, TRACK: 1, TBODY: 1, THEAD: 1, TFOOT: 1, TR: 1, TD: 1, TH: 1,
    LI: 1, DT: 1, DD: 1, SUMMARY: 1, LEGEND: 1, PICTURE: 1, svg: 1, SVG: 1, PATH: 1, IFRAME: 1,
  };
  /* Always a component, once on the page. */
  var ASSET_TAGS = { BUTTON: 1, A: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, UL: 1, OL: 1, DL: 1, DETAILS: 1, NAV: 1, FORM: 1, IMG: 1, HR: 1, LABEL: 1, TABLE: 1, FIGURE: 1 };
  /* Words in these are a component's, not a text style. */
  var NOT_TEXT = { BUTTON: 1, A: 1, LABEL: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, IMG: 1, HR: 1, OPTION: 1 };
  /* Inline marks a run of text may hold and still be one text layer. */
  var INLINE_MARK = { B: 1, I: 1, EM: 1, STRONG: 1, SMALL: 1, CODE: 1, BR: 1, SUP: 1, SUB: 1, MARK: 1, U: 1, S: 1 };
  var COMPONENT_CLASS = /(^|[\s_-])(badge|avatar|chip|pill|tag|card|tile|tab|toast|alert|banner|btn|button)([\s_-]|$)/i;

  function assetKeyOf(n) {
    var cls = classesOf(n);
    return n.tagName.toLowerCase() + (cls ? "." + cls.split(" ").join(".") : "");
  }

  function assetFamily(n) {
    return n.tagName.toLowerCase() + "." + (classesOf(n).split(" ")[0] || "");
  }

  function clip(words, most) {
    words = String(words || "").replace(/\s+/g, " ").trim();
    return words.length > most ? words.slice(0, most - 1) + "…" : words;
  }

  function textLayer(n) {
    if (NOT_TEXT[n.tagName]) return false;
    for (var i = 0; i < n.children.length; i++) if (!INLINE_MARK[n.children[i].tagName]) return false;
    return !!String(n.textContent || "").trim();
  }

  function assetName(n, cls) {
    var t = n.tagName;
    var first = cls.split(" ")[0] || "";
    if (t === "BUTTON" || /(^|[\s_-])btn([\s_-]|$)|button/i.test(cls)) {
      return /primary|cta|main|accent/i.test(cls) ? "Primary button" : /small|sm\b/i.test(cls) ? "Small button" : /ghost|secondary|outline/i.test(cls) ? "Secondary button" : "Button";
    }
    var NAMED = { UL: "List", OL: "Numbered list", DL: "Definitions", INPUT: "Input", SELECT: "Select", TEXTAREA: "Text area", DETAILS: "Disclosure", FIGURE: "Figure", FORM: "Form", NAV: "Navigation", IMG: "Image", HR: "Divider", TABLE: "Table", LABEL: "Label", A: "Link" };
    if (!first) return NAMED[t] || "Group";
    var words = first.replace(/[-_]+/g, " ").replace(/^./, function (c) {
      return c.toUpperCase();
    });
    if (t === "A" && !/link/i.test(words)) return words + " link";
    if (t === "INPUT" || t === "SELECT" || t === "TEXTAREA") return /input|field/i.test(words) ? words : words + " " + NAMED[t].toLowerCase();
    if (/^(plan|card|tile|quote|feature|testimonial|product|item)$/i.test(first) && !/card/i.test(words)) return words + " card";
    return words;
  }

  /* A category for a long list, from what the thing is. */
  function assetCatOf(it) {
    if (it.kind === "basic") return "basics";
    if (it.kind === "style") return /^h\d$/.test(it.tag) || it.size >= 24 ? "headings" : it.size < 14 ? "small" : "body";
    var t = it.el.tagName;
    var cls = it.cls;
    if (t === "BUTTON" || /(^|[\s_-])(btn|button)([\s_-]|$)/i.test(cls)) return "buttons";
    if (/^(INPUT|LABEL|FORM|SELECT|TEXTAREA|FIELDSET)$/.test(t)) return "forms";
    if (t === "NAV" || t === "A") return "nav";
    if (/^(UL|OL|DL|DETAILS|TABLE)$/.test(t)) return "lists";
    if (t === "IMG" || t === "HR" || /badge|avatar|chip|pill|tag/i.test(cls)) return "badges";
    return "cards";
  }

  /*
   * What the page is made of, one entry per look: its tag and classes. The
   * first one in the page stands for the rest; count says how many there
   * are. Script-made layers, ours, and anything hidden are left out.
   */
  function pageAssets() {
    var all = document.body ? document.body.getElementsByTagName("*") : [];
    var counts = {};
    /* By tag and first class, so a featured card is still one of the cards. */
    var families = {};
    var found = [];
    var limit = Math.min(all.length, 5000);
    for (var i = 0; i < limit; i++) {
      var n = all[i];
      if (n.namespaceURI !== "http://www.w3.org/1999/xhtml" || NOT_ASSET[n.tagName] || RAW[n.tagName] || ours(n) || stampOf(n) === null || whyNot(n)) continue;
      var key = assetKeyOf(n);
      counts[key] = (counts[key] || 0) + 1;
      var fam = assetFamily(n);
      families[fam] = (families[fam] || 0) + 1;
      if (counts[key] === 1) found.push(n);
    }
    var vw = hostWin.innerWidth || 1200;
    var out = [];
    found.forEach(function (n) {
      if (out.length >= 300) return;
      var cs = window.getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden") return;
      var key = assetKeyOf(n);
      var cls = classesOf(n);
      var it = { key: key, el: n, count: counts[key], cls: cls, tag: n.tagName.toLowerCase() };
      if (textLayer(n) && !(n.parentElement && n.parentElement.closest("button, a, label, summary, option"))) {
        it.kind = "style";
        it.text = clip(n.textContent, 24);
        it.size = parseFloat(cs.fontSize) || 16;
        it.weight = cs.fontWeight;
      } else {
        var holdsLayers = layersIn(n).length > 0;
        var wide = n.getBoundingClientRect().width > vw * 0.85;
        var many = Math.max(counts[key], families[assetFamily(n)] || 0) > 1;
        if (!(ASSET_TAGS[n.tagName] || COMPONENT_CLASS.test(cls) || (many && holdsLayers)) || wide) return;
        it.kind = "comp";
        it.name = assetName(n, cls);
        var first = Array.prototype.filter.call(n.querySelectorAll("*"), textLayer)[0];
        it.text = clip(n.getAttribute("placeholder") || (first || n).textContent, 22);
      }
      it.cat = assetCatOf(it);
      out.push(it);
    });
    var basics = MORE.map(function (kind) {
      return { kind: "basic", key: "basic-" + kind, insert: kind, name: INSERTS[kind].label, note: lookNote(kind), cat: "basics" };
    });
    return out.concat(basics);
  }

  /*
   * Where the selection is, in the terms of the list: the nearest component
   * it sits in (its plan card), or else the layer that holds it.
   */
  function assetHere(list) {
    if (!selected || !selected.isConnected) return null;
    var byKey = {};
    list.forEach(function (it) {
      byKey[it.key] = it;
    });
    for (var a = selected; a && !isRoot(a); a = a.parentElement) {
      var it = byKey[assetKeyOf(a)];
      if (it && it.kind === "comp" && layersIn(a).length) return { el: a, name: it.name };
    }
    var box = layersIn(selected).length && !retypable(selected) ? selected : elementOf(selected.parentElement);
    if (!box || isRoot(box)) return null;
    return { el: box, name: classesOf(box) ? assetName(box, classesOf(box)) : label(box) };
  }

  /* What is already used inside it, in the page's order. */
  function assetsIn(here, list) {
    var byKey = {};
    list.forEach(function (it) {
      if (it.kind !== "basic") byKey[it.key] = it;
    });
    var out = [];
    var seen = {};
    seen[assetKeyOf(here.el)] = 1;
    Array.prototype.forEach.call(here.el.getElementsByTagName("*"), function (n) {
      var key = assetKeyOf(n);
      if (seen[key] || !byKey[key]) return;
      seen[key] = 1;
      out.push(byKey[key]);
    });
    return out.slice(0, 24);
  }

  function assetWhat(it) {
    if (it.kind === "style") return "text like “" + it.text + "”";
    if (it.kind === "comp") return "a " + it.name.toLowerCase() + (it.text ? " like “" + it.text + "”" : "");
    return "a" + (/^[aeiou]/.test(INSERTS[it.insert].what) ? "n " : " ") + INSERTS[it.insert].what;
  }

  /* --- previews: a copy of the real thing, in its computed look ---------- */

  var PREVIEW_PROPS = [
    "display", "flex-direction", "flex-wrap", "align-items", "justify-content", "gap", "row-gap", "column-gap",
    "grid-template-columns", "grid-template-rows", "box-sizing", "width", "height",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
    "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
    "background-color", "color", "font-family", "font-size", "font-weight", "font-style", "line-height",
    "letter-spacing", "text-align", "text-transform", "text-decoration-line", "white-space", "list-style-type",
    "list-style-position", "box-shadow", "opacity", "object-fit", "vertical-align", "overflow",
  ];
  var DROP_IN_PREVIEW = /^(SCRIPT|STYLE|LINK|IFRAME|OBJECT|EMBED|VIDEO|AUDIO|CANVAS|TEMPLATE|NOSCRIPT|META)$/;
  var previews = null;
  var previewsAt = -1;

  /*
   * The element rebuilt with nothing of its own but its words and its look:
   * no classes, ids, links or handlers, so it is inert in the overlay and
   * the overlay's styles cannot reach it.
   */
  function snapshot(n, budget) {
    if (n.nodeType === 3) return document.createTextNode(n.nodeValue);
    if (n.nodeType !== 1 || ours(n) || DROP_IN_PREVIEW.test(n.tagName) || budget.left-- <= 0) return null;
    var c;
    if (n.namespaceURI && n.namespaceURI !== "http://www.w3.org/1999/xhtml") {
      // An icon: kept whole, at its size. Its handlers go.
      c = n.cloneNode(true);
      Array.prototype.forEach.call([c].concat(Array.prototype.slice.call(c.querySelectorAll("*"))), function (x) {
        Array.prototype.slice.call(x.attributes).forEach(function (a) {
          if (/^on/i.test(a.name) || /href$/i.test(a.name)) x.removeAttribute(a.name);
        });
      });
    } else {
      c = document.createElement(/^(A|BUTTON|LABEL|FORM|DETAILS|SUMMARY|SELECT|TEXTAREA)$/.test(n.tagName) ? "div" : n.tagName);
      if (n.tagName === "IMG") {
        c.setAttribute("src", n.currentSrc || n.src || "");
        c.setAttribute("alt", "");
      }
      if (n.tagName === "INPUT") {
        var type = String(n.getAttribute("type") || "text").toLowerCase();
        c.setAttribute("type", /^(checkbox|radio|range|color)$/.test(type) ? type : "text");
        if (n.getAttribute("placeholder")) c.setAttribute("placeholder", n.getAttribute("placeholder"));
        if (n.checked) c.setAttribute("checked", "");
        c.setAttribute("tabindex", "-1");
      }
      if (n.tagName === "DETAILS" && n.open) c.setAttribute("data-open", "");
    }
    var cs = window.getComputedStyle(n);
    PREVIEW_PROPS.forEach(function (p) {
      var v = cs.getPropertyValue(p);
      if (v) c.style.setProperty(p, v);
    });
    if (n.tagName === "SUMMARY") c.style.setProperty("display", "block");
    if (c.namespaceURI === "http://www.w3.org/1999/xhtml") {
      for (var k = n.firstChild; k; k = k.nextSibling) {
        if (n.tagName === "DETAILS" && !n.open && k.nodeType === 1 && k.tagName !== "SUMMARY") continue;
        var made = snapshot(k, budget);
        if (made) c.appendChild(made);
      }
    }
    return c;
  }

  /* A preview fitted into w by h: drawn once per page state, then copied. */
  function previewOf(it, w, h) {
    var box = el("div", "ed-as-pv");
    box.setAttribute("inert", "");
    box.setAttribute("aria-hidden", "true");
    if (it.kind === "basic") {
      box.innerHTML = icon(INSERTS[it.insert].icon, 22);
      return box;
    }
    if (previewsAt !== log.length || !previews) {
      previews = typeof Map !== "undefined" ? new Map() : null;
      previewsAt = log.length;
    }
    var made = previews && previews.get(it.el);
    if (!made) {
      made = snapshot(it.el, { left: 160 });
      if (!made) return box;
      made.style.setProperty("margin", "0");
      made.style.setProperty("flex", "none");
      made.style.setProperty("max-width", "none");
      var r = it.el.getBoundingClientRect();
      if (it.kind === "style") {
        var range = document.createRange ? document.createRange() : null;
        if (range && range.getBoundingClientRect) {
          range.selectNodeContents(it.el);
          var words = range.getBoundingClientRect();
          if (words.width) r = words;
        }
        made.style.setProperty("width", "max-content");
        made.style.setProperty("height", "auto");
        made.style.setProperty("white-space", "nowrap");
      }
      made.setAttribute("data-w", String(r.width || 0));
      made.setAttribute("data-h", String(r.height || 0));
      if (previews) previews.set(it.el, made);
    }
    var copy = made.cloneNode(true);
    var width = parseFloat(copy.getAttribute("data-w")) || 0;
    var height = parseFloat(copy.getAttribute("data-h")) || 0;
    if (width && height) copy.style.setProperty("zoom", String(Math.min(1, (w - 12) / width, (h - 10) / height)));
    box.appendChild(copy);
    return box;
  }

  /* --- the palette ----------------------------------------------------- */

  function openAssets() {
    if (!ui || busy || unavailable || stale) return;
    if (editing) commitText();
    if (describing) closeDescribe();
    if (placing) stopPlacing();
    closeMenus();
    assetsOpen = true;
    assetQuery = "";
    assetList = pageAssets();
    assetCat = assetHere(assetList) ? "here" : "";
    assetSig = "";
    refresh();
    var search = ui.assets && ui.assets.querySelector(".ed-as-search");
    if (search) search.focus();
  }

  function closeAssets() {
    if (!assetsOpen) return;
    assetsOpen = false;
    if (ui && ui.assets) ui.assets.hidden = true;
    refresh();
  }

  function toggleAssets() {
    if (assetsOpen) closeAssets();
    else openAssets();
  }

  /* From refresh: redrawn when what it shows would change. */
  function syncAssets() {
    if (!ui) return;
    if (!assetsOpen) {
      if (ui.assets) ui.assets.hidden = true;
      return;
    }
    var sig = [selected ? label(selected) + ":" + stampOf(selected) : "", assetCat, log.length, unavailable || stale ? 1 : 0].join("|");
    if (sig === assetSig && ui.assets && !ui.assets.hidden) return;
    assetSig = sig;
    renderAssets();
  }

  function renderAssets() {
    if (!ui.assets) {
      ui.assets = el("div", "ed-assets");
      ui.assets.setAttribute("role", "dialog");
      ui.assets.setAttribute("aria-label", "Insert");
      ui.assets.addEventListener("keydown", function (event) {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          closeAssets();
        }
      });
      host.wrap.appendChild(ui.assets);
    }
    var box = ui.assets;
    var keep = box.querySelector(".ed-as-search");
    var hadFocus = keep && box.getRootNode && box.getRootNode().activeElement === keep;
    box.textContent = "";
    box.hidden = false;
    assetList = pageAssets();
    var here = assetHere(assetList);
    var inHere = here ? assetsIn(here, assetList) : [];
    if (assetCat === "here" && !inHere.length) assetCat = "";
    var counts = {};
    assetList.forEach(function (it) {
      counts[it.cat] = (counts[it.cat] || 0) + 1;
    });
    if (!assetCat || (assetCat !== "here" && !counts[assetCat])) {
      assetCat = "basics";
      for (var g = 0; g < ASSET_CATS.length && assetCat === "basics"; g++) {
        for (var c = 0; c < ASSET_CATS[g][1].length; c++) {
          if (counts[ASSET_CATS[g][1][c][0]]) {
            assetCat = ASSET_CATS[g][1][c][0];
            break;
          }
        }
      }
    }

    var nav = el("div", "ed-as-nav");
    var find = node("label", "ed-as-find", icon("search", 13));
    var search = el("input", "ed-as-search");
    search.type = "search";
    var findable = assetList.filter(function (it) {
      return it.kind !== "basic";
    }).length;
    search.placeholder = "Search " + findable + " on this page";
    search.setAttribute("aria-label", "Search this page's text styles and components");
    search.value = assetQuery;
    search.addEventListener("input", function () {
      assetQuery = search.value;
      fill();
      markNav();
    });
    find.appendChild(search);
    nav.appendChild(find);
    var navButtons = [];
    var CAT_ICON = { here: "here", headings: "heading", body: "text", small: "text", buttons: "button", cards: "card", lists: "list", forms: "input", nav: "link", badges: "badge", basics: "plus" };
    function navItem(id, words, n, cls) {
      var b = node("button", "ed-as-cat" + (cls ? " " + cls : ""), icon(CAT_ICON[id] || "rect", 14));
      b.type = "button";
      b.setAttribute("data-cat", id);
      b.title = words;
      b.appendChild(el("span", null, words));
      b.appendChild(el("small", null, String(n)));
      b.addEventListener("click", function (event) {
        event.stopPropagation();
        assetCat = id;
        assetQuery = "";
        search.value = "";
        fill();
        markNav();
      });
      navButtons.push(b);
      nav.appendChild(b);
    }
    if (inHere.length) {
      navItem("here", "In " + here.name, inHere.length, "ed-as-here");
      nav.appendChild(el("div", "ed-as-rule"));
    }
    ASSET_CATS.forEach(function (group) {
      var shown = group[1].filter(function (c) {
        return counts[c[0]];
      });
      if (!shown.length) return;
      if (group[0]) nav.appendChild(el("div", "ed-as-group", group[0]));
      else nav.appendChild(el("div", "ed-as-rule ed-as-rule-low"));
      shown.forEach(function (c) {
        navItem(c[0], c[1], counts[c[0]]);
      });
    });
    function markNav() {
      navButtons.forEach(function (b) {
        b.toggleAttribute("data-on", !assetQuery && b.getAttribute("data-cat") === assetCat);
      });
    }
    markNav();
    box.appendChild(nav);

    var main = el("div", "ed-as-main");
    var head = el("div", "ed-as-head");
    var title = el("b", "ed-as-title");
    var note = el("span", "ed-as-note");
    head.appendChild(title);
    head.appendChild(note);
    var close = el("button", "ed-as-close");
    close.type = "button";
    close.title = "Close (Esc)";
    close.setAttribute("aria-label", "Close Insert");
    close.innerHTML = icon("close", 14);
    close.addEventListener("click", function (event) {
      event.stopPropagation();
      closeAssets();
    });
    head.appendChild(close);
    main.appendChild(head);
    var body = el("div", "ed-as-body");
    main.appendChild(body);
    box.appendChild(main);

    function fill() {
      body.textContent = "";
      body.scrollTop = 0;
      if (assetQuery.trim()) {
        var q = assetQuery.trim().toLowerCase();
        var hits = assetList.filter(function (it) {
          return ((it.name || "") + " " + (it.text || "") + " " + it.key + " " + ASSET_NAMES[it.cat]).toLowerCase().indexOf(q) >= 0;
        });
        title.textContent = hits.length ? hits.length + " on this page" : "Nothing matches";
        note.textContent = hits.length ? "" : "Try a tag or class, like h2 or card.";
        ASSET_CATS.forEach(function (group) {
          group[1].forEach(function (c) {
            var list = hits.filter(function (it) {
              return it.cat === c[0];
            });
            if (!list.length) return;
            body.appendChild(el("div", "ed-as-sub", c[1]));
            body.appendChild(tiles(list, false));
          });
        });
        return;
      }
      if (assetCat === "here") {
        title.textContent = "In " + here.name;
        note.textContent = "what it already uses, in order";
        body.appendChild(tiles(inHere, false));
        return;
      }
      var list = assetList.filter(function (it) {
        return it.cat === assetCat;
      });
      title.textContent = ASSET_NAMES[assetCat];
      note.textContent = assetCat === "basics" ? "plain, in this page's classes where it has them" : "from this page";
      body.appendChild(tiles(list, assetCat === "headings" || assetCat === "body" || assetCat === "small"));
    }
    fill();
    if (hadFocus) {
      search.focus();
      try {
        search.setSelectionRange(search.value.length, search.value.length);
      } catch (e) {}
    }
    placeBar();
  }

  /* A grid of cards, or for text styles a column of samples. */
  function tiles(list, rows) {
    var wrap = el("div", rows ? "ed-as-rows" : "ed-as-grid");
    list.forEach(function (it) {
      var t = el("button", rows ? "ed-as-row" : "ed-as-card");
      t.type = "button";
      t.setAttribute("data-key", it.key);
      if (rows) {
        var sample = previewOf(it, 300, 30);
        sample.classList.add("ed-as-sample");
        t.appendChild(sample);
        var meta = el("span", "ed-as-meta");
        meta.appendChild(el("code", null, it.key));
        meta.appendChild(el("span", null, Math.round(it.size) + "px · " + it.weight + " · ×" + it.count));
        t.appendChild(meta);
      } else {
        t.appendChild(previewOf(it, 128, 66));
        var cap = el("span", "ed-as-cap");
        cap.appendChild(el("span", "ed-as-name", it.kind === "style" ? "like “" + it.text + "”" : it.name));
        cap.appendChild(el("small", null, it.kind === "style" ? it.key : it.kind === "basic" ? it.note : "×" + it.count));
        t.appendChild(cap);
      }
      t.title = (it.kind === "basic" ? it.name : it.key) + ": click to add it by the selection, or drag it onto the page";
      t.addEventListener("pointerdown", function (event) {
        startAssetDrag(event, it, t);
      });
      t.addEventListener("click", function (event) {
        event.stopPropagation();
        if (t.hasAttribute("data-dragged")) {
          t.removeAttribute("data-dragged");
          return;
        }
        addAsset(it, null);
      });
      wrap.appendChild(t);
    });
    return wrap;
  }

  /* Above the bar, like Describe's stack; below it when the bar is at the top. */
  function placeAssets(left, width) {
    var box = ui.assets;
    if (!box) return;
    if (ui.bar.hidden || !assetsOpen) {
      box.hidden = true;
      return;
    }
    var r = ui.bar.getBoundingClientRect();
    var w = Math.min(Math.max(width, 640), hostWin.innerWidth - 16);
    box.style.width = w + "px";
    box.style.left = Math.max(8, Math.min(hostWin.innerWidth - w - 8, left + width / 2 - w / 2)) + "px";
    if (ui.bar.style.top) {
      box.style.top = r.bottom + 8 + "px";
      box.style.bottom = "";
    } else {
      box.style.top = "";
      box.style.bottom = hostWin.innerHeight - r.top + 8 + "px";
    }
  }

  /* --- adding one ------------------------------------------------------ */

  /* Inside a component's kind, beside the nearest one: a card goes by cards. */
  function besideKind(from, key) {
    for (var a = from; a && !isRoot(a); a = a.parentElement) {
      var parent = a.parentElement;
      if (!parent || stampOf(a) === null || whyNot(a)) continue;
      for (var i = 0; i < parent.children.length; i++) {
        if (assetKeyOf(parent.children[i]) === key) return a;
      }
    }
    return null;
  }

  function addAsset(it, at) {
    if (busy || unavailable || stale) return;
    if (editing) commitText();
    if (it.kind === "basic") return insert(it.insert, null, at || null);
    if (!it.el.isConnected) {
      message = "That one is no longer on the page.";
      assetSig = "";
      refresh();
      return;
    }
    var where = at;
    if (!where) {
      var by = it.kind === "comp" && selected ? besideKind(selected, it.key) : null;
      where = by ? { target: by, place: "after", parent: elementOf(by.parentElement) } : selectionSpot();
    }
    if (!where.target) where = { target: it.el, place: "after", parent: elementOf(it.el.parentElement) };
    var said = spotWords(where);
    copyTo(it.el, where.target, where.place, function (copy) {
      selectMany([copy]);
      message = "Added " + assetWhat(it) + " " + said + "." + (it.kind === "style" ? " Type to replace its words." : "");
      if (it.kind === "style" && retypable(copy)) startText();
      refresh();
    }, function () {
      message = "Couldn't add " + assetWhat(it) + " there.";
      refresh();
    }, "insert of " + label(it.el));
  }

  /* --- dragging one onto the page ---------------------------------------- */

  /* A point in the overlay's window, in the page's. */
  function fromHost(x, y) {
    if (!child) return { x: x, y: y };
    var f = frameEl.getBoundingClientRect();
    var scale = frameEl.offsetWidth ? f.width / frameEl.offsetWidth : 1;
    return { x: (x - f.left) / scale - frameEl.clientLeft, y: (y - f.top) / scale - frameEl.clientTop };
  }

  /* Over the bar, the panel or the palette: nowhere to drop. */
  function overOverlay(x, y) {
    var d = hostWin.document;
    if (!d.elementFromPoint) return false;
    var hit = d.elementFromPoint(x, y);
    return !!(hit && hit.closest && hit.closest("#osp-overlay-host"));
  }

  function assetSpot(it, x, y) {
    if (it.kind === "comp") {
      var by = besideKind(elementOf(elementAtPoint(x, y)), it.key);
      if (by) return besideSpot(by, x, y);
    }
    return spotAt(x, y);
  }

  /*
   * A press on a card: past a few pixels it is a drag. The pointer is held
   * by the card, so the moves arrive here wherever it goes, the page's
   * frame included; the palette fades and lets the page show through.
   */
  function startAssetDrag(event, it, tile) {
    if (event.button !== 0 || busy || unavailable || stale) return;
    var sx = event.clientX;
    var sy = event.clientY;
    var mine = null;
    try {
      tile.setPointerCapture(event.pointerId);
    } catch (e) {}
    function move(m) {
      if (!mine) {
        if (Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) <= DRAG_START) return;
        if (editing) commitText();
        closeMenus();
        mine = { kind: it.kind === "basic" ? it.insert : "asset", asset: it, drag: true, like: null };
        placing = mine;
        ui.assets.setAttribute("data-dragging", "");
      }
      if (placing !== mine) return;
      var p = fromHost(m.clientX, m.clientY);
      spot = overOverlay(m.clientX, m.clientY) ? null : assetSpot(it, p.x, p.y);
      refresh();
    }
    function up() {
      stop();
      if (!mine) return;
      // The click the release makes ends the drag; it selects nothing.
      dragged = true;
      tile.setAttribute("data-dragged", "");
      setTimeout(function () {
        tile.removeAttribute("data-dragged");
      }, 0);
      if (ui.assets) ui.assets.removeAttribute("data-dragging");
      if (placing !== mine) return;
      var at = spot;
      placing = null;
      spot = null;
      if (at && at.target) addAsset(it, at);
      else {
        message = "";
        refresh();
      }
    }
    function cancel() {
      stop();
      if (ui.assets) ui.assets.removeAttribute("data-dragging");
      if (mine && placing === mine) stopPlacing();
    }
    function stop() {
      assetDrop = null;
      hostWin.removeEventListener("pointermove", move, true);
      hostWin.removeEventListener("pointerup", up, true);
      hostWin.removeEventListener("pointercancel", cancel, true);
    }
    assetDrop = up;
    hostWin.addEventListener("pointermove", move, true);
    hostWin.addEventListener("pointerup", up, true);
    hostWin.addEventListener("pointercancel", cancel, true);
  }

  /* What the bar says while one is being dragged. */
  function assetHint() {
    var it = placing.asset;
    if (spot && spot.target) return "Release to add " + assetWhat(it) + " " + spotWords(spot) + ".";
    return "Drag onto the page to add " + assetWhat(it) + ". Esc to stop.";
  }
`;
