// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OVERLAY_SCRIPT, overlayBundle } from "./overlayScript";
import { stampBlockIds } from "./anchor";
import type { OverlayComment } from "./types";

/**
 * The overlay ships as a string, so the compiler never looks inside it. A
 * typo in there is a page that loads with a dead overlay and no complaint
 * anywhere, found only by someone opening a preview and wondering why the
 * notch is missing. So these tests do what tsc cannot: parse it, then run it
 * against a real DOM and drive it.
 *
 * jsdom reports every rect as zero, so anything about *where* a pin lands is
 * tested by standing a fake rect in front of the block it is measured
 * against. That is enough to pin down the arithmetic; whether it looks right
 * is a question only a real browser answers, which is what the preview
 * harness next door is for.
 */

const STORE_KEY = "osp-overlay-comments";
const PREFS_KEY = "osp-overlay-prefs";

function mountPage(over: Record<string, string> = {}): void {
  document.head.innerHTML = `<meta name="osp-review" content='${JSON.stringify({
    sourcePath: "notes/Plan.md",
    page: "notes/plan.html",
    site: "Handbook",
    reviewer: "Reviewer",
    ...over,
  })}'>`;
  document.body.innerHTML =
    `<article class="osp-article">` +
    `<h2>Scope</h2><p>The first paragraph.</p><p>The second paragraph.</p>` +
    `</article>`;
  stampBlockIds(document.body);
}

function run(): ShadowRoot {
  new Function(overlayBundle())();
  const host = document.getElementById("osp-overlay-host");
  if (!host || !host.shadowRoot) throw new Error("the overlay did not mount");
  return host.shadowRoot;
}

function click(target: Element | null): void {
  if (!target) throw new Error("nothing to click");
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
}

function key(name: string): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
}

function stored(): OverlayComment[] {
  return JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
}

function mode(shadow: ShadowRoot, name: string): void {
  click(shadow.querySelector(`.co-mode[data-mode="${name}"]`));
}

function themeRow(shadow: ShadowRoot, label: string): Element | null {
  return (
    Array.from(shadow.querySelectorAll(".co-menu-item")).find(
      (item) => item.textContent?.trim() === label,
    ) ?? null
  );
}

/** Stands a block's box up, since jsdom measures everything as zero. */
function boxed(selector: string, box: Partial<DOMRect>): HTMLElement {
  const target = document.querySelector(selector) as HTMLElement;
  if (!target) throw new Error(`no ${selector}`);
  target.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      ...box,
    }) as DOMRect;
  return target;
}

/** Moves the pointer over the capture sheet, as a reviewer aiming a pin. */
function hover(shadow: ShadowRoot, x: number, y: number): void {
  const capture = shadow.querySelector(".co-capture");
  if (!capture) throw new Error("comment mode is not open");
  capture.dispatchEvent(
    new MouseEvent("mousemove", { bubbles: true, composed: true, clientX: x, clientY: y }),
  );
}

/** Drives the overlay through dropping one pin and writing a comment. */
function leaveComment(
  shadow: ShadowRoot,
  at: { x: number; y: number },
  text: string,
  priority?: string,
): void {
  mode(shadow, "comment");
  const capture = shadow.querySelector(".co-capture");
  if (!capture) throw new Error("comment mode did not open");
  capture.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      composed: true,
      clientX: at.x,
      clientY: at.y,
    }),
  );

  const input = shadow.querySelector(".co-draft textarea") as HTMLTextAreaElement | null;
  if (!input) throw new Error("the draft did not open");
  if (priority) click(shadow.querySelector(`.co-pri-opt[data-level="${priority}"]`));
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  click(shadow.querySelector(".co-draft .co-send"));
}

/**
 * A comment on a different page, which is what the panel now also lists.
 *
 * Shaped from `row` so only the page differs: the store keys a comment to the
 * note it was written about, so that is the field that puts it elsewhere.
 */
function away(text: string, over: Partial<OverlayComment> = {}): OverlayComment {
  return row({
    id: "elsewhere",
    page: "notes/other.html",
    sourcePath: "notes/Other.md",
    text,
    ...over,
  });
}

/**
 * Puts a query on the page's URL, as arriving from another page's panel does.
 *
 * `replaceState` rather than assigning to `location.search`, which jsdom
 * treats as a navigation and refuses.
 */
function search(query: string): void {
  window.history.replaceState({}, "", query);
}

/** A comment as the store holds one, so a test can seed one directly. */
function row(over: Partial<OverlayComment>): OverlayComment {
  return {
    id: "seed",
    page: "notes/plan.html",
    sourcePath: "notes/Plan.md",
    block: null,
    blockText: "",
    x: 0,
    y: 0,
    rx: null,
    ry: null,
    author: "Someone",
    text: "Seeded.",
    createdAt: "2026-10-28T07:00:00.000Z",
    resolved: false,
    priority: "medium",
    agent: null,
    external: null,
    replies: [],
    ...over,
  } as OverlayComment;
}

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  // A deep link set by one test must not be read by the next.
  search("/");
  // Every drop lands on the paragraph this stands in for, unless a test
  // moves it. Without a box there is nothing to measure a fraction against.
  document.elementFromPoint = () => document.querySelector("p");
});

describe("the overlay bundle", () => {
  it("is valid JavaScript", () => {
    expect(() => new Function(overlayBundle())).not.toThrow();
  });

  // The bundle goes inside a <script> element, so a literal closing tag in
  // either the stylesheet or the code would end the element early and spill
  // the rest of it into the document as markup.
  it("carries no closing script tag", () => {
    expect(overlayBundle().toLowerCase()).not.toContain("</script");
  });

  it("carries its stylesheet, since a shadow root cannot be reached from the page", () => {
    expect(overlayBundle()).toContain("OSP_OVERLAY_CSS");
    expect(overlayBundle()).toContain(".co-pin");
    expect(overlayBundle()).toContain(".co-notch");
  });

  it("reads nothing from the page but the review meta", () => {
    expect(OVERLAY_SCRIPT).toContain("osp-review");
  });

  // It was replaced by the vault sync, and a button that hands a reviewer a
  // file to move by hand is a step nobody has to take any more.
  it("has no way to download a file", () => {
    expect(overlayBundle()).not.toContain("createObjectURL");
    expect(overlayBundle()).not.toContain("download");
  });
});

