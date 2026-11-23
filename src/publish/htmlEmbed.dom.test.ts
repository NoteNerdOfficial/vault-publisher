// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { CLIENT_SCRIPT } from "./clientScript";
import { frameHtmlEmbeds } from "./htmlEmbed";
import { LinkResolver } from "./links";

/**
 * The width buttons on an embedded prototype, as the site script adds them
 * to the markup `frameHtmlEmbeds` writes. jsdom lays nothing out, so the
 * column's width is given to the stage by hand.
 */
function page(alt = "chart.html", room = 700): HTMLElement {
  document.body.innerHTML =
    `<main class="osp-main"><div class="markdown-rendered">` +
    `<p><span class="internal-embed" src="chart.html" alt="${alt}"></span></p>` +
    `</div></main>`;
  const root = document.querySelector(".markdown-rendered") as HTMLElement;
  frameHtmlEmbeds(
    root,
    new LinkResolver([{ sourcePath: "chart.html", url: "chart.html" }]),
    "note.html",
    () => true,
    () => "Chart",
  );
  const stage = document.querySelector(".osp-html-embed-stage") as HTMLElement;
  Object.defineProperty(stage, "clientWidth", { configurable: true, value: room });
  new Function(CLIENT_SCRIPT)();
  return document.querySelector("figure.osp-html-embed") as HTMLElement;
}

const frame = () => document.querySelector(".osp-html-embed-stage iframe") as HTMLIFrameElement;
const button = (label: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>(".osp-html-embed-width")).find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement;

describe("an embedded prototype's widths", () => {
  it("offers phone, tablet, desktop and fit, starting at fit", () => {
    page();
    const labels = Array.from(document.querySelectorAll(".osp-html-embed-width")).map(
      (b) => b.textContent,
    );
    expect(labels).toEqual(["Phone", "Tablet", "Desktop", "Fit"]);
    expect(button("Fit").getAttribute("aria-pressed")).toBe("true");
    expect(frame().style.width).toBe("100%");
  });

  it("draws a phone width at full size, centred", () => {
    page();
    button("Phone").click();
    expect(button("Phone").getAttribute("aria-pressed")).toBe("true");
    expect(frame().style.width).toBe("375px");
    expect(frame().style.transform).toBe("");
    expect(frame().style.marginLeft).toBe("162px");
    expect(document.querySelector(".osp-html-embed-scale")?.textContent).toBe("375 px");
  });

  it("scales a width wider than the column down to fit, and says so", () => {
    page();
    button("Desktop").click();
    expect(frame().style.width).toBe("1280px");
    expect(frame().style.transform).toBe(`scale(${700 / 1280})`);
    // Taller by the same factor, so the stage is still filled.
    expect(frame().style.height).toBe(`${Math.round(560 / (700 / 1280))}px`);
    expect(document.querySelector(".osp-html-embed-scale")?.textContent).toBe("1280 px at 55%");
  });

  it("starts at the width the link text asked for", () => {
    page("375x700");
    expect(button("Phone").getAttribute("aria-pressed")).toBe("true");
    expect(frame().style.width).toBe("375px");
  });
});

describe("frames compared side by side", () => {
  it("change width together", () => {
    document.body.innerHTML =
      `<main class="osp-main"><div class="markdown-rendered">` +
      `<p><span class="internal-embed" src="a.html"></span> ` +
      `<span class="internal-embed" src="b.html"></span></p></div></main>`;
    frameHtmlEmbeds(
      document.querySelector(".markdown-rendered") as HTMLElement,
      new LinkResolver([
        { sourcePath: "a.html", url: "a.html" },
        { sourcePath: "b.html", url: "b.html" },
      ]),
      "note.html",
      () => true,
      () => undefined,
    );
    for (const stage of Array.from(document.querySelectorAll(".osp-html-embed-stage"))) {
      Object.defineProperty(stage, "clientWidth", { configurable: true, value: 340 });
    }
    new Function(CLIENT_SCRIPT)();
    const first = document.querySelector(".osp-html-embed-width") as HTMLButtonElement;
    expect(first.textContent).toBe("Phone");
    first.click();
    const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>(".osp-html-embed-stage iframe"));
    expect(frames.map((f) => f.style.width)).toEqual(["375px", "375px"]);
  });
});
