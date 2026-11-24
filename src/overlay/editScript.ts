/**
 * The edit notch, as it runs in the browser.
 *
 * Never part of a build. The review server adds it to an as-is page on the
 * way out, in a local preview, and nowhere else -- see `editablePage` in
 * `server.ts` -- so a published site cannot carry it, whatever the settings
 * say, because nothing that writes a site ever sees this string.
 *
 * It goes in `<head>`, ahead of the page's own scripts, and on its own does
 * nothing but announce itself as `window.__ospEdit`. The review overlay,
 * which arrives at the end of the page, finds that and adds an Edit mode to
 * its notch; entering the mode calls `enter`, leaving it calls `exit`. The
 * edit UI is drawn inside the overlay's shadow root, so it shares the
 * overlay's theme and, like it, can neither be restyled by the page nor
 * restyle it.
 *
 * **In Edit mode the page is not running for the pointer.** Clicks, presses
 * and keys are caught at the window, in the capture phase, before the page's
 * own handlers see them: a click selects instead of following a link, and an
 * arrow key does not turn a slide. The overlay's own letters (V, C, R, E, H)
 * are let through, so the modes can still be switched from the keyboard.
 * View mode is where the page is used.
 *
 * **Selection works like a design tool's.** A click selects the outermost
 * thing under the pointer that is not the size of the whole page, which is a
 * card rather than a slide, a phone frame rather than the body. After that,
 * a click selects among the selection's siblings; a double-click goes inside
 * it; Esc goes up to its parent. Alt-click goes straight to the deepest
 * element under the pointer.
 *
 * **Every element is named by where it starts in the file**, the
 * `data-osp-src` stamp the server put on it. After each edit the server says
 * which characters changed, and every stamp on the page is moved to match,
 * so the next edit names the right element without a reload. An element with
 * no stamp was made by a script: it is selectable, so the page can be
 * explored, but it cannot be changed from here, and the bar says why.
 */
/**
 * Colour, as it runs in the browser: spliced into `EDIT_SCRIPT`'s closure.
 *
 * Kept as its own raw string because it is mostly regular expressions, and
 * a template literal would want every backslash in them doubled.
 *
 * The browser has already run the cascade, so this is where the question
 * "where does this colour come from" is answered: the element's style
 * attribute, a rule in one of the file's own `<style>` blocks (named by the
 * block's stamp and the rule's CSSOM index path), a CSS variable, or a
 * stylesheet the notch cannot write to. The answer decides whether to ask
 * "this one or all of them" before anything is written.
 */
