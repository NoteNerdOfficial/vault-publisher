// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from "vitest";
import { installObsidianDom } from "../../test/obsidian-stub";
import { normalizeStaticPluginOutput } from "./normalize";

// `normalize.ts` asks nodes what they are with Obsidian's `instanceOf`, which
// is the cross-window-safe form of `instanceof`: the render host is its own
// document, and a plain `instanceof` compares against one window's
// constructors. The stub supplies it here the way the app supplies it there.
beforeAll(installObsidianDom);

function render(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("normalizeStaticPluginOutput", () => {
  it("turns an opaque Datacore error into readable output", () => {
    const root = render(`<div class="block-language-datacorejsx">[object Object]</div>`);

    expect(normalizeStaticPluginOutput(root)).toBe(1);
    expect(root.textContent).toBe("Datacore could not render this block.");
    expect(root.querySelector(".osp-datacore-error")).not.toBeNull();
  });

  it("replaces controls in DataviewJS with static text", () => {
    const root = render(
      `<div class="block-language-dataviewjs"><button>Click me</button></div>`,
    );

    expect(normalizeStaticPluginOutput(root)).toBe(1);
    expect(root.querySelector("button")).toBeNull();
    expect(root.querySelector(".osp-static-control")?.textContent).toBe("Click me");
  });
});
