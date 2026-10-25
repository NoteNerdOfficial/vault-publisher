import { describe, expect, it } from "vitest";
import { stripFrontmatter } from "./page";

/** Builds a container the way Obsidian's renderer leaves one. */
function render(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("stripFrontmatter", () => {
  // The defect this exists for: `display: none` still serializes, so every
  // published page was carrying its note's YAML in the HTML source.
  it("removes the frontmatter block Obsidian emits", () => {
    const root = render(
      `<pre class="frontmatter language-yaml">` +
        `client: Acme Holdings\nrate: 450\nstatus: do-not-publish` +
        `</pre><p>The visible note.</p>`,
    );

    expect(stripFrontmatter(root)).toBe(1);
    expect(root.innerHTML).toContain("The visible note.");
    expect(root.innerHTML).not.toContain("Acme Holdings");
    expect(root.innerHTML).not.toContain("450");
    expect(root.innerHTML).not.toContain("do-not-publish");
  });

  it("removes the properties container too", () => {
    const root = render(
      `<div class="frontmatter-container"><div>tags</div></div><p>Body.</p>`,
    );

    expect(stripFrontmatter(root)).toBe(1);
    expect(root.querySelector(".frontmatter-container")).toBeNull();
    expect(root.textContent).toBe("Body.");
  });

  it("leaves a note without frontmatter alone", () => {
    const root = render(`<h2>Heading</h2><p>Body.</p>`);

    expect(stripFrontmatter(root)).toBe(0);
    expect(root.innerHTML).toBe("<h2>Heading</h2><p>Body.</p>");
  });

  it("does not mistake a code block for frontmatter", () => {
    const root = render(
      `<pre><code class="language-yaml">name: kept</code></pre>`,
    );

    expect(stripFrontmatter(root)).toBe(0);
    expect(root.textContent).toContain("name: kept");
  });
});
