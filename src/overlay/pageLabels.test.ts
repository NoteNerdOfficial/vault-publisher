import { describe, expect, it } from "vitest";
import { labelPaths } from "./pageLabels";

/** The labels for a set, as a plain object, which is easier to read back. */
function labels(paths: string[]): Record<string, string> {
  return Object.fromEntries(labelPaths(paths));
}

describe("naming the pages in a review", () => {
  // A filename that decides on its own is left alone, or every list would be
  // a column of folders nobody needed.
  it("uses the filename where the filename decides", () => {
    expect(labels(["library/Atomic notes.md", "spike-notes/Scope.md"])).toEqual({
      "library/Atomic notes.md": "Atomic notes",
      "spike-notes/Scope.md": "Scope",
    });
  });

  // The case this exists for: four stock builds, four files called index.
  it("qualifies two pages that share a filename", () => {
    expect(
      labels(["react-default/index.html", "angular-default/index.html"]),
    ).toEqual({
      "react-default/index.html": "react-default/index",
      "angular-default/index.html": "angular-default/index",
    });
  });

  it("takes a second folder only where the first does not separate them", () => {
    expect(
      labels(["apps/react/dist/index.html", "apps/angular/dist/index.html"]),
    ).toEqual({
      "apps/react/dist/index.html": "react/dist/index",
      "apps/angular/dist/index.html": "angular/dist/index",
    });
  });

  // One "index" in a list is no clearer than four: it still does not say
  // what it is the index of.
  it("qualifies a name that says nothing, even when it is the only one", () => {
    expect(labels(["react-relative/index.html"])).toEqual({
      "react-relative/index.html": "react-relative/index",
    });
  });

  it("has nothing to qualify a vague name with at the root", () => {
    expect(labels(["index.html"])).toEqual({ "index.html": "index" });
  });

  // Two notes of the same name in the same folder cannot happen, but a
  // review file written by hand can say anything.
  it("gives a path with nothing in it a name of its own", () => {
    expect(labels([""])).toEqual({ "": "Untitled" });
  });

  it("is not confused by a shorter path sharing a tail", () => {
    expect(labels(["index.html", "docs/index.html"])).toEqual({
      "index.html": "index",
      "docs/index.html": "docs/index",
    });
  });

  it("drops the extension of a note and of a page published as it was found", () => {
    expect(labels(["a/Scope.md", "b/trend.html", "c/old.htm"])).toEqual({
      "a/Scope.md": "Scope",
      "b/trend.html": "trend",
      "c/old.htm": "old",
    });
  });
});
