import { describe, expect, it } from "vitest";
import { diffText, lineDiff } from "./lineDiff";

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`);

describe("lineDiff", () => {
  it("has nothing to say about two equal files", () => {
    expect(lineDiff("a\nb\n", "a\nb\n")).toEqual([]);
  });

  it("shows a changed line with three lines either side, counted from 1", () => {
    const before = lines(10).join("\n");
    const after = lines(10).map((l, i) => (i === 4 ? "changed" : l)).join("\n");
    const [hunk, ...rest] = lineDiff(before, after);
    expect(rest).toEqual([]);
    expect(hunk.header).toBe("@@ -2,7 +2,7 @@");
    expect(hunk.lines.map((l) => l.kind + l.text)).toEqual([
      " line 2", " line 3", " line 4", "-line 5", "+changed", " line 6", " line 7", " line 8",
    ]);
  });

  it("keeps changes far apart in separate hunks, and joins close ones", () => {
    const base = lines(40);
    const far = base.map((l, i) => (i === 2 || i === 30 ? l + "!" : l)).join("\n");
    expect(lineDiff(base.join("\n"), far)).toHaveLength(2);
    const near = base.map((l, i) => (i === 2 || i === 6 ? l + "!" : l)).join("\n");
    expect(lineDiff(base.join("\n"), near)).toHaveLength(1);
  });

  it("shows lines put in and taken out", () => {
    const hunks = lineDiff("a\nb\nc\n", "a\nnew\nb\n");
    expect(hunks[0].lines.map((l) => l.kind + l.text)).toEqual([" a", "+new", " b", "-c"]);
    expect(diffText("P/x.html", hunks)).toBe("--- a/P/x.html\n+++ b/P/x.html\n@@ -1,3 +1,3 @@\n a\n+new\n b\n-c\n");
  });
});
