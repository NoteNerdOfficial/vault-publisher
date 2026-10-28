/**
 * Not a test of behaviour: a way to look at the real overlay.
 *
 * It builds a page through the same `buildPage` the publisher uses, with the
 * overlay turned on and its blocks stamped, and writes it where a browser can
 * open it. jsdom is enough to drive the script's logic and not enough to say
 * anything about a shadow root's painting or where a pin lands, both of which
 * are the kind of thing that is only ever wrong in a real browser.
 *
 * Guarded by an environment variable so an ordinary `npm test` writes nothing.
 *
 *   OSP_PREVIEW=/tmp/preview npx vitest run overlay.preview
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPage } from "../publish/page";
import { stampBlockIds } from "./anchor";

const OUT = process.env.OSP_PREVIEW;

const CONTENT = `
<h2>Scope</h2>
<p>The published site is built by rendering every note through Obsidian, so
whatever a plugin drew on screen is what lands in the HTML.</p>
<p>That is the one promise this plugin makes, and the reason a preview is
worth reading rather than trusting.</p>
<ul><li>Dataview tables survive.</li><li>Bases views survive.</li></ul>
<blockquote>A quoted paragraph, which is also a block worth commenting on.</blockquote>
<table><thead><tr><th>Quarter</th><th>Revenue</th></tr></thead>
<tbody><tr><td>Q3</td><td>1,200</td></tr></tbody></table>
`;

describe("the overlay, as a file to open", () => {
  it("writes a page with the overlay on it", () => {
    const holder = document.createElement("div");
    holder.innerHTML = CONTENT;
    const stamped = stampBlockIds(holder);
    expect(stamped).toBeGreaterThan(5);

    const html = buildPage({
      meta: {
        title: "Scope",
        url: "notes/scope.html",
        siteName: "Handbook",
      },
      content: holder.innerHTML,
      headings: [{ level: 2, text: "Scope", id: "scope" }],
      overlay: { sourcePath: "notes/Scope.md", reviewer: "Reviewer" },
    });

    // Always checked, whether or not the file is written: this is the whole
    // reason the harness renders through the real `buildPage`.
    expect(html).toContain("osp-review");
    expect(html).toContain("data-osp-block");

    if (!OUT) return;
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "overlay.html"), html, "utf8");
  });
});
