import { describe, expect, it } from "vitest";
import {
  addRule,
  declarations,
  findRule,
  isSafeSelector,
  isWidthQuery,
  isPropertyName,
  isSafeValue,
  sameSelector,
  setDeclaration,
  setInlineDeclaration,
  statements,
} from "./editCss";
import { applyEdits, planOp, prepareForEditing } from "./edit";

const CSS = [
  "/* a { } comment with ; and } in it */",
  ":root { --accent: #3a5bd9; --text: #111 }",
  "@import url('x.css');",
  ".card { background: #fff url(\"a;b}.png\"); border-radius: 14px }",
  "@media (max-width: 600px) {",
  "  .card { padding: 8px; }",
  "  h2 { color: red }",
  "}",
  "h2 {",
  "  margin: 0;",
  "  color: var(--text) !important;",
  "}",
].join("\n");

function rule(path: number[], selector: string) {
  const found = findRule(CSS, 0, CSS.length, path, selector);
  if (!found) throw new Error(`no rule ${selector}`);
  return found;
}

describe("the CSS scanner", () => {
  it("indexes statements the way the CSSOM does, stepping over comments and strings", () => {
    const top = statements(CSS);
    expect(top.map((s) => CSS.slice(s.preludeStart, s.preludeEnd).trim())).toEqual([
      ":root",
      "@import url('x.css')",
      ".card",
      "@media (max-width: 600px)",
      "h2",
    ]);
  });

  it("finds a rule inside an @media by its path", () => {
    const found = rule([3, 1], "h2");
    expect(CSS.slice(found.blockStart, found.blockEnd).trim()).toBe("color: red");
  });

  it("falls back to a unique selector when the index is off", () => {
    expect(findRule(CSS, 0, CSS.length, [2], ":root")).not.toBeNull();
    // .card is written twice (once inside the @media), so a wrong index
    // cannot be rescued: the rule it meant is not knowable.
    expect(findRule(CSS, 0, CSS.length, [0], ".card")).toBeNull();
  });

  it("compares selectors the way the browser prints them", () => {
    expect(sameSelector("a>b ,c", "a > b, c")).toBe(true);
    expect(sameSelector(".a .b", ".a.b")).toBe(true);
    expect(sameSelector(".a", ".b")).toBe(false);
  });

  it("reads declarations, values and !important", () => {
    const h2 = rule([4], "h2");
    const found = declarations(CSS, h2.blockStart, h2.blockEnd);
    expect(found.map((d) => [d.name, CSS.slice(d.valueStart, d.valueEnd), d.important])).toEqual([
      ["margin", "0", false],
      ["color", "var(--text)", true],
    ]);
  });
});

describe("setDeclaration", () => {
  it("replaces a value and keeps !important", () => {
    const h2 = rule([4], "h2");
    const next = applyEdits(CSS, [setDeclaration(CSS, h2.blockStart, h2.blockEnd, "color", "#0a0")]);
    expect(next).toContain("  color: #0a0 !important;\n}");
  });

  it("adds a longhand after a shorthand rather than rewriting it", () => {
    const card = rule([2], ".card");
    const next = applyEdits(CSS, [setDeclaration(CSS, card.blockStart, card.blockEnd, "background-color", "#eef")]);
    expect(next).toContain('.card { background: #fff url("a;b}.png"); border-radius: 14px; background-color: #eef; }');
  });

  it("adds to a block of one declaration per line on a line of its own", () => {
    const h2 = rule([4], "h2");
    const next = applyEdits(CSS, [setDeclaration(CSS, h2.blockStart, h2.blockEnd, "background-color", "#fff")]);
    expect(next).toContain("  color: var(--text) !important;\n  background-color: #fff;\n}");
  });

  it("changes a token where it is defined", () => {
    const root = rule([0], ":root");
    const next = applyEdits(CSS, [setDeclaration(CSS, root.blockStart, root.blockEnd, "--accent", "#e44")]);
    expect(next).toContain(":root { --accent: #e44; --text: #111 }");
  });
});

describe("inline styles and what may be written", () => {
  it("sets a property in a style attribute", () => {
    expect(setInlineDeclaration("color: red; margin: 0", "color", "blue")).toBe("color: blue; margin: 0");
    expect(setInlineDeclaration("margin: 0;", "color", "blue")).toBe("margin: 0; color: blue");
    expect(setInlineDeclaration("", "color", "blue")).toBe("color: blue");
  });

  it("refuses anything that could escape the declaration", () => {
    expect(isSafeValue("#3a5bd9")).toBe(true);
    expect(isSafeValue("rgb(10, 20, 30)")).toBe(true);
    expect(isSafeValue("var(--accent)")).toBe(true);
    for (const bad of ["red; display: none", "red}</style><script>", 'url("x")', "", "x".repeat(201)]) {
      expect(isSafeValue(bad)).toBe(false);
    }
    expect(isPropertyName("background-color")).toBe(true);
    expect(isPropertyName("--accent")).toBe(true);
    expect(isPropertyName("color:red")).toBe(false);
  });
});

