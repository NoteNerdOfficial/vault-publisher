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

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLIENT_SCRIPT } from "./clientScript";

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
