// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { CLIENT_SCRIPT } from "./clientScript";
import { backToTop, contextRail } from "./shell";

/**
 * The tree's two tools and the way back to the top of the page.
 *
 * Each test loads a fresh page, the way a reader moves between them: the
 * script runs once per page, and what carries over is what it stored.
 */

const TOOLS =
  `<div class="osp-group-title osp-browse-title"><h2 class="osp-browse-name">Browse</h2>` +
  `<span class="osp-tree-tools" data-osp-tree-tools hidden>` +
  `<button type="button" data-osp-collapse-all></button>` +
  `<button type="button" data-osp-reveal aria-pressed="true"></button></span></div>`;

/** A page whose tree opens, as the build writes it, the folder it is in. */
function page(current: "a" | "b"): void {
  const row = (name: string) =>
    `<a class="osp-row${current === name ? " osp-current" : ""}" href="${name}.html"><span class="osp-label">${name}</span></a>`;
  document.body.innerHTML =
    `<aside class="osp-panel"><div class="osp-panel-body">${TOOLS}<ul class="osp-tree">` +
    `<li class="osp-folder"><details data-osp-folder="one"${current === "a" ? " open" : ""}>` +
    `<summary class="osp-row">one</summary><ul>` +
    `<li class="osp-folder"><details data-osp-folder="one/deep"${current === "a" ? " open" : ""}>` +
    `<summary class="osp-row">deep</summary><ul><li>${row("a")}</li></ul></details></li>` +
    `</ul></details></li>` +
    `<li class="osp-folder"><details data-osp-folder="two"${current === "b" ? " open" : ""}>` +
    `<summary class="osp-row">two</summary><ul><li>${row("b")}</li></ul></details></li>` +
    `</ul></div></aside>` +
    `<main class="osp-main" id="osp-main"></main>` +
    backToTop();
  new Function(CLIENT_SCRIPT)();
}

const folder = (path: string) =>
  document.querySelector(`[data-osp-folder="${path}"]`) as HTMLDetailsElement;
const button = (attr: string) => document.querySelector(`[${attr}]`) as HTMLButtonElement;
const openFolders = () =>
  Array.from(document.querySelectorAll<HTMLDetailsElement>("[data-osp-folder]"))
    .filter((d) => d.open)
    .map((d) => d.getAttribute("data-osp-folder"));

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("the tree's tools", () => {
  it("are shown once the script can run them", () => {
    page("a");
    expect((document.querySelector("[data-osp-tree-tools]") as HTMLElement).hidden).toBe(false);
  });

  it("collapse every folder, nested ones too", () => {
    page("a");
    folder("two").open = true;
    button("data-osp-collapse-all").click();
    expect(openFolders()).toEqual([]);
  });

  it("keep a collapsed tree collapsed on the next page when reveal is off", () => {
    page("a");
    button("data-osp-reveal").click();
    expect(button("data-osp-reveal").getAttribute("aria-pressed")).toBe("false");
    button("data-osp-collapse-all").click();

    page("b");
    expect(openFolders()).toEqual([]);
    expect(button("data-osp-reveal").getAttribute("aria-pressed")).toBe("false");
  });

  it("with reveal on, open the folders down to the page and keep the rest as they were", () => {
    page("a");
    button("data-osp-collapse-all").click();

    page("a");
    expect(openFolders()).toEqual(["one", "one/deep"]);
  });

  it("reveal the page at once when switched back on", () => {
    page("a");
    button("data-osp-reveal").click();
    button("data-osp-collapse-all").click();
    button("data-osp-reveal").click();
    expect(openFolders()).toEqual(["one", "one/deep"]);
  });
});

