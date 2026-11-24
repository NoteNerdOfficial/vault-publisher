// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blockId } from "./anchor";
import { overlayBundle } from "./overlayScript";
import type { OverlayComment } from "./types";

/**
 * Prototypes drawn inside a device, and the things in them that open and
 * close: a phone frame whose screen is a second page in an <iframe>, a
 * bottom sheet parked below the window, a popup taken out of the document.
 *
 * jsdom has no layout, so every box here is stood up by hand, as the main
 * overlay tests do. What these hold is the arithmetic and the bookkeeping;
 * the demo prototypes in the test vault are where it was watched working.
 */

const STORE_KEY = "osp-overlay-comments";

function meta(over: Record<string, unknown> = {}): string {
  return `<meta name="osp-review" content='${JSON.stringify({
    sourcePath: "proto/phone.html",
    page: "proto/phone.html",
    site: "Prototype",
    reviewer: "Reviewer",
    stamp: true,
    ...over,
  })}'>`;
}

function rect(box: { left: number; top: number; width: number; height: number }): DOMRect {
  return {
    ...box,
    x: box.left,
    y: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
    toJSON: () => ({}),
  } as DOMRect;
}

function boxed(el: Element, box: { left: number; top: number; width: number; height: number }) {
  (el as HTMLElement).getBoundingClientRect = () => rect(box);
}

/** A page with a phone whose screen is an <iframe>, the screen filled in. */
function mountPhone(screen: string): { frame: HTMLIFrameElement; inner: Document } {
  document.head.innerHTML = meta();
  document.body.innerHTML = `<div class="device"><iframe id="screen" title="Phone"></iframe></div>`;
  const frame = document.getElementById("screen") as HTMLIFrameElement;
  const inner = frame.contentDocument as Document;
  inner.body.innerHTML = screen;
  // The frame drawn at 80% of its 390px width, 100px in from the corner.
  Object.defineProperty(frame, "offsetWidth", { configurable: true, value: 390 });
  boxed(frame, { left: 100, top: 50, width: 312, height: 675 });
  return { frame, inner };
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

function drop(shadow: ShadowRoot, x: number, y: number, text: string): void {
  click(shadow.querySelector('.co-mode[data-mode="comment"]'));
  shadow
    .querySelector(".co-capture")
    ?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, clientX: x, clientY: y }),
    );
  const input = shadow.querySelector(".co-draft textarea") as HTMLTextAreaElement;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  click(shadow.querySelector(".co-draft .co-send"));
}

function stored(): OverlayComment[] {
  return JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
}

function seed(rows: Partial<OverlayComment>[]): void {
  localStorage.setItem(
    STORE_KEY,
    JSON.stringify(
      rows.map((over, i) => ({
        id: `c${i}`,
        page: "proto/phone.html",
        sourcePath: "proto/phone.html",
        block: null,
        blockText: "",
        x: 0,
        y: 0,
        rx: null,
        ry: null,
        author: "Someone",
        text: "Seeded.",
        createdAt: "2026-11-22T07:00:00.000Z",
        resolved: false,
        priority: "medium",
        agent: null,
        imported: null,
        external: null,
        replies: [],
        ...over,
      })),
    ),
  );
}

function pins(shadow: ShadowRoot): HTMLElement[] {
  return Array.from(shadow.querySelectorAll(".co-pin:not(.co-ghost)")) as HTMLElement[];
}

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/proto/phone.html");
});

afterEach(() => {
  (window as unknown as { ospFrameWatcher?: { stop(): void } }).ospFrameWatcher?.stop();
  (window as unknown as { ospStampWatcher?: { stop(): void } }).ospStampWatcher?.stop();
});

