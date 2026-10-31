/**
 * The one script a published page carries.
 *
 * Everything here is an enhancement of markup that already works: the tree is
 * `<details>`, the outline is anchors, the batch rows open on their own. What
 * the script adds is the search field (hidden until it can do something), the
 * outline's active mark, the theme switch and the crumb's way back. A reader
 * with scripting off loses those and keeps the site.
 *
 * It is inlined rather than fetched, like the stylesheet: a published page
 * makes no external requests.
 */

/**
 * Runs in `<head>`, before the first paint, so a reader who chose dark does
 * not get a white flash on every navigation. Kept to one statement for the
 * same reason.
 *
 * It carries the width and the view as well, and for a sharper reason than
 * the theme: those two change the page's layout. Applied after first paint
 * they would not be a flash of the wrong colour but a column visibly
 * resizing, or a note appearing and being replaced by its source, on every
 * navigation.
 *
 * Markdown is only restored on a page that has a source pane. A reader who
 * chose it and then followed a link to the browse page should see the browse
 * page, not an empty view of nothing, and should still be in markdown mode
 * when they reach the next note.
 */
export const THEME_BOOT =
  `try{var r=document.documentElement,t=localStorage.getItem("osp-theme");` +
  `if(t)r.setAttribute("data-theme",t);` +
  `var w=localStorage.getItem("osp-width");if(w)r.setAttribute("data-osp-width",w);` +
  `if(localStorage.getItem("osp-view")==="markdown"&&r.hasAttribute("data-osp-source"))` +
  `r.setAttribute("data-osp-view","markdown")}catch(e){}`;

