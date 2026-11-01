import { describe, expect, it } from "vitest";
import { DEFAULT_OUTPUT_FOLDERS, isBuildOutput } from "./outputFolders";

describe("isBuildOutput", () => {
  it("claims the folders the build writes into the vault", () => {
    expect(isBuildOutput("_vault-publisher/build-report.md")).toBe(true);
    expect(isBuildOutput("_site-preview/index.html")).toBe(true);
    expect(isBuildOutput("_vault-publisher/review/comments.json")).toBe(true);
    // The folder itself, not only what is under it.
    expect(isBuildOutput("_site-preview")).toBe(true);
  });

  it("leaves the vault's own content alone", () => {
    expect(isBuildOutput("notes/plan.md")).toBe(false);
    expect(isBuildOutput("README.md")).toBe(false);
  });

  // The hazard of matching on a prefix rather than on a path segment: a
  // folder whose name merely begins with an excluded one is not it.
  it("does not match a folder whose name starts the same way", () => {
    expect(isBuildOutput("_site-preview-archive/a.md")).toBe(false);
    expect(isBuildOutput("_vault-publisher-old/a.md")).toBe(false);
  });

  /**
   * The exception. Pointing the scope into one of these folders is somebody
   * typing that path, and the alternative is a build that matches nothing
   * and cannot say why.
   */
  it("yields to a scope aimed inside one of them", () => {
    const folders = DEFAULT_OUTPUT_FOLDERS;
    expect(isBuildOutput("_site-preview/a.html", folders, "_site-preview")).toBe(false);
    expect(isBuildOutput("_site-preview/deep/a.html", folders, "_site-preview/deep")).toBe(
      false,
    );
    // A scope elsewhere does not exempt anything.
    expect(isBuildOutput("_site-preview/a.html", folders, "notes")).toBe(true);
    // Nor does the whole vault, which is the case this rule exists for.
    expect(isBuildOutput("_site-preview/a.html", folders, "")).toBe(true);
  });

  it("takes the caller's list over the default", () => {
    expect(isBuildOutput("out/a.md", ["out"])).toBe(true);
    expect(isBuildOutput("_site-preview/a.md", ["out"])).toBe(false);
    // An empty entry must not match everything.
    expect(isBuildOutput("notes/a.md", ["", "out"])).toBe(false);
  });
});