describe("a screen inside a device frame", () => {
  it("stamps the screen's blocks from the page around it", () => {
    const { inner } = mountPhone(`<button id="pay">Pay now</button>`);
    run();
    expect(inner.getElementById("pay")?.hasAttribute("data-osp-block")).toBe(true);
  });

  it("pins what is under the cursor on the screen, not the frame", () => {
    const { frame, inner } = mountPhone(`<main><button id="pay">Pay now</button></main>`);
    const pay = inner.getElementById("pay") as HTMLElement;
    // In the screen's own coordinates: 40 in, 100 down, 200 by 50.
    boxed(pay, { left: 40, top: 100, width: 200, height: 50 });
    document.elementFromPoint = () => frame;
    // The point asked of the screen is the outer point, unscaled.
    let asked: [number, number] | null = null;
    inner.elementFromPoint = (x: number, y: number) => {
      asked = [x, y];
      return pay;
    };
    const shadow = run();

    // 100 + 140 * 0.8 = 212 across, 50 + 125 * 0.8 = 150 down.
    drop(shadow, 212, 150, "Say the total on the button.");

    expect(asked).toEqual([140, 125]);
    const comment = stored()[0];
    expect(comment.frame).toBe("#screen");
    expect(comment.block).toBe(pay.getAttribute("data-osp-block"));
    expect(comment.blockText).toBe("Pay now");
    // Half way across the button, half way down.
    expect(comment.rx).toBeCloseTo(0.5);
    expect(comment.ry).toBeCloseTo(0.5);
  });

  it("draws the pin where the block is, scaled out of the frame", () => {
    const { inner } = mountPhone(`<button id="pay">Pay now</button>`);
    const pay = inner.getElementById("pay") as HTMLElement;
    boxed(pay, { left: 40, top: 100, width: 200, height: 50 });
    seed([{ frame: "#screen", froute: null, block: blockId("button", "Pay now"), rx: 0.5, ry: 0.5 }]);
    const shadow = run();

    const pin = pins(shadow)[0];
    expect(pin.style.left).toBe("212px");
    expect(pin.style.top).toBe("150px");
  });

  it("keeps a pin left on another screen of the app off this one", () => {
    mountPhone(`<button id="pay">Pay now</button>`);
    const id = blockId("button", "Pay now");
    seed([
      { id: "here", frame: "#screen", froute: null, block: id, rx: 0, ry: 0 },
      { id: "there", frame: "#screen", froute: "screens/cart.html", block: id, rx: 0, ry: 0 },
    ]);
    const shadow = run();

    expect(pins(shadow).map((p) => p.getAttribute("data-comment"))).toEqual(["here"]);
  });

  it("names the screen a comment is on in the panel", () => {
    mountPhone(`<p>Home.</p>`);
    seed([{ frame: "#screen", froute: "screens/cart.html", text: "On the cart." }]);
    const shadow = run();
    click(shadow.querySelector('.co-mode[data-mode="review"]'));

    const row = shadow.querySelector(".co-row");
    expect(row?.textContent).toContain("cart");
    // Not "closed" and not "lost": the screen is simply not the one showing.
    expect(row?.textContent).not.toContain("closed");
    expect(row?.querySelector(".co-warn")).toBeNull();
  });

  it("reads a review written before frames back exactly as it was", () => {
    document.head.innerHTML = meta();
    document.body.innerHTML = `<p>Plain page.</p>`;
    seed([{ text: "Old." }]);
    run();
    const comment = stored()[0] as unknown as Record<string, unknown>;
    expect("frame" in comment).toBe(false);
    expect("froute" in comment).toBe(false);
  });
});

