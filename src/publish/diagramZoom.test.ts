// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLIENT_SCRIPT } from "./clientScript";

/**
 * Zooming, panning and the full-screen view of a published Mermaid diagram.
 *
 * jsdom lays nothing out, so every box measures zero and the zoom centres
 * on the origin. That is enough to check the scale, the offsets a drag
 * adds, and where the diagram is in the document at each point, which is
 * what these are about.
 */

const SVG_STYLE = "max-width: 480px;";

beforeAll(() => {
  document.body.innerHTML =
    `<article class="markdown-rendered">` +
    `<div class="mermaid" id="first"><svg id="mermaid-1" style="${SVG_STYLE}" viewBox="0 0 480 200"><g></g></svg></div>` +
    `<p>Between.</p>` +
    `<div class="mermaid" id="empty"></div>` +
    `<button id="elsewhere" type="button">elsewhere</button>` +
    `</article>`;
  new Function(CLIENT_SCRIPT)();
});

const diagram = () => document.getElementById("first") as HTMLElement;
const canvas = () => diagram().querySelector(".osp-diagram-canvas") as HTMLElement;
const act = (name: string, scope: ParentNode = document) =>
  scope.querySelector(`[data-osp-diagram-act="${name}"]`) as HTMLButtonElement;

function tap(el: Element): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function press(key: string): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

function pointer(type: string, target: Element, x: number, y: number, id = 1): void {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: id }),
  );
}

beforeEach(() => {
  if (document.querySelector(".osp-diagram-viewer")) press("Escape");
  tap(act("reset", diagram()));
});

describe("a diagram on the page", () => {
  it("gets zoom controls and a canvas around its drawing", () => {
    expect(diagram().hasAttribute("data-osp-diagram")).toBe(true);
    expect(canvas().querySelector("svg#mermaid-1")).not.toBeNull();
    const labels = Array.from(diagram().querySelectorAll(".osp-diagram-btn")).map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["Zoom in", "Zoom out", "Reset zoom", "Open full screen"]);
  });

  it("leaves a block with nothing drawn in it alone", () => {
    const empty = document.getElementById("empty")!;
    expect(empty.hasAttribute("data-osp-diagram")).toBe(false);
    expect(empty.children).toHaveLength(0);
  });

  it("zooms with its buttons and resets", () => {
    tap(act("zoomIn", diagram()));
    expect(canvas().style.transform).toBe("translate(0px, 0px) scale(1.25)");
    expect(diagram().hasAttribute("data-osp-zoomed")).toBe(true);

    tap(act("zoomOut", diagram()));
    tap(act("zoomOut", diagram()));
    expect(canvas().style.transform).toBe("translate(0px, 0px) scale(0.8)");

    tap(act("reset", diagram()));
    expect(canvas().style.transform).toBe("");
    expect(diagram().hasAttribute("data-osp-zoomed")).toBe(false);
  });

  it("does not zoom out past half or in past eight times", () => {
    for (let i = 0; i < 20; i++) tap(act("zoomOut", diagram()));
    expect(canvas().style.transform).toContain("scale(0.5)");
    for (let i = 0; i < 40; i++) tap(act("zoomIn", diagram()));
    expect(canvas().style.transform).toContain("scale(8)");
  });

  // An ordinary scroll has to scroll the page past the diagram.
  it("zooms with the wheel only when Ctrl or Cmd is held", () => {
    const plain = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    diagram().dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(canvas().style.transform).toBe("");

    const held = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    diagram().dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
    expect(canvas().style.transform).toContain("scale(1.28");
  });

  // At its normal size a press on the diagram means what it means anywhere.
  it("pans by dragging, but only once zoomed", () => {
    pointer("pointerdown", diagram(), 10, 10);
    pointer("pointermove", diagram(), 40, 30);
    pointer("pointerup", diagram(), 40, 30);
    expect(canvas().style.transform).toBe("");

    tap(act("zoomIn", diagram()));
    pointer("pointerdown", diagram(), 10, 10);
    pointer("pointermove", diagram(), 40, 30);
    pointer("pointerup", diagram(), 40, 30);
    expect(canvas().style.transform).toBe("translate(30px, 20px) scale(1.25)");
  });
});

describe("the full-screen view", () => {
  const viewer = () => document.querySelector(".osp-diagram-viewer") as HTMLElement | null;

  it("moves the diagram into a dialog and back, not a copy of it", () => {
    document.getElementById("elsewhere")!.focus();
    act("expand", diagram()).focus();
    tap(act("expand", diagram()));

    expect(viewer()?.getAttribute("role")).toBe("dialog");
    expect(document.querySelectorAll("svg#mermaid-1")).toHaveLength(1);
    expect(viewer()!.querySelector(".markdown-rendered .mermaid svg#mermaid-1")).not.toBeNull();
    expect(document.documentElement.hasAttribute("data-osp-viewing")).toBe(true);
    expect(document.activeElement).toBe(act("close", viewer()!));

    tap(act("close", viewer()!));

    expect(viewer()).toBeNull();
    expect(canvas().querySelector("svg#mermaid-1")).not.toBeNull();
    expect(canvas().querySelector("svg")!.getAttribute("style")).toBe(SVG_STYLE);
    expect(document.documentElement.hasAttribute("data-osp-viewing")).toBe(false);
    expect(document.activeElement).toBe(act("expand", diagram()));
  });

  it("closes on Escape", () => {
    tap(act("expand", diagram()));
    press("Escape");

    expect(viewer()).toBeNull();
    expect(canvas().querySelector("svg#mermaid-1")).not.toBeNull();
  });

  it("zooms from the keyboard and with the wheel alone", () => {
    tap(act("expand", diagram()));
    const inner = viewer()!.querySelector(".osp-diagram-canvas") as HTMLElement;

    press("+");
    expect(inner.style.transform).toContain("scale(1.25)");
    press("0");
    expect(inner.style.transform).toBe("");

    const stage = viewer()!.querySelector(".osp-diagram-stage")!;
    const wheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    stage.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(inner.style.transform).toContain("scale(1.28");
  });

  it("pans by dragging at any zoom, and pinches with two pointers", () => {
    tap(act("expand", diagram()));
    const stage = viewer()!.querySelector(".osp-diagram-stage")!;
    const inner = viewer()!.querySelector(".osp-diagram-canvas") as HTMLElement;

    pointer("pointerdown", stage, 0, 0);
    pointer("pointermove", stage, 20, 10);
    pointer("pointerup", stage, 20, 10);
    expect(inner.style.transform).toBe("translate(20px, 10px) scale(1)");

    press("0");
    pointer("pointerdown", stage, 0, 0, 1);
    pointer("pointerdown", stage, 100, 0, 2);
    pointer("pointermove", stage, 200, 0, 2);
    pointer("pointerup", stage, 200, 0, 2);
    pointer("pointerup", stage, 0, 0, 1);
    expect(inner.style.transform).toContain("scale(2)");
  });

  it("keeps the page's own zoom out of it, and gives it back afterwards", () => {
    tap(act("zoomIn", diagram()));
    tap(act("expand", diagram()));
    tap(act("close", viewer()!));

    expect(canvas().style.transform).toBe("translate(0px, 0px) scale(1.25)");
  });
});
