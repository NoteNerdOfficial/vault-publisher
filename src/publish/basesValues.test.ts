// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  cardOptions,
  coverSource,
  hasWikilink,
  listOptions,
  summaryPropertyId,
  writeLinkedText,
} from "./basesValues";

const files: Record<string, { path: string; title: string; extension: string }> = {
  "shelf/first": { path: "shelf/first.md", title: "first", extension: "md" },
  "img/cover.png": { path: "img/cover.png", title: "cover.png", extension: "png" },
};
const resolveLink = (linkpath: string) => files[linkpath] ?? null;
const resolveFile = (linkpath: string) =>
  files[linkpath] ? { extension: files[linkpath].extension, url: `app://local/${files[linkpath].path}` } : null;

function written(text: string): HTMLElement {
  const cell = document.createElement("td");
  writeLinkedText(cell, text, resolveLink);
  return cell;
}

describe("writeLinkedText", () => {
  it("writes a link as the span the link rewriter resolves", () => {
    const cell = written("[[shelf/first]]");

    const link = cell.querySelector(".internal-link");
    expect(link?.getAttribute("data-href")).toBe("shelf/first.md");
    expect(link?.textContent).toBe("first");
  });

  it("keeps an alias as the text and a heading as part of the target", () => {
    const cell = written("[[shelf/first#Notes|the first one]]");

    const link = cell.querySelector(".internal-link");
    expect(link?.getAttribute("data-href")).toBe("shelf/first.md#Notes");
    expect(link?.textContent).toBe("the first one");
  });

  // So the rewriter can report it, rather than the link quietly vanishing.
  it("keeps the target of a link that does not resolve", () => {
    const cell = written("[[gone/missing]]");

    expect(cell.querySelector(".internal-link")?.getAttribute("data-href")).toBe("gone/missing");
    expect(cell.textContent).toBe("missing");
  });

  it("keeps the text around and between links, as a list of them reads", () => {
    const cell = written("[[shelf/first]], [[gone/missing]] and more");

    expect(cell.textContent).toBe("first, missing and more");
    expect(cell.querySelectorAll(".internal-link")).toHaveLength(2);
  });

  it("tells a value with a link from one without", () => {
    expect(hasWikilink("see [[shelf/first]]")).toBe(true);
    expect(hasWikilink("plain [brackets]")).toBe(false);
  });
});

describe("coverSource", () => {
  it.each([
    ["a link to an image", "[[img/cover.png]]"],
    ["an embed of one", "![[img/cover.png]]"],
    ["a plain vault path", "img/cover.png"],
  ])("resolves %s to the address it loads from", (_, text) => {
    expect(coverSource(text, resolveFile)).toBe("app://local/img/cover.png");
  });

  it("passes a web address through", () => {
    expect(coverSource("https://example.com/a.jpg", resolveFile)).toBe("https://example.com/a.jpg");
  });

  // No cover, rather than a broken image.
  it.each([
    ["a link to a note", "[[shelf/first]]"],
    ["a link that does not resolve", "[[nowhere.png]]"],
    ["an empty value", "  "],
  ])("gives nothing for %s", (_, text) => {
    expect(coverSource(text, resolveFile)).toBeNull();
  });
});

describe("summaryPropertyId", () => {
  it("reads a bare name as a note property and leaves ids alone", () => {
    expect(summaryPropertyId("pages")).toBe("note.pages");
    expect(summaryPropertyId("formula.weight")).toBe("formula.weight");
    expect(summaryPropertyId("file.size")).toBe("file.size");
    expect(summaryPropertyId("note.pages")).toBe("note.pages");
  });
});

describe("view options", () => {
  const from = (values: Record<string, unknown>) => (key: string) => values[key];

  it("gives cards Bases' own defaults", () => {
    expect(cardOptions(from({}))).toEqual({ size: 200, aspect: 1, fit: "cover" });
  });

  it("reads a cards view's options, inside Bases' limits", () => {
    expect(cardOptions(from({ cardSize: 240, imageAspectRatio: 0.75, imageFit: "contain" }))).toEqual({
      size: 240,
      aspect: 0.75,
      fit: "contain",
    });
    expect(cardOptions(from({ cardSize: 5000, imageAspectRatio: 9 })).size).toBe(800);
    expect(cardOptions(from({ cardSize: 5000, imageAspectRatio: 9 })).aspect).toBe(2.5);
  });

  it("gives lists Bases' own defaults, and reads their options", () => {
    expect(listOptions(from({}))).toEqual({ markers: "bullet", separator: ", ", indent: false });
    expect(listOptions(from({ markers: "number", separator: " | ", indentProperties: true }))).toEqual({
      markers: "number",
      separator: " | ",
      indent: true,
    });
    expect(listOptions(from({ markers: "stars" })).markers).toBe("bullet");
  });
});
