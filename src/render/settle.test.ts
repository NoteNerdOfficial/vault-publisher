// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { waitForSettle } from "./settle";

function stuckBase(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML =
    `<span class="internal-embed bases-embed is-loaded">` +
      `<div class="bases-toolbar"><span class="bases-toolbar-result-count">8 results</span></div>` +
      `<div class="bases-view" data-view-type="table" data-view-name="Shelf">` +
        `<div class="bases-tbody"><div class="bases-tr"><div class="bases-td">Fj</div></div></div>` +
      `</div>` +
    `</span>`;
  document.body.append(el);
  return el;
}

describe("waitForSettle", () => {
  // The measurement row used to satisfy the check in about 100ms, so a view
  // with no data published as finished. It must now count as unfinished.
  it("does not call a view with only a measurement row finished", async () => {
    const result = await waitForSettle(stuckBase(), {
      quietMs: 10,
      timeoutMs: 60,
      waitForAssets: false,
    });

    expect(result.settled).toBe(false);
    expect(result.reason).toBe("timeout");
  });

  // A count alone does not say which view on which page was unfinished,
  // so the reason travels with the result.
  it("says what was unfinished when it gives up", async () => {
    const result = await waitForSettle(stuckBase(), {
      quietMs: 10,
      timeoutMs: 60,
      waitForAssets: false,
    });

    expect(result.pendingReason).toBe("bases view has no rows yet: Shelf");
  });
});
