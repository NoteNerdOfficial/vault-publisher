// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DEFAULT_EMBED_HEIGHT, frameHtmlEmbeds, parseEmbedSize } from "./htmlEmbed";
import { LinkResolver, rewriteLinks } from "./links";

const resolver = new LinkResolver([
  { sourcePath: "Projects/Spec.md", url: "spec.html" },
  { sourcePath: "Projects/proto/index.html", url: "proto/index.html" },
  { sourcePath: "Projects/chart.html", url: "chart.html" },
]);
const asIs = new Set(["proto/index.html", "chart.html"]);
const titles = new Map([["proto/index.html", "Checkout flow"]]);

function render(html: string, fromUrl = "notes/spec.html"): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  frameHtmlEmbeds(
    root,
    resolver,
    fromUrl,
    (url) => asIs.has(url),
    (url) => titles.get(url),
  );
  rewriteLinks(root, resolver, fromUrl);
  return root;
}

/** Roughly what Obsidian draws for a file type it has no embed for. */
function placeholder(src: string, alt = src): string {
  return (
    `<p><span class="internal-embed file-embed mod-generic is-loaded" src="${src}" alt="${alt}">` +
    `<span class="file-embed-title">${src}</span></span></p>`
  );
}

describe("frameHtmlEmbeds", () => {
  it("frames a published prototype in place of the placeholder", () => {
    const root = render(placeholder("proto/index.html"));
    const figure = root.querySelector("figure.osp-html-embed");
    expect(figure).not.toBeNull();
    // The paragraph went with the placeholder: a figure in a <p> is
    // rearranged by the browser.
    expect(root.querySelector("p")).toBeNull();
    expect(root.querySelector(".internal-embed")).toBeNull();

    const frame = root.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe("../proto/index.html");
    expect(frame?.getAttribute("loading")).toBe("lazy");
    expect(frame?.getAttribute("title")).toBe("Checkout flow");
    expect(root.querySelector(".osp-html-embed-title")?.textContent).toBe("Checkout flow");
  });

  it("links to the page on its own, made relative like any link", () => {
    const root = render(placeholder("proto/index.html"));
    const open = root.querySelector("a.osp-html-embed-open");
    expect(open?.getAttribute("href")).toBe("../proto/index.html");
    expect(open?.getAttribute("target")).toBe("_blank");
  });

  it("leaves no vault path anywhere in the output", () => {
    const root = render(placeholder("proto/index.html"));
    // The placeholder's own `src` was the link text, which may name folders;
    // nothing from the wrapper survives, and the anchor was resolved.
    expect(root.innerHTML).not.toContain("Projects/");
  });

  it("names a page without a title by its file", () => {
    const root = render(placeholder("chart.html"), "spec.html");
    expect(root.querySelector(".osp-html-embed-title")?.textContent).toBe("chart.html");
    expect(root.querySelector("iframe")?.getAttribute("src")).toBe("./chart.html");
  });

  it("takes its height from the link text", () => {
    const root = render(placeholder("chart.html|420", "420"));
    expect(root.querySelector("figure")?.getAttribute("data-height")).toBe("420");
    expect(root.querySelector("iframe")?.getAttribute("style")).toContain("420px");
  });

  it("takes a starting width and height as WxH", () => {
    const root = render(placeholder("chart.html|375x700", "375x700"));
    const figure = root.querySelector("figure");
    expect(figure?.getAttribute("data-width")).toBe("375");
    expect(figure?.getAttribute("data-height")).toBe("700");
  });

  it("reads the size Obsidian moved into attributes", () => {
    // What Obsidian actually draws for `![[chart.html|375x640]]`.
    const root = render(
      `<p><span class="internal-embed" src="chart.html" width="375" height="640"></span></p>`,
    );
    const figure = root.querySelector("figure");
    expect(figure?.getAttribute("data-width")).toBe("375");
    expect(figure?.getAttribute("data-height")).toBe("640");
  });

  it("reads a lone width attribute as a height, as written", () => {
    // `![[chart.html|420]]` arrives as width="420".
    const root = render(`<p><span class="internal-embed" src="chart.html" width="420"></span></p>`);
    const figure = root.querySelector("figure");
    expect(figure?.hasAttribute("data-width")).toBe(false);
    expect(figure?.getAttribute("data-height")).toBe("420");
  });

  it("uses the default height when nothing is said", () => {
    const root = render(placeholder("chart.html"));
    expect(root.querySelector("figure")?.getAttribute("data-height")).toBe(
      String(DEFAULT_EMBED_HEIGHT),
    );
  });

  it("leaves an embed of a page that is not published alone", () => {
    const root = render(placeholder("private/secret.html"));
    expect(root.querySelector("figure")).toBeNull();
    expect(root.querySelector(".internal-embed")).not.toBeNull();
  });

  it("leaves a note embedded in a note to Obsidian", () => {
    const root = render(
      `<div class="internal-embed markdown-embed" src="Spec"><p>Transcluded.</p></div>`,
    );
    expect(root.querySelector("figure")).toBeNull();
    expect(root.textContent).toContain("Transcluded.");
  });

  it("keeps the paragraph when the embed shares it with text", () => {
    const root = render(
      `<p>See <span class="internal-embed" src="chart.html" alt="chart.html"></span> here.</p>`,
    );
    expect(root.querySelector("p")?.textContent).toContain("See");
    expect(root.querySelector("figure")).not.toBeNull();
  });
});

describe("parseEmbedSize", () => {
  it.each([
    ["600", { width: null, height: 600 }],
    ["375x700", { width: 375, height: 700 }],
    ["x400", { width: null, height: 400 }],
    ["chart.html", { width: null, height: null }],
    ["", { width: null, height: null }],
    [null, { width: null, height: null }],
  ])("reads %j", (alt, expected) => {
    expect(parseEmbedSize(alt)).toEqual(expected);
  });
});

describe("frames side by side", () => {
  it("compares two prototypes embedded on one line", () => {
    const root = render(
      `<p><span class="internal-embed" src="proto/index.html" alt="proto/index.html"></span> ` +
        `<span class="internal-embed" src="chart.html" alt="chart.html"></span></p>`,
    );
    const group = root.querySelector(".osp-html-compare");
    expect(group?.getAttribute("data-count")).toBe("2");
    expect(group?.querySelectorAll("figure.osp-html-embed")).toHaveLength(2);
    expect(root.querySelector("p")).toBeNull();
  });

  it("compares frames in a paragraph the build already rewrote as a div", () => {
    const root = render(
      `<div class="osp-block-paragraph"><span class="internal-embed" src="proto/index.html"></span> ` +
        `<span class="internal-embed" src="chart.html"></span></div>`,
    );
    expect(root.querySelector(".osp-html-compare")?.getAttribute("data-count")).toBe("2");
    expect(root.querySelector(".osp-block-paragraph")).toBeNull();
  });

  it("does not group frames that share a line with prose", () => {
    const root = render(
      `<p>Before <span class="internal-embed" src="proto/index.html"></span> and ` +
        `<span class="internal-embed" src="chart.html"></span></p>`,
    );
    expect(root.querySelector(".osp-html-compare")).toBeNull();
    expect(root.querySelectorAll("figure.osp-html-embed")).toHaveLength(2);
  });
});