describe("the notch", () => {
  it("mounts behind a shadow root so the page's CSS cannot reach it", () => {
    mountPage();
    const shadow = run();

    expect(shadow.querySelector(".co-notch")).not.toBeNull();
    expect(shadow.querySelector("style")?.textContent).toContain(".co-panel");
  });

  it("holds a menu and the three modes, and nothing else", () => {
    mountPage();
    const shadow = run();

    expect(shadow.querySelector('.co-notch-btn[title="Settings"]')).not.toBeNull();
    expect(
      Array.from(shadow.querySelectorAll(".co-mode")).map((button) =>
        button.getAttribute("data-mode"),
      ),
    ).toEqual(["view", "comment", "review"]);
    // Four buttons: the settings gear and the three modes.
    expect(shadow.querySelectorAll(".co-notch button")).toHaveLength(4);
  });

  // The gear, not the three bars it used to be: the rows behind it are
  // settings, and a hamburger promises navigation that is not there.
  it("marks the settings button with a gear", () => {
    mountPage();
    const shadow = run();
    const button = shadow.querySelector('.co-notch-btn[title="Settings"]');

    expect(button?.querySelector("svg circle")).not.toBeNull();
    expect(button?.querySelectorAll("svg path")).toHaveLength(1);
  });

  it("opens in view mode, so the page is readable before anything is chosen", () => {
    mountPage();
    const shadow = run();

    expect(shadow.querySelector(".co-capture")?.hasAttribute("hidden")).toBe(true);
    expect(shadow.querySelector(".co-panel")?.hasAttribute("hidden")).toBe(true);
    expect(
      shadow.querySelector('.co-mode[data-mode="view"]')?.hasAttribute("data-active"),
    ).toBe(true);
  });

  it("lays a capture sheet over the page in comment mode and takes it away again", () => {
    mountPage();
    const shadow = run();

    mode(shadow, "comment");
    expect(shadow.querySelector(".co-capture")?.hasAttribute("hidden")).toBe(false);

    mode(shadow, "view");
    expect(shadow.querySelector(".co-capture")?.hasAttribute("hidden")).toBe(true);
  });

  it("opens the panel in review mode", () => {
    mountPage();
    const shadow = run();
    mode(shadow, "review");

    expect(shadow.querySelector(".co-panel")?.hasAttribute("hidden")).toBe(false);
    expect(shadow.querySelector(".co-panel")?.getAttribute("data-side")).toBe("right");
  });

  it("moves the sliding pill to the mode that is on", () => {
    mountPage();
    const shadow = run();
    mode(shadow, "review");

    expect(shadow.querySelector(".co-mode-slider")?.getAttribute("data-at")).toBe("2");
  });

  it("switches mode on V, C and R", () => {
    mountPage();
    const shadow = run();

    key("c");
    expect(shadow.querySelector(".co-capture")?.hasAttribute("hidden")).toBe(false);
    key("r");
    expect(shadow.querySelector(".co-panel")?.hasAttribute("hidden")).toBe(false);
    key("v");
    expect(shadow.querySelector(".co-panel")?.hasAttribute("hidden")).toBe(true);
  });

  it("hides and unhides itself on H", () => {
    mountPage();
    const shadow = run();
    const notch = shadow.querySelector(".co-notch") as HTMLElement;

    key("h");
    expect(notch.hidden).toBe(true);

    key("h");
    expect(notch.hidden).toBe(false);
  });

  // The whole point of H is to read the build as a reader will see it, and a
  // reader sees no pins. Hiding the wrapper rather than each part is what
  // makes that true of anything added to the overlay later as well.
  it("takes the pins away with it, and brings them back", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "A note.");
    const wrap = shadow.querySelector(".osp-overlay") as HTMLElement;

    expect(shadow.querySelectorAll(".co-pin")).toHaveLength(1);

    key("h");
    expect(wrap.hidden).toBe(true);

    key("h");
    expect(wrap.hidden).toBe(false);
    expect(shadow.querySelectorAll(".co-pin")).toHaveLength(1);
  });

  // Hiding the notch with a capture sheet still over the page would leave
  // the page unusable and nothing on screen to say why.
  it("drops back to view mode when it is hidden", () => {
    mountPage();
    const shadow = run();
    mode(shadow, "comment");

    key("h");

    expect(shadow.querySelector(".co-capture")?.hasAttribute("hidden")).toBe(true);
    expect(shadow.querySelector(".co-panel")?.hasAttribute("hidden")).toBe(true);
  });

  it("leaves the mode shortcuts alone while it is hidden", () => {
    mountPage();
    const shadow = run();

    key("h");
    key("c");

    expect(shadow.querySelector(".co-capture")?.hasAttribute("hidden")).toBe(true);
  });

  it("hides from the menu as well as from the key", () => {
    mountPage();
    const shadow = run();
    click(shadow.querySelector('.co-notch-btn[title="Settings"]'));

    const hide = Array.from(shadow.querySelectorAll(".co-menu-item")).find((item) =>
      item.textContent?.includes("Hide the overlay"),
    );
    click(hide ?? null);

    expect((shadow.querySelector(".co-notch") as HTMLElement).hidden).toBe(true);
    expect((shadow.querySelector(".osp-overlay") as HTMLElement).hidden).toBe(true);
  });
});

describe("dropping a pin", () => {
  it("records the comment against the block it was dropped on", () => {
    mountPage();
    const shadow = run();
    const target = boxed("p:nth-of-type(1)", {
      left: 100,
      top: 200,
      width: 400,
      height: 60,
    });
    document.elementFromPoint = () => target;

    leaveComment(shadow, { x: 300, y: 230 }, "This needs a citation.");

    const saved = stored();
    expect(saved).toHaveLength(1);
    expect(saved[0].text).toBe("This needs a citation.");
    expect(saved[0].block).toBe(target.getAttribute("data-osp-block"));
    expect(saved[0].sourcePath).toBe("notes/Plan.md");
    expect(saved[0].page).toBe("notes/plan.html");
    expect(saved[0].author).toBe("Reviewer");
    expect(saved[0].resolved).toBe(false);
    expect(saved[0].blockText).toBe("The first paragraph.");
    expect(saved[0].replies).toEqual([]);
  });

  // The whole point of the rework: the pin belongs where the reviewer put
  // it, not at the corner of the paragraph it happens to be on.
  it("keeps the exact point as a fraction of the block it landed on", () => {
    mountPage();
    const shadow = run();
    const target = boxed("p:nth-of-type(1)", {
      left: 100,
      top: 200,
      width: 400,
      height: 60,
    });
    document.elementFromPoint = () => target;

    leaveComment(shadow, { x: 300, y: 230 }, "Half way across.");

    const saved = stored()[0];
    expect(saved.x).toBe(300);
    expect(saved.y).toBe(230);
    expect(saved.rx).toBeCloseTo(0.5);
    expect(saved.ry).toBeCloseTo(0.5);
  });

  it("draws the pin back on that same point", () => {
    mountPage();
    const shadow = run();
    const target = boxed("p:nth-of-type(1)", {
      left: 100,
      top: 200,
      width: 400,
      height: 60,
    });
    document.elementFromPoint = () => target;

    leaveComment(shadow, { x: 300, y: 230 }, "Right here.");

    const pin = shadow.querySelector(".co-pin") as HTMLElement;
    expect(pin.style.left).toBe("300px");
    expect(pin.style.top).toBe("230px");
  });

  // The fraction is what makes this true: the block moved down and got
  // wider, and the pin is still half way across and half way down it.
  it("carries the pin with its block when the page reflows", () => {
    mountPage();
    const shadow = run();
    const target = boxed("p:nth-of-type(1)", {
      left: 100,
      top: 200,
      width: 400,
      height: 60,
    });
    document.elementFromPoint = () => target;
    leaveComment(shadow, { x: 300, y: 230 }, "Follows the words.");

    boxed("p:nth-of-type(1)", { left: 0, top: 500, width: 200, height: 40 });
    // The resize handler defers to requestAnimationFrame, which jsdom will
    // not run inside a synchronous test, so redraw through a mode switch
    // instead. It is the same `renderPins` either way.
    mode(shadow, "view");

    const pin = shadow.querySelector(".co-pin") as HTMLElement;
    expect(pin.style.left).toBe("100px");
    expect(pin.style.top).toBe("520px");
  });

  // The bug this is here for: the capture sheet and the pins both set
  // `pointer-events: auto`, so an overlay that only dropped pointer events
  // on the host was still what the hit test found, and every pin anchored to
  // nothing at all.
  it("takes the whole overlay out of the way before asking what was clicked", () => {
    mountPage();
    const shadow = run();
    const host = document.getElementById("osp-overlay-host") as HTMLElement;
    const target = document.querySelector("p") as HTMLElement;

    let shownWhileAsking: string | null = null;
    document.elementFromPoint = () => {
      shownWhileAsking = host.style.display;
      return target;
    };

    leaveComment(shadow, { x: 10, y: 10 }, "Anchored, not floating.");

    expect(shownWhileAsking).toBe("none");
    expect(host.style.display).toBe("");
    expect(stored()[0].block).toBe(target.getAttribute("data-osp-block"));
  });

  it("falls back to plain document coordinates where no block covers the point", () => {
    mountPage();
    const shadow = run();
    document.elementFromPoint = () => document.body;

    leaveComment(shadow, { x: 42, y: 84 }, "Beside the text.");

    const saved = stored()[0];
    expect(saved.block).toBeNull();
    expect(saved.rx).toBeNull();

    const pin = shadow.querySelector(".co-pin") as HTMLElement;
    expect(pin.style.left).toBe("42px");
    expect(pin.style.top).toBe("84px");
  });

  it("shows the draft beside the point until it is saved, then the pin", () => {
    mountPage();
    const shadow = run();
    mode(shadow, "comment");
    shadow.querySelector(".co-capture")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, clientX: 50, clientY: 60 }),
    );

    expect((shadow.querySelector(".co-draft") as HTMLElement).hidden).toBe(false);
    expect(shadow.querySelectorAll(".co-ghost")).toHaveLength(1);

    key("Escape");
    expect((shadow.querySelector(".co-draft") as HTMLElement).hidden).toBe(true);
    expect(shadow.querySelectorAll(".co-ghost")).toHaveLength(0);
  });

  it("does not file a comment when the draft is left empty", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "   ");

    expect(stored()).toHaveLength(0);
  });

  it("asks for a name before the first comment when there is none", () => {
    document.head.innerHTML = `<meta name="osp-review" content='${JSON.stringify({
      sourcePath: "notes/Plan.md",
      page: "notes/plan.html",
      site: "Handbook",
      reviewer: "",
    })}'>`;
    document.body.innerHTML = `<article><p>The first paragraph.</p></article>`;
    stampBlockIds(document.body);
    const shadow = run();

    mode(shadow, "comment");
    shadow.querySelector(".co-capture")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, clientX: 10, clientY: 10 }),
    );

    expect((shadow.querySelector(".co-scrim") as HTMLElement).hidden).toBe(false);
    expect(shadow.querySelector(".co-modal-head h3")?.textContent).toContain("name");

    const name = shadow.querySelector(".co-field") as HTMLInputElement;
    name.value = "Sam";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    click(shadow.querySelector(".co-submit"));

    expect((shadow.querySelector(".co-scrim") as HTMLElement).hidden).toBe(true);
    expect((shadow.querySelector(".co-draft") as HTMLElement).hidden).toBe(false);
  });
});

