import { OVERLAY_CSS } from "./overlayCss";

/**
 * The review overlay, as it runs in the browser.
 *
 * Inlined per page like `CLIENT_SCRIPT`, and present only in a preview build.
 * Inlining a few tens of kilobytes into every page of a public site would be
 * wrong; into every page of a preview on local disk it costs nothing and
 * saves an asset, a fetch and a second esbuild entry point.
 *
 * Three things here are not obvious and are the reason it looks the way it
 * does.
 *
 * **Everything visible lives in a shadow root.** The page carries harvested
 * Obsidian CSS, so an overlay in the light DOM would be restyled by it, and
 * worse, would restyle the page being reviewed. The preview has to stay a
 * faithful picture of what a publish would produce, so the article markup is
 * not touched: the overlay is appended after it and draws over the top.
 *
 * **Keystrokes stop at the shadow boundary.** Events retarget as they cross
 * it, so `document.activeElement` is the *host element* while a reviewer
 * types in the overlay's textarea, not the textarea. The site's own global
 * handler checks `activeElement.tagName` to decide whether a bare "/" is a
 * shortcut or a character, and would have seen a DIV and stolen the slash
 * mid-sentence. So the textarea stops propagation itself rather than relying
 * on anything outside being careful.
 *
 * **Pins are positioned against the host, not the viewport.** The host sits
 * at the document origin, so the difference between a block's rect and the
 * host's rect is the block's position in document space -- which is
 * scroll-invariant, so pins travel with the text and need no scroll handler.
 * Measuring that difference rather than assuming the host is at (0, 0) is
 * what makes it survive a positioned or transformed `<body>`.
 *
 * DOM is built with `textContent`, never by assembling HTML strings. Not
 * because a reviewer's own words are a threat -- they are typing into their
 * own browser -- but because it makes an escaping mistake impossible rather
 * than merely unlikely.
 */
