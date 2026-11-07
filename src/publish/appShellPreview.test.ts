import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appShellNotice, appShellWithoutCode } from "./htmlFiles";

/**
 * The structural half of "previews only".
 *
 * `appShellNotice` is content added to a file that as-is publishing
 * otherwise copies byte for byte, so the promise rests entirely on one flag
 * being set by one caller. That is the same guarantee `reviewOverlay`
 * relies on, and it is worth a test for the same reason: nothing about the
 * types stops `publish()` from passing it, and the failure would be silent
 * -- a notice on a real reader's page, on a site that is otherwise correct.
 */
describe("the app-shell notice is preview-only", () => {
  const main = readFileSync(join(__dirname, "..", "main.ts"), "utf8");
  const build = readFileSync(join(__dirname, "buildSite.ts"), "utf8");

  it("is set by buildToPreview and by nothing else", () => {
    const set = main.match(/previewBuild:\s*(\w+)/g) ?? [];
    expect(set).toEqual(["previewBuild: true"]);

    // And that one occurrence is inside `buildToPreview`, not `publish`.
    const preview = main.indexOf("async buildToPreview()");
    const after = main.indexOf("\n  }", main.indexOf("previewBuild: true"));
    expect(preview).toBeGreaterThan(-1);
    expect(main.indexOf("previewBuild: true")).toBeGreaterThan(preview);
    expect(after).toBeGreaterThan(-1);
  });

  it("is the only gate on adding the notice to a page", () => {
    expect(build).toContain("config.previewBuild && shellRoot");
    // Never read anywhere else, so there is one place for this to go wrong.
    expect((build.match(/config\.previewBuild/g) ?? []).length).toBe(1);
  });

  /*
   * Appended, never prepended. Anything before `<!doctype html>` drops the
   * document into quirks mode, which would break a working as-is page in
   * the preview while trying to explain a broken one.
   */
  it("goes after the document, inside the delimited region", () => {
    const at = build.indexOf("appShellNotice(shellRoot");
    const start = build.lastIndexOf("withOverlay +", at);
    expect(start).toBeGreaterThan(-1);
    expect(at - start).toBeLessThan(200);
  });
});

/**
 * The case this was all written for: an Angular project opened as a vault,
 * with no `dist/` in it. The file publishes perfectly and renders nothing.
 */
describe("an unbuilt Angular project in a vault", () => {
  const SHELL = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Demo</title><base href="/">
<link rel="icon" type="image/x-icon" href="favicon.ico"></head>
<body><app-root></app-root></body>
</html>`;

  it("src/index.html is recognised, and the preview copy explains itself", () => {
    const root = appShellWithoutCode(SHELL);
    expect(root).toBe("<app-root>");

    const content = SHELL + appShellNotice(root!, "src/index.html");
    // The author's file is still in there, untouched and first.
    expect(content.startsWith(SHELL)).toBe(true);
    expect(content).toContain("application shell with none of its code");
  });

  /*
   * `src/app/app.html` is the other one in a stock project: the root
   * component's template, which is a `<router-outlet>` and no script.
   */
  it("app.html trips it too, so both get the explanation", () => {
    expect(appShellWithoutCode(`<app-header></app-header><router-outlet></router-outlet>`))
      .toBe("<router-outlet>");
  });

  /*
   * And the half that keeps the preview quiet everywhere else. A component
   * template is a fragment with no root element of its own, and the built
   * output carries its code.
   */
  it("says nothing about a component template or a real build", () => {
    expect(appShellWithoutCode(`<section><h2>{{ title }}</h2></section>`)).toBe(null);
    expect(
      appShellWithoutCode(
        `<body><app-root></app-root><script src="main-GHI789.js" type="module"></script></body>`,
      ),
    ).toBe(null);
  });
});