const EDIT_COLOUR = String.raw`
  /* --- colour ---------------------------------------------------------- */

  /* Which panel is open under the bar: "colour", "size", "layout", or null. */
  var panel = null;
  var colourSlot = null;
  /* A question waiting on an answer: { text, choices: [{ label, run }] }. */
  var ask = null;

  function togglePanel(name) {
    panel = panel === name ? null : name;
    ask = null;
    refresh();
  }

  function toggleColour() {
    togglePanel("colour");
  }

  function toHex(value) {
    var m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,\/]\s*([\d.]+%?))?\s*\)$/.exec(value || "");
    if (!m) return value;
    var alpha = m[4] === undefined ? 1 : m[4].slice(-1) === "%" ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (alpha < 1) return value.replace(/\s+/g, " ");
    var hex = "#";
    for (var i = 1; i <= 3; i++) {
      var h = Number(m[i]).toString(16);
      hex += h.length < 2 ? "0" + h : h;
    }
    return hex;
  }

  function transparent(value) {
    return !value || value === "transparent" || value === "none" || /,\s*0\)$/.test(value) || /\/\s*0\)$/.test(value);
  }

  function isColour(value) {
    if (!value) return false;
    try {
      return typeof CSS === "undefined" || !CSS.supports ? /^(#|rgb|hsl)/.test(value) : CSS.supports("color", value);
    } catch (e) {
      return false;
    }
  }

  /* The colours this element actually shows, each with the property that sets it. */
  function slotsFor(target) {
    var cs = window.getComputedStyle(target);
    var out = [];
    if (typeof SVGElement !== "undefined" && target instanceof SVGElement) {
      out.push({ prop: "fill", label: "Fill", value: cs.fill });
      out.push({ prop: "stroke", label: "Stroke", value: cs.stroke });
      return out;
    }
    out.push({ prop: "background-color", label: "Background", value: cs.backgroundColor });
    if (/\S/.test(target.textContent || "")) out.push({ prop: "color", label: "Text", value: cs.color });
    var sides = ["top", "right", "bottom", "left"].filter(function (side) {
      return parseFloat(cs.getPropertyValue("border-" + side + "-width")) > 0 &&
        cs.getPropertyValue("border-" + side + "-style") !== "none";
    });
    if (sides.length) {
      out.push({
        prop: sides.length === 4 ? "border-color" : "border-" + sides[0] + "-color",
        label: "Border",
        value: cs.getPropertyValue("border-" + sides[0] + "-color"),
      });
    }
    return out;
  }

  /* --- the cascade, as the page sees it -------------------------------- */

  /*
   * Every style rule in every sheet the page can read, with the CSSOM index
   * path the server needs and whether its @media currently applies.
   */
  function walkRules(visit) {
    var order = 0;
    function walk(rules, path, owner, on) {
      for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        var at = path.concat(i);
        if (rule.selectorText !== undefined && rule.style) {
          visit(rule, at, owner, on, order++);
        } else if (rule.cssRules) {
          var applies = on;
          try {
            if (rule.media && rule.media.mediaText) applies = applies && window.matchMedia(rule.media.mediaText).matches;
            else if (rule.conditionText && typeof CSS !== "undefined" && CSS.supports) applies = applies && CSS.supports(rule.conditionText);
          } catch (e) {}
          walk(rule.cssRules, at, owner, applies);
        }
      }
    }
    for (var s = 0; s < document.styleSheets.length; s++) {
      var sheet = document.styleSheets[s];
      var rules;
      try {
        rules = sheet.cssRules;
      } catch (e) {
        continue;
      }
      if (sheet.disabled) continue;
      var sheetOn = true;
      try {
        if (sheet.media && sheet.media.mediaText) sheetOn = window.matchMedia(sheet.media.mediaText).matches;
      } catch (e) {}
      walk(rules, [], sheet.ownerNode, sheetOn);
    }
  }

  /* A selector list split at its top-level commas. */
  function selectorParts(list) {
    var out = [];
    var depth = 0;
    var start = 0;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (c === "," && depth === 0) {
        out.push(list.slice(start, i));
        start = i + 1;
      }
    }
    out.push(list.slice(start));
    return out;
  }

  /* Close enough to the real rule for choosing between a page's own rules. */
  function specificity(selector) {
    var s = selector.replace(/:where\([^)]*\)/g, "");
    var ids = (s.match(/#[\w-]+/g) || []).length;
    var classes = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length;
    var types = (s.replace(/:[\w-]+(\([^)]*\))?/g, "").replace(/\[[^\]]*\]/g, "").match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length +
      (s.match(/::[\w-]+/g) || []).length;
    return ids * 10000 + classes * 100 + types;
  }

  function matchSpecificity(target, selectorText) {
    var best = -1;
    var parts = selectorParts(selectorText);
    for (var i = 0; i < parts.length; i++) {
      try {
        if (target.matches(parts[i])) best = Math.max(best, specificity(parts[i].trim()));
      } catch (e) {}
    }
    return best;
  }

  function better(a, b) {
    if (!b) return true;
    if (a.important !== b.important) return a.important > b.important;
    if (a.spec !== b.spec) return a.spec > b.spec;
    return a.order > b.order;
  }

  /* The declaration that sets prop on target, or null when it is inherited or the default. */
  function winning(target, prop) {
    if (target.style && target.style.getPropertyValue(prop)) {
      return { kind: "inline", value: target.style.getPropertyValue(prop) };
    }
    var best = null;
    walkRules(function (rule, path, owner, on, order) {
      if (!on) return;
      var value = rule.style.getPropertyValue(prop);
      if (!value) return;
      var spec = matchSpecificity(target, rule.selectorText);
      if (spec < 0) return;
      var found = {
        kind: "rule",
        rule: rule,
        path: path,
        owner: owner,
        value: value.trim(),
        spec: spec,
        important: rule.style.getPropertyPriority(prop) === "important" ? 1 : 0,
        order: order,
      };
      if (better(found, best)) best = found;
    });
    return best;
  }

  /* Where a custom property gets its value for target: the nearest ancestor with a rule. */
  function tokenRule(target, name) {
    for (var n = target; n && n.nodeType === 1; n = n.parentElement) {
      var best = null;
      walkRules(function (rule, path, owner, on, order) {
        if (!on || !rule.style.getPropertyValue(name)) return;
        var spec = matchSpecificity(n, rule.selectorText);
        if (spec < 0) return;
        var found = { kind: "rule", rule: rule, path: path, owner: owner, spec: spec, important: 0, order: order };
        if (better(found, best)) best = found;
      });
      if (best) return best;
    }
    return null;
  }

  /* A linked stylesheet's path beside the page, as the server names it, or "". */
  function sheetPath(owner) {
    if (!owner || owner.tagName !== "LINK" || !owner.href) return "";
    try {
      var url = new URL(owner.href, location.href);
      if (url.origin !== location.origin) return "";
      return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    } catch (e) {
      return "";
    }
  }

  /* The file's own <style> blocks, and the linked sheets the server said it may write. */
  function editableSheet(owner) {
    if (!owner) return false;
    if (owner.tagName === "STYLE") return stampOf(owner) !== null;
    var path = sheetPath(owner);
    return !!path && (boot.sheets || []).indexOf(path) !== -1;
  }

  function sheetName(owner) {
    if (owner && owner.tagName === "LINK") return (owner.getAttribute("href") || "a linked stylesheet").split("/").pop();
    return "a stylesheet the page's script made";
  }

  function uses(name) {
    var n = 0;
    walkRules(function (rule) {
      if (rule.style.cssText.indexOf("var(" + name) !== -1) n++;
    });
    return n === 1 ? "in 1 rule" : "in " + n + " rules";
  }

  function countMatching(selectorText) {
    try {
      var all = document.querySelectorAll(selectorText);
      var n = 0;
      for (var i = 0; i < all.length; i++) if (!ours(all[i])) n++;
      return n;
    } catch (e) {
      return 0;
    }
  }

  /* --- the palette ----------------------------------------------------- */

  /* The page's colour tokens: custom properties whose value is a colour. */
  function tokens() {
    var names = {};
    walkRules(function (rule) {
      for (var i = 0; i < rule.style.length; i++) {
        if (rule.style[i].indexOf("--") === 0) names[rule.style[i]] = 1;
      }
    });
    var root = window.getComputedStyle(document.documentElement);
    var out = [];
    for (var name in names) {
      var value = root.getPropertyValue(name).trim();
      if (value && isColour(value) && out.length < 16) out.push({ name: name, value: value });
    }
    return out;
  }

  /* The colours the page already uses, most used first. */
  function pageColours() {
    var count = {};
    var nodes = document.querySelectorAll("[" + ATTR + "]");
    for (var i = 0; i < nodes.length && i < 400; i++) {
      if (nodes[i].tagName === "STYLE") continue;
      var cs = window.getComputedStyle(nodes[i]);
      var seen = [cs.color, cs.backgroundColor];
      for (var j = 0; j < seen.length; j++) {
        if (transparent(seen[j])) continue;
        var hex = toHex(seen[j]);
        count[hex] = (count[hex] || 0) + 1;
      }
    }
    return Object.keys(count)
      .sort(function (a, b) {
        return count[b] - count[a];
      })
      .slice(0, 10);
  }

  /* --- choosing and writing -------------------------------------------- */

  function currentSlot() {
    if (!selected) return null;
    var slots = slotsFor(selected);
    for (var i = 0; i < slots.length; i++) if (slots[i].prop === colourSlot) return slots[i];
    return slots[0] || null;
  }

  function choose(value) {
    var target = selected;
    var slot = currentSlot();
    if (!target || !slot || busy || styleWhyNot(target)) return;
    var what = slot.label.toLowerCase();
    var props = [[slot.prop, value]];
    var win = winning(target, slot.prop);

    // A size-bound change never rewrites the token every size shares.
    var token = !narrow && win && win.kind === "rule" ? /var\(\s*(--[\w-]+)/.exec(win.value) : null;
    if (token) {
      var def = tokenRule(target, token[1]);
      if (def && editableSheet(def.owner)) {
        ask = {
          text: "This " + what + " comes from the token " + token[1] + ", used " + uses(token[1]) + ".",
          choices: [
            { label: "Change " + token[1], run: function () { applyRuleProps(def, [[token[1], value]], "the token " + token[1]); } },
            whyNot(target)
              ? { label: "Just elements like this", run: function () { addRuleFor(target, props, what, null); } }
              : { label: "Just this one", run: function () { applyInlineProps(target, props, what); } },
          ],
        };
        refresh();
        return;
      }
    }
    styleChange(target, props, what);
  }

  /*
   * Sets declarations on an element where they belong: in the rule that
   * already sets the first of them, if that rule styles only this element;
   * after asking, if it styles others too; and in the element's own style
   * attribute when nothing sets it, or when the rule is somewhere the notch
   * cannot write.
   */
  function styleChange(target, props, what) {
    if (!target || busy || styleWhyNot(target)) return;
    if (narrow) return addRuleFor(target, props, what, widthQuery());
    if (whyNot(target)) return generatedStyle(target, props, what);
    var win = winning(target, props[0][0]);
    if (!win || win.kind === "inline") return applyInlineProps(target, props, what);

    if (!editableSheet(win.owner)) {
      ask = {
        text: "The " + what + " is set in " + sheetName(win.owner) + ", which can't be edited from here yet.",
        choices: [{ label: "Set it on this one", run: function () { applyInlineProps(target, props, what); } }],
      };
      refresh();
      return;
    }

    var n = countMatching(win.rule.selectorText);
    if (n > 1) {
      ask = {
        text: "The rule " + win.rule.selectorText + " sets the " + what + " of " + n + " elements.",
        choices: [
          { label: "This one", run: function () { applyInlineProps(target, props, what); } },
          { label: "All " + n, run: function () { applyRuleProps(win, props, win.rule.selectorText); } },
        ],
      };
      refresh();
      return;
    }
    applyRuleProps(win, props, win.rule.selectorText);
  }

  function applyInlineProps(target, props, what) {
    ask = null;
    var name = label(target);
    var before = null;
    act(
      { op: "inline-style", at: stampOf(target), props: props },
      what + " change on " + name,
      function (data) {
        before = target.getAttribute("style");
        quiet(function () {
          for (var i = 0; i < props.length; i++) target.style.setProperty(props[i][0], props[i][1]);
        });
        remap(data.edits);
      },
      function (back) {
        remap(back.edits);
        quiet(function () {
          if (before === null) target.removeAttribute("style");
          else target.setAttribute("style", before);
        });
      },
      function () {
        message = "Set the " + what + " of " + name + " on the element itself.";
      },
    );
  }

  function applyRuleProps(win, props, what) {
    ask = null;
    var rule = win.rule;
    var old = null;
    var sheet = win.owner.tagName === "STYLE" ? stampOf(win.owner) : sheetPath(win.owner);
    act(
      { op: "rule-style", sheet: sheet, path: win.path, selector: rule.selectorText, props: props },
      "change to " + what,
      function (data) {
        old = props.map(function (pair) {
          return [pair[0], rule.style.getPropertyValue(pair[0]), rule.style.getPropertyPriority(pair[0])];
        });
        for (var i = 0; i < props.length; i++) rule.style.setProperty(props[i][0], props[i][1], old[i][2]);
        remap(data.edits);
      },
      function (back) {
        remap(back.edits);
        for (var j = old.length - 1; j >= 0; j--) {
          if (old[j][1]) rule.style.setProperty(old[j][0], old[j][1], old[j][2]);
          else rule.style.removeProperty(old[j][0]);
        }
      },
      function () {
        message =
          "Changed " + props.map(function (pair) { return pair[0]; }).join(", ") + " in " + what +
          (typeof sheet === "string" ? " (" + sheet.split("/").pop() + ")" : "") + ".";
      },
    );
  }

  /* --- styling what the file does not hold ----------------------------- */

  /* Classes that describe a moment rather than a kind of thing. */
  var STATE_CLASS = /^(is-|has-)|^(active|selected|open|hidden|show|shown|visible|current|focus|focused|hover|disabled|loading)$/;

  function ident(name) {
    return /^-?[_a-zA-Z][\w-]*$/.test(name);
  }

  /*
   * A selector for target that survives the page's script re-rendering it:
   * an id that looks written rather than generated, else its tag and its
   * classes, else the same for its parent. Empty when nothing names it.
   */
  function stableSelector(target) {
    var parts = [];
    var n = target;
    for (var depth = 0; n && !isRoot(n) && depth < 4; depth++, n = n.parentElement) {
      if (n.id && ident(n.id) && !/\d{3,}/.test(n.id)) {
        parts.unshift("#" + n.id);
        break;
      }
      var classes = Array.prototype.filter.call(n.classList, function (name) {
        return ident(name) && !STATE_CLASS.test(name);
      });
      parts.unshift(n.tagName.toLowerCase() + (classes.length ? "." + classes.join(".") : ""));
      if (classes.length) break;
    }
    var selector = parts.join(" > ");
    try {
      return selector && target.matches(selector) ? selector : "";
    } catch (e) {
      return "";
    }
  }

  /* Why target's look cannot be changed, or "" when it can, by one route or another. */
  function styleWhyNot(target) {
    if (unavailable) return unavailable;
    if (stale) return stale;
    if (!whyNot(target)) return "";
    if (!stableSelector(target)) {
      return "This was made by the page's script and has nothing to name it by, so it can't be styled from here.";
    }
    return "";
  }

  function generatedHint(target) {
    var selector = stableSelector(target);
    var n = countMatching(selector);
    return "Made by the page's script, so it isn't in the file. Colour, size and layout go into a rule for " +
      selector + (n > 1 ? ", which styles all " + n + " elements like it." : ".");
  }

  function generatedStyle(target, props, what) {
    var selector = stableSelector(target);
    var win = winning(target, props[0][0]);
    if (win && win.kind === "inline") {
      message = "The page's script sets this " + what + " on the element itself, so a rule in the file can't override it.";
      refresh();
      return;
    }
    if (win && win.kind === "rule" && editableSheet(win.owner)) {
      // The file already has the rule for these elements: change it there
      // rather than add a second one beside it.
      if (countMatching(win.rule.selectorText) <= countMatching(selector)) {
        return applyRuleProps(win, props, win.rule.selectorText);
      }
    }
    // A broader rule that a new one would not beat is the one to change, if at all.
    if (win && win.kind === "rule" && editableSheet(win.owner) && win.spec > specificity(selector)) {
      var n = countMatching(win.rule.selectorText);
      if (n > 1) {
        ask = {
          text: "The rule " + win.rule.selectorText + " sets the " + what + " of " + n + " elements, and a new rule would not win against it.",
          choices: [{ label: "All " + n, run: function () { applyRuleProps(win, props, win.rule.selectorText); } }],
        };
        refresh();
        return;
      }
      return applyRuleProps(win, props, win.rule.selectorText);
    }
    addRuleFor(target, props, what, null);
  }

  /* --- one size and below ---------------------------------------------- */

  /* True while changes apply to this window width and narrower only. */
  var narrow = false;

  function widthQuery() {
    return "(max-width: " + window.innerWidth + "px)";
  }

  /* Whether the page already changes with the window's width. */
  function respondsToWidth() {
    var found = false;
    for (var s = 0; s < document.styleSheets.length && !found; s++) {
      var rules;
      try {
        rules = document.styleSheets[s].cssRules;
      } catch (e) {
        continue;
      }
      for (var i = 0; i < rules.length; i++) {
        if (rules[i].media && /width/.test(rules[i].media.mediaText || "")) {
          found = true;
          break;
        }
      }
    }
    return found;
  }

  function lastSheet() {
    var all = document.querySelectorAll("style[" + ATTR + "]");
    return all.length ? all[all.length - 1] : null;
  }

  var addedSheet = null;

  /*
   * Writes props into a rule for target's stable selector -- inside a
   * max-width block when media is given -- in the file's last <style>, and
   * mirrors it into the page so the change shows without a reload.
   */
  function addRuleFor(target, props, what, media) {
    ask = null;
    var selector = stableSelector(target);
    if (!selector) {
      message = "Nothing names this element well enough to write a rule for it.";
      refresh();
      return;
    }
    var sheet = lastSheet();
    var n = countMatching(selector);
    var body = { op: "add-rule", sheet: sheet ? stampOf(sheet) : null, selector: selector, props: props };
    if (media) body.media = media;
    var css = selector + "{" + props.map(function (pair) { return pair[0] + ":" + pair[1]; }).join(";") + "}";
    if (media) css = "@media " + media + "{" + css + "}";
    var live = null;
    var index = -1;
    act(
      body,
      what + " rule for " + selector,
      function (data) {
        live = sheet;
        if (!live) {
          if (!addedSheet) {
            addedSheet = document.createElement("style");
            addedSheet.setAttribute("data-osp-added", "");
            document.head.appendChild(addedSheet);
          }
          live = addedSheet;
        }
        try {
          index = live.sheet.insertRule(css, live.sheet.cssRules.length);
        } catch (e) {
          index = -1;
        }
        remap(data.edits);
      },
      function (back) {
        remap(back.edits);
        if (index >= 0) {
          try {
            live.sheet.deleteRule(index);
          } catch (e) {}
        }
      },
      function () {
        message =
          (media ? "At this width and narrower: " : "") +
          "added a rule for " + selector + (n > 1 ? ", which styles " + n + " elements like it." : ".") +
          (sheet ? "" : " The file had no style block, so one went into its head.");
      },
    );
  }

  function renderScope() {
    var box = ui.scope;
    box.textContent = "";
    var show = !!selected && !styleWhyNot(selected) && !editing && (narrow || respondsToWidth());
    box.hidden = !show;
    if (!show) return;
    box.appendChild(el("span", "ed-row-label", "Applies at"));
    var all = button("All sizes", "Change it at every window width", function () {
      narrow = false;
      refresh();
    });
    var below = button("Up to " + window.innerWidth + "px", "Change it at this window width and narrower only", function () {
      narrow = true;
      refresh();
    });
    all.classList.add("ed-seg");
    below.classList.add("ed-seg");
    (narrow ? below : all).setAttribute("aria-pressed", "true");
    box.appendChild(all);
    box.appendChild(below);
  }

  /* --- the panel ------------------------------------------------------- */

  function swatch(display, write, title) {
    var b = el("button", "ed-swatch");
    b.type = "button";
    b.title = title;
    b.setAttribute("aria-label", title);
    b.style.background = display;
    b.addEventListener("click", function (event) {
      event.stopPropagation();
      choose(write);
    });
    return b;
  }

  function renderColour() {
    var box = ui.colourPanel;
    box.textContent = "";
    var show = panel === "colour" && !!selected && !styleWhyNot(selected) && !editing;
    box.hidden = !show;
    ui.colourBtn.setAttribute("aria-pressed", panel === "colour" ? "true" : "false");
    if (!show) return;

    var slots = slotsFor(selected);
    var slot = currentSlot();
    colourSlot = slot ? slot.prop : null;
    var tabs = el("div", "ed-tabs");
    slots.forEach(function (each) {
      var tab = el("button", "ed-tab");
      tab.type = "button";
      if (each.prop === colourSlot) tab.setAttribute("data-current", "");
      var chip = el("span", "ed-chip");
      chip.style.background = each.value;
      if (transparent(each.value)) chip.setAttribute("data-none", "");
      tab.appendChild(chip);
      tab.appendChild(document.createTextNode(each.label));
      tab.title = each.prop + ": " + (transparent(each.value) ? "none" : toHex(each.value));
      tab.addEventListener("click", function (event) {
        event.stopPropagation();
        colourSlot = each.prop;
        ask = null;
        refresh();
      });
      tabs.appendChild(tab);
    });
    box.appendChild(tabs);

    var grid = el("div", "ed-swatches");
    tokens().forEach(function (token) {
      grid.appendChild(swatch(token.value, "var(" + token.name + ")", token.name + " (" + token.value + ")"));
    });
    pageColours().forEach(function (hex) {
      grid.appendChild(swatch(hex, hex, hex));
    });
    var custom = el("input", "ed-custom");
    custom.type = "color";
    var hex = slot ? toHex(slot.value) : "";
    custom.value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#000000";
    custom.title = "Any colour";
    custom.setAttribute("aria-label", "Any colour");
    custom.addEventListener("change", function () {
      choose(custom.value);
    });
    grid.appendChild(custom);
    box.appendChild(grid);
  }

  /* The question a change is waiting on, shown above whichever panel is open. */
  function renderAsk() {
    var box = ui.ask;
    box.textContent = "";
    box.hidden = !ask;
    if (!ask) return;
    box.appendChild(el("span", "ed-ask-text", ask.text));
    ask.choices.forEach(function (choice) {
      box.appendChild(button(choice.label, choice.label, choice.run));
    });
    box.appendChild(button("Cancel", "Change nothing", function () {
      ask = null;
      refresh();
    }));
  }
`;

