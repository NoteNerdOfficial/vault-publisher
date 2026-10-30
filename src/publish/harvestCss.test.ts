// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { harvestCss } from "./harvestCss";

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
