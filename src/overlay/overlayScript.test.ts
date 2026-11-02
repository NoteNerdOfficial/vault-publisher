// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OVERLAY_SCRIPT, overlayBundle } from "./overlayScript";
import { stampBlockIds } from "./anchor";
import { OVERLAY_SCHEMA_VERSION, type OverlayComment } from "./types";

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

function mountPage(over: Record<string, unknown> = {}): void {
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
    imported: null,
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

  /*
   * This used to assert the opposite, on the grounds that the vault sync had
   * replaced it and a file somebody moves by hand is a step nobody has to
   * take any more. That was true while the overlay shipped in preview builds
   * only, where the plugin is always on the other end of it.
   *
   * It is not true in a published build. There is no plugin there and no
   * vault to sync to: the comments live in one browser's localStorage and
   * nowhere else, so clearing site data, opening the site on another
   * machine, or handing the notes to whoever has to act on them loses the
   * lot. A file is the only answer that needs no server, which is why the
   * download is back.
   */
  it("can write a review out to a file and read one back", () => {
    expect(overlayBundle()).toContain("createObjectURL");
    expect(overlayBundle()).toContain("download");
    expect(overlayBundle()).toContain("FileReader");
  });
});

/**
 * Anchoring on a page the build never rendered.
 *
 * A page published as-is has no `data-osp-block` on anything: it was never
 * parsed, so there was no DOM pass to stamp it in. The overlay stamps those
 * itself when the config says to, and the only thing that makes that safe is
 * that the two implementations of the anchor agree -- `stampBlockIds` in
 * TypeScript for a rendered note, and the copy inside the script for
 * everything else. These tests are what keeps them from drifting: if they
 * ever disagree, every pin on an as-is page reattaches to nothing.
 */
describe("stamping anchors in the browser", () => {
  /** A page as published as-is: no shell, no stamps, somebody else's markup. */
  function mountAsIs(body: string, over: Record<string, unknown> = {}): void {
    document.head.innerHTML = "";
    document.body.innerHTML = body;
    // The meta is appended after `</html>` on a real as-is page, which the
    // parser puts in the body. Either way a document-wide query finds it.
    const meta = document.createElement("meta");
    meta.setAttribute("name", "osp-review");
    meta.setAttribute(
      "content",
      JSON.stringify({
        sourcePath: "pages/hand-written.html",
        page: "hand-written.html",
        site: "Handbook",
        reviewer: "Reviewer",
        stamp: true,
        ...over,
      }),
    );
    document.body.appendChild(meta);
  }

  const MARKUP =
    `<h1 style="letter-spacing:-1px">A page that styles itself</h1>` +
    `<p>The first paragraph.</p>` +
    `<ul><li>A bullet.</li><li>The same.</li><li>The same.</li></ul>` +
    `<blockquote><p>Quoted.</p></blockquote>` +
    `<table><tr><td>A cell.</td></tr></table>` +
    `<p></p>`;

  it("stamps exactly what the build would have stamped", () => {
    // The same markup twice: one document stamped by the TypeScript pass the
    // note path uses, one by the script. Every attribute must match.
    const built = document.implementation.createHTMLDocument("built");
    built.body.innerHTML = MARKUP;
    stampBlockIds(built.body);
    const expected = Array.from(built.body.querySelectorAll("[data-osp-block]")).map(
      (el) => `${el.tagName}:${el.getAttribute("data-osp-block")}`,
    );

    mountAsIs(MARKUP);
    run();
    const actual = Array.from(document.body.querySelectorAll("[data-osp-block]")).map(
      (el) => `${el.tagName}:${el.getAttribute("data-osp-block")}`,
    );

    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(6);
  });

  // Three identical bullets are the case a content-derived anchor has to
  // handle by numbering, and both copies have to number them alike.
  it("numbers repeated blocks the same way on both sides", () => {
    mountAsIs(MARKUP);
    run();
    // "A bullet.", then "The same." twice: the second of a pair keeps the
    // hash and gains a suffix, exactly as `stampBlockIds` numbers them.
    const bullets = Array.from(document.querySelectorAll("li")).map((el) =>
      el.getAttribute("data-osp-block"),
    );
    expect(bullets[0]).not.toBe(bullets[1]);
    expect(bullets[2]).toBe(`${bullets[1]}-1`);
  });

  it("leaves a block with no text alone, having nothing to hash", () => {
    mountAsIs(MARKUP);
    run();
    const empty = Array.from(document.querySelectorAll("p")).find(
      (el) => !el.textContent?.trim(),
    );
    expect(empty?.hasAttribute("data-osp-block")).toBe(false);
  });

  // The whole point of doing it in the browser: the overlay has to work on a
  // document that none of our own markup is in.
  it("mounts and takes a pin on a page with no shell at all", () => {
    mountAsIs(MARKUP);
    const shadow = run();
    boxed("p", { left: 0, top: 0, width: 400, height: 40, right: 400, bottom: 40 });
    leaveComment(shadow, { x: 100, y: 20 }, "A note on somebody else's page.");

    const rows = stored();
    expect(rows).toHaveLength(1);
    expect(rows[0].sourcePath).toBe("pages/hand-written.html");
    expect(rows[0].page).toBe("hand-written.html");
    // Anchored to a block, not merely to a point, which is what the runtime
    // stamping buys: this is what survives a rebuild and a reflow.
    expect(rows[0].block).toBeTruthy();
    expect(rows[0].blockText).toContain("The first paragraph.");
  });

  // A note's page arrives already stamped, so the script must not stamp it
  // again -- doing so is harmless only as long as it is idempotent, and not
  // running at all is the stronger guarantee.
  it("does not stamp when the config does not ask it to", () => {
    mountAsIs(`<p>Unstamped.</p>`, { stamp: undefined });
    run();
    expect(document.querySelector("p")?.hasAttribute("data-osp-block")).toBe(false);
  });
});

/**
 * An application's page, which is empty when the script runs.
 *
 * Everything here is about the gap between "the script loaded" and "there is
 * something on the screen". For the vault's own HTML those are the same
 * moment; for anything that renders itself they are not, and every pin a
 * reviewer drops in between anchors to nothing.
 */
