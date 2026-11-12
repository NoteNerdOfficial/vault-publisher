// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { installObsidianDom } from "../../test/obsidian-stub";
import {
  CAPTURE_VIEW_TYPE,
  CapturedTable,
  buildCapturedTable,
  isBasesViewUnfinished,
  reemitBases,
} from "./bases";

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

/** A table as a capture view would hand it over, with plain-text values. */
function captured(rows: number, extra: Partial<CapturedTable> = {}): CapturedTable {
  return {
    name: "Shelf",
    columns: [
      { id: "file.name", label: "file name" },
      { id: "note.author", label: "Author" },
    ],
    groups: [
      {
        label: null,
        rows: Array.from({ length: rows }, (_, i) => ({
          path: `shelf/book-${i + 1}.md`,
          title: `book-${i + 1}`,
          render: (cell: HTMLElement, columnId: string) => {
            cell.textContent = `${columnId} ${i + 1}`;
          },
        })),
      },
    ],
    ...extra,
  };
}

/**
 * A capture view as it sits on the page once it has built its figure, inside
 * either wrapper Bases uses: an embed's span or a `base` code block's div.
 */
function captureView(options: { claimed: number; rows: number; wrapper: "embed" | "block" }): HTMLElement {
  const root = document.createElement("div");
  const wrapper = document.createElement(options.wrapper === "embed" ? "span" : "div");
  wrapper.className =
    options.wrapper === "embed" ? "internal-embed bases-embed" : "block-language-base";
  wrapper.innerHTML =
    `<div class="bases-toolbar"><span class="bases-toolbar-result-count">${options.claimed} results</span></div>` +
    `<div class="bases-view" data-view-type="${CAPTURE_VIEW_TYPE}" data-view-name="Shelf"></div>`;
  wrapper.querySelector(".bases-view")!.append(buildCapturedTable(document, captured(options.rows)));
  root.append(wrapper);
  return root;
}

describe("buildCapturedTable", () => {
  it("writes the header from the display names and a row per entry", () => {
    const figure = buildCapturedTable(document, captured(3));

    expect(Array.from(figure.querySelectorAll("thead th")).map((th) => th.textContent)).toEqual([
      "file name",
      "Author",
    ]);
    expect(figure.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(figure.querySelector("figcaption")?.textContent).toBe("Shelf");
  });

  // The link rewriter turns exactly this shape into a link to the published
  // page, the same as a document value in Bases' own grid.
  it("writes the file name as a link to the row's file", () => {
    const figure = buildCapturedTable(document, captured(1));

    const link = figure.querySelector("td[data-property='file.name'] .internal-link");
    expect(link?.getAttribute("data-href")).toBe("shelf/book-1.md");
    expect(link?.textContent).toBe("book-1");
  });

  it("lets each row render its other values", () => {
    const figure = buildCapturedTable(document, captured(2));

    expect(figure.querySelector("tbody tr:nth-child(2) td[data-property='note.author']")?.textContent)
      .toBe("note.author 2");
  });

  it("heads each group of a grouped table", () => {
    const base = captured(2);
    const figure = buildCapturedTable(document, {
      ...base,
      groups: [
        { label: "Fiction", rows: base.groups[0].rows.slice(0, 1) },
        { label: "Essays", rows: base.groups[0].rows.slice(1) },
      ],
    });

    const headings = Array.from(figure.querySelectorAll("tr.osp-base-group th"));
    expect(headings.map((th) => th.textContent)).toEqual(["Fiction", "Essays"]);
    expect(headings[0].getAttribute("colspan")).toBe("2");
    expect(figure.querySelectorAll("tbody")).toHaveLength(2);
  });
});

describe("reemitBases with a view read from data", () => {
  it.each(["embed", "block"] as const)("lifts the figure out of its %s wrapper and counts it", (wrapper) => {
    const root = captureView({ claimed: 201, rows: 201, wrapper });

    const stats = reemitBases(root);

    expect(root.querySelector(".bases-toolbar, .bases-view, .bases-embed, .block-language-base")).toBeNull();
    expect(root.querySelectorAll("figure.osp-base tbody tr")).toHaveLength(201);
    expect(stats).toMatchObject({ views: 1, tables: 1, fromApi: 1, rows: 201, truncated: [], unhandled: [] });
    expect(root.querySelector("figure")!.hasAttribute("data-osp-capture")).toBe(false);
    expect(root.querySelector("figure")!.hasAttribute("data-osp-rows")).toBe(false);
  });

  it("still says so if it holds fewer rows than Bases reports", () => {
    const root = captureView({ claimed: 10, rows: 7, wrapper: "embed" });

    const stats = reemitBases(root);

    expect(stats.truncated).toEqual(["Shelf: 7/10"]);
    expect(root.querySelector(".osp-base-truncated")?.textContent).toContain("7 of 10");
  });

  it("says a view with no results has none", () => {
    const root = captureView({ claimed: 0, rows: 0, wrapper: "block" });

    reemitBases(root);

    expect(root.querySelector(".osp-base-empty")?.textContent).toBe("No results.");
  });

  // A value Obsidian renders as a form control, such as a checkbox, has its
  // content in a property, not in the markup.
  it("resolves form controls in rendered values", () => {
    installObsidianDom();
    const root = captureView({ claimed: 1, rows: 1, wrapper: "embed" });
    const cell = root.querySelector("td[data-property='note.author']")!;
    cell.innerHTML = `<input type="checkbox">`;
    (cell.querySelector("input") as HTMLInputElement).checked = true;

    const stats = reemitBases(root);

    expect(root.querySelector("td[data-property='note.author']")?.textContent).toBe("Yes");
    expect(stats.inputValues).toBe(1);
  });
});

describe("isBasesViewUnfinished with a capture view", () => {
  it("is unfinished until the view has built its figure", () => {
    const root = captureView({ claimed: 3, rows: 3, wrapper: "embed" });
    const view = root.querySelector(".bases-view")!;
    const figure = view.querySelector("figure")!;

    figure.remove();
    expect(isBasesViewUnfinished(view)).toBe(true);
    view.append(figure);
    expect(isBasesViewUnfinished(view)).toBe(false);
  });
});
