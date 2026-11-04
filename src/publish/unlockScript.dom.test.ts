// @vitest-environment jsdom

/**
 * The reader, run.
 *
 * The rest of `unlockScript.test.ts` reads the script as text, which is
 * enough for the shape of it and was not enough for the bug that mattered:
 * every reference was correctly named, every file was published, and the
 * page still came up blank because the repair happened after the parser had
 * already given up on it. So this encrypts a small site with the real
 * `lockSite`, serves the result to a stubbed `fetch`, and runs the real
 * reader over the real shell -- which is the only arrangement that can tell
 * a stylesheet that loads from one that is merely spelled right.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { lockSite } from "./lockSite";
import { UNLOCK_SCRIPT } from "./unlockScript";
import type { PublishFile } from "../github/client";

const PASSWORD = "a shared secret";

/**
 * Which files were asked for while the shell was still on screen.
 *
 * The point of the whole fix, and the one thing jsdom cannot show by itself:
 * it will happily set `src` on a script that has already failed, where a
 * browser ignores it entirely. So the test does not ask whether the
 * attribute ends up right -- it asks whether the file was fetched *before*
 * the document was replaced, which is the only moment at which setting it
 * does anything.
 */
const fetchedBeforeWrite = new Set<string>();

/** Cheap, because a test should not spend 600,000 iterations on a password. */
const ITERATIONS = 1000;

/**
 * An as-is page beside its own files, which is the case that broke.
 *
 * The references are bare names rather than `../`-prefixed ones: an as-is
 * page sits beside what it loads, and matching a reference by trimming
 * `../` off the front of it missed every one of them.
 */
const PAGE = `<!doctype html>
<html lang="en">
<head>
<title>A page that styles itself</title>
<link rel="stylesheet" href="styles.css">
<style>.panel { background-image: url(art/texture.svg); }</style>
<script type="module" src="app.js"></script>
</head>
<body>
<div id="root"></div>
<span class="swatch" style="background-image: url(art/badge.svg)"></span>
<img src="art/panel.svg" alt="">
<img srcset="art/panel.svg 1x, art/panel-wide.svg 2x" src="art/panel.svg" alt="">
</body>
</html>`;

const SITE: PublishFile[] = [
  { path: "html-as-is/index.html", content: PAGE },
  {
    path: "html-as-is/styles.css",
    // A reference from inside a stylesheet, resolved against the stylesheet
    // and not against the page: both sit in `html-as-is/`, so a rule that
    // resolved `art/panel.svg` from the site root would miss it.
    content: "body{color:#111}\n.hero{background:url(art/panel.svg) no-repeat}",
  },
  { path: "html-as-is/app.js", content: "window.ran = true;" },
  { path: "html-as-is/art/badge.svg", content: "<svg/>" },
  { path: "html-as-is/art/texture.svg", content: "<svg id=\"t\"/>" },
  { path: "html-as-is/art/panel.svg", content: "<svg id=\"p\"/>" },
  { path: "html-as-is/art/panel-wide.svg", content: "<svg id=\"w\"/>" },
  // Published in the clear, and must be left alone by all of this.
  { path: "assets/site.css", content: ":root{}" },
];

let locked: Awaited<ReturnType<typeof lockSite>>;
let served: Map<string, string>;

/** The blob behind a blob URL, so a test can read what was handed over. */
const blobs = new Map<string, Blob>();

beforeEach(async () => {
  locked = await lockSite(SITE, PASSWORD, ITERATIONS);
  served = new Map(
    locked.files
      .filter((file) => typeof file.content === "string")
      .map((file) => [file.path, file.content as string]),
  );
  blobs.clear();
  fetchedBeforeWrite.clear();

  // jsdom has no object URLs of its own.
  let next = 0;
  vi.stubGlobal("URL", Object.assign(globalThis.URL, {
    createObjectURL: (blob: Blob) => {
      const url = `blob:test/${next++}`;
      blobs.set(url, blob);
      return url;
    },
    revokeObjectURL: () => {},
  }));

  /*
   * The site as a static host serves it: the published path, and a 404 for
   * anything else. A request for `styles.css` rather than `styles.css.enc`
   * is exactly the failure this is here to catch, so it must miss.
   */
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      // Resolved against the page, as a browser resolves it: the reader asks
      // for `../html-as-is/styles.css.enc` from a page two segments deep, and
      // a stub that compared that string literally would answer 404 for a
      // request a real host answers.
      const path = new URL(String(input), location.href).pathname.replace(/^\/+/, "");
      // The form is the shell's, so its presence dates the request: still
      // there means the document has not been replaced yet.
      if (document.getElementById("osp-unlock-form")) {
        fetchedBeforeWrite.add(decodeURIComponent(path));
      }
      const body = served.get(decodeURIComponent(path));
      return {
        ok: body !== undefined,
        status: body === undefined ? 404 : 200,
        json: async () => JSON.parse(body ?? "null"),
      } as unknown as Response;
    }),
  );
});