describe("a page that renders itself", () => {
  /** Mounts a page with the config an as-is page gets and an empty body. */
  function mountApp(over: Record<string, unknown> = {}): void {
    document.head.innerHTML = "";
    document.body.innerHTML = `<div id="root"></div>`;
    const meta = document.createElement("meta");
    meta.setAttribute("name", "osp-review");
    meta.setAttribute(
      "content",
      JSON.stringify({
        sourcePath: "app/index.html",
        page: "app/index.html",
        site: "Prototype",
        reviewer: "Reviewer",
        stamp: true,
        ...over,
      }),
    );
    document.head.appendChild(meta);
  }

  /** What an application puts on the screen once it has mounted. */
  function mount(html: string): void {
    const root = document.getElementById("root") as HTMLElement;
    root.innerHTML = html;
  }

  /** Long enough for the observer's own interval to have passed. */
  const settle = () => new Promise((done) => setTimeout(done, 220));

  it("marks nothing at first, because there is nothing to mark", () => {
    mountApp();
    run();
    expect(document.querySelectorAll("[data-osp-block]")).toHaveLength(0);
  });

  it("marks the page once the application has rendered", async () => {
    mountApp();
    run();
    mount(`<h1>Settings</h1><p>Pick a theme.</p>`);
    await settle();

    const marked = Array.from(document.querySelectorAll("[data-osp-block]"));
    expect(marked.map((el) => el.tagName)).toEqual(["H1", "P"]);
    // The same anchors the build would have written, so a pin dropped now
    // finds its block after a reload.
    const built = document.implementation.createHTMLDocument("built");
    built.body.innerHTML = `<h1>Settings</h1><p>Pick a theme.</p>`;
    stampBlockIds(built.body);
    expect(marked.map((el) => el.getAttribute("data-osp-block"))).toEqual(
      Array.from(built.body.querySelectorAll("[data-osp-block]")).map((el) =>
        el.getAttribute("data-osp-block"),
      ),
    );
  });

  it("keeps marking as the application replaces what it rendered", async () => {
    mountApp();
    run();
    mount(`<p>First screen.</p>`);
    await settle();
    const first = document.querySelector("p")?.getAttribute("data-osp-block");

    mount(`<p>Second screen.</p>`);
    await settle();
    const second = document.querySelector("p")?.getAttribute("data-osp-block");

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  // A pin dropped after the application rendered has a block to hold, which
  // is the whole point of re-marking.
  it("anchors a pin dropped on content that arrived late", async () => {
    mountApp();
    const shadow = run();
    mount(`<p>Pick a theme.</p>`);
    await settle();

    boxed("p", { left: 0, top: 0, width: 400, height: 40, right: 400, bottom: 40 });
    leaveComment(shadow, { x: 100, y: 20 }, "This label is unclear.");

    const row = stored()[0];
    expect(row.block).toBeTruthy();
    expect(row.blockText).toContain("Pick a theme.");
  });

  it("does not watch a page the build rendered", async () => {
    mountPage();
    run();
    const before = document.querySelectorAll("[data-osp-block]").length;
    const extra = document.createElement("p");
    extra.textContent = "Added after the fact.";
    document.querySelector("article")?.appendChild(extra);
    await settle();
    // Still only what `stampBlockIds` marked at build time: this page's
    // anchors are not ours to invent at runtime.
    expect(document.querySelectorAll("[data-osp-block]")).toHaveLength(before);
    expect(extra.hasAttribute("data-osp-block")).toBe(false);
  });
});

describe("which screen a comment belongs to", () => {
  function mountApp(): void {
    document.head.innerHTML = "";
    document.body.innerHTML = `<p>On this screen.</p>`;
    const meta = document.createElement("meta");
    meta.setAttribute("name", "osp-review");
    meta.setAttribute(
      "content",
      JSON.stringify({
        sourcePath: "app/index.html",
        page: "app/index.html",
        site: "Prototype",
        reviewer: "Reviewer",
        stamp: true,
      }),
    );
    document.head.appendChild(meta);
  }

  it("records the browser's own url when the pin is dropped", () => {
    search("/app/index.html#/settings");
    mountApp();
    const shadow = run();
    boxed("p", { left: 0, top: 0, width: 400, height: 40, right: 400, bottom: 40 });
    leaveComment(shadow, { x: 10, y: 10 }, "About the settings screen.");

    expect(stored()[0].route).toBe("/app/index.html#/settings");
  });

  it("shows a pin only on the screen it was left on", () => {
    search("/app/index.html#/settings");
    mountApp();
    let shadow = run();
    boxed("p", { left: 0, top: 0, width: 400, height: 40, right: 400, bottom: 40 });
    leaveComment(shadow, { x: 10, y: 10 }, "About the settings screen.");
    expect(shadow.querySelectorAll(".co-pin:not(.co-ghost)")).toHaveLength(1);

    // The same file, a different screen of it.
    search("/app/index.html#/account");
    mountApp();
    shadow = run();
    expect(stored()).toHaveLength(1);
    expect(shadow.querySelectorAll(".co-pin:not(.co-ghost)")).toHaveLength(0);
  });

  // A review written before routes existed, and every comment on a page the
  // build rendered: both mean "wherever this page is shown".
  it("shows a comment with no route anywhere", () => {
    search("/app/index.html#/account");
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        row({ page: "app/index.html", sourcePath: "app/index.html", block: null }),
      ]),
    );
    mountApp();
    const shadow = run();
    expect(shadow.querySelectorAll(".co-pin:not(.co-ghost)")).toHaveLength(1);
  });

  // The panel's deep link carries a parameter of ours, and a pin must not be
  // hidden by the link that exists to open it.
  it("ignores its own deep-link parameter when matching", () => {
    search("/app/index.html#/settings");
    mountApp();
    let shadow = run();
    boxed("p", { left: 0, top: 0, width: 400, height: 40, right: 400, bottom: 40 });
    leaveComment(shadow, { x: 10, y: 10 }, "About the settings screen.");
    const id = stored()[0].id;

    search(`/app/index.html?osp-comment=${id}#/settings`);
    mountApp();
    shadow = run();
    expect(shadow.querySelectorAll(".co-pin:not(.co-ghost)")).toHaveLength(1);
  });

  /*
   * One published file is any number of screens, and the arrows walk every
   * mark on the file -- so stepping crosses between them. A card opened
   * over a screen with no such pin on it is the seam: the step takes the
   * router there instead, which it does by the address bar, because that is
   * the one thing every router listens to.
   */
  it("steps across to the screen the next mark was left on", () => {
    search("/app/index.html#/settings");
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        row({
          id: "here",
          page: "app/index.html",
          sourcePath: "app/index.html",
          route: "/app/index.html#/settings",
          text: "On settings.",
        }),
        row({
          id: "there",
          page: "app/index.html",
          sourcePath: "app/index.html",
          route: "/app/index.html#/account",
          text: "On account.",
        }),
      ]),
    );
    mountApp();
    const shadow = run();

    // Only this screen's pin is drawn, which is why stepping to the other
    // one has to move the page rather than just the card.
    expect(shadow.querySelectorAll(".co-pin")).toHaveLength(1);
    click(shadow.querySelector(".co-pin"));
    expect(shadow.querySelector(".co-pop-pos")?.textContent).toBe("1 of 2");

    click(shadow.querySelector('.co-pop-btn[title="Next mark on this page"]'));
    expect(location.hash).toBe("#/account");
    expect(shadow.querySelector(".co-pop-body")?.textContent).toBe("On account.");

    // Closing stops the overlay waiting for a router that is not coming.
    click(shadow.querySelector('.co-pop-btn[title="Close"]'));
  });
});

