// @vitest-environment jsdom

/**
 * The client script ships as a string, so the compiler never looks inside
 * it: a mistake in here is a published page whose controls are dead, with
 * nothing to show for it anywhere. These tests parse it and run it against
 * a real DOM, the way `overlayScript.test.ts` does next door.
 *
 * Two things about the harness, both forced by what it is testing.
 *
 * jsdom has no layout, so every box measures zero and nothing is ever "on
 * screen". The script asks `getClientRects`, so a box is stood up by giving
 * the element one -- the same trick, and for the same reason, as `boxed` in
 * the overlay's tests.
 *
 * And the script is run once for the whole file rather than once per test.
 * It binds listeners to `document` and `window`, which jsdom shares across
 * every test in a file and offers no way to unbind: a second copy would
 * leave the first one listening, holding the nodes of a DOM that had since
 * been replaced, and closing the drawer out from under whatever the live
 * copy had just opened. One copy, with the state reset around each test.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLIENT_SCRIPT } from "./clientScript";
import { addHeadingAnchors } from "./page";

/** Puts a box on an element, since jsdom gives everything none. */
function laidOut(el: Element | null, on = true): void {
  if (!el) throw new Error("nothing to lay out");
  Object.defineProperty(el, "getClientRects", {
    configurable: true,
    value: () => (on ? [new DOMRect(0, 0, 100, 100)] : []),
  });
}

const toggle = () => document.querySelector("[data-osp-panel-toggle]") as HTMLButtonElement;
const scrim = () => document.querySelector("[data-osp-scrim]") as HTMLElement;
const open = () => document.documentElement.getAttribute("data-osp-panel") === "open";

function tap(el: Element): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** Whether the button shipped hidden, read before the script unhid it. */
let shippedHidden = false;

beforeAll(() => {
  /* The parts of the shell this script reaches for, and only those: the
     bar's toggle, the panel it controls, and the scrim beside it. */
  document.body.innerHTML =
    `<header class="osp-bar">` +
    `<button class="osp-panel-toggle" type="button" data-osp-panel-toggle hidden ` +
    `aria-expanded="false" aria-controls="osp-panel">menu</button>` +
    `</header>` +
    `<div class="osp-scrim" data-osp-scrim hidden></div>` +
    `<aside class="osp-panel" id="osp-panel">` +
    `<button type="button" data-osp-panel-close>close</button>` +
    `</aside>`;
  shippedHidden = toggle().hidden;
  new Function(CLIENT_SCRIPT)();
});

beforeEach(() => {
  if (open()) tap(scrim());
  laidOut(scrim());
});

describe("the vault panel, as a drawer", () => {
  it("opens on the menu button, which ships hidden until it can", () => {
    expect(shippedHidden).toBe(true);
    expect(toggle().hidden).toBe(false);

    tap(toggle());
    expect(open()).toBe(true);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(scrim().hidden).toBe(false);
  });

  /**
   * The bug this is here for: the guard asked the scrim whether this width
   * still wants a drawer, and asked with `offsetParent`, which is null for
   * every fixed box. The scrim is fixed, so the answer was always "the
   * layout has room for the panel" and any resize shut the drawer.
   *
   * It never showed on a desktop, where clicking a button resizes nothing.
   * On a phone it was the whole of the feature: opening the drawer takes
   * the page's scroll away, the browser's own chrome comes back, and the
   * resize that fires lands inside the same tap -- so the drawer opened and
   * shut before anyone saw it, and the hamburger looked like a dead button.
   */
  it("survives a resize while the width still draws it as a drawer", () => {
    tap(toggle());
    expect(open()).toBe(true);

    // The scrim is on screen, which is what "this is still a drawer" means.
    window.dispatchEvent(new Event("resize"));
    expect(open()).toBe(true);
  });

  it("closes when the width grows enough to put the panel back in a column", () => {
    tap(toggle());
    expect(open()).toBe(true);

    // Above 56rem the stylesheet takes the scrim away, so it has no box.
    laidOut(scrim(), false);
    window.dispatchEvent(new Event("resize"));
    expect(open()).toBe(false);
  });

  it("closes on the scrim and on Escape", () => {
    tap(toggle());
    tap(scrim());
    expect(open()).toBe(false);

    tap(toggle());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(open()).toBe(false);
  });
});


