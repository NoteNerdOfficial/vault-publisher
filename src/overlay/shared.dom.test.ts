// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stampBlockIds } from "./anchor";
import { overlayBundle } from "./overlayScript";
import { readSharedMarker, sharedText, type SharedIssue } from "./shared";
import type { OverlayComment } from "./types";

/**
 * The published site's half of shared comments, run against a real DOM and
 * a stand-in for GitHub's API: posting through GitHub's prefilled form, and
 * reading the repository's issues back as pins.
 *
 * The posting test is also the parity test. The body the overlay writes is
 * handed to the plugin's own reader in `shared.ts`, which is what a sync
 * uses to bring the comment into the vault, so the two cannot drift apart
 * without this failing.
 */

const STORE_KEY = "osp-overlay-comments";

function mountPublished(shared = true): void {
  document.head.innerHTML = `<meta name="osp-review" content='${JSON.stringify({
    sourcePath: "notes/plan.html",
    page: "notes/plan.html",
    site: "Handbook",
    published: true,
    ...(shared ? { shared: { owner: "acme", repo: "site" } } : {}),
  })}'>`;
  document.title = "Plan";
  document.body.innerHTML = `<article><p>The first paragraph.</p><p>The second.</p></article>`;
  stampBlockIds(document.body);
}

function run(): ShadowRoot {
  new Function(overlayBundle())();
  const host = document.getElementById("osp-overlay-host");
  if (!host?.shadowRoot) throw new Error("the overlay did not mount");
  return host.shadowRoot;
}

function click(target: Element | null): void {
  if (!target) throw new Error("nothing to click");
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
}

function leave(shadow: ShadowRoot, text: string): void {
  click(shadow.querySelector('.co-mode[data-mode="comment"]'));
  shadow
    .querySelector(".co-capture")
    ?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, clientX: 20, clientY: 20 }),
    );
  // A published reader is asked for a name before their first comment.
  const name = shadow.querySelector(".co-modal input") as HTMLInputElement | null;
  if (name) {
    name.value = "Reader";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    click(shadow.querySelector(".co-modal .co-submit"));
  }
  const input = shadow.querySelector(".co-draft textarea") as HTMLTextAreaElement;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  click(shadow.querySelector(".co-draft .co-send"));
}

function stored(): OverlayComment[] {
  return JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
}

/** A review issue as GitHub's API lists it. */
function issueFor(pin: Record<string, unknown>, over: Partial<SharedIssue> = {}): SharedIssue {
  return {
    number: 12,
    title: "Shorter, please",
    body: `Shorter, please.\n\n---\nLeft on Plan.\n\n<!-- osp-review ${JSON.stringify({ v: 1, ...pin })} -->`,
    state: "open",
    state_reason: null,
    html_url: "https://github.com/acme/site/issues/12",
    created_at: "2026-11-22T10:00:00Z",
    comments: 3,
    user: { login: "octo" },
    ...over,
  };
}

/** Answers the issues request with these, and records what was asked. */
function github(issues: SharedIssue[]): string[] {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      asked.push(String(url));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(issues) });
    }),
  );
  return asked;
}

