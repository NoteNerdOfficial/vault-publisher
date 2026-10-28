import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OVERLAY_SCRIPT, overlayBundle } from "./overlayScript";
import { stampBlockIds } from "./anchor";
import type { OverlayComment } from "./types";

/**
 * The overlay ships as a string, so the compiler never looks inside it. A
 * typo in there is a page that loads with a dead overlay and no complaint
 * anywhere, found only by someone opening a preview and wondering why the
 * button is missing. So these tests do what tsc cannot: parse it, then run it
 * against a real DOM and drive it.
 */

const STORE_KEY = "osp-overlay-comments";

function mountPage(): void {
  document.head.innerHTML = `<meta name="osp-review" content='${JSON.stringify({
    sourcePath: "notes/Plan.md",
    page: "notes/plan.html",
    site: "Handbook",
    reviewer: "Reviewer",
  })}'>`;
  document.body.innerHTML =
    `<article class="osp-article">` +
    `<h2>Scope</h2><p>The first paragraph.</p><p>The second paragraph.</p>` +
    `</article>`;
  stampBlockIds(document.body);
}

function run(): ShadowRoot {
  new Function(overlayBundle())();
  const host = document.getElementById("osp-overlay-host");
  if (!host || !host.shadowRoot) throw new Error("the overlay did not mount");
  return host.shadowRoot;
}

function click(target: Element | null): void {
  if (!target) throw new Error("nothing to click");
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
}

function stored(): OverlayComment[] {
  return JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
}

/** Drives the overlay through leaving one comment on a chosen block. */
function leaveComment(shadow: ShadowRoot, selector: string, text: string): void {
  click(shadow.querySelector(".co-launch"));
  const add = Array.from(shadow.querySelectorAll(".co-head button")).find(
    (button) => button.textContent === "Add",
  );
  click(add ?? null);
  click(document.querySelector(selector));

  const input = shadow.querySelector("textarea") as HTMLTextAreaElement | null;
  if (!input) throw new Error("the draft did not open");
  input.value = text;
  const save = Array.from(shadow.querySelectorAll(".co-draft-tools button")).find(
    (button) => button.textContent === "Save",
  );
  click(save ?? null);
}

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("the overlay bundle", () => {
  it("is valid JavaScript", () => {
    expect(() => new Function(overlayBundle())).not.toThrow();
  });

  // The bundle goes inside a <script> element, so a literal closing tag in
  // either the stylesheet or the code would end the element early and spill
  // the rest of it into the document as markup.
  it("carries no closing script tag", () => {
    expect(overlayBundle().toLowerCase()).not.toContain("</script");
  });

  it("carries its stylesheet, since a shadow root cannot be reached from the page", () => {
    expect(overlayBundle()).toContain("OSP_OVERLAY_CSS");
    expect(overlayBundle()).toContain(".co-pin");
  });

  it("reads nothing from the page but the review meta", () => {
    expect(OVERLAY_SCRIPT).toContain("osp-review");
  });
});