describe("a phone whose screens swap in place", () => {
  /*
   * The prototype keeps every screen in one document and shows one at a
   * time, so the frame's address is the same on all of them. Which screen
   * was up is the frame's own deck key, as a deck's page is at the top.
   */
  const SCREENS =
    `<section id="home"><button id="go">Profile</button><p>Home screen.</p></section>` +
    `<section id="profile" hidden><p>Your saved addresses.</p><button id="edit">Edit</button></section>`;

  function openRow(shadow: ShadowRoot, text: string): void {
    click(shadow.querySelector('.co-mode[data-mode="review"]'));
    const row = Array.from(shadow.querySelectorAll(".co-row")).find((r) =>
      r.textContent?.includes(text),
    );
    click(row ?? null);
  }

  it("records which screen the pin was dropped on", () => {
    const { frame, inner } = mountPhone(SCREENS);
    inner.getElementById("home")?.setAttribute("hidden", "");
    inner.getElementById("profile")?.removeAttribute("hidden");
    const plan = inner.querySelector("#profile p") as HTMLElement;
    boxed(plan, { left: 10, top: 10, width: 200, height: 40 });
    document.elementFromPoint = () => frame;
    inner.elementFromPoint = () => plan;
    const shadow = run();
    drop(shadow, 120, 70, "Name the address.");

    expect(stored()[0].fview).toBe("#profile");
  });

  it("turns the screen to the comment's page when its row is clicked", () => {
    const { inner } = mountPhone(SCREENS);
    seed([
      {
        text: "Name the address.",
        frame: "#screen",
        froute: null,
        fview: "#profile",
        block: blockId("p", "Your saved addresses."),
        blockText: "Your saved addresses.",
        rx: 0.5,
        ry: 0.5,
      },
    ]);
    const shadow = run();

    openRow(shadow, "Name the address.");
    expect(inner.getElementById("profile")?.hasAttribute("hidden")).toBe(false);
    expect(inner.getElementById("home")?.hasAttribute("hidden")).toBe(true);
    expect((shadow.querySelector(".co-pop") as HTMLElement).hidden).toBe(false);
  });

  it("keeps a pin left on another page of the screen off this one", () => {
    mountPhone(SCREENS);
    seed([
      { id: "home", frame: "#screen", froute: null, fview: "#home", x: 5, y: 5, fx: 0.1, fy: 0.1 },
      { id: "profile", frame: "#screen", froute: null, fview: "#profile", x: 5, y: 5, fx: 0.1, fy: 0.1 },
    ]);
    const shadow = run();
    expect(pins(shadow).map((p) => p.getAttribute("data-comment"))).toEqual(["home"]);
  });

  it("still goes to the page when the popup on it cannot be opened", () => {
    const { inner } = mountPhone(SCREENS);
    seed([
      {
        text: "In the alert.",
        frame: "#screen",
        froute: null,
        fview: "#profile",
        context: "~div.toast",
        x: 5,
        y: 5,
        cx: 0.5,
        cy: 0.5,
      },
    ]);
    const shadow = run();

    openRow(shadow, "In the alert.");
    // On the page, with the card saying what it is in.
    expect(inner.getElementById("profile")?.hasAttribute("hidden")).toBe(false);
    expect(shadow.querySelector(".co-shut")?.textContent).toContain("which is closed");
  });

  it("names the page in the panel", () => {
    mountPhone(SCREENS);
    seed([{ text: "A note.", frame: "#screen", froute: null, fview: "#profile" }]);
    const shadow = run();
    click(shadow.querySelector('.co-mode[data-mode="review"]'));
    expect(shadow.querySelector(".co-row-screen")?.textContent).toContain("profile");
  });
});

describe("a prototype embedded in a note", () => {
  /*
   * A note page is built from rendered Markdown and is not stamped at
   * runtime, so nothing on it opens or closes. The prototype in its frame
   * is an application like any other, and its sheets and popups have to be
   * tracked as they would be on a page of their own.
   */
  it("records the sheet a pin is in, and the tap that opened it", () => {
    const { frame, inner } = mountPhone(
      `<button id="open">Choose delivery</button>` +
        `<section class="sheet is-open"><label>Next day</label></section>`,
    );
    document.head.innerHTML = meta({ stamp: false, sourcePath: "See it working.md" });
    const label = inner.querySelector(".sheet label") as HTMLElement;
    boxed(label, { left: 40, top: 100, width: 200, height: 50 });
    document.elementFromPoint = () => frame;
    inner.elementFromPoint = () => label;
    const shadow = run();

    click(inner.getElementById("open"));
    drop(shadow, 212, 150, "Show the price sooner.");

    const comment = stored()[0];
    expect(comment.frame).toBe("#screen");
    expect(comment.context).toBe("~section.sheet");
    expect(comment.opener?.text).toBe("Choose delivery");
  });

  it("still records nothing opening on the note itself", () => {
    document.head.innerHTML = meta({ stamp: false, sourcePath: "See it working.md" });
    document.body.innerHTML = `<div class="callout"><p>A note's callout.</p></div><dialog open><p>Not an app.</p></dialog>`;
    document.elementFromPoint = () => document.querySelector("dialog p");
    const shadow = run();
    drop(shadow, 30, 30, "On the note.");

    expect(stored()[0].context ?? null).toBeNull();
  });
});

describe("a screen's own copy of the overlay", () => {
  it("stands down when the page around it is being reviewed", () => {
    const { frame, inner } = mountPhone(`<p>Home.</p>`);
    inner.head.innerHTML = meta({ sourcePath: "proto/home.html", page: "proto/home.html" });
    const view = frame.contentWindow as unknown as { eval(code: string): unknown };
    view.eval(overlayBundle());
    expect(inner.getElementById("osp-overlay-host")).toBeNull();
  });
});