/**
 * The control a heading carries, and the one thing about it that is not a
 * link: pressing it copies the address instead of going there, because the
 * reader pressing it is already standing in the section.
 *
 * The markup here is what `addHeadingAnchors` emits, written out rather
 * than imported, so a change to either side has to be made on both -- this
 * script only ever sees markup, and a test that built it from the same
 * function could not notice the two drifting apart.
 */
/**
 * The markup comes from the build's own pass rather than a string written
 * here. The script reaches for a shape -- a link around the words, a
 * control inside it -- and a copy of that shape in this file would be free
 * to go on passing after the real one had changed.
 */
describe("a heading's link control", () => {
  let host: HTMLElement;
  let self: HTMLAnchorElement;
  let control: HTMLElement;
  let copied: string[];

  /** Lets the clipboard promise settle before the reply is read. */
  const settled = () => new Promise((resolve) => window.setTimeout(resolve, 0));

  /** A click from a pointer: `tap` sends none, which is the keyboard. */
  const pressed = (el: Element, init: MouseEventInit = {}): MouseEvent => {
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      detail: 1,
      ...init,
    });
    el.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied.push(text);
          return Promise.resolve();
        },
      },
    });

    host = document.createElement("div");
    host.innerHTML = `<h2 id="why-notes-decay">Why notes decay</h2>`;
    addHeadingAnchors(host);
    document.body.append(host);
    self = host.querySelector("[data-osp-heading-self]") as HTMLAnchorElement;
    control = host.querySelector("[data-osp-heading-link]") as HTMLElement;
  });

  afterEach(() => {
    host.remove();
  });

  it("copies the page's own address with the heading's fragment", async () => {
    pressed(control);
    await settled();

    expect(copied).toEqual([`${location.origin}${location.pathname}#why-notes-decay`]);
    expect(control.hasAttribute("data-osp-copied")).toBe(true);
    // The reply is an attribute the stylesheet prints, never a word inside
    // the heading: the overlay anchors comments to a hash of block text.
    expect(control.getAttribute("data-osp-said")).toBe("Copied");
    expect(host.querySelector("h2")?.textContent).toBe("Why notes decay");
  });

  it("does not follow the link it just copied", () => {
    expect(pressed(control).defaultPrevented).toBe(true);
  });

  it("puts the address in the bar as well, so it can be taken by hand", async () => {
    pressed(control);
    await settled();

    expect(location.hash).toBe("#why-notes-decay");
  });

  /**
   * The words are a link so that the right-click menu offers to copy it.
   * Clicking them is not a request to go anywhere -- this is where the
   * reader already is -- and a double-click picking a word out of a
   * heading must not leave a history entry behind either.
   */
  it("does nothing when the words themselves are clicked", async () => {
    expect(pressed(self).defaultPrevented).toBe(true);
    await settled();

    expect(copied).toEqual([]);
    expect(control.hasAttribute("data-osp-said")).toBe(false);
  });

  // No pointer, no icon to aim at: a key press counts no clicks, and that
  // is the one activation of the link itself worth answering.
  it("copies when the link is activated from the keyboard", async () => {
    self.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await settled();

    expect(copied).toEqual([`${location.origin}${location.pathname}#why-notes-decay`]);
    expect(control.getAttribute("data-osp-said")).toBe("Copied");
  });

  /**
   * A modifier is a question about the link -- open it in a tab, in a
   * window -- and the browser answers those. Taking the click would make
   * the control the one link on the page that cannot be opened.
   */
  it("leaves a modified click to the browser", () => {
    expect(pressed(control, { metaKey: true }).defaultPrevented).toBe(false);
    expect(copied).toEqual([]);
  });

  it("says where the address is when the clipboard refuses", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });

    pressed(control);
    await settled();

    expect(control.hasAttribute("data-osp-copied")).toBe(false);
    expect(control.getAttribute("data-osp-said")).toBe("In the address bar");
    expect(location.hash).toBe("#why-notes-decay");
  });

  // A heading holding a link of its own keeps its words, so the control is
  // an anchor itself and the address is on the control rather than around
  // the heading. The script has to read it from whichever carries it.
  it("copies from the control's own href when the heading holds a link", async () => {
    const nested = document.createElement("div");
    nested.innerHTML = `<h2 id="see-the-note">See <a href="decay.html">the note</a></h2>`;
    addHeadingAnchors(nested);
    document.body.append(nested);

    try {
      pressed(nested.querySelector("[data-osp-heading-link]") as HTMLElement);
      await settled();

      expect(copied).toEqual([`${location.origin}${location.pathname}#see-the-note`]);
    } finally {
      nested.remove();
    }
  });
});