const settle = () => new Promise((done) => setTimeout(done, 0));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/notes/plan.html");
  document.elementFromPoint = () => document.querySelector("p");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("posting a shared comment", () => {
  it("opens GitHub's form, prefilled with a body the plugin can read back", async () => {
    github([]);
    mountPublished();
    const opened: string[] = [];
    vi.spyOn(window, "open").mockImplementation((url) => {
      opened.push(String(url));
      return null;
    });
    const shadow = run();
    await settle();

    leave(shadow, "This paragraph says --> too much.");

    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]);
    expect(url.origin + url.pathname).toBe("https://github.com/acme/site/issues/new");
    expect(url.searchParams.get("title")).toBe("This paragraph says --> too much.");

    const body = url.searchParams.get("body") ?? "";
    const pin = readSharedMarker(body);
    const comment = stored()[0];
    expect(pin?.id).toBe(comment.id);
    expect(pin?.page).toBe("notes/plan.html");
    expect(pin?.block).toBe(comment.block);
    expect(sharedText(body)).toBe("This paragraph says --> too much.");
    // A page URL and nothing from the vault.
    expect(body).not.toContain(".md");
  });

  it("keeps the comment marked as posting until its issue is read back", async () => {
    github([]);
    mountPublished();
    vi.spyOn(window, "open").mockImplementation(() => null);
    const shadow = run();
    await settle();

    leave(shadow, "Shorter, please.");
    expect(stored()[0].pending).toBe(true);
    expect(shadow.querySelector(".co-pin[data-pending]")).not.toBeNull();
    click(shadow.querySelector(".co-pin[data-pending]"));
    expect(shadow.querySelector(".co-shared-note")?.textContent).toContain("finish in the GitHub tab");
    // The reader cannot resolve what is not posted yet.
    expect(shadow.querySelector(".co-pop .co-act[data-primary]")?.hasAttribute("hidden")).toBe(
      true,
    );
  });

  it("lets go of the local copy once the issue it became is on GitHub", async () => {
    github([]);
    mountPublished();
    vi.spyOn(window, "open").mockImplementation(() => null);
    let shadow = run();
    await settle();
    leave(shadow, "Shorter, please.");
    const mine = stored()[0];

    // Next visit: the issue is there, carrying the comment's own id.
    sessionStorage.clear();
    github([issueFor({ id: mine.id, page: "notes/plan.html", block: mine.block, rx: 0, ry: 0 })]);
    (window as unknown as { ospStampWatcher?: { stop(): void } }).ospStampWatcher?.stop();
    document.getElementById("osp-overlay-host")?.remove();
    shadow = run();
    await settle();
    await settle();

    expect(stored()).toHaveLength(0);
    const pins = shadow.querySelectorAll(".co-pin");
    expect(pins).toHaveLength(1);
    expect(pins[0].hasAttribute("data-pending")).toBe(false);
  });
});

describe("reading shared comments", () => {
  function onFirst(): Record<string, unknown> {
    const block = document.querySelector("p")?.getAttribute("data-osp-block");
    return { id: "someone-else", page: "notes/plan.html", block, rx: 0, ry: 0 };
  }

  it("asks GitHub once for the repository's issues, without signing in", async () => {
    mountPublished();
    const asked = github([]);
    run();
    await settle();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("https://api.github.com/repos/acme/site/issues?state=all");
  });

  it("draws everybody's comments as pins", async () => {
    mountPublished();
    github([issueFor(onFirst())]);
    const shadow = run();
    await settle();
    await settle();
    expect(shadow.querySelectorAll(".co-pin")).toHaveLength(1);
  });

  it("uses the copy from earlier in the visit rather than asking again", async () => {
    mountPublished();
    github([issueFor(onFirst())]);
    run();
    await settle();
    await settle();

    (window as unknown as { ospStampWatcher?: { stop(): void } }).ospStampWatcher?.stop();
    document.getElementById("osp-overlay-host")?.remove();
    const asked = github([]);
    const shadow = run();
    await settle();
    expect(asked).toHaveLength(0);
    expect(shadow.querySelectorAll(".co-pin")).toHaveLength(1);
  });

  it("shows a closed issue as closed, and says which kind", async () => {
    mountPublished();
    github([issueFor(onFirst(), { state: "closed", state_reason: "not_planned" })]);
    const shadow = run();
    await settle();
    await settle();
    const pin = shadow.querySelector(".co-pin");
    expect(pin?.hasAttribute("data-resolved")).toBe(true);
    click(pin);
    expect(shadow.querySelector(".co-resolved-row")?.textContent).toContain("not planned");
  });

  it("sends the reader to GitHub to reply, and offers nothing that edits", async () => {
    mountPublished();
    github([issueFor(onFirst())]);
    const shadow = run();
    await settle();
    await settle();
    click(shadow.querySelector(".co-pin"));

    const link = shadow.querySelector(".co-shared-note a");
    expect(link?.textContent).toBe("3 replies on GitHub");
    expect(link?.getAttribute("href")).toBe("https://github.com/acme/site/issues/12");
    expect(shadow.querySelector(".co-pop-reply")).toBeNull();
    expect(shadow.querySelector(".co-pop .co-act[data-primary]")?.hasAttribute("hidden")).toBe(
      true,
    );
  });

  it("never stores or exports somebody else's comment as the reader's own", async () => {
    mountPublished();
    github([issueFor(onFirst())]);
    run();
    await settle();
    await settle();
    expect(stored()).toHaveLength(0);
  });

  it("says so when GitHub refuses, and keeps the overlay working", async () => {
    mountPublished();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) })),
    );
    const shadow = run();
    await settle();
    await settle();
    click(shadow.querySelector('.co-mode[data-mode="review"]'));
    expect(shadow.textContent).toContain("GitHub is limiting requests");
  });

  it("asks GitHub for nothing on a site that does not share", async () => {
    mountPublished(false);
    const asked = github([]);
    run();
    await settle();
    expect(asked).toHaveLength(0);
  });
});

