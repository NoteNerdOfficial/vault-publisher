import { describe, expect, it } from "vitest";
import {
  angularBuildOptions,
  objectEnd,
  patchAngularConfig,
  patchBuiltPage,
  patchPackageHomepage,
} from "./baseHrefFix";
import { baseHref, baseHrefHazard } from "./htmlFiles";

describe("patchBuiltPage", () => {
  const BUILT =
    `<!doctype html><html><head><title>App</title><base href="/">` +
    `</head><body><app-root></app-root></body></html>`;

  it("makes a root-absolute base relative", () => {
    const patch = patchBuiltPage(BUILT);
    expect(patch?.text).toContain(`<base href="./">`);
    expect(patch?.summary).toContain(`"/"`);
  });

  /*
   * The repair has to satisfy the check that found the fault, or the two
   * disagree and the panel reports a problem it has just fixed.
   */
  it("produces a page the hazard check is happy with", () => {
    const patched = patchBuiltPage(BUILT)!.text;
    expect(baseHref(patched)).toBe("./");
    expect(baseHrefHazard(baseHref(patched))).toBeNull();
  });

  it("keeps single quotes where the file used them", () => {
    const patch = patchBuiltPage(`<head><base href='/'></head>`);
    expect(patch?.text).toContain(`<base href='./'>`);
  });

  it("does nothing to a page that is already relative", () => {
    expect(patchBuiltPage(`<head><base href="./"></head>`)).toBeNull();
  });

  /*
   * A page with no base tag resolves everything against itself already.
   * Adding one would be a change with no effect and a diff to explain.
   */
  it("leaves a page with no base tag alone", () => {
    expect(patchBuiltPage(`<head><title>App</title></head>`)).toBeNull();
  });

  it("gives an href to a base tag that has none", () => {
    const patch = patchBuiltPage(`<head><base></head>`);
    expect(patch?.text).toContain(`<base href="./">`);
  });

  // Only the first base tag counts to a browser, so only it is touched.
  it("touches the first base tag only", () => {
    const patch = patchBuiltPage(`<head><base href="/"><base href="/other"></head>`);
    expect(patch?.text).toContain(`<base href="./"><base href="/other">`);
  });
});

describe("objectEnd", () => {
  it("finds the matching brace", () => {
    const text = `{"a":{"b":1},"c":2}`;
    expect(objectEnd(text, 0)).toBe(text.length);
    expect(objectEnd(text, 5)).toBe(12);
  });

  /*
   * A brace inside a string is not a brace. Output paths and globs hold
   * them, and counting one would close the object early and corrupt the
   * file on write.
   */
  it("ignores braces inside strings and their escapes", () => {
    expect(objectEnd(`{"glob":"src/**/{a,b}.ts"}`, 0)).toBe(26);
    expect(objectEnd(`{"q":"a\\"}\\"b"}`, 0)).toBe(15);
  });

  it("refuses an unbalanced document", () => {
    expect(objectEnd(`{"a":{`, 0)).toBe(-1);
  });
});

/* --- angular.json ---------------------------------------------------- */

const WORKSPACE = `{
  "version": 1,
  "projects": {
    "web": {
      "projectType": "application",
      "architect": {
        "test": {
          "options": {
            "polyfills": ["zone.js"]
          }
        },
        "build": {
          "builder": "@angular/build:application",
          "options": {
            "outputPath": "dist/web",
            "index": "src/index.html"
          }
        }
      }
    },
    "admin": {
      "architect": {
        "build": {
          "options": {
            "outputPath": "dist/admin"
          }
        }
      }
    }
  }
}
`;

describe("angularBuildOptions", () => {
  /*
   * The reason this walks key by key instead of matching one regex: every
   * name involved occurs more than once. `"options"` appears under `test`
   * before it appears under `build`, and a scan for the first one would
   * write the base href into the test target.
   */
  it("finds the build target's options, not the test target's", () => {
    const span = angularBuildOptions(WORKSPACE, "web")!;
    const body = WORKSPACE.slice(span.open, span.end);
    expect(body).toContain(`"outputPath": "dist/web"`);
    expect(body).not.toContain("polyfills");
  });

  // And the right project's, in a workspace holding several.
  it("finds the named project and not its sibling", () => {
    const span = angularBuildOptions(WORKSPACE, "admin")!;
    expect(WORKSPACE.slice(span.open, span.end)).toContain(`"dist/admin"`);
  });

  it("gives up on a project it cannot find", () => {
    expect(angularBuildOptions(WORKSPACE, "nope")).toBeNull();
  });
});

