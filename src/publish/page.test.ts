import { describe, expect, it } from "vitest";
import {
  neutralizeMermaidColours,
  prepareCodeBlocks,
  prepareCollapsibleCallouts,
  prepareTables,
  stripFrontmatter,
} from "./page";

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

describe("prepareCollapsibleCallouts", () => {
  it("turns the fold control into an accessible toggle", () => {
    const root = render(
      `<div class="callout is-collapsible is-collapsed"><div class="callout-fold"></div>` +
        `<div class="callout-content" style="display: none">Body</div></div>`,
    );

    expect(prepareCollapsibleCallouts(root)).toBe(1);
    expect(root.querySelector(".callout")?.classList.contains("is-collapsed")).toBe(true);
    expect(root.querySelector(".callout-content")?.hasAttribute("hidden")).toBe(true);
    expect(root.querySelector(".callout-fold")).toBeNull();
    expect(root.querySelector(".osp-callout-toggle")?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("prepareCodeBlocks", () => {
  it("gives a block a bar that names its language and offers the two controls", () => {
    const root = render(`<pre><code class="language-ts">const x = 1;</code></pre>`);

    expect(prepareCodeBlocks(root)).toBe(1);
    const figure = root.querySelector("figure.osp-code") as HTMLElement;
    expect(figure.getAttribute("data-osp-lang")).toBe("ts");
    expect(figure.querySelector(".osp-code-lang")?.textContent).toBe("TypeScript");
    expect(figure.querySelector("[data-osp-wrap]")).not.toBeNull();
    expect(figure.querySelector("[data-osp-copy]")).not.toBeNull();
    // The code itself is moved, not copied or re-serialized.
    expect(figure.querySelector("pre code")?.textContent).toBe("const x = 1;");
  });

  it("ships the controls hidden, because a copy button needs a script", () => {
    const root = render(`<pre><code>plain</code></pre>`);
    prepareCodeBlocks(root);

    const tools = root.querySelector("[data-osp-code-tools]") as HTMLElement;
    expect(tools.hidden).toBe(true);
  });

  it("shows no language when the fence named none", () => {
    const root = render(`<pre><code>plain</code></pre>`);
    prepareCodeBlocks(root);

    expect(root.querySelector(".osp-code-lang")?.textContent).toBe("");
    expect(root.querySelector("figure.osp-code")?.hasAttribute("data-osp-lang")).toBe(false);
  });

  it("names a language it does not know as the author wrote it", () => {
    const root = render(`<pre><code class="language-nix">{}</code></pre>`);
    prepareCodeBlocks(root);

    expect(root.querySelector(".osp-code-lang")?.textContent).toBe("nix");
  });

  // The defect this exists for: the button is wired to an app that is not
  // there, so it shipped on every published page doing nothing.
  it("removes Obsidian's own copy button rather than hiding it", () => {
    const root = render(
      `<pre><code>x</code><button class="copy-code-button">Copy</button></pre>`,
    );
    prepareCodeBlocks(root);

    expect(root.querySelector(".copy-code-button")).toBeNull();
  });

  it("leaves a failed diagram and a Dataview placeholder alone", () => {
    const root = render(
      `<div class="mermaid-wrapper"><pre><code class="language-mermaid">graph TD</code></pre></div>` +
        `<pre class="dataview dataview-error"><code>Loading...</code></pre>`,
    );

    expect(prepareCodeBlocks(root)).toBe(0);
    expect(root.querySelector("figure.osp-code")).toBeNull();
  });

  it("runs twice without wrapping a block in a block", () => {
    const root = render(`<pre><code class="language-sh">ls</code></pre>`);
    prepareCodeBlocks(root);

    expect(prepareCodeBlocks(root)).toBe(0);
    expect(root.querySelectorAll("figure.osp-code")).toHaveLength(1);
  });
});

describe("prepareTables", () => {
  function table(body: string): HTMLElement {
    return render(
      `<table><thead><tr><th>Note</th><th>Words</th></tr></thead><tbody>${body}</tbody></table>`,
    );
  }

  it("gives the table a wrapper to scroll in, and leaves it a table", () => {
    const root = table(`<tr><td>One</td><td>12</td></tr>`);

    expect(prepareTables(root)).toBe(1);
    const wrap = root.querySelector(".osp-table-wrap") as HTMLElement;
    expect(wrap.classList.contains("osp-scroller")).toBe(true);
    expect(wrap.firstElementChild?.tagName).toBe("TABLE");
  });

  it("marks a column of numbers, header included", () => {
    const root = table(
      `<tr><td>One</td><td>1,204</td></tr><tr><td>Two</td><td>98</td></tr>`,
    );
    prepareTables(root);

    expect(root.querySelectorAll("td[data-osp-num]")).toHaveLength(2);
    expect(root.querySelectorAll("th[data-osp-num]")).toHaveLength(1);
    // The words are left alone.
    expect(root.querySelector("tbody tr td")?.hasAttribute("data-osp-num")).toBe(false);
  });

  it("leaves dates, versions and ranges as the text they are", () => {
    const root = table(
      `<tr><td>One</td><td>2026-10-24</td></tr><tr><td>Two</td><td>1.2.3</td></tr>`,
    );
    prepareTables(root);

    expect(root.querySelectorAll("[data-osp-num]")).toHaveLength(0);
  });

  it("does not argue with an alignment the author wrote", () => {
    const root = table(
      `<tr><td>One</td><td align="center">12</td></tr>`,
    );
    prepareTables(root);

    expect(root.querySelectorAll("[data-osp-num]")).toHaveLength(0);
  });

  it("runs twice without nesting one wrapper in another", () => {
    const root = table(`<tr><td>One</td><td>12</td></tr>`);
    prepareTables(root);

    expect(prepareTables(root)).toBe(0);
    expect(root.querySelectorAll(".osp-table-wrap")).toHaveLength(1);
  });
});

describe("neutralizeMermaidColours", () => {
  /** A diagram the way Mermaid serializes one: colours in both places. */
  function diagram(style: string, body = ""): HTMLElement {
    return render(
      `<div class="mermaid"><svg id="diagram-1"><style>${style}</style>${body}</svg></div>`,
    );
  }

  it("takes the colours out of the scoped stylesheet", () => {
    const root = diagram(
      "#diagram-1 .node rect{fill:#ECECFF;stroke:#9370DB;stroke-width:1px;}" +
        "#diagram-1 .label{color:#333;}",
    );

    expect(neutralizeMermaidColours(root)).toBe(1);
    const css = root.querySelector("style")?.textContent ?? "";
    expect(css).not.toContain("#ECECFF");
    expect(css).not.toContain("#9370DB");
    expect(css).not.toContain("#333");
    // Geometry is Mermaid's to decide and stays untouched.
    expect(css).toContain("stroke-width:1px");
  });

  // The defect this exists for: an edge is a line because its fill is none.
  it("keeps the values that are structure rather than colour", () => {
    const root = diagram(
      "#diagram-1 .edge{fill:none;stroke:#333;stroke-dasharray:3;}" +
        "#diagram-1 .x{fill:transparent;stroke:currentColor;}",
    );
    neutralizeMermaidColours(root);

    const css = root.querySelector("style")?.textContent ?? "";
    expect(css).toContain("fill:none");
    expect(css).toContain("stroke-dasharray:3");
    expect(css).toContain("fill:transparent");
    expect(css).toContain("stroke:currentColor");
    expect(css).not.toContain("stroke:#333");
  });

  it("removes the colours the shapes carry as attributes", () => {
    const root = diagram(
      "#diagram-1{font-size:16px;}",
      `<rect fill="#ECECFF" stroke="#9370DB" stroke-width="1"></rect>` +
        `<path fill="none" stroke="black" d="M0 0"></path>` +
        `<circle fill="currentColor"></circle>`,
    );
    neutralizeMermaidColours(root);

    const rect = root.querySelector("rect") as Element;
    expect(rect.hasAttribute("fill")).toBe(false);
    expect(rect.hasAttribute("stroke")).toBe(false);
    expect(rect.getAttribute("stroke-width")).toBe("1");
    expect(root.querySelector("path")?.getAttribute("fill")).toBe("none");
    expect(root.querySelector("circle")?.getAttribute("fill")).toBe("currentColor");
  });

  it("leaves an SVG that is not a diagram alone", () => {
    const root = render(`<svg class="osp-icon"><path fill="#123456"></path></svg>`);

    expect(neutralizeMermaidColours(root)).toBe(0);
    expect(root.querySelector("path")?.getAttribute("fill")).toBe("#123456");
  });
});