describe("signing in through the owner's Worker", () => {
  const WORKER = "https://signin.example.test";

  function mountWithSignin(extra: Record<string, unknown> = {}): void {
    document.head.innerHTML = `<meta name="osp-review" content='${JSON.stringify({
      sourcePath: "notes/plan.html",
      page: "notes/plan.html",
      site: "Handbook",
      published: true,
      shared: { owner: "acme", repo: "site", signin: WORKER, ...extra },
    })}'>`;
    document.title = "Plan";
    document.body.innerHTML = `<article><p>The first paragraph.</p></article>`;
    stampBlockIds(document.body);
  }

  type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

  /** A GitHub that lists `issues`, makes issue 99 on a POST, and says who you are. */
  function api(issues: SharedIssue[] = []): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit = {}) => {
        const call: Call = {
          url: String(url),
          method: init.method ?? "GET",
          headers: (init.headers ?? {}) as Record<string, string>,
          body: init.body ? JSON.parse(String(init.body)) : null,
        };
        calls.push(call);
        let answer: unknown = issues;
        if (call.url.endsWith("/user")) answer = { login: "octo" };
        if (call.url.endsWith("/refresh")) {
          answer = { access_token: "ghu_renewed", expires_in: 28800, refresh_token: "ghr_renewed" };
        }
        if (call.method === "POST" && call.url.endsWith("/repos/acme/site/issues")) {
          const body = call.body as { title: string; body: string };
          answer = {
            number: 99,
            title: body.title,
            body: body.body,
            state: "open",
            html_url: "https://github.com/acme/site/issues/99",
            created_at: "2026-11-22T12:00:00Z",
            comments: 0,
            user: { login: "octo" },
          };
        }
        return Promise.resolve({
          ok: true,
          status: call.method === "POST" ? 201 : 200,
          json: () => Promise.resolve(answer),
        });
      }),
    );
    return calls;
  }

  function fragment(values: Record<string, unknown>): string {
    return btoa(JSON.stringify(values)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function signedIn(expiresIn = 28800): void {
    localStorage.setItem(
      "osp-github-auth",
      JSON.stringify({
        access: "ghu_fabricated",
        expiresAt: Date.now() + expiresIn * 1000,
        refresh: "ghr_fabricated",
        refreshExpiresAt: Date.now() + 1e9,
        login: "octo",
      }),
    );
  }

  it("posts from the page when signed in, with no GitHub tab", async () => {
    mountWithSignin();
    signedIn();
    const calls = api();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const shadow = run();
    await settle();

    leave(shadow, "Shorter, please.");
    await settle();
    await settle();

    expect(open).not.toHaveBeenCalled();
    const post = calls.find((call) => call.method === "POST");
    expect(post?.headers.Authorization).toBe("Bearer ghu_fabricated");
    expect(readSharedMarker((post?.body as { body: string }).body)?.page).toBe("notes/plan.html");
    // The issue it became is the comment now, without waiting for a fetch.
    expect(stored()).toHaveLength(0);
    expect(shadow.querySelectorAll(".co-pin:not([data-pending])")).toHaveLength(1);
  });

  it("asks how to post when not signed in, and the form still works", async () => {
    mountWithSignin();
    api();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const shadow = run();
    await settle();

    leave(shadow, "Shorter, please.");
    await settle();
    const buttons = Array.from(shadow.querySelectorAll(".co-modal button")).map(
      (button) => button.textContent,
    );
    expect(buttons).toContain("Sign in with GitHub");
    click(
      Array.from(shadow.querySelectorAll(".co-modal button")).find(
        (button) => button.textContent === "Use GitHub's form",
      ) ?? null,
    );
    expect(String(open.mock.calls[0][0])).toMatch(/^https:\/\/github\.com\/acme\/site\/issues\/new\?/);
  });

  it("signs in from the fragment the Worker sends back, and posts what was waiting", async () => {
    mountWithSignin();
    const calls = api();
    // A comment that was waiting when the reader went off to sign in.
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        {
          id: "waiting1",
          page: "notes/plan.html",
          sourcePath: "notes/plan.html",
          block: null,
          blockText: "",
          x: 5,
          y: 5,
          rx: null,
          ry: null,
          author: "Reader",
          text: "Waiting to go.",
          createdAt: "2026-11-22T11:00:00Z",
          resolved: false,
          priority: "medium",
          agent: null,
          imported: null,
          external: null,
          replies: [],
          pending: true,
          awaitingSignin: true,
        },
      ]),
    );
    sessionStorage.setItem("osp-auth-nonce", "nonce12345");
    sessionStorage.setItem("osp-auth-hash", "#/cart");
    window.history.replaceState(
      {},
      "",
      "/notes/plan.html#osp-auth=" +
        fragment({ access_token: "ghu_new", expires_in: 28800, refresh_token: "ghr_new", nonce: "nonce12345" }),
    );
    run();
    await settle();
    await settle();
    await settle();

    // The tokens are out of the address, and the screen it was on is back.
    expect(location.hash).toBe("#/cart");
    expect(JSON.parse(localStorage.getItem("osp-github-auth") ?? "{}").access).toBe("ghu_new");
    const post = calls.find((call) => call.method === "POST");
    expect((post?.body as { title: string }).title).toBe("Waiting to go.");
  });

  it("refuses tokens it did not ask for", async () => {
    mountWithSignin();
    api();
    sessionStorage.setItem("osp-auth-nonce", "mine");
    window.history.replaceState(
      {},
      "",
      "/notes/plan.html#osp-auth=" + fragment({ access_token: "ghu_theirs", nonce: "someone-elses" }),
    );
    run();
    await settle();
    expect(localStorage.getItem("osp-github-auth")).toBeNull();
    expect(location.hash).toBe("");
  });

  it("renews a token that has run out, through the Worker", async () => {
    mountWithSignin();
    signedIn(-10);
    const calls = api();
    run();
    await settle();
    await settle();
    expect(calls[0].url).toBe(`${WORKER}/refresh`);
    expect(calls[0].body).toEqual({ refresh_token: "ghr_fabricated" });
    expect(calls[1].headers.Authorization).toBe("Bearer ghu_renewed");
  });

  it("reads a private repository only signed in, and invites the reader to", async () => {
    mountWithSignin({ private: true });
    const calls = api();
    const shadow = run();
    await settle();
    expect(calls).toHaveLength(0);
    click(shadow.querySelector('.co-mode[data-mode="review"]'));
    expect(shadow.querySelector(".co-signin")?.textContent).toContain("Sign in with GitHub to see");
  });

  it("talks to an Enterprise Server where the site says so", async () => {
    mountWithSignin({ api: "https://ghe.example.test/api/v3", web: "https://ghe.example.test" });
    signedIn();
    const calls = api();
    run();
    await settle();
    expect(calls[0].url.startsWith("https://ghe.example.test/api/v3/repos/acme/site/issues?")).toBe(
      true,
    );
  });
});
