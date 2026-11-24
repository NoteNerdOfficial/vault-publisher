// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { overlayBundle } from "./overlayScript";
import { EDIT_CSS, EDIT_SCRIPT } from "./editScript";

/**
 * The edit notch in the browser, against the real overlay. jsdom has no
 * layout, so every box is zero-sized: nothing is "page-sized", and a click
 * selects the outermost element under body that holds the target, which is
 * the rule with the sizes taken out.
 */

function meta(): string {
  return `<meta name="osp-review" content='${JSON.stringify({
    sourcePath: "Protos/deck.html",
    page: "proto/index.html",
    site: "Deck",
    reviewer: "Reviewer",
    stamp: true,
  })}'>`;
}

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[];
let answers: Array<{ status: number; body: unknown }>;

function boot(ok = true): void {
  (window as unknown as { __ospEditBoot: unknown }).__ospEditBoot = {
    page: "proto/index.html",
    hash: "h0",
    ok,
    reason: ok ? undefined : "The file has changed since this preview was built.",
  };
  new Function("EDIT_CSS", EDIT_SCRIPT)(EDIT_CSS);
  new Function(overlayBundle())();
}

function shadow(): ShadowRoot {
  const host = document.getElementById("osp-overlay-host");
  if (!host?.shadowRoot) throw new Error("the overlay did not mount");
  return host.shadowRoot;
}

function click(target: Element | null, init: MouseEventInit = {}): void {
  if (!target) throw new Error("nothing to click");
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, ...init }));
}

function key(name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(event);
  return event;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/*
 * By the mode button, not the E key: every earlier test's overlay is still
 * listening on the document, and a key would wake their edit modes too.
 */
function enter(): void {
  click(shadow().querySelector('.co-mode[data-mode="edit"]'));
}

function status(): string {
  return shadow().querySelector(".ed-status")?.textContent ?? "";
}

beforeEach(() => {
  calls = [];
  answers = [];
  sessionStorage.clear();
  localStorage.clear();
  window.requestAnimationFrame = ((fn: FrameRequestCallback) => setTimeout(() => fn(0), 1000) as unknown as number);
  window.cancelAnimationFrame = (id: number) => clearTimeout(id);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url === "/api/edit") {
        calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        const answer = answers.shift() ?? { status: 500, body: { error: "no answer queued" } };
        return new Response(JSON.stringify(answer.body), { status: answer.status });
      }
      return new Response("{}", { status: 404 });
    }),
  );
  document.head.innerHTML = meta();
  document.body.innerHTML = [
    '<section data-osp-src="100" class="slide">',
    '<h1 data-osp-src="130">Title</h1>',
    '<p data-osp-src="160" id="lede">Words</p>',
    '<a data-osp-src="190" href="#next">Next</a>',
    "</section>",
  ].join("");
});

afterEach(() => {
  (window as unknown as { __ospEdit?: { exit(): void } }).__ospEdit?.exit();
  delete (window as unknown as { __ospEdit?: unknown }).__ospEdit;
  delete (window as unknown as { __ospEditBoot?: unknown }).__ospEditBoot;
  document.getElementById("osp-overlay-host")?.remove();
  vi.unstubAllGlobals();
});

