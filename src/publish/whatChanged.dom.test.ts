// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_SCRIPT } from "./clientScript";

/**
 * "Changed since your last visit": the site script compares the build's
 * fingerprints with what this browser saw last time. Each test is one
 * visit to `notes/plan.html` on a site served from `/site/`.
 */
async function visit(pages: Record<string, string>): Promise<void> {
  window.history.replaceState({}, "", "/site/notes/plan.html");
  document.body.innerHTML =
    `<aside class="osp-panel"><div class="osp-panel-body"><ul class="osp-tree">` +
    `<li><a class="osp-row" href="plan.html"><span class="osp-label">Plan</span></a></li>` +
    `<li><a class="osp-row" href="other.html"><span class="osp-label">Other</span></a></li>` +
    `<li><a class="osp-row" href="../proto/"><span class="osp-label">Proto</span></a></li>` +
    `</ul></div></aside>` +
    `<main class="osp-main"><article class="osp-article markdown-rendered">` +
    `<h1 class="osp-title">Plan</h1><p>Body.</p></article></main>` +
    `<script src="${location.origin}/site/assets/site.js"></script>`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      expect(url).toBe(`${location.origin}/site/assets/changes.json`);
      return { ok: true, json: async () => ({ v: 1, pages }) };
    }),
  );
  new Function(CLIENT_SCRIPT)();
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

const row = (label: string) =>
  Array.from(document.querySelectorAll(".osp-tree a.osp-row")).find(
    (a) => a.textContent === label,
  ) as HTMLElement;

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("what changed since the last visit", () => {
  const FIRST = {
    "notes/plan.html": "a",
    "notes/other.html": "b",
    "proto/index.html": "c",
  };

  it("marks nothing on a first visit", async () => {
    await visit(FIRST);
    expect(document.querySelectorAll("[data-osp-changed]")).toHaveLength(0);
    expect(document.querySelector(".osp-changed-note")).toBeNull();
  });

  it("marks what changed and what is new on the next", async () => {
    await visit(FIRST);
    await visit({ ...FIRST, "notes/other.html": "b2", "proto/index.html": "c2", "notes/new.html": "d" });
    expect(row("Other").getAttribute("data-osp-changed")).toBe("changed");
    // A folder link reaches its index.html.
    expect(row("Proto").getAttribute("data-osp-changed")).toBe("changed");
    expect(row("Plan").hasAttribute("data-osp-changed")).toBe(false);
  });

  it("says so on the page being read, once", async () => {
    await visit(FIRST);
    await visit({ ...FIRST, "notes/plan.html": "a2" });
    expect(document.querySelector(".osp-changed-note")?.textContent).toBe(
      "Changed since your last visit.",
    );
    // Reading it is seeing it.
    await visit({ ...FIRST, "notes/plan.html": "a2" });
    expect(document.querySelector(".osp-changed-note")).toBeNull();
  });

  // A prototype does not run this script, so following its link is the
  // only chance to record it as seen.
  it("counts a followed link as seen", async () => {
    await visit(FIRST);
    await visit({ ...FIRST, "proto/index.html": "c2" });
    row("Proto").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await visit({ ...FIRST, "proto/index.html": "c2" });
    expect(row("Proto").hasAttribute("data-osp-changed")).toBe(false);
  });
});
