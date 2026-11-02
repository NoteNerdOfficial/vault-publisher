import { describe, expect, it } from "vitest";
import {
  excludeTallies,
  isExcluded,
  parseExcludeFolders,
  swallowsScope,
} from "./excludeFolders";

describe("reading the list somebody typed", () => {
  it("takes one path per line", () => {
    expect(parseExcludeFolders("Journal\nPeople\nwork/clients")).toEqual([
      "Journal",
      "People",
      "work/clients",
    ]);
  });

  // Blank lines are how a list is spaced out while it is being edited, and
  // a trailing slash is how half the world writes a folder.
  it("forgives the ways a path gets typed", () => {
    expect(parseExcludeFolders("  Journal/ \n\n /People\nwork\\clients\n")).toEqual([
      "Journal",
      "People",
      "work/clients",
    ]);
  });

  it("keeps one of each, in the order written", () => {
    expect(parseExcludeFolders("Journal\njournal/\nPeople")).toEqual([
      "Journal",
      "People",
    ]);
  });

  it("reads the stored list as well as the raw field", () => {
    expect(parseExcludeFolders(["Journal", "", "People"])).toEqual([
      "Journal",
      "People",
    ]);
    expect(parseExcludeFolders(undefined)).toEqual([]);
  });
});

describe("what an entry covers", () => {
  const entries = ["Journal", "work/clients"];

  it("covers the folder and everything under it", () => {
    expect(isExcluded("Journal/2026-10-28.md", entries)).toBe(true);
    expect(isExcluded("work/clients/acme/brief.md", entries)).toBe(true);
  });

  it("does not cover a folder that merely starts the same way", () => {
    expect(isExcluded("Journalism/why.md", entries)).toBe(false);
    expect(isExcluded("work/clientside.md", entries)).toBe(false);
  });

  it("leaves everything else alone", () => {
    expect(isExcluded("notes/public.md", entries)).toBe(false);
    expect(isExcluded("", entries)).toBe(false);
  });

  /*
   * macOS and Windows both treat `journal` and `Journal` as one folder, so a
   * list that excluded one but not the other would be a privacy setting that
   * worked or did not depending on which key the author pressed.
   */
  it("ignores case, because the filesystem under it usually does", () => {
    expect(isExcluded("journal/today.md", ["Journal"])).toBe(true);
    expect(isExcluded("Journal/today.md", ["journal"])).toBe(true);
  });

  // The field is named for folders because that is what it is for, but the
  // rule that excludes a folder is the rule that excludes one note.
  it("takes an exact file path too", () => {
    expect(isExcluded("notes/salary.md", ["notes/salary.md"])).toBe(true);
    expect(isExcluded("notes/salaries.md", ["notes/salary.md"])).toBe(false);
  });
});

describe("what each entry kept out", () => {
  const paths = [
    "Journal/a.md",
    "Journal/b.md",
    "Journal/deep/c.md",
    "notes/public.md",
    "People/someone.md",
  ];

  it("counts each entry against what the build would have taken", () => {
    expect(excludeTallies(paths, ["Journal", "People"])).toEqual([
      { entry: "Journal", count: 3 },
      { entry: "People", count: 1 },
    ]);
  });

  // The reason a count exists at all: a path that is not in the vault looks
  // exactly like a path that is, until something counts it.
  it("reports an entry that matched nothing", () => {
    expect(excludeTallies(paths, ["Jornal"])).toEqual([{ entry: "Jornal", count: 0 }]);
  });

  /*
   * Independently, so an entry nested inside another reports what it covers
   * rather than zero -- which would read as a typo when it is a duplicate.
   * The sum can exceed the number of files excluded, which is why the report
   * says what each entry matched instead of adding them up.
   */
  it("counts a nested entry for itself rather than for what is left", () => {
    expect(excludeTallies(paths, ["Journal", "Journal/deep"])).toEqual([
      { entry: "Journal", count: 3 },
      { entry: "Journal/deep", count: 1 },
    ]);
  });
});

describe("an entry that takes out the whole scope", () => {
  it("is the contradiction worth warning about", () => {
    expect(swallowsScope("notes", "notes")).toBe(true);
    expect(swallowsScope("notes", "notes/public")).toBe(true);
  });

  it("is not a subtraction inside the scope", () => {
    expect(swallowsScope("notes/private", "notes")).toBe(false);
  });

  // The whole vault cannot be named, so no entry can swallow it, and an
  // unchosen scope has nothing to swallow yet.
  it("cannot happen to a vault published whole or to an unchosen scope", () => {
    expect(swallowsScope("notes", "")).toBe(false);
    expect(swallowsScope("notes", null)).toBe(false);
  });
});