export const CLIENT_SCRIPT = `(function () {
  var root = document.documentElement;

  /* Whether a box is laid out, which is not a question offsetParent can
     answer. It is null for every position:fixed element, so a fixed box
     standing over the whole viewport reported itself as not there.

     The drawer's scrim is exactly that box, and the resize guard below
     asked it whether this width still wants a drawer -- so the answer was
     always no, and any resize at all closed an open drawer. On a phone the
     gesture that opens it is also one that resizes: taking the page's
     scroll away lets the browser's own chrome back, which fires resize
     inside the same tap, so the drawer opened and shut again before it
     could be seen and the button looked dead.

     getClientRects answers for every case the callers here have: empty for
     display:none, for an unrendered ancestor and for a detached node, and
     non-empty for a fixed box. It keeps saying yes to a box that is merely
     translated off the edge, which is the drawer's own panel -- see the
     slash handler, which asks the toggle rather than the field for exactly
     that reason. */
  function visible(el) {
    return !!el && !el.hidden && el.getClientRects().length > 0;
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

  /* --- view and width ---------------------------------------------- *
     Two settings about the page rather than the site: which of its two
     views to read, and how much of the window it gets. Both live as an
     attribute on <html> and are applied in <head> before the first paint,
     so all this has to do is reveal the controls, keep them in step with
     the attribute, and make them behave like the radiogroups they claim to
     be -- arrows move the choice, and only the current one is in the tab
     order, which is what a radiogroup means to a screen reader.

     They ship hidden for the usual reason: until this runs, pressing one
     would do nothing.
     ------------------------------------------------------------------ */

  function segmented(groupSelector, modeAttribute, stateAttribute, key) {
    var group = document.querySelector(groupSelector);
    if (!group) return;
    var buttons = group.querySelectorAll("[" + modeAttribute + "]");
    if (!buttons.length) return;

    function modeOf(button) {
      return button.getAttribute(modeAttribute);
    }

    function paint(value) {
      for (var i = 0; i < buttons.length; i++) {
        var on = modeOf(buttons[i]) === value;
        buttons[i].setAttribute("aria-checked", String(on));
        buttons[i].tabIndex = on ? 0 : -1;
      }
    }

    function choose(value, focus) {
      root.setAttribute(stateAttribute, value);
      try { localStorage.setItem(key, value); } catch (e) {}
      paint(value);
      if (!focus) return;
      for (var i = 0; i < buttons.length; i++) {
        if (modeOf(buttons[i]) === value) buttons[i].focus();
      }
    }

    function step(by) {
      var at = 0;
      for (var i = 0; i < buttons.length; i++) {
        if (buttons[i].getAttribute("aria-checked") === "true") at = i;
      }
      choose(modeOf(buttons[(at + by + buttons.length) % buttons.length]), true);
    }

    group.addEventListener("click", function (event) {
      var button = event.target.closest("[" + modeAttribute + "]");
      if (button) choose(modeOf(button), false);
    });

    group.addEventListener("keydown", function (event) {
      var key_ = event.key;
      if (key_ === "ArrowRight" || key_ === "ArrowDown") step(1);
      else if (key_ === "ArrowLeft" || key_ === "ArrowUp") step(-1);
      else if (key_ === "Home") choose(modeOf(buttons[0]), true);
      else if (key_ === "End") choose(modeOf(buttons[buttons.length - 1]), true);
      else return;
      event.preventDefault();
    });

    paint(root.getAttribute(stateAttribute) || modeOf(buttons[0]));
    group.hidden = false;
  }

  segmented("[data-osp-views]", "data-osp-view-mode", "data-osp-view", "osp-view");
  segmented("[data-osp-widths]", "data-osp-width-mode", "data-osp-width", "osp-width");

  /* --- the vault panel, as a drawer --------------------------------- *
     Wide enough and the panel is simply there, and none of this runs
     against it. Narrow enough and it is off the left edge until asked
     for. The state is an attribute on <html> so the stylesheet decides
     what "open" looks like at each width, and this only has to decide
     when.

     Not remembered between pages on purpose: a drawer is a question
     asked and answered, and one that reopened itself on every note
     would be a panel that does not close.
     ------------------------------------------------------------------ */

  var panelToggle = document.querySelector("[data-osp-panel-toggle]");
  var panel = document.getElementById("osp-panel");
  var scrim = document.querySelector("[data-osp-scrim]");
  var inpage = document.querySelector("[data-osp-inpage]");

  function panelOpen() {
    return root.getAttribute("data-osp-panel") === "open";
  }

  function showPanel(on) {
    if (on) root.setAttribute("data-osp-panel", "open");
    else root.removeAttribute("data-osp-panel");
    if (panelToggle) panelToggle.setAttribute("aria-expanded", String(on));
    if (scrim) scrim.hidden = !on;
    /* The overlay belongs to the field in the drawer, so it cannot outlive
       the drawer: left open, it would be a list of notes floating over the
       note the reader just went back to. */
    if (!on && typeof openJump === "function") openJump(false);
    /* The outline row is pinned under a drawer that now covers it. */
    if (on && inpage) inpage.open = false;
    /* The page behind must not scroll under an open drawer: a reader who
       swipes to dismiss it and scrolls the article instead has lost their
       place to a control they were trying to put away. */
    document.body.style.overflow = on ? "hidden" : "";
    if (on) {
      /* A shut drawer is hidden, and nothing inside something hidden can
         take focus. The attribute above has been set but the style it
         selects has not been recomputed yet, so reading a box off the panel
         forces that recompute before the focus call below. */
      if (panel) panel.getBoundingClientRect();

      var close = panel ? panel.querySelector("[data-osp-panel-close]") : null;
      if (close) close.focus();
    } else if (panelToggle && visible(panelToggle)) {
      panelToggle.focus();
    }
  }

  if (panelToggle && panel) {
    panelToggle.hidden = false;
    panelToggle.addEventListener("click", function () {
      showPanel(!panelOpen());
    });

    var panelClose = panel.querySelector("[data-osp-panel-close]");
    if (panelClose) {
      panelClose.addEventListener("click", function () { showPanel(false); });
    }
    if (scrim) scrim.addEventListener("click", function () { showPanel(false); });

    /* Following a link is answering the question the drawer was asking. */
    panel.addEventListener("click", function (event) {
      if (event.target.closest("a")) showPanel(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && panelOpen()) showPanel(false);
    });

    /* A drawer left open across a resize would be a panel stuck over a
       layout that has room for it. */
    window.addEventListener("resize", function () {
      if (panelOpen() && !visible(scrim)) showPanel(false);
    }, { passive: true });

  }

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
  /* Open means open and staying: a panel in the middle of leaving is still
     in the document for another frame or two, and nothing -- not the arrow
     keys, not the click that would close it again -- should be able to
     reach into it on the way out. */
  function jumpOpen() {
    return !!jump && !jump.hidden && !jump.hasAttribute("data-osp-leaving");
  }

  function rows() {
    if (!jumpOpen()) return [];
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

  /* Opening the panel is also what puts the page into search: the attribute
     on the root is what the stylesheet reads to grow the field, lift it off
     the bar and dim everything behind it. The name is data-osp-searching
     rather than the panel's own, because the panel is found by walking up
     from the click with closest("[data-osp-jump]") -- an attribute of that
     name on <html> would make every element on the page answer yes,
     starting with the scrim, whose whole job is to be outside it. Driving all of that from one flag
     rather than from :focus-within is what lets the mode end while the caret
     is still in the field -- Escape once, or a click on the scrim. */
  var jumpLeaving = null;

  function openJump(open) {
    if (!jump) return;
    if (jumpLeaving) { clearTimeout(jumpLeaving); jumpLeaving = null; }
    jump.removeAttribute("data-osp-leaving");
    if (open) {
      jump.hidden = false;
      root.setAttribute("data-osp-searching", "");
      return;
    }
    root.removeAttribute("data-osp-searching");
    selected = -1;
    if (jump.hidden) return;
    /* Hiding it outright would take display away on the same frame and
       cancel the fade with it, so it is marked instead and hidden once the
       stylesheet has had its 110ms. The timer is cleared at the top of this
       function, which is what makes re-opening mid-exit safe: the mark comes
       off, the pending hide never lands, and the panel comes back rather
       than disappearing a moment after it returned. */
    jump.setAttribute("data-osp-leaving", "");
    jumpLeaving = setTimeout(function () {
      jumpLeaving = null;
      jump.removeAttribute("data-osp-leaving");
      jump.hidden = true;
    }, 120);
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

  /* The clear button is shown by what is in the field rather than by what
     the field is doing, so every path that empties it -- typing it empty,
     Escape, the button itself -- lands here and the button cannot be left
     standing over an empty box. */
  function paintClear(input) {
    var field = input.closest("[data-osp-search]");
    var button = field ? field.querySelector("[data-osp-search-clear]") : null;
    if (button) button.hidden = !input.value;
  }

  for (var n = 0; n < inputs.length; n++) {
    inputs[n].addEventListener("focus", function () { openJump(true); });
    inputs[n].addEventListener("input", function (event) {
      openJump(true);
      search(event.target.value);
      paintClear(event.target);
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
      if (event.target.value) {
        event.target.value = "";
        search("");
        paintClear(event.target);
      } else { openJump(false); event.target.blur(); }
    });
  }

  /* Pressing it is the same gesture as selecting the field and deleting
     what is in it, so it ends the same way: an empty field with the caret
     still in it and the recency list back underneath. Anything else would
     be a control that clears the search and then takes the search away. */
  var clears = document.querySelectorAll("[data-osp-search-clear]");
  for (var c = 0; c < clears.length; c++) {
    clears[c].addEventListener("click", function () {
      var field = this.closest("[data-osp-search]");
      var input = field ? field.querySelector("[data-osp-search-input]") : null;
      if (!input) return;
      input.value = "";
      search("");
      paintClear(input);
      openJump(true);
      input.focus();
    });
  }

  /* Anywhere that is not the field or its panel ends the search -- which,
     while the scrim is up, is every pixel the reader can see of the page
     underneath. The caret goes with it: leaving the field focused would
     leave it standing open at its typing width over a panel that had just
     closed. */
  document.addEventListener("pointerdown", function (event) {
    if (!jumpOpen()) return;
    if (event.target.closest("[data-osp-jump], [data-osp-search]")) return;
    openJump(false);
    var active = document.activeElement;
    if (active && active.hasAttribute("data-osp-search-input")) active.blur();
  });

  /* A slash opens the field that is actually on screen.
     Which one that is depends on the width. Wide, the panel is a column and
     its field is the one; narrow, the panel is a drawer and the field is
     inside it, so the slash has to open the drawer before it can reach it --
     a closed drawer is translated off the edge rather than taken out of the
     layout, so asking the element whether it is on screen gets the wrong
     answer, and the toggle being on screen is the reliable way to tell which
     of the two arrangements this is. */
  document.addEventListener("keydown", function (event) {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    var active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;

    if (panelToggle && panel && visible(panelToggle)) {
      event.preventDefault();
      if (!panelOpen()) showPanel(true, true);
      var drawerField = panel.querySelector("[data-osp-search-input]");
      if (drawerField) {
        drawerField.focus();
        drawerField.select();
        openJump(true);
      }
      return;
    }

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

  /* --- the in-page menu -------------------------------------------- *
     The outline, pinned under the crumb on the screens with no rail to put
     it in. It opens and closes on its own -- it is a <details> -- so all
     this adds is the two things markup cannot know: which section is being
     read, and that a reader who has picked one is finished with the list.
     ------------------------------------------------------------------ */

  var inpageNow = document.querySelector("[data-osp-inpage-now]");

  if (inpage) {
    inpage.addEventListener("click", function (event) {
      if (event.target.closest("a")) inpage.open = false;
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && inpage.open) {
        inpage.open = false;
        var head = inpage.querySelector("summary");
        if (head) head.focus();
      }
    });

    /* Tapping the note is as much a way of dismissing this as tapping the
       row again, and on a phone it is the one that needs no aim. */
    document.addEventListener("pointerdown", function (event) {
      if (!inpage.open) return;
      if (event.target.closest("[data-osp-inpage]")) return;
      inpage.open = false;
    });
  }

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

    /* A heading counts as reached once it has passed a line near the top of
       the window -- except that the last screenful of a page has no scroll
       left to push anything past it. A note whose final section is short
       (a footnote, a closing line) can be scrolled to its very end with
       that heading still sitting halfway down the window, so the mark stops
       short and the section the reader is actually in never lights up.

       So in the final stretch the line travels down the window instead of
       the page travelling up past it: with a screenful to go it is still at
       140, and at the bottom it is the foot of the window, which is where
       the last heading necessarily is. The two meet exactly, so the mark
       keeps moving at one pace rather than snapping at the end. */
    var line = 140;
    var remaining =
      document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
    if (remaining < window.innerHeight - line) line = window.innerHeight - remaining;

    var active = targets[0];
    for (var i = 0; i < targets.length; i++) {
      if (targets[i].heading.getBoundingClientRect().top < line) active = targets[i];
    }
    for (var j = 0; j < targets.length; j++) {
      var on = targets[j] === active;
      targets[j].link.classList.toggle("osp-active", on);
      if (on) targets[j].link.setAttribute("aria-current", "true");
      else targets[j].link.removeAttribute("aria-current");
    }

    /* Shut, the in-page row says where in the note the reader is, which is
       the question a long page on a small screen stops answering first. */
    if (inpageNow && active) {
      var name = active.link.textContent;
      if (inpageNow.textContent !== name) inpageNow.textContent = name;
    }

    /* A long outline scrolls on its own, so the active row is kept in sight
       -- but only when it has left, or the rail twitches on every frame.

       And only when the rail is a scrolling box at all. Below 56rem it is
       not: it sits under the note as part of the page, and scrolling a row
       of it into view would scroll the document, dragging the reader out of
       the article they were reading and down to its own table of contents. */
    if (rail && active && rail.scrollHeight > rail.clientHeight) {
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
    var label = button.querySelector(".osp-code-btn-label, [data-osp-copy-label]");
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
    /* A code block and the note's own source are the same job: the button
       sits above a <pre>, and what it copies is that block's text. */
    var block = copyBtn.closest("[data-osp-code], [data-osp-source-pane]");
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
})();`;