describe("back to top", () => {
  it("is shown once the script runs, and only lit after scrolling a screen", () => {
    page("a");
    const top = button("data-osp-to-top");
    expect(top.hidden).toBe(false);
    expect(top.getAttribute("aria-label")).toBe("Back to top");
    expect(top.classList.contains("osp-to-top-on")).toBe(false);
  });

  it("goes to the top and leaves focus at the start of the page", () => {
    page("a");
    let to: unknown[] = [];
    window.scrollTo = ((...args: unknown[]) => { to = args; }) as typeof window.scrollTo;
    button("data-osp-to-top").click();
    expect(to).toEqual([0, 0]);
    expect(document.activeElement?.id).toBe("osp-main");
  });
});

/**
 * A page with an outline in the rail, as the build writes it: two sections,
 * each with a subheading, and the window scrolled into the second subsection.
 */
function outlinePage(): void {
  const headings = [
    { level: 2, id: "one", text: "One" },
    { level: 3, id: "one-a", text: "One A" },
    { level: 2, id: "two", text: "Two" },
    { level: 3, id: "two-a", text: "Two A" },
  ];
  const input = {
    headings,
    stats: { words: 0, readingMinutes: 0, sections: 0 },
    backlinks: [],
    related: [],
    root: "",
    graph: { nodes: [], edges: [] },
  } as unknown as Parameters<typeof contextRail>[0];
  document.body.innerHTML =
    `<main class="osp-main" id="osp-main">` +
    headings.map((h) => `<h${h.level} id="${h.id}">${h.text}</h${h.level}>`).join("") +
    `</main>` +
    contextRail(input);
  // Every heading has passed the reading line but the last one.
  const tops: Record<string, number> = { one: -400, "one-a": -300, two: -200, "two-a": 100 };
  for (const id of Object.keys(tops)) {
    document.getElementById(id)!.getBoundingClientRect = () => ({ top: tops[id] }) as DOMRect;
  }
  new Function(CLIENT_SCRIPT)();
}

const row = (id: string) =>
  document.querySelector(`[data-osp-outline] [data-osp-spy="${id}"]`)!.parentElement as HTMLElement;
const listed = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-osp-outline] li"))
    .filter((li) => !li.classList.contains("osp-lvl3") ||
      !li.parentElement!.classList.contains("osp-outline-collapsed"))
    .map((li) => li.querySelector("a")!.getAttribute("data-osp-spy"));

describe("the outline's collapse-all", () => {
  it("sits beside On this page and is shown once the script runs", () => {
    outlinePage();
    const tools = document.querySelector("[data-osp-outline-tools]") as HTMLElement;
    expect(tools.hidden).toBe(false);
    expect(tools.closest(".osp-outline-title")?.textContent).toContain("On this page");
    expect(document.querySelector("[data-osp-outline-reveal]")).toBeNull();
  });

  it("folds to the section headings and puts the mark on the section being read", () => {
    outlinePage();
    button("data-osp-outline-collapse").click();
    expect(listed()).toEqual(["one", "two"]);
    expect(row("two").querySelector("a")!.classList.contains("osp-active")).toBe(true);
    expect(button("data-osp-outline-collapse").getAttribute("aria-label")).toBe("Expand all");
  });

  it("unfolds again, and stays folded on the next page", () => {
    outlinePage();
    button("data-osp-outline-collapse").click();
    outlinePage();
    expect(button("data-osp-outline-collapse").getAttribute("aria-pressed")).toBe("true");
    button("data-osp-outline-collapse").click();
    expect(listed()).toEqual(["one", "one-a", "two", "two-a"]);
  });

  it("is left out when there are no subsections to fold", () => {
    document.body.innerHTML = contextRail({
      headings: [{ level: 2, id: "one", text: "One" }],
      stats: { words: 0, readingMinutes: 0, sections: 0 },
      backlinks: [],
      related: [],
      root: "",
      graph: { nodes: [], edges: [] },
    } as unknown as Parameters<typeof contextRail>[0]);
    expect(document.querySelector("[data-osp-outline-tools]")).toBeNull();
    expect(document.body.textContent).toContain("On this page");
  });
});