describe("patchAngularConfig", () => {
  /*
   * The whole reason this is a text edit: the file is the user's, usually
   * in version control, and a parse-and-restringify would hand them a diff
   * touching every line. Everything but the inserted line must survive
   * byte for byte.
   */
  it("inserts one line and changes nothing else", () => {
    const patch = patchAngularConfig(WORKSPACE, "web")!;
    const before = WORKSPACE.split("\n");
    const after = patch.text.split("\n");
    expect(after.length).toBe(before.length + 1);

    const added = after.filter((line) => !before.includes(line));
    expect(added).toEqual([`            "baseHref": "./",`]);
    // Still valid JSON, and the value landed where it was meant to.
    const parsed = JSON.parse(patch.text);
    expect(parsed.projects.web.architect.build.options.baseHref).toBe("./");
    expect(parsed.projects.admin.architect.build.options.baseHref).toBeUndefined();
  });

  it("matches the indentation of its neighbours", () => {
    const patch = patchAngularConfig(WORKSPACE, "web")!;
    expect(patch.text).toContain(`\n            "baseHref": "./",\n            "outputPath"`);
  });

  it("replaces a baseHref that is already there", () => {
    const withBase = WORKSPACE.replace(
      `"outputPath": "dist/web"`,
      `"baseHref": "/",\n            "outputPath": "dist/web"`,
    );
    const patch = patchAngularConfig(withBase, "web")!;
    expect(JSON.parse(patch.text).projects.web.architect.build.options.baseHref).toBe("./");
    expect(patch.summary).toContain(`"/"`);
    // The other project is untouched by a replace, as by an insert.
    expect(patch.text).toContain(`"dist/admin"`);
  });

  it("does nothing when it is already right", () => {
    const already = WORKSPACE.replace(
      `"outputPath": "dist/web"`,
      `"baseHref": "./",\n            "outputPath": "dist/web"`,
    );
    expect(patchAngularConfig(already, "web")).toBeNull();
  });

  it("handles a config written on one line", () => {
    const flat = `{"projects":{"web":{"architect":{"build":{"options":{"outputPath":"dist/web"}}}}}}`;
    const patch = patchAngularConfig(flat, "web")!;
    expect(JSON.parse(patch.text).projects.web.architect.build.options.baseHref).toBe("./");
  });

  // Nx spells the same block `targets`.
  it("reads an Nx targets block", () => {
    const nx = `{"projects":{"web":{"targets":{"build":{"options":{"outputPath":"dist/web"}}}}}}`;
    const patch = patchAngularConfig(nx, "web")!;
    expect(JSON.parse(patch.text).projects.web.targets.build.options.baseHref).toBe("./");
  });

  it("declines a config it cannot walk", () => {
    expect(patchAngularConfig(`{"projects":{"web":{}}}`, "web")).toBeNull();
  });
});

describe("patchPackageHomepage", () => {
  it("adds the key create-react-app reads", () => {
    const pkg = `{\n  "name": "crm",\n  "version": "1.0.0"\n}\n`;
    const patch = patchPackageHomepage(pkg)!;
    expect(JSON.parse(patch.text).homepage).toBe(".");
    expect(patch.text).toContain(`\n  "homepage": ".",\n  "name"`);
  });

  it("replaces one that is already set", () => {
    const patch = patchPackageHomepage(`{"homepage":"https://example.com/","name":"crm"}`)!;
    expect(JSON.parse(patch.text).homepage).toBe(".");
    expect(JSON.parse(patch.text).name).toBe("crm");
  });

  it("does nothing when it is already right", () => {
    expect(patchPackageHomepage(`{"homepage":"."}`)).toBeNull();
  });
});