/**
 * Size and layout, spliced into `EDIT_SCRIPT`'s closure after colour.
 *
 * The verbs are the same everywhere and what they write depends on where
 * the element sits. Fill is `flex: 1 1 0%` along a flex row, `align-self:
 * stretch` across one, `justify-self: stretch` in a grid and `width: auto`
 * in normal flow; Hug and Fixed map the same way. The panel says which of
 * those it is, so nothing surprising lands in the file.
 *
 * Leaving the layout is never a side effect of dragging. An element in flow
 * is reordered when it is dragged; only "Detach from layout" makes it
 * positioned, and only a positioned element is moved by coordinates.
 */
const EDIT_LAYOUT = String.raw`
  /* --- where an element sits ------------------------------------------- */

  function parentLayout(target) {
    var parent = target.parentElement;
    // A positioned element has left its parent's layout: nothing there sizes it.
    if (!parent || isRoot(parent) || positioned(target)) return { kind: "flow" };
    var cs = window.getComputedStyle(parent);
    if (/flex/.test(cs.display)) return { kind: "flex", row: !/column/.test(cs.flexDirection), alignItems: cs.alignItems };
    if (/grid/.test(cs.display)) return { kind: "grid" };
    return { kind: "flow" };
  }

  function positioned(target) {
    var p = window.getComputedStyle(target).position;
    return p === "absolute" || p === "fixed";
  }

  function declared(target, prop) {
    var win = winning(target, prop);
    return win ? win.value : "";
  }

  /* A border-box size in the units the element's own width and height use. */
  function cssLength(target, dim, borderBox) {
    var cs = window.getComputedStyle(target);
    if (cs.boxSizing === "border-box") return borderBox;
    var sides = dim === "width" ? ["left", "right"] : ["top", "bottom"];
    var extra = 0;
    for (var i = 0; i < 2; i++) {
      extra += parseFloat(cs.getPropertyValue("padding-" + sides[i])) || 0;
      extra += parseFloat(cs.getPropertyValue("border-" + sides[i] + "-width")) || 0;
    }
    return Math.max(0, borderBox - extra);
  }

  /* --- size ------------------------------------------------------------ */

  function sizeMode(target, dim) {
    var cs = window.getComputedStyle(target);
    var lay = parentLayout(target);
    var value = declared(target, dim);
    if (/px$/.test(value)) return "fixed";
    if (lay.kind === "flex") {
      if ((dim === "width") === lay.row) return parseFloat(cs.flexGrow) > 0 ? "fill" : "hug";
      var self = cs.alignSelf === "auto" || cs.alignSelf === "normal" ? lay.alignItems : cs.alignSelf;
      return self === "stretch" || self === "normal" ? "fill" : "hug";
    }
    if (lay.kind === "grid") {
      var place = dim === "width" ? cs.justifySelf : cs.alignSelf;
      return place === "stretch" || place === "normal" || place === "auto" ? "fill" : "hug";
    }
    if (dim === "width") {
      if (/content/.test(value)) return "hug";
      return cs.display === "block" || value === "100%" ? "fill" : "hug";
    }
    return value === "100%" ? "fill" : "hug";
  }

  /* The declarations that give target this size, given where it sits. */
  function sizeProps(target, dim, mode, length) {
    var lay = parentLayout(target);
    var main = lay.kind === "flex" && (dim === "width") === lay.row;
    var cross = lay.kind === "flex" && !main;
    var self = dim === "width" ? "justify-self" : "align-self";
    if (mode === "fixed") {
      var out = [[dim, Math.max(0, Math.round(length)) + "px"]];
      if (main) out.push(["flex", "0 0 auto"]);
      return out;
    }
    if (mode === "fill") {
      if (main) return [[dim, "auto"], ["flex", "1 1 0%"]];
      if (cross) return [[dim, "auto"], ["align-self", "stretch"]];
      if (lay.kind === "grid") return [[dim, "auto"], [self, "stretch"]];
      if (dim === "width") return [["width", window.getComputedStyle(target).display === "block" ? "auto" : "100%"]];
      return [["height", "100%"]];
    }
    if (main) return [[dim, "auto"], ["flex", "0 0 auto"]];
    if (cross) return [[dim, "auto"], ["align-self", "flex-start"]];
    if (lay.kind === "grid") return [[dim, "auto"], [self, "start"]];
    return dim === "width" ? [["width", "fit-content"]] : [["height", "auto"]];
  }

  function setSize(dim, mode, length) {
    var target = selected;
    if (!target) return;
    if (mode === "fixed" && !(length >= 0)) {
      length = cssLength(target, dim, target.getBoundingClientRect()[dim]);
    }
    styleChange(target, sizeProps(target, dim, mode, length), dim);
  }

  function layoutNote(target) {
    var lay = parentLayout(target);
    if (positioned(target)) return "It is positioned: drag it to move it. It snaps to its container's edges and centre.";
    if (lay.kind === "flex") {
      return "It sits in a flex " + (lay.row ? "row" : "column") + ": Fill takes a share of the spare " +
        (lay.row ? "width" : "height") + ". Spacing between items is the parent's gap (Esc, then Layout).";
    }
    if (lay.kind === "grid") return "It sits in a grid cell: Fill fills the cell, Hug shrinks to its content.";
    return "It sits in normal flow: Fill takes the full width available.";
  }

  /* Merges declaration lists, the later of two settings of a property winning. */
  function merge(lists) {
    var out = [];
    var at = {};
    for (var i = 0; i < lists.length; i++) {
      for (var j = 0; j < lists[i].length; j++) {
        var pair = lists[i][j];
        if (at[pair[0]] !== undefined) out[at[pair[0]]] = pair;
        else {
          at[pair[0]] = out.length;
          out.push(pair);
        }
      }
    }
    return out;
  }

  /* --- resizing by the handles ----------------------------------------- */

  function startResize(event, dims) {
    var target = selected;
    if (!target || busy || styleWhyNot(target)) return;
    event.preventDefault();
    event.stopPropagation();
    var start = target.getBoundingClientRect();
    var x0 = event.clientX;
    var y0 = event.clientY;
    var before = target.getAttribute("style");
    var main = parentLayout(target).kind === "flex";
    resizing = true;
    // Ended from onPointer, which sees the release first and must not let
    // the page have it -- so it cannot be a listener after that one.
    endResize = up;

    function move(e) {
      var w = Math.max(1, start.width + (dims.w ? e.clientX - x0 : 0));
      var h = Math.max(1, start.height + (dims.h ? e.clientY - y0 : 0));
      // A preview in the element's own style; the real write happens on release.
      quiet(function () {
        if (dims.w) target.style.setProperty("width", cssLength(target, "width", w) + "px");
        if (dims.h) target.style.setProperty("height", cssLength(target, "height", h) + "px");
        if (main) target.style.setProperty("flex", "0 0 auto");
      });
      ui.status.textContent = Math.round(w) + " × " + Math.round(h);
      draw();
    }

    function up() {
      window.removeEventListener("pointermove", move, true);
      resizing = false;
      endResize = null;
      var r = target.getBoundingClientRect();
      var width = cssLength(target, "width", r.width);
      var height = cssLength(target, "height", r.height);
      quiet(function () {
        if (before === null) target.removeAttribute("style");
        else target.setAttribute("style", before);
      });
      var lists = [];
      if (dims.w) lists.push(sizeProps(target, "width", "fixed", width));
      if (dims.h) lists.push(sizeProps(target, "height", "fixed", height));
      styleChange(target, merge(lists), "size");
    }

    window.addEventListener("pointermove", move, true);
  }

  /* --- leaving the layout, and moving freely --------------------------- */

  /* The box an absolutely positioned element is placed against, or null for the page. */
  function containingBlock(target) {
    for (var n = target.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      var cs = window.getComputedStyle(n);
      if (cs.position !== "static" || (cs.transform && cs.transform !== "none")) return n;
    }
    return null;
  }

  function placeOrigin(block) {
    if (!block) return { left: -window.scrollX, top: -window.scrollY, width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    var r = block.getBoundingClientRect();
    return {
      left: r.left + block.clientLeft - block.scrollLeft,
      top: r.top + block.clientTop - block.scrollTop,
      width: block.clientWidth,
      height: block.clientHeight,
    };
  }

  function detach() {
    var target = selected;
    if (!target || busy || styleWhyNot(target)) return;
    var cs = window.getComputedStyle(target);
    var r = target.getBoundingClientRect();
    var origin = placeOrigin(containingBlock(target));
    var left = Math.round(r.left - origin.left - (parseFloat(cs.marginLeft) || 0));
    var top = Math.round(r.top - origin.top - (parseFloat(cs.marginTop) || 0));
    styleChange(
      target,
      [
        ["position", "absolute"],
        ["left", left + "px"],
        ["top", top + "px"],
        ["width", Math.round(cssLength(target, "width", r.width)) + "px"],
      ],
      "position",
    );
  }

  var SNAP = 6;

  /*
   * Where a positioned element dragged by (dx, dy) lands: its new left and
   * top, snapped to its container's edges and centre when within a few
   * pixels of one, and which snaps took.
   */
  function freePlace(target, dx, dy) {
    var r = target.getBoundingClientRect();
    var cs = window.getComputedStyle(target);
    var origin = placeOrigin(containingBlock(target));
    var ml = parseFloat(cs.marginLeft) || 0;
    var mt = parseFloat(cs.marginTop) || 0;
    var left = r.left - origin.left - ml + dx;
    var top = r.top - origin.top - mt + dy;
    var snapped = [];
    var guides = { x: null, y: null, origin: origin };
    function snap(value, size, room, names, axisName) {
      var stops = [0, (room - size) / 2, room - size];
      for (var i = 0; i < 3; i++) {
        if (Math.abs(value - stops[i]) <= SNAP) {
          snapped.push(names[i]);
          // Where the line it lined up with is: an edge or the middle of the container.
          guides[axisName] = i === 0 ? 0 : i === 1 ? room / 2 : room;
          return stops[i];
        }
      }
      return value;
    }
    left = snap(left, r.width, origin.width, ["left edge", "centre", "right edge"], "x");
    top = snap(top, r.height, origin.height, ["top edge", "middle", "bottom edge"], "y");
    return { left: Math.round(left), top: Math.round(top), snapped: snapped, guides: guides };
  }

  function previewFree(target, dx, dy) {
    var spot = freePlace(target, dx, dy);
    var r = target.getBoundingClientRect();
    var cs = window.getComputedStyle(target);
    var origin = placeOrigin(containingBlock(target));
    var now = { left: r.left - origin.left - (parseFloat(cs.marginLeft) || 0), top: r.top - origin.top - (parseFloat(cs.marginTop) || 0) };
    freeDrag.shown = { x: spot.left - now.left + freeDrag.shown.x, y: spot.top - now.top + freeDrag.shown.y };
    quiet(function () {
      target.style.setProperty("translate", freeDrag.shown.x + "px " + freeDrag.shown.y + "px");
    });
    showGuides(spot.guides);
    ui.status.textContent = "left " + spot.left + ", top " + spot.top + (spot.snapped.length ? " (snapped to " + spot.snapped.join(" and ") + ")" : "");
  }

  /* Lines across the container where a dragged element has snapped. */
  function showGuides(guides) {
    var o = guides && guides.origin && toHost(guides.origin);
    var k = guides && guides.origin && guides.origin.width ? o.width / guides.origin.width : 1;
    var gx = ui.guideX;
    var gy = ui.guideY;
    gx.hidden = !o || guides.x === null;
    gy.hidden = !o || guides.y === null;
    if (!gx.hidden) {
      gx.style.left = o.left + guides.x * k - 0.5 + "px";
      gx.style.top = o.top + "px";
      gx.style.width = "1px";
      gx.style.height = o.height + "px";
    }
    if (!gy.hidden) {
      gy.style.left = o.left + "px";
      gy.style.top = o.top + guides.y * k - 0.5 + "px";
      gy.style.width = o.width + "px";
      gy.style.height = "1px";
    }
  }

  /*
   * The cell of a grid under (x, y), from the track sizes the browser has
   * already resolved, or null over a gap or outside the tracks.
   */
  function gridCellAt(grid, x, y) {
    var cs = window.getComputedStyle(grid);
    var cols = (cs.gridTemplateColumns || "").split(/\s+/).map(parseFloat).filter(function (v) { return v >= 0; });
    var rows = (cs.gridTemplateRows || "").split(/\s+/).map(parseFloat).filter(function (v) { return v >= 0; });
    if (!cols.length || !rows.length) return null;
    var r = grid.getBoundingClientRect();
    var left = r.left + grid.clientLeft + (parseFloat(cs.paddingLeft) || 0) - grid.scrollLeft;
    var top = r.top + grid.clientTop + (parseFloat(cs.paddingTop) || 0) - grid.scrollTop;
    function find(list, offset, gap) {
      var at = 0;
      for (var i = 0; i < list.length; i++) {
        if (offset >= at && offset < at + list[i]) return { index: i + 1, start: at, size: list[i] };
        at += list[i] + gap;
      }
      return null;
    }
    var c = find(cols, x - left, parseFloat(cs.columnGap) || 0);
    var rw = find(rows, y - top, parseFloat(cs.rowGap) || 0);
    if (!c || !rw) return null;
    return { col: c.index, row: rw.index, rect: { left: left + c.start, top: top + rw.start, width: c.size, height: rw.size } };
  }

  function finishFree(target) {
    showGuides(null);
    var shown = freeDrag.shown;
    var restore = freeDrag.before;
    quiet(function () {
      if (restore === null) target.style.removeProperty("translate");
      else target.style.setProperty("translate", restore);
    });
    freeDrag = null;
    if (!shown.x && !shown.y) return;
    var spot = freePlace(target, shown.x, shown.y);
    styleChange(target, [["left", spot.left + "px"], ["top", spot.top + "px"]], "position");
  }

  /* --- the size panel -------------------------------------------------- */

  function renderSize() {
    var box = ui.sizePanel;
    box.textContent = "";
    var show = panel === "size" && !!selected && !styleWhyNot(selected) && !editing;
    box.hidden = !show;
    ui.sizeBtn.setAttribute("aria-pressed", panel === "size" ? "true" : "false");
    if (!show) return;
    box.appendChild(el("div", "ed-note", layoutNote(selected)));
    ["width", "height"].forEach(function (dim) {
      var row = el("div", "ed-row");
      row.appendChild(el("span", "ed-row-label", dim === "width" ? "Width" : "Height"));
      var mode = sizeMode(selected, dim);
      [["hug", "Hug", "Shrink to its content"], ["fill", "Fill", "Take the space available"], ["fixed", "Fixed", "Keep its current size, in pixels"]].forEach(function (m) {
        var b = button(m[1], m[2], function () {
          setSize(dim, m[0]);
        });
        b.classList.add("ed-seg");
        if (mode === m[0]) b.setAttribute("aria-pressed", "true");
        row.appendChild(b);
      });
      var input = el("input", "ed-num");
      input.type = "number";
      input.min = "0";
      input.value = String(Math.round(cssLength(selected, dim, selected.getBoundingClientRect()[dim])));
      input.setAttribute("aria-label", (dim === "width" ? "Width" : "Height") + " in pixels");
      input.addEventListener("change", function () {
        var v = parseFloat(input.value);
        if (v >= 0) setSize(dim, "fixed", v);
      });
      row.appendChild(input);
      row.appendChild(el("span", "ed-unit", "px"));
      box.appendChild(row);
    });
    if (!positioned(selected)) {
      box.appendChild(button("Detach from layout", "Take it out of the layout and position it freely", detach));
    }
  }

  /* --- the layout panel ------------------------------------------------ */

  function layoutKind(target) {
    var cs = window.getComputedStyle(target);
    if (/flex/.test(cs.display)) return /column/.test(cs.flexDirection) ? "column" : "row";
    if (/grid/.test(cs.display)) return "grid";
    return "flow";
  }

  function arrange(kind) {
    var target = selected;
    var now = layoutKind(target);
    if (kind === now) return;
    if (kind === "flow") return styleChange(target, [["display", "block"]], "layout");
    if (now === "row" || now === "column") return styleChange(target, [["flex-direction", kind]], "layout");
    styleChange(target, [["display", "flex"], ["flex-direction", kind]], "layout");
  }

  function segmented(labelText, options, current, run) {
    var row = el("div", "ed-row");
    row.appendChild(el("span", "ed-row-label", labelText));
    options.forEach(function (option) {
      var b = button(option[1], option[2] || option[1], function () {
        run(option[0]);
      });
      b.classList.add("ed-seg");
      if (current === option[0]) b.setAttribute("aria-pressed", "true");
      row.appendChild(b);
    });
    return row;
  }

  function renderLayout() {
    var box = ui.layoutPanel;
    box.textContent = "";
    var show = panel === "layout" && !!selected && !styleWhyNot(selected) && !editing && selected.children.length > 0;
    box.hidden = !show;
    ui.layoutBtn.setAttribute("aria-pressed", panel === "layout" ? "true" : "false");
    if (!show) return;
    var target = selected;
    var kind = layoutKind(target);
    var cs = window.getComputedStyle(target);
    var grid = kind === "grid";

    var options = [["flow", "Flow", "Children one after another, as written"], ["row", "Row", "Children side by side"], ["column", "Column", "Children stacked"]];
    if (grid) options.push(["grid", "Grid", "A grid, set by its own rules"]);
    box.appendChild(segmented("Arrange", options, kind, arrange));
    if (kind === "flow") return;

    var gapRow = el("div", "ed-row");
    gapRow.appendChild(el("span", "ed-row-label", "Gap"));
    var gap = el("input", "ed-num");
    gap.type = "number";
    gap.min = "0";
    gap.value = String(Math.round(parseFloat(cs.columnGap) || parseFloat(cs.rowGap) || 0));
    gap.setAttribute("aria-label", "Gap in pixels");
    gap.addEventListener("change", function () {
      var v = parseFloat(gap.value);
      if (v >= 0) styleChange(target, [["gap", Math.round(v) + "px"]], "gap");
    });
    gapRow.appendChild(gap);
    gapRow.appendChild(el("span", "ed-unit", "px"));
    box.appendChild(gapRow);

    var start = grid ? "start" : "flex-start";
    var end = grid ? "end" : "flex-end";
    var across = kind === "row" ? "Vertical" : kind === "column" ? "Horizontal" : "Align";
    var along = kind === "row" ? "Horizontal" : kind === "column" ? "Vertical" : "Justify";
    function norm(v) {
      return v === "normal" ? (grid ? "stretch" : "stretch") : v === "start" && !grid ? "flex-start" : v === "end" && !grid ? "flex-end" : v;
    }
    box.appendChild(segmented(across, [[start, "Start"], ["center", "Centre"], [end, "End"], ["stretch", "Stretch"]], norm(cs.alignItems), function (v) {
      styleChange(target, [["align-items", v]], "alignment");
    }));
    box.appendChild(segmented(along, [[start, "Start"], ["center", "Centre"], [end, "End"], ["space-between", "Spread"]], cs.justifyContent === "normal" ? start : norm(cs.justifyContent), function (v) {
      styleChange(target, [["justify-content", v]], "alignment");
    }));
  }
`;