describe("an anchor lost on a page that renders itself", () => {
  function seed(stamp: boolean): ShadowRoot {
    document.head.innerHTML = "";
    document.body.innerHTML = `<p>Something else entirely.</p>`;
    const meta = document.createElement("meta");
    meta.setAttribute("name", "osp-review");
    meta.setAttribute(
      "content",
      JSON.stringify({
        sourcePath: "app/index.html",
        page: "app/index.html",
        site: "Prototype",
        ...(stamp ? { stamp: true } : {}),
      }),
    );
    document.head.appendChild(meta);
    // A comment anchored to a block that is no longer on the page.
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        row({
          page: "app/index.html",
          sourcePath: "app/index.html",
          block: "gone",
          blockText: "The count is 41.",
          x: 120,
          y: 240,
        }),
      ]),
    );
    return run();
  }

  /**
   * The risk the re-marking introduces, and the reason for the fallback. On
   * an application a block's text changes because the application is being
   * used, not because anyone edited it -- so a pin that vanished would be a
   * reviewer watching their own comments disappear.
   */
  it("still draws the pin, at the point it was dropped on", () => {
    const shadow = seed(true);
    const pin = shadow.querySelector(".co-pin:not(.co-ghost)") as HTMLElement;
    expect(pin).toBeTruthy();
    expect(pin.style.left).toBe("120px");
    expect(pin.style.top).toBe("240px");
  });

  // Unchanged for a page the build rendered: there the text really was
  // rewritten, and the panel is the honest place to say so.
  it("draws nothing for a page the build rendered", () => {
    const shadow = seed(false);
    expect(shadow.querySelectorAll(".co-pin:not(.co-ghost)")).toHaveLength(0);
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
    click(shadow.querySelector('.co-sort[data-order="time"]'));

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
    click(shadow.querySelector('.co-act[title="Resolve"]'));

    const counts = Array.from(shadow.querySelectorAll(".co-filter")).map((button) =>
      button.textContent?.trim(),
    );
    expect(counts).toEqual(["All 2", "Open 1", "Resolved 1"]);
  });

  /*
   * A row's foot: what the comment is worth, and what it points at.
   *
   * The quote matters most on a row for another page, which is read in this
   * list and nowhere else -- there is no pin beside it to say what it is
   * about.
   */
  it("says under each comment what it is worth and what it marks", () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        row({
          id: "a",
          priority: "high",
          blockText: "The second paragraph.",
          text: "This contradicts the first.",
        }),
      ]),
    );
    mountPage();
    const shadow = run();
    mode(shadow, "review");

    // Beside the name, where the popup's own card says it too, so moving
    // between the list and a card does not move the fact.
    const name = shadow.querySelector(".co-row-name");
    expect(name?.querySelector(".co-row-pri")?.getAttribute("data-level")).toBe("high");
    expect(shadow.querySelector(".co-row-foot .co-quote")?.textContent).toBe(
      "The second paragraph.",
    );
    expect(shadow.querySelector(".co-row-foot .co-row-pri")).toBeNull();
  });

  // A chip on every row saying MEDIUM is a word the eye reads past on every
  // row to find the two that are not.
  it("leaves the middle priority off a row", () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([row({ id: "a", priority: "medium", blockText: "Some text." })]),
    );
    mountPage();
    const shadow = run();
    mode(shadow, "review");

    expect(shadow.querySelector(".co-row-pri")).toBeNull();
    expect(shadow.querySelector(".co-row-foot .co-quote")?.textContent).toBe("Some text.");
  });

  /*
   * The head answers the two questions a review panel is asked first: how
   * much is left, and how fresh the newest mark is. It used to carry a
   * centred title naming the panel, which can only be read by someone who
   * has already opened it.
   */
  it("heads the panel with what is left rather than with its name", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([away("Elsewhere.")]));
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "One.");
    leaveComment(shadow, { x: 20, y: 20 }, "Two.");
    mode(shadow, "review");
    click(shadow.querySelector(".co-pin"));
    click(shadow.querySelector('.co-act[title="Resolve"]'));

    expect(shadow.querySelector(".co-panel-tally")?.textContent).toBe(
      "2 open, 1 resolved",
    );
    // Over the whole review, like the counts above it: the pages a reviewer
    // is not looking at are the part worth saying out loud.
    expect(shadow.querySelector(".co-panel-meta")?.textContent).toContain(
      "Across 2 pages",
    );
    expect(shadow.querySelector(".co-panel-meta")?.textContent).toContain("last mark");
    expect(shadow.querySelector(".co-panel-title")).toBeNull();
  });

  it("says the review is empty rather than counting nothing twice", () => {
    mountPage();
    const shadow = run();
    mode(shadow, "review");

    expect(shadow.querySelector(".co-panel-tally")?.textContent).toBe("Nothing marked yet");
    expect((shadow.querySelector(".co-panel-meta") as HTMLElement).hidden).toBe(true);
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

/**
 * Telling one page from another in the panel.
 *
 * The review is a list of comments from the whole site, so every row and
 * heading has to say which page it is about -- and a site that publishes
 * applications as they are has several pages called `index`. These are the
 * tests of the labelling that makes those readable.
 */
describe("which page a comment is on", () => {
  /** A comment on a page published as-is, at a path a test chooses. */
  function onPage(path: string, over: Partial<OverlayComment> = {}): OverlayComment {
    return row({
      id: path,
      sourcePath: path,
      page: path.replace(/\.md$/i, ".html").toLowerCase(),
      text: "About " + path,
      ...over,
    });
  }

  function groupNames(shadow: ShadowRoot): (string | null)[] {
    return Array.from(shadow.querySelectorAll(".co-group-name")).map(
      (node) => node.textContent,
    );
  }

  function openPanel(): ShadowRoot {
    mountPage();
    const shadow = run();
    mode(shadow, "review");
    return shadow;
  }

  // The thing this is all for: four stock builds in one vault, each with an
  // entry point called index.html, and a panel that said "index" four times.
  it("qualifies pages that share a filename with the folder that differs", () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        onPage("react-default/index.html"),
        onPage("angular-default/index.html"),
      ]),
    );

    const names = groupNames(openPanel());
    expect(names).toContain("react-default/index");
    expect(names).toContain("angular-default/index");
  });

  // One "index" in a list is no clearer than four: it still does not say
  // what it is the index of.
  it("qualifies a filename that names nothing, even when it is the only one", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([onPage("react-relative/index.html")]));

    expect(groupNames(openPanel())).toContain("react-relative/index");
  });

  // The other half of the rule. A name that decides on its own is left
  // alone, or the panel would be a column of folders nobody needed.
  it("leaves a filename that decides on its own unqualified", () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([onPage("library/Atomic notes.md"), onPage("spike-notes/Scope.md")]),
    );

    expect(groupNames(openPanel())).toEqual(
      expect.arrayContaining(["Atomic notes", "Scope"]),
    );
  });

  // Two pages with the same name two folders down: one segment does not
  // separate them, so the label takes another.
  it("takes as many folders as it needs and no more", () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        onPage("apps/react/dist/index.html"),
        onPage("apps/angular/dist/index.html"),
      ]),
    );

    const names = groupNames(openPanel());
    expect(names).toContain("react/dist/index");
    expect(names).toContain("angular/dist/index");
  });

  // A note to edit and a page that arrived finished are different things to
  // go and look at, and the panel is where that is decided.
  it("says whether a page is a note or one published as it was found", () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([onPage("react-relative/index.html"), onPage("library/Scope.md")]),
    );

    const kinds = Array.from(openPanel().querySelectorAll(".co-group")).map((node) =>
      node.getAttribute("data-kind"),
    );
    expect(kinds).toContain("app");
    expect(kinds).toContain("note");
  });

  // The long answer, for a heading narrow enough to ellipsis.
  it("carries the vault path and the published url on the heading", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([onPage("react-relative/index.html")]));

    const head = Array.from(openPanel().querySelectorAll(".co-group")).find(
      (node) => !node.hasAttribute("data-here"),
    );
    expect(head?.getAttribute("title")).toBe(
      "react-relative/index.html\nreact-relative/index.html",
    );
  });

  /*
   * Grouping is by published file, and an application is one file however
   * many screens it has. So the rows a heading gathers are the ones the
   * heading cannot tell apart, and the route is what does.
   */
  it("names the screen a comment was left on", () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        onPage("react-relative/index.html", {
          id: "a",
          route: "/react-relative/index.html#/about",
        }),
        onPage("react-relative/index.html", {
          id: "b",
          route: "/react-relative/index.html#/settings",
          createdAt: "2026-10-28T08:00:00.000Z",
        }),
      ]),
    );

    const screens = Array.from(openPanel().querySelectorAll(".co-row-screen")).map(
      (node) => node.textContent,
    );
    expect(screens).toEqual(["#/about", "#/settings"]);
  });

  // The route is mostly the path to the page, and the page is named beside
  // it. An application sitting on its own entry point has no second screen
  // to be told apart from, so there is nothing to say.
  it("says nothing when the route is the page itself", () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        onPage("react-relative/index.html", { route: "/react-relative/index.html" }),
      ]),
    );

    expect(openPanel().querySelector(".co-row-screen")).toBeNull();
  });

  // A page the build rendered is one document at one URL and records no
  // route at all, which is what every comment written before routes existed
  // also looks like.
  it("says nothing for a comment with no route", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([onPage("library/Scope.md")]));

    expect(openPanel().querySelector(".co-row-screen")).toBeNull();
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

  // The header is three things in one row: which mark this is, how much it
  // is asking for, and the way through the page, with the buttons at the
  // far edge.
  it("heads itself with the mark, the priority and then the actions", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Fix the heading.");
    open(shadow);

    const head = shadow.querySelector(".co-pop-head") as HTMLElement;
    expect(
      Array.from(head.children).map((child) => child.className),
    ).toEqual(["co-pop-pos", "co-pri", "co-pop-acts"]);
    expect(head.querySelector(".co-pop-pos")?.textContent).toBe("1 of 1");
    expect(head.querySelectorAll(".co-pop-acts .co-pop-btn")).toHaveLength(3);
  });

  // The first number is the pin's own, so the card and the page agree about
  // which mark is open; the second says how many the page has.
  it("counts the mark against the page's other marks", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "One.");
    leaveComment(shadow, { x: 20, y: 20 }, "Two.");
    leaveComment(shadow, { x: 30, y: 30 }, "Three.");

    click(shadow.querySelectorAll(".co-pin")[1]);
    expect(shadow.querySelector(".co-pop-pos")?.textContent).toBe("2 of 3");
  });

  // The arrows walk the pins, in the order the pins are numbered.
  it("steps to the next mark and wraps round at the end", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "One.");
    leaveComment(shadow, { x: 20, y: 20 }, "Two.");

    click(shadow.querySelector(".co-pin"));
    expect(shadow.querySelector(".co-pop-pos")?.textContent).toBe("1 of 2");

    click(shadow.querySelector('.co-pop-btn[title="Next mark on this page"]'));
    expect(shadow.querySelector(".co-pop-pos")?.textContent).toBe("2 of 2");
    expect(shadow.querySelector(".co-pop-body")?.textContent).toBe("Two.");

    click(shadow.querySelector('.co-pop-btn[title="Next mark on this page"]'));
    expect(shadow.querySelector(".co-pop-pos")?.textContent).toBe("1 of 2");

    click(shadow.querySelector('.co-pop-btn[title="Previous mark on this page"]'));
    expect(shadow.querySelector(".co-pop-pos")?.textContent).toBe("2 of 2");
  });

  /*
   * A step is a move, not a cut: the card travels to the next pin while the
   * page scrolls it into view. The attribute is what the stylesheet hangs
   * the transition on, and it is only ever on while a step is in progress.
   */
  it("glides the card to the next mark, and does not glide it open", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "One.");
    leaveComment(shadow, { x: 20, y: 20 }, "Two.");

    const popup = shadow.querySelector(".co-pop") as HTMLElement;
    // Opening a row from the panel with no card on screen is a rise into
    // place, not a journey from wherever the last card happened to stand.
    mode(shadow, "review");
    click(shadow.querySelector(".co-row"));
    expect(popup.hidden).toBe(false);
    expect(popup.hasAttribute("data-gliding")).toBe(false);

    click(shadow.querySelector('.co-pop-btn[title="Next mark on this page"]'));
    expect(popup.hasAttribute("data-gliding")).toBe(true);
  });

  // The page comes to the mark, so the reviewer is not left to work out
  // which words a card is about -- often words that were off screen.
  it("brings the next mark's pin into view", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "One.");
    leaveComment(shadow, { x: 20, y: 20 }, "Two.");

    // On the prototype, not on the pins: every render builds new ones, and
    // the pin that is scrolled to is drawn after the step is taken.
    const seen: { on: string | null; options: unknown }[] = [];
    const proto = Element.prototype as unknown as Record<string, unknown>;
    const had = Object.prototype.hasOwnProperty.call(proto, "scrollIntoView");
    const was = proto.scrollIntoView;
    proto.scrollIntoView = function (this: Element, options?: unknown) {
      seen.push({ on: this.getAttribute("data-comment"), options });
    };
    try {
      click(shadow.querySelectorAll(".co-pin")[0]);
      click(shadow.querySelector('.co-pop-btn[title="Next mark on this page"]'));
    } finally {
      if (had) proto.scrollIntoView = was;
      else delete proto.scrollIntoView;
    }

    const second = stored()[1].id;
    expect(seen).toContainEqual({
      on: second,
      options: { behavior: "smooth", block: "center" },
    });
  });

  // An arrow that can only land where it started is a control lying about
  // having somewhere to go.
  it("turns the arrows off when the page has one mark", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Only one.");
    open(shadow);

    const next = shadow.querySelector(
      '.co-pop-btn[title="Next mark on this page"]',
    ) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  // What was marked, read before what was said about it. The mark's own
  // number is in the head, where it is also the position the arrows move
  // through, so it is not repeated down here.
  it("quotes the selection above the comments", () => {
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
    expect(shadow.querySelector(".co-pop-mark")).toBeNull();
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

  it("resolves and reopens from the foot", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Fix the heading.");
    open(shadow);

    click(shadow.querySelector('.co-act[title="Resolve"]'));
    expect(stored()[0].resolved).toBe(true);

    click(shadow.querySelector('.co-act[title="Reopen"]'));
    expect(stored()[0].resolved).toBe(false);
  });

  // Resolving is followed by the next mark, because that is what is done
  // next. The label says so rather than leaving the jump to be discovered.
  it("moves to the next mark once one is resolved", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "One.");
    leaveComment(shadow, { x: 20, y: 20 }, "Two.");

    click(shadow.querySelector(".co-pin"));
    expect(shadow.querySelector('.co-act[title="Resolve"]')?.textContent).toBe(
      "Resolve & next",
    );

    click(shadow.querySelector('.co-act[title="Resolve"]'));
    expect(stored()[0].resolved).toBe(true);
    expect(shadow.querySelector(".co-pop-pos")?.textContent).toBe("2 of 2");
    expect(shadow.querySelector(".co-pop-body")?.textContent).toBe("Two.");
  });

  // Reopening is a correction to this comment, not a step through the page.
  it("stays put when a mark is reopened", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "One.");
    leaveComment(shadow, { x: 20, y: 20 }, "Two.");

    click(shadow.querySelector(".co-pin"));
    click(shadow.querySelector('.co-act[title="Resolve"]'));
    click(shadow.querySelector('.co-pop-btn[title="Previous mark on this page"]'));
    expect(shadow.querySelector(".co-pop-pos")?.textContent).toBe("1 of 2");

    click(shadow.querySelector('.co-act[title="Reopen"]'));
    expect(shadow.querySelector(".co-pop-pos")?.textContent).toBe("1 of 2");
  });

  // One mark on the page, so there is nowhere to go next and the label
  // should not promise one.
  it("says only Resolve when the page has one mark", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Only one.");
    open(shadow);

    expect(shadow.querySelector('.co-act[title="Resolve"]')?.textContent).toBe("Resolve");
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
    click(shadow.querySelector('.co-act[title="Resolve"]'));
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

  // One chip, which toggles. Clicking it when it already names the order
  // asked for would switch away from it, so this checks first.
  function order(shadow: ShadowRoot, name: string): void {
    if (shadow.querySelector(`.co-sort[data-order="${name}"]`)) return;
    click(shadow.querySelector(".co-sort"));
  }

  it("starts in mark order, which is the order the pins are numbered in", () => {
    mountPage();
    const shadow = run();
    three(shadow);
    mode(shadow, "review");

    expect(shadow.querySelector(".co-sort")?.textContent).toBe("Mark order");
    expect(shadow.querySelector(".co-sort")?.getAttribute("data-order")).toBe("time");
    expect(texts(shadow)).toEqual(["A nit.", "A question.", "A blocker."]);
  });

  it("puts the blockers first when asked to", () => {
    mountPage();
    const shadow = run();
    three(shadow);
    mode(shadow, "review");
    order(shadow, "priority");

    expect(shadow.querySelector(".co-sort")?.textContent).toBe("Priority");
    expect(shadow.querySelector(".co-sort")?.getAttribute("data-order")).toBe("priority");
    expect(texts(shadow)).toEqual(["A blocker.", "A question.", "A nit."]);
  });

  // The chip names the order in force, not the one it would switch to --
  // which is what the label said the first time this control existed, and
  // had to be reasoned about rather than read. What it switches to is in
  // the tooltip, where a hover asks for it.
  it("names the order in force, and says in the tooltip what it would switch to", () => {
    mountPage();
    const shadow = run();
    mode(shadow, "review");

    const chip = () => shadow.querySelector(".co-sort");
    expect(chip()?.textContent).toBe("Mark order");
    expect(chip()?.getAttribute("title")).toContain("switch to priority");

    order(shadow, "priority");
    expect(chip()?.textContent).toBe("Priority");
    expect(chip()?.getAttribute("title")).toContain("switch to mark order");
  });

  // Nothing between the head and the list but the one line the filters and
  // the order share.
  it("puts the filters and the order on a single row", () => {
    mountPage();
    const shadow = run();
    mode(shadow, "review");

    const controls = shadow.querySelector(".co-controls");
    expect(controls?.querySelector(".co-filters")).not.toBeNull();
    expect(controls?.querySelector(".co-sort")).not.toBeNull();
    expect(
      Array.from(shadow.querySelectorAll(".co-panel > *")).map((node) => node.className),
    ).toEqual(["co-resizer", "co-panel-head", "co-controls", "co-list"]);
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

/*
 * Carrying a review between builds.
 *
 * The published build has no plugin behind it, so a file is the only way a
 * reviewer's notes leave the browser that made them.
 */
describe("exporting and importing a review", () => {
  function menuRow(shadow: ShadowRoot, label: string): HTMLButtonElement | null {
    return (
      (Array.from(shadow.querySelectorAll(".co-menu-item")).find((item) =>
        item.textContent?.startsWith(label),
      ) as HTMLButtonElement | undefined) ?? null
    );
  }

  function openSettings(shadow: ShadowRoot): void {
    click(shadow.querySelector('.co-notch-btn[title="Settings"]'));
  }

  it("offers both halves in the settings menu", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Something to carry.");
    openSettings(shadow);

    expect(menuRow(shadow, "Export comments")).not.toBeNull();
    expect(menuRow(shadow, "Import comments")).not.toBeNull();
  });

  // Offered but not available, so that exporting is visibly a thing this
  // does even on a page where there is nothing yet to export.
  it("disables the export when the review is empty", () => {
    mountPage();
    const shadow = run();
    openSettings(shadow);

    expect(menuRow(shadow, "Export comments")?.hasAttribute("disabled")).toBe(true);
    expect(menuRow(shadow, "Export comments")?.getAttribute("title")).toBe(
      "Nothing to export yet",
    );
  });

  it("writes the whole review to a file, whatever the panel is filtered to", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "One.");
    leaveComment(shadow, { x: 20, y: 20 }, "Two.");
    mode(shadow, "review");
    click(shadow.querySelector('.co-filter[data-filter="resolved"]'));

    let written = "";
    let name = "";
    const blobs: string[] = [];
    vi.stubGlobal("Blob", class {
      constructor(parts: string[]) {
        blobs.push(parts.join(""));
      }
    });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const node = realCreate(tag);
      if (tag === "a") {
        node.addEventListener("click", (event: Event) => {
          event.preventDefault();
          written = blobs[blobs.length - 1] ?? "";
          name = (node as HTMLAnchorElement).download;
        });
      }
      return node;
    });

    openSettings(shadow);
    click(menuRow(shadow, "Export comments"));

    const doc = JSON.parse(written);
    expect(doc.comments).toHaveLength(2);
    expect(doc.version).toBe(OVERLAY_SCHEMA_VERSION);
    expect(name).toMatch(/^review-.*\.json$/);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * Drives the hidden picker as a file chosen in the dialog would.
   *
   * `pages` is what the plugin would answer with: the mapping a publish
   * left behind, which turns page keys back into notes. An import asks for
   * it before it ingests anything, so this is asynchronous.
   */
  async function choose(
    shadow: ShadowRoot,
    text: string,
    filename = "review.json",
    pages: Record<string, string> = {},
  ): Promise<void> {
    const picker = shadow.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(picker, "files", {
      configurable: true,
      value: [{ name: filename }],
    });
    vi.stubGlobal("fetch", (url: string) =>
      String(url).includes("/api/pages")
        ? Promise.resolve({ ok: true, json: () => Promise.resolve({ pages }) } as Response)
        : Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [] }) } as Response),
    );
    vi.stubGlobal(
      "FileReader",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        result = "";
        readAsText() {
          this.result = text;
          this.onload?.();
        }
      },
    );
    picker.dispatchEvent(new Event("change"));
    // Two turns: one for the mapping request, one for its body.
    await new Promise((done) => setTimeout(done, 0));
    vi.unstubAllGlobals();
  }

  function doc(comments: unknown[], site = "Handbook"): string {
    return JSON.stringify({ version: OVERLAY_SCHEMA_VERSION, site, comments });
  }

  it("takes in comments from a file and says where they came from", async () => {
    mountPage();
    const shadow = run();
    await choose(shadow, doc([row({ id: "from-file", text: "Written elsewhere." })]));

    expect(stored()).toHaveLength(1);
    expect(stored()[0].imported).toBe("Handbook");
    mode(shadow, "review");
    expect(shadow.querySelector(".co-row-text")?.textContent).toBe("Written elsewhere.");
  });

  // The pill the panel shows for one, which is the same job the agent pill
  // does: a name in the author field does not say which build they read.
  it("pills an imported comment in the panel", async () => {
    mountPage();
    const shadow = run();
    await choose(shadow, doc([row({ id: "from-file" })]));
    mode(shadow, "review");

    const tag = shadow.querySelector(".co-row .co-tag");
    expect(tag?.textContent).toBe("Imported");
    expect(tag?.getAttribute("title")).toBe("Imported from Handbook");
  });

  /*
   * Additive, never destructive: the file may be older than what is on
   * screen and there is no way to tell from here, so an import can only add.
   */
  it("leaves a comment it already holds exactly as it is", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([row({ id: "mine", text: "Mine." })]));
    mountPage();
    const shadow = run();
    await choose(shadow, doc([row({ id: "mine", text: "Theirs." })]));

    expect(stored()).toHaveLength(1);
    expect(stored()[0].text).toBe("Mine.");
    expect(shadow.querySelector(".co-modal-body p")?.textContent).toBe(
      "Nothing new: every comment in that file is already here.",
    );
  });

  it("says what it skipped rather than quietly dropping it", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([row({ id: "mine" })]));
    mountPage();
    const shadow = run();
    await choose(shadow, doc([row({ id: "mine" }), row({ id: "new" }), { nonsense: true }]));

    expect(shadow.querySelector(".co-modal-body p")?.textContent).toBe(
      "Added 1 comment from Handbook.",
    );
    expect(shadow.querySelector(".co-modal-note")?.textContent).toBe(
      "1 comment already here, left alone. 1 row could not be read.",
    );
  });

  // A comment carried through two imports came from wherever it was first
  // written, not from the file it most recently travelled in.
  it("keeps the first source when a comment is imported twice", async () => {
    mountPage();
    const shadow = run();
    await choose(shadow, doc([row({ id: "a", imported: "Original site" })]));

    expect(stored()[0].imported).toBe("Original site");
  });

  /*
   * The case this whole mapping exists for: a reviewer comments on the
   * published site, sends the file, and the owner imports it into their
   * preview. Without the mapping the comment arrives keyed on a page URL,
   * which this build has never heard of -- no pin, and a link that opens
   * nothing.
   */
  it("puts the notes back on a review that came from the published site", async () => {
    mountPage();
    const shadow = run();
    await choose(
      shadow,
      doc([row({ id: "from-site", sourcePath: "notes/plan.html" })]),
      "review.json",
      { "notes/plan.html": "notes/Plan.md" },
    );

    expect(stored()[0].sourcePath).toBe("notes/Plan.md");
    // On this page now, so it has a pin like any other.
    expect(shadow.querySelectorAll(".co-pin")).toHaveLength(1);
    expect(shadow.querySelector(".co-modal-note")?.textContent).toContain(
      "1 comment came from the published site and were matched to their notes",
    );
  });

  /*
   * A comment from a preview already names its note, and the mapping only
   * ever lists published page URLs -- `buildPageMap` writes url -> note --
   * so a note's own path is never a key and nothing moves it.
   */
  it("leaves a comment the mapping does not list alone", async () => {
    mountPage();
    const shadow = run();
    await choose(shadow, doc([row({ id: "a", sourcePath: "notes/Plan.md" })]), "review.json", {
      "notes/other.html": "notes/Other.md",
    });

    expect(stored()[0].sourcePath).toBe("notes/Plan.md");
    expect(shadow.querySelector(".co-modal-note")?.textContent ?? "").not.toContain(
      "published site",
    );
  });

  // No plugin behind the page, so nothing to ask: the comments arrive as
  // they are rather than the import failing over a mapping it cannot get.
  it("imports without a mapping when there is no plugin to ask", async () => {
    mountPage({ published: true, sourcePath: "notes/plan.html" });
    const shadow = run();
    await choose(shadow, doc([row({ id: "a", sourcePath: "notes/plan.html" })]));

    expect(stored()).toHaveLength(1);
    expect(stored()[0].sourcePath).toBe("notes/plan.html");
  });

  it("refuses a file that is not a review, and says so", async () => {
    mountPage();
    const shadow = run();
    await choose(shadow, "{\"hello\": true}");

    expect(stored()).toHaveLength(0);
    expect(shadow.querySelector(".co-modal-head h3")?.textContent).toBe("That did not work");
    expect(shadow.querySelector(".co-modal-body p")?.textContent).toBe(
      "That file is not a review: it has no comments in it.",
    );
  });

  it("refuses a file that is not JSON", async () => {
    mountPage();
    const shadow = run();
    await choose(shadow, "not json at all");

    expect(shadow.querySelector(".co-modal-body p")?.textContent).toBe(
      "That file is not JSON.",
    );
  });

  // The filename is the only name a file without a site in it has.
  it("falls back to the filename when the file names no site", async () => {
    mountPage();
    const shadow = run();
    await choose(shadow, JSON.stringify({ comments: [row({ id: "x" })] }), "notes-from-sam.json");

    expect(stored()[0].imported).toBe("notes-from-sam.json");
  });
});

