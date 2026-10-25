import { describe, expect, it } from "vitest";
import { reemitBases } from "./bases";

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