describe("the panel", () => {
  it("lists the comments on this page", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Tighten this.");
    mode(shadow, "review");

    expect(shadow.querySelector(".co-row-text")?.textContent).toBe("Tighten this.");
    expect(shadow.querySelector(".co-num")?.textContent).toBe("1");
  });

  it("reads back comments left on an earlier visit", () => {
    mountPage();
    leaveComment(run(), { x: 10, y: 10 }, "Left earlier.");

    document.getElementById("osp-overlay-host")?.remove();
    mountPage();
    const shadow = run();
    mode(shadow, "review");

    expect(shadow.querySelector(".co-row-text")?.textContent).toBe("Left earlier.");
  });

  // Pins are this page's; the list is the whole review. What a reviewer
  // cannot already see by looking at the page is what is still open on the
  // pages they are not looking at, so that is what the panel is for.
  it("lists the comments on other pages as well as this page's", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([away("About another note.")]));
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "About this one.");
    mode(shadow, "review");

    expect(shadow.querySelector(".co-empty")).toBeNull();
    expect(shadow.textContent).toContain("About another note.");
    expect(shadow.textContent).toContain("About this one.");
    // Only this page's comment has a pin: the other page's is not here to
    // point at.
    expect(shadow.querySelectorAll(".co-pin")).toHaveLength(1);
  });

  // Mark order is a per-page order -- it is the numbers on the pins -- so a
  // flat list of every page's comments in it would run 1, 2, 1 with nothing
  // saying why.
  it("groups by page in mark order, with this page first", () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        away("Earlier, elsewhere.", { id: "x", createdAt: "2026-10-27T07:00:00.000Z" }),
      ]),
    );
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Later, here.");
    mode(shadow, "review");

    const heads = Array.from(shadow.querySelectorAll(".co-group-name")).map(
      (node) => node.textContent,
    );
    expect(heads).toEqual(["This page", "Other"]);
    // Oldest first would have put the other page's comment at the top of a
    // flat list; grouped, this page leads whatever the dates say.
    expect(
      Array.from(shadow.querySelectorAll(".co-row-text")).map((node) => node.textContent),
    ).toEqual(["Later, here.", "Earlier, elsewhere."]);
  });

  // One queue over the whole review has no headings to say where a row is,
  // so each row says it for itself.
  it("names the page on a row when the list is one queue", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([away("Elsewhere.")]));
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Here.");
    mode(shadow, "review");
    click(shadow.querySelector('.co-order[data-order="priority"]'));

    expect(shadow.querySelectorAll(".co-group")).toHaveLength(0);
    const pages = Array.from(shadow.querySelectorAll(".co-row")).map(
      (node) => node.querySelector(".co-row-page")?.textContent ?? null,
    );
    // One queue, so the order is the review's and not this page's: the older
    // comment leads, and it is the one that has to name where it is. This
    // page's row says nothing, because it is the page being read.
    expect(pages).toEqual(["Other", null]);
  });

  // A pin on another page cannot be opened from here, so the row is a link
  // to that page carrying the comment it was clicked for.
  it("goes to the other page, naming the comment, when such a row is clicked", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([away("Elsewhere.", { id: "far" })]));
    mountPage();
    const shadow = run();
    mode(shadow, "review");

    const link = shadow.querySelector(".co-row[data-away]") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("title")).toBe("Go to Other");
    // Relative, and up out of this page's own folder: a preview is opened
    // both from the plugin's server and straight off disk, and only a
    // relative href works in both.
    expect(link.getAttribute("href")).toBe("../notes/other.html?osp-comment=far");
  });

  // Arriving from such a link. The comment named is opened, in review mode,
  // because the panel it was clicked in should still be open on the far side.
  it("opens the comment a link asked for", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([row({ id: "wanted", text: "Found me." })]));
    mountPage();
    search("?osp-comment=wanted");
    const shadow = run();

    expect((shadow.querySelector(".co-pop") as HTMLElement).hidden).toBe(false);
    expect(shadow.querySelector(".co-panel")?.hasAttribute("hidden")).toBe(false);
    expect(shadow.querySelector(".co-pop-threads")?.textContent).toContain("Found me.");
  });

  it("ignores a link naming a comment that is not here", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([away("Elsewhere.", { id: "far" })]));
    mountPage();
    search("?osp-comment=far");
    const shadow = run();

    expect((shadow.querySelector(".co-pop") as HTMLElement).hidden).toBe(true);
  });

  it("filters down to open and resolved", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Still open.");
    mode(shadow, "review");

    click(shadow.querySelector('.co-filter[data-filter="resolved"]'));
    expect(shadow.querySelectorAll(".co-row")).toHaveLength(0);
    expect(shadow.querySelector(".co-filter-slider")?.getAttribute("data-at")).toBe("2");

    click(shadow.querySelector('.co-filter[data-filter="open"]'));
    expect(shadow.querySelectorAll(".co-row")).toHaveLength(1);
  });

  // The size of each scope, readable before it is chosen rather than
  // discovered by choosing it.
  it("carries a count in every filter label", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "One.");
    leaveComment(shadow, { x: 20, y: 20 }, "Two.");
    mode(shadow, "review");
    click(shadow.querySelector(".co-pin"));
    click(shadow.querySelector('.co-pop-btn[title="Resolve"]'));

    const counts = Array.from(shadow.querySelectorAll(".co-filter")).map((button) =>
      button.textContent?.trim(),
    );
    expect(counts).toEqual(["All 2", "Open 1", "Resolved 1"]);
  });

  it("moves to the other side and remembers it", () => {
    mountPage();
    const shadow = run();
    mode(shadow, "review");
    click(shadow.querySelector(".co-panel-head .co-icon-btn"));

    expect(shadow.querySelector(".co-panel")?.getAttribute("data-side")).toBe("left");
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").side).toBe("left");
  });

  // The anchor is content-derived, so rewriting the block is what loses it.
  // Saying so is the whole value of the orphan: the comment still carries the
  // text it was about.
  it("marks a comment whose block has been rewritten, and drops its pin", () => {
    mountPage();
    leaveComment(run(), { x: 10, y: 10 }, "Unclear.");
    document.getElementById("osp-overlay-host")?.remove();

    document.body.innerHTML =
      `<article class="osp-article">` +
      `<h2>Scope</h2><p>The first paragraph, rewritten.</p>` +
      `</article>`;
    stampBlockIds(document.body);
    const shadow = run();
    mode(shadow, "review");

    expect(shadow.querySelector(".co-warn")).not.toBeNull();
    expect(shadow.querySelector(".co-quote")?.textContent).toBe("The first paragraph.");
    expect(shadow.querySelectorAll(".co-pin")).toHaveLength(0);
  });

  it("holds a comment whose block moved down the page", () => {
    mountPage();
    leaveComment(run(), { x: 10, y: 10 }, "Still about the first.");
    document.getElementById("osp-overlay-host")?.remove();

    document.body.innerHTML =
      `<article class="osp-article"><h2>Scope</h2>` +
      `<p>Inserted above.</p><p>The first paragraph.</p><p>The second paragraph.</p>` +
      `</article>`;
    stampBlockIds(document.body);
    const shadow = run();
    mode(shadow, "review");

    expect(shadow.querySelector(".co-warn")).toBeNull();
    expect(shadow.querySelectorAll(".co-pin")).toHaveLength(1);
  });
});