/*
 * The overlay on a published page.
 *
 * It goes out only when the vault's owner asked for it, and when it does,
 * writing is off unless they asked for that separately. What is left is a
 * reader: the pins, the panel, and the file that carries a review in.
 */
describe("a published build with commenting off", () => {
  function published(): ShadowRoot {
    mountPage({ sourcePath: "notes/plan.html", comments: false });
    return run();
  }

  it("offers two modes, and dropping a pin is not one of them", () => {
    const shadow = published();

    const names = Array.from(shadow.querySelectorAll(".co-mode")).map((node) =>
      node.getAttribute("data-mode"),
    );
    expect(names).toEqual(["view", "review"]);
    expect(shadow.querySelector(".co-modes")?.getAttribute("data-modes")).toBe("2");
  });

  // Not only the button: a build with no comment mode must not be put into
  // one by a keystroke, or the capture sheet goes over the page with no
  // visible way to take it off again.
  it("will not enter comment mode from the keyboard", () => {
    const shadow = published();

    key("c");
    expect((shadow.querySelector(".co-capture") as HTMLElement).hidden).toBe(true);
  });

  it("reads a comment without offering to answer, edit or reprioritise it", () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([row({ id: "theirs", sourcePath: "notes/plan.html", text: "Theirs." })]),
    );
    const shadow = published();
    click(shadow.querySelector(".co-pin"));

    expect(shadow.querySelector(".co-pop-body")?.textContent).toBe("Theirs.");
    expect(shadow.querySelector(".co-pop-reply")).toBeNull();
    expect(shadow.querySelector('.co-pop-btn[title="More"]')).toBeNull();
    // The level is still said, just not as a control that opens a menu.
    expect(shadow.querySelector(".co-pri")?.tagName).toBe("SPAN");
  });

  /*
   * Resolving stays. It is triage of comments that already exist rather
   * than authoring, and it is what makes an imported review usable as a
   * checklist by the person who has to work through it.
   */
  it("still resolves, which is what an imported review is for", () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([row({ id: "theirs", sourcePath: "notes/plan.html" })]),
    );
    const shadow = published();
    click(shadow.querySelector(".co-pin"));
    click(shadow.querySelector('.co-act[title="Resolve"]'));

    expect(stored()[0].resolved).toBe(true);
  });

  // The whole reason the overlay is worth shipping to a published page.
  it("still carries a review in and out", () => {
    const shadow = published();
    click(shadow.querySelector('.co-notch-btn[title="Settings"]'));

    const labels = Array.from(shadow.querySelectorAll(".co-menu-item")).map(
      (item) => item.textContent,
    );
    expect(labels.some((label) => label?.startsWith("Export comments"))).toBe(true);
    expect(labels.some((label) => label?.startsWith("Import comments"))).toBe(true);
  });

  // Absent means yes: every page built before the flag existed is a preview.
  it("leaves commenting on when the page says nothing about it", () => {
    mountPage();
    const shadow = run();

    expect(Array.from(shadow.querySelectorAll(".co-mode"))).toHaveLength(3);
  });
});

