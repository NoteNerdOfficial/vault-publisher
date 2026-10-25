import { describe, expect, it } from "vitest";
import { indexUnpublished, scanForLeaks } from "./privacy";

function render(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

function index(entries: Record<string, string>) {
  return indexUnpublished(new Map(Object.entries(entries)));
}

// Keyed the way `buildSite` keys it: the file's own basename, lower-cased, so
// the path and the name in the map always agree.
const LIBRARY = index({
  "the glass bead game": "library/The Glass Bead Game.md",
  "pattern language": "library/Pattern Language.md",
  api: "library/api.md",
});

describe("scanForLeaks", () => {
  it("finds an unpublished note named in query output", () => {
    const root = render(
      `<div class="block-language-dataview"><table><tr><td>` +
        `The Glass Bead Game</td><td>1943</td></tr></table></div>`,
    );

    const report = scanForLeaks(root, LIBRARY);

    expect(report.notes).toEqual(["library/The Glass Bead Game.md"]);
    expect(report.leaks[0].kind).toBe("text");
    expect(report.leaks[0].context).toContain("The Glass Bead Game");
  });

  it("finds a downgraded link by the target left for it", () => {
    const root = render(
      `<span class="osp-unresolved-link" data-osp-unresolved="library/Pattern Language.md">` +
        `that book</span>`,
    );

    const report = scanForLeaks(root, LIBRARY);

    expect(report.notes).toEqual(["library/Pattern Language.md"]);
    expect(report.leaks[0].kind).toBe("link");
  });

  // `textContent` would run the cells together as "...Game1943", putting a
  // digit against the name and defeating the word boundary.
  it("finds a name that ends a table cell", () => {
    const root = render(
      `<div class="block-language-dataview"><table><tr>` +
        `<td>Pattern Language</td><td>1977</td></tr></table></div>`,
    );
    expect(scanForLeaks(root, LIBRARY).notes).toEqual([
      "library/Pattern Language.md",
    ]);
  });

  // The other half of that fix: joining cells must not invent a phrase. A
  // space separator would read these two cells as the note "pattern language".
  it("does not assemble a name out of two separate cells", () => {
    const root = render(
      `<div class="block-language-dataview"><table><tr>` +
        `<td>Pattern</td><td>Language</td></tr></table></div>`,
    );
    expect(scanForLeaks(root, LIBRARY).leaks).toEqual([]);
  });

  it("ignores prose outside a generated block", () => {
    const root = render(`<p>I have been rereading Pattern Language.</p>`);
    expect(scanForLeaks(root, LIBRARY).leaks).toEqual([]);
  });

  // Behaviour the old per-name implementation had, which the single
  // alternation must not lose.
  it("respects word boundaries", () => {
    const root = render(
      `<div class="block-language-dataview">rapid, apiary, therapist</div>`,
    );
    expect(scanForLeaks(root, LIBRARY).leaks).toEqual([]);
  });

  it("matches a name sitting against punctuation", () => {
    const root = render(
      `<div class="block-language-dataview">(api), done</div>`,
    );
    expect(scanForLeaks(root, LIBRARY).notes).toEqual(["library/api.md"]);
  });

  it("matches case-insensitively", () => {
    const root = render(`<div class="osp-base">PATTERN LANGUAGE</div>`);
    expect(scanForLeaks(root, LIBRARY).notes).toEqual([
      "library/Pattern Language.md",
    ]);
  });

  it("reports each note once however often it appears", () => {
    const root = render(
      `<div class="block-language-dataview">api api api</div>` +
        `<div class="block-language-datacore">api</div>`,
    );
    expect(scanForLeaks(root, LIBRARY).leaks).toHaveLength(1);
  });

  it("finds every distinct note in one block", () => {
    const root = render(
      `<div class="block-language-dataview">api and Pattern Language</div>`,
    );
    expect(scanForLeaks(root, LIBRARY).notes.sort()).toEqual([
      "library/Pattern Language.md",
      "library/api.md",
    ]);
  });

  // Two names adjacent with only a separator between them: a boundary that
  // consumed its neighbouring character would match the first and skip the
  // second.
  it("finds adjacent names", () => {
    const root = render(`<div class="osp-base">api,api</div>`);
    expect(scanForLeaks(root, LIBRARY).notes).toEqual(["library/api.md"]);

    const both = render(`<div class="osp-base">api|pattern language</div>`);
    expect(scanForLeaks(both, LIBRARY).notes.sort()).toEqual([
      "library/Pattern Language.md",
      "library/api.md",
    ]);
  });

  it("prefers the longer name where two could match", () => {
    const overlapping = index({
      api: "notes/api.md",
      "api design": "notes/api-design.md",
    });
    const root = render(`<div class="osp-base">api design</div>`);

    // "api design" is one note's whole name; the shorter note is not present,
    // because "api" here is not a standalone word.
    expect(scanForLeaks(root, overlapping).notes).toEqual([
      "notes/api-design.md",
    ]);
  });

  it("treats a name with regex metacharacters literally", () => {
    const awkward = index({ "c++ (notes)": "dev/c++ (notes).md" });
    const root = render(`<div class="osp-base">see C++ (notes) for more</div>`);

    expect(scanForLeaks(root, awkward).notes).toEqual(["dev/c++ (notes).md"]);
  });

  it("scans nothing when the whole vault is published", () => {
    const empty = index({});
    expect(empty.patterns).toHaveLength(0);
    const root = render(`<div class="block-language-dataview">anything</div>`);
    expect(scanForLeaks(root, empty).leaks).toEqual([]);
  });

  // The index is shared across every page of a build, so a global regex's
  // lastIndex must not carry from one page into the next.
  it("gives the same answer on repeated scans with one index", () => {
    const shared = index({ api: "library/api.md" });
    const first = render(`<div class="osp-base">api</div>`);
    const second = render(`<div class="osp-base">api</div>`);

    expect(scanForLeaks(first, shared).notes).toEqual(["library/api.md"]);
    expect(scanForLeaks(second, shared).notes).toEqual(["library/api.md"]);
  });

  it("batches a name set larger than one alternation", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 950; i++) many[`note-${i}`] = `vault/note-${i}.md`;
    const big = index(many);

    expect(big.patterns).toHaveLength(3);

    // One from each batch, by position in the longest-first ordering.
    const root = render(
      `<div class="osp-base">note-0 note-500 note-949</div>`,
    );
    expect(scanForLeaks(root, big).notes.sort()).toEqual([
      "vault/note-0.md",
      "vault/note-500.md",
      "vault/note-949.md",
    ]);
  });
});