export const OVERLAY_SCRIPT = `(function () {
  var holder = document.querySelector('meta[name="osp-review"]');
  if (!holder) return;

  var config;
  try {
    config = JSON.parse(holder.getAttribute("content") || "{}");
  } catch (e) {
    return;
  }
  if (!config || !config.sourcePath) return;

  var SOURCE_PATH = config.sourcePath;
  var PAGE = config.page || "";
  var SITE = config.site || "";
  var STORE_KEY = "osp-overlay-comments";
  var NAME_KEY = "osp-overlay-user";
  var BLOCK_ATTR = "data-osp-block";
  var TEXT_LIMIT = 80;

  /* --- storage ------------------------------------------------------ */

  function readAll() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      // Corrupt, or storage refused. Starting empty beats refusing to run;
      // the reviewer loses notes they could not have read back anyway.
      return [];
    }
  }

  function writeAll() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(all));
    } catch (e) {}
    // localStorage first and unconditionally: it is the copy that survives
    // the plugin not running, and it must not depend on a request.
    sync();
  }

  function readName() {
    try {
      return localStorage.getItem(NAME_KEY) || config.reviewer || "";
    } catch (e) {
      return config.reviewer || "";
    }
  }

  function writeName(value) {
    try {
      localStorage.setItem(NAME_KEY, value);
    } catch (e) {}
  }

  var all = readAll();
  var author = readName();

  /* --- the vault, when it is reachable ------------------------------ */

  /*
   * The page is served by the plugin, so the comments can live in the vault
   * instead of only in this browser. When it is opened as a bare file
   * instead -- straight out of the preview folder, with no plugin running --
   * every call here fails and the overlay carries on against localStorage
   * alone. That is a degraded mode, not a broken one, so none of it reports
   * an error to the reader.
   */
  var API = "/api/comments";
  var served = location.protocol === "http:" || location.protocol === "https:";
  var syncing = false;
  var syncAgain = false;

  function payload() {
    return JSON.stringify({
      version: 1,
      site: SITE,
      exportedAt: new Date().toISOString(),
      comments: all,
    });
  }

  /*
   * Pushes the whole set to the vault, one request at a time.
   *
   * Serialized rather than fired per change: resolving three comments quickly
   * would otherwise race three writes of the same file against each other,
   * and the last to land would not reliably be the newest.
   */
  function sync() {
    if (!served) return;
    if (syncing) {
      syncAgain = true;
      return;
    }
    syncing = true;
    fetch(API, {
      method: "POST",
      // text/plain keeps this a simple request. application/json would earn
      // a preflight, and a preflight is a second thing that can fail.
      headers: { "Content-Type": "text/plain" },
      body: payload(),
    })
      .catch(function () {})
      .then(function () {
        syncing = false;
        if (syncAgain) {
          syncAgain = false;
          sync();
        }
      });
  }

  /*
   * Merges what the vault holds into what this browser holds.
   *
   * A comment this browser already knows about wins: the person sitting here
   * is the one who just acted on it, and their resolve should not be undone
   * by a copy saved before they did. Anything the vault has and this browser
   * does not is new here -- another browser, another machine, or this one
   * before its storage was cleared -- and is taken as is.
   */
  function adopt(incoming) {
    if (!incoming || !incoming.length) return false;
    var known = Object.create(null);
    for (var i = 0; i < all.length; i++) known[all[i].id] = true;

    var added = false;
    for (var j = 0; j < incoming.length; j++) {
      var row = incoming[j];
      if (!row || !row.id || known[row.id]) continue;
      all.push(row);
      known[row.id] = true;
      added = true;
    }
    return added;
  }

  function pull() {
    if (!served) return;
    fetch(API, { headers: { Accept: "application/json" } })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data) {
        if (!data || !data.comments) return;
        var changed = adopt(data.comments);
        if (changed) {
          writeAll();
          render();
        }
        // Pushed back whether or not anything arrived, so comments made
        // against a bare file earlier reach the vault the first time the
        // page is opened through the plugin.
        if (all.length) sync();
      })
      .catch(function () {});
  }

  function mine() {
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i] && all[i].sourcePath === SOURCE_PATH) out.push(all[i]);
    }
    out.sort(function (a, b) {
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });
    return out;
  }

  /* --- helpers ------------------------------------------------------ */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function squash(value) {
    return String(value == null ? "" : value).replace(/\\s+/g, " ").trim();
  }

  function clip(value) {
    var text = squash(value);
    return text.length > TEXT_LIMIT ? text.slice(0, TEXT_LIMIT - 1) + "\\u2026" : text;
  }

  function uid() {
    return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function when(iso) {
    var then = new Date(iso).getTime();
    if (!then) return "";
    var mins = Math.floor((Date.now() - then) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + "h ago";
    var days = Math.floor(hours / 24);
    if (days < 7) return days + "d ago";
    return new Date(then).toLocaleDateString();
  }

  /* --- the shadow root --------------------------------------------- */

  var host = document.createElement("div");
  host.id = "osp-overlay-host";
  host.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;z-index:2147483000;";
  var shadow = host.attachShadow({ mode: "open" });

  var sheet = document.createElement("style");
  sheet.textContent = OSP_OVERLAY_CSS;
  shadow.appendChild(sheet);

  var wrap = el("div", "osp-overlay");
  shadow.appendChild(wrap);

  var pins = el("div", "co-pins");
  wrap.appendChild(pins);

  var launcher = el("button", "co-launch");
  var launcherLabel = el("span", null, "Review");
  var launcherCount = el("span", "co-count");
  launcherCount.hidden = true;
  launcher.appendChild(launcherLabel);
  launcher.appendChild(launcherCount);
  wrap.appendChild(launcher);

  var panel = el("div", "co-panel");
  panel.hidden = true;
  wrap.appendChild(panel);

  var head = el("div", "co-head");
  head.appendChild(el("span", "co-title", "Review"));
  var addBtn = el("button", null, "Add");
  addBtn.setAttribute("data-primary", "");
  var closeBtn = el("button", null, "Close");
  head.appendChild(addBtn);
  head.appendChild(closeBtn);
  panel.appendChild(head);

  var list = el("div", "co-list");
  panel.appendChild(list);

  var foot = el("div", "co-foot");
  var exportBtn = el("button", null, "Export all");
  var nameBtn = el("button", null, "Name");
  foot.appendChild(exportBtn);
  foot.appendChild(nameBtn);
  panel.appendChild(foot);

  var draft = el("div", "co-draft");
  draft.hidden = true;
  var draftQuote = el("div", "co-draft-quote");
  var draftInput = document.createElement("textarea");
  draftInput.setAttribute("placeholder", "What is wrong with this?");
  var draftTools = el("div", "co-draft-tools");
  var saveBtn = el("button", null, "Save");
  saveBtn.setAttribute("data-primary", "");
  var cancelBtn = el("button", null, "Cancel");
  draftTools.appendChild(saveBtn);
  draftTools.appendChild(cancelBtn);
  draft.appendChild(draftQuote);
  draft.appendChild(draftInput);
  draft.appendChild(draftTools);
  draft.appendChild(el("div", "co-hint", "Cmd/Ctrl + Enter saves, Escape cancels"));
  wrap.appendChild(draft);

  document.body.appendChild(host);

  function paintTheme() {
    var theme = document.documentElement.getAttribute("data-theme");
    if (!theme) {
      theme =
        window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    }
    wrap.setAttribute("data-theme", theme);
  }
  paintTheme();

  // The page's own switch is the source of truth, so follow the attribute it
  // sets rather than asking the OS a second time and disagreeing with it.
  if (window.MutationObserver) {
    new MutationObserver(paintTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }

  /* --- blocks ------------------------------------------------------- */

  function blockIndex() {
    var map = Object.create(null);
    var nodes = document.querySelectorAll("[" + BLOCK_ATTR + "]");
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute(BLOCK_ATTR);
      if (key && !map[key]) map[key] = nodes[i];
    }
    return map;
  }

  function nearestBlock(node) {
    var current = node;
    while (current && current !== document.body) {
      if (current.nodeType === 1 && current.hasAttribute(BLOCK_ATTR)) return current;
      current = current.parentNode;
    }
    return null;
  }

  /* --- rendering ---------------------------------------------------- */

  var mode = "view";
  var blocks = blockIndex();

  function renderList() {
    while (list.firstChild) list.removeChild(list.firstChild);
    var rows = mine();

    if (!rows.length) {
      list.appendChild(
        el("div", "co-empty", "No comments on this page yet. Press Add, then click a paragraph."),
      );
      return;
    }

    for (var i = 0; i < rows.length; i++) {
      list.appendChild(row(rows[i], i + 1));
    }
  }

  function row(comment, number) {
    var item = el("div", "co-item");
    if (comment.resolved) item.setAttribute("data-resolved", "");

    var anchored = comment.block ? !!blocks[comment.block] : true;
    if (!anchored) item.setAttribute("data-orphan", "");

    var badge = el("button", "co-badge", String(number));
    badge.setAttribute("title", anchored ? "Scroll to this" : "The text this was about has changed");
    badge.addEventListener("click", function () {
      var target = comment.block ? blocks[comment.block] : null;
      if (target && target.scrollIntoView) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    item.appendChild(badge);

    var body = el("div", "co-body");
    body.appendChild(el("div", "co-text", comment.text));
    body.appendChild(
      el("div", "co-meta", (comment.author || "Anonymous") + " \\u00b7 " + when(comment.createdAt)),
    );
    if (comment.blockText) body.appendChild(el("div", "co-quote", comment.blockText));
    if (!anchored) {
      body.appendChild(
        el("div", "co-warn", "Anchor lost: this block has been rewritten since."),
      );
    }

    var tools = el("div", "co-tools");
    var resolveBtn = el("button", null, comment.resolved ? "Reopen" : "Resolve");
    resolveBtn.addEventListener("click", function () {
      comment.resolved = !comment.resolved;
      writeAll();
      render();
    });
    var deleteBtn = el("button", null, "Delete");
    deleteBtn.addEventListener("click", function () {
      var index = all.indexOf(comment);
      if (index !== -1) all.splice(index, 1);
      writeAll();
      render();
    });
    tools.appendChild(resolveBtn);
    tools.appendChild(deleteBtn);
    body.appendChild(tools);

    item.appendChild(body);
    return item;
  }

  function renderPins() {
    while (pins.firstChild) pins.removeChild(pins.firstChild);
    var rows = mine();
    // Read the host's own rect once: the difference between it and a block's
    // rect is the block's position in document space, whatever the page has
    // done to body's positioning.
    var base = host.getBoundingClientRect();

    for (var i = 0; i < rows.length; i++) {
      var comment = rows[i];
      var target = comment.block ? blocks[comment.block] : null;
      if (!target) continue;

      var box = target.getBoundingClientRect();
      var pin = el("button", "co-pin", String(i + 1));
      if (comment.resolved) pin.setAttribute("data-resolved", "");
      pin.setAttribute("title", squash(comment.text));

      // Beside the block if the margin has room for it, and above it if not.
      // Clamping to the left edge instead puts the pin on top of the first
      // word, which is what it did until a screenshot showed it covering one.
      var left = box.left - base.left - 26;
      var top = box.top - base.top;
      if (left < 2) {
        left = 2;
        // Only if there is somewhere to go: a block at the very top of the
        // document has no room above either, and covering a word beats
        // drawing the pin where nobody can reach it.
        if (top >= 25) top -= 23;
      }
      pin.style.left = left + "px";
      pin.style.top = top + "px";
      pin.addEventListener("click", withPanel);
      pins.appendChild(pin);
    }
  }

  function withPanel() {
    showPanel(true);
  }

  function render() {
    blocks = blockIndex();
    renderList();
    renderPins();
    var count = mine().length;
    launcherCount.textContent = String(count);
    launcherCount.hidden = count === 0;
  }

  /* --- panel and modes --------------------------------------------- */

  function showPanel(open) {
    panel.hidden = !open;
    launcher.hidden = open;
    if (!open) exitComment();
  }

  launcher.addEventListener("click", function () {
    showPanel(true);
  });
  closeBtn.addEventListener("click", function () {
    showPanel(false);
  });

  var outlined = null;
  var savedOutline = "";

  function highlight(target) {
    if (outlined === target) return;
    if (outlined) outlined.style.outline = savedOutline;
    outlined = target;
    if (target) {
      savedOutline = target.style.outline;
      // A literal colour, not the overlay's custom property: this element is
      // in the page, and the property is only declared inside the shadow root.
      target.style.outline = "2px solid #0969da";
    }
  }

  function enterComment() {
    if (mode === "comment") return;
    mode = "comment";
    addBtn.textContent = "Cancel";
    document.body.style.cursor = "crosshair";
    document.addEventListener("mousemove", onPickMove, true);
    document.addEventListener("click", onPickClick, true);
  }

  function exitComment() {
    if (mode !== "comment") return;
    mode = "view";
    addBtn.textContent = "Add";
    document.body.style.cursor = "";
    highlight(null);
    document.removeEventListener("mousemove", onPickMove, true);
    document.removeEventListener("click", onPickClick, true);
  }

  addBtn.addEventListener("click", function () {
    if (mode === "comment") exitComment();
    else enterComment();
  });

  function onPickMove(event) {
    // A click anywhere in the overlay retargets to the host as it leaves the
    // shadow tree, so the host is how "this came from our own UI" looks from
    // out here.
    if (event.target === host) return;
    highlight(nearestBlock(event.target));
  }

  function onPickClick(event) {
    if (event.target === host) return;
    event.preventDefault();
    event.stopPropagation();
    var target = nearestBlock(event.target);
    if (target) openDraft(target);
    else exitComment();
  }

  /* --- the draft ---------------------------------------------------- */

  var draftBlock = null;

  function openDraft(target) {
    draftBlock = target;
    draftQuote.textContent = clip(target.textContent);
    draftInput.value = "";
    draft.hidden = false;

    var base = host.getBoundingClientRect();
    var box = target.getBoundingClientRect();
    var left = box.left - base.left;
    var maxLeft = document.documentElement.clientWidth - 288;
    if (left > maxLeft) left = maxLeft;
    if (left < 2) left = 2;
    draft.style.left = left + "px";
    draft.style.top = box.bottom - base.top + 6 + "px";
    draftInput.focus();
  }

  function closeDraft() {
    draft.hidden = true;
    draftBlock = null;
  }

  function commit() {
    var text = draftInput.value.trim();
    if (!text || !draftBlock) {
      closeDraft();
      exitComment();
      return;
    }

    all.push({
      id: uid(),
      page: PAGE,
      sourcePath: SOURCE_PATH,
      block: draftBlock.getAttribute(BLOCK_ATTR),
      blockText: clip(draftBlock.textContent),
      author: author,
      text: text,
      createdAt: new Date().toISOString(),
      resolved: false,
    });
    writeAll();
    closeDraft();
    exitComment();
    showPanel(true);
    render();
  }

  saveBtn.addEventListener("click", commit);
  cancelBtn.addEventListener("click", function () {
    closeDraft();
    exitComment();
  });

  // The reason this is here and not on document: see the note at the top
  // about retargeting. Without it the site's "/" shortcut fires on every
  // slash a reviewer types.
  draftInput.addEventListener("keydown", function (event) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      closeDraft();
      exitComment();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commit();
    }
  });

  /* --- name and export --------------------------------------------- */

  nameBtn.addEventListener("click", function () {
    var next = window.prompt("Your name, for the comments you leave:", author);
    if (next === null) return;
    author = next.trim();
    writeName(author);
    render();
  });

  exportBtn.addEventListener("click", function () {
    var payload = {
      version: 1,
      site: SITE,
      exportedAt: new Date().toISOString(),
      comments: all,
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "comment-overlay.json";
    link.click();
    // Revoking in the same turn cancels the download in some browsers.
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  });

  /* --- keeping pins where the text is ------------------------------ */

  var pending = null;
  function reposition() {
    if (pending !== null) return;
    pending = window.requestAnimationFrame(function () {
      pending = null;
      renderPins();
    });
  }

  // Not scroll: positions are measured against the host, which scrolls with
  // the document, so they are already scroll-invariant. Reflow is what moves
  // a block relative to the page.
  window.addEventListener("resize", reposition, { passive: true });
  if (window.ResizeObserver) {
    new ResizeObserver(reposition).observe(document.body);
  }

  render();
  pull();
})();
`;

/**
 * Embeds a string in JavaScript source safely.
 *
 * `JSON.stringify` alone is not enough: it leaves `<` as itself, so a value
 * containing `</script>` would end the element early and spill the rest into
 * the document as markup. Nothing we emit contains one today, which is
 * exactly the kind of thing that stops being true quietly.
 */
function jsString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * The overlay as one script: its stylesheet, then the code that mounts it.
 *
 * The stylesheet travels as a JavaScript string rather than a `<style>` in
 * the head because it has to end up *inside* the shadow root. A stylesheet in
 * the document cannot reach in there -- which is the isolation the overlay
 * wants, so the way in is to hand the text to the script that builds the root.
 */
export function overlayBundle(): string {
  return `var OSP_OVERLAY_CSS=${jsString(OVERLAY_CSS)};\n${OVERLAY_SCRIPT}`;
}
