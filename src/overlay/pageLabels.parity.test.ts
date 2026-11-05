// @vitest-environment jsdom

/**
 * The two labellings, held against each other.
 *
 * The rule for naming a page in a review is written twice: once in
 * `pageLabels.ts`, which the imported review note uses, and once inside the
 * overlay's own script, which cannot import it because it ships to the
 * browser as a string rather than as a module the bundler links. The same
 * arrangement, and the same hazard, as `anchor.ts` and the stamping the
 * overlay does in the browser -- so the same answer: run both and compare.
 *
 * What a drift here would cost is worth stating. The panel is where a comment
 * is written and the note is where it is read afterwards, so two rules that
 * disagree would have one page called `react-default/index` while it was
 * being commented on and `index` by the time anyone came to act on it --
 * which is the exact confusion both of them exist to remove.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { overlayBundle } from "./overlayScript";
import { labelPaths } from "./pageLabels";
import type { OverlayComment } from "./types";

const STORE_KEY = "osp-overlay-comments";

/**
 * Several reviews rather than one, because the rule has branches that one
 * set cannot tell apart. A page called `index` among other pages called
 * `index` is qualified by the uniqueness rule alone, so a review full of
 * them would pass even if one side had forgotten that a lone `index` has to
 * be qualified too -- which is exactly the kind of drift this is here to
 * catch. Each set isolates one branch.
 */
const REVIEWS: Record<string, string[]> = {
  "names that decide on their own": [
    "library/Atomic notes.md",
    "method/Scope.md",
    "html-as-is/charts/trend.html",
  ],
  "names that collide one folder up": [
    "react-default/index.html",
    "angular-default/index.html",
  ],
  "names that still collide two folders up": [
    "apps/react/dist/index.html",
    "apps/angular/dist/index.html",
  ],
  "a vague name that is the only one of itself": [
    "library/Scope.md",
    "react-relative/index.html",
  ],
  "a vague name with no folder to qualify it": ["index.html", "library/Scope.md"],
  "a shorter path sharing a tail with a longer one": [
    "index.html",
    "docs/index.html",
  ],
};

function comment(sourcePath: string, index: number): OverlayComment {
  return {
    id: `c${index}`,
    page: sourcePath.replace(/\.md$/i, ".html").toLowerCase(),
    sourcePath,
    block: null,
    blockText: "",
    route: null,
    x: 0,
    y: 0,
    rx: null,
    ry: null,
    author: "Reviewer",
    text: `About ${sourcePath}`,
    createdAt: `2026-10-28T07:0${index}:00.000Z`,
    resolved: false,
    priority: "medium",
    agent: null,
    imported: null,
    external: null,
    replies: [],
  };
}

/**
 * What the overlay's own panel calls each page of a review, read out of a
 * real run of the shipped script.
 *
 * The page being read is deliberately one with no comments on it. The panel
 * calls its own group "This page" rather than naming it, which is right
 * there and would be nothing to compare here.
 */
function panelLabels(paths: string[]): string[] {
  document.getElementById("osp-overlay-host")?.remove();
  localStorage.clear();
  localStorage.setItem(STORE_KEY, JSON.stringify(paths.map(comment)));

  document.head.innerHTML = `<meta name="osp-review" content='${JSON.stringify({
    sourcePath: "notes/Plan.md",
    page: "notes/plan.html",
    site: "Handbook",
    reviewer: "Reviewer",
  })}'>`;
  document.body.innerHTML = `<article class="osp-article"><p>A paragraph.</p></article>`;

  new Function(overlayBundle())();
  const shadow = document.getElementById("osp-overlay-host")?.shadowRoot;
  if (!shadow) throw new Error("the overlay did not mount");
  shadow
    .querySelector('.co-mode[data-mode="review"]')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));

  return Array.from(shadow.querySelectorAll(".co-group-name"))
    .map((node) => node.textContent ?? "")
    .sort();
}

beforeEach(() => {
  localStorage.clear();
  document.getElementById("osp-overlay-host")?.remove();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

describe("the overlay's labels and the review note's", () => {
  for (const [what, paths] of Object.entries(REVIEWS)) {
    it(`agree about ${what}`, () => {
      const written = [...labelPaths(paths).values()].sort();
      // Both sides are the whole review, so neither may be short of the
      // other -- and a rule that labelled two pages the same would show up
      // here as a length that no longer matches.
      expect(written).toHaveLength(paths.length);
      expect(panelLabels(paths)).toEqual(written);
    });
  }
});