describe("sheets and popups nobody named", () => {
  it("records an unnamed sheet as the thing a pin is in, without its state", () => {
    document.head.innerHTML = meta();
    document.body.innerHTML =
      `<main><p>The list.</p></main>` +
      `<section class="sheet is-open"><label>Only in stock</label></section>`;
    document.elementFromPoint = () => document.querySelector(".sheet label");
    const shadow = run();
    drop(shadow, 30, 30, "Default this to on?");

    expect(stored()[0].context).toBe("~section.sheet");
  });

  it("hides the pin when the popup is taken out of the document", async () => {
    document.head.innerHTML = meta();
    document.body.innerHTML =
      `<main><p>The list.</p></main>` +
      `<div class="popup"><div class="card"><button>Keep</button></div></div>`;
    seed([{ context: "~div.popup", block: null, x: 10, y: 10, cx: 0.5, cy: 0.5 }]);
    const shadow = run();
    expect(pins(shadow)).toHaveLength(1);

    document.querySelector(".popup")?.remove();
    await new Promise((done) => setTimeout(done, 220));
    expect(pins(shadow)).toHaveLength(0);

    click(shadow.querySelector('.co-mode[data-mode="review"]'));
    expect(shadow.querySelector(".co-row")?.textContent).toContain("popup (closed)");
  });

  it("does not take an ordinary wrapper for something that opens", () => {
    document.head.innerHTML = meta();
    document.body.innerHTML = `<div class="content"><span>Words.</span></div>`;
    document.elementFromPoint = () => document.querySelector(".content span");
    const shadow = run();
    drop(shadow, 30, 30, "Hm.");

    expect(stored()[0].context).toBeNull();
  });
});

describe("something moved out of sight rather than hidden", () => {
  /*
   * Layout switched on, as far as the overlay can tell: once the body has a
   * size, an element without one reads as hidden, so every element in the
   * chain is given one. The sheet's position is then the only thing that
   * decides whether its pin is drawn.
   */
  function withLayout(): () => void {
    const proto = HTMLElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, "offsetWidth");
    Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
    return () => {
      if (original) Object.defineProperty(proto, "offsetWidth", original);
    };
  }

  it("hides a pin on a sheet parked below the window", async () => {
    const undo = withLayout();
    try {
      document.head.innerHTML = meta();
      document.body.innerHTML =
        `<main><p>The list.</p></main>` +
        `<section class="sheet" style="position: fixed"><p>Only in stock</p></section>`;
      const sheet = document.querySelector(".sheet") as HTMLElement;
      const opt = document.querySelector(".sheet p") as HTMLElement;
      const below = window.innerHeight + 40;
      boxed(sheet, { left: 0, top: below, width: 400, height: 200 });
      boxed(opt, { left: 20, top: below + 20, width: 200, height: 30 });
      seed([
        {
          block: blockId("p", "Only in stock"),
          context: "~section.sheet",
          rx: 0.1,
          ry: 0.5,
          cx: 0.1,
          cy: 0.1,
        },
      ]);
      const shadow = run();
      expect(pins(shadow)).toHaveLength(0);

      // Slid up into the window: the pin is back once anything repaints.
      boxed(sheet, { left: 0, top: 300, width: 400, height: 200 });
      boxed(opt, { left: 20, top: 320, width: 200, height: 30 });
      window.dispatchEvent(new Event("resize"));
      await new Promise((done) => requestAnimationFrame(() => done(null)));
      await new Promise((done) => requestAnimationFrame(() => done(null)));
      expect(pins(shadow)).toHaveLength(1);
    } finally {
      undo();
    }
  });
});

describe("the rows of a list that scrolls", () => {
  it("stamps each row, so a pin follows its row as the list scrolls", () => {
    document.head.innerHTML = meta();
    document.body.innerHTML =
      `<div id="list" style="overflow-y: auto">` +
      `<div class="item"><span>Head torch</span></div>` +
      `<div class="item"><span>Sun hat</span></div>` +
      `</div>`;
    run();
    const rows = document.querySelectorAll("#list > .item");
    expect(rows[0].getAttribute("data-osp-block")).toBeTruthy();
    expect(rows[1].getAttribute("data-osp-block")).toBeTruthy();
    expect(rows[0].getAttribute("data-osp-block")).not.toBe(
      rows[1].getAttribute("data-osp-block"),
    );
  });

  it("leaves the rows of a box that does not scroll alone", () => {
    document.head.innerHTML = meta();
    document.body.innerHTML =
      `<div id="list"><div class="item"><span>Head torch</span></div>` +
      `<div class="item"><span>Sun hat</span></div></div>`;
    run();
    expect(document.querySelector("#list > .item")?.hasAttribute("data-osp-block")).toBe(false);
  });
});

