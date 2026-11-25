/**
 * Edit mode's variables, as they run in the browser: the page's custom
 * properties, seen, made and used. Spliced into `EDIT_SCRIPT`'s closure
 * after the panel.
 *
 * Two ways in, chosen in the prototype:
 *
 * - A ◇ on the panel's number fields and on Font. It opens the variables
 *   that fit that field (sizes for padding, gap, radius and type; fonts for
 *   Font), and ends with "Create variable from 24px". A field that already
 *   takes a variable shows its name in place of the number, with Detach to
 *   go back to a plain value. Colours have this already, in their palette.
 *
 * - A Variables tab beside Design and Layers: every variable on the page by
 *   kind, with its value, how many rules use it, a search, and New
 *   variable. A variable dragged onto a layer asks where it goes (Fill,
 *   Text colour or Border; Padding, Gap, Radius or Font size), with the
 *   likeliest choice first. A click with a layer selected asks the same.
 *
 * Every write is one the panel already makes: a declaration of var(--name)
 * through setStyles, or the variable's own rule through applyRuleProps.
 *
 * Raw string, like the other chunks: no backtick, and no dollar sign
 * followed by a brace.
 */
export const EDIT_VARIABLES = String.raw`
  /* --- variables ------------------------------------------------------- */

  /* The field whose ◇ list is open: { key, o }, or null. */
  var varPick = null;
  var varPickQuery = "";
  var varPickNaming = false;
  /* The Variables tab: its search, and whether New variable is open. */
  var varQuery = "";
  var varMaking = false;
  /* A variable being dragged from the tab, or null. */
  var varDrag = null;

  var VAR_ONLY = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/;
  /* The shorthand a longhand may have been written as. */
  var VAR_SHORT = {
    "padding-top": "padding", "padding-right": "padding", "padding-bottom": "padding", "padding-left": "padding",
    "gap": "gap", "row-gap": "gap", "column-gap": "gap",
    "border-top-left-radius": "border-radius", "border-top-right-radius": "border-radius",
    "border-bottom-right-radius": "border-radius", "border-bottom-left-radius": "border-radius",
    "font-size": "font", "font-family": "font", "line-height": "font",
  };
  var VAR_KINDS = [["colour", "Colours"], ["size", "Sizes"], ["font", "Fonts"], ["other", "Other"]];

  function varKind(name, value) {
    if (isColour(value)) return "colour";
    if (/^-?[\d.]+(px|rem|em|%|vw|vh|ch|ex)$/.test(value)) return "size";
    if (/font|family|typeface/i.test(name) || /\b(serif|sans-serif|monospace|system-ui|cursive|ui-sans-serif|ui-serif|ui-monospace)\b/.test(value)) return "font";
    return "other";
  }

  /* Every custom property the page's own rules declare, with its value at the root. */
  function pageVariables() {
    var seen = {};
    var out = [];
    var root = window.getComputedStyle(document.documentElement);
    walkRules(function (rule) {
      for (var i = 0; i < rule.style.length; i++) {
        var name = rule.style[i];
        if (name.indexOf("--") !== 0 || seen[name]) continue;
        seen[name] = 1;
        var value = root.getPropertyValue(name).trim() || rule.style.getPropertyValue(name).trim();
        if (out.length < 300) out.push({ name: name, value: value, kind: varKind(name, value) });
      }
    });
    return out;
  }

  /* A variable's mark: its colour, its font saying Aa, or a drawn icon. */
  function varMark(v) {
    if (v.kind === "font") {
      var f = el("span", "ep-var-mark ep-var-font", "Aa");
      f.style.fontFamily = v.value;
      return f;
    }
    return node("span", "ep-var-mark", icon(v.kind === "size" ? "ruler" : "token", 13));
  }

  function varUses(name) {
    var n = 0;
    var re = new RegExp("var\\(\\s*" + name.replace(/[-]/g, "\\-") + "\\b");
    walkRules(function (rule) {
      if (re.test(rule.style.cssText)) n++;
    });
    return n;
  }

  /* The variable a property takes on target, written as var(--name) and nothing else. */
  function boundVar(target, prop) {
    var a = winning(target, prop);
    var short = VAR_SHORT[prop];
    var s = short && short !== prop ? winning(target, short) : null;
    var w = a;
    if (s && (!a || (s.kind === "inline" && a.kind !== "inline") || (a.kind !== "inline" && s.kind !== "inline" && better(s, a)))) w = s;
    if (!w) return null;
    var m = VAR_ONLY.exec(String(w.value || "").trim());
    return m ? m[1] : null;
  }

  /* The one variable every selected layer takes for all of props, or null. */
  function sharedVar(props) {
    var list = targets();
    if (!list.length) return null;
    var name = null;
    for (var i = 0; i < list.length; i++) {
      for (var j = 0; j < props.length; j++) {
        var v = boundVar(list[i], props[j]);
        if (!v || (name && v !== name)) return null;
        name = v;
      }
    }
    return name;
  }

  function varValue(name) {
    return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* --- the ◇ on a field ------------------------------------------------ */

  /* For numField: a chip in place of the number, when the field takes a variable. */
  function varChip(o, input, wrap) {
    var name = sharedVar(o.vars.props);
    if (!name) return false;
    input.hidden = true;
    // The chip is the ◇: a click opens the same list, to switch to another.
    var chip = varButton(o);
    chip.className = "ep-chip ep-chip-token ep-var-chip";
    chip.innerHTML = "<span></span>";
    chip.firstChild.textContent = name.replace(/^--/, "");
    chip.title = name + ": " + (varValue(name) || "not set at the root") + ", used " + uses(name) + ". Click to use another.";
    chip.setAttribute("aria-label", chip.title);
    wrap.appendChild(chip);
    var detach = iconButton("unlink", "Detach variable: keep " + (o.value === "" ? "the value" : o.value + (o.unit || "px")) + " as a plain value", function (event) {
      if (event) event.preventDefault();
      detachVar(o);
    }, "ep-var-detach");
    wrap.appendChild(detach);
    return true;
  }

  function detachVar(o) {
    from(o.vars.sec, function () {
      setStyles(function (t) {
        var cs = window.getComputedStyle(t);
        return o.vars.props.map(function (p) {
          return [p, cs.getPropertyValue(p).trim()];
        });
      }, o.vars.what);
    })();
  }

  function varButton(o) {
    var b = node("button", "ep-var-btn", icon("token", 12));
    b.type = "button";
    b.title = "Use a variable for the " + o.vars.what;
    b.setAttribute("aria-label", b.title);
    b.setAttribute("data-var-btn", o.vars.key);
    if (varPick && varPick.key === o.vars.key) b.setAttribute("data-on", "");
    b._varOpts = o;
    b.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (varPick && varPick.key === o.vars.key) varPick = null;
      else {
        if (typeof closeMenus === "function") closeMenus();
        varPick = { key: o.vars.key };
      }
      varPickQuery = "";
      varPickNaming = false;
      refresh();
    });
    return b;
  }

  function useVar(o, name) {
    from(o.vars.sec, function () {
      setStyles(o.vars.props.map(function (p) {
        return [p, "var(" + name + ")"];
      }), o.vars.what);
    })();
  }

  /* From refresh: the ◇ list, under its button, or gone with it. */
  function syncVarPick() {
    if (!ui) return;
    var anchor = varPick && ui.panel ? ui.panel.root.querySelector('[data-var-btn="' + varPick.key + '"]') : null;
    if (!anchor) {
      if (varPick && ui.panel && tab === "design" && !busy) varPick = null;
      if (ui.varPop) ui.varPop.hidden = true;
      return;
    }
    if (!ui.varPop) {
      ui.varPop = el("div", "ed-menu ed-var-pop");
      ui.varPop.addEventListener("keydown", function (event) {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          varPick = null;
          refresh();
        }
      });
      ui.varPop.addEventListener("click", function (event) {
        event.stopPropagation();
      });
      host.wrap.appendChild(ui.varPop);
    }
    var box = ui.varPop;
    var keep = box.querySelector("input");
    var focused = keep && box.getRootNode().activeElement === keep ? keep.className : "";
    var o = anchor._varOpts;
    box.textContent = "";
    box.hidden = false;
    var kind = o.vars.kind;
    var current = sharedVar(o.vars.props);
    var all = pageVariables().filter(function (v) {
      return v.kind === kind;
    });
    box.appendChild(el("div", "ed-menu-note", (kind === "font" ? "Font" : "Size") + " variables for the " + o.vars.what));
    if (all.length > 8) {
      var search = el("input", "ed-search ed-var-search");
      search.type = "search";
      search.placeholder = "Search " + all.length + " variables";
      search.setAttribute("aria-label", "Search variables");
      search.value = varPickQuery;
      search.addEventListener("input", function () {
        varPickQuery = search.value;
        syncVarPick();
      });
      box.appendChild(search);
    }
    var shown = all.filter(function (v) {
      return !varPickQuery || v.name.toLowerCase().indexOf(varPickQuery.toLowerCase()) >= 0;
    });
    if (!all.length) box.appendChild(el("p", "ed-var-empty", "No " + (kind === "font" ? "font" : "size") + " variables on this page yet."));
    shown.slice(0, 60).forEach(function (v) {
      var b = el("button", "ed-menu-item ed-menu-rich ed-var-item");
      b.type = "button";
      if (v.name === current) b.setAttribute("data-on", "");
      var mark = varMark(v);
      b.appendChild(mark);
      b.appendChild(el("span", null, v.name.replace(/^--/, "")));
      b.appendChild(el("kbd", null, kind === "font" ? fontName(v.value) : v.value));
      b.title = v.name + ": " + v.value;
      b.addEventListener("click", function () {
        varPick = null;
        useVar(o, v.name);
      });
      box.appendChild(b);
    });
    box.appendChild(el("div", "ed-menu-sep"));
    var list = targets();
    var real = list.length ? window.getComputedStyle(list[0]).getPropertyValue(o.vars.props[0]).trim() : "";
    if (varPickNaming) {
      var r = el("div", "ed-var-name");
      var input = el("input", "ed-search ed-var-new");
      input.placeholder = kind === "font" ? "Name, like font-display" : "Name, like space-5";
      input.setAttribute("aria-label", "Name for the new variable");
      input.addEventListener("keydown", function (event) {
        if (event.key !== "Enter") return;
        var name = "--" + input.value.trim().replace(/^-+/, "").replace(/\s+/g, "-").toLowerCase();
        if (!/^--[a-z][\w-]{0,40}$/.test(name)) {
          message = "A variable name is letters, digits and dashes, starting with a letter.";
          refresh();
          return;
        }
        varPick = null;
        varPickNaming = false;
        currentSec = o.vars.sec;
        createVariable(name, real, function () {
          useVar(o, name);
        });
      });
      r.appendChild(input);
      box.appendChild(r);
      setTimeout(function () {
        input.focus();
      }, 0);
    } else if (real && list.length) {
      var make = el("button", "ed-menu-item ed-menu-rich");
      make.type = "button";
      make.innerHTML = icon("plus", 14) + "<span></span>";
      make.lastChild.textContent = "Create variable from " + (kind === "font" ? fontName(real) : real);
      make.addEventListener("click", function () {
        varPickNaming = true;
        syncVarPick();
      });
      box.appendChild(make);
    }
    var a = anchor.getBoundingClientRect();
    var w = box.offsetWidth || 240;
    var h = box.offsetHeight || 200;
    box.style.left = Math.max(8, Math.min(hostWin.innerWidth - w - 8, a.right - w)) + "px";
    box.style.top = (a.bottom + 4 + h > hostWin.innerHeight - 8 ? Math.max(8, a.top - h - 4) : a.bottom + 4) + "px";
    if (focused) {
      var again = box.querySelector("input." + focused.split(" ").join("."));
      if (again) {
        again.focus();
        try {
          again.setSelectionRange(again.value.length, again.value.length);
        } catch (e) {}
      }
    }
  }

  /* --- the Variables tab ----------------------------------------------- */

  function variablesBody() {
    var wrap = el("div", "ep-vars");
    var top = el("div", "ep-vars-top");
    var search = el("input", "ep-text ep-vars-search");
    search.type = "search";
    search.setAttribute("data-ep-keep", "");
    search.setAttribute("aria-label", "Search variables");
    search.value = varQuery;
    var list = pageVariables();
    search.placeholder = "Search " + list.length + " variable" + (list.length === 1 ? "" : "s");
    top.appendChild(search);
    var add = actionButton("plus", "New", "A new variable on :root, in the file's last style block", function () {
      varMaking = !varMaking;
      refresh();
    });
    add.setAttribute("data-new-var", "");
    if (varMaking) add.setAttribute("aria-expanded", "true");
    top.appendChild(add);
    wrap.appendChild(top);
    var groups = el("div", "ep-vars-groups");
    wrap.appendChild(groups);
    function fill() {
      groups.textContent = "";
      var q = varQuery.trim().toLowerCase();
      var shown = list.filter(function (v) {
        return !q || (v.name + " " + v.value).toLowerCase().indexOf(q) >= 0;
      });
      if (!list.length) groups.appendChild(el("p", "ep-hint", "No variables on this page yet. New makes one, or Create variable in a colour's palette or a field's ◇."));
      else if (!shown.length) groups.appendChild(el("p", "ep-hint", "No variable matches."));
      VAR_KINDS.forEach(function (k) {
        var these = shown.filter(function (v) {
          return v.kind === k[0];
        });
        if (!these.length) return;
        var head = el("div", "ep-vars-head");
        head.appendChild(el("span", null, k[1]));
        head.appendChild(el("small", null, String(these.length)));
        groups.appendChild(head);
        these.forEach(function (v) {
          groups.appendChild(variableRow(v));
        });
      });
      if (list.length) {
        groups.appendChild(el("p", "ep-hint ep-vars-hint", targets().length
          ? "Drag a variable onto a layer, or click one to use it on the selection."
          : "Drag a variable onto a layer to use it there."));
      }
    }
    search.addEventListener("input", function () {
      varQuery = search.value;
      fill();
    });
    fill();
    return wrap;
  }

  /*
   * New variable, as a small pop-up under the tab's New: a name, a value
   * with a preview of what it is, and what kind of field it will fit.
   * Built once per opening, so typing is never redrawn under the caret.
   */
  var KIND_SAYS = {
    colour: "A colour: for fills, text and borders.",
    size: "A size: for padding, gaps, corners and type.",
    font: "A font: for Font.",
    other: "Kept as written, for the Code section.",
  };

  function syncNewVar() {
    if (!ui) return;
    var anchor = varMaking && tab === "variables" && ui.panel ? ui.panel.root.querySelector("[data-new-var]") : null;
    if (!anchor) {
      if (ui.newVar) {
        ui.newVar.remove();
        ui.newVar = null;
      }
      if (tab !== "variables") varMaking = false;
      return;
    }
    if (!ui.newVar) ui.newVar = newVariablePop();
    var a = anchor.getBoundingClientRect();
    var box = ui.newVar;
    var w = box.offsetWidth || 300;
    box.style.left = Math.max(8, Math.min(hostWin.innerWidth - w - 8, a.right - w)) + "px";
    box.style.top = a.bottom + 6 + "px";
  }

  function newVariablePop() {
    var box = el("div", "ed-menu ed-newvar");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "New variable");
    var head = el("div", "ed-nv-head");
    head.appendChild(el("b", null, "New variable"));
    head.appendChild(el("span", null, "added to :root"));
    box.appendChild(head);
    function field(words, lead, placeholder) {
      var f = el("label", "ed-nv-field");
      f.appendChild(el("span", "ed-nv-label", words));
      var line = el("span", "ed-nv-input");
      line.appendChild(lead);
      var input = el("input");
      input.placeholder = placeholder;
      input.spellcheck = false;
      input.autocomplete = "off";
      line.appendChild(input);
      f.appendChild(line);
      box.appendChild(f);
      return input;
    }
    var name = field("Name", el("span", "ed-nv-dash", "--"), "space-5");
    var preview = el("span", "ed-nv-preview");
    var value = field("Value", preview, "20px, #1f9d55 or Inter, sans-serif");
    var says = el("p", "ed-nv-says");
    box.appendChild(says);
    var error = el("p", "ed-nv-error");
    error.hidden = true;
    box.appendChild(error);
    var actions = el("div", "ed-nv-actions");
    var cancel = el("button", "ed-nv-cancel", "Cancel");
    cancel.type = "button";
    var create = el("button", "ed-nv-create", "Create variable");
    create.type = "button";
    actions.appendChild(cancel);
    actions.appendChild(create);
    box.appendChild(actions);

    function cleanName() {
      return "--" + name.value.trim().replace(/^-+/, "").replace(/\s+/g, "-").toLowerCase();
    }
    function update() {
      var v = value.value.trim();
      var kind = v ? varKind(cleanName(), v) : "";
      preview.textContent = "";
      preview.removeAttribute("style");
      preview.className = "ed-nv-preview";
      if (kind === "colour") {
        preview.classList.add("ed-nv-swatch");
        preview.style.background = v;
      } else if (kind === "font") {
        preview.textContent = "Aa";
        preview.style.fontFamily = v;
      } else preview.innerHTML = icon(kind === "size" ? "ruler" : "token", 13);
      says.textContent = kind ? KIND_SAYS[kind] : "Type a value to see what it fits.";
      create.disabled = !name.value.trim() || !v;
      error.hidden = true;
    }
    function fail(words, at) {
      error.textContent = words;
      error.hidden = false;
      at.focus();
    }
    function go() {
      var n = cleanName();
      var v = value.value.trim();
      if (!/^--[a-z][\w-]{0,40}$/.test(n)) return fail("A name is letters, digits and dashes, starting with a letter.", name);
      var taken = pageVariables().some(function (x) {
        return x.name === n;
      });
      if (taken) return fail(n + " is already on this page. Pick another name, or change its value in the list.", name);
      if (!v || !writable(v)) return fail("That value can't be written. Try 20px, #1f9d55 or Inter, sans-serif.", value);
      varMaking = false;
      currentSec = "variables";
      createVariable(n, v, function () {
        message = "Added the variable " + n + ".";
      });
      refresh();
    }
    name.addEventListener("input", update);
    value.addEventListener("input", update);
    box.addEventListener("keydown", function (event) {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        if (!create.disabled) go();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        varMaking = false;
        refresh();
      }
    });
    box.addEventListener("click", function (event) {
      event.stopPropagation();
    });
    cancel.addEventListener("click", function () {
      varMaking = false;
      refresh();
    });
    create.addEventListener("click", go);
    update();
    host.wrap.appendChild(box);
    setTimeout(function () {
      name.focus();
    }, 0);
    return box;
  }

  function variableRow(v) {
    var r = el("div", "ep-var-row");
    r.setAttribute("data-var", v.name);
    r.title = v.name + ": " + v.value + ". Drag it onto a layer, or click it to use it on the selection.";
    var mark;
    if (v.kind === "colour") {
      mark = el("input", "ep-var-swatch");
      mark.type = "color";
      var p = rgbaParts(v.value);
      mark.value = p ? hexOf(p) : /^#[0-9a-f]{6}$/i.test(v.value) ? v.value : "#000000";
      mark.title = "Change " + v.name;
      mark.setAttribute("aria-label", "Change " + v.name);
      mark.addEventListener("change", function () {
        writeVariable(v.name, mark.value);
      });
      mark.addEventListener("pointerdown", function (event) {
        event.stopPropagation();
      });
    } else mark = varMark(v);
    r.appendChild(mark);
    r.appendChild(el("span", "ep-var-name", v.name.replace(/^--/, "")));
    var value = el("input", "ep-var-value");
    value.value = v.value;
    value.setAttribute("aria-label", "Value of " + v.name);
    value.setAttribute("data-ep-keep", "");
    value.addEventListener("pointerdown", function (event) {
      event.stopPropagation();
    });
    value.addEventListener("keydown", function (event) {
      if (event.key === "Enter") value.blur();
    });
    value.addEventListener("change", function () {
      var next = value.value.trim();
      if (next && next !== v.value) writeVariable(v.name, next);
    });
    r.appendChild(value);
    var n = varUses(v.name);
    r.appendChild(el("span", "ep-var-uses", n ? n + (n === 1 ? " rule" : " rules") : "unused"));
    r.addEventListener("pointerdown", function (event) {
      startVarDrag(event, v, r);
    });
    r.addEventListener("click", function (event) {
      event.stopPropagation();
      if (r.hasAttribute("data-dragged")) {
        r.removeAttribute("data-dragged");
        return;
      }
      var list = targets();
      if (list.length !== 1) {
        message = list.length ? "Select one layer to use " + v.name + " on, or drag it onto one." : "Select a layer, or drag " + v.name + " onto one.";
        refresh();
        return;
      }
      var b = r.getBoundingClientRect();
      openVarMenu(v, list[0], b.left, b.bottom + 4, true);
    });
    return r;
  }

  function writeVariable(name, value) {
    if (!writable(value)) {
      message = "That value can't be written: " + value;
      refresh();
      return;
    }
    var def = tokenRule(document.documentElement, name);
    if (!def || !editableSheet(def.owner)) {
      message = name + " is set where it can't be edited from here.";
      refresh();
      return;
    }
    currentSec = "variables";
    applyRuleProps(def, [[name, value]], "the variable " + name);
  }

  /* --- using one on a layer -------------------------------------------- */

  /* Where a variable of this kind can go on target, the likeliest first. */
  function varUsesFor(v, target) {
    var cs = window.getComputedStyle(target);
    var words = hasText(target);
    var box = !!target.children.length || /^(DIV|SECTION|ARTICLE|ASIDE|MAIN|HEADER|FOOTER|NAV|FORM|BUTTON|LI|UL|OL|FIGURE)$/.test(target.tagName);
    var out = [];
    if (v.kind === "colour") {
      out.push({ label: "Fill", props: ["background-color"], what: "fill", now: cs.backgroundColor });
      if (words) out.push({ label: "Text colour", props: ["color"], what: "text colour", now: cs.color });
      if (parseFloat(cs.borderTopWidth) > 0) out.push({ label: "Border colour", props: ["border-color"], what: "stroke colour", now: cs.borderTopColor });
      if (words && !box) out.unshift(out.splice(1, 1)[0]);
    } else if (v.kind === "size") {
      out.push({ label: "Padding", props: ["padding-top", "padding-right", "padding-bottom", "padding-left"], what: "padding", now: cs.paddingTop });
      if (/flex|grid/.test(cs.display)) out.push({ label: "Gap", props: ["gap"], what: "gap", now: cs.gap === "normal" ? "0px" : cs.gap });
      out.push({ label: "Corner radius", props: ["border-radius"], what: "corner radius", now: cs.borderTopLeftRadius });
      if (words) out.push({ label: "Font size", props: ["font-size"], what: "font size", now: cs.fontSize });
      if (words && !box) out.unshift(out.pop());
    } else if (v.kind === "font") {
      out.push({ label: "Font", props: ["font-family"], what: "font", now: fontName(cs.fontFamily) });
    } else if (/\d+px/.test(v.value) && /rgba?\(|#/.test(v.value)) {
      out.push({ label: "Shadow", props: ["box-shadow"], what: "shadow", now: cs.boxShadow === "none" ? "none" : "a shadow" });
    }
    return out;
  }

  /* The question a drop asks: where on target the variable goes. x, y are the overlay's. */
  function openVarMenu(v, target, x, y) {
    var choices = varUsesFor(v, target);
    if (!choices.length) {
      message = v.name + " isn't a colour, size or font, so there's no field to put it in. Use it in the Code section.";
      refresh();
      return;
    }
    if (choices.length === 1) return applyVar(v, target, choices[0]);
    var box = ui.menu;
    box.textContent = "";
    box.appendChild(el("div", "ed-menu-note", "Use " + v.name.replace(/^--/, "") + " on " + label(target) + " for"));
    choices.forEach(function (c, i) {
      var b = el("button", "ed-menu-item" + (i === 0 ? " ed-menu-first" : ""));
      b.type = "button";
      b.appendChild(el("span", null, c.label));
      b.appendChild(el("kbd", null, /^rgb/.test(c.now) ? toHex(c.now) : c.now));
      b.addEventListener("click", function (event) {
        event.stopPropagation();
        closeMenus();
        applyVar(v, target, c);
      });
      box.appendChild(b);
    });
    box.hidden = false;
    var w = box.offsetWidth || 220;
    var h = box.offsetHeight || 140;
    box.style.left = Math.max(8, Math.min(hostWin.innerWidth - w - 8, x)) + "px";
    box.style.top = Math.max(8, Math.min(hostWin.innerHeight - h - 8, y)) + "px";
    var first = box.querySelector(".ed-menu-item");
    if (first) first.focus();
  }

  function applyVar(v, target, c) {
    if (selected !== target || targets().length !== 1) select(target);
    currentSec = c.props[0] === "background-color" ? "fill" : c.props[0] === "color" || c.props[0] === "font-size" || c.props[0] === "font-family" ? "text" : c.props[0] === "border-color" ? "stroke" : c.props[0] === "border-radius" ? "appearance" : c.props[0] === "box-shadow" ? "effects" : "autolayout";
    setStyles(c.props.map(function (p) {
      return [p, "var(" + v.name + ")"];
    }), c.what);
  }

  /*
   * A press on a variable's row: past a few pixels it is a drag onto the
   * page. The row holds the pointer, the layer under it is outlined, and
   * the release asks where the variable goes.
   */
  function startVarDrag(event, v, row) {
    if (event.button !== 0 || busy || unavailable || stale) return;
    var sx = event.clientX;
    var sy = event.clientY;
    var mine = null;
    try {
      row.setPointerCapture(event.pointerId);
    } catch (e) {}
    function move(m) {
      if (!mine) {
        if (Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) <= DRAG_START) return;
        closeMenus();
        mine = { v: v, target: null, x: 0, y: 0, drop: up };
        varDrag = mine;
        row.setAttribute("data-dragging", "");
      }
      if (varDrag !== mine) return;
      mine.x = m.clientX;
      mine.y = m.clientY;
      var p = fromHost(m.clientX, m.clientY);
      var under = overOverlay(m.clientX, m.clientY) ? null : elementOf(elementAtPoint(p.x, p.y));
      mine.target = under && !styleWhyNot(under) ? under : null;
      hovered = mine.target;
      message = mine.target ? "Release to use " + v.name + " on " + label(mine.target) + "." : "Drag " + v.name + " onto a layer.";
      refresh();
    }
    function up() {
      stop();
      if (!mine || varDrag !== mine) return;
      varDrag = null;
      dragged = true;
      row.removeAttribute("data-dragging");
      row.setAttribute("data-dragged", "");
      setTimeout(function () {
        row.removeAttribute("data-dragged");
      }, 0);
      var target = mine.target;
      hovered = null;
      message = "";
      if (!target) return refresh();
      select(target);
      refresh();
      openVarMenu(v, target, mine.x + 8, mine.y + 8);
    }
    function cancel() {
      stop();
      if (mine && varDrag === mine) {
        varDrag = null;
        hovered = null;
        message = "";
        row.removeAttribute("data-dragging");
        refresh();
      }
    }
    function stop() {
      hostWin.removeEventListener("pointermove", move, true);
      hostWin.removeEventListener("pointerup", up, true);
      hostWin.removeEventListener("pointercancel", cancel, true);
    }
    hostWin.addEventListener("pointermove", move, true);
    hostWin.addEventListener("pointerup", up, true);
    hostWin.addEventListener("pointercancel", cancel, true);
  }
`;
