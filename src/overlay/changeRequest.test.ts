import { describe, expect, it } from "vitest";
import { noteName, noteText } from "./changeRequest";

const NOW = new Date(2026, 10, 24, 9, 5);

describe("change request notes", () => {
  it("are named for the page and the day, and numbered when the name is taken", () => {
    expect(noteName("Protos/pricing.html", NOW, () => false)).toBe("pricing 2026-11-24.md");
    const taken = new Set(["pricing 2026-11-24.md", "pricing 2026-11-24 2.md"]);
    expect(noteName("Protos/pricing.html", NOW, (n) => taken.has(n))).toBe("pricing 2026-11-24 3.md");
    expect(noteName("a/what: #1?.html", NOW, () => false)).toBe("what 1 2026-11-24.md");
  });

  it("hold the request under frontmatter that names the page", () => {
    const text = noteText('Protos/"odd" page.html', "Change this prototype.\n\n1. In [1] h1: shorter\n", NOW);
    expect(text).toContain('page: "Protos/\\"odd\\" page.html"');
    expect(text).toContain("created: 2026-11-24T09:05");
    expect(text).toContain("status: open");
    expect(text.endsWith("1. In [1] h1: shorter\n")).toBe(true);
  });
});