describe("a route saved with the preview's token in it", () => {
  /*
   * Before the server took the token out of the address bar, the first page
   * a reviewer opened carried it, and a prototype records its address as the
   * screen a comment is on. The token changes every time the server starts.
   */
  it("still shows the pin once the token is gone from the address", () => {
    document.head.innerHTML = meta();
    document.body.innerHTML = `<p>The screen.</p>`;
    seed([
      { id: "old", route: "./?t=k3j9x2m8q1w7e5r4t6y0u2i8o3", x: 10, y: 10 },
      { id: "theirs", route: "./?t=dark", x: 10, y: 10 },
    ]);
    const shadow = run();
    // The app's own `t` is a real part of its address and is kept.
    expect(pins(shadow).map((p) => p.getAttribute("data-comment"))).toEqual(["old"]);
  });
});

describe("bringing back what a comment is about", () => {
  function openRow(shadow: ShadowRoot, text: string): void {
    click(shadow.querySelector('.co-mode[data-mode="review"]'));
    const row = Array.from(shadow.querySelectorAll(".co-row")).find((r) =>
      r.textContent?.includes(text),
    );
    click(row ?? null);
  }

  it("records what made the sheet open, and the tap that opened it", () => {
    document.head.innerHTML = meta();
    document.body.innerHTML =
      `<button id="filters">Filter and sort</button>` +
      `<section class="sheet is-open" data-state="open"><label>Only in stock</label></section>`;
    const shadow = run();
    // The reviewer taps the button that raised the sheet, then pins in it.
    click(document.getElementById("filters"));
    document.elementFromPoint = () => document.querySelector(".sheet label");
    drop(shadow, 30, 30, "Default this to on?");

    const comment = stored()[0];
    expect(comment.reveal?.[0]).toEqual({ class: "sheet is-open", "data-state": "open" });
    expect(comment.opener?.text).toBe("Filter and sort");
  });

  it("does not take a tap inside the sheet for the one that opened it", () => {
    document.head.innerHTML = meta();
    document.body.innerHTML =
      `<section class="sheet"><button id="inside">Price</button><label>Only in stock</label></section>`;
    const shadow = run();
    click(document.getElementById("inside"));
    document.elementFromPoint = () => document.querySelector(".sheet label");
    drop(shadow, 30, 30, "Hm.");

    expect(stored()[0].opener).toBeUndefined();
  });

  it("opens a closed sheet for the comment, and shuts it with the card", () => {
    document.head.innerHTML = meta();
    document.body.innerHTML =
      `<main><p>The list.</p></main>` +
      `<section class="sheet" hidden><label>Only in stock</label></section>`;
    seed([
      {
        text: "Default this to on?",
        context: "~section.sheet",
        reveal: [{ class: "sheet is-open" }],
        x: 10,
        y: 10,
        cx: 0.5,
        cy: 0.5,
      },
    ]);
    const shadow = run();
    const sheet = document.querySelector(".sheet") as HTMLElement;

    openRow(shadow, "Default this to on?");
    expect(sheet.hasAttribute("hidden")).toBe(false);
    expect(sheet.className).toBe("sheet is-open");
    expect(pins(shadow)).toHaveLength(1);

    click(shadow.querySelector('.co-pop .co-pop-btn[title="Close"]'));
    expect((shadow.querySelector(".co-pop") as HTMLElement).hidden).toBe(true);
    // Back the way the page had it.
    expect(sheet.hasAttribute("hidden")).toBe(true);
    expect(sheet.className).toBe("sheet");
  });

  it("offers to tap again for a popup that was taken out of the page", () => {
    document.head.innerHTML = meta();
    document.body.innerHTML = `<main><p>The list.</p><button id="remove">Remove</button></main>`;
    document.getElementById("remove")?.addEventListener("click", () => {
      const popup = document.createElement("div");
      popup.className = "popup";
      popup.innerHTML = `<button>Keep</button>`;
      document.body.appendChild(popup);
    });
    seed([
      {
        text: "Make Keep the default.",
        context: "~div.popup",
        opener: { block: blockId("button", "Remove"), text: "Remove" },
        x: 10,
        y: 10,
        cx: 0.5,
        cy: 0.5,
      },
    ]);
    const shadow = run();

    openRow(shadow, "Make Keep the default.");
    const note = shadow.querySelector(".co-shut");
    expect(note?.textContent).toContain("popup, which is closed");
    const again = shadow.querySelector("[data-reopen]");
    expect(again?.getAttribute("title")).toContain("Remove");

    click(again);
    expect(document.querySelectorAll(".popup")).toHaveLength(1);
  });

  describe("with Reopen set to run on its own", () => {
    function mountRemove(over: Record<string, unknown>): ShadowRoot {
      document.head.innerHTML = meta(over);
      document.body.innerHTML = `<main><p>The list.</p><button id="remove">Remove</button></main>`;
      document.getElementById("remove")?.addEventListener("click", () => {
        const popup = document.createElement("div");
        popup.className = "popup";
        popup.innerHTML = `<button>Keep</button>`;
        document.body.appendChild(popup);
      });
      seed([
        {
          text: "Make Keep the default.",
          context: "~div.popup",
          opener: { block: blockId("button", "Remove"), text: "Remove" },
          x: 10,
          y: 10,
          cx: 0.5,
          cy: 0.5,
        },
      ]);
      return run();
    }

    it("makes the tap when the comment is opened", () => {
      const shadow = mountRemove({ autoReopen: true });
      openRow(shadow, "Make Keep the default.");
      expect(document.querySelectorAll(".popup")).toHaveLength(1);
    });

    it("only offers it when the setting is off", () => {
      const shadow = mountRemove({});
      openRow(shadow, "Make Keep the default.");
      expect(document.querySelectorAll(".popup")).toHaveLength(0);
      expect(shadow.querySelector("[data-reopen]")).not.toBeNull();
    });

    it("does not tap for a sheet it can bring back by itself", () => {
      document.head.innerHTML = meta({ autoReopen: true });
      document.body.innerHTML =
        `<button id="filters">Filter and sort</button>` +
        `<section class="sheet" hidden><label>Only in stock</label></section>`;
      let taps = 0;
      document.getElementById("filters")?.addEventListener("click", () => taps++);
      seed([
        {
          text: "Default this to on?",
          context: "~section.sheet",
          reveal: [{ class: "sheet is-open" }],
          opener: { block: blockId("button", "Filter and sort"), text: "Filter and sort" },
          x: 10,
          y: 10,
          cx: 0.5,
          cy: 0.5,
        },
      ]);
      const shadow = run();
      openRow(shadow, "Default this to on?");
      expect(document.querySelector(".sheet")?.hasAttribute("hidden")).toBe(false);
      expect(taps).toBe(0);
    });
  });

  it("offers nothing to tap when there was no tap to remember, and says so", () => {
    document.head.innerHTML = meta();
    document.body.innerHTML = `<main><p>The list.</p></main>`;
    seed([{ text: "In a popup.", context: "~div.popup", x: 10, y: 10, cx: 0.5, cy: 0.5 }]);
    const shadow = run();

    openRow(shadow, "In a popup.");
    expect(shadow.querySelector(".co-shut")).not.toBeNull();
    expect(shadow.querySelector("[data-reopen]")).toBeNull();
    expect(shadow.querySelector(".co-shut-why")?.textContent).toContain("No tap was recorded");
  });

  it("says why when the tap it would make is not on this screen", () => {
    document.head.innerHTML = meta();
    document.body.innerHTML = `<main><p>The list.</p></main>`;
    seed([
      {
        text: "Elsewhere.",
        context: "~div.popup",
        opener: { block: blockId("button", "Show details"), text: "Show details" },
        x: 10,
        y: 10,
        cx: 0.5,
        cy: 0.5,
      },
    ]);
    const shadow = run();

    openRow(shadow, "Elsewhere.");
    expect(shadow.querySelector("[data-reopen]")).toBeNull();
    expect(shadow.querySelector(".co-shut-why")?.textContent).toContain(
      "“Show details”, which is not on this screen",
    );
  });

  /*
   * A page that redraws its controls with innerHTML on every change has
   * replaced the button that was tapped by the time the pin goes down.
   */
  it("remembers the tap that opened the sheet after the page redrew the button", () => {
    document.head.innerHTML = meta();
    document.body.innerHTML =
      `<div id="steps"><button>Filter and sort</button></div>` +
      `<section class="sheet is-open"><label>Only in stock</label></section>`;
    const shadow = run();
    const steps = document.getElementById("steps") as HTMLElement;
    click(steps.querySelector("button"));
    steps.innerHTML = `<button>Filter and sort</button>`;
    document.elementFromPoint = () => document.querySelector(".sheet label");
    drop(shadow, 30, 30, "Default this to on?");

    expect(stored()[0].opener).toEqual({
      block: blockId("button", "Filter and sort"),
      text: "Filter and sort",
    });
  });

  it("looks past taps inside the sheet to the one that opened it", () => {
    document.head.innerHTML = meta();
    document.body.innerHTML =
      `<button id="filters">Filter and sort</button>` +
      `<section class="sheet is-open"><button id="price">Price</button><label>Only in stock</label></section>`;
    const shadow = run();
    click(document.getElementById("filters"));
    click(document.getElementById("price"));
    document.elementFromPoint = () => document.querySelector(".sheet label");
    drop(shadow, 30, 30, "Default this to on?");

    expect(stored()[0].opener?.text).toBe("Filter and sort");
  });

  it("does not take a redrawn button inside the sheet for the opener", async () => {
    document.head.innerHTML = meta();
    document.body.innerHTML =
      `<section class="sheet is-open"><div id="row"><button>Price</button></div>` +
      `<label>Only in stock</label></section>`;
    const shadow = run();
    const row = document.getElementById("row") as HTMLElement;
    click(row.querySelector("button"));
    row.innerHTML = `<button>Price</button>`;
    // The redrawn button is stamped by the page watcher, which waits a beat.
    await new Promise((done) => setTimeout(done, 220));
    document.elementFromPoint = () => document.querySelector(".sheet label");
    drop(shadow, 30, 30, "Hm.");

    expect(stored()[0].opener).toBeUndefined();
  });
});