describe("the overlay in a page", () => {
  it("does nothing at all without the review meta", () => {
    document.body.innerHTML = `<p>Published page.</p>`;
    new Function(overlayBundle())();

    expect(document.getElementById("osp-overlay-host")).toBeNull();
  });

  it("mounts behind a shadow root so the page's CSS cannot reach it", () => {
    mountPage();
    const shadow = run();

    expect(shadow.querySelector(".co-launch")).not.toBeNull();
    expect(shadow.querySelector("style")?.textContent).toContain(".co-panel");
  });

  it("leaves the article markup alone", () => {
    mountPage();
    const before = document.querySelector("article")?.outerHTML;
    run();

    expect(document.querySelector("article")?.outerHTML).toBe(before);
  });

  it("records a comment against the block that was clicked", () => {
    mountPage();
    const shadow = run();
    const target = document.querySelector("p:nth-of-type(2)");
    const block = target?.getAttribute("data-osp-block");

    leaveComment(shadow, "p:nth-of-type(2)", "This needs a citation.");

    const saved = stored();
    expect(saved).toHaveLength(1);
    expect(saved[0].text).toBe("This needs a citation.");
    expect(saved[0].block).toBe(block);
    expect(saved[0].sourcePath).toBe("notes/Plan.md");
    expect(saved[0].page).toBe("notes/plan.html");
    expect(saved[0].author).toBe("Reviewer");
    expect(saved[0].resolved).toBe(false);
    expect(saved[0].blockText).toBe("The second paragraph.");
  });

  it("shows the comment in the panel and drops a pin for it", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, "p:nth-of-type(1)", "Tighten this.");

    expect(shadow.querySelector(".co-text")?.textContent).toBe("Tighten this.");
    expect(shadow.querySelectorAll(".co-pin")).toHaveLength(1);
  });

  it("reads back comments left on an earlier visit", () => {
    mountPage();
    leaveComment(run(), "p:nth-of-type(1)", "Left earlier.");

    document.getElementById("osp-overlay-host")?.remove();
    mountPage();
    const shadow = run();

    expect(shadow.querySelector(".co-text")?.textContent).toBe("Left earlier.");
  });

  // Each page shows its own comments. Without this every comment ever left
  // appears on every page, because a pin whose block is missing still has to
  // be listed somewhere.
  it("shows only the comments belonging to this page", () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        {
          id: "a",
          page: "notes/other.html",
          sourcePath: "notes/Other.md",
          block: null,
          blockText: "",
          author: "Someone",
          text: "About another note.",
          createdAt: new Date().toISOString(),
          resolved: false,
        },
      ]),
    );
    mountPage();
    const shadow = run();
    click(shadow.querySelector(".co-launch"));

    expect(shadow.querySelector(".co-empty")).not.toBeNull();
    expect(shadow.textContent).not.toContain("About another note.");
  });

  // The anchor is content-derived, so rewriting the block is what loses it.
  // Saying so is the whole value of the orphan: the comment still carries the
  // text it was about.
  it("marks a comment whose block has been rewritten", () => {
    mountPage();
    leaveComment(run(), "p:nth-of-type(1)", "Unclear.");
    document.getElementById("osp-overlay-host")?.remove();

    document.body.innerHTML =
      `<article class="osp-article">` +
      `<h2>Scope</h2><p>The first paragraph, rewritten.</p>` +
      `</article>`;
    stampBlockIds(document.body);
    const shadow = run();
    click(shadow.querySelector(".co-launch"));

    expect(shadow.querySelector(".co-warn")).not.toBeNull();
    expect(shadow.querySelector(".co-quote")?.textContent).toBe(
      "The first paragraph.",
    );
    expect(shadow.querySelectorAll(".co-pin")).toHaveLength(0);
  });

  it("holds a comment whose block moved down the page", () => {
    mountPage();
    leaveComment(run(), "p:nth-of-type(2)", "Still about the second.");
    document.getElementById("osp-overlay-host")?.remove();

    document.body.innerHTML =
      `<article class="osp-article"><h2>Scope</h2>` +
      `<p>Inserted above.</p><p>The first paragraph.</p><p>The second paragraph.</p>` +
      `</article>`;
    stampBlockIds(document.body);
    const shadow = run();
    click(shadow.querySelector(".co-launch"));

    expect(shadow.querySelector(".co-warn")).toBeNull();
    expect(shadow.querySelectorAll(".co-pin")).toHaveLength(1);
  });

  it("resolves and reopens a comment", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, "p:nth-of-type(1)", "Fix the heading.");

    click(
      Array.from(shadow.querySelectorAll(".co-tools button")).find(
        (button) => button.textContent === "Resolve",
      ) ?? null,
    );
    expect(stored()[0].resolved).toBe(true);

    click(
      Array.from(shadow.querySelectorAll(".co-tools button")).find(
        (button) => button.textContent === "Reopen",
      ) ?? null,
    );
    expect(stored()[0].resolved).toBe(false);
  });

  it("deletes a comment", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, "p:nth-of-type(1)", "Never mind.");

    click(
      Array.from(shadow.querySelectorAll(".co-tools button")).find(
        (button) => button.textContent === "Delete",
      ) ?? null,
    );

    expect(stored()).toHaveLength(0);
    expect(shadow.querySelector(".co-empty")).not.toBeNull();
  });

  // A reviewer typing "/" in the textarea must not trigger the site's search
  // shortcut. Events retarget at the shadow boundary, so the site's own
  // activeElement check cannot see the textarea and would have let it through.
  it("stops keystrokes in the draft from reaching the page", () => {
    mountPage();
    const shadow = run();
    click(shadow.querySelector(".co-launch"));
    click(
      Array.from(shadow.querySelectorAll(".co-head button")).find(
        (button) => button.textContent === "Add",
      ) ?? null,
    );
    click(document.querySelector("p:nth-of-type(1)"));

    let reached = false;
    document.addEventListener("keydown", () => {
      reached = true;
    });
    shadow
      .querySelector("textarea")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "/", bubbles: true, composed: true }),
      );

    expect(reached).toBe(false);
  });

  // A screenshot caught this: with no left margin the pin was clamped to the
  // edge and drawn over the first word of the paragraph it marked.
  it("lifts a pin above its block when the margin has no room for it", () => {
    mountPage();
    const shadow = run();
    const target = document.querySelector("p:nth-of-type(1)") as HTMLElement;
    // jsdom reports every rect as zero, so stand in for a block hard against
    // the left edge and far enough down the page to have somewhere to go.
    target.getBoundingClientRect = () =>
      ({ left: 0, top: 400, bottom: 420, right: 600, width: 600, height: 20 }) as DOMRect;

    leaveComment(shadow, "p:nth-of-type(1)", "Covered the first word.");
    const pin = shadow.querySelector(".co-pin") as HTMLElement;

    expect(pin.style.left).toBe("2px");
    expect(parseInt(pin.style.top, 10)).toBeLessThan(400);
  });

  it("does not file a comment when the draft is left empty", () => {
    mountPage();
    const shadow = run();
    leaveComment(shadow, "p:nth-of-type(1)", "   ");

    expect(stored()).toHaveLength(0);
  });

  it("survives a corrupt store rather than failing to mount", () => {
    localStorage.setItem(STORE_KEY, "{ not json");
    mountPage();

    const shadow = run();
    click(shadow.querySelector(".co-launch"));

    expect(shadow.querySelector(".co-empty")).not.toBeNull();
  });

  // A store holding something that parses but is not a list of comments. The
  // guard is `Array.isArray`, and without it every read would throw on a
  // value a different version of this could plausibly have written.
  it("survives a store holding the wrong shape", () => {
    localStorage.setItem(STORE_KEY, `{"comments":[]}`);
    mountPage();

    expect(() => run()).not.toThrow();
  });
});