describe("the popup", () => {
  function open(shadow: ShadowRoot): void {
    click(shadow.querySelector(".co-pin"));
  }

  it("opens on the pin and carries the comment", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Fix the heading.");
    open(shadow);

    expect((shadow.querySelector(".co-pop") as HTMLElement).hidden).toBe(false);
    expect(shadow.querySelector(".co-pop-body")?.textContent).toBe("Fix the heading.");
  });

  // The header is three things in one row: what this is, how much it is
  // asking for, and what can be done to it, with the buttons at the far edge.
  it("heads itself with the title, the priority and then the actions", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Fix the heading.");
    open(shadow);

    const head = shadow.querySelector(".co-pop-head") as HTMLElement;
    expect(
      Array.from(head.children).map((child) => child.className),
    ).toEqual(["co-pop-title", "co-pri", "co-pop-acts"]);
    expect(head.querySelector(".co-pop-title")?.textContent).toBe("Comment");
    expect(head.querySelectorAll(".co-pop-acts .co-pop-btn")).toHaveLength(3);
  });

  // What was marked, read before what was said about it.
  it("quotes the selection above the comments, with the mark number", () => {
    mountPage();
    const shadow = run();
    const target = document.querySelector("p:nth-of-type(1)") as HTMLElement;
    document.elementFromPoint = () => target;
    leaveComment(shadow, { x: 10, y: 10 }, "Fix the heading.");
    open(shadow);

    const popup = shadow.querySelector(".co-pop") as HTMLElement;
    const classes = Array.from(popup.children).map((child) => child.className);
    expect(classes.indexOf("co-pop-sel")).toBeLessThan(
      classes.indexOf("co-pop-threads"),
    );
    expect(shadow.querySelector(".co-pop-sel .co-pop-mark")?.textContent).toBe("1");
    expect(shadow.querySelector(".co-pop-quote")?.textContent).toBe(
      "The first paragraph.",
    );
  });

  it("says so in the quote when the mark is on no block at all", () => {
    mountPage();
    const shadow = run();
    document.elementFromPoint = () => document.body;
    leaveComment(shadow, { x: 10, y: 10 }, "About the page as a whole.");
    open(shadow);

    expect(shadow.querySelector(".co-pop-quote")?.textContent).toBe("About the page");
  });

  it("opens from a row in the panel too", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "From the list.");
    mode(shadow, "review");
    click(shadow.querySelector(".co-row"));

    expect((shadow.querySelector(".co-pop") as HTMLElement).hidden).toBe(false);
  });

  it("takes a reply and shows it in the thread", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Is this right?");
    open(shadow);

    const reply = shadow.querySelector(".co-pop-reply textarea") as HTMLTextAreaElement;
    reply.value = "It is not.";
    reply.dispatchEvent(new Event("input", { bubbles: true }));
    click(shadow.querySelector(".co-pop-reply .co-send"));

    expect(stored()[0].replies).toHaveLength(1);
    expect(stored()[0].replies[0].text).toBe("It is not.");
    expect(shadow.querySelectorAll(".co-pop-row")).toHaveLength(2);
  });

  it("resolves and reopens from the title bar", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Fix the heading.");
    open(shadow);

    click(shadow.querySelector('.co-pop-btn[title="Resolve"]'));
    expect(stored()[0].resolved).toBe(true);

    click(shadow.querySelector('.co-pop-btn[title="Reopen"]'));
    expect(stored()[0].resolved).toBe(false);
  });

  it("edits a comment in place", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Typo heer.");
    open(shadow);
    click(shadow.querySelector('.co-pop-btn[title="More"]'));

    const edit = Array.from(shadow.querySelectorAll(".co-pop-menu-item")).find(
      (item) => item.textContent === "Edit",
    );
    click(edit ?? null);

    const input = shadow.querySelector(".co-pop-row textarea") as HTMLTextAreaElement;
    expect(input.value).toBe("Typo heer.");
    input.value = "Typo here.";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    click(shadow.querySelector(".co-pop-row .co-send"));

    expect(stored()[0].text).toBe("Typo here.");
  });

  it("deletes a comment", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Never mind.");
    open(shadow);
    click(shadow.querySelector('.co-pop-btn[title="More"]'));

    const remove = Array.from(shadow.querySelectorAll(".co-pop-menu-item")).find(
      (item) => item.textContent === "Delete",
    );
    click(remove ?? null);

    expect(stored()).toHaveLength(0);
    expect((shadow.querySelector(".co-pop") as HTMLElement).hidden).toBe(true);
    expect(shadow.querySelectorAll(".co-pin")).toHaveLength(0);
  });

  it("closes on Escape", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Close me.");
    open(shadow);

    key("Escape");
    expect((shadow.querySelector(".co-pop") as HTMLElement).hidden).toBe(true);
  });

  // A reviewer typing "/" in a comment must not trigger the site's search
  // shortcut, and typing "c" must not flip the overlay into comment mode.
  // Events retarget at the shadow boundary, so neither handler outside can
  // tell that a field has focus.
  it("stops keystrokes in a field from reaching the page", () => {
    mountPage();
    const shadow = run();
    mode(shadow, "comment");
    shadow.querySelector(".co-capture")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, clientX: 10, clientY: 10 }),
    );

    let reached = false;
    document.addEventListener("keydown", () => {
      reached = true;
    });
    shadow
      .querySelector(".co-draft textarea")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "/", bubbles: true, composed: true }),
      );

    expect(reached).toBe(false);
  });
});

describe("the menu", () => {
  it("clears the comments on this page, once it is confirmed", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "One.");
    leaveComment(shadow, { x: 20, y: 20 }, "Two.");

    click(shadow.querySelector('.co-notch-btn[title="Settings"]'));
    const clear = Array.from(shadow.querySelectorAll(".co-menu-item")).find((item) =>
      item.textContent?.includes("Clear comments"),
    );
    click(clear ?? null);
    click(shadow.querySelector(".co-submit"));

    expect(stored()).toHaveLength(0);
    expect(shadow.querySelectorAll(".co-pin")).toHaveLength(0);
  });

  // Two themes, named for where the row takes you rather than for where you
  // already are.
  it("switches between light and dark, and remembers the choice", () => {
    document.documentElement.setAttribute("data-theme", "light");
    mountPage();
    const shadow = run();
    const wrap = shadow.querySelector(".osp-overlay") as HTMLElement;

    click(shadow.querySelector('.co-notch-btn[title="Settings"]'));
    click(themeRow(shadow, "Switch to dark"));

    expect(wrap.getAttribute("data-theme")).toBe("dark");
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").theme).toBe("dark");

    click(shadow.querySelector('.co-notch-btn[title="Settings"]'));
    click(themeRow(shadow, "Switch to light"));

    expect(wrap.getAttribute("data-theme")).toBe("light");
    document.documentElement.removeAttribute("data-theme");
  });

  it("offers no third theme", () => {
    mountPage();
    const shadow = run();
    click(shadow.querySelector('.co-notch-btn[title="Settings"]'));

    const rows = Array.from(shadow.querySelectorAll(".co-menu-item")).map(
      (item) => item.textContent ?? "",
    );
    expect(rows.filter((row) => row.startsWith("Switch to"))).toHaveLength(1);
    expect(rows.join(" ")).not.toContain("Auto");
  });

  // Seeding, not following: the page's theme decides where a first run
  // lands, and a stored choice outranks it from then on.
  it("takes its first theme from the page", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    mountPage();
    const shadow = run();

    expect(shadow.querySelector(".osp-overlay")?.getAttribute("data-theme")).toBe("dark");
    document.documentElement.removeAttribute("data-theme");
  });

  it("keeps a chosen theme when the page switches to the other one", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: "light" }));
    document.documentElement.setAttribute("data-theme", "dark");
    mountPage();
    const shadow = run();

    expect(shadow.querySelector(".osp-overlay")?.getAttribute("data-theme")).toBe("light");
    document.documentElement.removeAttribute("data-theme");
  });
});