describe("a screen reached by taps, at the same address", () => {
  /*
   * A prototype that builds its detail screen in script when a row is
   * tapped, and never changes its address: the taps are the only way back.
   */
  function mountList(over: Record<string, unknown> = {}): { clicks: () => number } {
    document.head.innerHTML = meta(over);
    document.body.innerHTML =
      `<main id="app"><button id="row">Order 5</button><p>Your orders.</p></main>`;
    let count = 0;
    document.getElementById("row")?.addEventListener("click", () => {
      count++;
      (document.getElementById("app") as HTMLElement).innerHTML =
        `<h2>Order 5</h2><p>Return window: 30 days.</p>`;
    });
    return { clicks: () => count };
  }

  function openRow(shadow: ShadowRoot, text: string): void {
    click(shadow.querySelector('.co-mode[data-mode="review"]'));
    const row = Array.from(shadow.querySelectorAll(".co-row")).find((r) =>
      r.textContent?.includes(text),
    );
    click(row ?? null);
  }

  const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

  function seedDetail(): void {
    seed([
      {
        text: "Say how long.",
        block: blockId("p", "Return window: 30 days."),
        blockText: "Return window: 30 days.",
        trail: [{ block: blockId("button", "Order 5"), text: "Order 5" }],
        x: 10,
        y: 10,
      },
    ]);
  }

  it("records the taps that led to the screen", () => {
    mountList();
    const shadow = run();
    click(document.getElementById("row"));
    document.elementFromPoint = () => document.querySelector("#app p");
    drop(shadow, 30, 30, "Say how long.");

    expect(stored()[0].trail).toEqual([{ block: blockId("button", "Order 5"), text: "Order 5" }]);
  });

  it("starts the trail where the address last changed", () => {
    document.head.innerHTML = meta();
    document.body.innerHTML =
      `<button id="tab">Orders</button><button id="row">Order 5</button><p>Detail.</p>`;
    const shadow = run();
    click(document.getElementById("tab"));
    window.history.pushState({}, "", "/proto/phone.html?tab=orders");
    click(document.getElementById("row"));
    document.elementFromPoint = () => document.querySelector("p");
    drop(shadow, 30, 30, "Hm.");

    // The address takes the reviewer to the tab; only the tap after it is kept.
    expect(stored()[0].trail?.map((step) => step.text)).toEqual(["Order 5"]);
  });

  it("makes the taps again when the comment is opened", async () => {
    const page = mountList({ autoReopen: true });
    seedDetail();
    const shadow = run();
    openRow(shadow, "Say how long.");
    await wait(400);

    expect(page.clicks()).toBe(1);
    expect(document.querySelector("#app h2")?.textContent).toBe("Order 5");
  });

  it("makes no tap for a comment already on screen", async () => {
    const page = mountList({ autoReopen: true });
    (document.getElementById("app") as HTMLElement).innerHTML =
      `<h2>Order 5</h2><p>Return window: 30 days.</p>`;
    seedDetail();
    const shadow = run();
    openRow(shadow, "Say how long.");
    await wait(400);

    expect(page.clicks()).toBe(0);
  });

  it("walks to the screen, then opens the sheet on it once", async () => {
    mountList({ autoReopen: true });
    let opened = 0;
    document.getElementById("app")?.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).id !== "return") return;
      opened++;
      const sheet = document.createElement("div");
      sheet.className = "sheet";
      sheet.innerHTML = `<p>Pick a reason.</p>`;
      document.body.appendChild(sheet);
    });
    document.getElementById("row")?.addEventListener("click", () => {
      (document.getElementById("app") as HTMLElement).insertAdjacentHTML(
        "beforeend",
        `<button id="return">Return item</button>`,
      );
    });
    seed([
      {
        text: "Add a reason.",
        context: "~div.sheet",
        block: blockId("p", "Pick a reason."),
        blockText: "Pick a reason.",
        opener: { block: blockId("button", "Return item"), text: "Return item" },
        trail: [
          { block: blockId("button", "Order 5"), text: "Order 5" },
          { block: blockId("button", "Return item"), text: "Return item" },
        ],
        x: 10,
        y: 10,
        cx: 0.5,
        cy: 0.5,
      },
    ]);
    const shadow = run();
    openRow(shadow, "Add a reason.");
    await wait(600);

    expect(document.querySelectorAll(".sheet")).toHaveLength(1);
    expect(opened).toBe(1);
  });

  it("makes no tap when the owner turned tapping off", async () => {
    const page = mountList();
    seedDetail();
    const shadow = run();
    openRow(shadow, "Say how long.");
    await wait(400);

    expect(page.clicks()).toBe(0);
  });
});

