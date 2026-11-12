import { describe, expect, it } from "vitest";
import { CAPTURE_VIEW_TYPE } from "./bases";
import { BaseConfig, BasesSourceDeps, rewriteBasesForCapture } from "./basesSource";

const shelf: BaseConfig = {
  filters: { and: ['file.inFolder("shelf")'] },
  formulas: { weight: "pages / 100" },
  properties: { author: { displayName: "Author" } },
  views: [
    { type: "table", name: "All", order: ["file.name", "author"] },
    { type: "cards", name: "Covers", image: "note.cover" },
    { type: "table", name: "Short", limit: 5, summaries: { pages: "Sum" } },
    { type: "list", name: "Plain", markers: "number" },
    { type: "kanban", name: "Board" },
  ],
};

/**
 * Deps over a fixed set of base files. `parseYaml` accepts JSON only, which
 * is enough for code blocks the tests write as JSON.
 */
function deps(files: Record<string, BaseConfig> = { "Shelf.base": shelf }): BasesSourceDeps & {
  loads: string[];
} {
  const loads: string[] = [];
  return {
    loads,
    async loadBase(linkpath) {
      loads.push(linkpath);
      return files[linkpath] ?? null;
    },
    parseYaml: (text) => JSON.parse(text) as unknown,
  };
}

/** The configuration inside the single `base` block of `markdown`. */
function blockConfig(markdown: string): BaseConfig {
  const match = /```base\n([\s\S]*?)\n```/.exec(markdown);
  if (!match) throw new Error(`no base block in:\n${markdown}`);
  return JSON.parse(match[1]) as BaseConfig;
}

describe("rewriteBasesForCapture", () => {
  it("points an embedded table view at the capture view", async () => {
    const result = await rewriteBasesForCapture("# Note\n\n![[Shelf.base]]\n\nAfter.", "n.md", deps());

    expect(result.rewritten).toBe(1);
    expect(result.markdown.startsWith("# Note\n\n```base\n")).toBe(true);
    expect(result.markdown.endsWith("```\n\nAfter.")).toBe(true);
    const config = blockConfig(result.markdown);
    expect(config.views).toEqual([
      { type: CAPTURE_VIEW_TYPE, "osp-layout": "table", name: "All", order: ["file.name", "author"] },
    ]);
  });

  // Filters, formulas and display names are what make the rows the right
  // rows with the right labels. Losing any of them would publish a different
  // table from the one in Obsidian.
  it("keeps everything else about the base", async () => {
    const result = await rewriteBasesForCapture("![[Shelf.base]]", "n.md", deps());

    const config = blockConfig(result.markdown);
    expect(config.filters).toEqual(shelf.filters);
    expect(config.formulas).toEqual(shelf.formulas);
    expect(config.properties).toEqual(shelf.properties);
  });

  it("uses the view a #fragment names", async () => {
    const result = await rewriteBasesForCapture("![[Shelf.base#Short]]", "n.md", deps());

    // Summaries are copied where the capture view can read them.
    expect(blockConfig(result.markdown).views).toEqual([
      {
        type: CAPTURE_VIEW_TYPE,
        "osp-layout": "table",
        "osp-summaries": { pages: "Sum" },
        name: "Short",
        limit: 5,
        summaries: { pages: "Sum" },
      },
    ]);
  });

  it("passes the link and the note to the resolver", async () => {
    const d = deps({ "lists/Shelf.base": shelf });
    await rewriteBasesForCapture("![[lists/Shelf.base|Shelf]]", "notes/n.md", d);

    expect(d.loads).toEqual(["lists/Shelf.base"]);
  });

  it.each([
    ["Covers", "cards", { image: "note.cover" }],
    ["Plain", "list", { markers: "number" }],
  ])("points the %s %s view at the capture view, options and all", async (name, layout, options) => {
    const result = await rewriteBasesForCapture(`![[Shelf.base#${name}]]`, "n.md", deps());

    expect(blockConfig(result.markdown).views).toEqual([
      { type: CAPTURE_VIEW_TYPE, "osp-layout": layout, name, ...options },
    ]);
  });

  describe("leaves alone what it cannot safely rewrite", () => {
    it.each([
      ["a view of a layout it does not draw", "![[Shelf.base#Board]]"],
      ["a view the file does not have", "![[Shelf.base#Missing]]"],
      ["a file that does not resolve", "![[Gone.base]]"],
      ["an embed inside a sentence", "See ![[Shelf.base]] here."],
      ["an embed in a list item", "- ![[Shelf.base]]"],
      ["an embed in a callout", "> ![[Shelf.base]]"],
      ["an embed in inline code", "`![[Shelf.base]]`"],
      ["an embed indented as code", "    ![[Shelf.base]]"],
      ["an embed of a note", "![[Shelf]]"],
    ])("%s", async (_, markdown) => {
      const result = await rewriteBasesForCapture(markdown, "n.md", deps());

      expect(result.markdown).toBe(markdown);
      expect(result.rewritten).toBe(0);
    });

    it("an embed inside a fenced code block", async () => {
      const markdown = "```md\n![[Shelf.base]]\n```";
      const result = await rewriteBasesForCapture(markdown, "n.md", deps());

      expect(result.markdown).toBe(markdown);
    });

    // A shorter fence inside a longer one does not close it.
    it("an embed inside a longer fence holding a shorter one", async () => {
      const markdown = "````md\n```\n![[Shelf.base]]\n```\n````";
      const result = await rewriteBasesForCapture(markdown, "n.md", deps());

      expect(result.markdown).toBe(markdown);
    });

    it("an unclosed fence, and everything after it", async () => {
      const markdown = "```\n![[Shelf.base]]";
      const result = await rewriteBasesForCapture(markdown, "n.md", deps());

      expect(result.markdown).toBe(markdown);
    });
  });

  describe("base code blocks", () => {
    const block = (config: BaseConfig) => "```base\n" + JSON.stringify(config) + "\n```";

    it("points a table block at the capture view, using its first view", async () => {
      const result = await rewriteBasesForCapture(`Before\n\n${block(shelf)}\n\nAfter`, "n.md", deps());

      expect(result.rewritten).toBe(1);
      expect(blockConfig(result.markdown).views).toEqual([
        { type: CAPTURE_VIEW_TYPE, "osp-layout": "table", name: "All", order: ["file.name", "author"] },
      ]);
      expect(result.markdown.startsWith("Before\n\n```base\n")).toBe(true);
      expect(result.markdown.endsWith("```\n\nAfter")).toBe(true);
    });

    it("leaves a block whose first view is of a layout it does not draw", async () => {
      const markdown = block({ views: [{ type: "kanban", name: "K" }] });
      const result = await rewriteBasesForCapture(markdown, "n.md", deps());

      expect(result.markdown).toBe(markdown);
    });

    it("leaves a block it cannot parse", async () => {
      const markdown = "```base\nnot: [valid\n```";
      const result = await rewriteBasesForCapture(markdown, "n.md", deps());

      expect(result.markdown).toBe(markdown);
    });
  });

  it("rewrites every view it can draw and counts them", async () => {
    const markdown = "![[Shelf.base]]\n\ntext\n\n![[Shelf.base#Short]]\n\n![[Shelf.base#Board]]";
    const result = await rewriteBasesForCapture(markdown, "n.md", deps());

    expect(result.rewritten).toBe(2);
    expect(result.markdown).toContain("![[Shelf.base#Board]]");
  });
});