describe("style requests on a page", () => {
  const PAGE = [
    "<!doctype html><html><head><style>",
    ".card{background:#fff;border-radius:14px}",
    "button{background:#3a5bd9;color:#fff}",
    "</style></head><body>",
    '<section class="card"><button style="margin: 0">Pay</button></section>',
    "</body></html>",
  ].join("\n");
  const sheet = PAGE.indexOf("<style>");

  it("stamps style blocks so the page can name them", () => {
    expect(prepareForEditing(PAGE, "")).toContain(`<style data-osp-src="${sheet}">`);
  });

  it("edits the winning rule in the file", () => {
    const plan = planOp(PAGE, {
      op: "rule-style",
      sheet,
      path: [1],
      selector: "button",
      props: [["background-color", "#0a7"]],
    });
    if (!plan.ok) throw new Error(plan.error);
    // In the block's own minified style.
    expect(applyEdits(PAGE, plan.edits)).toContain("button{background:#3a5bd9;color:#fff;background-color:#0a7}");
  });

  it("sets one element's colour in its style attribute", () => {
    const plan = planOp(PAGE, { op: "inline-style", at: PAGE.indexOf("<button"), props: [["color", "#000"]] });
    if (!plan.ok) throw new Error(plan.error);
    expect(applyEdits(PAGE, plan.edits)).toContain('<button style="margin: 0; color: #000">');
  });

  it("sets several declarations together, in one edit", () => {
    const plan = planOp(PAGE, {
      op: "rule-style",
      sheet,
      path: [0],
      selector: ".card",
      props: [["width", "240px"], ["flex", "0 0 auto"], ["border-radius", "8px"]],
    });
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.edits).toHaveLength(1);
    expect(applyEdits(PAGE, plan.edits)).toContain(".card{background:#fff;border-radius:8px;width:240px;flex:0 0 auto}");
    const inline = planOp(PAGE, {
      op: "inline-style",
      at: PAGE.indexOf("<button"),
      props: [["width", "120px"], ["margin", "4px"]],
    });
    if (!inline.ok) throw new Error(inline.error);
    expect(applyEdits(PAGE, inline.edits)).toContain('<button style="margin: 4px; width: 120px">');
  });

  it("refuses a rule it cannot find", () => {
    const plan = planOp(PAGE, { op: "rule-style", sheet, path: [9], selector: ".nope", props: [["color", "red"]] });
    expect(plan.ok).toBe(false);
  });
});

describe("addRule", () => {
  const SPACED = "\n.a {\n  color: red;\n}\n";
  const MINI = "\n.a{color:red}\n@media (max-width: 600px){.a{color:blue}}\n";

  function run(css: string, selector: string, props: Array<[string, string]>, media?: string): string {
    return applyEdits(css, [addRule(css, 0, css.length, selector, props, media)]);
  }

  it("appends a rule in the sheet's own style", () => {
    expect(run(SPACED, ".item", [["color", "#123456"]])).toBe("\n.a {\n  color: red;\n}\n.item {\n  color: #123456;\n}\n");
    expect(run(MINI, ".item", [["color", "#123456"]])).toContain("@media (max-width: 600px){.a{color:blue}}\n.item{color:#123456}\n");
  });

  it("adds to a top-level rule that already has the selector", () => {
    expect(run(SPACED, ".a", [["background-color", "#fff"]])).toBe("\n.a {\n  color: red;\n  background-color: #fff;\n}\n");
  });

  it("writes a width-bound change into a new @media block", () => {
    expect(run(SPACED, ".a", [["color", "green"]], "(max-width: 480px)")).toContain(
      "}\n@media (max-width: 480px) {\n  .a {\n    color: green;\n  }\n}\n",
    );
  });

  it("reuses an @media block with the same condition, and the rule inside it", () => {
    expect(run(MINI, ".a", [["color", "green"]], "(max-width:600px)")).toContain("@media (max-width: 600px){.a{color:green}}");
    expect(run(MINI, ".b", [["color", "green"]], "(max-width: 600px)")).toContain("@media (max-width: 600px){.a{color:blue}\n.b{color:green}\n}");
  });

  it("only writes selectors and conditions that cannot break out", () => {
    expect(isSafeSelector("li.todo-item > span")).toBe(true);
    expect(isSafeSelector("#list [data-x=\"1\"]")).toBe(true);
    expect(isSafeSelector(".a{}")).toBe(false);
    expect(isSafeSelector("</style><script>")).toBe(false);
    expect(isWidthQuery("(max-width: 768px)")).toBe(true);
    expect(isWidthQuery("(max-width: 768px) and (color)")).toBe(false);
  });

  it("creates a style block in the head when the file has none", () => {
    const page = "<!doctype html><html><head><title>x</title></head><body><ul id=\"list\"></ul></body></html>";
    const plan = planOp(page, { op: "add-rule", sheet: null, selector: "#list li", props: [["color", "#333"]] });
    if (!plan.ok) throw new Error(plan.error);
    expect(applyEdits(page, plan.edits)).toContain("<title>x</title><style>\n#list li {\n  color: #333;\n}\n</style>\n</head>");
  });
});