describe("two sheets that share a key", () => {
  /*
   * Every sheet in a prototype is a `section.sheet`. A comment in one is
   * not open because another one is.
   */
  function mountSheets(): void {
    document.head.innerHTML = meta();
    document.body.innerHTML =
      `<main><p>The list.</p></main>` +
      `<section class="sheet" hidden><label>Only in stock</label></section>` +
      `<section class="sheet is-open"><button>Copy link</button></section>`;
  }

  it("reads as closed, not lost, while the other sheet is up, and opens its own", () => {
    mountSheets();
    seed([
      {
        text: "Default this to on?",
        block: blockId("label", "Only in stock"),
        blockText: "Only in stock",
        context: "~section.sheet",
        reveal: [{ class: "sheet is-open" }],
        x: 10,
        y: 10,
        rx: 0.5,
        ry: 0.5,
        cx: 0.5,
        cy: 0.5,
      },
    ]);
    const shadow = run();
    const [filters, share] = Array.from(document.querySelectorAll(".sheet")) as HTMLElement[];

    click(shadow.querySelector('.co-mode[data-mode="review"]'));
    const row = shadow.querySelector(".co-row");
    expect(row?.hasAttribute("data-orphan")).toBe(false);
    expect(row?.textContent).toContain("(closed)");

    click(row);
    // The sheet the comment is in, not the first one with its key.
    expect(filters.hasAttribute("hidden")).toBe(false);
    expect(share.className).toBe("sheet is-open");
    expect(shadow.querySelector(".co-pop")?.textContent).not.toContain("rewritten");
  });

  it("says the block may be in a different sheet when it cannot be found", () => {
    document.head.innerHTML = meta();
    document.body.innerHTML =
      `<main><p>The list.</p></main>` +
      `<section class="sheet is-open"><button>Copy link</button></section>`;
    seed([
      {
        text: "Gone with its sheet.",
        block: blockId("label", "Only in stock"),
        blockText: "Only in stock",
        context: "~section.sheet",
        x: 10,
        y: 10,
        cx: 0.5,
        cy: 0.5,
      },
    ]);
    const shadow = run();
    click(shadow.querySelector('.co-mode[data-mode="review"]'));
    click(shadow.querySelector(".co-row"));

    const warn = shadow.querySelector(".co-pop .co-pop-note .co-warn")?.textContent ?? "";
    expect(warn).toContain("It may be in a different one");
  });
});
