// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { isBasesViewUnfinished, reemitBases } from "./bases";

/**
 * A Bases table view as it reaches us from the app.
 *
 * `claimed` is what the toolbar reports; `rows` is how many actually exist in
 * the DOM. Bases only builds the rows it is showing, so the two differ for
 * any view longer than its own window -- which is the case this file is about.
 */
function basesView(options: { claimed: number; rows: number; name?: string }): HTMLElement {
  const { claimed, rows, name = "Reading list" } = options;
  const body = Array.from({ length: rows }, (_, i) =>
    `<div class="bases-tr">` +
      `<div class="bases-td" data-property="title">Row ${i + 1}</div>` +
      `<div class="bases-td" data-property="rating">${i + 1}</div>` +
    `</div>`,
  ).join("");

  const root = document.createElement("div");
  root.innerHTML =
    `<span class="internal-embed bases-embed">` +
      `<div class="bases-toolbar">` +
        `<span class="bases-toolbar-result-count">${claimed} results</span>` +
      `</div>` +
      `<div class="bases-view" data-view-type="table" data-view-name="${name}">` +
        `<div class="bases-thead"><div class="bases-tr">` +
          `<div class="bases-td">Title</div><div class="bases-td">Rating</div>` +
        `</div></div>` +
        `<div class="bases-tbody">${body}</div>` +
      `</div>` +
    `</span>`;
  return root;
}

describe("reemitBases truncation", () => {
  // The defect: this case used to abort the entire publish, so one long base
  // stopped every other note in the vault from going out.
  it("publishes the rows it has and says how many it found", () => {
    const root = basesView({ claimed: 201, rows: 18 });

    const stats = reemitBases(root);

    expect(stats.truncated).toEqual(["Reading list: 18/201"]);
    expect(root.querySelectorAll(".osp-base-table tbody tr")).toHaveLength(18);

    const note = root.querySelector(".osp-base-truncated");
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("18");
    expect(note?.textContent).toContain("201");
    expect(note?.textContent).toContain("interactive in Obsidian");
  });

  it("says nothing when every row arrived", () => {
    const root = basesView({ claimed: 5, rows: 5 });

    const stats = reemitBases(root);

    expect(stats.truncated).toEqual([]);
    expect(root.querySelector(".osp-base-truncated")).toBeNull();
    expect(root.querySelectorAll(".osp-base-table tbody tr")).toHaveLength(5);
  });

  // A view whose toolbar has not produced a number yet must not be reported
  // as truncated: an unreadable count is not a count of more.
  it("says nothing when the count is unreadable", () => {
    const root = basesView({ claimed: 3, rows: 3 });
    root.querySelector(".bases-toolbar-result-count")!.textContent = "Results";

    const stats = reemitBases(root);

    expect(stats.truncated).toEqual([]);
    expect(root.querySelector(".osp-base-truncated")).toBeNull();
  });
});

/**
 * A view of any type, with only what the tests below need: a toolbar count,
 * optional data rows, and optionally Bases' hidden measurement row, which
 * carries no `data-property`.
 */
function view(options: {
  type: string;
  claimed: number;
  rows?: number;
  measurement?: boolean;
  name?: string;
}): HTMLElement {
  const { type, claimed, rows = 0, measurement = false, name = "Shelf" } = options;
  const item = (i: number) =>
    type === "cards"
      ? `<div class="bases-cards-item"><div class="bases-cards-property mod-title" data-property="file.name"><div class="bases-cards-line">Card ${i}</div></div></div>`
      : `<div class="bases-tr"><div class="bases-td" data-property="title">Row ${i}</div></div>`;
  const probe =
    type === "cards"
      ? `<div class="bases-cards-item"><div class="bases-cards-line">Fj</div></div>`
      : `<div class="bases-tr"><div class="bases-td">Fj</div></div>`;
  const items =
    (measurement ? probe : "") +
    Array.from({ length: rows }, (_, i) => item(i + 1)).join("");
  const body =
    type === "cards"
      ? items
      : type === "table"
        ? `<div class="bases-tbody">${items}</div>`
        : `<div class="bases-list-item">Entry</div>`;

  const root = document.createElement("div");
  root.innerHTML =
    `<span class="internal-embed bases-embed">` +
      `<div class="bases-toolbar">` +
        `<span class="bases-toolbar-result-count">${claimed} results</span>` +
      `</div>` +
      `<div class="bases-view" data-view-type="${type}" data-view-name="${name}">${body}</div>` +
    `</span>`;
  return root;
}

describe("isBasesViewUnfinished and the measurement row", () => {
  // The defect: the hidden measurement row counted as a row, so a view with
  // no data in it was called finished and published as a bare toolbar.
  it.each(["table", "cards"])("waits for a %s view holding only the measurement row", (type) => {
    const root = view({ type, claimed: 8, measurement: true });
    expect(isBasesViewUnfinished(root.querySelector(".bases-view")!)).toBe(true);
  });

  it.each(["table", "cards"])("is finished once a %s view has a data row", (type) => {
    const root = view({ type, claimed: 8, rows: 1, measurement: true });
    expect(isBasesViewUnfinished(root.querySelector(".bases-view")!)).toBe(false);
  });

  it("is finished for a view that reports no results", () => {
    const root = view({ type: "table", claimed: 0, measurement: true });
    expect(isBasesViewUnfinished(root.querySelector(".bases-view")!)).toBe(false);
  });

  // A list view has neither table rows nor cards, so it used to look
  // unfinished forever, wait out the 20 second limit and abort the publish.
  it("does not wait on a view type it cannot read rows from", () => {
    const root = view({ type: "list", claimed: 8 });
    expect(isBasesViewUnfinished(root.querySelector(".bases-view")!)).toBe(false);
  });

  it("still waits on any view Bases marks as loading", () => {
    const root = view({ type: "list", claimed: 8 });
    root.querySelector(".bases-view")!.innerHTML = `<div class="is-loading"></div>`;
    expect(isBasesViewUnfinished(root.querySelector(".bases-view")!)).toBe(true);
  });
});

describe("reemitBases never leaves raw Bases markup", () => {
  it("states that a view with only a measurement row is missing its rows", () => {
    const root = view({ type: "cards", claimed: 8, measurement: true });

    const stats = reemitBases(root);

    expect(root.querySelector(".bases-toolbar, .bases-view, .bases-embed")).toBeNull();
    expect(stats.unhandled).toEqual([]);
    expect(stats.truncated).toEqual(["Shelf: 0/8"]);
    expect(root.querySelector(".osp-base-truncated")?.textContent).toContain("0 of 8");
  });

  it("says a view with no results has none", () => {
    const root = view({ type: "table", claimed: 0 });

    const stats = reemitBases(root);

    expect(root.querySelector(".bases-toolbar")).toBeNull();
    expect(stats.truncated).toEqual([]);
    expect(stats.unhandled).toEqual([]);
    expect(root.querySelector(".osp-base-empty")?.textContent).toBe("No results.");
  });

  it("replaces an unsupported view type with a notice and names it", () => {
    const root = view({ type: "list", claimed: 8, name: "Reading queue" });

    const stats = reemitBases(root);

    expect(root.querySelector(".bases-toolbar, .bases-view, .bases-embed")).toBeNull();
    expect(stats.unhandled).toEqual(["Reading queue (list)"]);
    const note = root.querySelector(".osp-base-unsupported-note");
    expect(note?.textContent).toContain("list view cannot be shown");
    expect(root.querySelector(".osp-base-name")?.textContent).toBe("Reading queue");
  });
});