/** The locked shell for one page, loaded into jsdom at the page's own URL. */
function openShell(path: string): void {
  const shell = locked.files.find((file) => file.path === path);
  if (!shell) throw new Error(`no shell at ${path}`);
  // The document's own URL decides what a relative reference resolves to,
  // which is the whole of what `sitePath` is reading.
  window.history.replaceState({}, "", `/${path}`);
  document.documentElement.innerHTML = String(shell.content)
    .replace(/^[\s\S]*?<html[^>]*>/i, "")
    .replace(/<\/html>[\s\S]*$/i, "");
}

/** Runs the reader, types the password, and waits for the document to settle. */
async function unlock(): Promise<void> {
  new Function(UNLOCK_SCRIPT)();
  const field = document.getElementById("osp-unlock-password") as HTMLInputElement;
  field.value = PASSWORD;
  document.getElementById("osp-unlock-form")!.dispatchEvent(
    new Event("submit", { cancelable: true }),
  );
  // The reader is a chain of promises over WebCrypto and two fetches.
  for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 0));
}

describe("the reader, over a locked as-is page", () => {
  it("publishes the page's own files only as ciphertext", () => {
    expect(served.has("html-as-is/styles.css")).toBe(false);
    expect(served.has("html-as-is/styles.css.enc")).toBe(true);
    expect(served.has("html-as-is/app.js.enc")).toBe(true);
    // The site's own stylesheet is what the shell needs to look like a page.
    expect(served.has("assets/site.css")).toBe(true);
  });

  /*
   * The regression. A stylesheet whose href is still `styles.css` after the
   * unlock is a stylesheet pointing at a 404, which is what an unstyled page
   * looks like from the inside.
   */
  it("gives the stylesheet a blob URL before the document is written", async () => {
    openShell("html-as-is/index.html");
    await unlock();

    const link = document.querySelector("link[rel=stylesheet]") as HTMLLinkElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toMatch(/^blob:/);
  });

  /** And as `text/css`, or the browser refuses it however well it is spelled. */
  it("serves the stylesheet as text/css", async () => {
    openShell("html-as-is/index.html");
    await unlock();

    const link = document.querySelector("link[rel=stylesheet]") as HTMLLinkElement;
    const blob = blobs.get(link.getAttribute("href")!);
    expect(blob?.type).toBe("text/css");
    expect(await blob!.text()).toContain("body{color:#111}");
  });

  /*
   * The blank page. A script element that has already tried to load does not
   * try again when its src changes, so this one has to arrive pointing at
   * the blob -- which is only possible before the write.
   */
  it("gives the module script a blob URL, as a JavaScript type", async () => {
    openShell("html-as-is/index.html");
    await unlock();

    const script = document.querySelector("script[type=module]") as HTMLScriptElement;
    expect(script).toBeTruthy();
    expect(script.getAttribute("src")).toMatch(/^blob:/);
    expect(blobs.get(script.getAttribute("src")!)?.type).toBe("text/javascript");
  });

  /** An image is still swapped, and still after the page is readable. */
  it("swaps a picture too", async () => {
    openShell("html-as-is/index.html");
    await unlock();

    const img = document.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toMatch(/^blob:/);
    expect(blobs.get(img.getAttribute("src")!)?.type).toBe("image/svg+xml");
  });

  /** Nothing in the clear is touched: a blob URL for it would be a waste. */
  it("leaves a file that was never encrypted alone", async () => {
    openShell("html-as-is/index.html");
    await unlock();
    expect(document.documentElement.innerHTML).not.toContain("assets/site.css.enc");
  });

  /** One fetch per file, however many references point at it. */
  it("decrypts each file once", async () => {
    openShell("html-as-is/index.html");
    await unlock();

    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (call) => String(call[0]),
    );
    expect(new Set(calls).size).toBe(calls.length);
  });

  /*
   * The ordering, stated as such.
   *
   * A stylesheet and a script have to be in hand before the parser sees
   * them. A picture must not be waited for, or every locked page would hold
   * its own text back until its images had arrived.
   */
  it("fetches the stylesheet and the script before replacing the document", async () => {
    openShell("html-as-is/index.html");
    await unlock();

    expect(fetchedBeforeWrite).toContain("html-as-is/styles.css.enc");
    expect(fetchedBeforeWrite).toContain("html-as-is/app.js.enc");
  });

  it("does not hold the page back for a picture", async () => {
    openShell("html-as-is/index.html");
    await unlock();

    expect(fetchedBeforeWrite).not.toContain("html-as-is/art/badge.svg.enc");
  });

  /*
   * The references no `src` or `href` mentions.
   *
   * A file named inside a rule is as encrypted as one named in an attribute,
   * and the pass that walks attributes was never going to see it. The demo
   * page in the test vault lists four shapes on purpose; these are the three
   * that are not a plain attribute.
   */
  it("rewrites a url() in a style block", async () => {
    openShell("html-as-is/index.html");
    await unlock();

    const style = document.querySelector("style") as HTMLStyleElement;
    expect(style.textContent).toMatch(/url\("blob:/);
    expect(style.textContent).not.toContain("art/texture.svg");
  });

  it("rewrites a url() in a style attribute", async () => {
    openShell("html-as-is/index.html");
    await unlock();

    const swatch = document.querySelector(".swatch") as HTMLElement;
    expect(swatch.getAttribute("style")).toMatch(/url\("blob:/);
  });

  /*
   * And inside the stylesheet's own bytes, where it is not optional: a blob
   * URL has no folder, so a relative url() left in a decrypted sheet cannot
   * resolve against anything at all.
   */
  it("rewrites a url() inside a decrypted stylesheet, against the sheet's own path", async () => {
    openShell("html-as-is/index.html");
    await unlock();

    const link = document.querySelector("link[rel=stylesheet]") as HTMLLinkElement;
    const text = await blobs.get(link.getAttribute("href")!)!.text();
    expect(text).toMatch(/background:url\("blob:/);
    expect(text).not.toContain("art/panel.svg");
  });

  /*
   * `srcset` beats `src`, so repairing only `src` leaves the picture broken
   * while looking as though it was dealt with.
   */
  it("rewrites every candidate in a srcset", async () => {
    openShell("html-as-is/index.html");
    await unlock();

    const wide = document.querySelector("img[srcset]") as HTMLImageElement;
    const set = wide.getAttribute("srcset") ?? "";
    expect(set).not.toContain("art/panel");
    expect(set.match(/blob:/g) ?? []).toHaveLength(2);
    // The descriptors have to survive, or the browser cannot choose between
    // the candidates it is being offered.
    expect(set).toMatch(/1x/);
    expect(set).toMatch(/2x/);
  });

  /*
   * The 404 per picture per page.
   *
   * A locked image is published under another name, so the markup the parser
   * sees names a file that is not on the server: the browser asks for it,
   * gets a 404, draws a broken-image icon, and the sweep replaces it a
   * moment later. The picture arrived, so nothing looked wrong on the page
   * -- it looked wrong in the console, once per image, on every page of the
   * site. So the reference is moved out of the attribute the browser fetches
   * before the document is written, and put back as a blob URL afterwards.
   */
  it("writes the document with its pictures deferred, so none is requested twice", async () => {
    openShell("html-as-is/index.html");

    let written = "";
    const real = document.write.bind(document);
    document.write = (markup: string) => {
      written += markup;
      real(markup);
    };
    try {
      await unlock();
    } finally {
      document.write = real;
    }

    // Nothing the browser would fetch under a name that is not there.
    expect(written).not.toMatch(/\ssrc="art\//);
    expect(written).not.toMatch(/\ssrcset="art\//);
    // Held aside instead, under a name no browser fetches.
    expect(written).toContain('data-osp-enc-src="art/panel.svg"');
    expect(written).toContain("data-osp-enc-srcset=");
    // The stylesheet and the script are the opposite case: those must be in
    // the markup, already pointing at a blob, or they never load at all.
    expect(written).toMatch(/<link[^>]+href="blob:/);
    expect(written).toMatch(/<script[^>]+src="blob:/);

    // And by the end the pictures are back, under their real attributes.
    expect(document.querySelector("img[data-osp-enc-src]")).toBeNull();
    expect(
      (document.querySelector("img") as HTMLImageElement).getAttribute("src"),
    ).toMatch(/^blob:/);
  });

  /** The document must not come back in quirks mode. */
  it("writes a doctype back", async () => {
    openShell("html-as-is/index.html");
    await unlock();
    expect(document.compatMode).toBe("CSS1Compat");
  });
});
