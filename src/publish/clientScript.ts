/**
 * The one script a published page carries.
 *
 * Everything here is an enhancement of markup that already works: the tree is
 * `<details>`, the outline is anchors, the batch rows open on their own. What
 * the script adds is the search field (hidden until it can do something), the
 * outline's active mark, the theme switch, the graph panel and the crumb's way
 * back. A reader with scripting off loses those and keeps the site.
 *
 * It is inlined rather than fetched, like the stylesheet: a published page
 * makes no external requests.
 */

/**
 * Runs in `<head>`, before the first paint, so a reader who chose dark does
 * not get a white flash on every navigation. Kept to one statement for the
 * same reason.
 */
export const THEME_BOOT = `try{var t=localStorage.getItem("osp-theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export const CLIENT_SCRIPT = `(function () {
  var root = document.documentElement;

  function visible(el) {
    return !!el && !el.hidden && !!el.offsetParent;
  }

  /* --- theme ------------------------------------------------------- */

  function prefersDark() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function currentTheme() {
    return root.getAttribute("data-theme") || (prefersDark() ? "dark" : "light");
  }

  function paintSwitches() {
    var dark = currentTheme() === "dark";
    var switches = document.querySelectorAll("[data-osp-theme-toggle]");
    for (var i = 0; i < switches.length; i++) {
      switches[i].setAttribute("aria-checked", String(dark));
    }
  }

  document.addEventListener("click", function (event) {
    var toggle = event.target.closest("[data-osp-theme-toggle]");
    if (!toggle) return;
    var next = currentTheme() === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("osp-theme", next); } catch (e) {}
    paintSwitches();
  });

  paintSwitches();

  /* --- search ------------------------------------------------------ */

  /* The fields ship hidden: a search box that cannot search is worse than no
     search box, and until this runs that is what it would be. */
  var fields = document.querySelectorAll("[data-osp-search]");
  for (var f = 0; f < fields.length; f++) fields[f].hidden = false;

  var jump = document.querySelector("[data-osp-jump]");
  var results = document.querySelector("[data-osp-jump-results]");
  var recent = document.querySelector("[data-osp-jump-recent]");
  var hint = document.querySelector(".osp-jump-hint");
  var inputs = document.querySelectorAll("[data-osp-search-input]");
  var notes = [];
  var tags = [];

  var treeRows = document.querySelectorAll(".osp-panel-body .osp-tree .osp-row");
  for (var r = 0; r < treeRows.length; r++) {
    var row = treeRows[r];
    var href = row.getAttribute("href");
    var label = row.querySelector(".osp-label");
    if (!href || !label) continue;
    var folder = row.closest(".osp-folder");
    notes.push({
      title: label.textContent,
      href: href,
      where: folder ? (folder.querySelector(".osp-label") || {}).textContent : "",
    });
  }

  var tagRows = document.querySelectorAll("[data-osp-tag-index] .osp-row");
  for (var g = 0; g < tagRows.length; g++) {
    var tagLabel = tagRows[g].querySelector(".osp-label");
    var tagCount = tagRows[g].querySelector(".osp-num");
    if (!tagLabel) continue;
    tags.push({
      name: tagLabel.textContent,
      href: tagRows[g].getAttribute("href"),
      count: tagCount ? tagCount.textContent : "",
    });
  }

  function escapeHtml(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function mark(value, query) {
    var at = value.toLowerCase().indexOf(query);
    var safe = escapeHtml(value);
    if (at === -1) return safe;
    return escapeHtml(value.slice(0, at)) +
      '<mark class="osp-hit">' + escapeHtml(value.slice(at, at + query.length)) + "</mark>" +
      escapeHtml(value.slice(at + query.length));
  }

  /* Whatever rows the panel is showing right now: the recent list before
     anything is typed, the matches after. One list, so the arrow keys do not
     have to know which state they are in. */
  function rows() {
    if (!jump || jump.hidden) return [];
    var all = jump.querySelectorAll(".osp-row[href]");
    var open = [];
    for (var i = 0; i < all.length; i++) if (visible(all[i])) open.push(all[i]);
    return open;
  }

  var selected = -1;

  /* The selection is drawn, not announced: this is a panel of links, so a
     screen reader reaches them by tabbing and hears a link, which is the
     truth. Claiming a listbox here would mean lying about the markup. */
  function select(index) {
    var open = rows();
    for (var i = 0; i < open.length; i++) open[i].classList.remove("osp-selected");
    selected = open.length ? Math.max(0, Math.min(index, open.length - 1)) : -1;
    if (selected === -1) return;
    var row = open[selected];
    row.classList.add("osp-selected");
    if (row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
  }

  function openJump(open) {
    if (!jump) return;
    jump.hidden = !open;
    if (!open) selected = -1;
  }

  function search(query) {
    if (!results || !recent) return;
    var q = query.trim().toLowerCase();
    if (!q) {
      results.hidden = true;
      results.innerHTML = "";
      recent.hidden = false;
      if (hint) hint.hidden = false;
      select(-1);
      return;
    }
    recent.hidden = true;
    results.hidden = false;

    var noteHits = [];
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].title.toLowerCase().indexOf(q) !== -1) noteHits.push(notes[i]);
    }
    var tagHits = [];
    for (var t = 0; t < tags.length; t++) {
      if (tags[t].name.toLowerCase().indexOf(q) !== -1) tagHits.push(tags[t]);
    }

    if (!noteHits.length && !tagHits.length) {
      results.innerHTML = '<p class="osp-empty"><b>Nothing matches</b>No note or tag is called \\u201c' +
        escapeHtml(query.trim()) + '\\u201d. Try one fewer word.</p>';
      if (hint) hint.hidden = true;
      select(-1);
      return;
    }

    var html = "";
    if (noteHits.length) {
      var shown = noteHits.slice(0, 8);
      html += '<h2 class="osp-group-title">Notes<span class="osp-num">' + noteHits.length + "</span></h2>" +
        '<ul class="osp-tree">';
      for (var h = 0; h < shown.length; h++) {
        html += '<li><a class="osp-row" href="' + shown[h].href + '">' +
          '<span class="osp-label">' + mark(shown[h].title, q) + "</span>" +
          (shown[h].where ? '<span class="osp-trail">' + escapeHtml(shown[h].where) + "</span>" : "") +
          "</a></li>";
      }
      html += "</ul>";
      if (noteHits.length > shown.length) {
        html += '<p class="osp-jump-more">' + (noteHits.length - shown.length) +
          " more. Keep typing to narrow.</p>";
      }
    }
    if (tagHits.length) {
      html += '<h2 class="osp-group-title">Tags<span class="osp-num">' + tagHits.length + "</span></h2>" +
        '<ul class="osp-tree">';
      for (var k = 0; k < tagHits.length && k < 8; k++) {
        html += '<li><a class="osp-row" href="' + tagHits[k].href + '">' +
          '<span class="osp-label">#' + mark(tagHits[k].name, q) + "</span>" +
          '<span class="osp-num">' + escapeHtml(tagHits[k].count) + "</span></a></li>";
      }
      html += "</ul>";
    }

    results.innerHTML = html;
    if (hint) hint.hidden = false;
    select(0);
  }

  for (var n = 0; n < inputs.length; n++) {
    inputs[n].addEventListener("focus", function () { openJump(true); });
    inputs[n].addEventListener("input", function (event) {
      openJump(true);
      search(event.target.value);
    });
    inputs[n].addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        var open = rows();
        if (!open.length) return;
        event.preventDefault();
        select(selected + (event.key === "ArrowDown" ? 1 : -1));
        return;
      }
      if (event.key === "Enter") {
        var picked = rows()[selected];
        if (!picked) return;
        event.preventDefault();
        window.location.href = picked.getAttribute("href");
        return;
      }
      if (event.key !== "Escape") return;
      if (event.target.value) { event.target.value = ""; search(""); }
      else { openJump(false); event.target.blur(); }
    });
  }

  document.addEventListener("pointerdown", function (event) {
    if (!jump || jump.hidden) return;
    if (event.target.closest("[data-osp-jump], [data-osp-search]")) return;
    openJump(false);
  });

  /* A slash opens the field that is actually on screen. The bar keeps one for
     narrow screens where the panel is gone, and on a wide screen that one is
     styled away -- so the first field in the document is the wrong answer. */
  document.addEventListener("keydown", function (event) {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    var active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
    for (var i = 0; i < fields.length; i++) {
      if (!visible(fields[i])) continue;
      var field = fields[i].querySelector("[data-osp-search-input]");
      if (!field) continue;
      event.preventDefault();
      field.focus();
      field.select();
      openJump(true);
      return;
    }
  });

  /* --- the crumb: where you are, and the way back ------------------ */

  var crumb = document.querySelector("[data-osp-crumb]");
  var backBtn = document.querySelector("[data-osp-back]");
  var fwdBtn = document.querySelector("[data-osp-forward]");

  /* Which way this tab can go.

     The history API will move in either direction but will not say whether
     there is anything that way, so the arrows keep their own count: each page
     stamps its position into its history entry, which the browser hands back
     when that entry is revisited, and the furthest position reached is kept
     per tab. Arriving somewhere new truncates the forward end, exactly as the
     browser's own history does.

     The count only covers this site. Back is disabled at the first page of
     the visit even though the browser could leave for wherever the reader
     came from -- these arrows move within the vault, like Obsidian's. */
  if (backBtn && fwdBtn) {
    var HERE = "osp-history-at";
    var DEPTH = "osp-history-depth";

    var read = function (key) {
      try {
        var raw = parseInt(sessionStorage.getItem(key), 10);
        return isNaN(raw) ? null : raw;
      } catch (e) { return null; }
    };
    var write = function (key, value) {
      try { sessionStorage.setItem(key, String(value)); } catch (e) {}
    };

    var at;
    var state = history.state;
    if (state && typeof state.ospAt === "number") {
      at = state.ospAt;
    } else {
      var previous = read(HERE);
      at = previous === null ? 0 : previous + 1;
      try { history.replaceState({ ospAt: at }, ""); } catch (e) {}
      write(DEPTH, at);
    }

    var sync = function () {
      /* Written here rather than once on load, because a page the browser
         kept alive is shown again without running any of this. */
      write(HERE, at);
      var depth = read(DEPTH);
      /* Without session storage there is nothing to count with. Back is
         offered on the browser's own word, and forward is not guessed at. */
      backBtn.disabled = depth === null ? history.length <= 1 : at <= 0;
      fwdBtn.disabled = depth === null || at >= depth;
    };

    sync();
    backBtn.addEventListener("click", function () { history.back(); });
    fwdBtn.addEventListener("click", function () { history.forward(); });
    window.addEventListener("pageshow", sync);
  }

  /* --- the outline follows the reading ----------------------------- */

  var links = document.querySelectorAll("[data-osp-spy]");
  var rail = document.querySelector(".osp-rail");
  var targets = [];
  for (var s = 0; s < links.length; s++) {
    var heading = document.getElementById(links[s].getAttribute("data-osp-spy"));
    if (heading) targets.push({ link: links[s], heading: heading });
  }

  var queued = false;

  function update() {
    queued = false;
    if (crumb) crumb.classList.toggle("osp-scrolled", window.scrollY > 8);
    if (!targets.length) return;

    var active = targets[0];
    for (var i = 0; i < targets.length; i++) {
      if (targets[i].heading.getBoundingClientRect().top < 140) active = targets[i];
    }
    for (var j = 0; j < targets.length; j++) {
      var on = targets[j] === active;
      targets[j].link.classList.toggle("osp-active", on);
      if (on) targets[j].link.setAttribute("aria-current", "true");
      else targets[j].link.removeAttribute("aria-current");
    }

    /* A long outline scrolls on its own, so the active row is kept in sight
       -- but only when it has left, or the rail twitches on every frame. */
    if (rail && active) {
      var box = active.link.getBoundingClientRect();
      var frame = rail.getBoundingClientRect();
      if (box.top < frame.top + 8 || box.bottom > frame.bottom - 8) {
        active.link.scrollIntoView({ block: "nearest" });
      }
    }
  }

  window.addEventListener("scroll", function () {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(update);
  }, { passive: true });
  window.addEventListener("resize", update, { passive: true });
  update();

  /* --- callouts ---------------------------------------------------- */

  document.addEventListener("click", function (event) {
    var toggle = event.target.closest(".osp-callout-toggle");
    if (!toggle) return;
    var content = document.getElementById(toggle.getAttribute("aria-controls"));
    if (!content) return;
    var expanded = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", expanded ? "Collapse callout" : "Expand callout");
    content.hidden = !expanded;
    var callout = toggle.closest(".callout");
    if (callout) callout.classList.toggle("is-collapsed", !expanded);
  });

  /* --- tasks that are neither done nor untouched -------------------- *
     A browser draws an indeterminate checkbox as a dash, which is what
     [/] and [-] mean. It is a property rather than an attribute, so the
     markup cannot carry it and this is the only place it can be set.
     ----------------------------------------------------------------- */

  var partial = document.querySelectorAll("input[data-osp-task]");
  for (var t = 0; t < partial.length; t++) partial[t].indeterminate = true;

  /* --- code blocks, and anything else that scrolls sideways --------- *
     Three jobs. The controls in a code block's bar ship hidden and are
     revealed here, like the search field: a copy button that cannot copy is
     worse than no copy button. Every sideways-scrolling region is measured,
     so the stylesheet can fade the edge it can still move towards. And wrap
     is remembered, because a reader who wants their lines wrapped wants that
     on the next page too.
     ----------------------------------------------------------------- */

  var WRAP_KEY = "osp-code-wrap";
  var apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform || "");
  var scrollers = document.querySelectorAll(".osp-scroller");

  function measure(scroller) {
    var figure = scroller.closest("[data-osp-code]");
    var room = scroller.scrollWidth - scroller.clientWidth;
    var over = room > 1;

    if (figure) {
      if (over || figure.getAttribute("data-osp-wrapped") === "on") {
        figure.setAttribute("data-osp-overflow", "");
      } else {
        figure.removeAttribute("data-osp-overflow");
      }
    }

    if (!over) {
      scroller.removeAttribute("data-osp-at");
      scroller.removeAttribute("tabindex");
      scroller.removeAttribute("role");
      scroller.removeAttribute("aria-label");
      return;
    }

    /* A region that scrolls has to be reachable by keyboard, or its content
       is readable with a mouse and gone without one. */
    if (!scroller.hasAttribute("tabindex")) {
      scroller.setAttribute("tabindex", "0");
      scroller.setAttribute("role", "region");
      var lang = figure ? figure.getAttribute("data-osp-lang") : null;
      var what = figure
        ? (lang ? lang + " code block, scrollable" : "Code block, scrollable")
        : "Table, scrollable";
      scroller.setAttribute("aria-label", what);
    }

    var at = "middle";
    if (scroller.scrollLeft <= 1) at = "start";
    else if (scroller.scrollLeft >= room - 1) at = "end";
    scroller.setAttribute("data-osp-at", at);
  }

  function measureAll() {
    for (var m = 0; m < scrollers.length; m++) measure(scrollers[m]);
  }

  function setWrap(figure, on) {
    figure.setAttribute("data-osp-wrapped", on ? "on" : "off");
    var button = figure.querySelector("[data-osp-wrap]");
    if (button) button.setAttribute("aria-pressed", String(on));
    var pre = figure.querySelector("pre");
    if (pre) {
      /* Wrapping leaves the block scrolled wherever it was, which in wrap
         mode is nowhere the reader can get back from. */
      if (on) pre.scrollLeft = 0;
      measure(pre);
    }
  }

  var wrapByDefault = false;
  try { wrapByDefault = localStorage.getItem(WRAP_KEY) === "on"; } catch (e) {}

  var blocks = document.querySelectorAll("[data-osp-code]");
  for (var b = 0; b < blocks.length; b++) {
    var tools = blocks[b].querySelector("[data-osp-code-tools]");
    if (tools) tools.hidden = false;
    if (wrapByDefault) setWrap(blocks[b], true);
  }

  for (var sc = 0; sc < scrollers.length; sc++) {
    scrollers[sc].addEventListener("scroll", function (event) {
      measure(event.currentTarget);
    }, { passive: true });
  }
  measureAll();
  window.addEventListener("resize", measureAll, { passive: true });

  /* --- copy -------------------------------------------------------- */

  function legacyCopy(text) {
    /* A published vault is often read off a disk rather than a server, and
       the clipboard API is not granted to every context a file:// page runs
       in. This one is, and has been since long before it was deprecated. */
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(area);
    return ok;
  }

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { done(true); },
        function () { done(legacyCopy(text)); },
      );
      return;
    }
    done(legacyCopy(text));
  }

  function selectAll(el) {
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (e) {}
  }

  function say(button, text, hold) {
    var label = button.querySelector(".osp-code-btn-label");
    if (!label) return;
    if (button.ospSaid) window.clearTimeout(button.ospSaid);
    if (!button.ospWas) button.ospWas = label.textContent;
    label.textContent = text;
    button.ospSaid = window.setTimeout(function () {
      label.textContent = button.ospWas;
      button.removeAttribute("data-osp-copied");
      button.ospSaid = null;
    }, hold);
  }

  document.addEventListener("click", function (event) {
    var wrapBtn = event.target.closest("[data-osp-wrap]");
    if (wrapBtn) {
      var figure = wrapBtn.closest("[data-osp-code]");
      if (!figure) return;
      var on = figure.getAttribute("data-osp-wrapped") !== "on";
      setWrap(figure, on);
      try { localStorage.setItem(WRAP_KEY, on ? "on" : "off"); } catch (e) {}
      return;
    }

    var copyBtn = event.target.closest("[data-osp-copy]");
    if (!copyBtn) return;
    var block = copyBtn.closest("[data-osp-code]");
    var code = block ? block.querySelector("pre code") : null;
    if (!code) return;

    copyText(code.textContent, function (ok) {
      if (ok) {
        copyBtn.setAttribute("data-osp-copied", "");
        say(copyBtn, "Copied", 1600);
        return;
      }
      /* Nothing left to do for them, so leave them able to do it: the block
         is selected and the label says what to press. */
      selectAll(code);
      say(copyBtn, apple ? "Press ⌘C" : "Press Ctrl+C", 2800);
    });
  });

  /* --- the graph, as the rail's other state ------------------------ */

  var railPage = document.querySelector("[data-osp-rail-page]");
  var railGraph = document.querySelector("[data-osp-rail-graph]");
  var graphButton = document.querySelector("[data-osp-graph]");

  function showGraph(on) {
    if (!railPage || !railGraph) return;
    railPage.hidden = on;
    railGraph.hidden = !on;
    if (graphButton) graphButton.setAttribute("aria-pressed", String(on));
    if (on) {
      var backButton = railGraph.querySelector("[data-osp-graph-back]");
      if (backButton) backButton.focus();
    } else if (graphButton) {
      graphButton.focus();
    }
  }

  if (graphButton) {
    graphButton.addEventListener("click", function () {
      showGraph(railGraph ? railGraph.hidden : false);
    });
  }
  var graphBack = document.querySelector("[data-osp-graph-back]");
  if (graphBack) graphBack.addEventListener("click", function () { showGraph(false); });
})();`;