/*
 * A published page must never talk to /api/comments.
 *
 * The protocol alone used to decide this, and a published site is https
 * like a served preview is -- so every save POSTed the reader's whole
 * review to the site's own origin, where it 404ed and looked fine.
 */
describe("a published build and the plugin", () => {
  it("asks the plugin for nothing, and tells it nothing", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(String(url));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [] }) } as Response);
    });

    mountPage({ sourcePath: "notes/plan.html", published: true });
    const shadow = run();
    await new Promise((done) => setTimeout(done, 0));
    leaveComment(shadow, { x: 10, y: 10 }, "Typed by a reader.");
    await new Promise((done) => setTimeout(done, 0));

    expect(calls).toEqual([]);
    // Still saved, just not shared: the browser is the only copy.
    expect(stored()).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  // The preview is the case the protocol test was written for, and it has
  // to keep working exactly as it did.
  it("still syncs a preview served over http", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(String(url));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [] }) } as Response);
    });

    mountPage();
    run();
    await new Promise((done) => setTimeout(done, 0));

    expect(calls).toContain("/api/comments");
    vi.unstubAllGlobals();
  });
});

/*
 * What to do with the file, said at the moment it is saved. A reviewer who
 * finds a .json in their Downloads folder and does not know who wants it
 * has not fed back, they have made a file.
 */