describe("priority", () => {
  it("files a comment as medium when nothing is chosen", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Ordinary.");

    expect(stored()[0].priority).toBe("medium");
  });

  // Set while the comment is being written, because that is when the
  // reviewer knows: they have just read the thing they are objecting to.
  it("takes the level from the draft", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "This blocks the page.", "high");

    expect(stored()[0].priority).toBe("high");
  });

  it("marks the chosen level in the draft and starts each one over at medium", () => {
    mountPage();
    const shadow = run();
    mode(shadow, "comment");
    shadow.querySelector(".co-capture")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, clientX: 10, clientY: 10 }),
    );

    expect(shadow.querySelector('.co-pri-opt[data-on]')?.getAttribute("data-level")).toBe(
      "medium",
    );
    click(shadow.querySelector('.co-pri-opt[data-level="low"]'));
    expect(shadow.querySelector('.co-pri-opt[data-on]')?.getAttribute("data-level")).toBe(
      "low",
    );

    key("Escape");
    shadow.querySelector(".co-capture")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, clientX: 20, clientY: 20 }),
    );
    expect(shadow.querySelector('.co-pri-opt[data-on]')?.getAttribute("data-level")).toBe(
      "medium",
    );
  });

  it("shows the level on the popup pill, with a mark as well as a word", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Important.", "high");
    click(shadow.querySelector(".co-pin"));

    const pill = shadow.querySelector(".co-pri") as HTMLElement;
    expect(pill.getAttribute("data-level")).toBe("high");
    expect(pill.textContent).toContain("High");
    expect(pill.querySelector(".co-pri-mark")?.textContent).toBe("\u2191");
  });

  it("changes the level from the pill", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Think again.");
    click(shadow.querySelector(".co-pin"));
    click(shadow.querySelector(".co-pri"));

    expect(
      shadow.querySelector('.co-pop-menu[data-pri] .co-pop-menu-item[data-on]')
        ?.getAttribute("data-level"),
    ).toBe("medium");

    click(shadow.querySelector('.co-pop-menu-item[data-level="high"]'));

    expect(stored()[0].priority).toBe("high");
    expect(shadow.querySelector(".co-pri")?.getAttribute("data-level")).toBe("high");
  });

  it("reads a comment that was written before priority existed as medium", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([row({ priority: undefined })]));
    mountPage();
    const shadow = run();
    mode(shadow, "review");
    click(shadow.querySelector(".co-row"));

    expect(shadow.querySelector(".co-pri")?.getAttribute("data-level")).toBe("medium");
  });

  // The level was called "normal" until schema 6. A browser keeps its
  // comments in localStorage, so this build is handed the old name by the
  // one before it, and it is the same level rather than an unknown one.
  it("reads the level that used to be called normal as medium", () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([row({ priority: "normal" as never })]),
    );
    mountPage();
    const shadow = run();
    mode(shadow, "review");
    click(shadow.querySelector(".co-row"));

    expect(shadow.querySelector(".co-pri")?.getAttribute("data-level")).toBe("medium");
    expect(shadow.querySelector(".co-pri")?.textContent).toContain("Medium");

    // And it is written back under the new name the next time anything is
    // saved, rather than being carried as "normal" forever.
    click(shadow.querySelector('.co-pop-btn[title="Resolve"]'));
    expect(stored()[0].priority).toBe("medium");
  });

  /*
   * The three levels are told apart by colour as well as by their arrow, and
   * the hue is attached by `data-level` rather than written per place -- so
   * what is worth checking is that every pill carries the attribute the
   * stylesheet keys on, wherever it is drawn.
   */
  it("carries the level as an attribute on the pill, the draft and the menu", () => {
    mountPage();
    const shadow = run();
    mode(shadow, "comment");
    shadow.querySelector(".co-capture")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, clientX: 10, clientY: 10 }),
    );

    expect(
      Array.from(shadow.querySelectorAll(".co-pri-opt")).map((node) =>
        node.getAttribute("data-level"),
      ),
    ).toEqual(["high", "medium", "low"]);

    key("Escape");
    leaveComment(shadow, { x: 10, y: 10 }, "A blocker.", "high");
    click(shadow.querySelector(".co-pin"));
    expect(shadow.querySelector(".co-pri")?.getAttribute("data-level")).toBe("high");

    click(shadow.querySelector(".co-pri"));
    expect(
      Array.from(shadow.querySelectorAll(".co-pop-menu[data-pri] .co-pop-menu-item")).map(
        (node) => node.getAttribute("data-level"),
      ),
    ).toEqual(["high", "medium", "low"]);
  });

  // In the panel, where a comment from another page is read and its popup
  // never is. Medium is left off: a word on every row that the eye has to
  // read past to find the two rows that are not medium is noise.
  it("chips a panel row with its level, except the middle one", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "A nit.", "low");
    leaveComment(shadow, { x: 20, y: 20 }, "A question.");
    mode(shadow, "review");

    const chips = Array.from(shadow.querySelectorAll(".co-row")).map((node) =>
      node.querySelector(".co-row-pri")?.getAttribute("data-level") ?? null,
    );
    expect(chips).toEqual(["low", null]);
  });
});

describe("sorting the panel", () => {
  function texts(shadow: ShadowRoot): string[] {
    return Array.from(shadow.querySelectorAll(".co-row-text")).map(
      (node) => node.textContent ?? "",
    );
  }

  function three(shadow: ShadowRoot): void {
    leaveComment(shadow, { x: 10, y: 10 }, "A nit.", "low");
    leaveComment(shadow, { x: 20, y: 20 }, "A question.");
    leaveComment(shadow, { x: 30, y: 30 }, "A blocker.", "high");
  }

  function order(shadow: ShadowRoot, name: string): void {
    click(shadow.querySelector(`.co-order[data-order="${name}"]`));
  }

  it("starts in mark order, which is the order the pins are numbered in", () => {
    mountPage();
    const shadow = run();
    three(shadow);
    mode(shadow, "review");

    expect(shadow.querySelector(".co-order[data-active]")?.textContent).toBe("Mark order");
    expect(texts(shadow)).toEqual(["A nit.", "A question.", "A blocker."]);
  });

  it("puts the blockers first when asked to", () => {
    mountPage();
    const shadow = run();
    three(shadow);
    mode(shadow, "review");
    order(shadow, "priority");

    expect(shadow.querySelector(".co-order[data-active]")?.textContent).toBe("Priority");
    expect(texts(shadow)).toEqual(["A blocker.", "A question.", "A nit."]);
  });

  // Both orders are on screen with the one in force marked, rather than one
  // button carrying the name of the order it would switch to.
  it("shows both orders, and moves the marker to the one in force", () => {
    mountPage();
    const shadow = run();
    mode(shadow, "review");

    expect(
      Array.from(shadow.querySelectorAll(".co-order")).map((node) => node.textContent),
    ).toEqual(["Mark order", "Priority"]);
    expect(shadow.querySelector(".co-order-slider")?.getAttribute("data-at")).toBe("0");

    order(shadow, "priority");
    expect(shadow.querySelector(".co-order-slider")?.getAttribute("data-at")).toBe("1");
  });

  // The number on a pin is its place in the order the comments were made.
  // Reordering the list must not renumber the page underneath it.
  it("leaves the mark numbers alone", () => {
    mountPage();
    const shadow = run();
    three(shadow);
    mode(shadow, "review");
    order(shadow, "priority");

    expect(
      Array.from(shadow.querySelectorAll(".co-num")).map((node) => node.textContent),
    ).toEqual(["3", "2", "1"]);
  });

  it("goes back to mark order, and remembers whichever it is on", () => {
    mountPage();
    const shadow = run();
    three(shadow);
    mode(shadow, "review");

    order(shadow, "priority");
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").sort).toBe("priority");

    order(shadow, "time");
    expect(texts(shadow)).toEqual(["A nit.", "A question.", "A blocker."]);
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").sort).toBe("time");
  });

  it("opens in the order it was left in", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sort: "priority" }));
    mountPage();
    const shadow = run();
    three(shadow);
    mode(shadow, "review");

    expect(texts(shadow)).toEqual(["A blocker.", "A question.", "A nit."]);
  });
});

