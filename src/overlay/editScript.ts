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
import { EDIT_PANEL } from "./editPanel";
import { EDIT_TOOLS } from "./editTools";

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

  /* A question waiting on an answer: { sec, text, choices: [{ label, run }] }. */
  var ask = null;

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
        sec: currentSec,
        text: "The " + what + " is set in " + sheetName(win.owner) + ", which can't be edited from here yet.",
        choices: [{ label: "Set it on this one", run: function () { applyInlineProps(target, props, what); } }],
      };
      refresh();
      return;
    }

    var n = countMatching(win.rule.selectorText);
    if (n > 1) {
      ask = {
        sec: currentSec,
        text: "The rule " + win.rule.selectorText + " sets the " + what + " of " + n + " layers.",
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

  function applyInlineProps(target, props, what, then, fail) {
    ask = null;
    var name = label(target);
    var before = null;
    act(
      { op: "inline-style", at: stampOf(target), props: props },
      what + " change on " + name,
      function (data) {
        before = target.getAttribute("style");
        quiet(function () {
          for (var i = 0; i < props.length; i++) {
            if (props[i][1] === "") target.style.removeProperty(props[i][0]);
            else target.style.setProperty(props[i][0], props[i][1]);
          }
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
        message = "Set the " + what + " of " + name + " on the layer itself.";
        if (then) then();
      },
      fail,
    );
  }

  function applyRuleProps(win, props, what, then, fail) {
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
        for (var i = 0; i < props.length; i++) {
          if (props[i][1] === "") rule.style.removeProperty(props[i][0]);
          else rule.style.setProperty(props[i][0], props[i][1], old[i][2]);
        }
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
        if (then) then();
      },
      fail,
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
          sec: currentSec,
          text: "The rule " + win.rule.selectorText + " sets the " + what + " of " + n + " layers, and a new rule would not win against it.",
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
  function addRuleFor(target, props, what, media, then, fail) {
    var selector = stableSelector(target);
    if (!selector) {
      ask = null;
      message = "Nothing names this element well enough to write a rule for it.";
      refresh();
      if (fail) fail();
      return;
    }
    addRuleSel(selector, props, what, media, then, fail);
  }

  /* Writes props into a rule for selector, as addRuleFor does for a layer. */
  function addRuleSel(selector, props, what, media, then, fail) {
    ask = null;
    var sheet = lastSheet();
    var n = countMatching(selector);
    var body = { op: "add-rule", sheet: sheet ? stampOf(sheet) : null, selector: selector, props: props };
    if (media) body.media = media;
    var css = selector + "{" + props.filter(function (pair) { return pair[1] !== ""; }).map(function (pair) { return pair[0] + ":" + pair[1]; }).join(";") + "}";
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
          "added a rule for " + selector + (n > 1 ? ", which styles " + n + " layers like it." : ".") +
          (sheet ? "" : " The file had no style block, so one went into its head.");
        if (then) then();
      },
      fail,
    );
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
  /* Every selected layer when there are several; selected is the last of them. */
  var selection = [];
  /* The many-edit gesture in progress: { id, parts, what }, or null. */
  var group = null;
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
    selection = el ? [el] : [];
    clearState();
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
      selection = [];
      clearState();
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
    if (group) body.group = group.id;
    send(
      body,
      function (data) {
        counted(data);
        if (!data.id) {
          message = "Nothing changed.";
          // A step of a gesture that changed nothing still lets the next one go.
          if (group && after) after(data);
          return;
        }
        apply(data);
        var part = { id: data.id, apply: apply, revert: revert };
        if (group) group.parts.push(part);
        else {
          log.push({ what: what, parts: [part] });
          redone = [];
        }
        if (child && frameEl && frameEl.hasAttribute("data-osp-device")) self.shared.deviceEdited = true;
        if (after) after(data);
      },
      failed,
    );
  }

  function remove(then, fail) {
    var el = selected;
    if (!el || busy || whyNot(el)) return fail ? fail() : undefined;
    var refs = scriptRefs(el);
    if (refs && armed !== el && !then) {
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
        if (then) then();
      },
      fail,
    );
  }

  function hide(then, fail) {
    var el = selected;
    if (!el || busy) return fail ? fail() : undefined;
    // Hidden at this width and narrower, or a script-made element: a rule.
    if (narrow || (whyNot(el) && !styleWhyNot(el))) {
      if (!styleWhyNot(el)) styleChange(el, [["display", "none"]], "visibility");
      return then ? then() : undefined;
    }
    if (whyNot(el)) return fail ? fail() : undefined;
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
        if (then) then();
      },
      fail,
    );
  }

  function hasIds(el) {
    return !!(el.id || el.querySelector("[id]"));
  }

  function duplicate(then, fail) {
    var el = selected;
    if (!el || busy || whyNot(el)) return fail ? fail() : undefined;
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
        if (then) {
          pasted.push(copy);
          then();
          return;
        }
        select(copy);
        message =
          "Duplicated " + name + "." +
          (hasIds(el) ? " The copy repeats the original's id, which the page's script may trip over." : "");
      },
      fail,
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
  /* Sends one undo or redo per part, in order, and runs each part's half. */
  function stepParts(parts, op, done) {
    var i = 0;
    function next() {
      if (i >= parts.length) return done();
      var part = parts[i++];
      send({ op: op, id: part.id }, function (data) {
        counted(data);
        (op === "undo" ? part.revert : part.apply)(data);
        next();
      });
    }
    next();
  }

  function undo(then) {
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
    clearState();
    stepParts(entry.parts.slice().reverse(), "undo", function () {
      log.pop();
      redone.push(entry);
      message = "Undid the " + entry.what + ".";
      refresh();
      if (typeof then === "function") then();
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
    clearState();
    stepParts(entry.parts, "redo", function () {
      redone.pop();
      log.push(entry);
      message = "Redid the " + entry.what + ".";
      refresh();
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
${EDIT_TOOLS}
${EDIT_PANEL}

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
    if (placing) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if ((event.type === "pointerdown" || event.type === "mousedown") && event.button !== 2) closeMenus();
      placingPointer(event);
      return;
    }
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
    // A new press closes a menu; the release of the right-click that opened one does not.
    if ((event.type === "pointerdown" || event.type === "mousedown") && event.button !== 2) closeMenus();

    if (event.type === "contextmenu") {
      var hit = candidate(event.target, event.altKey);
      if (hit && targets().indexOf(hit) === -1) select(hit);
      openContextMenu(event.clientX, event.clientY);
      return;
    }
    if (event.type === "pointerdown") dragged = false;
    if (event.type === "pointerdown" && event.button === 0) {
      // Alt on the selection is a drag that leaves a copy behind; Alt
      // anywhere else is still the deep click.
      if (selected && selected.contains(event.target) && !whyNot(selected) && !event.shiftKey) {
        press = { x: event.clientX, y: event.clientY, el: selected, copy: event.altKey };
      }
      return;
    }
    if (event.type === "pointerup") {
      if (press && dragging && press.copy && (drop || freeDrag)) {
        if (freeDrag) {
          var shown = freeDrag.shown;
          var source = press.el;
          var spot = freePlace(source, shown.x, shown.y);
          quiet(function () {
            if (freeDrag.before === null) source.style.removeProperty("translate");
            else source.style.setProperty("translate", freeDrag.before);
          });
          showGuides(null);
          freeDrag = null;
          pasted = [];
          runGroup([
            function (next, stop) {
              copyTo(source, source, "after", function () {
                next();
              }, stop);
            },
            function (next, stop) {
              applyInlineProps(pasted[0], [["left", spot.left + "px"], ["top", spot.top + "px"]], "position", next, stop);
            },
          ], "copy of " + label(source), function () {
            if (pasted[0]) selectMany([pasted[0]]);
          });
        } else if (drop.place !== "cell") {
          pasted = [];
          runGroup([
            function (next, stop) {
              copyTo(press.el, drop.target, drop.place, function () {
                next();
              }, stop);
            },
          ], "copy of " + label(press.el), function () {
            if (pasted[0]) selectMany([pasted[0]]);
          });
        }
      } else if (press && dragging && freeDrag) finishFree(press.el);
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
      if (event.shiftKey && el) {
        toggleSelect(el);
      } else if (!el) {
        selected = null;
        selection = [];
        clearState();
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
    measuring = !!event.altKey;
    if (placing) {
      event.stopImmediatePropagation();
      hovered = null;
      placingMove(event);
      return;
    }
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

    if (key === "Alt") {
      measuring = event.type === "keydown";
      draw();
      if (!editing) return;
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
    // Letters by the key pressed, not the character: Alt changes the character.
    var letter = /^Key[A-Z]$/.test(event.code || "") ? event.code.slice(3).toLowerCase() : key.toLowerCase();
    if (event.type === "keydown" && figmaKey(event, mod, letter)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
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
        duplicateAll();
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

    if (placing && (key === "Escape" || key === "Enter")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type !== "keydown") return;
      if (closeMenus()) return;
      if (key === "Escape") stopPlacing();
      else insert(placing.kind, placing.src, null, null, placing.like);
      return;
    }
    if (key === "Escape") {
      if (closeMenus()) {
        event.stopImmediatePropagation();
        return;
      }
      if (forced) {
        event.stopImmediatePropagation();
        if (event.type === "keydown") showState("default");
        return;
      }
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
      removeAll();
    } else if (key === "Enter" && event.shiftKey) {
      event.preventDefault();
      up();
    } else if (key === "Tab") {
      event.preventDefault();
      var sib = stampedSibling(selected, event.shiftKey ? -1 : 1) || (event.shiftKey ? selected.parentElement && selected.parentElement.lastElementChild : selected.parentElement && selected.parentElement.firstElementChild);
      if (sib && sib !== selected) select(sib);
    } else if (key === "Enter") {
      event.preventDefault();
      if (retypable(selected)) startText();
      else {
        var first = selected.firstElementChild;
        if (first) select(first);
      }
    } else if (/^Arrow/.test(key) && positioned(selected)) {
      event.preventDefault();
      var step = event.shiftKey ? 10 : 1;
      nudgeFree(key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0, key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0);
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

  /* A bar button: an icon and its word. */
  function barButton(iconName, text, title, action) {
    var b = el("button", "ed-btn");
    b.type = "button";
    b.title = title;
    b.innerHTML = icon(iconName, 14) + "<span></span>";
    b.lastChild.textContent = text;
    b.addEventListener("click", function (event) {
      event.stopPropagation();
      action();
    });
    return b;
  }

  function setWord(b, text) {
    if (b.lastChild) b.lastChild.textContent = text;
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
    var others = el("div", "ed-others");
    var dropLine = el("div", "ed-drop");
    var dropParent = el("div", "ed-box ed-drop-parent");
    dropParent.hidden = true;
    var ghost = el("div", "ed-ghost");
    ghost.appendChild(el("span"));
    ghost.hidden = true;
    var guideX = el("div", "ed-guide");
    var guideY = el("div", "ed-guide");
    var measure = el("div", "ed-measure");
    guideX.hidden = true;
    guideY.hidden = true;
    [["e", { w: true }], ["s", { h: true }], ["se", { w: true, h: true }]].forEach(function (handle) {
      var grip = el("div", "ed-handle ed-handle-" + handle[0]);
      grip.addEventListener("pointerdown", function (event) {
        startResize(event, handle[1]);
      });
      selBox.appendChild(grip);
    });
    layer.appendChild(others);
    layer.appendChild(hoverBox);
    layer.appendChild(selBox);
    layer.appendChild(dropParent);
    layer.appendChild(dropLine);
    layer.appendChild(ghost);
    layer.appendChild(guideX);
    layer.appendChild(guideY);
    layer.appendChild(measure);

    var bar = el("div", "ed-bar");
    ["keydown", "keyup", "keypress"].forEach(function (type) {
      bar.addEventListener(type, function (event) {
        event.stopPropagation();
      });
    });
    var crumbs = el("div", "ed-crumbs");
    var status = el("div", "ed-status");
    var actions = el("div", "ed-actions");
    var textBtn = barButton("text", "Edit text", "Retype its words (Enter, or double-click)", startText);
    var copyBtn = barButton("copy", "Duplicate", "Put a copy after it (" + (MAC ? "\u2318D" : "Ctrl+D") + ", or Alt-drag)", duplicateAll);
    var hideBtn = barButton("eyeOff", "Hide", "Hide it: adds display: none to the file (" + (MAC ? "\u21e7\u2318H" : "Shift+Ctrl+H") + ")", hideOrShow);
    var deleteBtn = barButton("trash", "Delete", "Delete it from the file (Delete)", removeAll);
    deleteBtn.classList.add("ed-danger");
    // Figma's tools, by icon and key. A tool stays out until it is used or
    // put down, and the page shows where it would land.
    var tools = {};
    ["frame", "rect", "text", "image"].forEach(function (kind) {
      var k = INSERTS[kind];
      var keys = kind === "image" ? (MAC ? "\u21e7\u2318K" : "Shift+Ctrl+K") : k.key;
      var b = barButton(k.icon, k.label, k.label + " (" + keys + ")" + (kind === "image" ? ": pick one from this page's folder" : ": click the page to place it, or drag to size it"), function () {
        if (kind === "image") openPop("image", b);
        else armTool(kind);
      });
      b.classList.add("ed-quiet", "ed-tool");
      b.setAttribute("aria-label", k.label);
      if (kind !== "image") b.appendChild(el("kbd", "ed-key", k.key));
      tools[kind] = b;
    });
    var moreBtn = barButton("plus", "More", "More: heading, button, link, input, divider and list, in this page's own style", function () {
      openPop("more", moreBtn);
    });
    moreBtn.classList.add("ed-quiet", "ed-tool", "ed-more");
    moreBtn.setAttribute("aria-label", "More layers");
    moreBtn.insertAdjacentHTML("beforeend", icon("chev", 10));
    var historyBtn = barButton("history", "History", "History: every edit this session, with Undo to here", showHistory);
    var undoBtn = barButton("undo", "Undo", "Undo the last edit (" + UNDO_KEY + ")", undo);
    var redoBtn = barButton("redo", "Redo", "Redo what was undone (" + REDO_KEY + ")", redo);
    var reloadBtn = barButton("reload", "Reload", "Reload the page from the file", function () {
      location.reload();
    });
    [undoBtn, redoBtn, historyBtn].forEach(function (b) {
      b.classList.add("ed-quiet");
    });
    actions.appendChild(textBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(hideBtn);
    actions.appendChild(deleteBtn);
    actions.appendChild(el("span", "ed-gap"));
    ["frame", "rect", "text", "image"].forEach(function (kind) {
      actions.appendChild(tools[kind]);
    });
    actions.appendChild(moreBtn);
    actions.appendChild(el("span", "ed-gap"));
    actions.appendChild(undoBtn);
    actions.appendChild(redoBtn);
    actions.appendChild(historyBtn);
    actions.appendChild(reloadBtn);
    var insertMenu = el("div", "ed-menu ed-insert");
    insertMenu.hidden = true;
    bar.appendChild(crumbs);
    bar.appendChild(status);
    bar.appendChild(actions);
    bar.appendChild(insertMenu);
    var menu = el("div", "ed-menu ed-context");
    menu.hidden = true;
    menu.addEventListener("keydown", function (event) {
      event.stopPropagation();
    });

    host.wrap.appendChild(layer);
    host.wrap.appendChild(bar);
    host.wrap.appendChild(menu);

    var built = {
      layer: layer,
      hoverBox: hoverBox,
      selBox: selBox,
      others: others,
      tag: tag,
      dropLine: dropLine,
      dropParent: dropParent,
      ghost: ghost,
      guideX: guideX,
      guideY: guideY,
      measure: measure,
      textBtn: textBtn,
      copyBtn: copyBtn,
      tools: tools,
      moreBtn: moreBtn,
      historyBtn: historyBtn,
      insertMenu: insertMenu,
      menu: menu,
      bar: bar,
      crumbs: crumbs,
      status: status,
      hideBtn: hideBtn,
      deleteBtn: deleteBtn,
      undoBtn: undoBtn,
      redoBtn: redoBtn,
      reloadBtn: reloadBtn,
      panel: null,
    };
    if (host.panel && host.panel.slot) {
      ui = built;
      built.panel = buildPanel(host.panel.slot);
    }
    return built;
  }

  /* --- menus ----------------------------------------------------------- */

  /* Closes the insert and right-click menus; true if one was open. */
  function closeMenus() {
    if (!ui) return false;
    var was = !ui.menu.hidden || !ui.insertMenu.hidden;
    ui.menu.hidden = true;
    ui.insertMenu.hidden = true;
    ui.moreBtn.removeAttribute("aria-expanded");
    ui.tools.image.removeAttribute("aria-expanded");
    return was;
  }

  function menuItem(box, text, keys, run, enabled) {
    var b = el("button", "ed-menu-item");
    b.type = "button";
    b.appendChild(el("span", null, text));
    if (keys) b.appendChild(el("kbd", null, keys));
    b.disabled = !enabled;
    b.addEventListener("click", function (event) {
      event.stopPropagation();
      closeMenus();
      run();
    });
    box.appendChild(b);
  }

  /* Nothing selected, so the panel shows the page, opened at History. */
  function showHistory() {
    stopPlacing();
    selected = null;
    selection = [];
    clearState();
    context = null;
    armed = null;
    message = "";
    showSection("history");
  }

  function openContextMenu(x, y) {
    var box = ui.menu;
    box.textContent = "";
    var list = targets();
    var one = list.length === 1 ? list[0] : null;
    var can = list.length > 0 && list.every(function (n) {
      return !whyNot(n);
    });
    var k = MAC ? { cmd: "\u2318", alt: "\u2325", shift: "\u21e7" } : { cmd: "Ctrl+", alt: "Alt+", shift: "Shift+" };
    function sep() {
      box.appendChild(el("div", "ed-menu-sep"));
    }
    menuItem(box, "Copy", k.cmd + "C", copyLayers, can);
    menuItem(box, "Paste", k.cmd + "V", pasteLayers, clipboard.length > 0);
    menuItem(box, "Duplicate", k.cmd + "D", duplicateAll, can);
    menuItem(box, "Delete", MAC ? "\u232b" : "Del", removeAll, can);
    sep();
    menuItem(box, "Frame selection", k.alt + k.cmd + "G", frameSelection, can);
    menuItem(box, "Ungroup", k.shift + k.cmd + "G", ungroup, !!one && can && one.children.length > 0);
    menuItem(box, "Add auto layout", k.shift + "A", addAutoLayout, list.length > 0);
    sep();
    menuItem(box, "Copy properties", k.alt + k.cmd + "C", copyProperties, !!one);
    menuItem(box, "Paste properties", k.alt + k.cmd + "V", pasteProperties, !!copiedLook && list.length > 0);
    sep();
    menuItem(box, "Select matching layers", "", selectMatching, !!one);
    menuItem(box, "Select all beside it", k.cmd + "A", selectAll, list.length > 0);
    menuItem(box, "Bring forward", k.cmd + "]", function () {
      nudge(1);
    }, !!one && can);
    menuItem(box, "Send backward", k.cmd + "[", function () {
      nudge(-1);
    }, !!one && can);
    sep();
    menuItem(box, "Hide or show", k.shift + k.cmd + "H", hideOrShow, list.length > 0);
    menuItem(box, "Edit text", "\u21b5", startText, !!one && can && retypable(one));
    box.hidden = false;
    var at = toHost({ left: x, top: y, width: 0, height: 0 });
    var w = box.offsetWidth || 220;
    var h = box.offsetHeight || 420;
    box.style.left = Math.max(8, Math.min(hostWin.innerWidth - w - 8, at.left)) + "px";
    box.style.top = Math.max(8, Math.min(hostWin.innerHeight - h - 8, at.top)) + "px";
  }

  function duplicateAll() {
    var list = targets();
    if (list.length < 2) return duplicate();
    pasted = [];
    runGroup(inOrder(list).map(function (n) {
      return function (next, stop) {
        selected = n;
        duplicate(next, stop);
      };
    }), "duplicate of " + list.length + " layers", function () {
      selectMany(pasted.slice());
    });
  }

  function removeAll() {
    var list = targets();
    if (list.length < 2) return remove();
    runGroup(inOrder(list).map(function (n) {
      return function (next, stop) {
        selected = n;
        remove(next, stop);
      };
    }), "delete of " + list.length + " layers", function () {
      selected = null;
      selection = [];
      refresh();
    });
  }

  /* Figma's keys; true when the key was one of them. */
  function figmaKey(event, mod, letter) {
    var alt = event.altKey;
    var shift = event.shiftKey;
    var key = event.key;
    // The tools. R is Figma's rectangle here, as it is in Figma; Review
    // mode is a click on the notch away.
    if (!mod && !alt && !shift && (letter === "f" || letter === "r" || letter === "t")) {
      return armTool(letter === "f" ? "frame" : letter === "r" ? "rect" : "text"), true;
    }
    if (mod && shift && !alt && letter === "k" && ui) return openPop("image", ui.tools.image), true;
    if (!mod && !alt && shift && letter === "a") return addAutoLayout(), true;
    if (!mod && !alt && !shift && letter === "i" && selected) return eyedrop(), true;
    if (mod && alt && !shift && letter === "c" && selected) return copyProperties(), true;
    if (mod && alt && !shift && letter === "v" && selected) return pasteProperties(), true;
    if (mod && alt && !shift && letter === "g" && selected) return frameSelection(), true;
    if (mod && !alt && !shift && letter === "g" && selected) return frameSelection(), true;
    if (mod && shift && !alt && letter === "g" && selected) return ungroup(), true;
    if (mod && shift && !alt && letter === "h" && selected) return hideOrShow(), true;
    if (mod && !alt && !shift && letter === "c" && selected) return copyLayers(), true;
    if (mod && !alt && !shift && letter === "v" && clipboard.length) return pasteLayers(), true;
    if (mod && !alt && !shift && letter === "a" && (selected || context)) return selectAll(), true;
    if (mod && !alt && (key === "]" || key === "[") && selected) return nudge(key === "]" ? 1 : -1), true;
    return false;
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
    stopPlacing();
    selected = null;
    selection = [];
    clearState();
    context = null;
    armed = null;
    ask = null;
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
    ui.bar.hidden = !owns() || !!device;
    drawOthers();
    drawMeasure();
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

  /* Boxes round the rest of a selection of many. */
  function drawOthers() {
    var list = targets().filter(function (n) {
      return n !== selected;
    });
    var box = ui.others;
    while (box.children.length > list.length) box.removeChild(box.lastChild);
    while (box.children.length < list.length) box.appendChild(el("div", "ed-box ed-also"));
    for (var i = 0; i < list.length; i++) place(box.children[i], list[i]);
  }

  /* The line that shows where a drop would put the selection. */
  function drawDrop() {
    var line = ui.dropLine;
    var shown = placing ? (placePress ? placePress.spot : spot) : dragging ? drop : null;
    var parent = placing && shown && shown.parent && shown.place !== "inside" ? shown.parent : null;
    place(ui.dropParent, parent);
    if (placing && shown && !shown.target) shown = null;
    if (!shown) {
      line.hidden = true;
      return;
    }
    line.hidden = false;
    line.toggleAttribute("data-box", !!shown.box);
    if (shown.box) {
      var b = toHost(shown.place === "inside" && shown.target ? shown.target.getBoundingClientRect() : shown.box);
      line.style.left = b.left + "px";
      line.style.top = b.top + "px";
      line.style.width = b.width + "px";
      line.style.height = b.height + "px";
      return;
    }
    var r = toHost(shown.target.getBoundingClientRect());
    if (shown.across) {
      line.style.left = (shown.place === "before" ? r.left : r.right) - 1 + "px";
      line.style.top = r.top + "px";
      line.style.width = "3px";
      line.style.height = r.height + "px";
    } else {
      line.style.left = r.left + "px";
      line.style.top = (shown.place === "before" ? r.top : r.bottom) - 1 + "px";
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
    var count = targets().length;
    ui.status.textContent =
      message ||
      (count > 1 ? count + " layers selected. Shift-click to add or take one away." : "") ||
      why ||
      (selected ? hint(selected) : "Click a layer to select it. Double-click to go inside, Esc to go up. Right-click for more.");
    ui.status.toggleAttribute("data-warn", !!(styleBlocked || (!selected && why) || (armed && armed === selected)));
    if (placing) {
      ui.status.textContent = placingHint();
      ui.status.setAttribute("data-placing", "");
    } else ui.status.removeAttribute("data-placing");
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
    var list = targets();
    var can = !!selected && !blocked && !busy && !editing;
    var all = list.length > 0 && !busy && !editing && list.every(function (n) {
      return !whyNot(n);
    });
    ui.textBtn.disabled = !can || list.length > 1 || !retypable(selected);
    ui.copyBtn.disabled = !all;
    var canStyle = !!selected && !styleBlocked && !busy && !editing;
    ui.hideBtn.disabled = !(all || (canStyle && (narrow || !!blocked)));
    var hiddenAll = list.length > 0 && list.every(function (n) {
      return n.style.display === "none";
    });
    setWord(ui.hideBtn, hiddenAll ? "Show" : "Hide");
    ui.deleteBtn.disabled = !all;
    setWord(ui.deleteBtn, armed && armed === selected ? "Delete anyway" : "Delete");
    var canInsert = !busy && !editing && !unavailable && !stale;
    for (var kind in ui.tools) {
      ui.tools[kind].disabled = !canInsert;
      ui.tools[kind].toggleAttribute("data-armed", !!placing && placing.kind === kind);
    }
    ui.moreBtn.disabled = !canInsert;
    ui.moreBtn.toggleAttribute("data-armed", !!placing && MORE.indexOf(placing.kind) >= 0);
    ui.historyBtn.disabled = !log.length;
    ui.undoBtn.disabled = !(log.length || serverHistory.undo) || busy || !!stale;
    ui.redoBtn.disabled = !(redone.length || serverHistory.redo) || busy || !!stale;
    ui.reloadBtn.hidden = !stale;
    renderPanel();
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
      stopPlacing();
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
      selection = [];
      clearState();
      if (device) showDevice("full");
      context = null;
      armed = null;
      message = "";
      measuring = false;
      if (ui) {
        closeMenus();
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
        ui.menu.remove();
        if (ui.panel) ui.panel.root.remove();
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
.osp-overlay .ed-layer[hidden], .osp-overlay .ed-box[hidden], .osp-overlay .ed-bar[hidden], .osp-overlay .ed-menu[hidden] { display: none; }
.osp-overlay .ed-box { position: fixed; box-sizing: border-box; pointer-events: none; }
.osp-overlay .ed-hover { outline: 1px dashed #2f6fed; outline-offset: -1px; }
.osp-overlay .ed-sel { outline: 2px solid #2f6fed; outline-offset: -1px; background: rgba(47, 111, 237, 0.06); }
.osp-overlay .ed-also { outline: 2px solid #2f6fed; outline-offset: -1px; background: rgba(47, 111, 237, 0.04); }
.osp-overlay .ed-sel[data-locked] { outline-color: var(--co-done); background: rgba(107, 112, 118, 0.08); }
.osp-overlay .ed-tag {
  position: absolute; left: -2px; bottom: 100%; margin-bottom: 2px;
  padding: 1px 6px; border-radius: 4px; white-space: pre;
  background: #2f6fed; color: #fff;
  font: 500 11px/18px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.osp-overlay .ed-sel[data-locked] .ed-tag { background: var(--co-done); }
.osp-overlay .ed-sel[data-made] { outline-style: dashed; }
.osp-overlay .ed-sel[data-typing] { outline-style: dashed; background: transparent; }
.osp-overlay .ed-sel[data-dragging] { opacity: 0.5; }
.osp-overlay .ed-handle {
  position: absolute; width: 9px; height: 9px; box-sizing: border-box;
  background: #fff; border: 1.5px solid #2f6fed; border-radius: 2px; pointer-events: auto;
}
.osp-overlay .ed-handle-e { right: -5px; top: 50%; margin-top: -4px; cursor: ew-resize; }
.osp-overlay .ed-handle-s { bottom: -5px; left: 50%; margin-left: -4px; cursor: ns-resize; }
.osp-overlay .ed-handle-se { right: -5px; bottom: -5px; cursor: nwse-resize; }
.osp-overlay .ed-sel[data-locked] .ed-handle, .osp-overlay .ed-sel[data-typing] .ed-handle { display: none; }
.osp-overlay .ed-drop { position: fixed; background: #2f6fed; border-radius: 2px; pointer-events: none; }
.osp-overlay .ed-drop[hidden] { display: none; }
.osp-overlay .ed-drop[data-box] { background: rgba(47, 111, 237, 0.12); outline: 2px dashed #2f6fed; outline-offset: -2px; }
.osp-overlay .ed-guide { position: fixed; background: #e5398f; pointer-events: none; }
.osp-overlay .ed-guide[hidden] { display: none; }
.osp-overlay .ed-measure-line { position: fixed; background: #f24822; pointer-events: none; }
.osp-overlay .ed-measure-tag {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  padding: 0 5px; border-radius: 4px; background: #f24822; color: #fff; white-space: nowrap;
  font: 600 11px/17px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; font-variant-numeric: tabular-nums;
}

/* the bar: what to do to the selection */
.osp-overlay .ed-bar {
  position: fixed; z-index: 6; box-sizing: border-box;
  width: max-content; max-width: min(760px, calc(100vw - 16px));
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 10px; border: 1px solid var(--co-line); border-radius: 12px;
  background: var(--co-bg); color: var(--co-fg);
  box-shadow: var(--co-shadow);
  font: 13px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.osp-overlay .ed-crumbs { display: flex; flex-wrap: wrap; align-items: center; color: var(--co-fg-3); font-size: 12px; }
.osp-overlay .ed-crumbs:empty { display: none; }
.osp-overlay .ed-crumb {
  all: unset; cursor: pointer; padding: 0 4px; border-radius: 4px;
  font: 12px/18px Inter, ui-sans-serif, system-ui, sans-serif; color: var(--co-fg-2);
}
.osp-overlay .ed-crumb:hover { background: var(--co-bg-2); color: var(--co-fg); }
.osp-overlay .ed-crumb[data-current] { color: var(--co-fg); font-weight: 600; }
.osp-overlay .ed-status { color: var(--co-fg-2); max-width: 600px; font-size: 12px; }
.osp-overlay .ed-status[data-warn] { color: var(--co-ink); }
.osp-overlay .ed-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.osp-overlay .ed-gap { width: 1px; height: 18px; margin: 0 4px; background: var(--co-line); }
.osp-overlay .ed-btn {
  all: unset; cursor: pointer; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 10px; border-radius: 8px; white-space: nowrap;
  border: 1px solid var(--co-line); background: var(--co-bg); color: var(--co-fg);
  font: 500 12px/18px Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.osp-overlay .ed-btn svg { color: var(--co-fg-2); flex: none; }
.osp-overlay .ed-btn:hover:not(:disabled) { background: var(--co-bg-2); border-color: var(--co-fg-3); }
.osp-overlay .ed-btn:focus-visible { outline: 2px solid #2f6fed; outline-offset: 1px; }
.osp-overlay .ed-btn:disabled { opacity: 0.4; cursor: default; }
.osp-overlay .ed-btn[hidden] { display: none; }
.osp-overlay .ed-btn.ed-quiet { border-color: transparent; padding: 0 8px; }
.osp-overlay .ed-btn.ed-quiet span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.osp-overlay .ed-danger:not(:disabled):hover { color: var(--co-danger); }
.osp-overlay .ed-danger:not(:disabled):hover svg { color: var(--co-danger); }
.osp-overlay .ed-btn[aria-expanded] { background: var(--co-bg-2); border-color: var(--co-fg-3); }

/* menus: insert, and the right-click one */
.osp-overlay .ed-menu {
  box-sizing: border-box; min-width: 220px; max-height: min(480px, calc(100vh - 32px)); overflow-y: auto;
  padding: 4px; border: 1px solid var(--co-line); border-radius: 10px;
  background: var(--co-bg); color: var(--co-fg); box-shadow: var(--co-shadow);
  font: 12px/16px Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.osp-overlay .ed-insert { position: absolute; left: 0; bottom: calc(100% + 6px); }
.osp-overlay .ed-context { position: fixed; z-index: 8; }
.osp-overlay .ed-menu-item {
  all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 16px;
  width: 100%; height: 28px; padding: 0 8px; border-radius: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.osp-overlay .ed-menu-item:hover:not(:disabled) { background: #2f6fed; color: #fff; }
.osp-overlay .ed-menu-item:hover:not(:disabled) kbd { color: rgba(255, 255, 255, 0.8); }
.osp-overlay .ed-menu-item:disabled { opacity: 0.4; cursor: default; }
.osp-overlay .ed-menu-item kbd { font: inherit; color: var(--co-fg-3); }
.osp-overlay .ed-menu-sep { height: 1px; margin: 4px 6px; background: var(--co-line); }
.osp-overlay .ed-menu-note { padding: 6px 8px 2px; color: var(--co-fg-3); font-size: 11px; }

/* the insert tools: icons with their key, blue while one is out */
.osp-overlay .ed-btn.ed-tool { position: relative; padding: 0 7px; }
.osp-overlay .ed-tool .ed-key { position: absolute; right: 1px; bottom: 0; font: 600 8.5px/1 Inter, ui-sans-serif, system-ui, sans-serif; color: var(--co-fg-3); pointer-events: none; }
.osp-overlay .ed-btn.ed-tool[data-armed] { background: #2f6fed; border-color: #2f6fed; }
.osp-overlay .ed-btn.ed-tool[data-armed] svg, .osp-overlay .ed-tool[data-armed] .ed-key { color: #fff; }
.osp-overlay .ed-more svg:last-child { width: 10px; margin-left: -3px; }
.osp-overlay .ed-status[data-placing] { color: #2f6fed; font-weight: 500; }
.osp-overlay .ed-menu-rich { justify-content: flex-start; gap: 8px; }
.osp-overlay .ed-menu-rich svg { color: var(--co-fg-2); flex: none; }
.osp-overlay .ed-menu-rich span { flex: 1; }
.osp-overlay .ed-menu-rich kbd { max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
.osp-overlay .ed-menu-rich:hover:not(:disabled) svg { color: #fff; }
.osp-overlay .ed-insert[data-pop="image"] { width: 300px; }
.osp-overlay .ed-search {
  box-sizing: border-box; width: calc(100% - 8px); height: 28px; margin: 6px 4px; padding: 0 8px;
  border: 1px solid var(--co-line); border-radius: 6px; background: var(--co-bg-2); color: var(--co-fg); font: inherit;
}
.osp-overlay .ed-search:focus { outline: 2px solid #2f6fed; outline-offset: -1px; }
.osp-overlay .ed-thumbs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 0 4px 4px; }
.osp-overlay .ed-thumb {
  all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid var(--co-line); border-radius: 6px; background: var(--co-bg);
}
.osp-overlay .ed-thumb:hover, .osp-overlay .ed-thumb:focus-visible { outline: 2px solid #2f6fed; outline-offset: -1px; }
.osp-overlay .ed-thumb img, .osp-overlay .ed-thumb-none { display: grid; place-items: center; width: 100%; height: 58px; object-fit: cover; background: var(--co-bg-2); color: var(--co-fg-3); }
.osp-overlay .ed-thumb span { padding: 2px 5px; font-size: 10.5px; color: var(--co-fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.osp-overlay .ed-thumbs-empty { grid-column: 1 / -1; margin: 4px; color: var(--co-fg-3); white-space: normal; }

/* where a new layer lands: its container, and the size being drawn */
.osp-overlay .ed-drop-parent { outline: 1px dashed #2f6fed; outline-offset: -1px; }
.osp-overlay .ed-ghost { position: fixed; pointer-events: none; outline: 1.5px solid #2f6fed; background: rgba(47, 111, 237, 0.08); }
.osp-overlay .ed-ghost[hidden] { display: none; }
.osp-overlay .ed-ghost span { position: absolute; left: 50%; top: 100%; transform: translate(-50%, 4px); padding: 0 5px; border-radius: 3px; background: #2f6fed; color: #fff; font-size: 11px; white-space: nowrap; }

/* a device's width, over the page */
.osp-overlay .ed-device {
  position: fixed; inset: 0; z-index: 0; pointer-events: auto;
  display: flex; align-items: center; justify-content: center;
  background: rgba(16, 18, 22, 0.55);
}
.osp-overlay .ed-device-frame { display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 140px); margin-bottom: 72px; }
.osp-overlay .ed-device-head { display: flex; align-items: center; justify-content: space-between; color: #fff; font: 600 12px/20px Inter, ui-sans-serif, system-ui, sans-serif; }
.osp-overlay .ed-device-close { all: unset; cursor: pointer; padding: 2px 10px; border-radius: 6px; background: rgba(255, 255, 255, 0.16); color: #fff; font-weight: 500; }
.osp-overlay .ed-device-close:hover { background: rgba(255, 255, 255, 0.28); }
.osp-overlay .ed-device iframe { height: calc(100vh - 200px); max-width: calc(100vw - 48px); border: 0; border-radius: 12px; background: #fff; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4); }

/* the panel */
.osp-overlay .ep-root { display: flex; flex-direction: column; flex: 1; min-height: 0; font: 12px/16px Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--co-fg); }
.osp-overlay .ep-root[hidden] { display: none; }
.osp-overlay .ep-root button { font: inherit; color: inherit; }
.osp-overlay .ep-head { display: flex; align-items: center; gap: 6px; padding: 8px 8px 8px 10px; border-bottom: 1px solid var(--co-line); }
.osp-overlay .ep-tabs { position: relative; display: flex; flex: 1; padding: 2px; border-radius: 8px; background: var(--co-bg-2); }
.osp-overlay .ep-tab-slider { position: absolute; top: 2px; left: 2px; width: calc(50% - 2px); height: calc(100% - 4px); border-radius: 6px; background: var(--co-bg); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); transition: transform 0.22s var(--co-ease); }
.osp-overlay .ep-tabs[data-at="1"] .ep-tab-slider { transform: translateX(100%); }
.osp-overlay .ep-tab { all: unset; position: relative; z-index: 1; flex: 1; height: 26px; text-align: center; cursor: pointer; color: var(--co-fg-2); font-size: 12px; line-height: 26px; }
.osp-overlay .ep-tab[data-on] { color: var(--co-fg); font-weight: 600; }
.osp-overlay .ep-tab:focus-visible { outline: 2px solid #2f6fed; outline-offset: 1px; border-radius: 6px; }
.osp-overlay .ep-search { display: flex; align-items: center; gap: 6px; margin: 8px 8px 0; padding: 0 8px; height: 28px; border-radius: 6px; background: var(--co-bg-2); color: var(--co-fg-3); }
.osp-overlay .ep-search[hidden] { display: none; }
.osp-overlay .ep-search .ep-text { background: transparent; padding: 0; }
.osp-overlay .ep-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: var(--co-line) transparent; }
.osp-overlay .ep-top { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--co-line); }
.osp-overlay .ep-title { display: flex; align-items: center; gap: 6px; font-weight: 600; min-width: 0; }
.osp-overlay .ep-title span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.osp-overlay .ep-many { font-weight: 600; }
.osp-overlay .ep-why { color: var(--co-ink); font-size: 11px; line-height: 15px; }
.osp-overlay .ep-sec { border-bottom: 1px solid var(--co-line); }
.osp-overlay .ep-sec[data-flash] { animation: ep-flash 1.4s var(--co-ease); }
@keyframes ep-flash { 0%, 35% { background: rgba(47, 111, 237, 0.1); } 100% { background: transparent; } }
.osp-overlay .ep-sec-head { display: flex; align-items: center; gap: 4px; padding-right: 6px; }
.osp-overlay .ep-sec-toggle { all: unset; cursor: pointer; flex: 1; display: flex; align-items: center; justify-content: space-between; height: 36px; padding: 0 6px 0 12px; font-weight: 600; font-size: 11px; color: var(--co-fg); }
.osp-overlay .ep-sec-toggle svg { color: var(--co-fg-3); transition: transform 0.15s var(--co-ease); }
.osp-overlay .ep-sec[data-closed] .ep-sec-toggle svg { transform: rotate(-90deg); }
.osp-overlay .ep-sec-toggle:focus-visible { outline: 2px solid #2f6fed; outline-offset: -2px; }
.osp-overlay .ep-sec-body { padding: 0 12px 14px; }
.osp-overlay .ep-stack { display: flex; flex-direction: column; gap: 8px; }
.osp-overlay .ep-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; align-items: center; }
.osp-overlay .ep-quad { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; flex: 1; }
.osp-overlay .ep-row { display: grid; grid-template-columns: 76px minmax(0, 1fr); align-items: center; gap: 8px; }
.osp-overlay .ep-label { color: var(--co-fg-3); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.osp-overlay .ep-hint { color: var(--co-fg-3); font-size: 11px; line-height: 15px; }
.osp-overlay .ep-pad-hint { padding: 12px; }

.osp-overlay .ep-num { display: flex; align-items: center; height: 28px; min-width: 0; border-radius: 6px; border: 1px solid transparent; background: var(--co-bg-2); }
.osp-overlay .ep-num:hover { border-color: var(--co-line); }
.osp-overlay .ep-num:focus-within { border-color: #2f6fed; background: var(--co-bg); }
.osp-overlay .ep-num[data-off] { opacity: 0.5; }
.osp-overlay .ep-k { flex: none; min-width: 24px; padding: 0 2px; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--co-fg-3); font-size: 11px; cursor: ew-resize; user-select: none; white-space: nowrap; }
.osp-overlay .ep-num input { flex: 1; min-width: 0; width: 100%; height: 100%; border: 0; outline: none; background: transparent; color: var(--co-fg); font: 12px/16px Inter, ui-sans-serif, system-ui, sans-serif; font-variant-numeric: tabular-nums; padding: 0 6px 0 0; }
.osp-overlay .ep-u { flex: none; padding-right: 8px; color: var(--co-fg-3); font-size: 11px; }
.osp-overlay .ep-select { box-sizing: border-box; width: 100%; min-width: 0; height: 28px; padding: 0 6px; border-radius: 6px; border: 1px solid transparent; background: var(--co-bg-2); color: var(--co-fg); font: 12px/16px Inter, ui-sans-serif, system-ui, sans-serif; }
.osp-overlay .ep-select:hover { border-color: var(--co-line); }
.osp-overlay .ep-text { box-sizing: border-box; flex: 1; min-width: 0; height: 28px; padding: 0 8px; border: 0; outline: none; border-radius: 6px; background: var(--co-bg-2); color: var(--co-fg); font: 12px/16px Inter, ui-sans-serif, system-ui, sans-serif; }
.osp-overlay .ep-seg { display: flex; gap: 2px; padding: 2px; height: 28px; box-sizing: border-box; border-radius: 6px; background: var(--co-bg-2); min-width: 0; }
.osp-overlay .ep-seg button { all: unset; cursor: pointer; flex: 1; min-width: 22px; display: flex; align-items: center; justify-content: center; gap: 5px; border-radius: 4px; color: var(--co-fg-2); font-size: 11px; white-space: nowrap; }
.osp-overlay .ep-seg button:hover { color: var(--co-fg); }
.osp-overlay .ep-seg button[data-on] { background: var(--co-bg); color: var(--co-fg); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }
.osp-overlay .ep-seg button:focus-visible { outline: 2px solid #2f6fed; outline-offset: -1px; }

/* a button that looks like one: Detach, Add auto layout, Add a fill */
.osp-overlay .ep-action {
  all: unset; box-sizing: border-box; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 30px; padding: 0 10px;
  border: 1px solid var(--co-line); border-radius: 8px; background: var(--co-bg);
  box-shadow: 0 1px 2px rgba(16, 18, 22, 0.08);
  color: var(--co-fg); font-weight: 500; font-size: 12px;
  transition: background 0.12s, border-color 0.12s, transform 0.08s;
}
.osp-overlay .ep-action svg { color: var(--co-fg-2); flex: none; }
.osp-overlay .ep-action:hover { background: var(--co-bg-2); border-color: var(--co-fg-3); }
.osp-overlay .ep-action:active { transform: translateY(1px); box-shadow: none; }
.osp-overlay .ep-action:focus-visible { outline: 2px solid #2f6fed; outline-offset: 1px; }

.osp-overlay .ep-icon { all: unset; cursor: pointer; flex: none; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 6px; color: var(--co-fg-2); }
.osp-overlay .ep-icon:hover { background: var(--co-bg-2); color: var(--co-fg); }
.osp-overlay .ep-icon[data-on] { background: var(--co-bg-2); color: var(--co-fg); }
.osp-overlay .ep-icon-small { width: 24px; height: 24px; }
.osp-overlay .ep-icon:focus-visible { outline: 2px solid #2f6fed; outline-offset: 1px; }
.osp-overlay .ep-pad { display: flex; align-items: center; gap: 6px; }
.osp-overlay .ep-pad > .ep-pair { flex: 1; }
.osp-overlay .ep-align-row { display: flex; align-items: flex-start; gap: 8px; }
.osp-overlay .ep-align-row > .ep-stack { flex: 1; min-width: 0; gap: 6px; }
.osp-overlay .ep-align { flex: none; display: grid; grid-template-columns: repeat(3, 1fr); width: 64px; height: 64px; box-sizing: border-box; padding: 4px; border-radius: 6px; background: var(--co-bg-2); }
.osp-overlay .ep-align button { all: unset; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.osp-overlay .ep-align button::after { content: ""; width: 4px; height: 4px; border-radius: 50%; background: var(--co-fg-3); opacity: 0.5; }
.osp-overlay .ep-align button:hover::after { opacity: 1; }
.osp-overlay .ep-align button[data-on]::after { width: 12px; height: 4px; border-radius: 2px; background: #2f6fed; opacity: 1; }
.osp-overlay .ep-check { display: flex; align-items: center; gap: 8px; color: var(--co-fg-2); cursor: pointer; }
.osp-overlay .ep-check input { accent-color: #2f6fed; margin: 0; }

.osp-overlay .ep-colour-wrap { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.osp-overlay .ep-colour { display: flex; align-items: center; gap: 2px; height: 28px; min-width: 0; padding-right: 2px; border-radius: 6px; border: 1px solid transparent; background: var(--co-bg-2); }
.osp-overlay .ep-colour:hover { border-color: var(--co-line); }
.osp-overlay .ep-colour:focus-within { border-color: #2f6fed; background: var(--co-bg); }
.osp-overlay .ep-swatch { all: unset; cursor: pointer; flex: none; width: 16px; height: 16px; margin: 0 4px 0 6px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.16); }
.osp-overlay .ep-swatch[data-mixed] { background: linear-gradient(135deg, #ddd 50%, #999 50%); }
.osp-overlay .ep-swatch:focus-visible { outline: 2px solid #2f6fed; outline-offset: 1px; }
.osp-overlay .ep-hex, .osp-overlay .ep-alpha { min-width: 0; height: 100%; border: 0; outline: none; background: transparent; color: var(--co-fg); font: 12px/16px Inter, ui-sans-serif, system-ui, sans-serif; font-variant-numeric: tabular-nums; }
.osp-overlay .ep-hex { flex: 1; text-transform: uppercase; }
.osp-overlay .ep-alpha { width: 44px; flex: none; padding-left: 6px; border-left: 1px solid var(--co-line); height: 16px; }
.osp-overlay .ep-chips { display: flex; justify-content: flex-end; }
.osp-overlay .ep-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; height: 20px; padding: 0 7px; border-radius: 10px; background: var(--co-bg-2); color: var(--co-fg-2); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.osp-overlay .ep-chip-token { background: rgba(47, 111, 237, 0.1); color: #2f6fed; }
.osp-overlay .ep-chip-made { background: var(--co-pri-medium-bg); color: var(--co-pri-medium-fg); flex: none; }
.osp-overlay .ep-palette { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 8px; border: 1px solid var(--co-line); background: var(--co-bg); box-shadow: var(--co-shadow); }
.osp-overlay .ep-palette-label { color: var(--co-fg-3); font-size: 11px; }
.osp-overlay .ep-swatches { display: flex; flex-wrap: wrap; gap: 6px; }
.osp-overlay .ep-swatch-pick { all: unset; cursor: pointer; width: 20px; height: 20px; border-radius: 5px; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.16); }
.osp-overlay .ep-swatch-pick:hover { transform: scale(1.12); }
.osp-overlay .ep-swatch-pick:focus-visible { outline: 2px solid #2f6fed; outline-offset: 1px; }
.osp-overlay .ep-palette-tools { display: grid; grid-template-columns: 40px 1fr; gap: 6px; }
.osp-overlay .ep-palette-tools .ep-action:last-child:nth-child(3) { grid-column: 1 / -1; }
.osp-overlay .ep-custom { box-sizing: border-box; width: 40px; height: 30px; padding: 2px; border: 1px solid var(--co-line); border-radius: 6px; background: var(--co-bg); cursor: pointer; }
.osp-overlay .ep-custom-wide { width: 100%; }
.osp-overlay .ep-name-var { display: flex; gap: 6px; }
.osp-overlay .ep-name-var .ep-action { width: auto; }
.osp-overlay .ep-gradient { all: unset; box-sizing: border-box; cursor: pointer; height: 28px; padding: 0 10px; border-radius: 6px; color: #fff; font-size: 11px; font-weight: 600; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12); }
.osp-overlay .ep-effect { display: flex; flex-direction: column; gap: 6px; padding-bottom: 8px; border-bottom: 1px dashed var(--co-line); }
.osp-overlay .ep-effect-head { display: flex; align-items: center; gap: 4px; }
.osp-overlay .ep-code { margin: 0; max-height: 220px; overflow: auto; padding: 8px; border-radius: 6px; background: var(--co-bg-2); color: var(--co-fg); font: 11px/16px ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; }
.osp-overlay .ep-ask { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; padding: 10px; border-radius: 8px; background: rgba(47, 111, 237, 0.08); }
.osp-overlay .ep-ask p { margin: 0; font-size: 12px; line-height: 16px; }
.osp-overlay .ep-ask-row { display: flex; flex-wrap: wrap; gap: 6px; }
.osp-overlay .ep-ask-row button { all: unset; cursor: pointer; height: 24px; padding: 0 10px; border-radius: 12px; border: 1px solid var(--co-line); background: var(--co-bg); font-size: 11px; font-weight: 500; }
.osp-overlay .ep-ask-row button.ep-ask-main { background: #2f6fed; border-color: transparent; color: #fff; }
.osp-overlay .ep-ask-row button:focus-visible { outline: 2px solid #2f6fed; outline-offset: 1px; }
.osp-overlay .ep-where { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.osp-overlay .ep-where-name { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; min-width: 0; height: 22px; padding: 0 8px; border-radius: 11px; background: var(--co-bg-2); color: var(--co-fg-2); font: 11px/16px ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.osp-overlay .ep-where-name:hover { color: var(--co-fg); box-shadow: inset 0 0 0 1px var(--co-line); }
.osp-overlay .ep-where-name:focus-visible { outline: 2px solid #2f6fed; outline-offset: 1px; }
.osp-overlay .ep-where-icon { display: flex; color: var(--co-fg-3); }
.osp-overlay .ep-where-open { flex: none; color: #2f6fed; font-size: 11px; text-decoration: none; }
.osp-overlay .ep-where-open:hover { text-decoration: underline; }
.osp-overlay .ep-history { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.osp-overlay .ep-history li { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 26px; border-bottom: 1px solid var(--co-line); }
.osp-overlay .ep-history li:last-child { border-bottom: 0; }
.osp-overlay .ep-history li > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.osp-overlay .ep-link { all: unset; cursor: pointer; flex: none; color: #2f6fed; font-size: 11px; }
.osp-overlay .ep-link:hover { text-decoration: underline; }
.osp-overlay .ep-latest { flex: none; color: var(--co-fg-3); font-size: 11px; }
.osp-overlay .ep-keys { margin: 0; display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; font-size: 11px; }
.osp-overlay .ep-keys dt { color: var(--co-fg-2); }
.osp-overlay .ep-keys dd { margin: 0; color: var(--co-fg); text-align: right; }

/* layers */
.osp-overlay .ep-layers { padding: 6px 0; }
.osp-overlay .ep-layer { display: flex; align-items: center; gap: 4px; height: 28px; padding-right: 6px; cursor: default; position: relative; }
.osp-overlay .ep-layer:hover { background: var(--co-bg-2); }
.osp-overlay .ep-layer[data-selected] { background: rgba(47, 111, 237, 0.12); }
.osp-overlay .ep-layer[data-hidden] .ep-layer-name, .osp-overlay .ep-layer[data-hidden] .ep-kind { opacity: 0.4; }
.osp-overlay .ep-layer[data-made] .ep-layer-name { font-style: italic; }
.osp-overlay .ep-layer[data-drop="before"]::before, .osp-overlay .ep-layer[data-drop="after"]::after { content: ""; position: absolute; left: 0; right: 0; height: 2px; background: #2f6fed; }
.osp-overlay .ep-layer[data-drop="before"]::before { top: 0; }
.osp-overlay .ep-layer[data-drop="after"]::after { bottom: 0; }
.osp-overlay .ep-layer[data-drop="inside"] { outline: 2px solid #2f6fed; outline-offset: -2px; }
.osp-overlay .ep-twist { all: unset; flex: none; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; color: var(--co-fg-3); cursor: pointer; }
.osp-overlay .ep-twist svg { transition: transform 0.15s var(--co-ease); }
.osp-overlay .ep-twist[data-closed] svg { transform: rotate(-90deg); }
.osp-overlay .ep-kind { flex: none; display: flex; color: var(--co-fg-3); }
.osp-overlay .ep-layer-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.osp-overlay .ep-eye { width: 24px; height: 24px; visibility: hidden; }
.osp-overlay .ep-layer:hover .ep-eye, .osp-overlay .ep-layer[data-hidden] .ep-eye { visibility: visible; }
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
