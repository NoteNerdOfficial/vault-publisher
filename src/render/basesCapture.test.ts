// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { emptyBasesStats } from "../publish/bases";
import { captureBasesInView } from "./basesCapture";

const FAST = { quietMs: 20, timeoutMs: 300, pollMs: 5 };

function row(i: number): string {
  return `<div class="bases-tr"><div class="bases-td" data-property="title">Row ${i}</div></div>`;
}

/**
 * A host holding a container with Bases embeds at given offsets. jsdom does
 * no layout, so each embed reports its offset through getBoundingClientRect,
 * measured from the host's current `top` the way a fixed host would be.
 */
function setup(embeds: { offset: number; claimed: number; rows: number; name: string }[]) {
  const host = document.createElement("div");
  host.style.top = "0px";
  document.body.append(host);
  const container = document.createElement("div");
  host.append(container);
  const hostTop = () => parseFloat(host.style.top || "0");
  host.getBoundingClientRect = () => ({ top: hostTop() }) as DOMRect;

  for (const e of embeds) {
    const embed = document.createElement("span");
    embed.className = "internal-embed bases-embed";
    embed.innerHTML =
      `<div class="bases-toolbar"><span class="bases-toolbar-result-count">${e.claimed} results</span></div>` +
      `<div class="bases-view" data-view-type="table" data-view-name="${e.name}">` +
        `<div class="bases-tbody">${Array.from({ length: e.rows }, (_, i) => row(i + 1)).join("")}</div>` +
      `</div>`;
    // The embed's toolbar sits above its view, so the view starts a little
    // lower; the test offsets name where the view is.
    embed.getBoundingClientRect = () => ({ top: hostTop() + e.offset - 40 }) as DOMRect;
    const view = embed.querySelector<HTMLElement>(".bases-view")!;
    view.getBoundingClientRect = () => ({ top: hostTop() + e.offset }) as DOMRect;
    container.append(embed);
  }
  return { host, container };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("captureBasesInView", () => {
  it("brings each view to the top of the window and converts it there", async () => {
    const { host, container } = setup([
      { offset: 100, claimed: 3, rows: 3, name: "First" },
      { offset: 2400, claimed: 2, rows: 0, name: "Second" },
    ]);
    // The second view only builds its rows once it has been moved to the top
    // of the window, which is the behaviour this exists for.
    const second = container.querySelectorAll(".bases-tbody")[1];
    const tops: string[] = [];
    const timer = window.setInterval(() => {
      tops.push(host.style.top);
      if (host.style.top === "-2400px" && !second.children.length) {
        second.innerHTML = row(1) + row(2);
      }
    }, 5);

    const stats = emptyBasesStats();
    const result = await captureBasesInView(host, container, stats, FAST);
    window.clearInterval(timer);

    expect(tops).toContain("-100px");
    expect(tops).toContain("-2400px");
    expect(result).toEqual({ captured: 2, leftUnfinished: 0 });
    expect(stats.views).toBe(2);
    expect(stats.rows).toBe(5);
    expect(stats.truncated).toEqual([]);
    expect(container.querySelector(".bases-view, .bases-embed")).toBeNull();
    expect(container.querySelectorAll("figure.osp-base")).toHaveLength(2);
  });

  it("puts the host back where it was", async () => {
    const { host, container } = setup([{ offset: 500, claimed: 1, rows: 1, name: "Only" }]);

    await captureBasesInView(host, container, emptyBasesStats(), FAST);

    expect(host.style.top).toBe("0px");
  });

  // Rows can arrive over several frames. Converting at the first row would
  // publish a shorter table than the window allowed.
  it("waits for the row count to stop growing", async () => {
    const { host, container } = setup([{ offset: 0, claimed: 5, rows: 1, name: "Growing" }]);
    const tbody = container.querySelector(".bases-tbody")!;
    let added = 1;
    const timer = window.setInterval(() => {
      if (added < 5) tbody.insertAdjacentHTML("beforeend", row(++added));
    }, 8);

    const stats = emptyBasesStats();
    await captureBasesInView(host, container, stats, FAST);
    window.clearInterval(timer);

    expect(stats.rows).toBe(5);
  });

  // A view that never builds is left for the general wait, which knows how
  // to time it out and name it, rather than converted into an empty table.
  it("leaves a view that never builds its rows in place", async () => {
    const { host, container } = setup([{ offset: 0, claimed: 6, rows: 0, name: "Stuck" }]);

    const stats = emptyBasesStats();
    const result = await captureBasesInView(host, container, stats, FAST);

    expect(result).toEqual({ captured: 0, leftUnfinished: 1 });
    expect(stats.views).toBe(0);
    expect(container.querySelector(".bases-view")).not.toBeNull();
    expect(host.style.top).toBe("0px");
  });

  it("captures an embed whose view arrives after its turn starts", async () => {
    const { host, container } = setup([{ offset: 300, claimed: 2, rows: 2, name: "Late" }]);
    const embed = container.querySelector(".bases-embed")!;
    const view = embed.querySelector(".bases-view")!;
    view.remove();
    window.setTimeout(() => embed.append(view), 30);

    const stats = emptyBasesStats();
    const result = await captureBasesInView(host, container, stats, FAST);

    expect(result.captured).toBe(1);
    expect(stats.rows).toBe(2);
  });

  it("does nothing to a note with no Bases in it", async () => {
    const { host, container } = setup([]);
    container.innerHTML = "<p>Prose only.</p>";

    const result = await captureBasesInView(host, container, emptyBasesStats(), FAST);

    expect(result).toEqual({ captured: 0, leftUnfinished: 0 });
    expect(host.style.top).toBe("0px");
  });
});
