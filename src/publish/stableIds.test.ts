import { describe, expect, it } from "vitest";
import { stripDebugAttributes } from "./stableIds";

function render(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("stripDebugAttributes", () => {
  it("removes Datacore's JSX debug attributes", () => {
    const root = render(
      `<div __self="[object Object]" __source="[object Object]"><b>Hi</b></div>`,
    );

    expect(stripDebugAttributes(root)).toBe(2);
    expect(root.innerHTML).toBe("<div><b>Hi</b></div>");
  });

  // `rewriteLinks` records the original target so `scanForLeaks` can report
  // it. Both have run by now, and the value is the name of a note the author
  // chose not to publish.
  it("removes the unpublished link target left for the privacy scan", () => {
    const root = render(
      `<span class="osp-unresolved-link" data-osp-unresolved="private/Severance package">` +
        `the arrangement</span>`,
    );

    expect(stripDebugAttributes(root)).toBe(1);
    expect(root.innerHTML).not.toContain("Severance");
    // The reader still sees the author's own words, and the styling hook stays.
    expect(root.textContent).toBe("the arrangement");
    expect(root.querySelector(".osp-unresolved-link")).not.toBeNull();
  });

  it("counts nothing and changes nothing on a clean subtree", () => {
    const root = render(`<p>Ordinary <a href="./other.html">prose</a>.</p>`);
    const before = root.innerHTML;

    expect(stripDebugAttributes(root)).toBe(0);
    expect(root.innerHTML).toBe(before);
  });
});
