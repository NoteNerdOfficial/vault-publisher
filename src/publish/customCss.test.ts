import { describe, expect, it } from "vitest";
import {
  CUSTOM_CSS_BANNER,
  normalizeCustomCssPath,
  readCustomCss,
  withCustomCss,
} from "./customCss";

describe("normalizeCustomCssPath", () => {
  it("is null for every way of saying nothing", () => {
    expect(normalizeCustomCssPath(undefined)).toBeNull();
    expect(normalizeCustomCssPath(null)).toBeNull();
    expect(normalizeCustomCssPath("")).toBeNull();
    expect(normalizeCustomCssPath("   ")).toBeNull();
  });

  // A vault path has no leading slash, and typing one is the obvious
  // mistake: the alternative is a stylesheet that silently never loads.
  it("takes a leading slash or dot-slash off a path somebody typed", () => {
    expect(normalizeCustomCssPath("/assets/site.css")).toBe("assets/site.css");
    expect(normalizeCustomCssPath("./assets/site.css")).toBe("assets/site.css");
    expect(normalizeCustomCssPath("  design/brand.css  ")).toBe("design/brand.css");
  });

  it("reads a Windows path as the vault path it means", () => {
    expect(normalizeCustomCssPath("design\\brand.css")).toBe("design/brand.css");
  });

  it("collapses a doubled separator rather than passing it on", () => {
    expect(normalizeCustomCssPath("design//brand.css")).toBe("design/brand.css");
  });
});

describe("withCustomCss", () => {
  const generated = ":root { --osp-link: #4945ff; }\n";

  it("appends the author's rules after the generated ones", () => {
    const out = withCustomCss(generated, ":root { --osp-link: #c0392b; }");

    // Last wins in CSS, so the position is the whole mechanism.
    expect(out.indexOf("#4945ff")).toBeLessThan(out.indexOf("#c0392b"));
    expect(out).toContain(CUSTOM_CSS_BANNER);
  });

  // A file created and not yet written is the normal state for the minute
  // between adding the setting and typing into it.
  it("changes nothing for a file that is empty", () => {
    expect(withCustomCss(generated, "")).toBe(generated);
    expect(withCustomCss(generated, "\n  \n")).toBe(generated);
  });

  /*
   * `assets/site.css` is published, so anything written into it is public.
   * The vault path of the source file is the author's folder structure and
   * has no business being there -- the same leak the overlay's `published`
   * flag exists to prevent, one file along.
   */
  it("says nothing about where in the vault the block came from", () => {
    const out = withCustomCss(generated, ":root { --osp-bg: #fff; }");

    // Not a filename anywhere in it, which is guaranteed by the signature:
    // the function is never told the path, so it cannot publish one.
    expect(out).not.toContain(".css");
    expect(withCustomCss).toHaveLength(2);
  });
});

describe("readCustomCss", () => {
  const outputs = ["_vault-publisher", "_site-preview"];
  const isOutput = (path: string, folders: readonly string[]) =>
    folders.some((folder) => path === folder || path.startsWith(`${folder}/`));

  const reader = (files: Record<string, string>) => ({
    read: async (path: string) => {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`);
      return files[path];
    },
  });

  it("reads the file at the configured path", async () => {
    const found = await readCustomCss(
      reader({ "design/site.css": ":root { --osp-link: red; }" }),
      "design/site.css",
      outputs,
      isOutput,
    );

    expect(found).toEqual({
      path: "design/site.css",
      css: ":root { --osp-link: red; }",
      problem: null,
    });
  });

  it("reads nothing, and complains about nothing, when none is configured", async () => {
    const none = await readCustomCss(reader({}), "", outputs, isOutput);
    expect(none).toEqual({ path: null, css: null, problem: null });
  });

  // The whole reason this is a function and not four lines inline: every
  // failure below produces a site that looks exactly like the one before it.
  it("names the path and the reason when the file is not there", async () => {
    const missing = await readCustomCss(reader({}), "design/typo.css", outputs, isOutput);

    expect(missing.css).toBeNull();
    expect(missing.path).toBe("design/typo.css");
    expect(missing.problem).toContain("could not be read");
    expect(missing.problem).toContain("ENOENT");
  });

  /*
   * Pointing at the preview's own stylesheet is the obvious mistake after
   * opening one to find the token names. Read, it would be appended to
   * itself: 100 KB on the first build, 200 on the second.
   */
  it("refuses a path inside the build's own output, before reading it", async () => {
    let touched = false;
    const spy = {
      read: async () => {
        touched = true;
        return "";
      },
    };

    const refused = await readCustomCss(
      spy,
      "_site-preview/assets/site.css",
      outputs,
      isOutput,
    );

    expect(touched).toBe(false);
    expect(refused.css).toBeNull();
    expect(refused.problem).toContain("writes rather than reads");
  });

  it("normalizes the path before it reads or refuses", async () => {
    const found = await readCustomCss(
      reader({ "design/site.css": "/* mine */" }),
      "  /design/site.css  ",
      outputs,
      isOutput,
    );
    expect(found.css).toBe("/* mine */");

    const refused = await readCustomCss(
      reader({}),
      "/_site-preview/assets/site.css",
      outputs,
      isOutput,
    );
    expect(refused.problem).toContain("writes rather than reads");
  });
});
