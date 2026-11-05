/**
 * Re-emitting Obsidian Bases views as plain semantic markup.
 *
 * Bases renders an application pane, not a document: rows and columns are
 * absolutely positioned from measured pixel offsets (`top`, `height`,
 * `inset-inline-start`, `width`), the grid is virtualized, editable values
 * live inside form controls, and the whole thing is wrapped in a toolbar of
 * menus that do nothing on a static page. Harvesting that CSS and shipping
 * the DOM as-is was tried first and produced a table whose columns overflowed
 * the page and whose numbers were missing entirely.
 *
 * Three things made keeping it untenable rather than merely ugly:
 *
 *  1. A number cell is an `<input>`. An input's value is a DOM property, not
 *     text, so `innerHTML` serialized `<input type="number" placeholder=
 *     "Empty">` and the rating and pages columns published blank. Nothing
 *     flagged it: the cells had structure, so the placeholder counter saw no
 *     empty spans and every probe passed.
 *  2. Each view carries a hidden measurement row whose cells read "Fj" -- a
 *     font-metrics probe -- which published as a real row of nonsense.
 *  3. The layout depends on internal class names and inline pixel geometry
 *     that change without notice between Obsidian releases.
 *
 * So we read the values out and write our own table. The same approach is
 * what Datacore will need.
 *
 * This must run before link rewriting: cells are moved rather than copied to
 * text, so `.internal-link` elements survive into the output and still get
 * resolved.
 */

export interface BasesStats {
  /** Views found. */
  views: number;
  /** Views re-emitted, by kind. */
  tables: number;
  cards: number;
  /** View types we do not know how to re-emit, left untouched. */
  unhandled: string[];
  rows: number;
  /** Cells whose value came from a form control and would have published blank. */
  inputValues: number;
  /** Measurement rows and cards dropped. */
  measurementDropped: number;
  /**
   * Views whose emitted row count is below the count Bases itself reports.
   *
   * The grid is virtualized, so a base longer than the render host is tall
   * may only have its visible rows in the DOM. Reported per view as
   * "emitted/claimed" so a publish can refuse rather than quietly truncate.
   */
  truncated: string[];
}

export function emptyBasesStats(): BasesStats {
  return {
    views: 0,
    tables: 0,
    cards: 0,
    unhandled: [],
    rows: 0,
    inputValues: 0,
    measurementDropped: 0,
    truncated: [],
  };
}

/** Chrome that exists to be clicked, and so has no meaning on a static page. */
const CHROME_SELECTOR = [
  ".bases-header",
  ".bases-toolbar",
  ".bases-search-row",
  ".bases-table-header-sort",
  ".bases-table-header-resizer",
].join(",");

/**
 * Rewrites every Bases view under `root`. Returns what it did, so the build
 * can assert on it rather than trust it.
 */
export function reemitBases(root: HTMLElement): BasesStats {
  const stats = emptyBasesStats();
  const doc = root.ownerDocument;

  for (const view of Array.from(root.querySelectorAll(".bases-view"))) {
    stats.views++;
    const type = view.getAttribute("data-view-type") ?? "";
    const name = view.getAttribute("data-view-name") ?? "";
    const claimed = claimedResultCount(view);

    let figure: HTMLElement | null = null;
    if (type === "table") {
      figure = buildTable(doc, view, name, stats);
      if (figure) stats.tables++;
    } else if (type === "cards") {
      figure = buildCards(doc, view, name, stats);
      if (figure) stats.cards++;
    }

    if (!figure) {
      // Leaving an unknown view alone is worse-looking but honest: we would
      // otherwise be guessing at a shape we have never seen, and silently
      // dropping whatever did not fit the guess.
      stats.unhandled.push(type || "(no type)");
      continue;
    }

    const emitted = Number(figure.dataset.ospRows ?? "0");
    if (claimed !== null && emitted < claimed) {
      stats.truncated.push(`${name || type}: ${emitted}/${claimed}`);
      noteTruncation(figure, emitted, claimed);
    }
    delete figure.dataset.ospRows;

    replaceView(view, figure);
  }

  return stats;
}

