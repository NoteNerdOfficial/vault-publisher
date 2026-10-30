// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import {
  DEFAULT_MAX_ASSET_BYTES,
  assetSkipReason,
  collectAssets,
  formatBytes,
} from "./assets";

/**
 * The real `app://` URL shape, with a home directory in it. This is what was
 * being published for an embed that could not be resolved.
 */
const HOME = "/Users/somebody";
const APP_URL =
  `app://a1b2c3/${HOME}/Documents/Obsidian/my-vault/attachments/photo.png?1700000000`;

function fakeApp(files: Record<string, TFile>, basePath: string | null): App {
  return {
    vault: {
      adapter: basePath === null ? {} : { basePath },
      getAbstractFileByPath: (path: string) => files[path] ?? null,
    },
    metadataCache: {
      getFirstLinkpathDest: (linkpath: string) => files[linkpath] ?? null,
    },
  } as unknown as App;
}

function file(path: string, size = 1024): TFile {
  return Object.assign(new TFile(), { path, stat: { size, ctime: 0, mtime: 0 } });
}

function render(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("collectAssets", () => {
  it("rewrites an embed it can resolve through the wrapper", () => {
    const root = render(
      `<div class="internal-embed image-embed" src="photo.png">` +
        `<img src="${APP_URL}" alt="A photo"></div>`,
    );
    const wanted: TFile[] = [];

    const stats = collectAssets(
      fakeApp({ "photo.png": file("attachments/photo.png") }, null),
      root,
      "notes/note.md",
      "notes/note.html",
      { want: (f) => wanted.push(f) },
    );

    expect(stats.rewritten).toBe(1);
    expect(stats.unresolved).toEqual([]);
    expect(wanted.map((f) => f.path)).toEqual(["attachments/photo.png"]);
    expect(root.querySelector("img")?.getAttribute("src")).toBe(
      "../assets/files/attachments/photo.png",
    );
  });

  it("recovers a vault path from a bare app:// URL", () => {
    const root = render(`<img src="${APP_URL}">`);
    const base = `${HOME}/Documents/Obsidian/my-vault`;

    const stats = collectAssets(
      fakeApp({ "attachments/photo.png": file("attachments/photo.png") }, base),
      root,
      "note.md",
      "note.html",
      { want: () => {} },
    );

    expect(stats.rewritten).toBe(1);
    // No "./" prefix: these always begin with the literal "assets/", so there
    // is no colon in the first segment to be misread as a URL scheme.
    expect(root.querySelector("img")?.getAttribute("src")).toBe(
      "assets/files/attachments/photo.png",
    );
  });

  // The point of the fix: an embed that cannot be resolved was shipping an
  // absolute filesystem path, and so the author's account name, in public HTML.
  it("removes the reference when the file cannot be resolved", () => {
    const root = render(`<img src="${APP_URL}" alt="A photo">`);

    const stats = collectAssets(
      fakeApp({}, null),
      root,
      "note.md",
      "note.html",
      { want: () => {} },
    );

    expect(stats.unresolved).toHaveLength(1);
    expect(stats.rewritten).toBe(0);

    const img = root.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.hasAttribute("src")).toBe(false);
    expect(img?.getAttribute("alt")).toBe("A photo");
    expect(img?.classList.contains("osp-unresolved-asset")).toBe(true);

    // The real assertion: nothing about this machine survives into the page.
    expect(root.innerHTML).not.toContain(HOME);
    expect(root.innerHTML).not.toContain("app://");
  });

  it("strips every URL-bearing attribute of an unresolved embed", () => {
    const root = render(
      `<video poster="${APP_URL}"><source src="${APP_URL}" srcset="${APP_URL} 2x"></video>`,
    );

    collectAssets(fakeApp({}, null), root, "note.md", "note.html", {
      want: () => {},
    });

    expect(root.innerHTML).not.toContain(HOME);
  });

  it("marks an empty missing-image wrapper as unresolved", () => {
    const root = render(
      `<span class="internal-embed mod-empty-attachment" src="missing.png" ` +
        `alt="missing.png"></span>`,
    );

    const stats = collectAssets(fakeApp({}, null), root, "note.md", "note.html", {
      want: () => {},
    });

    expect(stats.unresolved).toEqual(["missing.png"]);
    expect(root.querySelector(".osp-unresolved-asset")).not.toBeNull();
    expect(root.innerHTML).not.toContain("src=");
  });

  // The ceiling has to be applied here, not at upload time: rewriting the
  // reference and then skipping the file left a broken image on a live page.
  it("refuses an oversized attachment without rewriting the page", () => {
    const root = render(
      `<div class="internal-embed image-embed" src="huge.png">` +
        `<img src="${APP_URL}" alt="A recording"></div>`,
    );
    const wanted: TFile[] = [];
    const huge = file("attachments/huge.png", 30 * 1024 * 1024);

    const stats = collectAssets(
      fakeApp({ "huge.png": huge }, null),
      root,
      "note.md",
      "note.html",
      { want: (f) => wanted.push(f) },
    );

    // Not queued, not counted, and the page does not point at it.
    expect(wanted).toEqual([]);
    expect(stats.collected).toBe(0);
    expect(stats.rewritten).toBe(0);
    expect(stats.oversized).toEqual([
      { path: "attachments/huge.png", reason: expect.stringContaining("30 MiB") },
    ]);

    const img = root.querySelector("img");
    expect(img?.hasAttribute("src")).toBe(false);
    expect(img?.getAttribute("alt")).toBe("A recording");
    expect(img?.classList.contains("osp-oversized-asset")).toBe(true);
    expect(root.innerHTML).not.toContain("assets/files");
  });

  it("publishes a file right at the ceiling", () => {
    const root = render(
      `<div class="internal-embed image-embed" src="big.png">` +
        `<img src="${APP_URL}"></div>`,
    );
    const stats = collectAssets(
      fakeApp({ "big.png": file("attachments/big.png", DEFAULT_MAX_ASSET_BYTES) }, null),
      root,
      "note.md",
      "note.html",
      { want: () => {} },
    );

    expect(stats.rewritten).toBe(1);
    expect(stats.oversized).toEqual([]);
  });

  it("honours a limit passed in", () => {
    const root = render(
      `<div class="internal-embed image-embed" src="a.png">` +
        `<img src="${APP_URL}"></div>`,
    );
    const stats = collectAssets(
      fakeApp({ "a.png": file("attachments/a.png", 2048) }, null),
      root,
      "note.md",
      "note.html",
      { want: () => {} },
      1024,
    );

    expect(stats.oversized).toHaveLength(1);
    expect(stats.rewritten).toBe(0);
  });

  it("leaves http and data references alone", () => {
    const root = render(
      `<img src="https://example.com/a.png"><img src="data:image/gif;base64,R0lGOD">`,
    );

    const stats = collectAssets(
      fakeApp({}, null),
      root,
      "note.md",
      "note.html",
      { want: () => {} },
    );

    expect(stats.external).toBe(1);
    expect(stats.unresolved).toEqual([]);
    expect(root.querySelectorAll("img[src]")).toHaveLength(2);
  });
});