/**
 * The overlay talks to the plugin's local server when the page is served by
 * it, and falls back to localStorage alone when it is opened as a bare file.
 * Both paths matter, so both are driven here against a stubbed `fetch`
 * rather than a real socket.
 */
describe("the overlay against the vault", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: (init?.method ?? "GET").toUpperCase(),
        body: init?.body as string | undefined,
      });
      const result = handler(String(url), init);
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(result),
      } as Response);
    });
    return calls;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves a new comment to the vault, not only to this browser", async () => {
    const calls = stubFetch(() => ({ comments: [] }));
    mountPage();
    const shadow = run();
    leaveComment(shadow, "p:nth-of-type(1)", "Send this to the vault.");
    await flush();

    const posts = calls.filter((call) => call.method === "POST");
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0].url).toContain("/api/comments");

    const sent = JSON.parse(posts[posts.length - 1].body ?? "{}");
    expect(sent.comments).toHaveLength(1);
    expect(sent.comments[0].text).toBe("Send this to the vault.");
    // Shaped like an export, so the import command reads it unchanged.
    expect(sent.version).toBe(1);
  });

  // The point of the whole exercise: a comment left in another browser, or
  // before this one's storage was cleared, is there when the page opens.
  it("shows comments the vault already holds", async () => {
    stubFetch(() => ({
      comments: [
        {
          id: "from-vault",
          page: "notes/plan.html",
          sourcePath: "notes/Plan.md",
          block: null,
          blockText: "",
          author: "Someone else",
          text: "Left on another machine.",
          createdAt: "2026-10-28T07:00:00.000Z",
          resolved: false,
        },
      ],
    }));
    mountPage();
    const shadow = run();
    await flush();

    expect(shadow.textContent).toContain("Left on another machine.");
    expect(stored()).toHaveLength(1);
  });

  // A resolve made here must not be undone by a copy the vault saved before
  // it. The person sitting at this browser is the one who just acted.
  it("keeps this browser's version of a comment it already knows", async () => {
    const mine = {
      id: "shared",
      page: "notes/plan.html",
      sourcePath: "notes/Plan.md",
      block: null,
      blockText: "",
      author: "Me",
      text: "Mine, resolved.",
      createdAt: "2026-10-28T07:00:00.000Z",
      resolved: true,
    };
    localStorage.setItem(STORE_KEY, JSON.stringify([mine]));
    stubFetch(() => ({ comments: [{ ...mine, resolved: false }] }));
    mountPage();
    run();
    await flush();

    expect(stored()).toHaveLength(1);
    expect(stored()[0].resolved).toBe(true);
  });

  it("carries on against localStorage when the plugin is not running", async () => {
    stubFetch(() => new Error("connection refused"));
    mountPage();
    const shadow = run();
    leaveComment(shadow, "p:nth-of-type(1)", "Offline, but kept.");
    await flush();

    expect(stored()).toHaveLength(1);
    expect(shadow.querySelector(".co-text")?.textContent).toBe("Offline, but kept.");
  });

  // Opened straight out of the preview folder, with no plugin running. There
  // is nothing to talk to, so it should not try -- a failed request per
  // keystroke-worth of work is noise in the console and latency on every save.
  it("does not reach for the network at all on a file:// page", async () => {
    const calls = stubFetch(() => ({ comments: [] }));
    vi.stubGlobal("location", { protocol: "file:", href: "file:///preview/note.html" });

    mountPage();
    const shadow = run();
    leaveComment(shadow, "p:nth-of-type(1)", "No server here.");
    await flush();

    expect(calls).toHaveLength(0);
    expect(stored()).toHaveLength(1);
    expect(shadow.querySelector(".co-text")?.textContent).toBe("No server here.");
  });
});