/**
 * Says on the page that a view is showing fewer rows than it found.
 *
 * Bases only builds the rows it is currently showing, so a long view reaches
 * us with most of its rows never having existed in the DOM. For a while that
 * refused the whole publish, which meant one long base stopped a three
 * hundred note site from going out at all -- a guard against publishing
 * something quietly wrong, turned into a guarantee of publishing nothing.
 *
 * So the rows we have are published and the gap is stated, in the output
 * rather than in a log. A reader can see that the table is partial, which is
 * the thing the silent version got wrong. `failOnTruncatedBase` restores the
 * refusal for anyone who would rather not publish at all.
 */
function noteTruncation(
  figure: HTMLElement,
  emitted: number,
  claimed: number,
): void {
  const note = figure.ownerDocument.createElement("p");
  note.className = "osp-base-truncated";
  note.textContent =
    `Showing ${emitted} of ${claimed} rows. ` +
    "This view is interactive in Obsidian.";
  figure.append(note);
}

/**
 * Swaps our figure in for the view, taking the Bases embed wrapper with it
 * when that wrapper held nothing else.
 *
 * Obsidian wraps an embed in a `<span class="internal-embed bases-embed">`.
 * Left in place it keeps a class the harvested stylesheet styles as an inline
 * embed, which puts a block table inside an inline box.
 */
function replaceView(view: Element, figure: HTMLElement): void {
  const embed = view.closest(".bases-embed");
  const host = embed ?? view;

  for (const chrome of Array.from(host.querySelectorAll(CHROME_SELECTOR))) {
    chrome.remove();
  }

  const error = host.querySelector(".bases-error");
  const errorText = (error?.textContent ?? "").trim();

  host.replaceWith(figure);

  if (errorText) {
    const note = figure.ownerDocument.createElement("p");
    note.className = "osp-base-error";
    note.textContent = errorText;
    figure.append(note);
  }
}

/**
 * Bases virtualizes its rows, and we do not try to defeat that.
 *
 * A 200-row base renders 18 rows into the DOM; the rest do not exist to be
 * read. Two attempts to force them: sizing the scroll container from the
 * toolbar's result count (never fired, because that count is not readable
 * during the window where it would help), and giving every container a
 * 200,000px height unconditionally (worse -- it destabilised Bases enough
 * that even a five-row view serialized half-built).
 *
 * That is the third time reaching into another plugin's internals has made
 * things worse rather than better, after suspending Dataview's refresh and
 * pausing between notes. So the rows are taken as found, and
 * `isBasesViewUnfinished` plus the truncation check make a short table
 * refuse to publish rather than ship as though it were complete.
 *
 * The honest fix is to read Bases' own data rather than its DOM, which needs
 * an API it does not currently expose.
 */

/**
 * True when a view has been built but its rows have not arrived.
 *
 * Bases renders its header and toolbar before it has any rows, so a view in
 * that state has child elements and text and looks finished to anything
 * asking "is this populated". It is the same shape of mistake as a Dataview
 * block serializing the word "Loading": present, non-empty, and not the
 * answer.
 *
 * The toolbar's own result count is what makes this decidable. A view
 * claiming results while showing none is unfinished; a view claiming none is
 * simply empty, and waiting for it would never end.
 */
/**
 * True when a Bases embed exists but has not produced a view yet.
 *
 * The embed wrapper and its toolbar render before the view inside them does,
 * and a check that only inspects `.bases-view` elements finds none to
 * object to, so the page serializes with a toolbar and no table. This was
 * intermittent -- the same note published 18 rows on one run and none on the
 * next -- which is the signature of a race rather than a missing feature.
 */