describe("exporting from a published page", () => {
  function exportFrom(shadow: ShadowRoot): void {
    vi.stubGlobal("Blob", class {});
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const node = realCreate(tag);
      if (tag === "a") node.addEventListener("click", (event: Event) => event.preventDefault());
      return node;
    });
    click(shadow.querySelector('.co-notch-btn[title="Settings"]'));
    const out = Array.from(shadow.querySelectorAll(".co-menu-item")).find((item) =>
      item.textContent?.startsWith("Export comments"),
    );
    click(out ?? null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }

  it("says who to send it to, as something to click", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([row({ sourcePath: "notes/plan.html" })]));
    mountPage({
      sourcePath: "notes/plan.html",
      published: true,
      contact: "review@example.com",
    });
    const shadow = run();
    exportFrom(shadow);

    expect(shadow.querySelector(".co-modal-head h3")?.textContent).toBe("Review saved");
    const link = shadow.querySelector(".co-modal-body a") as HTMLAnchorElement;
    expect(link.textContent).toBe("review@example.com");
    expect(link.getAttribute("href")).toBe("mailto:review@example.com");
  });

  it("links a URL as a URL", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([row({ sourcePath: "notes/plan.html" })]));
    mountPage({
      sourcePath: "notes/plan.html",
      published: true,
      contact: "https://github.com/o/r/issues/new",
    });
    const shadow = run();
    exportFrom(shadow);

    expect(shadow.querySelector(".co-modal-body a")?.getAttribute("href")).toBe(
      "https://github.com/o/r/issues/new",
    );
  });

  // Anything that is neither is shown as the words it is, rather than
  // guessed at and turned into a broken link.
  it("shows an instruction that is not an address as plain words", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([row({ sourcePath: "notes/plan.html" })]));
    mountPage({
      sourcePath: "notes/plan.html",
      published: true,
      contact: "the #docs channel",
    });
    const shadow = run();
    exportFrom(shadow);

    expect(shadow.querySelector(".co-modal-body a")).toBeNull();
    expect(shadow.querySelector(".co-modal-body strong")?.textContent).toBe(
      "the #docs channel",
    );
  });

  /*
   * The two situations are different and the note says which one this is:
   * in a preview the vault already has the comments, and on a published
   * page the file is the only copy that leaves the browser.
   */
  // The file is only a review once it is back in a vault, so the export
  // says which door it goes through rather than leaving it to be guessed.
  it("says what the person receiving it should do with it", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([row({ sourcePath: "notes/plan.html" })]));
    mountPage({ sourcePath: "notes/plan.html", published: true });
    const shadow = run();
    exportFrom(shadow);

    const notes = Array.from(shadow.querySelectorAll(".co-modal-note")).map(
      (node) => node.textContent,
    );
    expect(notes.join(" ")).toContain("review folder");
    expect(notes.join(" ")).toContain("Import review comments");
  });

  it("says whether the file is the only copy", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([row({ sourcePath: "notes/plan.html" })]));
    mountPage({ sourcePath: "notes/plan.html", published: true });
    const shadow = run();
    exportFrom(shadow);

    expect(shadow.querySelector(".co-modal-note")?.textContent).toContain(
      "only copy that leaves it",
    );
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

  /*
   * The path an agent actually takes: it writes a comment into the review
   * file in the vault, the plugin serves that file, and this page pulls it.
   * The localStorage tests above start past the interesting part.
   */
  it("carries the pill on a comment that arrives from the vault", async () => {
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            comments: [
              {
                id: "from-vault",
                text: "The second paragraph contradicts the first.",
                author: "Claude",
                agent: "Claude Code",
                sourcePath: "notes/Plan.md",
                page: "notes/plan.html",
                createdAt: "2026-10-28T08:00:00.000Z",
              },
            ],
          }),
      } as Response),
    );
    mountPage();
    const shadow = run();
    await new Promise((done) => setTimeout(done, 0));
    mode(shadow, "review");

    expect(shadow.querySelector(".co-row .co-tag")?.textContent).toBe("Agent");
    vi.unstubAllGlobals();
  });

  /*
   * The gap worth knowing about: the vault is authoritative for two fields
   * and `agent` is not one of them, so adding it to a comment this browser
   * already holds does not reach the page.
   */
  it("does not pick up an agent field added to a comment it already has", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify([row({ id: "shared", agent: null })]));
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ comments: [{ ...row({ id: "shared" }), agent: "Claude Code" }] }),
      } as Response),
    );
    mountPage();
    const shadow = run();
    await new Promise((done) => setTimeout(done, 0));
    mode(shadow, "review");

    expect(shadow.querySelector(".co-row .co-tag")).toBeNull();
    vi.unstubAllGlobals();
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
    // The constant rather than a copy of its value: the script carries its
    // own `SCHEMA`, and a number written here is a third place to forget.
    expect(sent.version).toBe(OVERLAY_SCHEMA_VERSION);
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

  /** The foot's filing button, whichever of its two states it is in. */
  function sendBtn(shadow: ShadowRoot, tracker = "GitHub"): Element | null {
    return shadow.querySelector(`.co-act[title="Send to ${tracker}"]`);
  }

  function filedBtn(shadow: ShadowRoot): HTMLAnchorElement | null {
    return shadow.querySelector(".co-pop-foot .co-act[data-filed]");
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

    expect(sendBtn(shadow)).toBeNull();
    expect(menuItem(shadow, "Edit")).not.toBeNull();
  });

  it("asks the plugin to file the comment, and writes down the issue", async () => {
    stub({ ok: true, external: ISSUE });
    mountPage({ tracker: "GitHub" });
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Needs a citation.");
    click(shadow.querySelector(".co-pin"));
    click(sendBtn(shadow));
    await flush();

    const ask = sent.find((call) => call.url.includes("/api/relay"));
    expect(ask?.method).toBe("POST");
    expect(JSON.parse(ask?.body ?? "{}").id).toBe(stored()[0].id);

    // On the comment, so this browser's next whole-document save carries it
    // and the next Send cannot file a second issue for the same comment.
    expect(stored()[0].external).toEqual(ISSUE);

    // The action became its own result: one button, which is now the issue
    // and leads to it.
    const link = filedBtn(shadow) as HTMLAnchorElement;
    // The short name, as the panel's pill wears it: `owner/repo#41` in full
    // is wider than the card, and a button that wide pushed the overflow
    // menu off the end of a foot that does not wrap. The full key is in the
    // tooltip.
    expect(link.textContent).toBe("#41");
    expect(link.getAttribute("title")).toBe("Open owner/repo#41");
    expect(link.getAttribute("href")).toBe(ISSUE.url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(shadow.querySelector(".co-filed")).toBeNull();
  });

  it("stops offering to send a comment it has already sent", async () => {
    stub({ ok: true, external: ISSUE });
    mountPage({ tracker: "GitHub" });
    const shadow = run();
    leaveComment(shadow, { x: 10, y: 10 }, "Needs a citation.");
    click(shadow.querySelector(".co-pin"));
    click(sendBtn(shadow));
    await flush();

    expect(sendBtn(shadow)).toBeNull();
    expect(filedBtn(shadow)).not.toBeNull();
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
    click(shadow.querySelector(".co-pin"));
    click(sendBtn(shadow));
    await flush();

    expect(shadow.querySelector(".co-filed .co-warn")?.textContent).toBe(
      "the token cannot open issues in owner/repo",
    );
    expect(stored()[0].external).toBeNull();

    click(shadow.querySelector(".co-pin"));
    expect(sendBtn(shadow)).not.toBeNull();
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
    click(shadow.querySelector(".co-pin"));
    click(sendBtn(shadow));
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

    // In the foot, not on the top line: the priority has that place now, so
    // the list and the card say how much a comment is worth in the same
    // spot. The issue is the other thing a row carries, and down here it is
    // out of the way of the name and the date.
    const chip = shadow.querySelector(
      ".co-row .co-row-foot a.co-tag[data-ext]",
    ) as HTMLAnchorElement;
    expect(chip.textContent).toBe("#41");
    expect(chip.getAttribute("href")).toBe(ISSUE.url);
    expect(chip.getAttribute("title")).toBe("Filed as owner/repo#41");
    expect(shadow.querySelector(".co-row-name a.co-tag[data-ext]")).toBeNull();
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
    expect(filedBtn(shadow)).toBeNull();
    expect(sendBtn(shadow)).not.toBeNull();
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

    expect(shadow.querySelector('.co-act[title="Send to Jira"]')?.textContent).toBe(
      "Send to Jira",
    );

    // Filing is a button of its own, so the overflow is only the two things
    // that are neither resolving nor filing.
    click(shadow.querySelector('.co-pop-btn[title="More"]'));
    expect(
      Array.from(shadow.querySelectorAll(".co-pop-menu-item")).map((i) => i.textContent),
    ).toEqual(["Edit", "Delete"]);
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