describe("assetSkipReason", () => {
  it("passes an ordinary attachment", () => {
    expect(assetSkipReason(400 * 1024)).toBeNull();
  });

  it("passes a file exactly at the limit", () => {
    expect(assetSkipReason(DEFAULT_MAX_ASSET_BYTES)).toBeNull();
  });

  // One huge file used to be read into memory, base64-encoded and pushed at
  // the API, failing the whole publish after everything else had worked.
  it("skips a file over the limit and says both sizes", () => {
    const reason = assetSkipReason(300 * 1024 * 1024);
    expect(reason).toContain("300 MiB");
    expect(reason).toContain("25 MiB");
    expect(reason).toContain("publish without it");
  });

  it("honours a custom limit", () => {
    expect(assetSkipReason(2048, 1024)).toContain("2.0 KiB");
    expect(assetSkipReason(512, 1024)).toBeNull();
  });
});

describe("formatBytes", () => {
  it("uses bytes below a kibibyte", () => {
    expect(formatBytes(900)).toBe("900 B");
  });

  it("climbs units and keeps one decimal while small", () => {
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GiB");
  });

  // Ten and up reads better without one: "25 MiB", not "25.0 MiB".
  it("drops the decimal once the number is large", () => {
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MiB");
    expect(formatBytes(300 * 1024 * 1024)).toBe("300 MiB");
  });
});
