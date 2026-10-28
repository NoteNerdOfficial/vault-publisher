import { describe, expect, it } from "vitest";
import {
  BLOCK_ATTRIBUTE,
  blockId,
  normalizeBlockText,
  stampBlockIds,
} from "./anchor";

function render(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

function ids(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll(`[${BLOCK_ATTRIBUTE}]`)).map(
    (el) => el.getAttribute(BLOCK_ATTRIBUTE) ?? "",
  );
}

function idOf(root: HTMLElement, selector: string): string | null {
  return root.querySelector(selector)?.getAttribute(BLOCK_ATTRIBUTE) ?? null;
}

describe("normalizeBlockText", () => {
  // The case this exists for: authors re-wrap paragraphs in the Markdown
  // source constantly, which changes the whitespace Obsidian renders and
  // nothing else. An anchor that moved every time someone reflowed a line
  // would be useless.
  it("collapses whitespace so re-wrapping the source changes nothing", () => {
    expect(normalizeBlockText("one\n  two\tthree ")).toBe("one two three");
  });
});

describe("blockId", () => {
  it("is stable for the same tag and text", () => {
    expect(blockId("P", "The same words")).toBe(blockId("p", "The same words"));
  });

  it("differs when the text differs", () => {
    expect(blockId("p", "One")).not.toBe(blockId("p", "Two"));
  });

  // A <li> and the <p> Obsidian nests inside it hold identical text, so the
  // tag has to be part of the hash or every list item collides with its own
  // child and the numbering below becomes the only thing telling them apart.
  it("differs when the tag differs but the text does not", () => {
    expect(blockId("li", "Same")).not.toBe(blockId("p", "Same"));
  });

  it("is unaffected by surrounding whitespace", () => {
    expect(blockId("p", "  Padded  ")).toBe(blockId("p", "Padded"));
  });
});

describe("stampBlockIds", () => {
  it("stamps every commentable block", () => {
    const root = render(
      `<h2>Heading</h2><p>First.</p><ul><li>Item</li></ul>` +
        `<blockquote>Quoted.</blockquote><pre>code()</pre>` +
        `<table><tr><td>Cell</td></tr></table>`,
    );

    expect(stampBlockIds(root)).toBe(6);
    expect(idOf(root, "h2")).toBeTruthy();
    expect(idOf(root, "blockquote")).toBeTruthy();
    expect(idOf(root, "table")).toBeTruthy();
  });

  // The defect the whole module exists to avoid. A positional scheme would
  // renumber every block below the insertion, so every comment below it would
  // quietly move up one paragraph.
  it("keeps a block's id when a block is inserted above it", () => {
    const before = render(`<p>Alpha.</p><p>Beta.</p>`);
    stampBlockIds(before);
    const beta = idOf(before, "p:nth-of-type(2)");

    const after = render(`<p>Inserted.</p><p>Alpha.</p><p>Beta.</p>`);
    stampBlockIds(after);

    expect(idOf(after, "p:nth-of-type(3)")).toBe(beta);
  });

  it("keeps a block's id when blocks are reordered", () => {
    const before = render(`<p>Alpha.</p><p>Beta.</p>`);
    stampBlockIds(before);
    const alpha = idOf(before, "p:nth-of-type(1)");

    const after = render(`<p>Beta.</p><p>Alpha.</p>`);
    stampBlockIds(after);

    expect(idOf(after, "p:nth-of-type(2)")).toBe(alpha);
  });

  // Deliberate: the words the comment was about are gone, so the anchor
  // should be too. Reattaching it to the rewritten text would be attaching
  // somebody's objection to a sentence they never read.
  it("changes a block's id when its own text is rewritten", () => {
    const before = render(`<p>Alpha.</p>`);
    stampBlockIds(before);
    const alpha = idOf(before, "p");

    const after = render(`<p>Alpha, revised.</p>`);
    stampBlockIds(after);

    expect(idOf(after, "p")).not.toBe(alpha);
  });

  it("numbers duplicates so two identical blocks stay distinct", () => {
    const root = render(`<p>Repeated.</p><p>Repeated.</p><p>Repeated.</p>`);

    expect(stampBlockIds(root)).toBe(3);
    const stamped = ids(root);
    expect(new Set(stamped).size).toBe(3);
    expect(stamped[1]).toBe(`${stamped[0]}-1`);
    expect(stamped[2]).toBe(`${stamped[0]}-2`);
  });

  it("skips blocks with no text", () => {
    const root = render(`<p></p><p>   </p><p>Real.</p>`);

    expect(stampBlockIds(root)).toBe(1);
    expect(idOf(root, "p:nth-of-type(3)")).toBeTruthy();
    expect(idOf(root, "p:nth-of-type(1)")).toBeNull();
  });

  it("stamps a list item and the paragraph inside it separately", () => {
    const root = render(`<ul><li><p>Nested.</p></li></ul>`);

    expect(stampBlockIds(root)).toBe(2);
    expect(idOf(root, "li")).not.toBe(idOf(root, "p"));
  });

  it("is idempotent", () => {
    const root = render(`<p>Alpha.</p><p>Beta.</p>`);
    stampBlockIds(root);
    const first = ids(root);
    stampBlockIds(root);

    expect(ids(root)).toEqual(first);
  });
});