export function hasUnbuiltBasesEmbed(root: HTMLElement): boolean {
  for (const embed of Array.from(root.querySelectorAll(".bases-embed"))) {
    if (!embed.querySelector(".bases-view")) return true;
  }
  return false;
}

export function isBasesViewUnfinished(view: Element): boolean {
  // Bases says so itself. A table container carries `is-loading` until its
  // rows exist, which beats inferring the same thing from counts -- and it
  // is available immediately, while the toolbar still reads "Results" with
  // no number in it.
  if (view.querySelector(".is-loading")) return true;

  const rows = view.querySelectorAll(
    ".bases-tbody > .bases-tr, .bases-cards-item",
  ).length;
  if (rows > 0) return false;

  // No rows. The only reading of that which means "finished" is a view whose
  // own toolbar says there are none to show.
  //
  // An earlier version treated a rendered header as evidence of being
  // finished, which inverted the moment the columns appeared before the
  // rows: the toolbar still read "Results" with no number, so the view was
  // called complete and published empty. A count we cannot read yet is not
  // a count of zero.
  const claimed = claimedResultCount(view);
  return claimed !== 0;
}

/** The total Bases reports in its toolbar, e.g. "5 results". Ground truth. */
function claimedResultCount(view: Element): number | null {
  const embed = view.closest(".bases-embed") ?? view.parentElement;
  const label = embed?.querySelector(".bases-toolbar-result-count");
  const match = (label?.textContent ?? "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function buildFigure(
  doc: Document,
  kind: string,
  name: string,
): HTMLElement {
  const figure = doc.createElement("figure");
  figure.className = "osp-base";
  figure.dataset.baseView = kind;
  if (name) {
    const caption = doc.createElement("figcaption");
    caption.className = "osp-base-name";
    caption.textContent = name;
    figure.append(caption);
  }
  return figure;
}

function buildTable(
  doc: Document,
  view: Element,
  name: string,
  stats: BasesStats,
): HTMLElement | null {
  const bodyRows = Array.from(view.querySelectorAll(".bases-tbody > .bases-tr"));
  const dataRows = bodyRows.filter((row) => !isMeasurementRow(row));
  stats.measurementDropped += bodyRows.length - dataRows.length;
  if (!dataRows.length) return null;

  // Header cells carry no data-property, so the only link between a label and
  // a column is position. The first data row defines how many columns there
  // really are; a header with a different count means the assumption is
  // broken and positional labels would be wrong, so we drop the labels rather
  // than mislabel the data.
  const headerCells = Array.from(
    view.querySelectorAll(".bases-thead .bases-tr > .bases-td"),
  );
  const columns = Array.from(dataRows[0].querySelectorAll(":scope > .bases-td"));
  const labels =
    headerCells.length === columns.length
      ? headerCells.map(headerLabel)
      : columns.map((cell) => cell.getAttribute("data-property") ?? "");

  const figure = buildFigure(doc, "table", name);
  const table = doc.createElement("table");
  table.className = "osp-base-table";

  const thead = doc.createElement("thead");
  const headRow = doc.createElement("tr");
  for (const label of labels) {
    const th = doc.createElement("th");
    th.scope = "col";
    th.textContent = label;
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = doc.createElement("tbody");
  for (const row of dataRows) {
    const tr = doc.createElement("tr");
    for (const cell of Array.from(row.querySelectorAll(":scope > .bases-td"))) {
      const td = doc.createElement("td");
      const property = cell.getAttribute("data-property");
      if (property) td.dataset.property = property;
      moveValue(cell, td, stats);
      tr.append(td);
    }
    tbody.append(tr);
    stats.rows++;
  }
  table.append(tbody);

  figure.append(table);
  figure.dataset.ospRows = String(dataRows.length);
  return figure;
}

function buildCards(
  doc: Document,
  view: Element,
  name: string,
  stats: BasesStats,
): HTMLElement | null {
  const items = Array.from(view.querySelectorAll(".bases-cards-item"));
  const dataItems = items.filter((item) => !isMeasurementRow(item));
  stats.measurementDropped += items.length - dataItems.length;
  if (!dataItems.length) return null;

  const figure = buildFigure(doc, "cards", name);
  const list = doc.createElement("ul");
  list.className = "osp-base-cards";

  for (const item of dataItems) {
    const card = doc.createElement("li");
    card.className = "osp-base-card";

    const properties = Array.from(
      item.querySelectorAll(".bases-cards-property[data-property]"),
    );

    const fields = doc.createElement("dl");
    fields.className = "osp-base-card-fields";

    for (const property of properties) {
      const line = property.querySelector(".bases-cards-line") ?? property;

      // The title property leads the card, but it is not a document
      // heading: it was an <h3> at first, and every card title then showed
      // up in the page's table of contents as though a row of a table were
      // a section of the page. A card is data, not structure.
      if (property.classList.contains("mod-title")) {
        const title = doc.createElement("div");
        title.className = "osp-base-card-title";
        moveValue(line, title, stats);
        card.append(title);
        continue;
      }

      const term = doc.createElement("dt");
      term.textContent = (
        property.querySelector(".bases-cards-label")?.textContent ?? ""
      ).trim();
      const value = doc.createElement("dd");
      moveValue(line, value, stats);
      fields.append(term, value);
    }

    if (fields.childElementCount) card.append(fields);
    list.append(card);
    stats.rows++;
  }

  figure.append(list);
  figure.dataset.ospRows = String(dataItems.length);
  return figure;
}

/**
 * True for the hidden element Bases renders to measure text.
 *
 * Its cells carry no `data-property` and its text is a font-metrics string
 * ("Fj"), which is how it got noticed: it published as a row of real-looking
 * nonsense. Absence of `data-property` is the stable half of that signal.
 */
function isMeasurementRow(row: Element): boolean {
  return row.querySelector("[data-property]") === null;
}

function headerLabel(cell: Element): string {
  const name = cell.querySelector(".bases-table-header-name");
  return (name?.textContent ?? cell.textContent ?? "").trim();
}

/**
 * Moves a cell's value into `target`, resolving anything whose content is not
 * in the markup.
 *
 * Nodes are moved rather than stringified so links, inline markdown and
 * formatting survive, and so the link rewriter still sees `.internal-link`
 * elements afterwards.
 */
function moveValue(source: Element, target: Element, stats: BasesStats): void {
  const doc = target.ownerDocument;
  const cell = source.querySelector(".bases-table-cell") ?? source;

  // Form controls first: their value is a property, so serializing the markup
  // loses it. This is the fix for the blank number columns.
  for (const control of Array.from(cell.querySelectorAll("input, textarea, select"))) {
    const text = controlValue(control);
    if (text) stats.inputValues++;
    control.replaceWith(doc.createTextNode(text));
  }

  // The editors Obsidian wraps a metadata value in are inputs by another
  // name; their wrapper div adds nothing once the value is plain text.
  for (const wrapper of Array.from(
    cell.querySelectorAll('[class^="metadata-input"], [class*=" metadata-input"]'),
  )) {
    wrapper.replaceWith(...Array.from(wrapper.childNodes));
  }

  for (const noise of Array.from(cell.querySelectorAll("svg, button"))) {
    noise.remove();
  }

  while (cell.firstChild) target.append(cell.firstChild);

  // A genuinely empty property is empty, not broken. Collapsing it to nothing
  // keeps the placeholder counter from treating it as unfinished work.
  if (!(target.textContent ?? "").trim() && !target.querySelector("img")) {
    target.textContent = "";
  }
}

function controlValue(control: Element): string {
  if (control.instanceOf(HTMLInputElement)) {
    if (control.type === "checkbox") return control.checked ? "Yes" : "No";
    return control.value;
  }
  if (control.instanceOf(HTMLTextAreaElement)) return control.value;
  if (control.instanceOf(HTMLSelectElement)) return control.value;
  return "";
}