describe("a comment an agent filed", () => {
  it("carries a pill naming the agent, where a person's comment carries none", () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        row({ id: "by-hand", text: "Typed in the browser." }),
        row({
          id: "by-agent",
          text: "Filed by a tool.",
          author: "Claude",
          agent: "Claude Code",
          createdAt: "2026-10-28T08:00:00.000Z",
        }),
      ]),
    );
    mountPage();
    const shadow = run();
    mode(shadow, "review");

    const rows = Array.from(shadow.querySelectorAll(".co-row"));
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".co-tag")).toBeNull();
    expect(rows[1].querySelector(".co-tag")?.textContent).toBe("Agent");
    expect(rows[1].querySelector(".co-tag")?.getAttribute("title")).toBe(
      "Filed by Claude Code",
    );
  });

  // Nothing in the overlay sets it, so reading it back is the whole of the
  // support for it: an agent writes the field into the review file, and the
  // page it reaches has to keep it rather than drop it on the next save.
  it("keeps the field when the comment is written back to the vault", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([row({ agent: "Codex" })]));
    mountPage();
    run();

    expect(stored()[0].agent).toBe("Codex");
  });

  it("ignores an agent field that is not a name", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([row({ agent: 7 as never })]));
    mountPage();
    const shadow = run();
    mode(shadow, "review");

    expect(shadow.querySelector(".co-tag")).toBeNull();
  });
});

/**
 * The outline over the block the cursor is on. A pin lands on a point but
 * attaches to a block, and the reviewer has to be able to see which block
 * before they commit to it.
 */
describe("the block under the cursor", () => {
  const BOX = { left: 100, top: 200, right: 500, bottom: 260, width: 400, height: 60 };

  it("outlines the block the pointer is over, with room around it", () => {
    mountPage();
    const shadow = run();
    const target = boxed("p:nth-of-type(1)", BOX);
    document.elementFromPoint = () => target;

    mode(shadow, "comment");
    hover(shadow, 300, 230);

    const aim = shadow.querySelector(".co-aim") as HTMLElement;
    expect(aim.hidden).toBe(false);
    expect(aim.style.left).toBe("97px");
    expect(aim.style.top).toBe("197px");
    expect(aim.style.width).toBe("406px");
    expect(aim.style.height).toBe("66px");
  });

  it("moves to the next block when the pointer crosses into it", () => {
    mountPage();
    const shadow = run();
    const first = boxed("p:nth-of-type(1)", BOX);
    const second = boxed("p:nth-of-type(2)", {
      left: 100,
      top: 300,
      right: 500,
      bottom: 340,
      width: 400,
      height: 40,
    });

    document.elementFromPoint = () => first;
    mode(shadow, "comment");
    hover(shadow, 300, 230);

    document.elementFromPoint = () => second;
    hover(shadow, 300, 320);

    expect((shadow.querySelector(".co-aim") as HTMLElement).style.top).toBe("297px");
  });

  // Every move would otherwise cost a hit test, and a hit test here means
  // hiding and showing the whole overlay. A move that stays inside the block
  // already measured answers itself.
  it("asks the document nothing while the pointer stays in the same block", () => {
    mountPage();
    const shadow = run();
    const target = boxed("p:nth-of-type(1)", BOX);
    let asked = 0;
    document.elementFromPoint = () => {
      asked++;
      return target;
    };

    mode(shadow, "comment");
    hover(shadow, 300, 230);
    expect(asked).toBe(1);

    hover(shadow, 320, 240);
    hover(shadow, 400, 250);
    expect(asked).toBe(1);

    hover(shadow, 300, 900);
    expect(asked).toBe(2);
  });

  it("lets go when the pointer leaves the page", () => {
    mountPage();
    const shadow = run();
    const target = boxed("p:nth-of-type(1)", BOX);
    document.elementFromPoint = () => target;
    mode(shadow, "comment");
    hover(shadow, 300, 230);

    shadow
      .querySelector(".co-capture")
      ?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true, composed: true }));

    expect((shadow.querySelector(".co-aim") as HTMLElement).hidden).toBe(true);
  });

  it("outlines nothing once comment mode is over", () => {
    mountPage();
    const shadow = run();
    const target = boxed("p:nth-of-type(1)", BOX);
    document.elementFromPoint = () => target;
    mode(shadow, "comment");
    hover(shadow, 300, 230);

    mode(shadow, "view");

    expect((shadow.querySelector(".co-aim") as HTMLElement).hidden).toBe(true);
  });

  it("holds the outline on the block being commented on, and quotes it", () => {
    mountPage();
    const shadow = run();
    const target = boxed("p:nth-of-type(1)", BOX);
    document.elementFromPoint = () => target;

    mode(shadow, "comment");
    shadow.querySelector(".co-capture")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, clientX: 300, clientY: 230 }),
    );

    const aim = shadow.querySelector(".co-aim") as HTMLElement;
    expect(aim.hidden).toBe(false);
    expect(aim.hasAttribute("data-locked")).toBe(true);
    expect(shadow.querySelector(".co-draft-quote")?.textContent).toBe(
      "The first paragraph.",
    );

    // The pointer moves on to write the comment, and the outline does not
    // follow it off the block the comment is about.
    hover(shadow, 10, 900);
    expect(aim.style.top).toBe("197px");
    expect(aim.hasAttribute("data-locked")).toBe(true);
  });

  it("says the comment is about the page when the point is on no block", () => {
    mountPage();
    const shadow = run();
    document.elementFromPoint = () => document.body;

    mode(shadow, "comment");
    shadow.querySelector(".co-capture")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, clientX: 10, clientY: 10 }),
    );

    expect(shadow.querySelector(".co-draft-quote")?.textContent).toBe("About the page");
    expect((shadow.querySelector(".co-aim") as HTMLElement).hidden).toBe(true);
  });

  it("lets go of the outline when the draft is abandoned", () => {
    mountPage();
    const shadow = run();
    const target = boxed("p:nth-of-type(1)", BOX);
    document.elementFromPoint = () => target;
    mode(shadow, "comment");
    shadow.querySelector(".co-capture")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, clientX: 300, clientY: 230 }),
    );

    key("Escape");

    const aim = shadow.querySelector(".co-aim") as HTMLElement;
    expect(aim.hidden).toBe(true);
    expect(aim.hasAttribute("data-locked")).toBe(false);
  });
});

