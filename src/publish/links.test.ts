import { describe, expect, it } from "vitest";
import {
  LinkResolver,
  LinkTarget,
  relativeUrl,
  rewriteLinks,
  slugifyFragment,
} from "./links";

function target(sourcePath: string, url: string): LinkTarget {
  return { sourcePath, url };
}

function render(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("LinkResolver", () => {
  const resolver = new LinkResolver([
    target("notes/basics.md", "basics.html"),
    target("notes/deep/basics.md", "deep/basics.html"),
    target("notes/Pattern Language.md", "Pattern Language.html"),
    target("notes/50% done.md", "50% done.html"),
  ]);

  it("resolves a full path", () => {
    expect(resolver.resolve("notes/deep/basics")?.url).toBe("deep/basics.html");
  });

  it("prefers the shortest path for an ambiguous basename", () => {
    // Obsidian's own rule: the shallower note wins a bare name.
    expect(resolver.resolve("basics")?.url).toBe("basics.html");
  });

  it("ignores case and the .md extension", () => {
    expect(resolver.resolve("NOTES/BASICS.md")?.url).toBe("basics.html");
  });

  it("resolves the note and leaves the fragment to the caller", () => {
    expect(resolver.resolve("basics#Some Heading")?.url).toBe("basics.html");
  });

  it("returns null for an unknown target", () => {
    expect(resolver.resolve("nowhere")).toBeNull();
  });

  // A "%" that does not begin a valid escape used to throw URIError out of
  // normalizeKey, which failed the entire publish.
  it("handles a name containing a bare percent sign", () => {
    expect(resolver.resolve("50% done")?.url).toBe("50% done.html");
  });

  it("decodes an encoded href back to the note's name", () => {
    expect(resolver.resolve("Pattern%20Language")?.url).toBe(
      "Pattern Language.html",
    );
  });
});

describe("rewriteLinks", () => {
  const resolver = new LinkResolver([
    target("notes/basics.md", "basics.html"),
    target("notes/Q&A 50% done.md", "Q&A 50% done.html"),
  ]);

  it("rewrites a resolved link relative to the page", () => {
    const root = render(`<a href="basics">Basics</a>`);
    const stats = rewriteLinks(root, resolver, "deep/page.html");

    expect(stats.resolved).toBe(1);
    expect(root.querySelector("a")?.getAttribute("href")).toBe(
      "../basics.html",
    );
  });

  it("rewrites Bases data-href spans into ordinary links", () => {
    const root = render(
      `<span class="internal-link" data-href="notes/basics.md">Basics</span>`,
    );
    const stats = rewriteLinks(root, resolver, "deep/page.html");

    expect(stats.resolved).toBe(1);
    expect(root.querySelector("a")?.getAttribute("href")).toBe("../basics.html");
    expect(root.querySelector("a")?.textContent).toBe("Basics");
  });

  it("percent-encodes an awkward target", () => {
    const root = render(`<a href="Q&amp;A 50% done">that one</a>`);
    const stats = rewriteLinks(root, resolver, "page.html");

    expect(stats.resolved).toBe(1);
    expect(root.querySelector("a")?.getAttribute("href")).toBe(
      "./Q%26A%2050%25%20done.html",
    );
  });

  it("carries a heading fragment through, slugified", () => {
    const root = render(`<a href="basics#Some Heading!">x</a>`);
    rewriteLinks(root, resolver, "page.html");

    expect(root.querySelector("a")?.getAttribute("href")).toBe(
      "./basics.html#some-heading",
    );
  });

  it("downgrades an unresolved link to a span, keeping the text", () => {
    const root = render(`<a href="private/secret">the arrangement</a>`);
    const stats = rewriteLinks(root, resolver, "page.html");

    expect(stats.unresolved).toBe(1);
    expect(stats.unresolvedTargets).toEqual(["private/secret"]);
    expect(root.querySelector("a")).toBeNull();

    const span = root.querySelector("span.osp-unresolved-link");
    expect(span?.textContent).toBe("the arrangement");
    // Left for scanForLeaks; stripDebugAttributes removes it afterwards.
    expect(span?.getAttribute("data-osp-unresolved")).toBe("private/secret");
  });

  it("marks an external link and leaves its href alone", () => {
    const root = render(`<a href="https://example.com/x">out</a>`);
    const stats = rewriteLinks(root, resolver, "page.html");

    expect(stats.external).toBe(1);
    expect(root.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com/x",
    );
    expect(root.querySelector("a")?.getAttribute("rel")).toBe("noopener");
  });

  it("leaves a same-page anchor alone", () => {
    const root = render(`<a href="#heading">jump</a>`);
    const stats = rewriteLinks(root, resolver, "page.html");

    expect(stats.external).toBe(0);
    expect(stats.resolved).toBe(0);
    expect(root.querySelector("a")?.getAttribute("href")).toBe("#heading");
  });

  it("reports each unresolved target once", () => {
    const root = render(
      `<a href="gone">a</a><a href="gone">b</a><a href="gone#x">c</a>`,
    );
    const stats = rewriteLinks(root, resolver, "page.html");

    expect(stats.unresolved).toBe(3);
    expect(stats.unresolvedTargets).toEqual(["gone"]);
  });
});

describe("relativeUrl", () => {
  it("stays in the same directory", () => {
    expect(relativeUrl("a/page.html", "a/other.html")).toBe("./other.html");
  });

  it("climbs out of a directory", () => {
    expect(relativeUrl("a/b/page.html", "other.html")).toBe("../../other.html");
  });

  it("descends into one", () => {
    expect(relativeUrl("page.html", "a/b/other.html")).toBe("./a/b/other.html");
  });

  it("prefixes ./ so a colon in a name is not read as a scheme", () => {
    expect(relativeUrl("page.html", "note: a thought.html")).toBe(
      "./note%3A%20a%20thought.html",
    );
  });
});

describe("slugifyFragment", () => {
  it("lower-cases and hyphenates", () => {
    expect(slugifyFragment("Some Heading")).toBe("some-heading");
  });

  it("drops punctuation", () => {
    expect(slugifyFragment("What's new?")).toBe("whats-new");
  });
});