export const EDIT_SCRIPT = `(function () {
  var boot = window.__ospEditBoot;
  if (!boot || window.__ospEdit) return;
  /*
   * In a frame, only one kind joins in: the screen inside a page that is
   * itself being edited -- a phone frame's <iframe>. It draws into that
   * page's overlay and takes turns with it; any other frame is left alone.
   */
  var parentEdit = null;
  var frameEl = null;
  try {
    if (window.top !== window) {
      frameEl = window.frameElement;
      parentEdit = window.parent.__ospEdit;
      if (!frameEl || !parentEdit || typeof parentEdit.adopt !== "function") return;
    }
  } catch (e) {
    return;
  }
  var child = !!parentEdit;
  /* The window the UI is drawn in: the outer page's, for a screen in a frame. */
  var hostWin = child ? window.parent : window;

  var ATTR = "data-osp-src";
  var ACTIVE_KEY = "osp-edit-active";

  /*
   * Which of the file's elements the page's own scripts restyle while it
   * runs. This script is in <head>, ahead of every script of the page's, so
   * an observer started here sees every class or style change they make --
   * and the parser setting attributes as it builds an element is not a
   * change, so what it records is the scripts' doing. The notch's own
   * writes are taken out with quiet().
   */
  var touched = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  var watcher = null;
  function noteChanges(records) {
    if (!touched) return;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type !== "attributes" || !r.target || r.target.nodeType !== 1) continue;
      var seen = touched.get(r.target) || {};
      seen[r.attributeName] = true;
      touched.set(r.target, seen);
    }
  }
  try {
    watcher = new MutationObserver(noteChanges);
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "hidden"], subtree: true });
  } catch (e) {}

  /* Runs one of the notch's own changes to the page without recording it as the page's. */
  function quiet(fn) {
    if (watcher) noteChanges(watcher.takeRecords());
    try {
      fn();
    } finally {
      if (watcher) watcher.takeRecords();
    }
  }

  /* What the page's scripts change on this element, as words, or "". */
  function scriptChanges(target) {
    var seen = touched && touched.get(target);
    if (!seen) return "";
    var names = [];
    if (seen["class"]) names.push("classes");
    if (seen.style) names.push("inline style");
    if (seen.hidden) names.push("visibility");
    return names.join(" and ");
  }
  var PAGE = boot.page;
  var hash = boot.hash;
  var unavailable = boot.ok ? "" : boot.reason || "This page cannot be edited.";
  var stale = "";

  var host = null;
  var ui = null;
  var active = false;
  var hovered = null;
  var selected = null;
  var context = null;
  var armed = null;
  var busy = false;
  var message = "";
  var log = [];
  var scriptText = null;
  var frame = null;
  /* The words being typed into, while they are: { el, before, attr }. */
  var editing = null;
  /* A press on the selection, which becomes a drag once it moves. */
  var press = null;
  var dragging = false;
  var dragged = false;
  var drop = null;
  /* A positioned element being moved: { before, shown: { x, y } }. */
  var freeDrag = null;
  var resizing = false;
  /* Finishes the resize in progress; set while a handle is held. */
  var endResize = null;

  /* --- naming elements ------------------------------------------------ */

  function stampOf(el) {
    if (!el || !el.getAttribute) return null;
    var value = el.getAttribute(ATTR);
    if (value === null || value === "") return null;
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  /*
   * Why an element cannot be edited, or "" when it can. A stamp seen on two
   * elements means a script cloned one, and which of them is in the file is
   * not something the page can tell.
   */
  function whyNot(el) {
    if (unavailable) return unavailable;
    if (stale) return stale;
    var at = stampOf(el);
    if (at === null) {
      return "This was made by the page's script, so it is not in the file: it can't be moved, retyped or deleted from here.";
    }
    if (document.querySelectorAll("[" + ATTR + '="' + at + '"]').length > 1) {
      return "A script copied this element, so which copy is in the file can't be told. It can't be changed from here yet.";
    }
    return "";
  }

  function label(el) {
    var name = el.tagName.toLowerCase();
    if (el.id) return name + "#" + el.id;
    var cls = el.getAttribute("class");
    if (cls && cls.trim()) return name + "." + cls.trim().split(/\\s+/)[0];
    return name;
  }

  /* --- what is ours --------------------------------------------------- */

  function overlayHost() {
    return document.getElementById("osp-overlay-host");
  }

  function ours(node) {
    var h = overlayHost();
    return !!(h && node && (node === h || (node.nodeType === 1 && h.contains(node))));
  }

  function isRoot(el) {
    return !el || el === document.body || el === document.documentElement;
  }

  /* --- choosing what a click selects ---------------------------------- */

  function elementOf(target) {
    if (target && target.nodeType !== 1) target = target.parentElement;
    return isRoot(target) ? null : target;
  }

  function childOfOn(parent, node) {
    while (node && node.parentElement !== parent) node = node.parentElement;
    return node;
  }

  function pageSized(el) {
    var r = el.getBoundingClientRect();
    return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9;
  }

  function candidate(target, deep) {
    var el = elementOf(target);
    if (!el) return null;
    if (deep) return el;
    // At the depth already being worked at: the nearest container the click
    // shares with the last selection, so after a card's button the next
    // click on the card beside it selects that card, not the whole page.
    for (var scope = context; scope && !isRoot(scope); scope = scope.parentElement) {
      if (scope !== el && scope.contains(el)) return childOfOn(scope, el);
    }
    var chain = [];
    for (var n = el; n && !isRoot(n); n = n.parentElement) chain.unshift(n);
    for (var i = 0; i < chain.length; i++) if (!pageSized(chain[i])) return chain[i];
    return el;
  }

  /* One level inside the selection, skipping wrappers the size of it. */
  function inside(target) {
    var el = elementOf(target);
    if (!selected || !el || el === selected || !selected.contains(el)) return null;
    var next = childOfOn(selected, el);
    while (next && next !== el) {
      var only = next.children.length === 1 ? next.children[0] : null;
      if (!only || !only.contains(el) || !sameBox(next, only)) break;
      next = only;
    }
    return next;
  }

  function sameBox(a, b) {
    var x = a.getBoundingClientRect();
    var y = b.getBoundingClientRect();
    return Math.abs(x.left - y.left) < 1 && Math.abs(x.top - y.top) < 1 &&
      Math.abs(x.width - y.width) < 1 && Math.abs(x.height - y.height) < 1;
  }

  function select(el) {
    if (el) claim();
    selected = el;
    armed = null;
    ask = null;
    context = el ? el.parentElement : context;
    if (isRoot(context)) context = null;
    message = "";
    refresh();
  }

  function up() {
    if (!selected) return;
    var parent = selected.parentElement;
    if (isRoot(parent)) {
      selected = null;
      context = null;
      armed = null;
      refresh();
      return;
    }
    select(parent);
  }

  /* --- scripts that name an element ------------------------------------ */

  function loadScripts() {
    if (scriptText !== null) return;
    scriptText = "";
    var scripts = document.querySelectorAll("script");
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i];
      if (s.hasAttribute("data-osp-edit")) continue;
      if (s.src) {
        var url;
        try {
          url = new URL(s.src, location.href);
        } catch (e) {
          continue;
        }
        if (url.origin !== location.origin) continue;
        fetch(url.href, { credentials: "same-origin" })
          .then(function (r) {
            return r.ok ? r.text() : "";
          })
          .then(function (text) {
            scriptText += "\\n" + text;
          })
          .catch(function () {});
      } else {
        var text = s.textContent || "";
        // The review overlay's own script mentions a great many names, none
        // of them the page's.
        if (text.indexOf('meta[name="osp-review"]') !== -1) continue;
        scriptText += "\\n" + text;
      }
    }
  }

  function mentions(name) {
    var safe = name.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&");
    return new RegExp("[\\"'\`#.]" + safe + "[\\"'\`\\\\s.:\\\\[),>~+]").test(scriptText || "");
  }

  /* What the page's scripts call this element by, or "" if nothing. */
  function scriptRefs(el) {
    var hits = [];
    if (el.id && mentions(el.id)) hits.push("#" + el.id);
    for (var i = 0; i < el.classList.length; i++) {
      var cls = el.classList[i];
      if (document.getElementsByClassName(cls).length === 1 && mentions(cls)) hits.push("." + cls);
    }
    return hits.join(", ");
  }

  /* --- talking to the plugin ------------------------------------------- */

  function send(body, done, failed) {
    busy = true;
    refresh();
    body.page = PAGE;
    body.hash = hash;
    fetch("/api/edit", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { status: r.status, data: data || {} };
        });
      })
      .then(function (res) {
        busy = false;
        if (res.status === 200) {
          hash = res.data.hash;
          done(res.data);
        } else if (res.status === 409) {
          stale = res.data.error || "The file has changed. Reload to keep editing.";
          message = stale;
          if (failed) failed();
        } else {
          message = res.data.error || "That did not work.";
          if (failed) failed();
        }
        refresh();
      })
      .catch(function () {
        busy = false;
        message = "Couldn't reach Obsidian. Check the plugin is still running.";
        if (failed) failed();
        refresh();
      });
  }

  /*
   * Moves every stamp on the page to where its element now starts. A stamp
   * inside replaced text names an element that is no longer in the file, so
   * it is taken off rather than left pointing at someone else.
   */
  function remap(shifts) {
    var nodes = document.querySelectorAll("[" + ATTR + "]");
    for (var i = 0; i < nodes.length; i++) {
      var at = stampOf(nodes[i]);
      if (at === null) continue;
      var delta = 0;
      var gone = false;
      for (var j = 0; j < shifts.length; j++) {
        var s = shifts[j];
        if (at >= s.end) delta += s.length - (s.end - s.start);
        else if (at >= s.start) {
          gone = true;
          break;
        }
      }
      if (gone) nodes[i].removeAttribute(ATTR);
      else if (delta) nodes[i].setAttribute(ATTR, String(at + delta));
    }
  }

  /*
   * Re-stamps a subtree that was moved or copied, from the server's list of
   * old offset to new. A stamp not on the list is not in the file at the new
   * place, so it comes off. \`reverse\` reads the list the other way, for undo.
   */
  function restamp(root, pairs, reverse) {
    var map = {};
    for (var i = 0; i < pairs.length; i++) {
      map[pairs[i][reverse ? 1 : 0]] = pairs[i][reverse ? 0 : 1];
    }
    var nodes = [root].concat(Array.prototype.slice.call(root.querySelectorAll("[" + ATTR + "]")));
    for (var j = 0; j < nodes.length; j++) {
      var at = stampOf(nodes[j]);
      if (at === null) continue;
      if (Object.prototype.hasOwnProperty.call(map, at)) nodes[j].setAttribute(ATTR, String(map[at]));
      else nodes[j].removeAttribute(ATTR);
    }
  }

  /* --- the actions ----------------------------------------------------- */

  /*
   * Every edit is kept as the two halves of what it does to the page,
   * apply and revert, each taking the server's answer. The first time, a
   * redo and an undo all run through the same code, so a redo is the edit
   * exactly as it happened rather than a second guess at it.
   */
  var redone = [];
  var serverHistory = {
    undo: (boot.history && boot.history.undo) || 0,
    redo: (boot.history && boot.history.redo) || 0,
  };

  function counted(data) {
    if (typeof data.undo === "number") serverHistory = { undo: data.undo, redo: data.redo };
  }

  function act(body, what, apply, revert, after, failed) {
    send(
      body,
      function (data) {
        counted(data);
        if (!data.id) {
          message = "Nothing changed.";
          return;
        }
        apply(data);
        log.push({ id: data.id, what: what, apply: apply, revert: revert });
        redone = [];
        if (after) after(data);
      },
      failed,
    );
  }

  function remove() {
    var el = selected;
    if (!el || busy || whyNot(el)) return;
    var refs = scriptRefs(el);
    if (refs && armed !== el) {
      armed = el;
      message = "The page's script uses " + refs + ". Deleting it may break the page. Press Delete again to delete it anyway.";
      refresh();
      return;
    }
    armed = null;
    var name = label(el);
    var parent = null;
    var next = null;
    act(
      { op: "delete", at: stampOf(el) },
      "delete of " + name,
      function (data) {
        parent = el.parentNode;
        next = el.nextSibling;
        // Out of the page before the stamps move: the removed subtree keeps
        // the offsets it had, which are right again once the delete is undone.
        el.remove();
        remap(data.edits);
        if (selected === el) selected = null;
      },
      function (back) {
        remap(back.edits);
        parent.insertBefore(el, next && next.parentNode === parent ? next : null);
      },
      function () {
        message = "Deleted " + name + ". Undo with " + UNDO_KEY + ".";
      },
    );
  }

  function hide() {
    var el = selected;
    if (!el || busy) return;
    // Hidden at this width and narrower, or a script-made element: a rule.
    if (narrow || (whyNot(el) && !styleWhyNot(el))) {
      if (!styleWhyNot(el)) styleChange(el, [["display", "none"]], "visibility");
      return;
    }
    if (whyNot(el)) return;
    var name = label(el);
    var before = null;
    act(
      { op: "hide", at: stampOf(el) },
      "hide of " + name,
      function (data) {
        before = el.getAttribute("style");
        quiet(function () {
          el.style.setProperty("display", "none");
        });
        remap(data.edits);
        if (selected === el) selected = null;
      },
      function (back) {
        remap(back.edits);
        quiet(function () {
          if (before === null) el.removeAttribute("style");
          else el.setAttribute("style", before);
        });
      },
      function () {
        message = "Hid " + name + ". Undo with " + UNDO_KEY + ".";
      },
    );
  }

  function hasIds(el) {
    return !!(el.id || el.querySelector("[id]"));
  }

  function duplicate() {
    var el = selected;
    if (!el || busy || whyNot(el)) return;
    var name = label(el);
    var copy = null;
    act(
      { op: "duplicate", at: stampOf(el) },
      "duplicate of " + name,
      function (data) {
        // The copy goes in after the original, so the original's stamps do
        // not move and the clone can be re-stamped from them. A redo puts
        // back the same copy, still carrying the stamps it was given.
        remap(data.edits);
        if (!copy) {
          copy = el.cloneNode(true);
          restamp(copy, data.relocated || [], false);
        }
        el.parentNode.insertBefore(copy, el.nextSibling);
      },
      function (back) {
        copy.remove();
        remap(back.edits);
        if (selected === copy) selected = null;
      },
      function () {
        select(copy);
        message =
          "Duplicated " + name + "." +
          (hasIds(el) ? " The copy repeats the original's id, which the page's script may trip over." : "");
      },
    );
  }

  /* Puts el before or after target, or inside it when it is empty, in the file and on the page. */
  function move(el, target, place) {
    if (!el || !target || busy || whyNot(el) || whyNot(target)) return;
    var name = label(el);
    var oldParent = null;
    var oldNext = null;
    var pairs = null;
    act(
      { op: "move", at: stampOf(el), target: stampOf(target), place: place },
      "move of " + name,
      function (data) {
        oldParent = el.parentNode;
        oldNext = el.nextSibling;
        pairs = data.relocated || pairs || [];
        el.remove();
        remap(data.edits);
        restamp(el, pairs, false);
        if (place === "inside") target.appendChild(el);
        else target.parentNode.insertBefore(el, place === "before" ? target : target.nextSibling);
      },
      function (back) {
        el.remove();
        remap(back.edits);
        restamp(el, pairs, true);
        oldParent.insertBefore(el, oldNext && oldNext.parentNode === oldParent ? oldNext : null);
      },
      function () {
        select(el);
        message = el.parentNode !== oldParent ? "Moved " + name + " into " + label(el.parentNode) + "." : "Moved " + name + ".";
      },
    );
  }

  function stampedSibling(el, dir) {
    var n = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    while (n && stampOf(n) === null) n = dir < 0 ? n.previousElementSibling : n.nextElementSibling;
    return n;
  }

  /* One place earlier or later among its siblings: what an arrow key does. */
  function nudge(dir) {
    var el = selected;
    if (!el || busy || whyNot(el)) return;
    var target = stampedSibling(el, dir);
    if (!target) {
      message = dir < 0 ? "It is already first." : "It is already last.";
      refresh();
      return;
    }
    move(el, target, dir < 0 ? "before" : "after");
  }

  function reloadSoon() {
    setTimeout(function () {
      location.reload();
    }, 300);
  }

  /*
   * Undo, and redo: from this page's own record while it has one, and from
   * the server's after a reload, when the page no longer knows what was
   * done to it -- the server steps the file back and the page reloads.
   */
  function undo() {
    if (busy || stale) return;
    var entry = log[log.length - 1];
    if (!entry) {
      if (!serverHistory.undo) return;
      send({ op: "undo" }, function (data) {
        counted(data);
        message = "Undid an edit made before this page loaded. Reloading…";
        reloadSoon();
      });
      return;
    }
    send({ op: "undo", id: entry.id }, function (data) {
      counted(data);
      log.pop();
      entry.revert(data);
      redone.push(entry);
      message = "Undid the " + entry.what + ".";
    });
  }

  function redo() {
    if (busy || stale) return;
    var entry = redone[redone.length - 1];
    if (!entry) {
      if (!serverHistory.redo) return;
      send({ op: "redo" }, function (data) {
        counted(data);
        message = "Redid an edit undone before this page loaded. Reloading…";
        reloadSoon();
      });
      return;
    }
    send({ op: "redo", id: entry.id }, function (data) {
      counted(data);
      redone.pop();
      entry.apply(data);
      log.push(entry);
      message = "Redid the " + entry.what + ".";
    });
  }

  var MAC = /Mac|iPhone|iPad/.test(navigator.platform || "");
  var UNDO_KEY = MAC ? "⌘Z" : "Ctrl+Z";
  var REDO_KEY = MAC ? "⇧⌘Z" : "Ctrl+Y";

  /* --- layout ---------------------------------------------------------- */

  /* Which way a container's children run, which is what reordering follows. */
  function axis(parent) {
    if (!parent || isRoot(parent)) return "column";
    var cs = window.getComputedStyle(parent);
    if (/flex/.test(cs.display)) return /column/.test(cs.flexDirection) ? "column" : "row";
    if (/grid/.test(cs.display)) return "grid";
    return "column";
  }

  function runsAcross(el) {
    var a = axis(el.parentElement);
    if (a !== "column") return true;
    return /^inline/.test(window.getComputedStyle(el).display);
  }

  /* --- editing words --------------------------------------------------- */

  /* Elements Space activates rather than types into. */
  var ACTIVATES = { BUTTON: 1, SUMMARY: 1 };

  function typeSpace() {
    if (document.execCommand && document.execCommand("insertText", false, " ")) return;
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    range.deleteContents();
    var space = document.createTextNode(" ");
    range.insertNode(space);
    range.setStartAfter(space);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  var RAW = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, TITLE: 1, TEMPLATE: 1, IFRAME: 1, NOSCRIPT: 1 };

  /* Markup that can sit among words without changing what they are. */
  var INLINE_TAGS = {
    A: 1, ABBR: 1, B: 1, BDI: 1, BDO: 1, BR: 1, CITE: 1, CODE: 1, DATA: 1, DFN: 1, EM: 1, I: 1, KBD: 1,
    MARK: 1, Q: 1, S: 1, SAMP: 1, SMALL: 1, SPAN: 1, STRONG: 1, SUB: 1, SUP: 1, TIME: 1, U: 1, VAR: 1, WBR: 1,
  };

  /* An element whose content is only words, which is what can be retyped. */
  function isTextLeaf(el) {
    return !!el && el.children.length === 0 && !RAW[el.tagName] && /\\S/.test(el.textContent || "");
  }

  /* Words with only inline markup among them: retyped piece by piece, the markup kept. */
  function wordsOnly(el) {
    if (!el || RAW[el.tagName] || !/\\S/.test(el.textContent || "")) return false;
    var all = el.getElementsByTagName("*");
    for (var i = 0; i < all.length; i++) if (!INLINE_TAGS[all[i].tagName]) return false;
    return true;
  }

  function retypable(el) {
    return isTextLeaf(el) || wordsOnly(el);
  }

  /* The pieces of text inside el, in order: what the server lines up with the file's. */
  function textPieces(el) {
    var out = [];
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (var n = walker.nextNode(); n; n = walker.nextNode()) out.push(n.data);
    return out;
  }

  function startText() {
    var el = selected;
    if (!el || busy || editing || whyNot(el)) return;
    if (!retypable(el)) {
      message = "This holds more than words. Double-click to go inside and edit each part.";
      refresh();
      return;
    }
    editing = {
      el: el,
      before: el.textContent,
      beforeHTML: el.innerHTML,
      mixed: el.children.length > 0,
      attr: el.getAttribute("contenteditable"),
    };
    el.setAttribute("contenteditable", "plaintext-only");
    if (el.contentEditable !== "plaintext-only") el.setAttribute("contenteditable", "true");
    el.addEventListener("blur", onBlur);
    el.focus();
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
    message = editing.mixed
      ? "Type the new words; links and emphasis stay as they are. Enter saves, Esc cancels."
      : "Type the new words. Enter saves, Esc cancels.";
    refresh();
  }

  function stopText() {
    var now = editing;
    editing = null;
    now.el.removeEventListener("blur", onBlur);
    if (now.attr === null) now.el.removeAttribute("contenteditable");
    else now.el.setAttribute("contenteditable", now.attr);
    try {
      window.getSelection().removeAllRanges();
    } catch (e) {}
    return now;
  }

  function onBlur() {
    if (editing) commitText();
  }

  function restoreText(now) {
    if (now.mixed) now.el.innerHTML = now.beforeHTML;
    else now.el.textContent = now.before;
  }

  function cancelText() {
    if (!editing) return;
    restoreText(stopText());
    message = "";
    refresh();
  }

  function commitText() {
    if (!editing) return;
    var now = stopText();
    var el = now.el;
    var text = el.textContent || "";
    var unchanged = now.mixed ? text === now.before : text.trim() === now.before.trim();
    if (unchanged) {
      restoreText(now);
      message = "";
      refresh();
      return;
    }
    var name = label(el);
    var done = function () {
      message = "Changed the words in " + name + ".";
    };
    // A refusal puts the words back, so the page never shows text the
    // file does not have.
    var refused = function () {
      restoreText(now);
    };
    if (now.mixed) {
      var afterHTML;
      act(
        { op: "texts", at: stampOf(el), texts: textPieces(el) },
        "text change in " + name,
        function (data) {
          remap(data.edits);
          if (afterHTML === undefined) afterHTML = el.innerHTML;
          else el.innerHTML = afterHTML;
        },
        function (back) {
          remap(back.edits);
          el.innerHTML = now.beforeHTML;
        },
        done,
        refused,
      );
      return;
    }
    act(
      { op: "text", at: stampOf(el), text: text },
      "text change in " + name,
      function (data) {
        remap(data.edits);
        el.textContent = text;
      },
      function (back) {
        remap(back.edits);
        el.textContent = now.before;
      },
      done,
      refused,
    );
  }

  /* --- dragging -------------------------------------------------------- */

  function elementAtPoint(x, y) {
    if (!document.elementsFromPoint) return null;
    var hits = document.elementsFromPoint(x, y);
    for (var i = 0; i < hits.length; i++) if (!ours(hits[i])) return hits[i];
    return null;
  }

  /*
   * Where a drop at (x, y) would put \`dragged\`: before or after which
   * element. A sibling under the pointer first, so a reorder is never
   * mistaken for a move; then the nearest element of the same kind, so a
   * card dropped on another card's contents lands beside that card; then
   * whatever is under the pointer.
   */
  /* Elements that hold other elements: an empty one is somewhere to drop into. */
  var CONTAINER = {
    DIV: 1, SECTION: 1, MAIN: 1, ARTICLE: 1, ASIDE: 1, HEADER: 1, FOOTER: 1, NAV: 1, UL: 1, OL: 1, LI: 1,
    FORM: 1, FIELDSET: 1, FIGURE: 1, TD: 1, TH: 1, DETAILS: 1, DIALOG: 1, BLOCKQUOTE: 1,
  };

  function emptyContainer(n) {
    return !!CONTAINER[n.tagName] && n.children.length === 0 && !/\\S/.test(n.textContent || "") && stampOf(n) !== null;
  }

  function dropAt(x, y, dragged) {
    var el = elementOf(elementAtPoint(x, y));
    if (!el || dragged.contains(el)) return null;
    // Into an empty container under the pointer: the one thing a reorder can't reach.
    if (emptyContainer(el) && !el.contains(dragged) && !whyNot(el)) {
      return { target: el, place: "inside", box: el.getBoundingClientRect() };
    }
    // Onto an empty cell of the grid it sits in: a placement, not a reorder.
    if (el === dragged.parentElement && /grid/.test(window.getComputedStyle(el).display)) {
      var cell = gridCellAt(el, x, y);
      if (cell) return { target: el, place: "cell", cell: cell, box: cell.rect };
    }
    var target = null;
    var n;
    for (n = el; n && !isRoot(n) && !target; n = n.parentElement) {
      if (n.parentElement === dragged.parentElement && n !== dragged) target = n;
    }
    for (n = el; n && !isRoot(n) && !target; n = n.parentElement) {
      if (n.tagName === dragged.tagName && !n.contains(dragged)) target = n;
    }
    for (n = el; n && !isRoot(n) && !target; n = n.parentElement) {
      if (stampOf(n) !== null && !n.contains(dragged)) target = n;
    }
    if (!target || whyNot(target)) return null;

    var r = target.getBoundingClientRect();
    var across = runsAcross(target);
    var place = across
      ? x < r.left + r.width / 2 ? "before" : "after"
      : y < r.top + r.height / 2 ? "before" : "after";
    // Where it already is: no drop to show.
    if (place === "after" && stampedSibling(dragged, -1) === target) return null;
    if (place === "before" && stampedSibling(dragged, 1) === target) return null;
    return { target: target, place: place, across: across };
  }

${EDIT_COLOUR}
${EDIT_LAYOUT}

  /* --- catching the page's input -------------------------------------- */

  var POINTER = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "auxclick"];
  var LETTERS = { v: 1, c: 1, r: 1, e: 1, h: 1 };
  var DRAG_START = 4;

  /* True while Space is held: the page works as in View mode until it is let go. */
  var passthrough = false;

  function onPointer(event) {
    if (passthrough) return;
    if (endResize && event.type === "pointerup") {
      var end = endResize;
      end();
      // The click the release makes is the end of the resize, not a selection.
      dragged = true;
      if (!ours(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (ours(event.target)) return;
    if (editing) {
      // Inside the words being typed, the pointer places the caret, which
      // the press does. The click after it would activate the element --
      // submit the form a button is in -- so it never gets that far.
      if (editing.el.contains(event.target)) {
        event.stopImmediatePropagation();
        if (event.type === "click" || event.type === "dblclick" || event.type === "auxclick") {
          event.preventDefault();
        }
        return;
      }
      if (event.type === "pointerdown") commitText();
    }
    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.type === "pointerdown") dragged = false;
    if (event.type === "pointerdown" && event.button === 0 && !event.altKey) {
      if (selected && selected.contains(event.target) && !whyNot(selected)) {
        press = { x: event.clientX, y: event.clientY, el: selected };
      }
      return;
    }
    if (event.type === "pointerup") {
      if (press && dragging && freeDrag) finishFree(press.el);
      else if (press && dragging && drop && drop.place === "cell") {
        styleChange(press.el, [["grid-column", String(drop.cell.col)], ["grid-row", String(drop.cell.row)]], "grid placement");
      } else if (press && dragging && drop) move(press.el, drop.target, drop.place);
      if (dragging) dragged = true;
      press = null;
      dragging = false;
      drop = null;
      draw();
      return;
    }

    if (event.type === "click") {
      // The click that ends a drag is not a selection.
      if (dragged) {
        dragged = false;
        return;
      }
      var el = candidate(event.target, event.altKey);
      if (!el) {
        selected = null;
        context = null;
        armed = null;
        message = "";
        refresh();
      } else {
        select(el);
      }
    } else if (event.type === "dblclick") {
      var deeper = inside(event.target);
      if (deeper) select(deeper);
      else if (selected && selected.contains(elementOf(event.target)) && retypable(selected)) startText();
    }
  }

  function onMove(event) {
    if (passthrough) return;
    self.shared.hover = self;
    if (press) {
      event.stopImmediatePropagation();
      if (!dragging && Math.abs(event.clientX - press.x) + Math.abs(event.clientY - press.y) > DRAG_START) {
        dragging = true;
      }
      if (dragging) {
        hovered = null;
        if (positioned(press.el)) {
          if (!freeDrag) freeDrag = { before: press.el.style.getPropertyValue("translate") || null, shown: { x: 0, y: 0 } };
          previewFree(press.el, event.clientX - press.x - freeDrag.shown.x, event.clientY - press.y - freeDrag.shown.y);
          draw();
          return;
        }
        drop = dropAt(event.clientX, event.clientY, press.el);
        draw();
        return;
      }
    }
    if (ours(event.target)) {
      hovered = null;
    } else {
      hovered = candidate(event.target, event.altKey);
    }
    draw();
  }

  function onKey(event) {
    if (ours(event.target)) return;
    var key = String(event.key || "");
    var plainLetter = LETTERS[key.toLowerCase()] && !(event.metaKey || event.ctrlKey || event.altKey);
    // A framed screen holds the selection: its keys, even pressed out here.
    if (!child && !owns() && !plainLetter && self.shared.owner && self.shared.owner.onKey) {
      return self.shared.owner.onKey(event);
    }

    // Typing words: everything goes to the words, nothing to the page.
    if (editing) {
      event.stopImmediatePropagation();
      if (event.type !== "keydown") return;
      if (key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        commitText();
      } else if (key === " " && ACTIVATES[editing.el.tagName]) {
        // Space presses a button rather than typing into it, even an
        // editable one, so the space is put in by hand.
        event.preventDefault();
        typeSpace();
      } else if (key === "Escape") {
        event.preventDefault();
        cancelText();
      }
      return;
    }

    // Space held: use the page for a moment -- open a menu, turn a slide --
    // then edit what it showed.
    if (key === " ") {
      if (event.type === "keydown") {
        event.preventDefault();
        if (!passthrough) {
          passthrough = true;
          hovered = null;
          message = "Using the page while Space is held.";
          refresh();
        }
      } else if (event.type === "keyup") {
        passthrough = false;
        message = "";
        refresh();
      }
      event.stopImmediatePropagation();
      return;
    }
    if (passthrough) return;

    var mod = event.metaKey || event.ctrlKey;
    if (event.type === "keydown" && mod && !event.altKey) {
      var k = key.toLowerCase();
      if ((k === "z" && event.shiftKey) || (k === "y" && !event.shiftKey && event.ctrlKey && !event.metaKey)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        redo();
        return;
      }
    }
    if (event.type === "keydown" && mod && !event.shiftKey && !event.altKey) {
      var lower = key.toLowerCase();
      if (lower === "z") {
        event.preventDefault();
        event.stopImmediatePropagation();
        undo();
        return;
      }
      if (lower === "d" && selected) {
        event.preventDefault();
        event.stopImmediatePropagation();
        duplicate();
        return;
      }
    }
    // The browser's own shortcuts -- reload, find, copy -- stay the browser's.
    if (mod || event.altKey) return;
    if (LETTERS[key.toLowerCase()]) {
      // The mode letters belong to the overlay, which lives in the outer page.
      if (child && event.type === "keydown") {
        try {
          hostWin.document.dispatchEvent(new hostWin.KeyboardEvent("keydown", { key: key, bubbles: true, cancelable: true }));
        } catch (e) {}
      }
      return;
    }

    if (key === "Escape") {
      // With nothing selected, Esc goes on to the overlay, which leaves the mode.
      if (!selected) return;
      event.stopImmediatePropagation();
      if (event.type === "keydown") up();
      return;
    }

    event.stopImmediatePropagation();
    if (event.type !== "keydown" || !selected) return;
    if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      remove();
    } else if (key === "Enter") {
      event.preventDefault();
      if (retypable(selected)) startText();
      else {
        var first = selected.firstElementChild;
        if (first) select(first);
      }
    } else if (/^Arrow/.test(key) && positioned(selected)) {
      event.preventDefault();
      message = "It is positioned, so it moves by dragging rather than by reordering.";
      refresh();
    } else if (key === "ArrowUp" || key === "ArrowLeft") {
      event.preventDefault();
      nudge(-1);
    } else if (key === "ArrowDown" || key === "ArrowRight") {
      event.preventDefault();
      nudge(1);
    }
  }

  /* --- drawing --------------------------------------------------------- */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }

  function button(text, title, action) {
    var b = el("button", "ed-btn", text);
    b.type = "button";
    b.title = title;
    b.addEventListener("click", function (event) {
      event.stopPropagation();
      action();
    });
    return b;
  }

  function build() {
    var style = el("style");
    style.textContent = EDIT_CSS;
    host.shadow.appendChild(style);

    var layer = el("div", "ed-layer");
    var hoverBox = el("div", "ed-box ed-hover");
    var selBox = el("div", "ed-box ed-sel");
    var tag = el("div", "ed-tag");
    selBox.appendChild(tag);
    var dropLine = el("div", "ed-drop");
    var guideX = el("div", "ed-guide");
    var guideY = el("div", "ed-guide");
    guideX.hidden = true;
    guideY.hidden = true;
    [["e", { w: true }], ["s", { h: true }], ["se", { w: true, h: true }]].forEach(function (handle) {
      var grip = el("div", "ed-handle ed-handle-" + handle[0]);
      grip.addEventListener("pointerdown", function (event) {
        startResize(event, handle[1]);
      });
      selBox.appendChild(grip);
    });
    layer.appendChild(hoverBox);
    layer.appendChild(selBox);
    layer.appendChild(dropLine);
    layer.appendChild(guideX);
    layer.appendChild(guideY);

    var bar = el("div", "ed-bar");
    bar.addEventListener("keydown", function (event) {
      event.stopPropagation();
    });
    var crumbs = el("div", "ed-crumbs");
    var status = el("div", "ed-status");
    var actions = el("div", "ed-actions");
    var textBtn = button("Edit text", "Retype its words (Enter, or double-click)", startText);
    var copyBtn = button("Duplicate", "Put a copy after it (" + (UNDO_KEY.charAt(0) === "C" ? "Ctrl+D" : "\u2318D") + ")", duplicate);
    var colourBtn = button("Colour", "Change its colours", toggleColour);
    var sizeBtn = button("Size", "Width, height, and leaving the layout", function () {
      togglePanel("size");
    });
    var layoutBtn = button("Layout", "How its children are arranged", function () {
      togglePanel("layout");
    });
    var hideBtn = button("Hide", "Hide it: adds display: none to the file", hide);
    var deleteBtn = button("Delete", "Delete it from the file (Delete)", remove);
    deleteBtn.classList.add("ed-danger");
    var undoBtn = button("Undo", "Undo the last edit (" + UNDO_KEY + ")", undo);
    var redoBtn = button("Redo", "Redo what was undone (" + REDO_KEY + ")", redo);
    var reloadBtn = button("Reload", "Reload the page from the file", function () {
      location.reload();
    });
    actions.appendChild(textBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(colourBtn);
    actions.appendChild(sizeBtn);
    actions.appendChild(layoutBtn);
    actions.appendChild(hideBtn);
    actions.appendChild(deleteBtn);
    actions.appendChild(undoBtn);
    actions.appendChild(redoBtn);
    actions.appendChild(reloadBtn);
    bar.appendChild(crumbs);
    bar.appendChild(status);
    bar.appendChild(actions);
    var scope = el("div", "ed-row ed-scope");
    scope.hidden = true;
    bar.appendChild(scope);
    var askBox = el("div", "ed-ask");
    askBox.hidden = true;
    bar.appendChild(askBox);
    var colourPanel = el("div", "ed-colour ed-panel");
    colourPanel.hidden = true;
    bar.appendChild(colourPanel);
    var sizePanel = el("div", "ed-panel");
    sizePanel.hidden = true;
    bar.appendChild(sizePanel);
    var layoutPanel = el("div", "ed-panel");
    layoutPanel.hidden = true;
    bar.appendChild(layoutPanel);

    host.wrap.appendChild(layer);
    host.wrap.appendChild(bar);

    return {
      layer: layer,
      hoverBox: hoverBox,
      selBox: selBox,
      tag: tag,
      dropLine: dropLine,
      guideX: guideX,
      guideY: guideY,
      textBtn: textBtn,
      copyBtn: copyBtn,
      colourBtn: colourBtn,
      colourPanel: colourPanel,
      sizeBtn: sizeBtn,
      sizePanel: sizePanel,
      layoutBtn: layoutBtn,
      layoutPanel: layoutPanel,
      ask: askBox,
      scope: scope,
      bar: bar,
      crumbs: crumbs,
      status: status,
      hideBtn: hideBtn,
      deleteBtn: deleteBtn,
      undoBtn: undoBtn,
      redoBtn: redoBtn,
      reloadBtn: reloadBtn,
    };
  }

  /* --- taking turns with a framed screen ------------------------------- */

  /* Whether this document's selection is the one the bar is showing. */
  function owns() {
    return self.shared.owner === self;
  }

  /* Takes the bar: the document that held it lets its selection go. */
  function claim() {
    var shared = self.shared;
    if (shared.owner === self) return;
    var previous = shared.owner;
    shared.owner = self;
    if (previous && previous.release) previous.release();
  }

  function release() {
    if (editing) commitText();
    selected = null;
    context = null;
    armed = null;
    ask = null;
    panel = null;
    message = "";
    refresh();
  }

  /* A box in this document's viewport, in the viewport the UI is drawn in. */
  function toHost(r) {
    if (!child) return r;
    var f = frameEl.getBoundingClientRect();
    var scale = frameEl.offsetWidth ? f.width / frameEl.offsetWidth : 1;
    var left = f.left + (frameEl.clientLeft + r.left) * scale;
    var top = f.top + (frameEl.clientTop + r.top) * scale;
    return { left: left, top: top, width: r.width * scale, height: r.height * scale, right: left + r.width * scale, bottom: top + r.height * scale };
  }

  function place(box, target) {
    if (!target || !target.isConnected) {
      box.hidden = true;
      return;
    }
    var r = toHost(target.getBoundingClientRect());
    box.hidden = false;
    box.style.left = r.left + "px";
    box.style.top = r.top + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
  }

  function draw() {
    if (!ui) return;
    if (selected && !selected.isConnected) selected = null;
    ui.bar.hidden = !owns();
    place(ui.hoverBox, self.shared.hover === self && hovered && hovered !== selected && !dragging ? hovered : null);
    place(ui.selBox, selected);
    if (selected) {
      var r = selected.getBoundingClientRect();
      ui.tag.textContent = label(selected) + "  " + Math.round(r.width) + " \\u00d7 " + Math.round(r.height);
      ui.selBox.toggleAttribute("data-locked", !!styleWhyNot(selected));
      ui.selBox.toggleAttribute("data-made", !!whyNot(selected) && !styleWhyNot(selected));
      ui.selBox.toggleAttribute("data-typing", !!editing);
      ui.selBox.toggleAttribute("data-dragging", dragging);
    }
    drawDrop();
    placeBar();
  }

  /* The line that shows where a drop would put the selection. */
  function drawDrop() {
    var line = ui.dropLine;
    if (!dragging || !drop) {
      line.hidden = true;
      return;
    }
    line.hidden = false;
    line.toggleAttribute("data-box", !!drop.box);
    if (drop.box) {
      var b = toHost(drop.box);
      line.style.left = b.left + "px";
      line.style.top = b.top + "px";
      line.style.width = b.width + "px";
      line.style.height = b.height + "px";
      return;
    }
    var r = toHost(drop.target.getBoundingClientRect());
    if (drop.across) {
      line.style.left = (drop.place === "before" ? r.left : r.right) - 1 + "px";
      line.style.top = r.top + "px";
      line.style.width = "3px";
      line.style.height = r.height + "px";
    } else {
      line.style.left = r.left + "px";
      line.style.top = (drop.place === "before" ? r.top : r.bottom) - 1 + "px";
      line.style.width = r.width + "px";
      line.style.height = "3px";
    }
  }

  /* What the verbs do to this element, said in its own layout's terms. */
  function hint(el) {
    var changes = scriptChanges(el);
    if (changes) {
      return "The page's script changes its " + changes + " while it runs, so a change made here may be undone by it.";
    }
    if (positioned(el)) return "Drag to move it freely; it snaps to its container's edges and centre.";
    var a = axis(el.parentElement);
    var keys = a === "row" ? "\\u2190 \\u2192 reorder it in its row" : a === "grid" ? "arrow keys reorder it in its grid" : "\\u2191 \\u2193 reorder it in its column";
    return "Drag to move it; " + keys + "." + (retypable(el) ? " Enter edits its words." : " Double-click to go inside, Esc to go up.");
  }

  function placeBar() {
    var notch = host.notch && host.notch.getBoundingClientRect();
    var bar = ui.bar;
    var width = bar.offsetWidth;
    var center = notch ? notch.left + notch.width / 2 : hostWin.innerWidth / 2;
    var left = Math.max(8, Math.min(hostWin.innerWidth - width - 8, center - width / 2));
    bar.style.left = left + "px";
    if (notch && notch.top < hostWin.innerHeight / 2) {
      bar.style.top = notch.bottom + 8 + "px";
      bar.style.bottom = "";
    } else {
      bar.style.top = "";
      bar.style.bottom = (notch ? hostWin.innerHeight - notch.top : 24) + 8 + "px";
    }
  }

  function crumbsFor(target) {
    ui.crumbs.textContent = "";
    if (!target) return;
    var chain = [];
    for (var n = target; n && !isRoot(n); n = n.parentElement) chain.unshift(n);
    var start = Math.max(0, chain.length - 4);
    if (start > 0) ui.crumbs.appendChild(el("span", "ed-sep", "\\u2026 \\u203a "));
    for (var i = start; i < chain.length; i++) {
      (function (node, last) {
        var c = el("button", "ed-crumb", label(node));
        c.type = "button";
        if (last) c.setAttribute("data-current", "");
        c.addEventListener("click", function (event) {
          event.stopPropagation();
          select(node);
        });
        ui.crumbs.appendChild(c);
        if (!last) ui.crumbs.appendChild(el("span", "ed-sep", " \\u203a "));
      })(chain[i], i === chain.length - 1);
    }
  }

  function refresh() {
    if (!ui) return;
    var blocked = selected ? whyNot(selected) : unavailable || stale;
    var styleBlocked = selected ? styleWhyNot(selected) : unavailable || stale;
    crumbsFor(selected);
    // A script-made element that can still be styled gets the route it can
    // take, not only the ones it cannot.
    var why = !selected ? unavailable || stale : styleBlocked || (blocked ? generatedHint(selected) : "");
    ui.status.textContent =
      message ||
      why ||
      (selected ? hint(selected) : "Click an element to select it. Double-click to go inside, Esc to go up.");
    ui.status.toggleAttribute("data-warn", !!(styleBlocked || (!selected && why) || (armed && armed === selected)));
    if (dragging) {
      ui.status.textContent = drop && drop.place === "cell"
        ? "Drop to place it in column " + drop.cell.col + ", row " + drop.cell.row + "."
        : drop && drop.place === "inside"
        ? "Drop to put it inside " + label(drop.target) + "."
        : drop
        ? "Drop to put it " + drop.place + " " + label(drop.target) +
          (drop.target.parentElement !== (press && press.el.parentElement) ? ", in " + label(drop.target.parentElement) : "") + "."
        : "Drag over where it should go.";
    }
    var can = !!selected && !blocked && !busy && !editing;
    ui.textBtn.disabled = !can || !retypable(selected);
    ui.copyBtn.disabled = !can;
    var canStyle = !!selected && !styleBlocked && !busy && !editing;
    ui.colourBtn.disabled = !canStyle;
    ui.sizeBtn.disabled = !canStyle;
    ui.layoutBtn.disabled = !canStyle || selected.children.length === 0;
    ui.hideBtn.disabled = !(can || (canStyle && (narrow || !!blocked)));
    ui.deleteBtn.disabled = !can;
    ui.deleteBtn.textContent = armed && armed === selected ? "Delete anyway" : "Delete";
    ui.undoBtn.disabled = !(log.length || serverHistory.undo) || busy || !!stale;
    ui.redoBtn.disabled = !(redone.length || serverHistory.redo) || busy || !!stale;
    ui.reloadBtn.hidden = !stale;
    renderScope();
    renderAsk();
    renderColour();
    renderSize();
    renderLayout();
    draw();
  }

  /* A Space released in another window never arrives here as a keyup. */
  function onWindowBlur() {
    if (!passthrough) return;
    passthrough = false;
    message = "";
    refresh();
  }

  function tick() {
    frame = window.requestAnimationFrame(tick);
    draw();
  }

  /* --- entering and leaving -------------------------------------------- */

  function remember(on) {
    try {
      if (on) sessionStorage.setItem(ACTIVE_KEY, "1");
      else sessionStorage.removeItem(ACTIVE_KEY);
    } catch (e) {}
  }

  var self = {
    title: "Edit mode \\u2014 select and change the page (E)",
    resume: function () {
      try {
        return sessionStorage.getItem(ACTIVE_KEY) === "1";
      } catch (e) {
        return false;
      }
    },
    enter: function (overlay) {
      if (active) return;
      active = true;
      host = overlay;
      if (!child) self.shared.owner = self;
      if (!ui) ui = build();
      ui.layer.hidden = false;
      ui.bar.hidden = false;
      loadScripts();
      for (var i = 0; i < POINTER.length; i++) {
        window.addEventListener(POINTER[i], onPointer, { capture: true, passive: false });
      }
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("keyup", onKey, true);
      window.addEventListener("keypress", onKey, true);
      window.addEventListener("blur", onWindowBlur);
      if (!child) {
        remember(true);
        self.children.forEach(function (screen) {
          screen.enter(overlay);
        });
      }
      refresh();
      tick();
    },
    exit: function () {
      if (!active) return;
      // Words being typed are kept, as leaving any editor does.
      if (editing) commitText();
      press = null;
      dragging = false;
      drop = null;
      active = false;
      for (var i = 0; i < POINTER.length; i++) {
        window.removeEventListener(POINTER[i], onPointer, { capture: true });
      }
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("keypress", onKey, true);
      window.removeEventListener("blur", onWindowBlur);
      passthrough = false;
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      hovered = null;
      selected = null;
      context = null;
      armed = null;
      message = "";
      if (ui) {
        ui.layer.hidden = true;
        ui.bar.hidden = true;
      }
      if (!child) {
        remember(false);
        self.children.forEach(function (screen) {
          screen.exit();
        });
      }
    },
  };
  self.onKey = onKey;
  self.release = release;

  if (child) {
    self.shared = parentEdit.shared;
    parentEdit.adopt(self);
    // A screen that navigates away takes its UI with it.
    window.addEventListener("pagehide", function () {
      self.exit();
      if (ui) {
        ui.layer.remove();
        ui.bar.remove();
      }
      if (self.shared.owner === self) self.shared.owner = parentEdit;
      parentEdit.disown(self);
    });
  } else {
    self.shared = { owner: self, hover: self };
    self.children = [];
    self.adopt = function (screen) {
      self.children.push(screen);
      if (active) screen.enter(host);
    };
    self.disown = function (screen) {
      self.children = self.children.filter(function (s) {
        return s !== screen;
      });
    };
    window.__ospEdit = self;
  }
})();`;