describe("a store it cannot read", () => {
  it("survives a corrupt store rather than failing to mount", () => {
    localStorage.setItem(STORE_KEY, "{ not json");
    mountPage();

    const shadow = run();
    mode(shadow, "review");

    expect(shadow.querySelector(".co-empty")).not.toBeNull();
  });

  // A store holding something that parses but is not a list of comments. The
  // guard is `Array.isArray`, and without it every read would throw on a
  // value a different version of this could plausibly have written.
  it("survives a store holding the wrong shape", () => {
    localStorage.setItem(STORE_KEY, `{"comments":[]}`);
    mountPage();

    expect(() => run()).not.toThrow();
  });

  // A comment written before the drop point existed. It anchors to a block
  // and nothing finer, so it comes back at that block's corner.
  it("reads a comment from the older shape", () => {
    mountPage();
    const block = document
      .querySelector("p:nth-of-type(1)")
      ?.getAttribute("data-osp-block");
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        {
          id: "old",
          page: "notes/plan.html",
          sourcePath: "notes/Plan.md",
          block,
          blockText: "The first paragraph.",
          author: "Someone",
          text: "Written by an older build.",
          createdAt: "2026-10-01T09:00:00.000Z",
          resolved: false,
        },
      ]),
    );

    const shadow = run();
    mode(shadow, "review");

    expect(shadow.querySelector(".co-row-text")?.textContent).toBe(
      "Written by an older build.",
    );
    expect(shadow.querySelectorAll(".co-pin")).toHaveLength(1);
  });
});

/**
 * The overlay talks to the plugin's local server when the page is served by
 * it, and falls back to localStorage alone when it is opened as a bare file.
 * Both paths matter, so both are driven here against a stubbed `fetch`
 * rather than a real socket.
 */
describe("the overlay against the vault", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: (init?.method ?? "GET").toUpperCase(),
        body: init?.body as string | undefined,
      });
      const result = handler(String(url), init);
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(result),
      } as Response);
    });
    return calls;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves a new comment to the vault, not only to this browser", async () => {
    const calls = stubFetch(() => ({ comments: [] }));
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Send this to the vault.");
    await flush();

    const posts = calls.filter((call) => call.method === "POST");
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0].url).toContain("/api/comments");

    const sent = JSON.parse(posts[posts.length - 1].body ?? "{}");
    expect(sent.comments).toHaveLength(1);
    expect(sent.comments[0].text).toBe("Send this to the vault.");
    // Shaped like a review file, so the import command reads it unchanged.
    expect(sent.version).toBe(6);
  });

  // The point of the whole exercise: a comment left in another browser, or
  // before this one's storage was cleared, is there when the page opens.
  it("shows comments the vault already holds", async () => {
    stubFetch(() => ({
      comments: [
        {
          id: "from-vault",
          page: "notes/plan.html",
          sourcePath: "notes/Plan.md",
          block: null,
          blockText: "",
          x: 10,
          y: 20,
          rx: null,
          ry: null,
          author: "Someone else",
          text: "Left on another machine.",
          createdAt: "2026-10-28T07:00:00.000Z",
          resolved: false,
          replies: [],
        },
      ],
    }));
    mountPage();
    const shadow = run();
    await flush();
    mode(shadow, "review");

    expect(shadow.textContent).toContain("Left on another machine.");
    expect(stored()).toHaveLength(1);
  });

  // A resolve made here must not be undone by a copy the vault saved before
  // it. The person sitting at this browser is the one who just acted.
  it("keeps this browser's version of a comment it already knows", async () => {
    const mine = {
      id: "shared",
      page: "notes/plan.html",
      sourcePath: "notes/Plan.md",
      block: null,
      blockText: "",
      x: 0,
      y: 0,
      rx: null,
      ry: null,
      author: "Me",
      text: "Mine, resolved.",
      createdAt: "2026-10-28T07:00:00.000Z",
      resolved: true,
      replies: [],
    };
    localStorage.setItem(STORE_KEY, JSON.stringify([mine]));
    stubFetch(() => ({ comments: [{ ...mine, resolved: false }] }));
    mountPage();
    run();
    await flush();

    expect(stored()).toHaveLength(1);
    expect(stored()[0].resolved).toBe(true);
  });

  it("carries on against localStorage when the plugin is not running", async () => {
    stubFetch(() => new Error("connection refused"));
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Offline, but kept.");
    await flush();
    mode(shadow, "review");

    expect(stored()).toHaveLength(1);
    expect(shadow.querySelector(".co-row-text")?.textContent).toBe("Offline, but kept.");
  });

  // Opened straight out of the preview folder, with no plugin running. There
  // is nothing to talk to, so it should not try -- a failed request per
  // keystroke-worth of work is noise in the console and latency on every save.
  it("does not reach for the network at all on a file:// page", async () => {
    const calls = stubFetch(() => ({ comments: [] }));
    vi.stubGlobal("location", { protocol: "file:", href: "file:///preview/note.html" });

    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "No server here.");
    await flush();
    mode(shadow, "review");

    expect(calls).toHaveLength(0);
    expect(stored()).toHaveLength(1);
    expect(shadow.querySelector(".co-row-text")?.textContent).toBe("No server here.");
  });
});

/**
 * Filing a comment in a tracker.
 *
 * The page holds no credential and talks to nothing but the plugin: it asks,
 * and writes down the issue key that comes back. So what is tested here is
 * the asking, the writing down, and the two states either side of it -- an
 * action that must not be offered twice, and a refusal that has to be
 * readable where it was asked for.
 */
