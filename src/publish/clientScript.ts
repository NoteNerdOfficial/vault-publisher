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
  var backLink = document.querySelector("[data-osp-back]");
  var backLabel = document.querySelector("[data-osp-back-label]");

  /* The trail is this tab's own, so it survives navigation and nothing else:
     a back control that says where it goes is worth a little bookkeeping, and
     "Back" with no name is worth none. */
  if (backLink && backLabel) {
    var here = {
      u: location.pathname,
      t: (document.querySelector(".osp-title") || {}).textContent || document.title,
    };
    var trail = [];
    try { trail = JSON.parse(sessionStorage.getItem("osp-trail") || "[]"); } catch (e) {}
    if (!trail.length || trail[trail.length - 1].u !== here.u) {
      trail.push(here);
      if (trail.length > 12) trail.shift();
      try { sessionStorage.setItem("osp-trail", JSON.stringify(trail)); } catch (e) {}
    }
    var previous = trail.length > 1 ? trail[trail.length - 2] : null;
    if (previous) {
      backLink.setAttribute("href", previous.u);
      backLabel.textContent = previous.t;
      backLink.setAttribute("aria-label", "Back to " + previous.t);
      backLink.hidden = false;
    }
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