/**
 * The edit UI's stylesheet, added to the overlay's shadow root on first
 * entry. It uses the overlay's own custom properties, so it follows the
 * reviewer's light or dark choice.
 */
export const EDIT_CSS = `
.osp-overlay .ed-layer { position: fixed; inset: 0; pointer-events: none; z-index: 5; }
.osp-overlay .ed-layer[hidden], .osp-overlay .ed-box[hidden], .osp-overlay .ed-bar[hidden] { display: none; }
.osp-overlay .ed-box { position: fixed; box-sizing: border-box; pointer-events: none; }
.osp-overlay .ed-hover { outline: 1px dashed #2f6fed; outline-offset: -1px; }
.osp-overlay .ed-sel { outline: 2px solid #2f6fed; outline-offset: -1px; background: rgba(47, 111, 237, 0.06); }
.osp-overlay .ed-sel[data-locked] { outline-color: var(--co-done); background: rgba(107, 112, 118, 0.08); }
.osp-overlay .ed-tag {
  position: absolute; left: -2px; bottom: 100%; margin-bottom: 2px;
  padding: 1px 6px; border-radius: 4px; white-space: pre;
  background: #2f6fed; color: #fff;
  font: 500 11px/18px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.osp-overlay .ed-sel[data-locked] .ed-tag { background: var(--co-done); }
.osp-overlay .ed-sel[data-made] { outline-style: dashed; }
.osp-overlay .ed-scope[hidden] { display: none; }
.osp-overlay .ed-sel[data-typing] { outline-style: dashed; background: transparent; }
.osp-overlay .ed-sel[data-dragging] { opacity: 0.5; }
.osp-overlay .ed-panel { display: flex; flex-direction: column; gap: 8px; padding-top: 6px; border-top: 1px solid var(--co-line); }
.osp-overlay .ed-panel[hidden] { display: none; }
.osp-overlay .ed-note { color: var(--co-fg-2); font-size: 12px; max-width: 520px; }
.osp-overlay .ed-row { display: flex; align-items: center; gap: 4px; }
.osp-overlay .ed-row-label { width: 72px; color: var(--co-fg-2); font-size: 12px; }
.osp-overlay .ed-seg { padding: 3px 9px; }
.osp-overlay .ed-num {
  width: 64px; margin-left: 6px; padding: 3px 6px; border: 1px solid var(--co-line); border-radius: 6px;
  background: var(--co-bg); color: var(--co-fg); font: 12px/18px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.osp-overlay .ed-unit { color: var(--co-fg-3); font-size: 12px; }
.osp-overlay .ed-handle {
  position: absolute; width: 9px; height: 9px; box-sizing: border-box;
  background: #fff; border: 1.5px solid #2f6fed; border-radius: 2px; pointer-events: auto;
}
.osp-overlay .ed-handle-e { right: -5px; top: 50%; margin-top: -4px; cursor: ew-resize; }
.osp-overlay .ed-handle-s { bottom: -5px; left: 50%; margin-left: -4px; cursor: ns-resize; }
.osp-overlay .ed-handle-se { right: -5px; bottom: -5px; cursor: nwse-resize; }
.osp-overlay .ed-sel[data-locked] .ed-handle, .osp-overlay .ed-sel[data-typing] .ed-handle { display: none; }
.osp-overlay .ed-tabs { display: flex; gap: 4px; }
.osp-overlay .ed-tab {
  all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 8px; border-radius: 8px; color: var(--co-fg-2);
  font: 500 12px/18px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.osp-overlay .ed-tab:hover { background: var(--co-bg-2); }
.osp-overlay .ed-tab[data-current] { background: var(--co-bg-2); color: var(--co-fg); box-shadow: inset 0 0 0 1px var(--co-line); }
.osp-overlay .ed-tab:focus-visible, .osp-overlay .ed-swatch:focus-visible { outline: 2px solid #2f6fed; outline-offset: 1px; }
.osp-overlay .ed-chip { width: 12px; height: 12px; border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.2); }
.osp-overlay .ed-chip[data-none] { background: linear-gradient(135deg, transparent 45%, #d4421e 45%, #d4421e 55%, transparent 55%) !important; }
.osp-overlay .ed-swatches { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; max-width: 520px; }
.osp-overlay .ed-swatch {
  all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 6px;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.18);
}
.osp-overlay .ed-swatch:hover { transform: scale(1.12); }
.osp-overlay .ed-custom { width: 30px; height: 24px; padding: 0; border: 1px solid var(--co-line); border-radius: 6px; background: none; cursor: pointer; }
.osp-overlay .ed-ask[hidden] { display: none; }
.osp-overlay .ed-ask { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.osp-overlay .ed-ask-text { color: var(--co-fg); flex-basis: 100%; }
.osp-overlay .ed-btn[aria-pressed="true"] { background: var(--co-bg); border-color: var(--co-fg-3); }
.osp-overlay .ed-drop { position: fixed; background: #2f6fed; border-radius: 2px; pointer-events: none; }
.osp-overlay .ed-drop[hidden] { display: none; }
.osp-overlay .ed-drop[data-box] { background: rgba(47, 111, 237, 0.12); outline: 2px dashed #2f6fed; outline-offset: -2px; }
.osp-overlay .ed-guide { position: fixed; background: #e5398f; pointer-events: none; }
.osp-overlay .ed-guide[hidden] { display: none; }
.osp-overlay .ed-bar {
  position: fixed; z-index: 6; box-sizing: border-box;
  width: max-content; max-width: min(560px, calc(100vw - 16px));
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 10px; border: 1px solid var(--co-line); border-radius: 12px;
  background: var(--co-bg); color: var(--co-fg);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.osp-overlay .ed-crumbs { display: flex; flex-wrap: wrap; align-items: center; color: var(--co-fg-3); font-size: 12px; }
.osp-overlay .ed-crumbs:empty { display: none; }
.osp-overlay .ed-crumb {
  all: unset; cursor: pointer; padding: 0 3px; border-radius: 4px;
  font: 12px/18px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--co-fg-2);
}
.osp-overlay .ed-crumb:hover { background: var(--co-bg-2); color: var(--co-fg); }
.osp-overlay .ed-crumb[data-current] { color: var(--co-fg); font-weight: 600; }
.osp-overlay .ed-status { color: var(--co-fg-2); max-width: 540px; }
.osp-overlay .ed-status[data-warn] { color: var(--co-ink); }
.osp-overlay .ed-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.osp-overlay .ed-btn {
  all: unset; cursor: pointer; padding: 4px 10px; border-radius: 8px; white-space: nowrap;
  border: 1px solid var(--co-line); background: var(--co-bg-2); color: var(--co-fg);
  font: 500 12px/18px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.osp-overlay .ed-btn:hover:not(:disabled) { border-color: var(--co-fg-3); }
.osp-overlay .ed-btn:focus-visible { outline: 2px solid #2f6fed; outline-offset: 1px; }
.osp-overlay .ed-btn:disabled { opacity: 0.45; cursor: default; }
.osp-overlay .ed-btn[hidden] { display: none; }
.osp-overlay .ed-danger:not(:disabled) { color: var(--co-danger); }
`;

/** Serializes a value into a `<script>` without letting it close the tag. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export interface EditBoot {
  /** The page's preview path, which is how the server finds its file. */
  page: string;
  /** Hash of the file the page was served from. */
  hash: string;
  ok: boolean;
  reason?: string;
  /** Edits the server can still undo and redo for this page. */
  history?: { undo: number; redo: number };
  /** Linked stylesheets, by preview path, the notch may write to. */
  sheets?: string[];
}

/** The two scripts the server puts at the top of an editable page. */
export function editInjection(boot: EditBoot): string {
  return (
    `<script data-osp-edit>window.__ospEditBoot=${scriptJson(boot)};</script>` +
    // In a block, so EDIT_CSS is not left behind as a global of the page.
    `<script data-osp-edit>{const EDIT_CSS=${scriptJson(EDIT_CSS)};\n${EDIT_SCRIPT}}</script>`
  );
}
