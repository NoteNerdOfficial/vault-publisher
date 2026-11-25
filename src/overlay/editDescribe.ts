/**
 * Edit mode's Describe: say what should change, point at the layers it is
 * about, and hand the lot to an AI coding tool, as it runs in the browser.
 * Spliced into `EDIT_SCRIPT`'s closure after the panel.
 *
 * "/" turns the bar's message line into a prompt about the selected layer.
 * While it is open, a click on the page puts that layer into the line as a
 * numbered reference instead of selecting it. Enter adds the change to a
 * stack above the bar; a click on a change loads it back to edit. The stack
 * flips to show exactly what Copy for AI puts on the clipboard, and the
 * request can be saved as a note in the vault instead.
 *
 * The code behind each layer is gathered the way the Code section gathers
 * it: the file and line, the HTML as the file has it, the rules that win.
 * Nothing here writes to the page's files.
 *
 * Raw string, like the other chunks: no backtick, and no dollar sign
 * followed by a brace.
 */
export const EDIT_DESCRIBE = String.raw`
  /* --- describing a change --------------------------------------------- */

  /* The line being written in the bar, or null: its subject, its parts, and which change it edits. */
  var describing = null;
  /* The changes so far: { subject, parts }, parts being words and { ref } layers. */
  var described = [];
  /* The stack shows the changes, or what would be copied. */
  var stackView = "changes";

  function openDescribe() {
    if (!selected || !ui) return;
    if (assetsOpen) closeAssets();
    if (placing) stopPlacing();
    if (editing) commitText();
    describing = { subject: selected, parts: [], editing: null };
    renderDescribe(true);
    refresh();
  }

  function closeDescribe() {
    if (!describing) return;
    describing = null;
    renderDescribe(false);
    refresh();
  }

  /* A change back in the bar, to edit. */
  function editChange(i) {
    var c = described[i];
    if (!c || !c.subject.isConnected) return;
    select(c.subject);
    describing = { subject: c.subject, parts: c.parts.slice(), editing: i };
    stackView = "changes";
    renderDescribe(true);
    refresh();
  }

  /* Every layer the request points at, numbered once, in order of mention. */
  function describedLayers() {
    var list = described.slice();
    if (describing) {
      var draft = { subject: describing.subject, parts: describing.parts };
      if (describing.editing !== null) list[describing.editing] = draft;
      else list.push(draft);
    }
    var out = [];
    list.forEach(function (c) {
      if (out.indexOf(c.subject) === -1) out.push(c.subject);
      c.parts.forEach(function (p) {
        if (typeof p !== "string" && out.indexOf(p.ref) === -1) out.push(p.ref);
      });
    });
    return out;
  }

  function describedNumber(n) {
    return describedLayers().indexOf(n) + 1;
  }

  /* Whether a layer is in the request, so news about it redraws the stack. */
  function describeUses(n) {
    return describedLayers().indexOf(n) !== -1;
  }

  function partsText(parts) {
    return parts.map(function (p) {
      return typeof p === "string" ? p : "[" + describedNumber(p.ref) + "]";
    }).join("").replace(/\u00a0/g, " ").replace(/[ \t]{2,}/g, " ").trim();
  }

  function layerWords(n) {
    var t = (n.innerText || n.textContent || n.getAttribute("placeholder") || n.getAttribute("alt") || "").replace(/\s+/g, " ").trim();
    return t.length > 40 ? t.slice(0, 40) + "…" : t;
  }

  /* A numbered chip for a layer; hovering it outlines the layer. */
  function layerChip(n) {
    var chip = el("span", "ed-chip");
    chip.appendChild(el("b", null, String(describedNumber(n))));
    chip.appendChild(document.createTextNode(label(n)));
    chip.title = layerWords(n) || label(n);
    chip.addEventListener("mouseenter", function () {
      hovered = n;
      self.shared.hover = self;
      draw();
    });
    return chip;
  }

  /* --- the prompt in the bar -------------------------------------------- */

  function renderDescribe(focus) {
    var box = ui.describe;
    box.textContent = "";
    box.hidden = !describing;
    if (!describing) return;
    if (describing.editing !== null) {
      box.appendChild(el("div", "ed-describe-note", "Editing change " + (describing.editing + 1) + ". Click layers to point at them."));
    }
    // One flowing line: the slash, the subject and the words wrap together,
    // back to the left edge, with the keys floated at the right of the first.
    var line = el("div", "ed-describe");
    line.appendChild(el("kbd", "ed-describe-keys", describing.editing !== null ? "Enter saves · Esc keeps it" : "Enter adds · Esc"));
    line.appendChild(el("span", "ed-describe-slash", "/"));
    var subject = el("span", "ed-describe-subject");
    subject.appendChild(layerChip(describing.subject));
    line.appendChild(subject);
    var ed = el("div", "ed-describe-input");
    ed.contentEditable = "true";
    ed.setAttribute("role", "textbox");
    ed.setAttribute("aria-label", "What should change in " + label(describing.subject) + "? Click layers on the page to point at them.");
    ed.setAttribute("data-placeholder", "What should change here? Click other layers to point at them");
    describing.parts.forEach(function (p, i) {
      if (typeof p === "string") ed.appendChild(document.createTextNode(p));
      else {
        var chip = layerChip(p.ref);
        chip.contentEditable = "false";
        chip.setAttribute("data-at", String(i));
        ed.appendChild(chip);
      }
    });
    ed.addEventListener("input", function () {
      readDescribe(ed);
      if (stackView === "copied") renderStack();
    });
    ed.addEventListener("keydown", function (event) {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        closeDescribe();
        return;
      }
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      readDescribe(ed);
      keepLine();
      if (event.metaKey || event.ctrlKey) {
        closeDescribe();
        copyRequest();
        return;
      }
      renderDescribe(!!describing);
      refresh();
    });
    line.appendChild(ed);
    // The words are inline, so a click anywhere in the box puts the caret at their end.
    line.addEventListener("mousedown", function (event) {
      if (event.target !== line && !event.target.classList.contains("ed-describe-slash")) return;
      event.preventDefault();
      caretToEnd(ed);
    });
    box.appendChild(line);
    if (focus) caretToEnd(ed);
  }

  function caretToEnd(ed) {
    ed.focus();
    try {
      var range = document.createRange();
      range.selectNodeContents(ed);
      range.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
  }

  /* The editor's words and chips back into parts. */
  function readDescribe(ed) {
    var parts = [];
    Array.prototype.forEach.call(ed.childNodes, function (n) {
      if (n.nodeType === 3) parts.push(n.nodeValue);
      else if (n.getAttribute && n.getAttribute("data-at") !== null) parts.push(describing.parts[+n.getAttribute("data-at")]);
      else parts.push(n.textContent || "");
    });
    describing.parts = parts.filter(function (p) {
      return p !== undefined;
    });
  }

  /* The line becomes a change, or replaces the one it edits; an emptied one is taken out. */
  function keepLine() {
    var made = { subject: describing.subject, parts: describing.parts };
    var said = partsText(made.parts);
    if (describing.editing !== null) {
      if (said) described[describing.editing] = made;
      else described.splice(describing.editing, 1);
      message = said ? "Saved change " + (describing.editing + 1) + "." : "Took the change out.";
      // Editing done, the prompt closes: that change was the point of it.
      describing = null;
      return;
    }
    if (said) {
      described.push(made);
      message = "Added change " + described.length + ". Write another, or select another layer and press /.";
    }
    describing.parts = [];
  }

  /* While the prompt is open, a click on the page points at a layer. True when it took the event. */
  function describePointer(event) {
    if (!describing) return false;
    if (event.type === "pointermove" || event.type === "mousemove") return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== "click") return true;
    // The layer under the pointer, as the hover outline shows it: what you
    // point at, not the frame round it that a first click would select.
    var n = candidate(event.target, true);
    if (!n || n === describing.subject) return true;
    var ed = ui.describe.querySelector(".ed-describe-input");
    if (ed) readDescribe(ed);
    var last = describing.parts[describing.parts.length - 1];
    if (typeof last === "string" && last && !/\s$/.test(last)) describing.parts.push(" ");
    describing.parts.push({ ref: n });
    describing.parts.push("\u00a0");
    renderDescribe(true);
    refresh();
    return true;
  }

  /* --- the request, as text --------------------------------------------- */

  /* Where a layer's code is, waiting for the server once if it has not said yet. */
  function whereReady(n) {
    return new Promise(function (resolve) {
      var tries = 0;
      (function poll() {
        var w = n.isConnected ? whereOf(n, rulesFor(n)) : null;
        if (w || !n.isConnected || tries++ > 40) return resolve(w);
        setTimeout(poll, 50);
      })();
    });
  }

  /* One layer's context: where it is, its HTML, the CSS that wins first. */
  function layerContext(number, n) {
    if (!n.isConnected) return number + ". " + label(n) + ": no longer on the page.";
    var rules = rulesFor(n);
    var where = whereOf(n, rules);
    var layer = where && where.layer;
    // A rule for every element on the page says nothing about this one.
    var telling = rules.filter(function (r) {
      return r.rule.selectorText.trim() !== "*";
    });
    var head = number + ". " + label(n) + (layerWords(n) ? " “" + layerWords(n) + "”" : "");
    if (layer) head += " at " + layer.file + ":" + layer.line;
    else if (stampOf(n) === null) {
      var spots = where && where.script;
      head += ", made by the page's script" + (spots && spots.length
        ? ", probably at " + spots.map(function (s) { return s.file + ":" + s.line; }).join(" or ")
        : "");
    }
    var html = layer && layer.html ? layer.html : cleanMarkup(n);
    if (html.length > 3000) html = html.slice(0, 3000) + "\n<!-- … -->";
    var out = [head, FENCE + "html", html, FENCE];
    if (telling.length) {
      out.push("CSS that applies, the rule that wins first:", FENCE + "css", telling.map(function (r) {
        var spot = where && where.rules ? where.rules[rules.indexOf(r)] : null;
        return (spot ? "/* " + spot.file + ":" + spot.line + " */\n" : "") + r.text;
      }).join("\n\n"), FENCE);
    }
    return out.join("\n");
  }

  /* What the page was seen as: its width, and a state shown on a layer. */
  function seenAs() {
    var width = device ? device.name + " width, " + device.width + "px" : "full width, " + window.innerWidth + "px";
    return width + (forced ? ", with " + label(forced.target) + " shown as :" + forced.state : "");
  }

  /* The prompt: the changes in order, then each layer's code by number. */
  function requestText() {
    if (!described.length) return "";
    var layers = [];
    described.forEach(function (c) {
      [c.subject].concat(c.parts.filter(function (p) { return typeof p !== "string"; }).map(function (p) { return p.ref; }))
        .forEach(function (n) {
          if (layers.indexOf(n) === -1) layers.push(n);
        });
    });
    var file = null;
    layers.some(function (n) {
      var w = n.isConnected ? whereOf(n, rulesFor(n)) : null;
      file = w && w.layer ? w.layer.file : null;
      return !!file;
    });
    return [
      "Change this prototype: " + (file || PAGE) + " (seen at " + seenAs() + ").",
      "",
      described.map(function (c, i) {
        return (i + 1) + ". In [" + describedNumber(c.subject) + "] " + label(c.subject) + ": " + partsText(c.parts);
      }).join("\n"),
      "",
      "The layers, by number:",
      "",
      layers.map(function (n) {
        return layerContext(describedNumber(n), n);
      }).join("\n\n"),
    ].join("\n");
  }

  /* Waits for every layer's code, then hands over the text. */
  function readyRequest() {
    return Promise.all(describedLayers().map(whereReady)).then(requestText);
  }

  /*
   * What the stack's footer reports about the last Copy or Save: in the
   * footer, because the bar's message line is the prompt while Describe is
   * open. The button says it for a moment; the words stay until the
   * request changes. key ties it to the request it was about.
   */
  var stackNote = null;
  /* The last note saved: { text, path, open }, so the same request is not saved twice. */
  var lastSaved = null;

  function describedKey() {
    return described.map(function (d) {
      return (d.subject ? label(d.subject) : "") + ":" + partsText(d.parts);
    }).join("|");
  }

  function noteStack(note) {
    stackNote = note;
    clearTimeout(noteStack.timer);
    if (note.flash) {
      noteStack.timer = setTimeout(function () {
        if (stackNote === note) {
          note.flash = false;
          renderStack();
        }
      }, 2400);
    }
    renderStack();
  }

  function copyRequest() {
    if (!described.length) return;
    var key = describedKey();
    var n = described.length;
    readyRequest().then(function (text) {
      return hostWin.navigator.clipboard.writeText(text).then(function () {
        message = "Copied " + n + " change" + (n === 1 ? "" : "s") + " for an AI tool.";
        noteStack({ kind: "copied", key: key, flash: true, words: "Copied " + n + " change" + (n === 1 ? "" : "s") + ". Paste them into Claude Code, Cursor or the like." });
      });
    }).catch(function () {
      noteStack({ kind: "error", key: key, words: "Couldn't reach the clipboard. Open What's copied and copy the text from there." });
    });
  }

  function saveRequest() {
    if (!described.length || busy || (stackNote && stackNote.kind === "saving")) return;
    var key = describedKey();
    readyRequest().then(function (text) {
      if (lastSaved && lastSaved.text === text) {
        noteStack({ kind: "saved", key: key, flash: true, words: "Already saved as " + lastSaved.path + ".", open: lastSaved.open });
        return;
      }
      noteStack({ kind: "saving", key: key, words: "Saving the note\u2026" });
      return fetch("/api/describe-note", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: PAGE, text: text }),
      }).then(function (r) {
        return r.json().then(function (data) {
          if (r.ok && data.path) {
            lastSaved = { text: text, path: data.path, open: data.open || "" };
            message = "Saved the request as " + data.path + ".";
            noteStack({ kind: "saved", key: key, flash: true, words: "Saved as " + data.path + ". Point your AI tool at that note.", open: data.open || "" });
          } else {
            noteStack({ kind: "error", key: key, words: (data && data.error) || "Couldn't save the note." });
          }
        });
      });
    }).catch(function () {
      noteStack({ kind: "error", key: key, words: "Couldn't save the note. Is Obsidian still running?" });
    });
  }

  /* --- the stack above the bar ------------------------------------------ */

  function renderStack() {
    var box = ui.stack;
    box.textContent = "";
    box.hidden = !described.length;
    if (!described.length) return;
    var head = el("div", "ed-stack-head");
    var seg = el("div", "ed-seg");
    [["changes", "Changes (" + described.length + ")"], ["copied", "What's copied"]].forEach(function (t) {
      var b = el("button", null, t[1]);
      b.type = "button";
      if (stackView === t[0]) b.setAttribute("data-on", "");
      b.setAttribute("aria-pressed", stackView === t[0] ? "true" : "false");
      b.addEventListener("click", function (event) {
        event.stopPropagation();
        stackView = t[0];
        renderStack();
      });
      seg.appendChild(b);
    });
    head.appendChild(seg);
    head.appendChild(el("span", "ed-stack-keys", (MAC ? "⌘" : "Ctrl+") + "Enter copies them all"));
    box.appendChild(head);

    if (stackView === "copied") {
      box.appendChild(el("pre", "ed-stack-copied", requestText()));
    } else {
      var list = el("ol", "ed-stack-list");
      described.forEach(function (c, i) {
        var item = el("li", "ed-stack-item");
        var editingThis = describing && describing.editing === i;
        if (editingThis) item.setAttribute("data-editing", "");
        if (!c.subject.isConnected) item.setAttribute("data-gone", "");
        item.title = c.subject.isConnected ? "Click to edit" : "This layer is no longer on the page";
        item.appendChild(el("span", "ed-stack-num", (i + 1) + "."));
        item.appendChild(layerChip(c.subject));
        var words = el("span", "ed-stack-words");
        if (editingThis) words.appendChild(el("i", null, "Editing in the bar below…"));
        else c.parts.forEach(function (p) {
          if (typeof p === "string") words.appendChild(document.createTextNode(p));
          else words.appendChild(layerChip(p.ref));
        });
        item.appendChild(words);
        var pen = iconButton("pen", "Edit change " + (i + 1), function () {
          editChange(i);
        }, "ed-stack-act");
        var x = iconButton("close", "Take change " + (i + 1) + " out", function () {
          described.splice(i, 1);
          if (describing && describing.editing === i) describing = null;
          else if (describing && describing.editing !== null && describing.editing > i) describing.editing--;
          renderDescribe(false);
          refresh();
        }, "ed-stack-act");
        item.appendChild(pen);
        item.appendChild(x);
        item.addEventListener("click", function (event) {
          event.stopPropagation();
          editChange(i);
        });
        item.addEventListener("mouseenter", function () {
          hovered = c.subject;
          self.shared.hover = self;
          draw();
        });
        list.appendChild(item);
      });
      box.appendChild(list);
    }
    var foot = el("div", "ed-stack-foot");
    if (stackNote && stackNote.key !== describedKey()) stackNote = null;
    var hint = el("span", "ed-stack-hint", stackView === "copied" ? "Exactly what goes on the clipboard, and into a saved note." : "Click a change to edit it.");
    if (stackNote) {
      hint.textContent = stackNote.words;
      hint.setAttribute("role", "status");
      hint.setAttribute("data-note", stackNote.kind);
      if (stackNote.open) {
        var open = el("a", "ed-stack-open", "Open note");
        open.href = stackNote.open;
        open.title = "Open the note in Obsidian";
        open.addEventListener("click", function (event) {
          event.stopPropagation();
        });
        hint.appendChild(document.createTextNode(" "));
        hint.appendChild(open);
      }
    }
    foot.appendChild(hint);
    var clear = barButton("trash", "Clear", "Take every change out", function () {
      described = [];
      stackView = "changes";
      if (describing) describing.editing = null;
      refresh();
    });
    clear.classList.add("ed-quiet");
    var save = barButton("note", "Save as note", "Save the request as a note in the vault, to point an AI tool at or keep", saveRequest);
    var copy = barButton("copy", "Copy for AI", "Copy the request with each layer's code, for Claude Code, Cursor or the like (" + (MAC ? "⌘" : "Ctrl+") + "Enter)", copyRequest);
    copy.classList.add("ed-ai");
    // The button answers where it was pressed: Saving…, then Saved or Copied with a check.
    if (stackNote && stackNote.kind === "saving") {
      setWord(save, "Saving\u2026");
      save.disabled = true;
    }
    if (stackNote && stackNote.flash && stackNote.kind === "saved") {
      save.innerHTML = icon("check", 14) + "<span>Saved</span>";
      save.setAttribute("data-done", "");
    }
    if (stackNote && stackNote.flash && stackNote.kind === "copied") {
      copy.innerHTML = icon("check", 14) + "<span>Copied</span>";
      copy.setAttribute("data-done", "");
    }
    foot.appendChild(clear);
    foot.appendChild(save);
    foot.appendChild(copy);
    box.appendChild(foot);
  }

  /* Numbered markers on each layer the request points at. */
  function drawMarks() {
    var box = ui.marks;
    var layers = describedLayers();
    while (box.children.length > layers.length) box.removeChild(box.lastChild);
    while (box.children.length < layers.length) box.appendChild(el("div", "ed-mark"));
    layers.forEach(function (n, i) {
      var m = box.children[i];
      if (!n.isConnected) {
        m.hidden = true;
        return;
      }
      var r = toHost(n.getBoundingClientRect());
      m.hidden = false;
      m.setAttribute("data-n", String(i + 1));
      m.style.left = r.left + "px";
      m.style.top = r.top + "px";
      m.style.width = r.width + "px";
      m.style.height = r.height + "px";
      m.toggleAttribute("data-subject", n === selected);
    });
  }
`;
