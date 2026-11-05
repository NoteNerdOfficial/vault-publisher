// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { setRequestUrl } from "../../test/obsidian-stub";
import { harvestCss, materializeMathJaxFonts } from "./harvestCss";

describe("harvestCss", () => {
  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("keeps MathJax font-face rules with its layout rules", () => {
    const style = document.createElement("style");
    style.textContent = `
      @font-face {
        font-family: MJXTEX;
        src: url("mathjax.woff") format("woff");
      }
      @font-face {
        font-family: OtherFont;
        src: url("other.woff") format("woff");
      }
      mjx-container { line-height: 0; }
    `;
    document.head.appendChild(style);

    const css = harvestCss(["mjx-"])
      .map((rule) => rule.cssText)
      .join("\n");

    expect(css).toContain("font-family: MJXTEX");
    expect(css).toContain("mjx-container");
    expect(css).not.toContain("font-family: OtherFont");
  });
});

/**
 * Which request path a font is read through.
 *
 * This exists because the wrong answer shipped. `fetch` was replaced with
 * `requestUrl` to satisfy a lint rule about network requests, and MathJax's
 * fonts are not a network request: they are `app://` URLs inside the app's
 * own origin, and `requestUrl` is built on Electron's `ClientRequest`, which
 * refuses every scheme but http and https. Every preview build in a vault
 * with MathJax CSS loaded failed with "ClientRequest only supports http: and
 * https: protocols", and nothing here noticed because this function had no
 * test at all.
 */
describe("reading the MathJax fonts", () => {
  const rule = (url: string) => [
    { origin: "test", cssText: `@font-face { font-family: MJXTEX; src: url("${url}"); }` },
  ];

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads an app:// font with fetch, not requestUrl", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      fetched.push(url);
      return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    });
    const restore = setRequestUrl(() => {
      throw new Error("ClientRequest only supports http: and https: protocols");
    });

    try {
      const out = await materializeMathJaxFonts(rule("app://local/lib/mathjax/MJXTEX.woff"));
      expect(fetched).toEqual(["app://local/lib/mathjax/MJXTEX.woff"]);
      expect(out.assets).toHaveLength(1);
      expect(out.assets[0].content.byteLength).toBe(8);
    } finally {
      restore();
    }
  });

  it("still sends an https font through requestUrl", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch should not be used for a network font");
    });
    const restore = setRequestUrl((options: { url: string }) => {
      asked.push(options.url);
      return Promise.resolve({ status: 200, arrayBuffer: new ArrayBuffer(4) });
    });

    try {
      const out = await materializeMathJaxFonts(rule("https://cdn.example.com/MJXZERO.woff"));
      expect(asked).toEqual(["https://cdn.example.com/MJXZERO.woff"]);
      expect(out.assets[0].content.byteLength).toBe(4);
    } finally {
      restore();
    }
  });

  // The rewrite is the other half of the job: the published CSS has to point
  // at the copied file rather than at a URL only the app can resolve.
  it("rewrites the rule to the copied path", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)) }),
    );
    const out = await materializeMathJaxFonts(rule("app://local/lib/mathjax/MJXTEX.woff"));
    expect(out.rules[0].cssText).not.toContain("app://");
    expect(out.rules[0].cssText).toContain("MJXTEX.woff");
    expect(out.assets[0].path).toBe("assets/mathjax/MJXTEX.woff");
  });
});
