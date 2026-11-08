// @vitest-environment jsdom

/**
 * What the markup cannot say about "Start here" in the panel.
 *
 * Two contracts, both invisible to `shell.test.ts` because both are about
 * what the browser does with the markup rather than what the markup says.
 *
 * The first is the one that could regress silently and be shipped. A pinned
 * note is an ordinary note, so it is already a row in the file tree, and
 * `clientScript.ts` builds the search index from
 * `.osp-panel-body .osp-tree .osp-row`. Put the pins inside the body and
 * every pinned note is indexed twice and comes back twice in the results --
 * a page that looks completely correct until somebody searches. The section
 * sits outside the body partly for this reason, and this is the test that
 * knows it.
 *
 * The second is that the overflow opens with no script at all. `<details>`
 * is the whole control; nothing in the client script is wired to it. So the
 * toggle is exercised here *without* running the script, which is also the
 * only honest way to assert it: if a test had to boot the script first, the
 * claim would not be the one being made.
 *
 * `clientScript.test.ts` next door cannot host either of these -- it binds
 * one copy of the script to one minimal DOM for the whole file, by a
 * deliberate decision its own header explains.
 */

import { describe, expect, it } from "vitest";
import { CLIENT_SCRIPT } from "./clientScript";
import { buildNavTree } from "./nav";
import { buildPage } from "./page";
import { ShellInput } from "./shell";

const TODAY = new Date("2026-11-07T12:00:00Z");

/** Pinned and unpinned notes that all match "note", so one query finds both. */
const NOTES = [
  { url: "notes/pinned-note-one.html", title: "Pinned note one", folder: "notes", updated: "2026-11-01T09:00", pinned: true },
  { url: "notes/pinned-note-two.html", title: "Pinned note two", folder: "notes", updated: "2026-11-02T09:00", pinned: true },
  { url: "notes/plain-note.html", title: "Plain note", folder: "notes", updated: "2026-11-03T09:00", pinned: false },
  { url: "reference/another-note.html", title: "Another note", folder: "reference", updated: "2026-10-20T09:00", pinned: false },
];

function shell(pinned = NOTES.filter((n) => n.pinned)): Omit<
  ShellInput,
  "url" | "title" | "root" | "headings" | "siteName" | "hasSource"
> {
  return {
    nav: buildNavTree(NOTES),
    pinned,
    recency: [],
    tags: [],
    paths: { browse: "browse.html", tags: "tags.html", tagPrefix: "tags" },
    backlinks: [],
    related: [],
    graph: { nodes: [], edges: [], centre: { title: "x", x: 0, y: 0 }, width: 0, height: 0 },
    stats: { words: 10, readingMinutes: 1, sections: 0 },
    today: TODAY,
    noteCount: NOTES.length,
  };
}

/** A whole page in the document, the way a reader would be handed one. */
function render(pinned?: typeof NOTES): void {
  const html = buildPage({
    meta: { title: "Plain note", url: "notes/plain-note.html", siteName: "A Vault, Published" },
    content: "<h1>Plain note</h1><p>Body.</p>",
    headings: [],
    shell: shell(pinned),
  });
  document.documentElement.innerHTML = html.slice(
    html.indexOf("<head>"),
    html.lastIndexOf("</body>") + "</body>".length,
  );
}

describe("the pins and the search index", () => {
  it("indexes a pinned note once, though it is on screen twice", () => {
    render();
    // Both places exist: the section above the tree, and the tree itself.
    expect(document.querySelectorAll(".osp-pin-list .osp-row").length).toBe(2);
    const inTree = document.querySelectorAll(
      '.osp-panel-body .osp-tree .osp-row[href$="pinned-note-one.html"]',
    );
    expect(inTree).toHaveLength(1);

    new Function(CLIENT_SCRIPT)();

    const input = document.querySelector("[data-osp-search-input]") as HTMLInputElement;
    input.value = "pinned note one";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const results = document.querySelector("[data-osp-jump-results]") as HTMLElement;
    const hits = results.querySelectorAll(".osp-row");
    expect(hits).toHaveLength(1);
    // And the count the heading reports agrees with the rows under it.
    expect(results.querySelector(".osp-group-title")?.textContent).toContain("1");
  });

  it("still finds an unpinned note, so the index was not narrowed", () => {
    render();
    new Function(CLIENT_SCRIPT)();

    const input = document.querySelector("[data-osp-search-input]") as HTMLInputElement;
    input.value = "plain note";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const results = document.querySelector("[data-osp-jump-results]") as HTMLElement;
    expect(results.querySelectorAll(".osp-row")).toHaveLength(1);
    expect(results.textContent).toContain("Plain note");
  });
});

describe("the overflow, with no script running", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({
    url: `notes/pin-${i + 1}.html`,
    title: `Pinned note ${i + 1}`,
    folder: "notes",
    updated: "2026-11-01T09:00",
    pinned: true,
  }));

  it("opens and closes on the summary alone", () => {
    render(many);
    const details = document.querySelector(".osp-pins-rest") as HTMLDetailsElement;
    const summary = details.querySelector("summary") as HTMLElement;

    expect(details.open).toBe(false);
    summary.click();
    expect(details.open).toBe(true);
    summary.click();
    expect(details.open).toBe(false);
  });

  it("holds every pin past the fifth, and only those", () => {
    render(many);
    const details = document.querySelector(".osp-pins-rest") as HTMLDetailsElement;
    const folded = details.querySelectorAll(".osp-pin-list .osp-row");
    expect(folded).toHaveLength(many.length - 5);
    expect(folded[0].textContent).toContain("Pinned note 6");
    // The first five are outside it, so they are on screen while it is shut.
    const pins = document.querySelector(".osp-pins") as HTMLElement;
    expect(pins.querySelectorAll(".osp-pin-list .osp-row")).toHaveLength(many.length);
  });
});