describe("filing a comment in a tracker", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  const ISSUE = {
    provider: "github" as const,
    key: "owner/repo#41",
    url: "https://github.com/owner/repo/issues/41",
    filedAt: "2026-10-29T10:00:00.000Z",
  };

  let sent: Array<{ url: string; method: string; body?: string }>;

  /** Answers the comments endpoint, and the relay endpoint as told. */
  function stub(relay: unknown, ok = true) {
    sent = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      const call = {
        url: String(url),
        method: (init?.method ?? "GET").toUpperCase(),
        body: init?.body as string | undefined,
      };
      sent.push(call);
      const body = call.url.includes("/api/relay") ? relay : { comments: [] };
      return Promise.resolve({
        ok,
        json: () => Promise.resolve(body),
      } as Response);
    });
  }

  function menuItem(shadow: ShadowRoot, label: string): Element | null {
    return (
      Array.from(shadow.querySelectorAll(".co-pop-menu-item")).find(
        (item) => item.textContent === label,
      ) ?? null
    );
  }

  function openMore(shadow: ShadowRoot): void {
    click(shadow.querySelector(".co-pin"));
    click(shadow.querySelector('.co-pop-btn[title="More"]'));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The normal case: no tracker configured, so there is nothing to send to
  // and no action pretending otherwise.
  it("offers nothing to send to when the plugin named no tracker", () => {
    stub(null);
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Needs a citation.");
    openMore(shadow);

    expect(menuItem(shadow, "Send to GitHub")).toBeNull();
    expect(menuItem(shadow, "Edit")).not.toBeNull();
  });

  it("asks the plugin to file the comment, and writes down the issue", async () => {
    stub({ ok: true, external: ISSUE });
    mountPage({ tracker: "GitHub" });
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Needs a citation.");
    openMore(shadow);
    click(menuItem(shadow, "Send to GitHub"));
    await flush();

    const ask = sent.find((call) => call.url.includes("/api/relay"));
    expect(ask?.method).toBe("POST");
    expect(JSON.parse(ask?.body ?? "{}").id).toBe(stored()[0].id);

    // On the comment, so this browser's next whole-document save carries it
    // and the next Send cannot file a second issue for the same comment.
    expect(stored()[0].external).toEqual(ISSUE);

    const link = shadow.querySelector(".co-filed .co-ext") as HTMLAnchorElement;
    expect(link.textContent).toBe("owner/repo#41");
    expect(link.getAttribute("href")).toBe(ISSUE.url);
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("stops offering to send a comment it has already sent", async () => {
    stub({ ok: true, external: ISSUE });
    mountPage({ tracker: "GitHub" });
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Needs a citation.");
    openMore(shadow);
    click(menuItem(shadow, "Send to GitHub"));
    await flush();

    openMore(shadow);
    expect(menuItem(shadow, "Send to GitHub")).toBeNull();
  });

  // The reason belongs where the action was taken from, and the comment has
  // to stay sendable: nothing was filed.
  it("says why a refusal was a refusal, and leaves the comment unfiled", async () => {
    stub({ ok: false, error: "the token cannot open issues in owner/repo" });
    mountPage({ tracker: "GitHub" });
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Needs a citation.");
    openMore(shadow);
    click(menuItem(shadow, "Send to GitHub"));
    await flush();

    expect(shadow.querySelector(".co-filed .co-warn")?.textContent).toBe(
      "the token cannot open issues in owner/repo",
    );
    expect(stored()[0].external).toBeNull();

    click(shadow.querySelector('.co-pop-btn[title="More"]'));
    expect(menuItem(shadow, "Send to GitHub")).not.toBeNull();
  });

  it("says so when the plugin cannot be reached at all", async () => {
    sent = [];
    vi.stubGlobal("fetch", (url: string) =>
      String(url).includes("/api/relay")
        ? Promise.reject(new Error("connection refused"))
        : Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [] }) } as Response),
    );
    mountPage({ tracker: "GitHub" });
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Needs a citation.");
    openMore(shadow);
    click(menuItem(shadow, "Send to GitHub"));
    await flush();

    expect(shadow.querySelector(".co-filed .co-warn")?.textContent).toContain(
      "Could not reach the plugin",
    );
  });

  /*
   * Deleting a comment that has an issue behind it.
   *
   * The issue outlives the comment, so the record of it is handed to the
   * plugin on the way out -- otherwise the issue is left open with nothing
   * anywhere pointing at it. Only this browser knows the difference between
   * a comment somebody deleted and one this copy never had, which is why it
   * is said here rather than worked out from the document.
   */
  it("hands over the issue of a filed comment it deletes", async () => {
    stub(null);
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([row({ id: "filed", external: ISSUE })]),
    );
    mountPage({ tracker: "GitHub" });
    const shadow = run();
    await flush();

    openMore(shadow);
    click(menuItem(shadow, "Delete"));
    await flush();

    const last = JSON.parse(sent[sent.length - 1].body ?? "{}");
    expect(last.comments).toHaveLength(0);
    expect(last.withdrawn).toHaveLength(1);
    expect(last.withdrawn[0]).toMatchObject({ id: "filed", external: ISSUE });
    expect(typeof last.withdrawn[0].at).toBe("string");
  });

  // Nothing to hand over for a comment that was never filed, and an empty
  // list is not a thing for the plugin to go looking at.
  it("hands over nothing when the comment it deletes has no issue", async () => {
    stub(null);
    localStorage.setItem(STORE_KEY, JSON.stringify([row({ id: "plain" })]));
    mountPage({ tracker: "GitHub" });
    const shadow = run();
    await flush();

    openMore(shadow);
    click(menuItem(shadow, "Delete"));
    await flush();

    expect(JSON.parse(sent[sent.length - 1].body ?? "{}").withdrawn).toEqual([]);
  });

  it("shows the issue in the panel, where it is the one thing the sort cannot say", () => {
    stub(null);
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([row({ id: "filed", external: ISSUE })]),
    );
    mountPage({ tracker: "GitHub" });
    const shadow = run();
    mode(shadow, "review");

    const chip = shadow.querySelector(".co-row a.co-tag[data-ext]") as HTMLAnchorElement;
    expect(chip.textContent).toBe("#41");
    expect(chip.getAttribute("href")).toBe(ISSUE.url);
    expect(chip.getAttribute("title")).toBe("Filed as owner/repo#41");
  });

  // A record off a file in the vault ends up as a link somebody clicks, and
  // the file can be written by hand. An address that is not http is not an
  // address.
  it("ignores a stored record whose address is not a web address", () => {
    stub(null);
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        row({
          id: "bad",
          external: {
            provider: "github",
            key: "o/r#1",
            url: "javascript:alert(1)",
            filedAt: "",
          },
        }),
      ]),
    );
    mountPage({ tracker: "GitHub" });
    const shadow = run();
    mode(shadow, "review");

    expect(shadow.querySelector("a.co-tag[data-ext]")).toBeNull();

    // Read as a comment that has not been filed, so the action is still
    // there -- rather than as one filed somewhere nobody can go.
    click(shadow.querySelector(".co-pin"));
    click(shadow.querySelector('.co-pop-btn[title="More"]'));
    expect(shadow.querySelector(".co-ext")).toBeNull();
    expect(menuItem(shadow, "Send to GitHub")).not.toBeNull();
  });

  /*
   * The other way an issue reaches this browser: the plugin filed it from
   * Obsidian, for a comment this page already knows about. The local copy is
   * not wrong about it, it is simply older, so this one field is taken.
   */
  it("takes an issue the vault knows about for a comment it already has", async () => {
    const mine = row({ id: "shared", text: "Mine." });
    localStorage.setItem(STORE_KEY, JSON.stringify([mine]));
    stub(null);
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ comments: [{ ...mine, external: ISSUE }] }),
      } as Response),
    );

    mountPage({ tracker: "GitHub" });
    const shadow = run();
    await flush();

    expect(stored()[0].external).toEqual(ISSUE);
    mode(shadow, "review");
    expect(shadow.querySelector("a.co-tag[data-ext]")?.textContent).toBe("#41");
  });

  /*
   * And the same again for a resolve, which is what the plugin writes after
   * the tracker says the work is done. One way only: the vault can tick a
   * comment off here, and nothing from the vault can untick one.
   */
  it("takes a resolve the vault knows about, but never a reopen", async () => {
    const open_ = row({ id: "shared", text: "Mine." });
    const mineDone = row({ id: "done-here", text: "Done here." });
    mineDone.resolved = true;
    localStorage.setItem(STORE_KEY, JSON.stringify([open_, mineDone]));
    stub(null);
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            comments: [
              { ...open_, external: ISSUE, resolved: true },
              // Resolved here, still open in the vault: this browser wins.
              { ...mineDone, resolved: false },
            ],
          }),
      } as Response),
    );

    mountPage({ tracker: "GitHub" });
    run();
    await flush();

    const rows = stored();
    expect(rows.find((r) => r.id === "shared")?.resolved).toBe(true);
    expect(rows.find((r) => r.id === "done-here")?.resolved).toBe(true);
  });
});

/**
 * One overlay, three trackers.
 *
 * The page is told a name and nothing else -- not the project, not the
 * endpoint, not the credential -- so what is worth testing here is that the
 * name is all it uses, and that a key written by any of them reads as that
 * tracker spells it.
 */
describe("a comment filed somewhere other than GitHub", () => {
  function stubQuiet() {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [] }) } as Response),
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers to send to whichever tracker the plugin named", () => {
    stubQuiet();
    mountPage({ tracker: "Jira" });
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Needs a citation.");
    click(shadow.querySelector(".co-pin"));
    click(shadow.querySelector('.co-pop-btn[title="More"]'));

    expect(
      Array.from(shadow.querySelectorAll(".co-pop-menu-item")).map((i) => i.textContent),
    ).toEqual(["Send to Jira", "Edit", "Delete"]);
  });

  // A Jira key is already short enough to read in a row, so it is shown as
  // it is written everywhere else.
  it("shows a Jira key as a Jira key", () => {
    stubQuiet();
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        row({
          id: "filed",
          external: {
            provider: "jira",
            key: "ENG-14",
            url: "https://acme.atlassian.net/browse/ENG-14",
            filedAt: "",
          },
        }),
      ]),
    );
    mountPage({ tracker: "Jira" });
    const shadow = run();
    mode(shadow, "review");

    expect(shadow.querySelector("a.co-tag[data-ext]")?.textContent).toBe("ENG-14");
  });

  // An Asana task has no short name: what identifies it is sixteen digits,
  // which in a row of a panel is a number nobody reads and a name nobody can.
  it("says only where an Asana task went, and which one in its tooltip", () => {
    stubQuiet();
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        row({
          id: "filed",
          external: {
            provider: "asana",
            key: "Asana task 1201234567890123",
            url: "https://app.asana.com/0/1201/1209",
            filedAt: "",
          },
        }),
      ]),
    );
    mountPage({ tracker: "Asana" });
    const shadow = run();
    mode(shadow, "review");

    const chip = shadow.querySelector("a.co-tag[data-ext]") as HTMLAnchorElement;
    expect(chip.textContent).toBe("Asana");
    expect(chip.getAttribute("title")).toBe("Filed as Asana task 1201234567890123");
  });
});
