/**
 * Edit mode's Figma-style tools, as they run in the browser: spliced into
 * `EDIT_SCRIPT`'s closure after colour and layout.
 *
 * Kept as raw strings for the same reason as those two: they are full of
 * regular expressions, and a template literal would want every backslash
 * doubled. Nothing here may contain a backtick or a dollar sign followed by
 * a brace.
 *
 * What is here: the selection of many layers, edits that change many layers
 * as one undo step, framing and ungrouping, inserting, copying and pasting
 * layers and properties, measuring, hover and pressed states, and previewing
 * the page at a device's width.
 */
export const EDIT_TOOLS = String.raw`
  /* --- many layers ------------------------------------------------------ */

  /* Every selected layer, the primary one last. */
  function targets() {
    var out = selection.filter(function (n) {
      return n && n.isConnected;
    });
    if (selected && out.indexOf(selected) === -1) out.push(selected);
    return out;
  }

  /* Adds a layer to the selection, or takes it out: shift-click. */
  function toggleSelect(node) {
    if (!node) return;
    claim();
    var list = targets();
    var at = list.indexOf(node);
    if (at === -1) {
      list.push(node);
      selection = list;
      selected = node;
    } else {
      list.splice(at, 1);
      selection = list;
      selected = list.length ? list[list.length - 1] : null;
    }
    armed = null;
    ask = null;
    clearState();
    message = "";
    refresh();
  }

  function selectMany(list) {
    list = list.filter(function (n) {
      return n && n.isConnected;
    });
    if (!list.length) return;
    claim();
    selection = list;
    selected = list[list.length - 1];
    context = selected.parentElement;
    if (isRoot(context)) context = null;
    armed = null;
    ask = null;
    clearState();
    message = list.length > 1 ? "Selected " + list.length + " layers." : "";
    refresh();
  }

  /* Document order, which is the order the file has them in. */
  function inOrder(list) {
    return list.slice().sort(function (a, b) {
      return a === b ? 0 : a.compareDocumentPosition(b) & 4 ? -1 : 1;
    });
  }

  /* --- one gesture, many edits ----------------------------------------- */

  var groupSeq = 0;

  /*
   * Runs steps one after another as a single undo step. Each step is
   * function (next, stop) and starts one edit; next() is called when it is
   * done, stop() when it failed. The server is told they belong together, so
   * an undo after a reload takes them back as one as well.
   */
  function runGroup(steps, what, done) {
    steps = steps.filter(Boolean);
    if (!steps.length) {
      if (done) done();
      return;
    }
    group = { id: "g" + Date.now().toString(36) + (++groupSeq), parts: [], what: what };
    var i = 0;
    function finish() {
      var g = group;
      group = null;
      if (g && g.parts.length) {
        log.push({ what: g.what, parts: g.parts });
        redone = [];
      }
      refresh();
    }
    function next() {
      if (i >= steps.length) {
        finish();
        if (done) done();
        return;
      }
      steps[i++](next, finish);
    }
    next();
  }

  /*
   * Sets declarations on many layers without asking about each one: a rule
   * that styles only selected layers is changed once, anything else goes on
   * the layer itself. props is a list, or a function from a layer to one.
   */
  function styleMany(list, props, what, done) {
    var steps = [];
    var rules = [];
    var selectors = {};
    list.forEach(function (target) {
      if (styleWhyNot(target)) return;
      var own = typeof props === "function" ? props(target) : props;
      if (!own || !own.length) return;
      if (narrow || whyNot(target)) {
        var selector = stableSelector(target);
        if (!selector || selectors[selector + "|" + JSON.stringify(own)]) return;
        selectors[selector + "|" + JSON.stringify(own)] = 1;
        steps.push(function (next, stop) {
          addRuleSel(selector, own, what, narrow ? widthQuery() : null, next, stop);
        });
        return;
      }
      var win = winning(target, own[0][0]);
      if (win && win.kind === "rule" && editableSheet(win.owner)) {
        var everyone = true;
        try {
          var all = document.querySelectorAll(win.rule.selectorText);
          for (var i = 0; i < all.length; i++) if (!ours(all[i]) && list.indexOf(all[i]) === -1) everyone = false;
        } catch (e) {
          everyone = false;
        }
        if (everyone) {
          if (rules.indexOf(win.rule) !== -1) return;
          rules.push(win.rule);
          steps.push(function (next, stop) {
            applyRuleProps(win, own, win.rule.selectorText, next, stop);
          });
          return;
        }
      }
      steps.push(function (next, stop) {
        applyInlineProps(target, own, what, next, stop);
      });
    });
    runGroup(steps, what + " on " + list.length + " layers", done);
  }

  /*
   * Where every style change from the panel goes: through the state being
   * edited, through the many-layer path, or through the one-layer path that
   * asks "this one or all of them".
   */
  function setStyles(props, what, done) {
    var list = targets();
    if (!list.length || busy) return;
    if (forced) return stateStyle(forced.target, typeof props === "function" ? props(forced.target) : props, what);
    if (list.length === 1) {
      var own = typeof props === "function" ? props(list[0]) : props;
      if (own && own.length) styleChange(list[0], own, what);
      return;
    }
    styleMany(list, props, what, done);
  }

  /* --- copying a layer somewhere else ---------------------------------- */

  /* A copy of el put before, after or inside target: paste, and Alt-drag. */
  function copyTo(el, target, place, then, fail) {
    if (!el || !target || whyNot(el) || whyNot(target)) {
      if (fail) fail();
      return;
    }
    var copy = null;
    act(
      { op: "copy", at: stampOf(el), target: stampOf(target), place: place },
      "paste of " + label(el),
      function (data) {
        if (!copy) {
          copy = el.cloneNode(true);
          restamp(copy, data.relocated || [], false);
        }
        remap(data.edits);
        if (place === "inside") target.appendChild(copy);
        else target.parentNode.insertBefore(copy, place === "before" ? target : target.nextSibling);
      },
      function (back) {
        copy.remove();
        remap(back.edits);
        if (selected === copy) selected = null;
      },
      function () {
        pasted.push(copy);
        if (then) then(copy);
      },
      fail,
    );
  }

  var clipboard = [];
  var pasted = [];

  function copyLayers() {
    var list = inOrder(targets()).filter(function (n) {
      return !whyNot(n);
    });
    if (!list.length) return;
    clipboard = list;
    message = "Copied " + (list.length > 1 ? list.length + " layers" : label(list[0])) + ". Paste with " + (MAC ? "⌘V" : "Ctrl+V") + ".";
    refresh();
  }

  /* Inside the selection when it is a frame that holds layers, else after it. */
  function holds(node) {
    if (!node || whyNot(node) || RAW[node.tagName]) return false;
    if (node.children.length) return !retypable(node);
    return !!CONTAINER[node.tagName];
  }

  function pasteLayers() {
    var live = clipboard.filter(function (n) {
      return n.isConnected && !whyNot(n);
    });
    if (!live.length) {
      message = "Nothing copied yet. Copy a layer with " + (MAC ? "⌘C" : "Ctrl+C") + ".";
      refresh();
      return;
    }
    var target = selected || live[live.length - 1];
    var inside = holds(target) && live.every(function (n) {
      return !n.contains(target);
    });
    pasted = [];
    var anchor = target;
    runGroup(
      live.map(function (n) {
        return function (next, stop) {
          copyTo(n, anchor, inside ? "inside" : "after", function (copy) {
            if (!inside) anchor = copy;
            next();
          }, stop);
        };
      }),
      "paste",
      function () {
        if (pasted.length) selectMany(pasted.slice());
      },
    );
  }

  /* --- framing and ungrouping ------------------------------------------ */

  /* Which way a run of layers already sits: side by side, or stacked. */
  function sideBySide(list) {
    if (list.length < 2) return false;
    var a = list[0].getBoundingClientRect();
    var b = list[1].getBoundingClientRect();
    return b.left >= a.right - 1 && Math.abs(b.top - a.top) < Math.max(a.height, b.height);
  }

  /*
   * Puts the selected layers in a new auto layout frame: Figma's Frame
   * selection. They must sit next to each other in one parent, because the
   * frame takes everything between the first and the last.
   */
  function frameSelection() {
    var list = inOrder(targets());
    if (!list.length || busy) return;
    var parent = list[0].parentNode;
    for (var i = 0; i < list.length; i++) {
      if (whyNot(list[i])) {
        message = whyNot(list[i]);
        refresh();
        return;
      }
      if (list[i].parentNode !== parent) {
        message = "Only layers in the same frame can be framed together.";
        refresh();
        return;
      }
    }
    var first = list[0];
    var last = list[list.length - 1];
    for (var n = first.nextElementSibling; n && n !== last; n = n.nextElementSibling) {
      if (list.indexOf(n) === -1 && stampOf(n) !== null) {
        message = "Select layers that sit next to each other: the frame takes everything between the first and the last.";
        refresh();
        return;
      }
    }
    var props = [["display", "flex"], ["flex-direction", sideBySide(list) ? "row" : "column"], ["gap", "8px"]];
    var wrapper = null;
    var nodes = null;
    act(
      { op: "wrap", at: stampOf(first), last: stampOf(last), props: props },
      "frame around " + list.length + " layer" + (list.length > 1 ? "s" : ""),
      function (data) {
        var parentNode = first.parentNode;
        var anchor = last.nextSibling;
        nodes = [];
        for (var x = first; x; x = x.nextSibling) {
          nodes.push(x);
          if (x === last) break;
        }
        nodes.forEach(function (node) {
          node.remove();
        });
        remap(data.edits);
        nodes.forEach(function (node) {
          if (node.nodeType === 1) restamp(node, data.relocated || [], false);
        });
        if (!wrapper) {
          wrapper = document.createElement("div");
          props.forEach(function (pair) {
            wrapper.style.setProperty(pair[0], pair[1]);
          });
        }
        wrapper.setAttribute(ATTR, String(data.created));
        nodes.forEach(function (node) {
          wrapper.appendChild(node);
        });
        quiet(function () {
          parentNode.insertBefore(wrapper, anchor);
        });
      },
      function (back) {
        var parentNode = wrapper.parentNode;
        var anchor = wrapper.nextSibling;
        wrapper.remove();
        remap(back.edits);
        nodes.forEach(function (node) {
          if (node.nodeType === 1) restamp(node, back.relocated || [], true);
          parentNode.insertBefore(node, anchor);
        });
        if (selected === wrapper) selected = null;
      },
      function () {
        selectMany([wrapper]);
        message = "Framed " + list.length + " layer" + (list.length > 1 ? "s" : "") + " in auto layout.";
      },
    );
  }

  /* Takes a frame away and keeps what was in it: Figma's Ungroup. */
  function ungroup() {
    var node = selected;
    if (!node || busy || whyNot(node)) return;
    if (!node.children.length) {
      message = "There is nothing inside this layer to keep.";
      refresh();
      return;
    }
    var kids = null;
    var parentNode = null;
    var anchor = null;
    act(
      { op: "unwrap", at: stampOf(node) },
      "ungroup of " + label(node),
      function (data) {
        parentNode = node.parentNode;
        anchor = node.nextSibling;
        kids = Array.prototype.slice.call(node.childNodes);
        node.remove();
        remap(data.edits);
        kids.forEach(function (kid) {
          if (kid.nodeType === 1) restamp(kid, data.relocated || [], false);
          parentNode.insertBefore(kid, anchor);
        });
      },
      function (back) {
        kids.forEach(function (kid) {
          kid.remove();
        });
        remap(back.edits);
        kids.forEach(function (kid) {
          if (kid.nodeType === 1) restamp(kid, back.relocated || [], true);
          node.appendChild(kid);
        });
        parentNode.insertBefore(node, anchor);
      },
      function () {
        selectMany(kids.filter(function (kid) {
          return kid.nodeType === 1;
        }));
        message = "Ungrouped " + label(node) + ".";
      },
    );
  }

  /*
   * Shift+A: auto layout on a frame that has layers in it; around the
   * selection when it is several layers, or one that holds nothing.
   */
  function addAutoLayout() {
    var list = targets();
    if (!list.length) return;
    if (list.length > 1 || !list[0].children.length) return frameSelection();
    var kids = Array.prototype.filter.call(list[0].children, function (k) {
      return !ours(k);
    });
    setStyles([["display", "flex"], ["flex-direction", sideBySide(kids) ? "row" : "column"], ["gap", "8px"]], "auto layout");
  }

  /* --- inserting ------------------------------------------------------- */

  var INSERTS = {
    frame: { label: "Frame", what: "frame" },
    rect: { label: "Rectangle", what: "rectangle" },
    text: { label: "Text", what: "text" },
    image: { label: "Image", what: "image" },
  };

  /* The element the server writes, made the same way here. */
  function insertNode(kind, src) {
    var made;
    if (kind === "text") {
      made = document.createElement("p");
      made.textContent = "Text";
      return made;
    }
    if (kind === "image") {
      made = document.createElement("img");
      made.setAttribute("src", src);
      made.setAttribute("alt", "");
      made.style.width = "240px";
      made.style.height = "auto";
      return made;
    }
    made = document.createElement("div");
    var props = kind === "frame"
      ? [["display", "flex"], ["flex-direction", "column"], ["gap", "8px"], ["padding", "16px"], ["min-height", "80px"], ["background-color", "#ffffff"]]
      : [["width", "100px"], ["height", "100px"], ["background-color", "#d9d9d9"]];
    props.forEach(function (pair) {
      made.style.setProperty(pair[0], pair[1]);
    });
    return made;
  }

  function insert(kind, src) {
    if (busy || unavailable || stale) return;
    var target = selected && !whyNot(selected) ? selected : null;
    var place = target ? (holds(target) ? "inside" : "after") : "inside";
    var made = insertNode(kind, src);
    var body = { op: "insert", at: target ? stampOf(target) : null, place: place, kind: kind };
    if (src) body.src = src;
    act(
      body,
      "new " + INSERTS[kind].what,
      function (data) {
        remap(data.edits);
        made.setAttribute(ATTR, String(data.created));
        quiet(function () {
          if (!target) document.body.appendChild(made);
          else if (place === "inside") target.appendChild(made);
          else target.parentNode.insertBefore(made, target.nextSibling);
        });
      },
      function (back) {
        made.remove();
        remap(back.edits);
        if (selected === made) selected = null;
      },
      function () {
        selectMany([made]);
        message = "Added a " + INSERTS[kind].what + (target ? (place === "inside" ? " inside " : " after ") + label(target) : " at the end of the page") + ".";
        if (kind === "text") startText();
      },
    );
  }

  var images = null;

  /* The images in the page's folder, asked for once. */
  function loadImages(done) {
    if (images) return done(images);
    fetch("/api/images?page=" + encodeURIComponent(PAGE), { credentials: "same-origin" })
      .then(function (r) {
        return r.ok ? r.json() : { images: [] };
      })
      .then(function (data) {
        images = (data && data.images) || [];
        done(images);
      })
      .catch(function () {
        done([]);
      });
  }

  /* --- properties ------------------------------------------------------ */

  /* What Copy properties carries: the look, not the size or the place. */
  var LOOK = [
    "background-color", "background-image", "color", "opacity", "mix-blend-mode",
    "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
    "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "box-shadow", "filter", "backdrop-filter",
    "font-family", "font-size", "font-weight", "line-height", "letter-spacing",
    "text-align", "text-transform", "text-decoration-line",
  ];

  /* The same test the server applies, so nothing is sent that it would refuse. */
  function writable(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 400 &&
      /^[#\w\s(),.%/+*'"-]+$/.test(value) && !/\b(url|image-set|expression)\s*\(/i.test(value) &&
      (value.split('"').length - 1) % 2 === 0 && (value.split("'").length - 1) % 2 === 0;
  }

  var copiedLook = null;

  function copyProperties() {
    if (!selected) return;
    var cs = window.getComputedStyle(selected);
    copiedLook = { from: label(selected), values: {} };
    // No border, no border colour: it would only be the text colour again.
    var bordered = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none";
    LOOK.forEach(function (prop) {
      if (!bordered && /^border-(top|right|bottom|left)-(color|style|width)$/.test(prop)) return;
      // The file's own words where it has them, so a token stays a token.
      var declaredValue = declared(selected, prop);
      var value = declaredValue && writable(declaredValue) ? declaredValue : cs.getPropertyValue(prop).trim();
      if (writable(value)) copiedLook.values[prop] = { value: value, computed: cs.getPropertyValue(prop).trim() };
    });
    message = "Copied the look of " + copiedLook.from + ". Paste it with " + (MAC ? "⌥⌘V" : "Ctrl+Alt+V") + ".";
    refresh();
  }

  function pasteProperties() {
    if (!copiedLook) {
      message = "Copy a layer's properties first (" + (MAC ? "⌥⌘C" : "Ctrl+Alt+C") + ").";
      refresh();
      return;
    }
    var look = copiedLook.values;
    var list = targets();
    if (!list.length) return;
    // Only what differs, so nothing is written that would change nothing.
    styleMany(list, function (target) {
      var cs = window.getComputedStyle(target);
      return Object.keys(look)
        .filter(function (prop) {
          return cs.getPropertyValue(prop).trim() !== look[prop].computed;
        })
        .map(function (prop) {
          return [prop, look[prop].value];
        })
        .slice(0, 32);
    }, "pasted properties");
  }

  function selectMatching() {
    if (!selected) return;
    var classes = Array.prototype.filter.call(selected.classList, function (c) {
      return ident(c) && !STATE_CLASS.test(c);
    });
    var selector = selected.tagName.toLowerCase() + (classes.length ? "." + classes.join(".") : "");
    var found = [];
    try {
      var all = document.querySelectorAll(selector);
      for (var i = 0; i < all.length; i++) if (!ours(all[i])) found.push(all[i]);
    } catch (e) {}
    selectMany(found);
    message = "Selected " + found.length + " layer" + (found.length === 1 ? "" : "s") + " like " + selector + ".";
    refresh();
  }

  /* All the layers beside the selection: Cmd+A. */
  function selectAll() {
    var parentNode = selected ? selected.parentElement : context || document.body;
    if (!parentNode) return;
    selectMany(Array.prototype.filter.call(parentNode.children, function (n) {
      return !ours(n) && !RAW[n.tagName] && n.tagName !== "SCRIPT" && n.tagName !== "STYLE" && n.tagName !== "LINK";
    }));
  }

  function hideOrShow() {
    var list = targets();
    if (!list.length) return;
    if (list.length === 1 && list[0].style.display !== "none") return hide();
    var hidden = list.every(function (n) {
      return n.style.display === "none";
    });
    runGroup(
      list.map(function (n) {
        return function (next, stop) {
          if (whyNot(n)) return next();
          applyInlineProps(n, [["display", hidden ? "" : "none"]], hidden ? "show" : "hide", next, stop);
        };
      }),
      hidden ? "show" : "hide",
    );
  }

  function many(fn, what) {
    return function () {
      var list = targets();
      if (list.length < 2) return fn();
      runGroup(
        inOrder(list).map(function (n) {
          return function (next, stop) {
            selected = n;
            fn(next, stop);
          };
        }),
        what,
      );
    };
  }

  /* --- the eyedropper -------------------------------------------------- */

  function canEyedrop() {
    return typeof hostWin.EyeDropper === "function";
  }

  /* Picks a colour from anywhere on screen for prop (the fill, by default). */
  function eyedrop(prop) {
    if (!canEyedrop() || !selected) {
      message = canEyedrop() ? "Select a layer first." : "This browser has no eyedropper.";
      refresh();
      return;
    }
    var slot = prop || (retypable(selected) && transparent(window.getComputedStyle(selected).backgroundColor) ? "color" : "background-color");
    new hostWin.EyeDropper()
      .open()
      .then(function (result) {
        if (result && result.sRGBHex) setStyles([[slot, result.sRGBHex]], slot === "color" ? "text colour" : "fill");
      })
      .catch(function () {});
  }

  /* --- measuring ------------------------------------------------------- */

  var measuring = false;

  /* Red lines between the selection and the layer under the pointer, while Alt is held. */
  function drawMeasure() {
    var box = ui.measure;
    box.textContent = "";
    if (!measuring || !selected || !hovered || hovered === selected || dragging) return;
    var a = selected.getBoundingClientRect();
    var b = hovered.getBoundingClientRect();
    var lines = [];
    function line(x1, y1, x2, y2) {
      var length = Math.round(Math.abs(x2 - x1) + Math.abs(y2 - y1));
      if (length > 0) lines.push({ x1: x1, y1: y1, x2: x2, y2: y2, n: length });
    }
    var inner = hovered.contains(selected) ? { o: b, i: a } : selected.contains(hovered) ? { o: a, i: b } : null;
    if (inner) {
      var o = inner.o;
      var i = inner.i;
      var midY = i.top + i.height / 2;
      var midX = i.left + i.width / 2;
      line(o.left, midY, i.left, midY);
      line(i.right, midY, o.right, midY);
      line(midX, o.top, midX, i.top);
      line(midX, i.bottom, midX, o.bottom);
    } else {
      var y = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
      if (Math.max(a.top, b.top) > Math.min(a.bottom, b.bottom)) y = a.top + a.height / 2;
      var x = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2;
      if (Math.max(a.left, b.left) > Math.min(a.right, b.right)) x = a.left + a.width / 2;
      if (b.left >= a.right) line(a.right, y, b.left, y);
      else if (a.left >= b.right) line(b.right, y, a.left, y);
      if (b.top >= a.bottom) line(x, a.bottom, x, b.top);
      else if (a.top >= b.bottom) line(x, b.bottom, x, a.top);
    }
    lines.forEach(function (l) {
      var from = toHost({ left: Math.min(l.x1, l.x2), top: Math.min(l.y1, l.y2), width: Math.abs(l.x2 - l.x1), height: Math.abs(l.y2 - l.y1) });
      var bar = el("div", "ed-measure-line");
      bar.style.left = from.left + "px";
      bar.style.top = from.top + "px";
      bar.style.width = Math.max(1, from.width) + "px";
      bar.style.height = Math.max(1, from.height) + "px";
      var tag = el("span", "ed-measure-tag", String(l.n));
      bar.appendChild(tag);
      box.appendChild(bar);
    });
  }

  /* --- nudging a positioned layer -------------------------------------- */

  var nudgeTimer = null;
  var nudgeStart = null;

  /* Arrow keys move a positioned layer by a pixel, or ten with Shift; written once they stop. */
  function nudgeFree(dx, dy) {
    var target = selected;
    if (!target || styleWhyNot(target)) return;
    if (!nudgeStart) nudgeStart = { target: target, before: target.getAttribute("style"), dx: 0, dy: 0, spot: freePlace(target, 0, 0) };
    nudgeStart.dx += dx;
    nudgeStart.dy += dy;
    var spot = nudgeStart.spot;
    quiet(function () {
      target.style.setProperty("translate", nudgeStart.dx + "px " + nudgeStart.dy + "px");
    });
    ui.status.textContent = "left " + (spot.left + nudgeStart.dx) + ", top " + (spot.top + nudgeStart.dy);
    draw();
    if (nudgeTimer) clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(function () {
      nudgeTimer = null;
      var n = nudgeStart;
      nudgeStart = null;
      // Measured with the preview offset off, or it would count twice.
      quiet(function () {
        if (n.before === null) n.target.removeAttribute("style");
        else n.target.setAttribute("style", n.before);
      });
      var at = freePlace(n.target, 0, 0);
      styleChange(n.target, [["left", at.left + n.dx + "px"], ["top", at.top + n.dy + "px"]], "position");
    }, 450);
  }

  /* --- hover, pressed and focus ---------------------------------------- */

  var STATES = {
    hover: { label: "Hover", pseudo: [":hover"] },
    active: { label: "Pressed", pseudo: [":active"] },
    focus: { label: "Focus", pseudo: [":focus-visible", ":focus"] },
  };
  /* The state being shown and edited: { state, target, sheet }, or null. */
  var forced = null;

  function forcedSelector(selector, state) {
    var out = selector;
    STATES[state].pseudo.forEach(function (p) {
      out = out.split(p).join("[data-osp-force~=" + state + "]");
    });
    return out;
  }

  /*
   * A page cannot be made to hover from script, so the state is shown by
   * copying every rule that names it into a sheet of ours, with the
   * pseudo-class swapped for an attribute put on the layer.
   */
  function buildForced() {
    if (!forced) return;
    var css = [];
    walkRules(function (rule, path, owner, on) {
      if (!on || owner === forced.sheet) return;
      var parts = selectorParts(rule.selectorText).filter(function (part) {
        return STATES[forced.state].pseudo.some(function (p) {
          return part.indexOf(p) !== -1;
        });
      });
      if (!parts.length) return;
      css.push(parts.map(function (part) {
        return forcedSelector(part, forced.state);
      }).join(",") + "{" + rule.style.cssText + "}");
    });
    quiet(function () {
      forced.sheet.textContent = css.join("\n");
    });
  }

  function showState(state) {
    clearState();
    var target = selected;
    if (!target || state === "default" || !STATES[state]) return refresh();
    var sheet = document.createElement("style");
    sheet.setAttribute("data-osp-added", "");
    quiet(function () {
      document.head.appendChild(sheet);
      target.setAttribute("data-osp-force", state);
    });
    forced = { state: state, target: target, sheet: sheet };
    buildForced();
    refresh();
  }

  function clearState() {
    if (!forced) return;
    var f = forced;
    forced = null;
    quiet(function () {
      f.sheet.remove();
      f.target.removeAttribute("data-osp-force");
    });
  }

  /* The file's rule for this layer in this state, if it has one it can write. */
  function stateRule(target, state) {
    var best = null;
    walkRules(function (rule, path, owner, on, order) {
      if (!on || !editableSheet(owner)) return;
      selectorParts(rule.selectorText).forEach(function (part) {
        if (!STATES[state].pseudo.some(function (p) { return part.indexOf(p) !== -1; })) return;
        var spec = -1;
        try {
          if (target.matches(forcedSelector(part, state))) spec = specificity(part.trim());
        } catch (e) {}
        if (spec < 0) return;
        var found = { kind: "rule", rule: rule, path: path, owner: owner, spec: spec, important: 0, order: order };
        if (better(found, best)) best = found;
      });
    });
    return best;
  }

  /* Writes a change for the state on show: into its rule, or a new one. */
  function stateStyle(target, props, what) {
    var state = forced.state;
    var rule = stateRule(target, state);
    var after = function () {
      buildForced();
      message = "Changed the " + STATES[state].label.toLowerCase() + " state's " + what + ".";
      refresh();
    };
    if (rule) return applyRuleProps(rule, props, rule.rule.selectorText, after);
    var base = stableSelector(target);
    if (!base) {
      message = "Nothing names this layer well enough to give it a " + STATES[state].label.toLowerCase() + " state.";
      refresh();
      return;
    }
    addRuleSel(base + STATES[state].pseudo[STATES[state].pseudo.length - 1], props, what, null, after);
  }

  /* --- previewing at a device's width ---------------------------------- */

  var DEVICES = [
    ["full", "Full", 0],
    ["tablet", "Tablet", 768],
    ["phone", "Phone", 390],
  ];
  var device = null;

  /*
   * The page at a device's width, in a frame over it. The frame's copy of
   * this script joins Edit mode the way a phone frame's screen does, so the
   * page can be edited at that width; and since it edits the same file, this
   * page reloads when the frame is closed.
   */
  function showDevice(name) {
    var spec = null;
    DEVICES.forEach(function (d) {
      if (d[0] === name) spec = d;
    });
    if (device) {
      var was = device;
      device = null;
      was.box.remove();
      if (self.shared.deviceEdited) {
        message = "Reloading with the edits made at " + was.width + "px…";
        refresh();
        reloadSoon();
        return;
      }
    }
    if (!spec || !spec[2]) return refresh();
    var box = el("div", "ed-device");
    var frameBox = el("div", "ed-device-frame");
    var head = el("div", "ed-device-head", spec[1] + " · " + spec[2] + "px");
    var close = el("button", "ed-device-close", "Close");
    close.type = "button";
    close.addEventListener("click", function () {
      showDevice("full");
    });
    head.appendChild(close);
    var iframe = document.createElement("iframe");
    iframe.setAttribute("data-osp-device", "");
    iframe.style.width = spec[2] + "px";
    iframe.src = location.href;
    frameBox.appendChild(head);
    frameBox.appendChild(iframe);
    box.appendChild(frameBox);
    host.wrap.appendChild(box);
    device = { name: name, width: spec[2], box: box };
    hovered = null;
    select(null);
  }
`;