describe("the edit mode", () => {
  it("joins the notch as a fourth mode, and only when the server sent it", () => {
    boot();
    const modes = shadow().querySelectorAll(".co-mode");
    expect(modes).toHaveLength(4);
    expect(modes[3].getAttribute("data-mode")).toBe("edit");
  });

  it("is not there on a page without the edit script", () => {
    new Function(overlayBundle())();
    expect(shadow().querySelectorAll(".co-mode")).toHaveLength(3);
    expect(shadow().querySelector('.co-mode[data-mode="edit"]')).toBeNull();
  });

  it("takes clicks away from the page and selects instead", () => {
    boot();
    enter();
    const followed = vi.fn();
    document.querySelector("a")!.addEventListener("click", followed);
    click(document.querySelector("a"));
    expect(followed).not.toHaveBeenCalled();
    expect(shadow().querySelector(".ed-crumb[data-current]")?.textContent).toBe("section.slide");
  });

  it("goes inside on a double-click, and back up with Esc", () => {
    boot();
    enter();
    const h1 = document.querySelector("h1")!;
    click(h1);
    h1.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(shadow().querySelector(".ed-crumb[data-current]")?.textContent).toBe("h1");
    // Siblings at that depth are now one click away.
    click(document.querySelector("p"));
    expect(shadow().querySelector(".ed-crumb[data-current]")?.textContent).toBe("p#lede");
    key("Escape");
    expect(shadow().querySelector(".ed-crumb[data-current]")?.textContent).toBe("section.slide");
  });

  it("selects the card beside the one being worked in, not the whole page", () => {
    document.body.innerHTML =
      '<main data-osp-src="10"><section data-osp-src="20" class="pay"><button data-osp-src="30">Pay</button></section>' +
      '<section data-osp-src="60" class="order"><h2 data-osp-src="70">Order</h2></section></main>';
    boot();
    enter();
    const button = document.querySelector("button")!;
    click(button);
    button.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(shadow().querySelector(".ed-crumb[data-current]")?.textContent).toBe("button");
    click(document.querySelector("h2"));
    expect(shadow().querySelector(".ed-crumb[data-current]")?.textContent).toBe("section.order");
  });

  it("keeps the page's own keys from running, and lets the overlay's through", () => {
    boot();
    enter();
    const turned = vi.fn();
    document.addEventListener("keydown", turned);
    key("ArrowRight");
    expect(turned).not.toHaveBeenCalled();
    key("v");
    expect(shadow().querySelector('.co-mode[data-mode="view"]')?.hasAttribute("data-active")).toBe(true);
    document.removeEventListener("keydown", turned);
  });

  it("deletes through the plugin, moves the stamps, and undoes", async () => {
    boot();
    enter();
    const h1 = document.querySelector("h1")!;
    click(h1);
    h1.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));

    answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [{ start: 125, end: 155, length: 0 }] } });
    key("Delete");
    await settle();

    expect(calls[0].body).toMatchObject({ page: "proto/index.html", hash: "h0", op: "delete", at: 130 });
    expect(document.querySelector("h1")).toBeNull();
    expect(document.querySelector("p")!.getAttribute("data-osp-src")).toBe("130");
    expect(status()).toContain("Deleted h1");

    answers.push({ status: 200, body: { hash: "h0", edits: [{ start: 125, end: 125, length: 30 }] } });
    key("z", { metaKey: true });
    await settle();

    expect(calls[1].body).toMatchObject({ op: "undo", id: "e1", hash: "h1" });
    const restored = document.querySelector("h1")!;
    expect(restored.nextElementSibling?.tagName).toBe("P");
    expect(restored.getAttribute("data-osp-src")).toBe("130");
    expect(document.querySelector("p")!.getAttribute("data-osp-src")).toBe("160");
  });

  it("asks twice before deleting something the page's script names", async () => {
    document.body.insertAdjacentHTML("beforeend", `<script>document.getElementById("lede")</script>`);
    boot();
    enter();
    const p = document.querySelector("p")!;
    click(p);
    p.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    key("Delete");
    await settle();
    expect(calls).toHaveLength(0);
    expect(status()).toContain("#lede");

    answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [{ start: 160, end: 190, length: 0 }] } });
    key("Delete");
    await settle();
    expect(calls).toHaveLength(1);
  });

  it("will not edit an element a script made, and says so", () => {
    document.querySelector("section")!.insertAdjacentHTML("beforeend", "<div class=made>Made</div>");
    boot();
    enter();
    const made = document.querySelector(".made")!;
    click(made, { altKey: true });
    expect(status()).toContain("Made by the page's script");
    expect(status()).toContain("rule for div.made");
    expect((shadow().querySelector(".ed-danger") as HTMLButtonElement).disabled).toBe(true);
  });

  it("stops at a conflict and offers a reload", async () => {
    boot();
    enter();
    click(document.querySelector("h1"), { altKey: true });
    answers.push({ status: 409, body: { conflict: true, error: "The file has changed since this page loaded." } });
    key("Delete");
    await settle();
    expect(document.querySelector("h1")).not.toBeNull();
    expect(status()).toContain("changed since this page loaded");
    expect((shadow().querySelector(".ed-danger") as HTMLButtonElement).disabled).toBe(true);
  });

  it("explains a page it cannot edit, and edits nothing", async () => {
    boot(false);
    enter();
    click(document.querySelector("h1"), { altKey: true });
    key("Delete");
    await settle();
    expect(calls).toHaveLength(0);
    expect(status()).toContain("changed since this preview was built");
  });

  it("duplicates the selection, re-stamps the copy, and undoes", async () => {
    boot();
    enter();
    click(document.querySelector("p"), { altKey: true });
    answers.push({
      status: 200,
      body: { id: "e1", hash: "h1", edits: [{ start: 190, end: 190, length: 30 }], relocated: [[160, 190]] },
    });
    key("d", { metaKey: true });
    await settle();

    expect(calls[0].body).toMatchObject({ op: "duplicate", at: 160 });
    const ps = document.querySelectorAll("p");
    expect(ps).toHaveLength(2);
    expect(ps[1].getAttribute("data-osp-src")).toBe("190");
    expect(document.querySelector("a")!.getAttribute("data-osp-src")).toBe("220");
    expect(status()).toContain("repeats the original's id");
    expect(shadow().querySelector(".ed-crumb[data-current]")?.textContent).toBe("p#lede");

    answers.push({ status: 200, body: { hash: "h0", edits: [{ start: 190, end: 220, length: 0 }] } });
    key("z", { metaKey: true });
    await settle();
    expect(document.querySelectorAll("p")).toHaveLength(1);
    expect(document.querySelector("a")!.getAttribute("data-osp-src")).toBe("190");
  });

  it("moves the selection one place with an arrow key, and undoes it", async () => {
    boot();
    enter();
    click(document.querySelector("h1"), { altKey: true });
    // h1 [130,160) goes after p [160,190): removed, then put back at 190.
    answers.push({
      status: 200,
      body: {
        id: "e1",
        hash: "h1",
        edits: [
          { start: 130, end: 160, length: 0 },
          { start: 190, end: 190, length: 30 },
        ],
        relocated: [[130, 160]],
      },
    });
    key("ArrowDown");
    await settle();

    expect(calls[0].body).toMatchObject({ op: "move", at: 130, target: 160, place: "after" });
    const order = () => Array.from(document.querySelectorAll("section > *")).map((n) => n.tagName);
    expect(order()).toEqual(["P", "H1", "A"]);
    expect(document.querySelector("p")!.getAttribute("data-osp-src")).toBe("130");
    expect(document.querySelector("h1")!.getAttribute("data-osp-src")).toBe("160");
    expect(document.querySelector("a")!.getAttribute("data-osp-src")).toBe("190");

    answers.push({
      status: 200,
      body: {
        hash: "h0",
        edits: [
          { start: 130, end: 130, length: 30 },
          { start: 160, end: 190, length: 0 },
        ],
      },
    });
    key("z", { metaKey: true });
    await settle();
    expect(order()).toEqual(["H1", "P", "A"]);
    expect(document.querySelector("h1")!.getAttribute("data-osp-src")).toBe("130");
    expect(document.querySelector("p")!.getAttribute("data-osp-src")).toBe("160");
  });

  it("says so rather than moving past the end", () => {
    boot();
    enter();
    click(document.querySelector("a"), { altKey: true });
    key("ArrowRight");
    expect(calls).toHaveLength(0);
    expect(status()).toContain("already last");
  });

  it("retypes an element's words, and puts them back on undo", async () => {
    boot();
    enter();
    const h1 = document.querySelector("h1")!;
    click(h1, { altKey: true });
    key("Enter");
    expect(h1.getAttribute("contenteditable")).toBeTruthy();
    h1.textContent = "New title";
    answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [{ start: 134, end: 139, length: 9 }] } });
    h1.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();

    expect(calls[0].body).toMatchObject({ op: "text", at: 130, text: "New title" });
    expect(h1.hasAttribute("contenteditable")).toBe(false);
    expect(h1.textContent).toBe("New title");
    expect(document.querySelector("p")!.getAttribute("data-osp-src")).toBe("164");

    answers.push({ status: 200, body: { hash: "h0", edits: [{ start: 134, end: 143, length: 5 }] } });
    key("z", { metaKey: true });
    await settle();
    expect(h1.textContent).toBe("Title");
    expect(document.querySelector("p")!.getAttribute("data-osp-src")).toBe("160");
  });

  it("keeps the page's keys and the overlay's letters out of the words being typed", () => {
    boot();
    enter();
    const h1 = document.querySelector("h1")!;
    click(h1, { altKey: true });
    key("Enter");
    const page = vi.fn();
    document.addEventListener("keydown", page);
    h1.dispatchEvent(new KeyboardEvent("keydown", { key: "v", bubbles: true, cancelable: true }));
    expect(page).not.toHaveBeenCalled();
    expect(shadow().querySelector('.co-mode[data-mode="edit"]')?.hasAttribute("data-active")).toBe(true);
    document.removeEventListener("keydown", page);
  });

  it("types a space into a button instead of pressing it", () => {
    document.querySelector("section")!.insertAdjacentHTML("beforeend", '<button data-osp-src="300">Pay</button>');
    boot();
    enter();
    const button = document.querySelector("button[data-osp-src]")!;
    click(button, { altKey: true });
    key("Enter");
    const pressed = vi.fn();
    button.addEventListener("click", pressed);
    const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    button.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    // And a click inside the words being typed does not press it either.
    const inside = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(inside);
    expect(inside.defaultPrevented).toBe(true);
    expect(pressed).not.toHaveBeenCalled();
  });

  it("cancels typing with Esc and sends nothing", async () => {
    boot();
    enter();
    const h1 = document.querySelector("h1")!;
    click(h1, { altKey: true });
    key("Enter");
    h1.textContent = "Scrap that";
    h1.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await settle();
    expect(calls).toHaveLength(0);
    expect(h1.textContent).toBe("Title");
  });

  it("puts the words back when the file refuses them", async () => {
    boot();
    enter();
    const h1 = document.querySelector("h1")!;
    click(h1, { altKey: true });
    key("Enter");
    h1.textContent = "Refused";
    answers.push({ status: 422, body: { error: "This holds more than plain text." } });
    h1.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    expect(h1.textContent).toBe("Title");
    expect(status()).toContain("more than plain text");
  });

  it("will not retype an element that holds other elements", () => {
    boot();
    enter();
    click(document.querySelector("section"));
    expect((shadow().querySelectorAll(".ed-btn")[0] as HTMLButtonElement).textContent).toBe("Edit text");
    expect((shadow().querySelectorAll(".ed-btn")[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("drags the selection to a new place and shows where it will land", async () => {
    boot();
    enter();
    const h1 = document.querySelector("h1")!;
    const a = document.querySelector("a")!;
    click(h1, { altKey: true });
    // No layout in jsdom: the link is stood up as a box, and hit-testing
    // answers with it.
    a.getBoundingClientRect = () =>
      ({ left: 0, top: 100, width: 200, height: 40, right: 200, bottom: 140, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect;
    document.elementsFromPoint = () => [a];

    const at = (type: string, x: number, y: number) =>
      h1.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    at("pointerdown", 10, 10);
    // The link is inline, so its right half means "after it".
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 150, clientY: 130 }));
    expect(shadow().querySelector(".ed-drop")?.hasAttribute("hidden")).toBe(false);

    answers.push({
      status: 200,
      body: {
        id: "e1",
        hash: "h1",
        edits: [
          { start: 130, end: 160, length: 0 },
          { start: 220, end: 220, length: 30 },
        ],
        relocated: [[130, 190]],
      },
    });
    at("pointerup", 150, 130);
    at("click", 150, 130);
    await settle();

    expect(calls[0].body).toMatchObject({ op: "move", at: 130, target: 190, place: "after" });
    expect(Array.from(document.querySelectorAll("section > *")).map((n) => n.tagName)).toEqual(["P", "A", "H1"]);
    // The click that ended the drag did not change the selection.
    expect(shadow().querySelector(".ed-crumb[data-current]")?.textContent).toBe("h1");
  });

  describe("colour", () => {
    function page(css: string, body: string): void {
      document.head.innerHTML = meta() + `<style data-osp-src="10">${css}</style>`;
      document.body.innerHTML = body;
      window.matchMedia = ((q: string) => ({ matches: true, media: q })) as unknown as typeof window.matchMedia;
    }

    function openColour(target: Element): void {
      boot();
      enter();
      click(target, { altKey: true });
      const colour = Array.from(shadow().querySelectorAll(".ed-btn")).find((b) => b.textContent === "Colour")!;
      click(colour);
    }

    function pick(value: string): void {
      const input = shadow().querySelector(".ed-custom") as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function answer(label: string): void {
      const b = Array.from(shadow().querySelectorAll(".ed-ask .ed-btn")).find((x) => x.textContent === label);
      if (!b) throw new Error(`no ${label}: ${shadow().querySelector(".ed-ask")?.textContent}`);
      click(b);
    }

    it("asks before changing a rule other elements share, then changes the rule", async () => {
      page(
        "button { background-color: #3a5bd9; }",
        '<button data-osp-src="100">Pay</button><button data-osp-src="140">Back</button>',
      );
      openColour(document.querySelector("button")!);
      pick("#00aa77");
      expect(calls).toHaveLength(0);
      expect(shadow().querySelector(".ed-ask")?.textContent).toContain("of 2 elements");

      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [{ start: 40, end: 47, length: 7 }] } });
      answer("All 2");
      await settle();
      expect(calls[0].body).toMatchObject({
        op: "rule-style",
        sheet: 10,
        path: [0],
        selector: "button",
        props: [["background-color", "#00aa77"]],
      });
      const rule = (document.styleSheets[0].cssRules[0] as CSSStyleRule).style;
      expect(rule.getPropertyValue("background-color")).toMatch(/#00aa77|rgb\(0, 170, 119\)/);

      answers.push({ status: 200, body: { hash: "h0", edits: [{ start: 40, end: 47, length: 7 }] } });
      key("z", { metaKey: true });
      await settle();
      expect(rule.getPropertyValue("background-color")).toMatch(/#3a5bd9|rgb\(58, 91, 217\)/);
    });

    it("sets it on the one element when asked to", async () => {
      page("button { background-color: #3a5bd9; }", '<button data-osp-src="100">Pay</button><button data-osp-src="140">Back</button>');
      const first = document.querySelector("button")!;
      openColour(first);
      pick("#00aa77");
      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [{ start: 107, end: 107, length: 30 }] } });
      answer("This one");
      await settle();
      expect(calls[0].body).toMatchObject({ op: "inline-style", at: 100, props: [["background-color", "#00aa77"]] });
      expect(first.style.getPropertyValue("background-color")).toMatch(/#00aa77|rgb\(0, 170, 119\)/);
    });

    it("offers to change the token a colour comes from", async () => {
      page(
        ":root { --accent: #3a5bd9; } .cta { background-color: var(--accent); }",
        '<a class="cta" data-osp-src="100">Go</a>',
      );
      openColour(document.querySelector(".cta")!);
      pick("#e44400");
      expect(shadow().querySelector(".ed-ask")?.textContent).toContain("--accent");
      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [{ start: 28, end: 35, length: 7 }] } });
      answer("Change --accent");
      await settle();
      expect(calls[0].body).toMatchObject({ op: "rule-style", path: [0], selector: ":root", props: [["--accent", "#e44400"]] });
    });

    it("changes a rule that styles only this element without asking", async () => {
      page(".only { color: #111111; }", '<p class="only" data-osp-src="100">Words</p>');
      openColour(document.querySelector(".only")!);
      const text = Array.from(shadow().querySelectorAll(".ed-tab")).find((t) => t.textContent === "Text")!;
      click(text);
      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [{ start: 30, end: 37, length: 7 }] } });
      pick("#222222");
      await settle();
      expect(calls[0].body).toMatchObject({ op: "rule-style", selector: ".only", props: [["color", "#222222"]] });
    });

    it("offers the page's tokens as swatches that write var()", () => {
      page(":root { --accent: #3a5bd9; --gap: 12px; }", '<p data-osp-src="100">Words</p>');
      openColour(document.querySelector("p")!);
      const titles = Array.from(shadow().querySelectorAll(".ed-swatch")).map((b) => b.getAttribute("title"));
      expect(titles.some((t) => t?.startsWith("--accent"))).toBe(true);
      // A length is not a colour.
      expect(titles.some((t) => t?.startsWith("--gap"))).toBe(false);
    });
  });

  describe("size and layout", () => {
    function page(css: string, body: string): void {
      document.head.innerHTML = meta() + `<style data-osp-src="10">${css}</style>`;
      document.body.innerHTML = body;
      window.matchMedia = ((q: string) => ({ matches: true, media: q })) as unknown as typeof window.matchMedia;
    }

    function open(target: Element, panel: "Size" | "Layout"): void {
      boot();
      enter();
      click(target, { altKey: true });
      click(Array.from(shadow().querySelectorAll(".ed-actions .ed-btn")).find((b) => b.textContent === panel)!);
    }

    function press(rowLabel: string, text: string): void {
      const row = Array.from(shadow().querySelectorAll(".ed-panel:not([hidden]) .ed-row")).find(
        (r) => r.querySelector(".ed-row-label")?.textContent === rowLabel,
      );
      const b = Array.from(row?.querySelectorAll(".ed-btn") ?? []).find((x) => x.textContent === text);
      if (!b) throw new Error(`no ${text} in ${rowLabel}`);
      click(b);
    }

    it("makes an item Fill its flex row with flex, not a width", async () => {
      page(".row { display: flex; }", '<div class="row" data-osp-src="100"><span data-osp-src="120">a</span></div>');
      open(document.querySelector("span")!, "Size");
      expect(shadow().querySelector(".ed-note")?.textContent).toContain("flex row");
      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [] } });
      press("Width", "Fill");
      await settle();
      expect(calls[0].body).toMatchObject({ op: "inline-style", at: 120, props: [["width", "auto"], ["flex", "1 1 0%"]] });
    });

    it("makes a grid item Hug with justify-self", async () => {
      page(".g { display: grid; }", '<div class="g" data-osp-src="100"><p data-osp-src="120">a</p></div>');
      open(document.querySelector("p")!, "Size");
      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [] } });
      press("Width", "Hug");
      await settle();
      expect(calls[0].body).toMatchObject({ props: [["width", "auto"], ["justify-self", "start"]] });
    });

    it("fixes a size typed in pixels, taking the item out of flex growth", async () => {
      page(".row { display: flex; }", '<div class="row" data-osp-src="100"><span data-osp-src="120">a</span></div>');
      open(document.querySelector("span")!, "Size");
      const input = shadow().querySelector('.ed-num[aria-label="Width in pixels"]') as HTMLInputElement;
      input.value = "240";
      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [] } });
      input.dispatchEvent(new Event("change"));
      await settle();
      expect(calls[0].body).toMatchObject({ props: [["width", "240px"], ["flex", "0 0 auto"]] });
    });

    it("writes a size to the rule when that rule styles only this element", async () => {
      page(".hero { width: 300px; }", '<section class="hero" data-osp-src="100"><p data-osp-src="130">x</p></section>');
      open(document.querySelector(".hero")!, "Size");
      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [] } });
      press("Width", "Fill");
      await settle();
      expect(calls[0].body).toMatchObject({ op: "rule-style", selector: ".hero", props: [["width", "auto"]] });
    });

    it("turns a container into a row, then sets its gap", async () => {
      page("", '<div data-osp-src="100"><p data-osp-src="110">a</p><p data-osp-src="130">b</p></div>');
      open(document.querySelector("div")!, "Layout");
      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [] } });
      press("Arrange", "Row");
      await settle();
      expect(calls[0].body).toMatchObject({ op: "inline-style", at: 100, props: [["display", "flex"], ["flex-direction", "row"]] });

      const gap = shadow().querySelector('.ed-num[aria-label="Gap in pixels"]') as HTMLInputElement;
      gap.value = "16";
      answers.push({ status: 200, body: { id: "e2", hash: "h2", edits: [] } });
      gap.dispatchEvent(new Event("change"));
      await settle();
      expect(calls[1].body).toMatchObject({ props: [["gap", "16px"]] });
    });

    it("detaches an element into absolute position only when asked", async () => {
      page("", '<main data-osp-src="100"><p data-osp-src="110">a</p></main>');
      const p = document.querySelector("p")!;
      open(p, "Size");
      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [] } });
      click(Array.from(shadow().querySelectorAll(".ed-panel .ed-btn")).find((b) => b.textContent === "Detach from layout")!);
      await settle();
      const props = (calls[0].body.props as string[][]).map((pair) => pair[0]);
      expect(props).toEqual(["position", "left", "top", "width"]);
    });

    it("resizes by the handle and writes the size it was left at", async () => {
      page("", '<main data-osp-src="100"><p data-osp-src="110">a</p></main>');
      const p = document.querySelector("p") as HTMLElement;
      // The box follows the preview width the handle sets, as layout would.
      p.getBoundingClientRect = () => {
        const w = parseFloat(p.style.width) || 100;
        return { left: 0, top: 0, width: w, height: 40, right: w, bottom: 40, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      };
      boot();
      enter();
      click(p, { altKey: true });
      const grip = shadow().querySelector(".ed-handle-e")!;
      grip.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 100, clientY: 20 }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 160, clientY: 20 }));
      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [] } });
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: 160, clientY: 20 }));
      await settle();
      expect(calls[0].body).toMatchObject({ op: "inline-style", at: 110, props: [["width", "160px"]] });
      // The preview width came off; the written one went on.
      expect(p.style.width).toBe("160px");
    });
  });

  describe("script-built elements and widths", () => {
    function page(css: string, body: string): void {
      document.head.innerHTML = meta() + `<style data-osp-src="10">${css}</style>`;
      document.body.innerHTML = body;
      window.matchMedia = ((q: string) => ({ matches: true, media: q })) as unknown as typeof window.matchMedia;
    }

    function actionButton(text: string): HTMLButtonElement {
      return Array.from(shadow().querySelectorAll(".ed-actions .ed-btn")).find((b) => b.textContent === text) as HTMLButtonElement;
    }

    function pickColour(value: string): void {
      click(actionButton("Colour"));
      const input = shadow().querySelector(".ed-custom") as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event("change"));
    }

    it("styles an element the script made through a rule that names every one like it", async () => {
      page(".x { color: red; }", '<ul id="todos" data-osp-src="100"></ul>');
      const list = document.querySelector("ul")!;
      list.innerHTML = '<li class="todo is-done">a</li><li class="todo">b</li>';
      boot();
      enter();
      click(list.querySelector("li")!, { altKey: true });

      expect(status()).toContain("rule for li.todo");
      expect(status()).toContain("all 2 elements");
      expect(actionButton("Delete").disabled).toBe(true);
      expect(actionButton("Colour").disabled).toBe(false);

      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [{ start: 40, end: 40, length: 20 }] } });
      pickColour("#00aa77");
      await settle();
      // The state class is left out: the rule is for the kind of thing.
      expect(calls[0].body).toMatchObject({ op: "add-rule", sheet: 10, selector: "li.todo", props: [["background-color", "#00aa77"]] });
      const rules = document.querySelector("style")!.sheet!.cssRules;
      expect((rules[rules.length - 1] as CSSStyleRule).selectorText).toBe("li.todo");

      answers.push({ status: 200, body: { hash: "h0", edits: [{ start: 40, end: 60, length: 0 }] } });
      key("z", { metaKey: true });
      await settle();
      expect(document.querySelector("style")!.sheet!.cssRules).toHaveLength(1);
    });

    it("changes the file's own rule for script-made elements when it has one", async () => {
      page(".todo { background-color: #fff; }", '<ul id="todos" data-osp-src="100"></ul>');
      const list = document.querySelector("ul")!;
      list.innerHTML = '<li class="todo">a</li><li class="todo">b</li>';
      boot();
      enter();
      click(list.querySelector("li")!, { altKey: true });
      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [] } });
      pickColour("#eeeeee");
      await settle();
      expect(calls[0].body).toMatchObject({ op: "rule-style", selector: ".todo", props: [["background-color", "#eeeeee"]] });
    });

    it("warns when the page's script restyles an element, and not for the notch's own changes", async () => {
      page("", '<main data-osp-src="100"><p data-osp-src="110">a</p><p data-osp-src="130">b</p></main>');
      boot();
      const [first, second] = Array.from(document.querySelectorAll("p"));
      // The page's script, after the notch's observer started.
      first.classList.add("flash");
      await settle();
      enter();
      click(first, { altKey: true });
      expect(status()).toContain("changes its classes");

      click(second, { altKey: true });
      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [] } });
      pickColour("#123456");
      await settle();
      click(first, { altKey: true });
      click(second, { altKey: true });
      expect(status()).not.toContain("script changes");
    });

    it("offers a width scope on a page that has width queries, and writes into @media", async () => {
      page("@media (max-width: 600px) { .x { color: red; } }", '<p class="lede" data-osp-src="100">a</p>');
      boot();
      enter();
      click(document.querySelector("p")!, { altKey: true });
      const scope = shadow().querySelector(".ed-scope") as HTMLElement;
      expect(scope.hidden).toBe(false);
      click(Array.from(scope.querySelectorAll(".ed-btn")).find((b) => b.textContent?.startsWith("Up to"))!);

      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [] } });
      pickColour("#ff0000");
      await settle();
      expect(calls[0].body).toMatchObject({
        op: "add-rule",
        selector: "p.lede",
        media: `(max-width: ${window.innerWidth}px)`,
        props: [["background-color", "#ff0000"]],
      });

      answers.push({ status: 200, body: { id: "e2", hash: "h2", edits: [] } });
      click(actionButton("Hide"));
      await settle();
      expect(calls[1].body).toMatchObject({ op: "add-rule", props: [["display", "none"]] });
    });

    it("keeps the width scope out of a page that has none", () => {
      page(".x { color: red; }", '<p class="lede" data-osp-src="100">a</p>');
      boot();
      enter();
      click(document.querySelector("p")!, { altKey: true });
      expect((shadow().querySelector(".ed-scope") as HTMLElement).hidden).toBe(true);
    });
  });

  describe("redo, Space, mixed words, drops", () => {
    it("redoes an undone delete exactly as it happened", async () => {
      boot();
      enter();
      click(document.querySelector("h1"), { altKey: true });
      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [{ start: 125, end: 155, length: 0 }], undo: 1, redo: 0 } });
      key("Delete");
      await settle();
      answers.push({ status: 200, body: { id: "e1", hash: "h0", edits: [{ start: 125, end: 125, length: 30 }], undo: 0, redo: 1 } });
      key("z", { metaKey: true });
      await settle();
      expect(document.querySelector("h1")).not.toBeNull();

      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [{ start: 125, end: 155, length: 0 }], undo: 1, redo: 0 } });
      key("z", { metaKey: true, shiftKey: true });
      await settle();
      expect(calls[2].body).toMatchObject({ op: "redo", id: "e1", hash: "h0" });
      expect(document.querySelector("h1")).toBeNull();
      expect(document.querySelector("p")!.getAttribute("data-osp-src")).toBe("130");
      expect(status()).toContain("Redid the delete of h1");
    });

    it("undoes from the server's record on a page that has reloaded since", async () => {
      (window as unknown as { __ospEditBoot: unknown }).__ospEditBoot = { page: "proto/index.html", hash: "h9", ok: true, history: { undo: 2, redo: 0 } };
      new Function("EDIT_CSS", EDIT_SCRIPT)(EDIT_CSS);
      new Function(overlayBundle())();
      enter();
      const undo = Array.from(shadow().querySelectorAll(".ed-actions .ed-btn")).find((b) => b.textContent === "Undo") as HTMLButtonElement;
      expect(undo.disabled).toBe(false);
      answers.push({ status: 200, body: { id: "e7", hash: "h8", edits: [], reload: true, undo: 1, redo: 1 } });
      click(undo);
      await settle();
      expect(calls[0].body).toEqual({ op: "undo", page: "proto/index.html", hash: "h9" });
      expect(status()).toContain("Reloading");
    });

    it("lets the page have the pointer while Space is held", () => {
      boot();
      enter();
      const link = document.querySelector("a")!;
      const followed = vi.fn();
      link.addEventListener("click", followed);
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
      click(link);
      expect(followed).toHaveBeenCalledTimes(1);
      document.body.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true, cancelable: true }));
      click(link);
      expect(followed).toHaveBeenCalledTimes(1);
    });

    it("retypes words among inline markup piece by piece, keeping the markup", async () => {
      document.body.innerHTML = '<p data-osp-src="100">Read <b data-osp-src="108">bold</b> words</p>';
      boot();
      enter();
      const p = document.querySelector("p")!;
      click(p, { altKey: true });
      key("Enter");
      expect(p.getAttribute("contenteditable")).toBeTruthy();
      p.querySelector("b")!.firstChild!.textContent = "brave";
      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [{ start: 129, end: 133, length: 5 }] } });
      p.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await settle();
      expect(calls[0].body).toMatchObject({ op: "texts", at: 100, texts: ["Read ", "brave", " words"] });
      expect(p.innerHTML).toBe('Read <b data-osp-src="108">brave</b> words');

      answers.push({ status: 200, body: { id: "e1", hash: "h0", edits: [{ start: 129, end: 134, length: 4 }] } });
      key("z", { metaKey: true });
      await settle();
      expect(p.innerHTML).toBe('Read <b data-osp-src="108">bold</b> words');
    });

    function drag(from: Element, to: { x: number; y: number }): void {
      const at = (type: string, x: number, y: number, on: EventTarget) =>
        on.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
      at("pointerdown", 5, 5, from);
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: to.x, clientY: to.y }));
      at("pointerup", to.x, to.y, from);
      at("click", to.x, to.y, from);
    }

    it("drops an element into an empty container", async () => {
      document.body.innerHTML = '<main data-osp-src="10"><h2 data-osp-src="20">T</h2><div class="slot" data-osp-src="40"></div></main>';
      boot();
      enter();
      const h2 = document.querySelector("h2")!;
      const slot = document.querySelector(".slot")!;
      click(h2, { altKey: true });
      document.elementsFromPoint = () => [slot];
      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [], relocated: [[20, 40]] } });
      drag(h2, { x: 50, y: 80 });
      await settle();
      expect(calls[0].body).toMatchObject({ op: "move", at: 20, target: 40, place: "inside" });
      expect(slot.firstElementChild).toBe(h2);
    });

    it("places a grid item in the empty cell it is dropped on", async () => {
      document.head.innerHTML = meta() + '<style data-osp-src="5">.g { display: grid; grid-template-columns: 100px 100px; grid-template-rows: 50px 50px; }</style>';
      document.body.innerHTML = '<div class="g" data-osp-src="100"><p data-osp-src="120">a</p><p data-osp-src="140">b</p></div>';
      boot();
      enter();
      const grid = document.querySelector(".g") as HTMLElement;
      grid.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      const first = document.querySelector("p")!;
      click(first, { altKey: true });
      document.elementsFromPoint = () => [grid];
      answers.push({ status: 200, body: { id: "e1", hash: "h1", edits: [] } });
      drag(first, { x: 150, y: 75 });
      await settle();
      expect(calls[0].body).toMatchObject({ op: "inline-style", at: 120, props: [["grid-column", "2"], ["grid-row", "2"]] });
    });
  });

  it("edits a screen inside a phone frame, through the outer page's bar", async () => {
    document.body.innerHTML = '<div class="phone" data-osp-src="50"><iframe id="screen"></iframe></div>';
    boot();
    enter();
    const frame = document.getElementById("screen") as HTMLIFrameElement;
    const win = frame.contentWindow as Window & typeof globalThis;
    const doc = frame.contentDocument!;
    doc.body.innerHTML = '<h2 data-osp-src="300">Cart</h2><p data-osp-src="330">Two items</p>';
    // The frame drawn at half size, 100px in: what toHost has to undo.
    frame.getBoundingClientRect = () => ({ left: 100, top: 40, width: 195, height: 422, right: 295, bottom: 462, x: 100, y: 40, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(frame, "offsetWidth", { configurable: true, value: 390 });
    const h2 = doc.querySelector("h2") as HTMLElement;
    h2.getBoundingClientRect = () => ({ left: 20, top: 10, width: 200, height: 30, right: 220, bottom: 40, x: 20, y: 10, toJSON: () => ({}) }) as DOMRect;

    // Under vitest the test's window global and jsdom's real window -- the
    // frame's parent -- are two objects; in a browser they are one.
    (win.parent as unknown as { __ospEdit: unknown }).__ospEdit = (window as unknown as { __ospEdit: unknown }).__ospEdit;
    // The screen's own copy of the script, run in the frame's window.
    (win as unknown as { __ospEditBoot: unknown }).__ospEditBoot = { page: "proto/screens/cart.html", hash: "c0", ok: true };
    new Function(
      "window", "document", "location", "navigator", "sessionStorage", "MutationObserver", "NodeFilter", "EDIT_CSS",
      EDIT_SCRIPT,
    )(win, doc, win.location, win.navigator, win.sessionStorage, win.MutationObserver, win.NodeFilter, EDIT_CSS);

    h2.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }));
    const bars = Array.from(shadow().querySelectorAll(".ed-bar")) as HTMLElement[];
    expect(bars).toHaveLength(2);
    // The screen holds the selection, so its bar shows and the page's does not.
    expect(bars.filter((b) => !b.hidden)).toHaveLength(1);
    const visible = bars.find((b) => !b.hidden)!;
    expect(visible.querySelector(".ed-crumb[data-current]")?.textContent).toBe("h2");

    // Its box is where the frame shows it: 100 + 20 * 0.5 across, 40 + 10 * 0.5 down.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const boxes = Array.from(shadow().querySelectorAll(".ed-sel")) as HTMLElement[];
    const box = boxes.find((b) => !b.hidden)!;
    expect(box.style.left).toBe("110px");
    expect(box.style.top).toBe("45px");
    expect(box.style.width).toBe("100px");

    // Delete pressed in the outer page reaches the screen, and edits its file.
    answers.push({ status: 200, body: { id: "e1", hash: "c1", edits: [{ start: 300, end: 330, length: 0 }] } });
    key("Delete");
    await settle();
    expect(calls[0].body).toMatchObject({ page: "proto/screens/cart.html", hash: "c0", op: "delete", at: 300 });
    expect(doc.querySelector("h2")).toBeNull();
  });

  it("comes back in edit mode after a reload", () => {
    sessionStorage.setItem("osp-edit-active", "1");
    boot();
    expect(shadow().querySelector('.co-mode[data-mode="edit"]')?.hasAttribute("data-active")).toBe(true);
  });
});
