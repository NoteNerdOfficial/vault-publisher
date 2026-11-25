/**
 * Edit mode's panel, as it runs in the browser: spliced into `EDIT_SCRIPT`'s
 * closure after the tools.
 *
 * It lives in the comment panel's shell (the overlay hands over a slot) and
 * has two tabs. Design is Figma's right-hand panel in Figma's words -- Fill,
 * Auto layout, Hug contents -- with the CSS each control writes in its
 * tooltip. Layers is the page as a tree. With nothing selected, Design shows
 * the page itself: its background, its variables, this session's history.
 *
 * Raw strings, like the other chunks: no backticks, and no dollar sign
 * followed by a brace.
 */
export const EDIT_PANEL = String.raw`
  /* --- the panel: state ------------------------------------------------ */

  var tab = "design";
  /* The section a control was used in, so a question shows up beside it. */
  var currentSec = null;
  var folded = {};
  try {
    folded = JSON.parse(localStorage.getItem("osp-edit-folded") || "{}") || {};
  } catch (e) {}
  /* The colour row whose palette is open: its key. */
  var paletteFor = null;
  var paletteMode = "solid";
  /* A colour waiting for a variable name: { key, prop, value }. */
  var naming = null;
  var showMinMax = false;
  var perSide = false;
  var perCorner = false;
  var layerQuery = "";
  var layerOpen = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  var preview = null;
  var dragRow = null;

  var ICON = {
    detach: '<rect x="3" y="3" width="10" height="10" rx="2"/><path d="M14 10h5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-5"/><path d="m21 3-7 7"/><path d="M17 3h4v4"/>',
    attach: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10"/><path d="M7 12h10"/><path d="M7 16h6"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    minus: '<path d="M5 12h14"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    right: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    wrap: '<path d="M3 6h18"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><path d="m16 16-2 2 2 2"/><path d="M3 18h7"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    gap: '<path d="M4 4v16"/><path d="M20 4v16"/><path d="M9 12h6"/>',
    padX: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8v8"/><path d="M16 8v8"/>',
    padY: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8h8"/><path d="M8 16h8"/>',
    sides: '<path d="M4 4h4"/><path d="M16 4h4"/><path d="M4 20h4"/><path d="M16 20h4"/><path d="M4 4v4"/><path d="M20 4v4"/><path d="M4 16v4"/><path d="M20 16v4"/>',
    radius: '<path d="M4 20V10a6 6 0 0 1 6-6h10"/>',
    rotate: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    opacity: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
    eyedrop: '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>',
    token: '<path d="M12 3 21 12 12 21 3 12Z"/>',
    eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M10.73 5.08a10.74 10.74 0 0 1 11.2 6.57 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49"/><path d="M14.08 14.16a3 3 0 0 1-4.24-4.24"/><path d="M17.48 17.5a10.75 10.75 0 0 1-15.42-5.15 1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14"/><path d="m2 2 20 20"/>',
    frame: '<path d="M22 6H2"/><path d="M22 18H2"/><path d="M6 2v20"/><path d="M18 2v20"/>',
    rows: '<rect x="3" y="3" width="18" height="7" rx="1"/><rect x="3" y="14" width="18" height="7" rx="1"/>',
    cols: '<rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/>',
    text: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    button: '<rect x="2" y="6" width="20" height="12" rx="6"/><path d="M8 12h8"/>',
    input: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10v4"/>',
    code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
    toLeft: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9-3 3 3 3"/>',
    toRight: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m10 15 3-3-3-3"/>',
    alignL: '<path d="M4 3v18"/><rect width="12" height="5" x="8" y="6" rx="1"/><rect width="7" height="5" x="8" y="13" rx="1"/>',
    alignC: '<path d="M12 3v18"/><rect width="14" height="5" x="5" y="6" rx="1"/><rect width="8" height="5" x="8" y="13" rx="1"/>',
    alignR: '<path d="M20 3v18"/><rect width="12" height="5" x="4" y="6" rx="1"/><rect width="7" height="5" x="9" y="13" rx="1"/>',
    textL: '<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/>',
    textC: '<path d="M21 6H3"/><path d="M17 12H7"/><path d="M19 18H5"/>',
    textR: '<path d="M21 6H3"/><path d="M21 12H9"/><path d="M21 18H7"/>',
    textJ: '<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>',
    none: '<path d="M5 12h14"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2"/>',
    undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
    redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>',
    reload: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    here: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/>',
    unlink: '<path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71"/><path d="M8 2v3"/><path d="M2 8h3"/><path d="M16 19v3"/><path d="M19 16h3"/>',
    ruler: '<path d="M3 16.5 16.5 3 21 7.5 7.5 21z"/><path d="m7.5 12 2 2"/><path d="m10.5 9 2 2"/><path d="m13.5 6 2 2"/>',
    card: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h6"/><path d="M7 13h10"/>',
    badge: '<rect x="3" y="8" width="18" height="8" rx="4"/>',
    rect: '<rect x="4" y="4" width="16" height="16" rx="1.5"/>',
    heading: '<path d="M6 4v16"/><path d="M18 4v16"/><path d="M6 12h12"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    divider: '<path d="M3 12h18"/><path d="M8 7h8" opacity=".4"/><path d="M8 17h8" opacity=".4"/>',
    list: '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    describe: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8"/><path d="M8 13h5"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  };

  function icon(name, size) {
    var s = size || 14;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[name] || "") + "</svg>";
  }

  function node(tag, cls, html) {
    var n = el(tag, cls);
    if (html) n.innerHTML = html;
    return n;
  }

  function iconButton(name, title, run, cls) {
    var b = node("button", "ep-icon" + (cls ? " " + cls : ""), icon(name));
    b.type = "button";
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", function (event) {
      event.stopPropagation();
      run(event);
    });
    return b;
  }

  /* A real button, with an icon and words: Detach, Add auto layout, Add a fill. */
  function actionButton(name, text, title, run) {
    var b = node("button", "ep-action", icon(name) + "<span></span>");
    b.type = "button";
    b.title = title;
    b.lastChild.textContent = text;
    b.addEventListener("click", function (event) {
      event.stopPropagation();
      run();
    });
    return b;
  }

  function px(value) {
    var n = parseFloat(value);
    return isFinite(n) ? Math.round(n * 10) / 10 : 0;
  }

  /* --- live preview while a value is dragged --------------------------- */

  function previewStart(list) {
    preview = list.map(function (t) {
      return { t: t, style: t.getAttribute("style") };
    });
  }

  function previewSet(props) {
    if (!preview) return;
    quiet(function () {
      preview.forEach(function (p) {
        var own = typeof props === "function" ? props(p.t) : props;
        (own || []).forEach(function (pair) {
          if (pair[1] === "") p.t.style.removeProperty(pair[0]);
          else p.t.style.setProperty(pair[0], pair[1]);
        });
      });
    });
  }

  function previewEnd() {
    if (!preview) return;
    var was = preview;
    preview = null;
    quiet(function () {
      was.forEach(function (p) {
        if (p.style === null) p.t.removeAttribute("style");
        else p.t.setAttribute("style", p.style);
      });
    });
  }

  /* --- fields ---------------------------------------------------------- */

  /* Runs a change from a section, so a question it raises shows there. */
  function from(sec, fn) {
    return function () {
      currentSec = sec;
      paletteFor = null;
      fn.apply(null, arguments);
    };
  }

  /*
   * A number field whose label scrubs, as Figma's do: drag it sideways to
   * change the value (Shift for tens). The page shows the value live while
   * the pointer is held; the file is written once, on release.
   */
  function numField(o) {
    var wrap = node("label", "ep-num");
    wrap.title = o.title;
    if (o.off) wrap.setAttribute("data-off", "");
    var k = node("span", "ep-k", ICON[o.k] ? icon(o.k, 12) : "");
    if (!ICON[o.k]) k.textContent = o.k;
    var input = el("input");
    input.value = o.mixed ? "" : String(o.value);
    if (o.mixed) input.placeholder = "Mixed";
    input.setAttribute("aria-label", o.title);
    input.disabled = !!o.off;
    wrap.appendChild(k);
    wrap.appendChild(input);
    var bound = o.vars && !o.mixed ? varChip(o, input, wrap) : false;
    if (o.unit && !bound) wrap.appendChild(el("span", "ep-u", o.unit));
    if (o.vars && !bound) wrap.appendChild(varButton(o));
    function commit(v) {
      if (o.min !== undefined) v = Math.max(o.min, v);
      if (o.max !== undefined) v = Math.min(o.max, v);
      o.commit(v);
    }
    input.addEventListener("change", function () {
      var raw = input.value.trim();
      if (o.text && raw && !isFinite(parseFloat(raw))) return o.text(raw);
      var v = parseFloat(raw);
      if (isFinite(v)) commit(v);
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") input.blur();
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        var v = (parseFloat(input.value) || 0) + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1);
        input.value = String(v);
        commit(v);
      }
    });
    k.addEventListener("pointerdown", function (event) {
      if (o.off || !o.live || busy) return;
      event.preventDefault();
      var start = parseFloat(input.value) || 0;
      var x0 = event.clientX;
      var last = start;
      previewStart(targets());
      try {
        k.setPointerCapture(event.pointerId);
      } catch (e) {}
      function move(m) {
        var v = Math.round(start + ((m.clientX - x0) * (m.shiftKey ? 10 : 1)) / 2);
        if (o.min !== undefined) v = Math.max(o.min, v);
        if (o.max !== undefined) v = Math.min(o.max, v);
        last = v;
        input.value = String(v);
        previewSet(o.live(v));
        draw();
      }
      function up() {
        k.removeEventListener("pointermove", move);
        k.removeEventListener("pointerup", up);
        k.removeEventListener("pointercancel", up);
        previewEnd();
        if (last !== start) commit(last);
      }
      k.addEventListener("pointermove", move);
      k.addEventListener("pointerup", up);
      k.addEventListener("pointercancel", up);
    });
    return wrap;
  }

  function seg(options, current, pick, title, labelled) {
    var s = node("div", "ep-seg" + (labelled ? " ep-seg-labelled" : ""));
    s.setAttribute("role", "radiogroup");
    if (title) s.title = title;
    options.forEach(function (o) {
      var b = node("button", null, (ICON[o[1]] ? icon(o[1]) : "") + (labelled || !ICON[o[1]] ? "<span></span>" : ""));
      b.type = "button";
      if (b.lastChild && b.lastChild.tagName === "SPAN") b.lastChild.textContent = labelled ? o[3] || o[1] : o[1];
      b.title = o[2] || o[1];
      b.setAttribute("aria-label", o[2] || o[1]);
      if (o[0] === current) b.setAttribute("data-on", "");
      b.addEventListener("click", function (event) {
        event.stopPropagation();
        if (o[0] !== current) pick(o[0]);
      });
      s.appendChild(b);
    });
    return s;
  }

  function selectField(options, current, title, pick, mixed) {
    var s = el("select", "ep-select");
    s.title = title;
    s.setAttribute("aria-label", title);
    if (mixed) {
      var m = el("option", null, "Mixed");
      m.value = "";
      m.selected = true;
      m.disabled = true;
      s.appendChild(m);
    }
    options.forEach(function (o) {
      var opt = el("option", null, o[1]);
      opt.value = o[0];
      if (!mixed && o[0] === current) opt.selected = true;
      s.appendChild(opt);
    });
    s.addEventListener("change", function () {
      pick(s.value);
    });
    return s;
  }

  function row(labelText, control, title) {
    var r = el("div", "ep-row");
    if (title) r.title = title;
    var name = el("span", "ep-label", labelText);
    // Cut short only past the column's width; the whole name is a hover away.
    if (!title) name.title = labelText;
    r.appendChild(name);
    r.appendChild(control);
    return r;
  }

  function pair(a, b) {
    var g = el("div", "ep-pair");
    g.appendChild(a);
    g.appendChild(b);
    return g;
  }

  /* One value across the selection, or null when the layers disagree. */
  function shared(read) {
    var list = targets();
    if (!list.length) return null;
    var first = read(list[0]);
    for (var i = 1; i < list.length; i++) if (read(list[i]) !== first) return null;
    return first;
  }

  function computed(prop) {
    return function (t) {
      return window.getComputedStyle(t).getPropertyValue(prop).trim();
    };
  }

  /* --- colour ---------------------------------------------------------- */

  function rgbaParts(value) {
    var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,\/]\s*([\d.]+)(%?))?/.exec(value || "");
    if (!m) return null;
    var a = m[4] === undefined ? 1 : m[5] ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a: a };
  }

  function hexOf(p) {
    return "#" + [p.r, p.g, p.b].map(function (n) {
      return ("0" + n.toString(16)).slice(-2);
    }).join("");
  }

  function withAlpha(hex, alpha) {
    if (alpha >= 1) return hex.toLowerCase();
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + ((n >> 16) & 255) + ", " + ((n >> 8) & 255) + ", " + (n & 255) + ", " + Math.round(alpha * 100) / 100 + ")";
  }

  /* Where a value comes from, as a chip: a variable, the layer itself, or a rule. */
  function sourceChip(prop) {
    var list = targets();
    if (list.length !== 1) return null;
    var win = winning(list[0], prop);
    if (!win) return null;
    var token = /var\(\s*(--[\w-]+)/.exec(win.value || "");
    if (token) {
      var t = node("span", "ep-chip ep-chip-token", icon("token", 10) + "<span></span>");
      t.lastChild.textContent = token[1].replace(/^--/, "");
      t.title = "From the variable " + token[1];
      return t;
    }
    var c = el("span", "ep-chip", win.kind === "inline" ? "This layer" : win.rule.selectorText);
    c.title = win.kind === "inline" ? "Set on the layer itself" : "Set by the rule " + win.rule.selectorText + (win.owner && win.owner.tagName === "LINK" ? " in " + sheetName(win.owner) : "");
    return c;
  }

  /*
   * Writes a colour: through "change the variable?" when the layer's value
   * comes from one, otherwise like any other style change.
   */
  function writeColour(prop, value, what) {
    var list = targets();
    if (list.length === 1 && !narrow && !forced) {
      var target = list[0];
      var win = winning(target, prop);
      var token = win && win.kind === "rule" ? /var\(\s*(--[\w-]+)/.exec(win.value) : null;
      if (token) {
        var def = tokenRule(target, token[1]);
        if (def && editableSheet(def.owner)) {
          ask = {
            sec: currentSec,
            text: "This " + what + " comes from the variable " + token[1] + ", used " + uses(token[1]) + ".",
            choices: [
              { label: "Change " + token[1], run: function () { applyRuleProps(def, [[token[1], value]], "the variable " + token[1]); } },
              whyNot(target)
                ? { label: "Just layers like this", run: function () { addRuleFor(target, [[prop, value]], what, null); } }
                : { label: "Just this one", run: function () { applyInlineProps(target, [[prop, value]], what); } },
            ],
          };
          refresh();
          return;
        }
      }
    }
    setStyles([[prop, value]], what);
  }

  /*
   * A colour row: the swatch opens the palette under it; the hex and the
   * opacity can be typed. The palette has the page's variables and colours,
   * any colour, the eyedropper, and turning this colour into a variable.
   */
  function colourRow(sec, key, prop, what, opts) {
    opts = opts || {};
    var value = shared(computed(prop));
    var parts = rgbaParts(value);
    var wrap = el("div", "ep-colour-wrap");
    var r = el("div", "ep-colour");
    r.title = what + " (" + prop + ")";
    var sw = el("button", "ep-swatch");
    sw.type = "button";
    sw.setAttribute("aria-label", "Pick a colour for the " + what);
    if (value && parts) sw.style.background = value;
    else sw.setAttribute("data-mixed", "");
    sw.addEventListener("click", function (event) {
      event.stopPropagation();
      paletteFor = paletteFor === key ? null : key;
      paletteMode = "solid";
      naming = null;
      refresh();
    });
    var hex = el("input", "ep-hex");
    hex.value = parts ? hexOf(parts).slice(1).toUpperCase() : "";
    if (!parts) hex.placeholder = "Mixed";
    hex.setAttribute("aria-label", what + " as hex");
    var alpha = el("input", "ep-alpha");
    alpha.value = parts ? Math.round(parts.a * 100) + "%" : "";
    alpha.setAttribute("aria-label", what + " opacity");
    var write = from(sec, function (v) {
      writeColour(prop, v, what);
    });
    hex.addEventListener("change", function () {
      var v = "#" + hex.value.replace(/^#/, "").trim();
      if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) write(withAlpha(v, parts ? parts.a : 1));
    });
    alpha.addEventListener("change", function () {
      var a = parseFloat(alpha.value);
      if (isFinite(a) && parts) write(withAlpha(hexOf(parts), Math.max(0, Math.min(100, a)) / 100));
    });
    r.appendChild(sw);
    r.appendChild(hex);
    r.appendChild(alpha);
    if (opts.remove) r.appendChild(iconButton("minus", opts.remove.title, from(sec, opts.remove.run), "ep-icon-small"));
    wrap.appendChild(r);
    var chip = sourceChip(prop);
    if (chip) {
      var chips = el("div", "ep-chips");
      chips.appendChild(chip);
      wrap.appendChild(chips);
    }
    if (paletteFor === key) wrap.appendChild(palette(sec, key, prop, what, parts, opts));
    return wrap;
  }

  function palette(sec, key, prop, what, parts, opts) {
    var box = el("div", "ep-palette");
    box.addEventListener("click", function (event) {
      event.stopPropagation();
    });
    var write = from(sec, function (v) {
      writeColour(prop, v, what);
    });
    if (opts.gradient) {
      box.appendChild(seg([["solid", "Solid", "One colour"], ["linear", "Linear", "A linear gradient (background-image)"]], paletteMode, function (m) {
        paletteMode = m;
        refresh();
      }, "Fill type"));
    }
    if (paletteMode === "linear" && opts.gradient) {
      box.appendChild(gradientEditor(sec));
      return box;
    }
    var vars = tokens();
    if (vars.length) {
      box.appendChild(el("div", "ep-palette-label", "Variables"));
      var grid = el("div", "ep-swatches");
      vars.forEach(function (t) {
        var s = el("button", "ep-swatch-pick");
        s.type = "button";
        s.style.background = t.value;
        s.title = t.name + " " + t.value;
        s.setAttribute("aria-label", t.name);
        s.addEventListener("click", function () {
          write("var(" + t.name + ")");
        });
        grid.appendChild(s);
      });
      box.appendChild(grid);
    }
    var colours = pageColours();
    if (colours.length) {
      box.appendChild(el("div", "ep-palette-label", "On this page"));
      var grid2 = el("div", "ep-swatches");
      colours.forEach(function (c) {
        var s = el("button", "ep-swatch-pick");
        s.type = "button";
        s.style.background = c;
        s.title = c;
        s.setAttribute("aria-label", c);
        s.addEventListener("click", function () {
          write(c);
        });
        grid2.appendChild(s);
      });
      box.appendChild(grid2);
    }
    var tools = el("div", "ep-palette-tools");
    var custom = el("input", "ep-custom");
    custom.type = "color";
    custom.value = parts ? hexOf(parts) : "#000000";
    custom.title = "Any colour";
    custom.setAttribute("aria-label", "Any colour");
    custom.addEventListener("change", function () {
      write(custom.value);
    });
    tools.appendChild(custom);
    if (canEyedrop()) {
      tools.appendChild(actionButton("eyedrop", "Eyedropper", "Pick a colour from the screen (I)", from(sec, function () {
        eyedrop(prop);
      })));
    }
    if (parts && targets().length) {
      tools.appendChild(actionButton("token", "Create variable", "Make this colour a variable on the page, and use it here", function () {
        naming = { key: key, prop: prop, value: withAlpha(hexOf(parts), parts.a), what: what };
        refresh();
      }));
    }
    box.appendChild(tools);
    if (naming && naming.key === key) box.appendChild(nameVariable(sec));
    return box;
  }

  function nameVariable(sec) {
    var r = el("div", "ep-name-var");
    var input = el("input", "ep-text");
    input.placeholder = "Name, like brand-accent";
    input.setAttribute("aria-label", "Variable name");
    var go = actionButton("plus", "Create", "Add --name to the page and use it here", function () {
      var name = "--" + input.value.trim().replace(/^-+/, "").replace(/\s+/g, "-").toLowerCase();
      if (!/^--[a-z][\w-]{0,40}$/.test(name)) {
        message = "A variable name is letters, digits and dashes, starting with a letter.";
        refresh();
        return;
      }
      var job = naming;
      naming = null;
      currentSec = sec;
      createVariable(name, job.value, function () {
        setStyles([[job.prop, "var(" + name + ")"]], job.what);
      });
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") go.click();
    });
    r.appendChild(input);
    r.appendChild(go);
    setTimeout(function () {
      input.focus();
    }, 0);
    return r;
  }

  /* A new custom property on :root, in the file's last style block. */
  function createVariable(name, value, then) {
    runGroup([
      function (next, stop) {
        addRuleSel(":root", [[name, value]], "variable " + name, null, next, stop);
      },
      function (next) {
        if (then) then();
        next();
      },
    ], "new variable " + name);
  }

  /* --- gradients ------------------------------------------------------- */

  function readGradient(value) {
    var m = /linear-gradient\(\s*(?:(-?[\d.]+)deg\s*,\s*)?(rgba?\([^)]*\)|#[0-9a-f]+)[^,]*,\s*(rgba?\([^)]*\)|#[0-9a-f]+)/i.exec(value || "");
    if (!m) return null;
    return { angle: m[1] === undefined ? 180 : parseFloat(m[1]), a: m[2], b: m[3] };
  }

  function gradientEditor(sec) {
    var box = el("div", "ep-stack");
    var image = shared(computed("background-image")) || "";
    var g = readGradient(image) || { angle: 90, a: "#ffffff", b: "#000000" };
    function hexish(c) {
      var p = rgbaParts(c);
      return p ? hexOf(p) : /^#[0-9a-f]{6}$/i.test(c) ? c : "#000000";
    }
    function write(next) {
      currentSec = sec;
      setStyles([["background-image", "linear-gradient(" + next.angle + "deg, " + next.a + " 0%, " + next.b + " 100%)"]], "gradient");
    }
    var stops = el("div", "ep-pair");
    ["a", "b"].forEach(function (end) {
      var input = el("input", "ep-custom ep-custom-wide");
      input.type = "color";
      input.value = hexish(g[end]);
      input.title = end === "a" ? "Start colour" : "End colour";
      input.setAttribute("aria-label", input.title);
      input.addEventListener("change", function () {
        var next = { angle: g.angle, a: g.a, b: g.b };
        next[end] = input.value;
        write(next);
      });
      stops.appendChild(input);
    });
    box.appendChild(stops);
    box.appendChild(numField({
      k: "rotate", title: "Angle", value: g.angle, unit: "°",
      live: function (v) {
        return [["background-image", "linear-gradient(" + v + "deg, " + g.a + " 0%, " + g.b + " 100%)"]];
      },
      commit: function (v) {
        write({ angle: v, a: g.a, b: g.b });
      },
    }));
    if (image && image !== "none") {
      box.appendChild(actionButton("minus", "Remove gradient", "background-image: none", function () {
        currentSec = sec;
        setStyles([["background-image", "none"]], "gradient");
      }));
    }
    return box;
  }

  /* --- sections -------------------------------------------------------- */

  /* The section to light up once, after an insert or the History button. */
  var flashSec = null;

  /* Opens the Design tab at a section, unfolded, scrolled to and lit up. */
  function showSection(id) {
    tab = "design";
    if (id && folded[id]) folded[id] = false;
    flashSec = id || null;
    refresh();
    var p = ui && ui.panel;
    var n = id && p && p.body.querySelector('[data-sec="' + id + '"]');
    if (n && n.scrollIntoView) n.scrollIntoView({ block: "nearest" });
    setTimeout(function () {
      if (flashSec === id) flashSec = null;
    }, 1500);
  }

  function section(id, title, css, body, action) {
    var box = el("div", "ep-sec");
    box.setAttribute("data-sec", id);
    if (flashSec === id) box.setAttribute("data-flash", "");
    var closed = !!folded[id];
    if (closed) box.setAttribute("data-closed", "");
    var head = el("div", "ep-sec-head");
    var toggle = node("button", "ep-sec-toggle", "<span></span>" + icon("chev", 12));
    toggle.type = "button";
    toggle.firstChild.textContent = title;
    toggle.title = css;
    toggle.setAttribute("aria-expanded", closed ? "false" : "true");
    toggle.addEventListener("click", function (event) {
      event.stopPropagation();
      folded[id] = !closed;
      try {
        localStorage.setItem("osp-edit-folded", JSON.stringify(folded));
      } catch (e) {}
      refresh();
    });
    head.appendChild(toggle);
    if (action) head.appendChild(action);
    box.appendChild(head);
    if (!closed) {
      var inner = el("div", "ep-sec-body");
      var content = body();
      if (content) inner.appendChild(content);
      var q = askNode(id);
      if (q) inner.appendChild(q);
      box.appendChild(inner);
    }
    return box;
  }

  function stack() {
    return el("div", "ep-stack");
  }

  /* The question waiting on an answer, shown in the section that raised it. */
  function askNode(sec) {
    if (!ask || (ask.sec || "top") !== sec) return null;
    var box = el("div", "ep-ask");
    box.appendChild(el("p", null, ask.text));
    var buttons = el("div", "ep-ask-row");
    ask.choices.forEach(function (choice, i) {
      var b = el("button", i === 0 ? "ep-ask-main" : null, choice.label);
      b.type = "button";
      b.addEventListener("click", function (event) {
        event.stopPropagation();
        choice.run();
      });
      buttons.appendChild(b);
    });
    var cancel = el("button", null, "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", function (event) {
      event.stopPropagation();
      ask = null;
      refresh();
    });
    buttons.appendChild(cancel);
    box.appendChild(buttons);
    return box;
  }

  function positionSection() {
    var list = targets();
    var one = list.length === 1 ? list[0] : null;
    return section("position", "Position", "position, left, top, rotate, align-self", function () {
      var b = stack();
      var allFree = list.every(positioned);
      var noneFree = !list.some(positioned);
      if (one && !positioned(one) && parentLayout(one).kind === "flex") {
        var lay = parentLayout(one);
        b.appendChild(seg(
          [["flex-start", "alignL", "Align to the start"], ["center", "alignC", "Align to the centre"], ["flex-end", "alignR", "Align to the end"]],
          window.getComputedStyle(one).alignSelf,
          from("position", function (v) {
            setStyles([["align-self", v]], "alignment");
          }),
          "Alignment in its auto layout (" + (lay.row ? "vertical" : "horizontal") + ", align-self)",
        ));
      }
      if (allFree) {
        var spot = one ? freePlace(one, 0, 0) : null;
        b.appendChild(pair(
          numField({
            k: "X", title: "X (left)", value: spot ? spot.left : 0, mixed: !one,
            live: function (v) {
              return [["left", v + "px"]];
            },
            commit: from("position", function (v) {
              setStyles([["left", Math.round(v) + "px"]], "position");
            }),
          }),
          numField({
            k: "Y", title: "Y (top)", value: spot ? spot.top : 0, mixed: !one,
            live: function (v) {
              return [["top", v + "px"]];
            },
            commit: from("position", function (v) {
              setStyles([["top", Math.round(v) + "px"]], "position");
            }),
          }),
        ));
      }
      var rot = shared(function (t) {
        return String(px(window.getComputedStyle(t).getPropertyValue("rotate")) || 0);
      });
      b.appendChild(pair(
        numField({
          k: "rotate", title: "Rotation (rotate)", value: rot === null ? 0 : rot, mixed: rot === null, unit: "°",
          live: function (v) {
            return [["rotate", v + "deg"]];
          },
          commit: from("position", function (v) {
            setStyles([["rotate", v ? v + "deg" : "0deg"]], "rotation");
          }),
        }),
        el("span"),
      ));
      if (noneFree) {
        var inLayout = list.some(function (t) {
          var k = parentLayout(t).kind;
          return k === "flex" || k === "grid";
        });
        b.appendChild(actionButton(
          "detach",
          inLayout ? "Detach from auto layout" : "Detach from the flow",
          "Take it out of the layout and place it freely, where it is now (position: absolute)",
          from("position", detachAll),
        ));
      } else if (allFree) {
        b.appendChild(el("p", "ep-hint", "Drag it on the page, or nudge it with the arrow keys (Shift for 10)."));
        b.appendChild(actionButton("attach", "Put back in the layout", "Back into its parent's layout (removes position, left and top)", from("position", putBack)));
      }
      return b;
    });
  }

  function detachAll() {
    var list = targets();
    if (list.length === 1) return detach();
    // Measured first: once one leaves the layout the others move.
    var spots = list.map(function (target) {
      var cs = window.getComputedStyle(target);
      var r = target.getBoundingClientRect();
      var origin = placeOrigin(containingBlock(target));
      return [
        ["position", "absolute"],
        ["left", Math.round(r.left - origin.left - (parseFloat(cs.marginLeft) || 0)) + "px"],
        ["top", Math.round(r.top - origin.top - (parseFloat(cs.marginTop) || 0)) + "px"],
        ["width", Math.round(cssLength(target, "width", r.width)) + "px"],
      ];
    });
    styleMany(list, function (t) {
      return spots[list.indexOf(t)];
    }, "detach");
  }

  /* Back into the layout: the position comes off where it was set, if it can. */
  function putBack() {
    setStyles(function (target) {
      var win = winning(target, "position");
      var own = win && (win.kind === "inline" || (win.kind === "rule" && countMatching(win.rule.selectorText) <= 1));
      return own
        ? [["position", ""], ["left", ""], ["top", ""]]
        : [["position", "static"], ["left", "auto"], ["top", "auto"]];
    }, "position");
  }

  function containers() {
    return targets().filter(function (t) {
      return t.children.length > 0 || !!CONTAINER[t.tagName];
    });
  }

  function autoLayoutSection() {
    var list = containers();
    if (!list.length) return null;
    var kinds = list.map(layoutKind);
    var kind = kinds.every(function (k) { return k === kinds[0]; }) ? kinds[0] : null;
    var one = list.length === 1 ? list[0] : null;
    var isWrap = !!one && /^wrap/.test(window.getComputedStyle(one).flexWrap || "");
    var on = kind === "row" || kind === "column" || kind === "grid";
    var action = on
      ? iconButton("minus", "Remove auto layout (display: block)", from("autolayout", function () {
          setStyles([["display", "block"]], "layout");
        }), "ep-icon-small")
      : null;
    return section("autolayout", "Auto layout", "display: flex or grid, flex-direction, gap, padding, alignment", function () {
      var b = stack();
      if (!on) {
        b.appendChild(actionButton("plus", "Add auto layout", "Lay its layers out in a row or a column (display: flex) · Shift+A", from("autolayout", addAutoLayout)));
        return b;
      }
      var dir = kind === "grid" ? "grid" : isWrap ? "wrap" : kind;
      b.appendChild(seg(
        [["column", "down", "Vertical: stacked (flex-direction: column)"], ["row", "right", "Horizontal: side by side (flex-direction: row)"], ["wrap", "wrap", "Wrap onto new lines (flex-wrap: wrap)"], ["grid", "grid", "Grid (display: grid)"]],
        dir,
        from("autolayout", function (v) {
          if (v === "grid") {
            var cols = Math.max(2, Math.min(6, one ? one.children.length : 2));
            return setStyles([["display", "grid"], ["grid-template-columns", "repeat(" + cols + ", minmax(0, 1fr))"]], "layout");
          }
          setStyles([["display", "flex"], ["flex-direction", v === "column" ? "column" : "row"], ["flex-wrap", v === "wrap" ? "wrap" : "nowrap"]], "layout");
        }),
        "Direction",
      ));
      var cs = one ? window.getComputedStyle(one) : null;
      var grid = kind === "grid";
      var r = el("div", "ep-align-row");
      if (one) r.appendChild(alignGrid(one, kind));
      var right = stack();
      var between = !!cs && cs.justifyContent === "space-between";
      var gapValue = shared(function (t) {
        return String(px(window.getComputedStyle(t).columnGap) || px(window.getComputedStyle(t).rowGap));
      });
      if (between) {
        right.appendChild(actionButton("gap", "Auto gap: spread out", "The space between is shared out (justify-content: space-between). Click for a fixed gap.", from("autolayout", function () {
          setStyles([["justify-content", "flex-start"]], "spacing");
        })));
      } else {
        right.appendChild(numField({
          k: "gap", title: grid ? "Gap between columns (column-gap)" : "Gap between items (gap)", value: gapValue === null ? 0 : gapValue, mixed: gapValue === null, min: 0,
          live: function (v) {
            return [[grid || isWrap ? "column-gap" : "gap", v + "px"]];
          },
          commit: from("autolayout", function (v) {
            setStyles([[grid || isWrap ? "column-gap" : "gap", v + "px"]], "gap");
          }),
          text: from("autolayout", function (word) {
            if (/^auto$/i.test(word)) setStyles([["justify-content", "space-between"]], "spacing");
          }),
          vars: { key: grid || isWrap ? "column-gap" : "gap", kind: "size", props: [grid || isWrap ? "column-gap" : "gap"], what: "gap", sec: "autolayout" },
        }));
      }
      if (grid || isWrap) {
        var rowGap = shared(function (t) {
          return String(px(window.getComputedStyle(t).rowGap));
        });
        right.appendChild(numField({
          k: "↕", title: "Gap between rows (row-gap)", value: rowGap === null ? 0 : rowGap, mixed: rowGap === null, min: 0,
          live: function (v) {
            return [["row-gap", v + "px"]];
          },
          commit: from("autolayout", function (v) {
            setStyles([["row-gap", v + "px"]], "row gap");
          }),
          vars: { key: "row-gap", kind: "size", props: ["row-gap"], what: "row gap", sec: "autolayout" },
        }));
      }
      r.appendChild(right);
      b.appendChild(r);
      if (grid && one) {
        var tracks = (cs.gridTemplateColumns || "").split(/\s+/).filter(function (v) { return parseFloat(v) >= 0; }).length || 1;
        b.appendChild(pair(
          numField({
            k: "Col", title: "Columns (grid-template-columns)", value: tracks, min: 1, max: 24,
            commit: from("autolayout", function (v) {
              setStyles([["grid-template-columns", "repeat(" + Math.round(v) + ", minmax(0, 1fr))"]], "columns");
            }),
          }),
          numField({
            k: "Row", title: "Rows (grid-template-rows): 0 for as many as it needs", value: (cs.gridTemplateRows === "none" ? 0 : (cs.gridTemplateRows || "").split(/\s+/).length), min: 0, max: 24,
            commit: from("autolayout", function (v) {
              setStyles([["grid-template-rows", v ? "repeat(" + Math.round(v) + ", auto)" : ""]], "rows");
            }),
          }),
        ));
      }
      b.appendChild(paddingFields());
      var clip = el("label", "ep-check");
      var box = el("input");
      box.type = "checkbox";
      box.checked = shared(computed("overflow")) === "hidden";
      box.addEventListener("change", from("autolayout", function () {
        setStyles([["overflow", box.checked ? "hidden" : "visible"]], "clipping");
      }));
      clip.appendChild(box);
      clip.appendChild(document.createTextNode("Clip content"));
      clip.title = "Hide what spills out of it (overflow: hidden)";
      b.appendChild(clip);
      return b;
    }, action);
  }

  /* Figma's nine dots: where the layers sit inside the frame. */
  function alignGrid(target, kind) {
    var cs = window.getComputedStyle(target);
    var grid = kind === "grid";
    var column = kind === "column";
    var START = grid ? "start" : "flex-start";
    var END = grid ? "end" : "flex-end";
    var stops = [START, "center", END];
    function norm(v) {
      if (v === "normal" || v === "stretch" || v === "start" || v === "flex-start" || v === "left") return START;
      if (v === "end" || v === "flex-end" || v === "right") return END;
      return v;
    }
    var mainProp = grid ? "justify-items" : "justify-content";
    var crossProp = "align-items";
    var main = stops.indexOf(norm(cs.getPropertyValue(mainProp)));
    var cross = stops.indexOf(norm(cs.alignItems));
    var box = el("div", "ep-align");
    box.title = "Alignment (" + mainProp + ", " + crossProp + ")";
    for (var y = 0; y < 3; y++) {
      for (var x = 0; x < 3; x++) {
        (function (x, y) {
          var m = column ? y : x;
          var c = column ? x : y;
          var b = el("button");
          b.type = "button";
          b.setAttribute("aria-label", "Align " + ["top", "middle", "bottom"][y] + " " + ["left", "centre", "right"][x]);
          if (m === main && c === cross) b.setAttribute("data-on", "");
          b.addEventListener("click", from("autolayout", function () {
            setStyles([[mainProp, stops[m]], [crossProp, stops[c]]], "alignment");
          }));
          box.appendChild(b);
        })(x, y);
      }
    }
    return box;
  }

  function paddingFields() {
    var box = stack();
    var read = function (side) {
      return shared(function (t) {
        return String(px(window.getComputedStyle(t).getPropertyValue("padding-" + side)));
      });
    };
    var top = read("top");
    var right = read("right");
    var bottom = read("bottom");
    var left = read("left");
    var even = top === bottom && left === right && top !== null && left !== null;
    function field(k, title, props, value) {
      return numField({
        k: k, title: title, value: value === null ? 0 : value, mixed: value === null, min: 0,
        live: function (v) {
          return props.map(function (p) {
            return [p, v + "px"];
          });
        },
        commit: from("autolayout", function (v) {
          setStyles(props.map(function (p) {
            return [p, v + "px"];
          }), "padding");
        }),
        vars: { key: props.join(","), kind: "size", props: props, what: "padding", sec: "autolayout" },
      });
    }
    var line = el("div", "ep-pad");
    if (perSide || !even) {
      var four = el("div", "ep-quad");
      four.appendChild(field("T", "Top padding", ["padding-top"], top));
      four.appendChild(field("R", "Right padding", ["padding-right"], right));
      four.appendChild(field("B", "Bottom padding", ["padding-bottom"], bottom));
      four.appendChild(field("L", "Left padding", ["padding-left"], left));
      line.appendChild(four);
    } else {
      line.appendChild(pair(
        field("padX", "Horizontal padding (padding-left, padding-right)", ["padding-left", "padding-right"], left),
        field("padY", "Vertical padding (padding-top, padding-bottom)", ["padding-top", "padding-bottom"], top),
      ));
    }
    var toggle = iconButton("sides", perSide ? "Same padding on opposite sides" : "Padding for each side", function () {
      perSide = !perSide;
      refresh();
    }, "ep-icon-small");
    if (perSide) toggle.setAttribute("data-on", "");
    line.appendChild(toggle);
    box.appendChild(line);
    return box;
  }

  function sizingSection() {
    var list = targets();
    var one = list.length === 1 ? list[0] : null;
    return section("sizing", "Sizing", "width, height, flex, align-self, min-width, max-width", function () {
      var b = stack();
      ["width", "height"].forEach(function (dim) {
        var mode = shared(function (t) {
          return sizeMode(t, dim);
        });
        var size = one ? Math.round(cssLength(one, dim, one.getBoundingClientRect()[dim])) : 0;
        var lay = one ? parentLayout(one) : { kind: "flow" };
        var fillWord = lay.kind === "flex" ? "Fill container" : lay.kind === "grid" ? "Fill cell" : "Fill width";
        b.appendChild(pair(
          numField({
            k: dim === "width" ? "W" : "H", title: dim === "width" ? "Width" : "Height", value: size, mixed: !one, min: 0,
            live: function (v) {
              return [[dim, v + "px"]];
            },
            commit: from("sizing", function (v) {
              if (list.length === 1) setSize(dim, "fixed", v);
              else setStyles(function (t) {
                return sizeProps(t, dim, "fixed", v);
              }, dim);
            }),
          }),
          selectField(
            [["hug", "Hug contents"], ["fill", dim === "height" && lay.kind === "flow" ? "Fill height" : fillWord], ["fixed", "Fixed"]],
            mode,
            (dim === "width" ? "Width" : "Height") + " behaviour",
            from("sizing", function (v) {
              if (list.length === 1) setSize(dim, v);
              else setStyles(function (t) {
                return sizeProps(t, dim, v, cssLength(t, dim, t.getBoundingClientRect()[dim]));
              }, dim);
            }),
            mode === null,
          ),
        ));
      });
      var any = list.some(function (t) {
        var cs = window.getComputedStyle(t);
        return cs.minWidth !== "0px" && cs.minWidth !== "auto" || cs.maxWidth !== "none" || cs.minHeight !== "0px" && cs.minHeight !== "auto" || cs.maxHeight !== "none";
      });
      if (showMinMax || any) {
        [["min-width", "Min W"], ["max-width", "Max W"], ["min-height", "Min H"], ["max-height", "Max H"]].forEach(function (m, i, all) {
          if (i % 2) return;
          var a = m;
          var c = all[i + 1];
          b.appendChild(pair(minMax(a[0], a[1]), minMax(c[0], c[1])));
        });
      } else {
        b.appendChild(actionButton("plus", "Min and max", "Limits on width and height (min-width, max-width, min-height, max-height)", function () {
          showMinMax = true;
          refresh();
        }));
      }
      return b;
    });
  }

  function minMax(prop, labelText) {
    var value = shared(computed(prop));
    var n = parseFloat(value);
    return numField({
      k: labelText, title: labelText + " (" + prop + "): empty for none", value: isFinite(n) ? Math.round(n) : "", mixed: value === null, min: 0,
      commit: from("sizing", function (v) {
        setStyles([[prop, v + "px"]], prop);
      }),
      text: from("sizing", function (word) {
        if (/^(none|auto|-)$/i.test(word)) setStyles([[prop, ""]], prop);
      }),
    });
  }

  var BLENDS = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"];

  function appearanceSection() {
    return section("appearance", "Appearance", "opacity, border-radius, mix-blend-mode", function () {
      var b = stack();
      var op = shared(function (t) {
        return String(Math.round(parseFloat(window.getComputedStyle(t).opacity) * 100));
      });
      var radius = shared(function (t) {
        return String(px(window.getComputedStyle(t).borderTopLeftRadius));
      });
      b.appendChild(pair(
        numField({
          k: "opacity", title: "Opacity", value: op === null ? 100 : op, mixed: op === null, unit: "%", min: 0, max: 100,
          live: function (v) {
            return [["opacity", String(v / 100)]];
          },
          commit: from("appearance", function (v) {
            setStyles([["opacity", String(Math.round(v) / 100)]], "opacity");
          }),
        }),
        perCorner ? el("span") : numField({
          k: "radius", title: "Corner radius (border-radius)", value: radius === null ? 0 : radius, mixed: radius === null, min: 0,
          live: function (v) {
            return [["border-radius", v + "px"]];
          },
          commit: from("appearance", function (v) {
            setStyles([["border-radius", v + "px"]], "corner radius");
          }),
          vars: { key: "border-radius", kind: "size", props: ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"], what: "corner radius", sec: "appearance" },
        }),
      ));
      if (perCorner) {
        var four = el("div", "ep-quad");
        [["border-top-left-radius", "⌜"], ["border-top-right-radius", "⌝"], ["border-bottom-right-radius", "⌟"], ["border-bottom-left-radius", "⌞"]].forEach(function (c) {
          var v = shared(function (t) {
            return String(px(window.getComputedStyle(t).getPropertyValue(c[0])));
          });
          four.appendChild(numField({
            k: c[1], title: c[0], value: v === null ? 0 : v, mixed: v === null, min: 0,
            live: function (n) {
              return [[c[0], n + "px"]];
            },
            commit: from("appearance", function (n) {
              setStyles([[c[0], n + "px"]], "corner radius");
            }),
          }));
        });
        b.appendChild(four);
      }
      var corners = actionButton("radius", perCorner ? "One radius for every corner" : "A radius for each corner", "border-*-radius", function () {
        perCorner = !perCorner;
        refresh();
      });
      b.appendChild(corners);
      var blend = shared(computed("mix-blend-mode"));
      b.appendChild(row("Blend", selectField(BLENDS.map(function (m) {
        return [m, m.charAt(0).toUpperCase() + m.slice(1).replace(/-/g, " ")];
      }), blend, "Blend mode (mix-blend-mode)", from("appearance", function (v) {
        setStyles([["mix-blend-mode", v]], "blend mode");
      }), blend === null)));
      return b;
    });
  }

  /* Has words of its own, so the text controls apply. */
  function hasText(t) {
    for (var n = t.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && /\S/.test(n.data)) return true;
    return retypable(t);
  }

  /* The fonts the page names, then the usual families. */
  function fonts() {
    var seen = {};
    var out = [];
    walkRules(function (rule) {
      var f = rule.style.getPropertyValue("font-family");
      if (f && !seen[f.trim()] && out.length < 12) {
        seen[f.trim()] = 1;
        out.push(f.trim());
      }
    });
    ["system-ui, sans-serif", "Georgia, serif", "ui-monospace, monospace"].forEach(function (f) {
      if (!seen[f]) out.push(f);
    });
    return out;
  }

  function fontName(stack) {
    return (stack || "").split(",")[0].replace(/["']/g, "").trim() || "Default";
  }

  function textSection() {
    var list = targets().filter(hasText);
    if (!list.length) return null;
    return section("text", "Text", "font-family, font-weight, font-size, line-height, letter-spacing, text-align, text-transform, text-decoration", function () {
      var b = stack();
      var family = shared(computed("font-family"));
      var options = fonts().map(function (f) {
        return [f, fontName(f)];
      });
      if (family && !options.some(function (o) { return o[0] === family; })) options.unshift([family, fontName(family)]);
      var fontLine = el("div", "ep-var-line");
      fontLine.appendChild(selectField(options, family, "Font (font-family)", from("text", function (v) {
        setStyles([["font-family", v]], "font");
      }), family === null));
      var fontVars = { vars: { key: "font-family", kind: "font", props: ["font-family"], what: "font", sec: "text" }, value: "" };
      fontLine.appendChild(varButton(fontVars));
      b.appendChild(fontLine);
      var fontVar = sharedVar(["font-family"]);
      if (fontVar) {
        var fchips = el("div", "ep-chips");
        var fchip = node("span", "ep-chip ep-chip-token", icon("token", 10) + "<span></span>");
        fchip.lastChild.textContent = fontVar.replace(/^--/, "");
        fchip.title = "From the variable " + fontVar + ": " + varValue(fontVar);
        fchips.appendChild(fchip);
        fchips.appendChild(iconButton("unlink", "Detach variable: keep the font as a plain value", function () {
          detachVar(fontVars);
        }, "ep-var-detach"));
        b.appendChild(fchips);
      }
      var weight = shared(computed("font-weight"));
      var size = shared(function (t) {
        return String(px(window.getComputedStyle(t).fontSize));
      });
      b.appendChild(pair(
        selectField([["100", "Thin"], ["200", "Extra light"], ["300", "Light"], ["400", "Regular"], ["500", "Medium"], ["600", "Semibold"], ["700", "Bold"], ["800", "Extra bold"], ["900", "Black"]], weight, "Weight (font-weight)", from("text", function (v) {
          setStyles([["font-weight", v]], "weight");
        }), weight === null),
        numField({
          k: "Aa", title: "Size (font-size)", value: size === null ? 16 : size, mixed: size === null, min: 1,
          live: function (v) {
            return [["font-size", v + "px"]];
          },
          commit: from("text", function (v) {
            setStyles([["font-size", v + "px"]], "font size");
          }),
          vars: { key: "font-size", kind: "size", props: ["font-size"], what: "font size", sec: "text" },
        }),
      ));
      var lh = shared(function (t) {
        var v = window.getComputedStyle(t).lineHeight;
        return v === "normal" ? "Auto" : String(px(v));
      });
      var ls = shared(function (t) {
        return String(px(window.getComputedStyle(t).letterSpacing));
      });
      b.appendChild(pair(
        numField({
          k: "↕", title: "Line height (line-height): Auto or pixels", value: lh === null ? "" : lh, mixed: lh === null, min: 0,
          live: function (v) {
            return [["line-height", v + "px"]];
          },
          commit: from("text", function (v) {
            setStyles([["line-height", v + "px"]], "line height");
          }),
          text: from("text", function (word) {
            if (/^auto$/i.test(word)) setStyles([["line-height", "normal"]], "line height");
          }),
          vars: { key: "line-height", kind: "size", props: ["line-height"], what: "line height", sec: "text" },
        }),
        numField({
          k: "|A|", title: "Letter spacing (letter-spacing)", value: ls === null ? 0 : ls, mixed: ls === null,
          live: function (v) {
            return [["letter-spacing", v / 10 + "px"]];
          },
          commit: from("text", function (v) {
            setStyles([["letter-spacing", v + "px"]], "letter spacing");
          }),
          vars: { key: "letter-spacing", kind: "size", props: ["letter-spacing"], what: "letter spacing", sec: "text" },
        }),
      ));
      var align = shared(function (t) {
        var a = window.getComputedStyle(t).textAlign;
        return a === "start" ? "left" : a === "end" ? "right" : a;
      });
      b.appendChild(seg([["left", "textL", "Align left"], ["center", "textC", "Align centre"], ["right", "textR", "Align right"], ["justify", "textJ", "Justify"]], align, from("text", function (v) {
        setStyles([["text-align", v]], "alignment");
      }), "Text alignment (text-align)"));
      var tcase = shared(computed("text-transform"));
      var deco = shared(function (t) {
        var d = window.getComputedStyle(t).textDecorationLine || "none";
        return /underline/.test(d) ? "underline" : /line-through/.test(d) ? "line-through" : "none";
      });
      b.appendChild(pair(
        seg([["none", "Aa", "As typed"], ["uppercase", "AA", "Upper case"], ["lowercase", "aa", "Lower case"], ["capitalize", "Ab", "Title case"]], tcase, from("text", function (v) {
          setStyles([["text-transform", v]], "case");
        }), "Case (text-transform)"),
        seg([["none", "none", "No decoration"], ["underline", "U", "Underline"], ["line-through", "S", "Strikethrough"]], deco, from("text", function (v) {
          setStyles([["text-decoration-line", v]], "decoration");
        }), "Decoration (text-decoration-line)"),
      ));
      var clamp = shared(function (t) {
        var c = window.getComputedStyle(t).getPropertyValue("-webkit-line-clamp");
        return c && c !== "none" ? String(parseInt(c, 10)) : "0";
      });
      b.appendChild(row("Truncate", selectField([["0", "Don't truncate"], ["1", "After 1 line"], ["2", "After 2 lines"], ["3", "After 3 lines"], ["4", "After 4 lines"]], clamp, "Cut the text off with … (-webkit-line-clamp)", from("text", function (v) {
        setStyles(v === "0"
          ? [["-webkit-line-clamp", ""], ["display", ""], ["-webkit-box-orient", ""], ["overflow", ""]]
          : [["display", "-webkit-box"], ["-webkit-box-orient", "vertical"], ["-webkit-line-clamp", v], ["overflow", "hidden"]], "truncation");
      }), clamp === null)));
      b.appendChild(row("Colour", colourRow("text", "text-color", "color", "text colour")));
      return b;
    });
  }

  function fillSection() {
    var list = targets();
    var images = list.filter(function (t) {
      return t.tagName === "IMG";
    });
    var bg = shared(computed("background-color"));
    var image = shared(computed("background-image"));
    var empty = bg !== null && transparent(bg) && (image === "none" || image === "");
    var action = empty ? null : iconButton("minus", "Remove fill", from("fill", function () {
      setStyles([["background-color", "transparent"], ["background-image", "none"]], "fill");
    }), "ep-icon-small");
    return section("fill", "Fill", "background-color, background-image", function () {
      var b = stack();
      if (images.length === list.length) {
        var fit = shared(computed("object-fit"));
        b.appendChild(row("Image", selectField([["cover", "Fill"], ["contain", "Fit"], ["none", "Crop"], ["fill", "Stretch"]], fit, "How the image fills its box (object-fit)", from("fill", function (v) {
          setStyles([["object-fit", v]], "image fill");
        }), fit === null)));
      }
      if (empty && paletteFor !== "fill") {
        b.appendChild(actionButton("plus", "Add a fill", "A background colour (background-color)", from("fill", function () {
          setStyles([["background-color", "#ffffff"]], "fill");
        })));
        return b;
      }
      if (image && image !== "none" && paletteFor !== "fill") {
        var g = readGradient(image);
        var chip = el("button", "ep-gradient");
        chip.type = "button";
        chip.style.background = image;
        chip.textContent = g ? "Linear " + g.angle + "°" : "Image";
        chip.title = "Edit the gradient";
        chip.addEventListener("click", function (event) {
          event.stopPropagation();
          paletteFor = "fill";
          paletteMode = "linear";
          refresh();
        });
        b.appendChild(chip);
      }
      b.appendChild(colourRow("fill", "fill", "background-color", "fill", { gradient: true }));
      return b;
    }, action);
  }

  function strokeSection() {
    var list = targets();
    var width = shared(function (t) {
      return String(px(window.getComputedStyle(t).borderTopWidth));
    });
    var style = shared(computed("border-top-style"));
    var has = list.some(function (t) {
      var cs = window.getComputedStyle(t);
      return parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none";
    });
    var action = has ? iconButton("minus", "Remove stroke", from("stroke", function () {
      setStyles([["border-style", "none"]], "stroke");
    }), "ep-icon-small") : null;
    return section("stroke", "Stroke", "border-color, border-width, border-style", function () {
      var b = stack();
      if (!has) {
        b.appendChild(actionButton("plus", "Add a stroke", "A border round it (border)", from("stroke", function () {
          setStyles([["border", "1px solid #000000"]], "stroke");
        })));
        return b;
      }
      b.appendChild(colourRow("stroke", "stroke", "border-top-color", "stroke"));
      b.appendChild(pair(
        numField({
          k: "padX", title: "Weight (border-width)", value: width === null ? 1 : width, mixed: width === null, min: 0,
          live: function (v) {
            return [["border-width", v + "px"]];
          },
          commit: from("stroke", function (v) {
            setStyles([["border-width", v + "px"]], "stroke weight");
          }),
        }),
        seg([["solid", "—", "Solid"], ["dashed", "- -", "Dashed"], ["dotted", "···", "Dotted"]], style, from("stroke", function (v) {
          setStyles([["border-style", v]], "stroke style");
        }), "Style (border-style)"),
      ));
      return b;
    }, action);
  }

  /* A box-shadow value as its separate shadows. */
  function readShadows(value) {
    if (!value || value === "none") return [];
    var parts = selectorParts(value);
    return parts.map(function (part) {
      var colour = (/rgba?\([^)]*\)|#[0-9a-f]{3,8}/i.exec(part) || ["rgba(0, 0, 0, 0.25)"])[0];
      var rest = part.replace(colour, "");
      var nums = (rest.match(/-?[\d.]+px|\b0\b/g) || []).map(parseFloat);
      return {
        inset: /inset/.test(part),
        colour: colour,
        x: nums[0] || 0,
        y: nums[1] || 0,
        blur: nums[2] || 0,
        spread: nums[3] || 0,
      };
    });
  }

  function writeShadows(list) {
    if (!list.length) return "none";
    return list.map(function (s) {
      return (s.inset ? "inset " : "") + s.x + "px " + s.y + "px " + s.blur + "px " + s.spread + "px " + s.colour;
    }).join(", ");
  }

  function blurOf(value) {
    var m = /blur\(([\d.]+)px\)/.exec(value || "");
    return m ? parseFloat(m[1]) : 0;
  }

  function effectsSection() {
    var list = targets();
    var one = list.length === 1 ? list[0] : null;
    var cs = one ? window.getComputedStyle(one) : null;
    var shadows = cs ? readShadows(cs.boxShadow) : [];
    var add = iconButton("plus", "Add a drop shadow", from("effects", function () {
      var base = one ? readShadows(window.getComputedStyle(one).boxShadow) : [];
      base.push({ inset: false, colour: "rgba(0, 0, 0, 0.25)", x: 0, y: 4, blur: 12, spread: 0 });
      setStyles([["box-shadow", writeShadows(base)]], "shadow");
    }), "ep-icon-small");
    return section("effects", "Effects", "box-shadow, filter: blur(), backdrop-filter: blur()", function () {
      var b = stack();
      if (!one) {
        b.appendChild(el("p", "ep-hint", "Effects are edited one layer at a time. The + adds a drop shadow to each."));
        return b;
      }
      shadows.forEach(function (s, i) {
        var card = el("div", "ep-effect");
        var head = el("div", "ep-effect-head");
        head.appendChild(selectField([["drop", "Drop shadow"], ["inner", "Inner shadow"]], s.inset ? "inner" : "drop", "Shadow type", from("effects", function (v) {
          var next = shadows.slice();
          next[i] = Object.assign({}, s, { inset: v === "inner" });
          setStyles([["box-shadow", writeShadows(next)]], "shadow");
        })));
        head.appendChild(iconButton("minus", "Remove this shadow", from("effects", function () {
          var next = shadows.slice();
          next.splice(i, 1);
          setStyles([["box-shadow", writeShadows(next)]], "shadow");
        }), "ep-icon-small"));
        card.appendChild(head);
        var four = el("div", "ep-quad");
        [["x", "X"], ["y", "Y"], ["blur", "Blur"], ["spread", "Spread"]].forEach(function (f) {
          four.appendChild(numField({
            k: f[1].charAt(0), title: f[1], value: s[f[0]], min: f[0] === "blur" ? 0 : undefined,
            live: function (v) {
              var next = shadows.slice();
              next[i] = Object.assign({}, s);
              next[i][f[0]] = v;
              return [["box-shadow", writeShadows(next)]];
            },
            commit: from("effects", function (v) {
              var next = shadows.slice();
              next[i] = Object.assign({}, s);
              next[i][f[0]] = v;
              setStyles([["box-shadow", writeShadows(next)]], "shadow");
            }),
          }));
        });
        card.appendChild(four);
        var colour = el("input", "ep-custom ep-custom-wide");
        colour.type = "color";
        var p = rgbaParts(s.colour);
        colour.value = p ? hexOf(p) : "#000000";
        colour.title = "Shadow colour";
        colour.setAttribute("aria-label", "Shadow colour");
        colour.addEventListener("change", from("effects", function () {
          var next = shadows.slice();
          next[i] = Object.assign({}, s, { colour: withAlpha(colour.value, p ? p.a : 0.25) });
          setStyles([["box-shadow", writeShadows(next)]], "shadow");
        }));
        card.appendChild(colour);
        b.appendChild(card);
      });
      var layerBlur = blurOf(cs.filter);
      var backBlur = blurOf(cs.getPropertyValue("backdrop-filter"));
      if (layerBlur || cs.filter === "none") {
        b.appendChild(row("Layer blur", numField({
          k: "B", title: "Layer blur (filter: blur)", value: layerBlur, min: 0, unit: "px",
          live: function (v) {
            return [["filter", v ? "blur(" + v + "px)" : "none"]];
          },
          commit: from("effects", function (v) {
            setStyles([["filter", v ? "blur(" + v + "px)" : "none"]], "layer blur");
          }),
        })));
      }
      b.appendChild(row("Background blur", numField({
        k: "B", title: "Background blur (backdrop-filter: blur)", value: backBlur, min: 0, unit: "px",
        live: function (v) {
          return [["backdrop-filter", v ? "blur(" + v + "px)" : "none"]];
        },
        commit: from("effects", function (v) {
          setStyles([["backdrop-filter", v ? "blur(" + v + "px)" : "none"]], "background blur");
        }),
      })));
      return b;
    }, add);
  }

  function stateSection() {
    var one = targets().length === 1 ? selected : null;
    if (!one || whyNot(one) && styleWhyNot(one)) return null;
    return section("state", "State", ":hover, :active, :focus", function () {
      var b = stack();
      b.appendChild(seg(
        [["default", "Default", "As it is"], ["hover", "Hover", "While the pointer is over it (:hover)"], ["active", "Pressed", "While it is pressed (:active)"], ["focus", "Focus", "While it has the keyboard (:focus)"]],
        forced ? forced.state : "default",
        function (v) {
          showState(v);
        },
        "Which state to show and edit",
      ));
      if (forced) b.appendChild(el("p", "ep-hint", "Showing " + STATES[forced.state].label.toLowerCase() + ". Changes go into the " + STATES[forced.state].pseudo[STATES[forced.state].pseudo.length - 1] + " rule for this layer."));
      return b;
    });
  }

  /* --- where it is in the files -------------------------------------- */

  /* Answers from the server, by hash and stamp: { layer, rules } or "asking". */
  var whereCache = {};

  /* The rules that style a layer, strongest first, each with how the server can find it. */
  function rulesFor(target) {
    var out = [];
    walkRules(function (rule, path, owner, on, order) {
      if (!on || (forced && owner === forced.sheet)) return;
      var spec = matchSpecificity(target, rule.selectorText);
      if (spec < 0) return;
      var sheet = owner && owner.tagName === "STYLE" ? stampOf(owner) : sheetPath(owner);
      out.push({
        rule: rule,
        path: path,
        owner: owner,
        spec: spec,
        order: order,
        ask: sheet === null || sheet === "" ? null : { sheet: sheet, path: path, selector: rule.selectorText },
        // cssText keeps shorthands together, closer to how the file has it.
        text: rule.selectorText + " {\n" + declarations(rule.style).map(function (d) {
          return "  " + d.prop + ": " + d.value + (d.important ? " !important" : "") + ";";
        }).join("\n") + "\n}",
      });
    });
    // As the browser weighs them, so the rule that wins comes first.
    out.sort(function (x, y) {
      return y.spec - x.spec || y.order - x.order;
    });
    return out;
  }

  /* A rule's declarations as written, shorthands kept, in order. */
  function declarations(style) {
    var out = [];
    var text = style.cssText || "";
    var depth = 0;
    var quote = "";
    var start = 0;
    for (var i = 0; i <= text.length; i++) {
      var c = text.charAt(i);
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = "";
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
      else if ((c === ";" || i === text.length) && depth <= 0) {
        var d = text.slice(start, i).trim();
        start = i + 1;
        var colon = d.indexOf(":");
        if (colon > 0) {
          var value = d.slice(colon + 1).trim();
          out.push({
            prop: d.slice(0, colon).trim(),
            value: value.replace(/\s*!\s*important$/i, ""),
            important: /!\s*important$/i.test(value),
          });
        }
      }
    }
    return foldInheritedFont(out);
  }

  /*
   * "font: inherit", which the browser hands back as a dozen font-*
   * longhands all set to inherit, folded back into the one line it was.
   */
  function foldInheritedFont(list) {
    var inherited = list.filter(function (d) {
      return /^font-/.test(d.prop) && d.value === "inherit" && !d.important;
    });
    if (inherited.length < 4) return list;
    var out = [];
    var placed = false;
    list.forEach(function (d) {
      if (inherited.indexOf(d) === -1) out.push(d);
      else if (!placed) {
        out.push({ prop: "font", value: "inherit", important: false });
        placed = true;
      }
    });
    return out;
  }

  /*
   * Whether a declaration loses to another for this layer: all of it, or
   * some of a shorthand's parts, and to what.
   */
  function overrideOf(target, rule, d) {
    var style = rule ? rule.style : target.style;
    var parts = [];
    for (var i = 0; i < style.length; i++) if (style[i].indexOf(d.prop + "-") === 0) parts.push(style[i]);
    if (!parts.length) parts = [d.prop];
    var lost = 0;
    var by = "";
    parts.forEach(function (prop) {
      var win = winning(target, prop);
      if (!win) return;
      var other = win.kind === "inline" ? (rule ? "the layer's own style" : "") : win.rule === rule ? "" : win.rule.selectorText;
      if (other) {
        lost++;
        by = by || other;
      }
    });
    return lost ? { all: lost === parts.length, by: by } : null;
  }

  /* One declaration: its value a field when it can be written, struck through when it loses. */
  function declRow(target, rule, d, write) {
    var line = el("div", "ep-decl");
    var over = overrideOf(target, rule, d);
    if (over && over.all) line.setAttribute("data-over", "");
    if (over) line.setAttribute("data-part", over.all ? "all" : "some");
    var why = over ? (over.all ? "Overridden by " : "Partly overridden by ") + over.by : "";
    line.appendChild(el("span", "ep-decl-prop", d.prop));
    line.appendChild(el("span", "ep-decl-colon", ":"));
    var fixed = d.important ? "it is marked !important" : /\b(url|image-set)\s*\(/i.test(d.value) ? "it names a file" : "";
    if (!write || fixed) {
      line.appendChild(el("span", "ep-decl-val ep-decl-fixed", d.value + (d.important ? " !important" : "")));
      line.title = [why, write && fixed ? "Change this one in the file: " + fixed : ""].filter(Boolean).join(". ");
      return line;
    }
    line.title = why;
    var input = el("input", "ep-decl-val");
    input.value = d.value;
    input.spellcheck = false;
    input.setAttribute("data-ep-keep", "");
    input.setAttribute("aria-label", d.prop + (why ? ", " + why : ""));
    var done = false;
    input.addEventListener("keydown", function (event) {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        input.value = d.value;
        input.blur();
      }
    });
    input.addEventListener("blur", function () {
      var v = input.value.trim();
      if (done || v === d.value) return;
      done = true;
      write([[d.prop, v]]);
    });
    line.appendChild(input);
    return line;
  }

  /* A field for a new declaration, written as "gap: 12px". */
  function addDeclRow(write) {
    var input = el("input", "ep-decl-add");
    input.placeholder = "+ Add, like gap: 12px";
    input.spellcheck = false;
    input.setAttribute("data-ep-keep", "");
    input.setAttribute("aria-label", "Add a property, written as name: value");
    input.addEventListener("keydown", function (event) {
      event.stopPropagation();
      if (event.key === "Escape") {
        input.value = "";
        input.blur();
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      var m = /^\s*(-{0,2}[a-zA-Z][\w-]*)\s*:\s*(.+?)\s*;?\s*$/.exec(input.value);
      if (!m) {
        message = "Write it as a property and a value, like gap: 12px.";
        refresh();
        return;
      }
      input.value = "";
      input.blur();
      write([[m[1].toLowerCase().indexOf("--") === 0 ? m[1] : m[1].toLowerCase(), m[2]]]);
    });
    return input;
  }

  /*
   * Where the layer and its rules are: asked once per version of the file,
   * and drawn when the answer comes. Null until then.
   */
  /*
   * What a layer the page's script made can be found by in the script: its
   * own words, else all of them when it has little inside, and its classes.
   */
  function scriptClue(target) {
    var own = "";
    Array.prototype.forEach.call(target.childNodes, function (n) {
      var t = n.nodeType === 3 ? n.nodeValue.replace(/\s+/g, " ").trim() : "";
      if (t.length > own.length) own = t;
    });
    var text = own || (target.children.length <= 3 ? (target.textContent || "").replace(/\s+/g, " ").trim() : "");
    var classes = Array.prototype.filter.call(target.classList, function (name) {
      return ident(name) && !STATE_CLASS.test(name) && name.indexOf("osp-") !== 0;
    });
    // The rarest class on the page is the likeliest to be the script's own.
    classes.sort(function (a, b) {
      return countMatching("." + a) - countMatching("." + b);
    });
    return { text: text.slice(0, 200), classes: classes.slice(0, 8), leaf: target.children.length === 0 };
  }

  function whereOf(target, rules) {
    var at = stampOf(target);
    if (unavailable || stale) return null;
    var find = at === null ? scriptClue(target) : null;
    if (find && !find.text && !find.classes.length) return { layer: null, rules: [], script: [] };
    var key = hash + "|" + (find ? "s|" + JSON.stringify(find) : at);
    var known = whereCache[key];
    if (known === "asking") return null;
    if (known) return known;
    whereCache[key] = "asking";
    fetch("/api/where", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page: PAGE,
        hash: hash,
        at: at === null ? undefined : at,
        find: find || undefined,
        rules: rules.map(function (r) {
          return r.ask || { sheet: null, path: [], selector: "" };
        }),
      }),
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        whereCache[key] = data || { layer: null, rules: [] };
        if (selected === target || describeUses(target)) refresh();
      })
      .catch(function () {
        delete whereCache[key];
      });
    return null;
  }

  function fileName(path) {
    return String(path || "").split("/").pop();
  }

  /* "index.html · line 42", copyable, with a link that opens the editor there. */
  function placeChip(where, what) {
    var box = el("div", "ep-where");
    var copy = el("button", "ep-where-name");
    copy.type = "button";
    copy.appendChild(node("span", "ep-where-icon", icon("code", 12)));
    copy.appendChild(el("span", null, fileName(where.file) + " · line " + where.line));
    copy.title = where.file + ":" + where.line + " — click to copy";
    copy.setAttribute("aria-label", "Copy " + where.file + ":" + where.line);
    copy.addEventListener("click", function (event) {
      event.stopPropagation();
      try {
        hostWin.navigator.clipboard.writeText(where.file + ":" + where.line).then(function () {
          message = "Copied " + where.file + ":" + where.line + (what ? ", where " + what + " is." : ".");
          refresh();
        });
      } catch (e) {}
    });
    box.appendChild(copy);
    if (where.editor) {
      var app = where.editorName || "your editor";
      var open = el("a", "ep-where-open", "Open in " + app);
      open.href = where.editor;
      open.title = "Open " + where.file + " at line " + where.line + " in " + app + ". Change the app in the plugin's settings.";
      open.addEventListener("click", function (event) {
        event.stopPropagation();
      });
      box.appendChild(open);
    }
    return box;
  }

  /* The layer's markup without what Edit mode adds to it, for a brief. */
  function cleanMarkup(target) {
    var copy = target.cloneNode(true);
    var all = [copy].concat(Array.prototype.slice.call(copy.querySelectorAll("*")));
    all.forEach(function (n) {
      // Edit mode's stamps and the comment layer's anchors, none of which the file has.
      Array.prototype.slice.call(n.attributes).forEach(function (a) {
        if (a.name.indexOf("data-osp-") === 0) n.removeAttribute(a.name);
      });
      n.removeAttribute("contenteditable");
    });
    return copy.outerHTML;
  }

  var FENCE = "\u0060\u0060\u0060";

  function copyText(text, said) {
    try {
      hostWin.navigator.clipboard.writeText(text).then(function () {
        message = said;
        refresh();
      });
    } catch (e) {}
  }

  /* Where a script-made layer comes from, and whether its words can be changed. */
  function scriptBlock(b, one, where) {
    b.appendChild(el("p", "ep-hint", "Made by the page's script, so it is not in the file."));
    var spots = where && where.script;
    var retype = where && where.retype;
    if (retype && retype.places && retype.places.length) {
      // The words are written in several places: say which to change.
      var key = scriptClue(one).text;
      b.appendChild(el("div", "ep-palette-label", "Its words are in " + retype.places.length + " places. Which one makes this layer?"));
      retype.places.forEach(function (place, i) {
        var item = el("div", "ep-place");
        if (retypePicks[key] === i) item.setAttribute("data-on", "");
        item.appendChild(placeChip(place, "its words"));
        item.appendChild(el("code", "ep-place-line", place.context));
        var pick = el("button", "ep-link", retypePicks[key] === i ? "Chosen" : "Change this one");
        pick.type = "button";
        pick.addEventListener("click", function (event) {
          event.stopPropagation();
          retypePicks[key] = i;
          message = "Enter or double-click now changes the words at " + fileName(place.file) + " line " + place.line + ".";
          refresh();
        });
        item.appendChild(pick);
        b.appendChild(item);
      });
      if (retype.all) {
        b.appendChild(actionButton("list", retypePicks[key] === "all" ? "Changing all " + retype.places.length : "Change all " + retype.places.length,
          "Change the words in every place at once", function () {
            retypePicks[key] = "all";
            message = "Enter or double-click now changes the words in all " + retype.places.length + " places.";
            refresh();
          }));
      }
      return;
    }
    if (spots && spots.length) {
      var byText = spots[0].by === "text";
      b.appendChild(el("div", "ep-palette-label", spots.length > 1 ? "Probably made in one of these" : "Probably made here"));
      spots.forEach(function (spot) {
        b.appendChild(placeChip(spot, byText ? "its text" : "." + spot.what));
      });
      var quoted = spots[0].what.length > 40 ? spots[0].what.slice(0, 40) + "…" : spots[0].what;
      b.appendChild(el("p", "ep-hint", byText ? "Found by its text, “" + quoted + "”." : "Found by its class, ." + spots[0].what + "."));
    } else if (spots) {
      b.appendChild(el("p", "ep-hint", "Its words and classes aren't in the page's scripts or the JSON files they load."));
    }
    var why = where ? retypeWhy(one) : null;
    if (why === "") b.appendChild(el("p", "ep-hint", "You can change its words here: Enter or double-click. They're written into the file at that line."));
    else if (why) b.appendChild(el("p", "ep-hint ep-why", why));
  }

  /* The CSS that applies to the layer, strongest first, editable where the file can be written. */
  function codeSection() {
    var one = targets().length === 1 ? selected : null;
    if (!one) return null;
    if (folded.code === undefined) folded.code = true;
    var rules = rulesFor(one);
    return section("code", "Code", "Where this layer is in the files, and the CSS that applies to it", function () {
      var b = stack();
      var where = whereOf(one, rules);
      if (where && where.layer) {
        b.appendChild(el("div", "ep-palette-label", "The layer"));
        b.appendChild(placeChip(where.layer, label(one)));
      } else if (stampOf(one) === null) scriptBlock(b, one, where);

      var all = [];
      var writable = !whyNot(one);
      rules.forEach(function (r, i) {
        var block = el("div", "ep-rule");
        var spot = where && where.rules ? where.rules[i] : null;
        if (spot) block.appendChild(placeChip(spot, r.rule.selectorText));
        else if (!r.ask) block.appendChild(el("div", "ep-palette-label", sheetName(r.owner)));
        var can = !!r.ask && editableSheet(r.owner);
        var n = countMatching(r.rule.selectorText);
        var media = r.rule.parentRule && r.rule.parentRule.media ? "@media " + r.rule.parentRule.media.mediaText : "";
        if (media) block.appendChild(el("div", "ep-rule-media", media));
        var head = el("div", "ep-rule-sel", r.rule.selectorText + " {");
        if (n > 1) head.appendChild(el("span", "ep-rule-count", n + " layers"));
        head.title = n > 1 ? "A change here applies to all " + n + " layers this rule styles." : "";
        block.appendChild(head);
        var write = can ? function (props) {
          currentSec = "code";
          applyRuleProps({ rule: r.rule, path: r.path, owner: r.owner }, props, r.rule.selectorText);
        } : null;
        declarations(r.rule.style).forEach(function (d) {
          block.appendChild(declRow(one, r.rule, d, write));
        });
        if (write) block.appendChild(addDeclRow(write));
        block.appendChild(el("div", "ep-rule-sel", "}"));
        b.appendChild(block);
        all.push(r.text);
      });

      var own = declarations(one.style);
      if (own.length || writable) {
        var block = el("div", "ep-rule");
        block.appendChild(el("div", "ep-rule-sel", "On the layer (style) {"));
        var write = writable ? function (props) {
          currentSec = "code";
          applyInlineProps(one, props, props[0][0]);
        } : null;
        own.forEach(function (d) {
          block.appendChild(declRow(one, null, d, write));
        });
        if (write) block.appendChild(addDeclRow(write));
        block.appendChild(el("div", "ep-rule-sel", "}"));
        b.appendChild(block);
        if (own.length) all.push("/* on the layer */\n" + own.map(function (d) { return d.prop + ": " + d.value + ";"; }).join("\n"));
      }
      if (rules.length) {
        b.appendChild(el("p", "ep-hint", "Strongest first. A struck-out value loses to another rule: hover it to see which."));
      }
      var buttons = el("div", "ep-row-btns");
      if (all.length) buttons.appendChild(actionButton("copy", "Copy CSS", "Copy all of this CSS", function () {
        copyText(all.join("\n\n"), "Copied the CSS.");
      }));
      buttons.appendChild(actionButton("describe", "Describe a change", "Say what should change here, for an AI coding tool, with this layer's code (/)", function () {
        if (selected !== one) select(one);
        openDescribe();
      }));
      b.appendChild(buttons);
      return b;
    });
  }

  /* --- attributes -------------------------------------------------------- */

  /* The attributes worth a field for each kind of layer, then any it has. */
  var ATTRS = {
    A: ["href", "target", "rel"],
    IMG: ["src", "alt", "width", "height", "loading"],
    INPUT: ["type", "name", "placeholder", "value", "required", "disabled", "checked"],
    BUTTON: ["type", "disabled"],
    TEXTAREA: ["name", "placeholder", "rows", "required"],
    SELECT: ["name", "required"],
    OPTION: ["value", "selected"],
    LABEL: ["for"],
    FORM: ["action", "method"],
    IFRAME: ["src", "title"],
    VIDEO: ["src", "poster", "controls", "autoplay", "muted", "loop"],
    AUDIO: ["src", "controls"],
    SOURCE: ["src", "type"],
  };
  var COMMON_ATTRS = ["id", "class", "title", "aria-label", "role"];
  var FLAG_ATTRS = { required: 1, disabled: 1, checked: 1, selected: 1, controls: 1, autoplay: 1, muted: 1, loop: 1, hidden: 1 };

  function attributesSection() {
    var one = targets().length === 1 ? selected : null;
    if (!one || whyNot(one)) return null;
    if (folded.attrs === undefined) folded.attrs = true;
    return section("attrs", "Attributes", "The layer's HTML attributes: links, image text, field hints", function () {
      var b = stack();
      var names = (ATTRS[one.tagName] || []).concat(COMMON_ATTRS);
      Array.prototype.forEach.call(one.attributes, function (a) {
        var n = a.name;
        if (names.indexOf(n) === -1 && n !== "style" && n !== ATTR && n !== "contenteditable" && n.indexOf("on") !== 0) names.push(n);
      });
      names.forEach(function (name) {
        var has = one.hasAttribute(name);
        if (FLAG_ATTRS[name]) {
          var box = el("input", "ep-flag");
          box.type = "checkbox";
          box.checked = has;
          box.setAttribute("aria-label", name);
          box.addEventListener("change", function () {
            currentSec = "attrs";
            setAttribute(one, name, box.checked ? "" : null);
          });
          b.appendChild(row(name, box, name + (has ? ": on" : ": off")));
          return;
        }
        var input = el("input", "ep-attr");
        var before = has ? one.getAttribute(name) : "";
        input.value = before;
        input.placeholder = "Not set";
        input.spellcheck = false;
        input.setAttribute("data-ep-keep", "");
        input.setAttribute("aria-label", name);
        var done = false;
        input.addEventListener("keydown", function (event) {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            input.blur();
          } else if (event.key === "Escape") {
            input.value = before;
            input.blur();
          }
        });
        input.addEventListener("blur", function () {
          if (done || input.value === before) return;
          done = true;
          currentSec = "attrs";
          // Emptied takes it away, except for an alt, where empty means "decorative".
          setAttribute(one, name, input.value === "" && name !== "alt" ? null : input.value);
        });
        b.appendChild(row(name, input, name));
      });
      var add = el("input", "ep-attr");
      add.placeholder = "+ Add, like data-plan=pro";
      add.spellcheck = false;
      add.setAttribute("data-ep-keep", "");
      add.setAttribute("aria-label", "Add an attribute, written as name=value");
      add.addEventListener("keydown", function (event) {
        event.stopPropagation();
        if (event.key !== "Enter") return;
        event.preventDefault();
        var m = /^\s*([a-zA-Z_][\w:.-]*)\s*(?:=\s*"?([^"]*)"?)?\s*$/.exec(add.value);
        if (!m) {
          message = "Write it as a name and a value, like data-plan=pro.";
          refresh();
          return;
        }
        add.value = "";
        add.blur();
        currentSec = "attrs";
        setAttribute(one, m[1], m[2] === undefined ? "" : m[2]);
      });
      b.appendChild(add);
      return b;
    });
  }

  function setAttribute(target, name, value) {
    var before = target.getAttribute(name);
    var who = label(target);
    act(
      { op: "attr", at: stampOf(target), name: name, value: value },
      name + " change on " + who,
      function (data) {
        remap(data.edits);
        quiet(function () {
          if (value === null) target.removeAttribute(name);
          else target.setAttribute(name, value);
        });
      },
      function (back) {
        remap(back.edits);
        quiet(function () {
          if (before === null) target.removeAttribute(name);
          else target.setAttribute(name, before);
        });
      },
      function () {
        message = value === null ? "Took " + name + " off " + who + "." : "Set " + name + " on " + who + ".";
      },
    );
  }

  /* --- this session's changes, as a diff ------------------------------- */

  var changes = { key: "", data: null };

  function changesSection() {
    return section("changes", "Changes", "What this session changed in each file, as a diff", function () {
      var b = stack();
      if (!log.length && !redone.length) {
        b.appendChild(el("p", "ep-hint", "Nothing changed yet. Each file's changes this session show here, line by line."));
        return b;
      }
      var key = hash + "|" + log.length + "|" + redone.length;
      if (changes.key !== key) {
        changes = { key: key, data: null };
        fetch("/api/changes", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ page: PAGE }),
        })
          .then(function (r) {
            return r.ok ? r.json() : { files: [] };
          })
          .then(function (data) {
            if (changes.key !== key) return;
            changes.data = data;
            refresh();
          })
          .catch(function () {
            changes.key = "";
          });
      }
      var data = changes.data;
      if (!data) {
        b.appendChild(el("p", "ep-hint", "Reading the files…"));
        return b;
      }
      if (!data.files.length) {
        b.appendChild(el("p", "ep-hint", "The files are as they were: everything this session did has been undone."));
        return b;
      }
      data.files.forEach(function (f) {
        var head = el("div", "ep-diff-file");
        head.appendChild(el("span", null, f.file));
        var copy = el("button", "ep-link", "Copy");
        copy.type = "button";
        copy.addEventListener("click", function (event) {
          event.stopPropagation();
          copyText(f.text, "Copied the changes to " + fileName(f.file) + ".");
        });
        head.appendChild(copy);
        b.appendChild(head);
        var pre = el("div", "ep-diff");
        var shown = 0;
        f.hunks.forEach(function (h) {
          pre.appendChild(el("div", "ep-diff-hunk", h.header));
          h.lines.forEach(function (l) {
            if (shown++ > 400) return;
            pre.appendChild(el("div", l.kind === "+" ? "ep-diff-add" : l.kind === "-" ? "ep-diff-del" : "ep-diff-ctx", l.kind + l.text));
          });
        });
        b.appendChild(pre);
      });
      b.appendChild(actionButton("copy", "Copy all", "Copy every file's changes as one diff", function () {
        copyText(data.files.map(function (f) { return f.text; }).join(""), "Copied the changes as a diff.");
      }));
      return b;
    });
  }

  /* --- nothing selected: the page -------------------------------------- */

  function lengthTokens() {
    var names = {};
    walkRules(function (rule) {
      for (var i = 0; i < rule.style.length; i++) if (rule.style[i].indexOf("--") === 0) names[rule.style[i]] = 1;
    });
    var root = window.getComputedStyle(document.documentElement);
    var out = [];
    for (var name in names) {
      var v = root.getPropertyValue(name).trim();
      if (/^-?[\d.]+(px|rem|em|%)$/.test(v) && out.length < 16) out.push({ name: name, value: v });
    }
    return out;
  }

  function pageSections() {
    var out = [];
    out.push(section("page", "Page", "background on body", function () {
      var b = stack();
      var bg = window.getComputedStyle(document.body).backgroundColor;
      var parts = rgbaParts(bg);
      var input = el("input", "ep-custom ep-custom-wide");
      input.type = "color";
      input.value = parts && parts.a ? hexOf(parts) : "#ffffff";
      input.title = "Page background (background-color on body)";
      input.setAttribute("aria-label", input.title);
      input.addEventListener("change", function () {
        currentSec = "page";
        pageBackground(input.value);
      });
      b.appendChild(row("Background", input));
      b.appendChild(row("Preview at", seg(DEVICES.map(function (d) {
        return [d[0], d[1], d[2] ? d[1] + ": the page at " + d[2] + "px, still editable" : "The page as it is"];
      }), device ? device.name : "full", showDevice, "Preview the page at a device's width")));
      b.appendChild(el("p", "ep-hint", "Click a layer on the page, or in Layers, to change it. Hold Space to use the page."));
      return b;
    }));
    out.push(section("variables", "Variables", "custom properties (--name)", function () {
      var b = stack();
      var all = pageVariables();
      var count = {};
      all.forEach(function (v) {
        count[v.kind] = (count[v.kind] || 0) + 1;
      });
      var parts = VAR_KINDS.filter(function (k) {
        return count[k[0]];
      }).map(function (k) {
        return count[k[0]] + " " + (count[k[0]] === 1 ? k[1].toLowerCase().replace(/s$/, "") : k[1].toLowerCase());
      });
      b.appendChild(el("p", "ep-hint", all.length
        ? "This page has " + parts.join(", ") + ". See, change and drag them onto layers in the Variables tab."
        : "No variables yet. Make one in the Variables tab, or from a field's \u25c7 or a colour's palette."));
      b.appendChild(actionButton(all.length ? "token" : "plus", all.length ? "Open Variables" : "New variable", all.length ? "The page's variables, by kind" : "A new variable on :root", function () {
        tab = "variables";
        if (!all.length) varMaking = true;
        refresh();
      }));
      return b;
    }));
    out.push(section("history", "History", "This session's edits", function () {
      var b = stack();
      if (!log.length) {
        b.appendChild(el("p", "ep-hint", "Nothing changed yet. Every edit is written to the file and listed here; the file's first version this session is kept in edit-backups."));
        return b;
      }
      var list = el("ol", "ep-history");
      log.slice().reverse().forEach(function (entry, i) {
        var item = el("li");
        item.appendChild(el("span", null, entry.what.charAt(0).toUpperCase() + entry.what.slice(1)));
        if (i > 0) {
          var back = el("button", "ep-link", "Undo to here");
          back.type = "button";
          back.addEventListener("click", function (event) {
            event.stopPropagation();
            undoTimes(i);
          });
          item.appendChild(back);
        } else {
          item.appendChild(el("span", "ep-latest", "Latest"));
        }
        list.appendChild(item);
      });
      b.appendChild(list);
      var see = el("button", "ep-link", "See the changes, line by line");
      see.type = "button";
      see.addEventListener("click", function (event) {
        event.stopPropagation();
        showSection("changes");
      });
      b.appendChild(see);
      return b;
    }));
    out.push(changesSection());
    if (folded.shortcuts === undefined) folded.shortcuts = true;
    out.push(section("shortcuts", "Shortcuts", "Keys in Edit mode", function () {
      var k = MAC ? { cmd: "⌘", alt: "⌥", shift: "⇧" } : { cmd: "Ctrl+", alt: "Alt+", shift: "Shift+" };
      var rows = [
        ["Frame / rectangle / text", "F / R / T"],
        ["Image", k.shift + k.cmd + "K"],
        ["Place it at the selection", "Enter, with a tool out"],
        ["Select more", "Shift-click"],
        ["Into its layers / up", "Enter / " + k.shift + "Enter"],
        ["Next layer", "Tab"],
        ["Measure", "Hold " + (MAC ? "⌥" : "Alt")],
        ["Add auto layout", k.shift + "A"],
        ["Frame selection / ungroup", k.alt + k.cmd + "G / " + k.shift + k.cmd + "G"],
        ["Copy / paste layers", k.cmd + "C / " + k.cmd + "V"],
        ["Copy / paste properties", k.alt + k.cmd + "C / " + k.alt + k.cmd + "V"],
        ["Duplicate", k.cmd + "D, or " + (MAC ? "⌥" : "Alt") + "-drag"],
        ["Hide / show", k.shift + k.cmd + "H"],
        ["Move in its layout", "Arrows, " + k.cmd + "] / " + k.cmd + "["],
        ["Eyedropper", "I"],
        ["Describe a change, for an AI tool", "/"],
        ["Copy the changes described", k.cmd + "Enter"],
        ["Use the page", "Hold Space"],
      ];
      var table = el("dl", "ep-keys");
      rows.forEach(function (r) {
        table.appendChild(el("dt", null, r[0]));
        table.appendChild(el("dd", null, r[1]));
      });
      return table;
    }));
    return out;
  }

  /* The page's background: its body rule, or a new one. */
  function pageBackground(value) {
    var win = winning(document.body, "background-color");
    if (win && win.kind === "rule" && editableSheet(win.owner)) return applyRuleProps(win, [["background-color", value]], win.rule.selectorText);
    addRuleSel("body", [["background-color", value]], "page background", null);
  }

  /* Undoes the last n edits, one after another. */
  function undoTimes(n) {
    if (n <= 0 || busy) return;
    undo(function () {
      undoTimes(n - 1);
    });
  }

  /* --- layers ---------------------------------------------------------- */

  var SKIP = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, TEMPLATE: 1, NOSCRIPT: 1, BR: 1, WBR: 1 };

  function layerKids(n) {
    return Array.prototype.filter.call(n.children, function (k) {
      return !SKIP[k.tagName] && !ours(k) && !(k.hasAttribute && k.hasAttribute("data-osp-added"));
    });
  }

  function layerIcon(n) {
    if (n.tagName === "IMG" || n.tagName === "PICTURE" || n.tagName === "VIDEO") return "image";
    if (n.tagName === "BUTTON" || n.tagName === "A" && !n.children.length) return "button";
    if (n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.tagName === "SELECT") return "input";
    if (retypable(n)) return "text";
    var k = layoutKind(n);
    if (k === "row") return "cols";
    if (k === "column") return "rows";
    if (k === "grid") return "grid";
    return "frame";
  }

  /* What a layer is called: its words for text, else its tag and class. */
  function layerName(n) {
    if (retypable(n)) {
      var words = (n.textContent || "").replace(/\s+/g, " ").trim();
      if (words) return words.length > 32 ? words.slice(0, 31) + "…" : words;
    }
    if (n.tagName === "IMG") return n.getAttribute("alt") || (n.getAttribute("src") || "Image").split("/").pop();
    return label(n);
  }

  function isOpen(n, depth) {
    if (layerOpen && layerOpen.has(n)) return layerOpen.get(n);
    if (depth < 1) return true;
    return targets().some(function (t) {
      return t !== n && n.contains(t);
    });
  }

  function layersBody() {
    var box = el("div", "ep-layers");
    var list = targets();
    var count = 0;
    var query = layerQuery.trim().toLowerCase();
    function rowFor(n, depth) {
      if (count++ > 800) return;
      var kids = layerKids(n);
      var open = kids.length && isOpen(n, depth);
      var r = el("div", "ep-layer");
      r.style.paddingLeft = 6 + (query ? 0 : depth * 14) + "px";
      if (list.indexOf(n) !== -1) r.setAttribute("data-selected", "");
      if (n.style && n.style.display === "none") r.setAttribute("data-hidden", "");
      if (stampOf(n) === null) r.setAttribute("data-made", "");
      var tw = node("button", "ep-twist", kids.length && !query ? icon("chev", 12) : "");
      tw.type = "button";
      tw.tabIndex = -1;
      if (!open) tw.setAttribute("data-closed", "");
      tw.addEventListener("click", function (event) {
        event.stopPropagation();
        if (layerOpen) layerOpen.set(n, !open);
        refresh();
      });
      r.appendChild(tw);
      r.appendChild(node("span", "ep-kind", icon(layerIcon(n), 13)));
      var name = el("span", "ep-layer-name", layerName(n));
      r.appendChild(name);
      if (stampOf(n) === null) {
        var made = node("span", "ep-chip ep-chip-made", icon("code", 10) + "<span>Script</span>");
        made.title = "Made by the page's script: not in the file";
        r.appendChild(made);
      }
      var hidden = n.style && n.style.display === "none";
      var eye = iconButton(hidden ? "eyeOff" : "eye", hidden ? "Show" : "Hide", function () {
        if (busy || whyNot(n)) return;
        if (hidden) applyInlineProps(n, [["display", ""]], "show");
        else {
          var was = selected;
          selected = n;
          hide();
          if (was !== n) selected = was;
        }
      }, "ep-eye");
      r.appendChild(eye);
      r.title = label(n);
      r.draggable = stampOf(n) !== null;
      r.addEventListener("click", function (event) {
        event.stopPropagation();
        if (event.shiftKey || event.metaKey || event.ctrlKey) toggleSelect(n);
        else {
          selectMany([n]);
          try {
            n.scrollIntoView({ block: "nearest", inline: "nearest" });
          } catch (e) {}
        }
      });
      r.addEventListener("mouseenter", function () {
        hovered = n;
        self.shared.hover = self;
        draw();
      });
      r.addEventListener("mouseleave", function () {
        if (hovered === n) hovered = null;
        draw();
      });
      r.addEventListener("dragstart", function (event) {
        dragRow = n;
        try {
          event.dataTransfer.setData("text/plain", label(n));
          event.dataTransfer.effectAllowed = "move";
        } catch (e) {}
      });
      r.addEventListener("dragover", function (event) {
        if (!dragRow || dragRow === n || dragRow.contains(n) || stampOf(n) === null) return;
        event.preventDefault();
        var rect = r.getBoundingClientRect();
        var y = event.clientY - rect.top;
        var place = y < rect.height * 0.3 ? "before" : y > rect.height * 0.7 || !holds(n) ? "after" : "inside";
        if (place === "after" && y < rect.height / 2) place = "before";
        r.setAttribute("data-drop", place);
      });
      r.addEventListener("dragleave", function () {
        r.removeAttribute("data-drop");
      });
      r.addEventListener("drop", function (event) {
        event.preventDefault();
        var place = r.getAttribute("data-drop");
        r.removeAttribute("data-drop");
        var moving = dragRow;
        dragRow = null;
        if (moving && place) move(moving, n, place);
      });
      r.addEventListener("dragend", function () {
        dragRow = null;
      });
      if (!query || name.textContent.toLowerCase().indexOf(query) !== -1 || label(n).toLowerCase().indexOf(query) !== -1) box.appendChild(r);
      if (query || open) kids.forEach(function (k) {
        rowFor(k, depth + 1);
      });
    }
    layerKids(document.body).forEach(function (n) {
      rowFor(n, 0);
    });
    if (!box.children.length) box.appendChild(el("p", "ep-hint ep-pad-hint", query ? "No layer matches “" + layerQuery + "”." : "This page has no layers."));
    return box;
  }

  /* --- drawing the panel ----------------------------------------------- */

  function buildPanel(slot) {
    var root = el("div", "ep-root");
    ["keydown", "keyup", "keypress"].forEach(function (type) {
      root.addEventListener(type, function (event) {
        event.stopPropagation();
      });
    });
    root.addEventListener("click", function () {
      if (paletteFor || naming || varPick || varMaking) {
        paletteFor = null;
        naming = null;
        varPick = null;
        varMaking = false;
        refresh();
      }
    });
    var head = el("div", "ep-head");
    var tabs = el("div", "ep-tabs");
    tabs.setAttribute("role", "tablist");
    var slider = el("div", "ep-tab-slider");
    tabs.appendChild(slider);
    var tabButtons = {};
    [["design", "Design"], ["layers", "Layers"], ["variables", "Variables"]].forEach(function (t) {
      var b = el("button", "ep-tab", t[1]);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.addEventListener("click", function (event) {
        event.stopPropagation();
        tab = t[0];
        refresh();
      });
      tabs.appendChild(b);
      tabButtons[t[0]] = b;
    });
    head.appendChild(tabs);
    var dock = iconButton("toLeft", "Dock on the other side", function () {
      if (host.panel && host.panel.toggleSide) host.panel.toggleSide();
      refresh();
    });
    head.appendChild(dock);
    root.appendChild(head);
    var search = el("div", "ep-search");
    search.innerHTML = icon("search", 13);
    var query = el("input", "ep-text");
    query.placeholder = "Find a layer";
    query.setAttribute("aria-label", "Find a layer");
    query.addEventListener("input", function () {
      layerQuery = query.value;
      renderPanel();
    });
    search.appendChild(query);
    root.appendChild(search);
    var body = el("div", "ep-body");
    root.appendChild(body);
    slot.appendChild(root);
    return { root: root, tabs: tabs, tabButtons: tabButtons, dock: dock, search: search, body: body };
  }

  function renderPanel() {
    var p = ui.panel;
    if (!p) return;
    p.root.hidden = !owns();
    if (!owns()) return;
    // A field being typed in is not torn down under the typing.
    var focused = p.root.getRootNode && p.root.getRootNode().activeElement;
    if (focused && focused.hasAttribute && focused.hasAttribute("data-ep-keep") && p.body.contains(focused)) return;
    var scroll = p.body.scrollTop;
    p.tabs.setAttribute("data-at", tab === "variables" ? "2" : tab === "layers" ? "1" : "0");
    for (var name in p.tabButtons) {
      if (name === tab) p.tabButtons[name].setAttribute("data-on", "");
      else p.tabButtons[name].removeAttribute("data-on");
      p.tabButtons[name].setAttribute("aria-selected", name === tab ? "true" : "false");
    }
    var side = host.panel && host.panel.side ? host.panel.side() : "right";
    p.dock.innerHTML = icon(side === "right" ? "toLeft" : "toRight");
    p.dock.title = side === "right" ? "Dock on the left" : "Dock on the right";
    p.search.hidden = tab !== "layers";
    p.body.textContent = "";
    if (tab === "layers") {
      p.body.appendChild(layersBody());
      p.body.scrollTop = scroll;
      return;
    }
    if (tab === "variables") {
      p.body.appendChild(variablesBody());
      p.body.scrollTop = scroll;
      return;
    }
    var list = targets();
    var top = el("div", "ep-top");
    if (list.length > 1) top.appendChild(el("div", "ep-many", list.length + " layers selected"));
    else if (list.length === 1) {
      var why = styleWhyNot(list[0]) || (whyNot(list[0]) ? generatedHint(list[0]) : scriptChanges(list[0]) ? hint(list[0]) : "");
      var title = el("div", "ep-title");
      title.appendChild(node("span", "ep-kind", icon(layerIcon(list[0]), 14)));
      title.appendChild(el("span", null, layerName(list[0])));
      top.appendChild(title);
      if (why) top.appendChild(el("p", "ep-why", why));
    }
    if (list.length && (narrow || respondsToWidth()) && !forced) {
      top.appendChild(row("Applies to", seg(
        [["all", "All sizes", "Change it at every window width"], ["narrow", "Up to " + window.innerWidth + "px", "Change it at this width and narrower only (@media max-width)"]],
        narrow ? "narrow" : "all",
        function (v) {
          narrow = v === "narrow";
          refresh();
        },
        "Which window widths a change applies to",
      )));
    }
    var q = askNode("top");
    if (q) top.appendChild(q);
    if (top.children.length) p.body.appendChild(top);
    if (!list.length) {
      pageSections().forEach(function (s) {
        p.body.appendChild(s);
      });
      p.body.scrollTop = scroll;
      return;
    }
    if (list.every(styleWhyNot)) {
      p.body.scrollTop = scroll;
      return;
    }
    [positionSection, autoLayoutSection, sizingSection, appearanceSection, textSection, fillSection, strokeSection, effectsSection, stateSection, attributesSection, codeSection].forEach(function (make) {
      var s = make();
      if (s) p.body.appendChild(s);
    });
    p.body.scrollTop = scroll;
  }
`;
